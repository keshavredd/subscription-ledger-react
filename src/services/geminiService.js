/**
 * geminiService.js
 * Integration service for Google Gemini 2.0 Flash Function Calling Agent
 * Executes multi-turn tool calling, multi-period comparative analytics, and response synthesis.
 */

import { executeToolByName } from '../utils/aiDataEngine.js';

export function getStoredApiKey() {
  if (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_GEMINI_API_KEY) {
    return import.meta.env.VITE_GEMINI_API_KEY.trim();
  }
  if (typeof process !== 'undefined' && process?.env?.VITE_GEMINI_API_KEY) {
    return process.env.VITE_GEMINI_API_KEY.trim();
  }
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('gemini_api_key');
    if (saved && saved.trim()) return saved.trim();
  }
  return '';
}

export function setStoredApiKey(key) {
  if (typeof window !== 'undefined') {
    if (key && key.trim()) {
      localStorage.setItem('gemini_api_key', key.trim());
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  }
}

const GEMINI_TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: "query_renewals",
        description: "Fetch subscription renewal metrics, rates, and platform or plan breakdowns for a specified target period (e.g. 'July 2026', 'August 2026', 'Jan 2026')",
        parameters: {
          type: "OBJECT",
          properties: {
            period: { type: "STRING", description: "Target period or month e.g. 'July 2026', 'August 2026', 'Jan 2026'" },
            platform: { type: "STRING", description: "Platform filter e.g. 'All', 'Main iOS', 'MWeb', 'Main Android'" },
            planCategory: { type: "STRING", description: "Plan category filter e.g. 'All', '1 YEAR', '1 MONTH'" }
          },
          required: ["period"]
        }
      },
      {
        name: "query_funnel",
        description: "Fetch user acquisition funnel metrics including DAU, Paywall Hits, Plan Page Loads, Purchases, and conversion rates across stages",
        parameters: {
          type: "OBJECT",
          properties: {
            datePreset: { type: "STRING", description: "Time period e.g. 'Last 7 days', 'Last 30 days', 'Yesterday'" },
            platform: { type: "STRING", description: "Platform filter" },
            marketingTeam: { type: "STRING", description: "Marketing team filter" }
          }
        }
      },
      {
        name: "query_subscription",
        description: "Fetch subscription performance metrics including Total Revenue, Conversions, Daily Avg Revenue, Avg Revenue per Txn, and Recurring Rate",
        parameters: {
          type: "OBJECT",
          properties: {
            datePreset: { type: "STRING", description: "Time period e.g. 'Last 30 days', 'Last 7 days', 'Yesterday'" },
            metric: { type: "STRING", description: "Metric to analyze e.g. 'Revenue', 'Conversions', 'ARPU', 'Recurring'" },
            platform: { type: "STRING", description: "Platform filter" }
          }
        }
      },
      {
        name: "query_realtime",
        description: "Fetch today's live pacing, hourly sales breakdown, and EOD projected sales compared to historical benchmarks",
        parameters: {
          type: "OBJECT",
          properties: {
            platform: { type: "STRING", description: "Platform filter" }
          }
        }
      },
      {
        name: "query_general_qa",
        description: "Handle general conversational queries, questions about capabilities, onboarding, or dashboard explanations (e.g. 'how can you help me', 'who are you')",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "The general topic or query intent" }
          }
        }
      }
    ]
  }
];

/**
 * Queries Gemini 2.0 Flash Function Calling Agent
 */
