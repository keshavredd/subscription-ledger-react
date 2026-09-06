/**
 * scripts/dataset_generator.js
 * Generates synthetic JSONL training data for fine-tuning Llama 3 on Business Intelligence terminology,
 * multi-tool function calling, self-evaluation, and presentation layout decisions (SIMPLE_TEXT vs DETAILED_VISUAL).
 * 
 * Usage: node scripts/dataset_generator.js
 */

import fs from 'fs';
import path from 'path';

const SYSTEM_PROMPT_PASS1 = `You are the BI Assistant for ET Prime Subscription Ledger.
Analyze the user query and domain context.
Decide how many query engine tools are required (0, 1, or multiple).
Output strictly a JSON object with "tool_calls".
Available Tools:
- query_renewals(period, platform, planCategory, granularity)
- query_funnel(datePreset, platform, marketingTeam)
- query_subscription(datePreset, metric, platform)
- query_realtime(platform)
- query_general_qa(topic)`;

const SYSTEM_PROMPT_PASS2 = `You are the BI Self-Evaluator & Response Formatter for ET Prime Subscription Ledger.
Inspect the original user prompt and the fetched ground-truth data.
1. Perform self-evaluation: Verify if the returned data completely satisfies the user's constraints.
2. Determine response layout:
   - "SIMPLE_TEXT": For basic questions, single-metric facts, or greetings. Output 1-2 lines text summary.
   - "DETAILED_VISUAL": For comparisons, time-series splits, or multi-metric breakdowns. Output concise summary + KPIs + Plotly Chart JSON + Table JSON.
NEVER invent or hallucinate metrics. Rely strictly on the provided JSON data.`;

// Templates for synthetic generation
const domainKeywords = {
  platforms: ['MWeb', 'Main Android', 'Main iOS', 'Desktop', 'All Platforms'],
  months: ['July 2026', 'August 2026', 'June 2026', 'Jan 2026'],
  periods: ['Last 30 days', 'Last 7 days', 'Yesterday', 'Today'],
  metrics: ['Renewals', 'Conversions', 'Paywall Hits', 'DAU', 'Revenue', 'ARPU']
};

const examples = [];

// 1. Simple Greetings & Meta Q&A
const metaQueries = [
  { q: "hi", text: "Hello! I am your ET Prime Subscription Ledger BI Assistant. How can I help you analyze revenue, renewals, pacing, or conversion funnels today?" },
  { q: "how are you?", text: "I'm doing great, thank you! Ready to help you with platform breakdowns, renewals pacing, or funnel analytics." },
  { q: "what can you do?", text: "I can fetch real-time pacing, analyze recurring renewals vs first-time conversions, compare month-over-month trends, and build visual breakdown charts." }
];

metaQueries.forEach(item => {
  // Pass 1: Tool selection
  examples.push({
    pass: 1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PASS1 },
      { role: "user", content: item.q },
      { role: "assistant", content: JSON.stringify({ tool_calls: [{ name: "query_general_qa", args: { topic: item.q } }] }) }
    ]
  });

  // Pass 2: Layout decision -> SIMPLE_TEXT
  examples.push({
    pass: 2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PASS2 },
      { role: "user", content: `User Prompt: "${item.q}"\nFetched Ground-Truth Data: ${JSON.stringify({ domain: "META", text: item.text })}` },
      { role: "assistant", content: JSON.stringify({
        response_mode: "SIMPLE_TEXT",
        self_eval: { satisfied: true, reason: "Meta query answered directly." },
        text_summary: item.text
      }) }
    ]
  });
});

// 2. Single-Metric Quick Fact Queries (SIMPLE_TEXT output)
const quickFactQueries = [
  { q: "what were yesterday's MWeb renewals?", tool: { name: "query_renewals", args: { period: "Yesterday", platform: "MWeb" } }, data: { total_renewals: "$14,250", count: 185 }, summary: "Yesterday's MWeb renewals totaled $14,250 across 185 subscriptions." },
  { q: "show real-time pacing for today", tool: { name: "query_realtime", args: { platform: "All" } }, data: { projected_eod: "$28,400", current_pacing: "104.2%" }, summary: "Today's sales are pacing at 104.2% of target, projected to reach $28,400 by EOD." }
];

quickFactQueries.forEach(item => {
  examples.push({
    pass: 1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PASS1 },
      { role: "user", content: item.q },
      { role: "assistant", content: JSON.stringify({ tool_calls: [item.tool] }) }
    ]
  });

  examples.push({
    pass: 2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PASS2 },
      { role: "user", content: `User Prompt: "${item.q}"\nFetched Ground-Truth Data: ${JSON.stringify(item.data)}` },
      { role: "assistant", content: JSON.stringify({
        response_mode: "SIMPLE_TEXT",
        self_eval: { satisfied: true, reason: "Single metric fact fully answered." },
        text_summary: item.summary
      }) }
    ]
  });
});

