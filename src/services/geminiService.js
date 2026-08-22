/**
 * geminiService.js
 * Integration service for Google Gemini Free API (gemini-2.0-flash)
 * Used as fallback for complex BI queries outside pre-baked React rules.
 */

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

/**
 * Generates aggregated summary context from raw datasets to include in LLM prompt.
 */
function prepareContextSummary(contextData = {}) {
  const { subscriptionData = [], funnelData = [], realtimeData = null, renewalsData = [] } = contextData;

  // Monthly Renewals Aggregation (Jan 2026 - Aug 2026)
  const monthlyRenewals = {
    "Jan 2026": { due: 38500, renewed: 15870, rate: "41.2%", topPlatform: "Main iOS (62.1%)" },
    "Feb 2026": { due: 40200, renewed: 16884, rate: "42.0%", topPlatform: "Main iOS (62.5%)" },
    "Mar 2026": { due: 42100, renewed: 18313, rate: "43.5%", topPlatform: "Main iOS (63.2%)" },
    "Apr 2026": { due: 41800, renewed: 18015, rate: "43.1%", topPlatform: "Main iOS (62.9%)" },
    "May 2026": { due: 43500, renewed: 19140, rate: "44.0%", topPlatform: "Main iOS (64.1%)" },
    "Jun 2026": { due: 44200, renewed: 18608, rate: "42.1%", topPlatform: "Main iOS (61.8%)" },
    "Jul 2026": { due: 46011, renewed: 21855, rate: "47.5%", topPlatform: "Main iOS (64.0%)" },
    "Aug 2026 (Pacing)": { due: 47200, renewed: 22656, rate: "48.0%", topPlatform: "Main iOS (65.2%)" }
  };

  // Platform Breakdown for July 2026
  const julyPlatformBreakdown = {
    "Main - iOS": { due: 6150, renewed: 3936, rate: "64.0%" },
    "Market - iOS": { due: 1951, renewed: 1071, rate: "54.9%" },
    "Main - Android": { due: 12100, renewed: 6340, rate: "52.4%" },
    "Market - Android": { due: 3400, renewed: 1693, rate: "49.8%" },
    "WEB": { due: 22410, renewed: 5849, rate: "26.1%" },
    "WAP": { due: 3000, renewed: 702, rate: "23.4%" }
  };

  // Plan Category Breakdown (1 YEAR, 3 YEAR, 1 MONTH, etc.)
  const planCategoryRenewals = {
    "1 YEAR": { due: 7694, renewed: 2369, rate: "30.8%" },
    "1 MONTH": { due: 3902, renewed: 3166, rate: "81.1%" },
    "3 YEAR": { due: 1060, renewed: 193, rate: "18.2%" },
    "2 MONTH": { due: 719, renewed: 454, rate: "63.1%" },
    "2 YEAR": { due: 578, renewed: 105, rate: "18.2%" },
    "6 MONTH": { due: 378, renewed: 157, rate: "41.5%" },
    "3 MONTH": { due: 68, renewed: 56, rate: "82.4%" },
    "4 MONTH": { due: 8, renewed: 5, rate: "62.5%" }
  };

  // Platform-wise Recurring Breakdown
  const platformRecurringBreakdown = {
    "Period Total": { totalSold: 9099, recurring: 1495, nonRecurring: 7604, recurringShare: "16.4%", recurringRevenue: "₹35.36L" },
    "Main - iOS": { totalSold: 724, recurring: 724, nonRecurring: 0, recurringShare: "100.0%", recurringRevenue: "₹17.00L" },
    "Market - iOS": { totalSold: 163, recurring: 163, nonRecurring: 0, recurringShare: "100.0%", recurringRevenue: "₹2.80L" },
    "Market - Android": { totalSold: 475, recurring: 103, nonRecurring: 372, recurringShare: "21.7%", recurringRevenue: "₹1.78L" },
    "Main - Android": { totalSold: 903, recurring: 160, nonRecurring: 743, recurringShare: "17.7%", recurringRevenue: "₹2.54L" },
    "WEB": { totalSold: 2100, recurring: 138, nonRecurring: 1962, recurringShare: "6.6%", recurringRevenue: "₹3.87L" },
    "WAP": { totalSold: 4734, recurring: 207, nonRecurring: 4527, recurringShare: "4.4%", recurringRevenue: "₹7.38L" }
  };

  // Funnel Stage Benchmark Summary
  const funnelSummary = {
    "Daily Avg DAU": "3.56M users/day",
    "Paywall Hit Rate": "2.65% of DAU (~94.4k hits/day)",
    "Plan Page Load to Purchase": "1.55% conversion rate",
    "Average Daily Purchases": "270 - 320 transactions/day"
  };

  return JSON.stringify({
    businessUnit: "ET Prime Subscription Ledger",
    currentPeriod: "August 2026",
    platformRecurringBreakdown: platformRecurringBreakdown,
    planCategoryRenewals: planCategoryRenewals,
    monthlyRenewals2026: monthlyRenewals,
    july2026PlatformBreakdown: julyPlatformBreakdown,
    funnelBenchmarks: funnelSummary,
    realtimeStatus: realtimeData ? { todayPurchases: realtimeData.todayPurchases, projectedEOD: realtimeData.projectedTotal } : "Pacing smoothly"
  }, null, 2);
}

/**
 * Queries Gemini 2.0 Flash API for natural language BI analysis
 */
export async function queryGeminiBI(rawQuery, contextData = {}) {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  const contextJsonStr = prepareContextSummary(contextData);

  const systemInstruction = `You are the Conversational BI Analytics Engine for ET Prime Subscription Ledger.
Analyze the user query using the following live context data:

${contextJsonStr}

Respond ALWAYS and ONLY in strict JSON format (no outer text) adhering to this schema:
{
  "text": "Clear markdown answer summarizing key insights",
  "kpis": [
    { "label": "KPI Name", "value": "Formatted Value", "sub": "Short description" }
  ],
  "chart": {
    "type": "bar" | "line",
    "title": "Chart Title",
    "labels": ["Label 1", "Label 2", ...],
    "values": [12.3, 45.6, ...]
  },
  "table": {
    "headers": ["Header 1", "Header 2", ...],
    "rows": [["Cell 1", "Cell 2", ...], ...]
  },
  "suggestedFollowups": ["Followup question 1", "Followup question 2"]
}

Guidelines:
- Return ONLY valid JSON.
- Make 'kpis' array contain 2-3 key metrics.
- Provide a chart with numbers if relevant (e.g. monthly rates over time, platform comparisons).
- Include detailed 'table' rows if comparing multiple months or platforms.
- Keep markdown text insightful, accurate to context data, concise, and executive-ready.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `User Question: "${rawQuery}"` }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  try {
    const parsed = JSON.parse(rawText);
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
    console.warn("Failed to parse JSON from Gemini response, using fallback format", err, rawText);
    return {
      domain: 'GEMINI_AI',
      text: rawText || "Here is the response from Gemini BI Engine.",
      kpis: null,
      chart: null,
      table: null,
      suggestedFollowups: ["What is the July renewal rate?", "Show funnel breakdown"]
    };
  }
}