export async function queryGeminiBI(rawQuery, contextData = {}) {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const systemInstructionPass1 = `You are the Conversational BI Agent for ET Prime Subscription Ledger.
Analyze the user's prompt alongside conversation history.
CONTEXT & MULTI-TURN RULES:
- If user query mentions "renewals", "renew", "recurring", "renewed", or month comparison like "August vs July renewals", YOU MUST CALL query_renewals! NEVER call query_subscription for renewals!
- Maintain active topic & domain (Renewals, Funnel, Subscription, Realtime) from conversation history. If user is exploring the Subscription Report tab (e.g. sales, platforms, revenue, plans), follow-up questions (such as "Compare 1 Year vs 1 Month plan revenue" or "which plan leads") MUST be answered using query_subscription only, NEVER query_funnel!
- If user asks "can you split the above into weekly" after asking about August renewals, query renewals for August with weekly granularity!
- If prompt requires comparing multiple periods (e.g. "August vs July renewals"), call query_renewals for both periods.
- If prompt is general or vague, call query_general_qa.`;

  // Format last 6 messages (3 turns) into Gemini contents array
  const rawHistory = contextData.conversationHistory || [];
  const historyContents = [];
  rawHistory.slice(-6).forEach(msg => {
    if (msg.sender === 'user' && msg.text) {
      historyContents.push({ role: 'user', parts: [{ text: msg.text }] });
    } else if (msg.sender === 'bot' && msg.text) {
      historyContents.push({ role: 'model', parts: [{ text: msg.text }] });
    }
  });

  // Pass 1: Initial Prompt with Tool Declarations & Multi-Turn History
  const pass1Body = {
    contents: [
      ...historyContents,
      {
        role: 'user',
        parts: [{ text: `User Question: "${rawQuery}"` }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstructionPass1 }]
    },
    tools: GEMINI_TOOLS_DECLARATION
  };

  const responsePass1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pass1Body)
  });

  if (!responsePass1.ok) {
    const errorText = await responsePass1.text();
    throw new Error(`Gemini API Error (${responsePass1.status}): ${errorText}`);
  }

  const dataPass1 = await responsePass1.json();
  const candidatePass1 = dataPass1?.candidates?.[0];
  const messagePartsPass1 = candidatePass1?.content?.parts || [];

  // Check for Function Calls
  const functionCalls = messagePartsPass1.filter(p => p.functionCall);

  if (functionCalls.length > 0) {
    console.log("⚡ [Gemini Agent] Function Calls Requested by Gemini 2.0:", functionCalls);

    // Execute Tools locally
    const functionResponses = [];
    for (const callPart of functionCalls) {
      const call = callPart.functionCall;
      const toolResult = executeToolByName(call.name, call.args || {}, contextData);
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result: toolResult }
        }
      });
    }

    // Pass 2: Synthesize Final Output using Tool Execution Data
    const systemInstructionPass2 = `You are the Conversational BI Analytics Engine for ET Prime Subscription Ledger.
Synthesize the tool execution results into a comprehensive, executive-ready response.

Adhere STRICTLY to this JSON format (no outer text or markdown wrappers):
{
  "text": "Executive markdown narrative summarizing key findings, percentage deltas, and insights",
  "kpis": [
    { "label": "Metric Label", "value": "Value", "sub": "Subtext or delta" }
  ],
  "table": {
    "headers": ["Column 1", "Column 2", ...],
    "rows": [["Cell 1", "Cell 2", ...], ...]
  },
  "chart": {
    "type": "bar" | "line" | "grouped_bar",
    "title": "Chart Title",
    "labels": ["Label 1", "Label 2"],
    // Single-metric:
    "values": [10.5, 20.3],
    // OR Multi-metric / multi-series (e.g. daily DAU, Paywall Hits, Purchases):
    "series": [
      { "name": "DAU", "values": [2720041, 3059039], "color": "#3B82F6", "type": "line" },
      { "name": "Paywall Hits", "values": [78872, 91838], "color": "#F59E0B", "type": "line" }
    ]
  },
  "suggestedFollowups": ["Followup Question 1", "Followup Question 2"]
}

CHART RULES:
- Every value in "values" MUST BE A STRICT NUMBER (e.g. 1500, 24000).
- NEVER use hyphenated strings (e.g. "3059039 - 91838" or "24 - 20") in values.
- For multiple metrics over time, ALWAYS use the "series" array with separate objects!

Guidelines & Verification:
- Return ONLY valid JSON.
- For SIMPLE GREETINGS (e.g. 'hey', 'hi', 'hello'), respond naturally with "Hello! 👋 How can I help you analyze your subscription, renewal, funnel, or realtime data today?". DO NOT say "I'm doing great, thank you for asking!" UNLESS the user explicitly asked "how are you" or "how are yu".
- Set "kpis", "chart", and "table" to null for simple greetings or general meta questions.
- CRITICAL REQUIREMENT MATCHING: Ensure output DIRECTLY matches user's requested timeframe and granularity:
  • If user asked for 'weekly' or 'split into weekly', output MUST include week-by-week data (Week 1, Week 2, Week 3, Week 4).
  • If user asked for rolling N-days (e.g. 15-day rolling, 7-day rolling), output MUST be for that exact rolling window.
  • Maintain topic & domain context from conversation history (e.g. keep Renewals domain if previous question was about renewals).
- For COMPLEX COMPARATIVE queries, format a clear side-by-side comparative table with columns for both periods/dimensions and variance/lift.
- Keep KPIs concise (2-3 cards max).
- Include 3-4 contextually relevant follow-up questions.`;

    const pass2Body = {
      contents: [
        ...historyContents,
        { role: 'user', parts: [{ text: `User Question: "${rawQuery}"` }] },
        candidatePass1.content,
        {
          role: 'user',
          parts: functionResponses
        }
      ],
      systemInstruction: {
        parts: [{ text: systemInstructionPass2 }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    const responsePass2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pass2Body)
    });

    if (responsePass2.ok) {
      const dataPass2 = await responsePass2.json();
      const rawTextPass2 = dataPass2?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      try {
        const parsed = JSON.parse(rawTextPass2);
        return {
          domain: 'GEMINI_AI',
          text: parsed.text || 'Analysis completed.',
          kpis: parsed.kpis || null,
          chart: parsed.chart || null,
          table: parsed.table || null,
          suggestedFollowups: parsed.suggestedFollowups || [
            "Which platform has the highest conversion?",
            "Compare Q1 vs Q2 performance"
          ]
        };
      } catch (err) {
        console.warn("Failed to parse Pass 2 JSON from Gemini response:", err, rawTextPass2);
      }
    }
  }

  // Fallback if no function call returned or for direct response
  const rawTextPass1 = messagePartsPass1.map(p => p.text || '').join('\n');
  try {
    const parsed = JSON.parse(rawTextPass1);
    return {
      domain: 'GEMINI_AI',
      text: parsed.text || rawTextPass1,
      kpis: parsed.kpis || null,
      chart: parsed.chart || null,
      table: parsed.table || null,
      suggestedFollowups: parsed.suggestedFollowups || ["Compare August vs July renewals platform wise", "Show funnel breakdown"]
    };
  } catch (err) {
    return {
      domain: 'GEMINI_AI',
      text: rawTextPass1 || "Here is the summary of your query analysis.",
      kpis: null,
      chart: null,
      table: null,
      suggestedFollowups: ["Compare August vs July renewals platform wise", "Show funnel breakdown"]
    };
  }
}