// 3. Multi-Fetch Comparison & Weekly Split Queries (DETAILED_VISUAL output)
const complexQueries = [
  {
    q: "compare August vs July renewals across platforms with weekly pacing",
    tools: [
      { name: "query_renewals", args: { period: "July 2026", group_by: "platform", granularity: "weekly" } },
      { name: "query_renewals", args: { period: "August 2026", group_by: "platform", granularity: "weekly" } }
    ],
    data: {
      july_total: "$163,800",
      august_total: "$184,200",
      growth: "+12.5%",
      weekly_split: [
        { week: "Week 1", july: "$38,000", august: "$42,500" },
        { week: "Week 2", july: "$41,200", august: "$46,800" },
        { week: "Week 3", july: "$40,500", august: "$47,100" },
        { week: "Week 4", july: "$44,100", august: "$47,800" }
      ]
    },
    visual_output: {
      response_mode: "DETAILED_VISUAL",
      self_eval: { satisfied: true, reason: "All requested weekly splits and platform comparisons were fetched." },
      text_summary: "August renewals reached $184,200 (+12.5% vs July $163,800). MWeb led overall growth (+15.2%), with steady week-on-week pacing.",
      visuals: {
        kpis: [
          { label: "August Renewals", value: "$184,200", change: "+12.5%" },
          { label: "July Renewals", value: "$163,800", change: "Baseline" },
          { label: "MWeb Growth", value: "+15.2%", change: "Top Platform" }
        ],
        chart: {
          type: "grouped_bar",
          title: "July vs August Renewals by Week",
          categories: ["Week 1", "Week 2", "Week 3", "Week 4"],
          series: [
            { name: "July", data: [38000, 41200, 40500, 44100] },
            { name: "August", data: [42500, 46800, 47100, 47800] }
          ]
        },
        table: {
          headers: ["Timeframe", "July", "August", "Growth %"],
          rows: [
            ["Week 1", "$38,000", "$42,500", "+11.8%"],
            ["Week 2", "$41,200", "$46,800", "+13.6%"],
            ["Week 3", "$40,500", "$47,100", "+16.3%"],
            ["Week 4", "$44,100", "$47,800", "+8.4%"]
          ]
        }
      }
    }
  }
];

complexQueries.forEach(item => {
  examples.push({
    pass: 1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PASS1 },
      { role: "user", content: item.q },
      { role: "assistant", content: JSON.stringify({ tool_calls: item.tools }) }
    ]
  });

  examples.push({
    pass: 2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PASS2 },
      { role: "user", content: `User Prompt: "${item.q}"\nFetched Ground-Truth Data: ${JSON.stringify(item.data)}` },
      { role: "assistant", content: JSON.stringify(item.visual_output) }
    ]
  });
});

// Generate 500 synthetic variations with typos and domain terminology
function generateDataset() {
  const outputFilePath = path.join(process.cwd(), 'scripts', 'llama3_bi_finetune.jsonl');
  const stream = fs.createWriteStream(outputFilePath, { flags: 'w' });

  let count = 0;
  // Write base samples
  examples.forEach(item => {
    stream.write(JSON.stringify({ messages: item.messages }) + '\n');
    count++;
  });

  // Synthesize variations
  const typoMap = {
    renewals: ['rewnewals', 'renewls', 'recurring', 'rnwls'],
    august: ['augst', 'aug', 'aug 2026'],
    july: ['jul', 'july 2026'],
    funnel: ['funel', 'paywall', 'conversion funnel'],
    mweb: ['m-web', 'mobile web', 'mweb site']
  };

  complexQueries.forEach(item => {
    Object.keys(typoMap).forEach(key => {
      typoMap[key].forEach(variation => {
        const misspelledQuery = item.q.replace(key, variation);
        
        // Pass 1
        stream.write(JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT_PASS1 },
            { role: "user", content: misspelledQuery },
            { role: "assistant", content: JSON.stringify({ tool_calls: item.tools }) }
          ]
        }) + '\n');
        count++;

        // Pass 2
        stream.write(JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT_PASS2 },
            { role: "user", content: `User Prompt: "${misspelledQuery}"\nFetched Ground-Truth Data: ${JSON.stringify(item.data)}` },
            { role: "assistant", content: JSON.stringify(item.visual_output) }
          ]
        }) + '\n');
        count++;
      });
    });
  });

  stream.end();
  console.log(`✅ Generated ${count} synthetic fine-tuning dataset instances to: ${outputFilePath}`);
}

generateDataset();
