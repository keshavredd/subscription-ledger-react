import { queryGeminiBI, getStoredApiKey } from '../services/geminiService.js';
import { withInsightLines } from './insightLines.js';
import { answerDataOverview, answerRealtime, answerFunnel, answerRenewals, answerSubscription, answerArpu, generalQAFacts } from './engineAnswers.js';
import { resolveWindow, comparisonMonths, renewalsAgg, renewalsByPlatform, renewalsByPlan, renewalsByMonth, renewalsDaily, platformsWanted, filterPlatforms, pct as fmtPct } from './engineData.js';
import { queryLlamaBI, getStoredLlamaConfig } from '../services/llamaService.js';

/**
 * Checks if query needs LLM reasoning (multi-month, complex analytics, open NL)
 */
export function shouldUseGemini(rawQuery) {
  const q = (rawQuery || '').toLowerCase().trim();
  const geminiKey = getStoredApiKey();
  const llamaConfig = getStoredLlamaConfig();
  const hasLlmKey = Boolean(geminiKey || llamaConfig.apiKey);
  if (!hasLlmKey) return false;

  // High-confidence exact single local presets can stay local if needed
  const isExactLocalPreset = 
    q.includes('today forecast') ||
    q.includes('paywall hit rate') ||
    q.includes('hourly pacing');

  if (isExactLocalPreset) return false;

  // Meta / Vague / General conversation queries
  const isVagueOrMeta = 
    q.includes('help') || q.includes('who are you') || q.includes('what can you') ||
    q.includes('how can you') || q.includes('capabilities') || q.includes('hello') ||
    q.includes('hi') || q === 'help' || q.includes('options') || q.includes('explain dashboard') ||
    q.includes('what data') || q.includes('haww') || q.includes('what metrics') || q.includes('what do you have') ||
    q.includes('how are') || q.includes('how r') || q.includes('whats up') || q.includes('sup');

  const isComparisonQuery = 
    q.includes('compare') || q.includes('vs') || q.includes('versus') ||
    q.includes('difference') || q.includes('variance') || q.includes('better than');

  // Triggers for Gemini/Llama API Fallback
  const isMultiMonthSpan = 
    q.includes('till now') || q.includes('till july') || q.includes('till jul') ||
    q.includes('from jan') || q.includes('since') || 
    q.includes('monthly') || q.includes('montly') || q.includes('mthly') ||
    q.includes('q1') || q.includes('q2') || q.includes('year to date') || q.includes('ytd');

  const isAnalyticalQuery = q.includes('why') || q.includes('explain') || q.includes('reason') || q.includes('insight') || q.includes('correlation') || q.includes('growth');
  const isCustomTimeSpan = q.includes('months') || q.includes('quarter');
  const isPlatformLeadQuery = q.includes('which platform') || q.includes('leads sales') || q.includes('lead sales') || q.includes('top platform') || q.includes('best platform') || q.includes('highest sales') || q.includes('highest revenue');

  return isVagueOrMeta || isComparisonQuery || isMultiMonthSpan || isAnalyticalQuery || isCustomTimeSpan || isPlatformLeadQuery;
}

export function getActiveDomainFromHistory(conversationHistory = []) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return null;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.domain && ['SUBSCRIPTION', 'FUNNEL', 'RENEWALS', 'REALTIME', 'ARPU'].includes(msg.domain)) {
      return msg.domain;
    }
    if (msg.sender === 'bot' && msg.text) {
      const text = msg.text.toLowerCase();
      if (text.includes('funnel') || text.includes('dau') || text.includes('paywall')) return 'FUNNEL';
      if (text.includes('renewal') || text.includes('recurring') || text.includes('cohort')) return 'RENEWALS';
      if (text.includes('pacing') || text.includes('hourly purchases') || text.includes('run-rate') || text.includes('eod projected')) return 'REALTIME';
      if (text.includes('subscription') || text.includes('platform') || text.includes('revenue') || text.includes('sales') || text.includes('mweb') || text.includes('wap')) return 'SUBSCRIPTION';
    }
  }
  return null;
}

export function resolveContextFromHistory(rawQuery, conversationHistory = []) {
  const q = (rawQuery || '').toLowerCase().trim();
  if (!conversationHistory || conversationHistory.length === 0) return q;

  const isRelative = 
    q.includes('the above') || q.includes('split') || q.includes('weekly') ||
    q.includes('what about') || q.includes('and for') || q.includes('break down') ||
    q.includes('breakdown') || q.includes('show this') || q.includes('how about') ||
    q.includes('per week') || q.includes('by week') || q === 'weekly';

  if (!isRelative) return q;

  let lastBotText = '';
  let lastUserText = '';

  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.sender === 'user' && !lastUserText) lastUserText = (msg.text || '').toLowerCase();
    if (msg.sender === 'bot' && !lastBotText) lastBotText = (msg.text || '').toLowerCase();
  }

  const combinedPrevious = `${lastUserText} ${lastBotText}`;

  let inferredDomain = '';
  if (combinedPrevious.includes('renewal') || combinedPrevious.includes('renew') || combinedPrevious.includes('recurring')) {
    inferredDomain = 'renewals';
  } else if (combinedPrevious.includes('funnel') || combinedPrevious.includes('paywall') || combinedPrevious.includes('dau')) {
    inferredDomain = 'funnel';
  } else if (combinedPrevious.includes('realtime') || combinedPrevious.includes('pacing')) {
    inferredDomain = 'realtime';
  } else {
    inferredDomain = 'subscription';
  }

  let inferredPeriod = '';
  if (combinedPrevious.includes('august') || combinedPrevious.includes('aug')) inferredPeriod = 'august';
  else if (combinedPrevious.includes('july') || combinedPrevious.includes('jul')) inferredPeriod = 'july';
  else if (combinedPrevious.includes('june') || combinedPrevious.includes('jun')) inferredPeriod = 'june';

  let resolved = q;
  if (inferredDomain && !q.includes('renew') && !q.includes('funnel') && !q.includes('realtime') && !q.includes('revenue') && !q.includes('sales')) {
    resolved = `${resolved} ${inferredDomain}`;
  }
  if (inferredPeriod && !q.includes('august') && !q.includes('july') && !q.includes('june')) {
    resolved = `${resolved} for ${inferredPeriod}`;
  }

  console.log(`🧠 [Context Window] Resolved user query "${rawQuery}" -> "${resolved}" (Domain: ${inferredDomain}, Period: ${inferredPeriod})`);
  return resolved;
}

export function verifyAndEnforceRequirementMatch(result, rawQuery, contextData = {}) {
  const q = (rawQuery || '').toLowerCase().trim();
  if (!result || !result.text) return result;

  // whole words only: "this month" and "which platform" must not read as "hi"
  const isMeta = result.domain === 'META' || result.domain === 'DATA_OVERVIEW' ||
    /\b(hello|hi|hey|how are you|how r u|who are you|haww)\b/.test(q);

  // Small-Talk / Meta Guard: Enforce null KPIs, chart, and table for simple greetings or meta questions
  if (isMeta) {
    result.kpis = null;
    result.chart = null;
    result.table = null;
    return result;
  }

  const isRenewals = q.includes('renew') || q.includes('recurring') || result.domain === 'RENEWALS';
  const isFunnel = q.includes('funnel') || q.includes('paywall') || result.domain === 'FUNNEL';

  if (isRenewals && result.domain !== 'SUBSCRIPTION') {
    result.domain = 'RENEWALS';
  } else if (isFunnel) {
    result.domain = 'FUNNEL';
  }

  const wantsWeekly = q.includes('weekly') || q.includes('week') || q.includes('split into weekly') || q.includes('by week') || q.includes('per week');
  const hasWeekInTable = result.table && result.table.rows && result.table.rows.some(r => String(r[0]).toLowerCase().includes('week'));
  const hasWeekInText = result.text.toLowerCase().includes('week');

  // Verification Failure Guard: User asked for weekly, but answer lacked week breakdown
  if (wantsWeekly && !hasWeekInTable && !hasWeekInText) {
    console.warn("⚠️ [Requirement Verification Guard] Output failed weekly requirement check. Re-building weekly response.");
    if (isRenewals) {
      return processRenewalsDomain(q, contextData.renewalsData, contextData);
    } else if (isFunnel) {
      return processFunnelDomain(q, contextData.funnelData);
    } else {
      return processSubscriptionDomain(q, contextData.subscriptionData, contextData);
    }
  }

  return result;
}

export async function processConversationalQueryAsync(rawQuery, contextData = {}) {
  // -------------------------------------------------------------------------
  // 1. DIRECT PASS TO LLAMA 3 BI ENGINE FIRST (Zero Local Pre-filtering)
  // -------------------------------------------------------------------------
  const llamaConfig = getStoredLlamaConfig();
  if (llamaConfig.apiKey) {
    try {
      console.log(`🦙 [Direct LLM Path] Passing user prompt directly to Llama 3 Engine: "${rawQuery}"`);
      const llamaResult = await queryLlamaBI(rawQuery, contextData);
      if (llamaResult && llamaResult.text) {
        return llamaResult;
      }
    } catch (err) {
      console.warn("🦙 Llama 3 API execution issue, gracefully falling back to secondary/local engine:", err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 2. SECONDARY PASS TO GEMINI 2.0 FLASH
  // -------------------------------------------------------------------------
  const geminiKey = getStoredApiKey();
  if (geminiKey) {
    try {
      const geminiResult = await queryGeminiBI(rawQuery, contextData);
      if (geminiResult && geminiResult.text) {
        return geminiResult;
      }
    } catch (err) {
      console.warn("Gemini API execution issue, falling back to deterministic local engine:", err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 3. DETERMINISTIC LOCAL ENGINE (High-accuracy offline fallback)
  // -------------------------------------------------------------------------
  return processConversationalQuery(rawQuery, contextData);
}

/**
 * Calculates Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Checks if query contains a word that fuzzy matches any target word in a dictionary
 */
function fuzzyContains(query, targets, maxDistance = 1) {
  if (!query) return false;
  const words = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  return targets.some(target => {
    const t = target.toLowerCase();
    return words.some(word => {
      if (word === t) return true;
      // Short words (<= 4 chars like 'year', 'leak', 'dau', 'plan', 'ios') must match exactly to avoid false positives
      if (word.length <= 4 || t.length <= 4) return false;
      if (word.includes(t) || t.includes(word)) return true;
      const allowedDist = (word.length >= 7 && t.length >= 7) ? 2 : 1;
      if (Math.abs(word.length - t.length) <= allowedDist) {
        return levenshteinDistance(word, t) <= allowedDist;
      }
      return false;
    });
  });
}

export function processConversationalQuery(rawQuery, contextData = {}) {
  // Every deterministic answer opens with one or two lines read off its own data
  return withInsightLines(processConversationalQueryCore(rawQuery, contextData));
}

function processConversationalQueryCore(rawQuery, contextData = {}) {
  const activeDomain = getActiveDomainFromHistory(contextData.conversationHistory);
  const resolvedQuery = resolveContextFromHistory(rawQuery, contextData.conversationHistory);
  const q = (resolvedQuery || '').toLowerCase().trim();
  const { subscriptionData = [], funnelData = [], realtimeData = null, renewalsData = [] } = contextData;

  const isBusinessQuery = 
    fuzzyContains(q, ['renewal', 'renewals', 'renew', 'recurring', 'funnel', 'paywall', 'pacing', 'realtime', 'revenue', 'conversions', 'sales', 'july', 'august', 'june', 'september', 'yesterday', 'today']) ||
    q.includes('plan') || q.includes('1 year') || q.includes('1 month') || activeDomain !== null;

  // -------------------------------------------------------------------------
  // 0. SMALL TALK / GREETINGS / STATUS QUERY INTERCEPTOR
  // -------------------------------------------------------------------------
  const isGreetingOrSmallTalk = !isBusinessQuery && (
    fuzzyContains(q, ['hello', 'hi', 'hey', 'greetings', 'howdy', 'sup']) ||
    q.includes('how are') || q.includes('how r') || q.includes('how do you') ||
    q.includes('how is it') || q.includes('are you') || q.includes('whats up') ||
    q.includes('what\'s up') || q.includes('who are you') || q.includes('what are you') ||
    q.includes('tell me about yourself') || q.includes('thank')
  );

  if (isGreetingOrSmallTalk) {
    let greetingText = "Hello! 👋 I am your **ET Prime Conversational BI Assistant**.";
    if (q.includes('how are') || q.includes('how r') || q.includes('how do you') || q.includes('how is it')) {
      greetingText = "I'm doing great, thank you for asking! 😊 I am your **ET Prime Conversational BI Assistant**.";
    } else if (q.includes('who are') || q.includes('what are you') || q.includes('tell me about')) {
      greetingText = "I am your **ET Prime Conversational BI Assistant**, designed to analyze live subscription, renewal, funnel, and pacing data.";
    }
    return {
      domain: 'META',
      text: `${greetingText}\n\nHow can I help you with your analytics today? You can ask me about **Subscription Revenue**, **Renewals & Recurring**, **Conversion Funnels**, or **Realtime Sales Pacing**.`,
      kpis: null,
      chart: null,
      table: null,
      suggestedFollowups: [
        "Can you compare Android vs iOS renewals for August and July?",
        "Give me funnel data for the last 7 days, day-wise",
        "Which platform leads sales?",
        "Show the realtime pacing forecast"
      ]
    };
  }

  // -------------------------------------------------------------------------
  // 0B. CAPABILITIES / META / GENERAL HELP INTERCEPTOR
  // -------------------------------------------------------------------------
  const isGeneralMeta = 
    q.includes('haww') ||
    q.includes('capabilities') || q.includes('how can you') ||
    q.includes('what can you') || q.includes('help') || q === 'help' || q.includes('options') ||
    q.includes('explain dashboard');

  if (isGeneralMeta) {
    return {
      domain: 'META',
      text: `I am your **ET Prime Conversational BI Assistant**. Every answer is computed from the data loaded in the dashboard, for any window you name (last 7 days, this month, August, yesterday) and any cut the feeds carry:\n\n` +
            `• **GTV & conversions**: by platform, plan, channel, sub-source, user type, country, marketing team, hour of day; daily trends; period comparisons (this week vs last week, August vs July).\n` +
            `• **ARPU**: by campaign theme, offer, sale status, marketing team, platform or plan; daily trend.\n` +
            `• **Renewals & recurring**: by platform, plan tenure, week, month; month comparisons; recurring share of fresh sales.\n` +
            `• **Acquisition funnel**: step conversion and leakage, platform / team / India-vs-international splits, day-wise, 7 vs 30 days.\n` +
            `• **Realtime**: today's purchases and EOD projection vs the 4-week same-weekday or last-7-day benchmark, by platform or team.\n\n` +
            `Try: *"Telecalling GTV for the last 7 days"*, *"ARPU by campaign theme this month"*, *"India vs international funnel"*, *"Compare this week vs last week GTV"*.`,
      kpis: null,
      chart: null,
      table: null,
      suggestedFollowups: [
        "Can you compare Android vs iOS renewals for August and July?",
        "Give me funnel data for the last 7 days, day-wise",
        "Which platform leads sales?",
        "What is the renewal rate for July'26?"
      ]
    };
  }

  // -------------------------------------------------------------------------
  // 1. DOMAIN ROUTER ENGINE (with Active Domain Context Continuity)
  // -------------------------------------------------------------------------
  const domain = routeQueryDomain(q, activeDomain);

  let rawResult;
  switch (domain) {
    case 'DATA_OVERVIEW':
      rawResult = processDataOverviewDomain(rawQuery, contextData);
      break;
    case 'REALTIME':
      rawResult = processRealtimeDomain(q, contextData);
      break;
    case 'FUNNEL':
      rawResult = processFunnelDomain(q, funnelData);
      break;
    case 'RENEWALS':
      rawResult = processRenewalsDomain(q, renewalsData, contextData);
      break;
    case 'SUBSCRIPTION':
      rawResult = processSubscriptionDomain(q, subscriptionData, contextData);
      break;
    case 'ARPU':
      rawResult = processArpuDomain(q, contextData);
      break;
    case 'UNKNOWN':
    default:
      rawResult = {
        domain: 'CLARIFICATION',
        text: `I couldn't match **"${rawQuery}"** to a specific ledger metric or topic.\n\n` +
              `Could you please rephrase or specify what data you are looking for?\n\n` +
              `• **Renewals & Recurring**: e.g., *"August renewals weekly trend"* or *"Compare August vs July renewals"*\n` +
              `• **User Acquisition Funnel**: e.g., *"Last 7 days funnel breakdown day wise"*\n` +
              `• **Subscription & Revenue**: e.g., *"Which platform leads sales?"* or *"iOS revenue last 7 days"*\n` +
              `• **Realtime Sales Pacing**: e.g., *"Show today's sales forecast"`,
        kpis: null,
        chart: null,
        table: null,
        suggestedFollowups: [
          "Can you compare Android vs iOS renewals for August and July?",
          "Give me funnel data for the last 7 days, day-wise",
          "Which platform leads sales?",
          "Show the realtime pacing forecast"
        ]
      };
      break;
  }

  // -------------------------------------------------------------------------
  // 2. REQUIREMENT VERIFICATION GUARD
  // -------------------------------------------------------------------------
  return verifyAndEnforceRequirementMatch(rawResult, rawQuery, contextData);
}

/**
 * Classifies query into one of 5 domain coverage maps using fuzzy token matching
 */
export function routeQueryDomain(q, activeDomain = null) {
  // 0. Overview / Meta data inquiries
  if (
    q.includes('what kind of data') ||
    q.includes('what data') ||
    q.includes('what can you do') ||
    q.includes('data do you have') ||
    q.includes('tell me about your data') ||
    q.includes('tell me about the data') ||
    q.includes('data available') ||
    q.includes('overview of data') ||
    q.includes('data brief') ||
    q.includes('dataset') ||
    q.includes('datasets') ||
    q.includes('schema') ||
    q.includes('capabilities') ||
    q.includes('what metrics')
  ) {
    return 'DATA_OVERVIEW';
  }

  // 1. Explicit domain triggers (User explicitly asks about another tab)
  const mentionsRealtime = fuzzyContains(q, ['realtime', 'pacing', 'hourly', 'forecast', 'eod', 'pacng', 'pasing']) || q.includes("today's sales") || q.includes("today's purchase") || q.includes("today purchases") || q.includes("today's performance") || q.includes("performance for today") || q.includes("today's funnel") || (q.includes('today') && (q.includes('funnel') || q.includes('performance') || q.includes('purchase')));
  const mentionsFunnel = fuzzyContains(q, ['funnel', 'funel', 'dau', 'paywall', 'paywal', 'paywalling', 'pageload', 'dropoff']) || q.includes('drop off') || q.includes('drop-off');
  const mentionsRenewals = fuzzyContains(q, ['renewal', 'renewals', 'renewed', 'renew', 'renews', 'renewing']) || q.includes('renewal rate') || q.includes('recurring cohort') || q.includes('auto-renew') || q.includes('monthly renewal') || (q.includes('renewal') && !q.includes('revenue') && !q.includes('split') && !q.includes('user'));
  const mentionsSubscription = fuzzyContains(q, ['subscription', 'revenue', 'conversions', 'sales', 'arpu', 'mweb', 'gtv', 'channel', 'roas', 'spend', 'campaign', 'tenure', 'sell', 'selling', 'sold']) || q.includes('sales platform') || q.includes('new vs renewal') || q.includes('plan revenue') || /\bgtv\b|\bchannel\b|\bcampaign|\broas\b|\bspend\b|user[\s-]?type|txn[\s-]?type|time of day|peak (hour|time)|hour of day/.test(q);
  // A revenue / GTV split by user type is a ledger question even though it says "renewal"
  const subscriptionSplit = mentionsSubscription && /new vs|user[\s-]?type|txn[\s-]?type|(revenue|gtv|sales) split/.test(q);

  const mentionsArpu = /\barpu\b|average revenue per|campaign theme|\btheme\b|\boffer\b|sale status|\byield\b/.test(q);

  // PRIORITY: live-data words (today, pacing, forecast, hourly) win over everything else
  if (mentionsRealtime) return 'REALTIME';
  if (mentionsArpu && !mentionsFunnel && !mentionsRenewals) return 'ARPU';
  if (subscriptionSplit) return 'SUBSCRIPTION';

  // If user explicitly asks for a domain, route accordingly:
  if (mentionsFunnel && !mentionsSubscription) return 'FUNNEL';
  if (mentionsRenewals && !mentionsSubscription) return 'RENEWALS';
  if (mentionsSubscription && !mentionsFunnel && !mentionsRenewals) return 'SUBSCRIPTION';

  // 2. CONVERSATIONAL CONTEXT CONTINUITY:
  // If user is currently analyzing a particular tab and didn't explicitly ask for another tab, STAY in that tab!
  if (activeDomain && ['SUBSCRIPTION', 'FUNNEL', 'RENEWALS', 'REALTIME', 'ARPU'].includes(activeDomain)) {
    console.log(`🧭 [Domain Continuity] Retaining active tab context: "${activeDomain}"`);
    return activeDomain;
  }

  // 3. Independent fallbacks when no prior context exists:
  if (mentionsRealtime) return 'REALTIME';
  if (mentionsFunnel) return 'FUNNEL';
  if (mentionsRenewals) return 'RENEWALS';
  if (mentionsSubscription || q.includes('plan') || q.includes('1 year') || q.includes('1 month') || q.includes('ios') || q.includes('android')) return 'SUBSCRIPTION';

  return 'UNKNOWN';
}

/**
 * Universal Regex Date Range Extractor
 * Handles custom number of days (e.g. 5 days, 15 days, 45 days, 10 days, 3 days, etc.)
 */
function extractDaysFromQuery(q) {
  // Matches "last 5 days", "5 days", "15 days", "45d", etc.
  const match = q.match(/(\d+)\s*days?/i) || q.match(/(?:last|past|in|for)\s*(\d+)/i) || q.match(/(\d+)\s*d\b/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
      return parsed; // Returns custom day count (5, 15, 45, etc.)
    }
  }

  if (q.includes('yesterday') || q.includes('1 day')) return 1;
  if (q.includes('week') || q.includes('last week')) return 7;
  if (q.includes('2 weeks') || q.includes('fortnight')) return 14;
  if (q.includes('quarter')) return 90;
  if (q.includes('today') || q.includes('realtime') || q.includes('live')) return 0;

  return 30; // Default fallback
}

function parseDateStrToMs(dateStr) {
  if (!dateStr) return 0;
  if (typeof dateStr === 'string') {
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime();
      }
    } else if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10)).getTime();
      }
    }
  }
  return new Date(dateStr).getTime() || 0;
}

function matchPlatformName(targetList, rowPlatform) {
  if (!rowPlatform) return false;
  if (!targetList || targetList.length === 0 || targetList.includes('Overall') || targetList.includes('All')) return true;
  
  const cleanRowPlat = String(rowPlatform).toLowerCase().replace(/[^a-z0-9]/g, '');
  return targetList.some(target => {
    const cleanTarget = String(target).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanRowPlat === cleanTarget) return true;
    if (cleanTarget === 'ios' || cleanTarget === 'mainios' || cleanTarget === 'marketios') {
      if (cleanRowPlat.includes('ios')) return true;
    }
    if (cleanTarget === 'android' || cleanTarget === 'mainandroid' || cleanTarget === 'marketandroid') {
      if (cleanRowPlat.includes('android')) return true;
    }
    if (cleanTarget === 'mweb' || cleanTarget === 'wap') {
      if (cleanRowPlat.includes('mweb') || cleanRowPlat.includes('wap')) return true;
    }
    return cleanRowPlat.includes(cleanTarget) || cleanTarget.includes(cleanRowPlat);
  });
}

// Helper function to guarantee N date strings even if dataset is empty/loading
function getTargetDates(data = [], days = 30) {
  const targetDays = days > 0 ? days : 7;
  let dates = [];

  if (data && data.length > 0) {
    const unique = [...new Set(data.map(r => r.dateStr).filter(Boolean))];
    if (unique.length > 0) {
      dates = unique.sort((a,b) => parseDateStrToMs(b) - parseDateStrToMs(a)).slice(0, targetDays).reverse();
    }
  }

  if (!dates || dates.length === 0) {
    const today = new Date();
    const fallbackDates = [];
    for (let i = targetDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      fallbackDates.push(d.toISOString().split('T')[0]);
    }
    dates = fallbackDates;
  }

  return dates;
}

// =========================================================================
// 🌟 DOMAIN 0: DATA OVERVIEW & CATALOG PROCESSOR
// =========================================================================
// =========================================================================
// DOMAIN ANSWERS — computed from the loaded datasets (see engineAnswers.js)
// =========================================================================
function processDataOverviewDomain(rawQuery, contextData = {}) {
  return answerDataOverview(rawQuery, contextData);
}

function processRealtimeDomain(q, contextData = {}) {
  return answerRealtime(q, contextData);
}

export function processFunnelDomain(q, funnelData = []) {
  return answerFunnel(q, funnelData);
}

export function processRenewalsDomain(q, renewalsData = [], contextData = {}) {
  return answerRenewals(q, { ...contextData, renewalsData });
}

export function processSubscriptionDomain(q, subscriptionData = [], contextData = {}) {
  return answerSubscription(q, { ...contextData, subscriptionData });
}

function processArpuDomain(q, contextData = {}) {
  return answerArpu(q, contextData);
}

// =========================================================================
// 📅 UNIVERSAL DATE PARSER — resolves "yesterday", exact dates, months, ranges
// =========================================================================

/**
 * Parses a query string and allDates array to determine the exact date(s) requested.
 * Returns { dates: string[], isSingleDate: boolean, label: string, type: 'single'|'month'|'range'|'all' }
 */
export function parseSpecificDateOrRange(query, allDates = []) {
  if (!allDates || allDates.length === 0) {
    return { dates: [], isSingleDate: false, label: query, type: 'all' };
  }

  const sorted = [...allDates].sort();
  const latestDate = sorted[sorted.length - 1]; // e.g. "2026-09-05"
  const q = (query || '').toLowerCase().trim();

  // Helper: subtract N days from a date string "YYYY-MM-DD"
  function subtractDays(dateStr, n) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    d.setDate(d.getDate() - n);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Helper: format date string to readable label
  function formatDateLabel(dateStr) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      const mon = months[parseInt(parts[1], 10) - 1] || parts[1];
      return `${day} ${mon} ${parts[0]}`;
    }
    return dateStr;
  }

  // 1. RELATIVE DATE RESOLUTION: "yesterday", "today", "day before yesterday"
  if (q.includes('yesterday') && !q.includes('day before')) {
    // "yesterday" = the latest closed date in the dataset
    const targetDate = latestDate;
    const found = sorted.filter(d => d === targetDate);
    return {
      dates: found.length > 0 ? found : [targetDate],
      isSingleDate: true,
      label: `Yesterday (${formatDateLabel(targetDate)})`,
      type: 'single'
    };
  }

  if (q.includes('day before yesterday')) {
    const targetDate = subtractDays(latestDate, 1);
    const found = sorted.filter(d => d === targetDate);
    return {
      dates: found.length > 0 ? found : [targetDate],
      isSingleDate: true,
      label: `Day Before Yesterday (${formatDateLabel(targetDate)})`,
      type: 'single'
    };
  }

  if (q.includes('today') && !q.includes('last') && !q.includes('days')) {
    // "today" in the context of subscription/funnel data = latestDate
    const targetDate = latestDate;
    const found = sorted.filter(d => d === targetDate);
    return {
      dates: found.length > 0 ? found : [targetDate],
      isSingleDate: true,
      label: `Today (${formatDateLabel(targetDate)})`,
      type: 'single'
    };
  }

  // 2. EXPLICIT DATE RESOLUTION: "5th september", "september 5", "5 sep", "2026-09-05"
  const monthNames = {
    'january': '01', 'jan': '01', 'february': '02', 'feb': '02', 'march': '03', 'mar': '03',
    'april': '04', 'apr': '04', 'may': '05', 'june': '06', 'jun': '06',
    'july': '07', 'jul': '07', 'august': '08', 'aug': '08',
    'september': '09', 'sep': '09', 'sept': '09',
    'october': '10', 'oct': '10', 'november': '11', 'nov': '11', 'december': '12', 'dec': '12'
  };

  // Check for explicit YYYY-MM-DD format
  const isoMatch = q.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const targetDate = isoMatch[0];
    const found = sorted.filter(d => d === targetDate);
    return {
      dates: found.length > 0 ? found : [targetDate],
      isSingleDate: true,
      label: formatDateLabel(targetDate),
      type: 'single'
    };
  }

  // Check for "Nth month" or "month Nth" patterns (e.g. "5th september", "september 5", "5 sep")
  const datePatterns = [
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(\w+)/i,  // "5th september", "5 sep", "5th of sep"
    /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/i               // "september 5", "sep 5th"
  ];

  for (const pat of datePatterns) {
    const m = q.match(pat);
    if (m) {
      let dayStr, monthStr;
      if (/^\d+$/.test(m[1].replace(/(?:st|nd|rd|th)$/i, ''))) {
        dayStr = m[1].replace(/(?:st|nd|rd|th)$/i, '');
        monthStr = m[2].toLowerCase();
      } else {
        monthStr = m[1].toLowerCase();
        dayStr = m[2].replace(/(?:st|nd|rd|th)$/i, '');
      }

      const monthNum = monthNames[monthStr];
      if (monthNum) {
        const dayNum = parseInt(dayStr, 10);
        if (dayNum >= 1 && dayNum <= 31) {
          // Infer year from dataset
          const year = latestDate.split('-')[0] || '2026';
          const targetDate = `${year}-${monthNum}-${String(dayNum).padStart(2, '0')}`;
          const found = sorted.filter(d => d === targetDate);
          return {
            dates: found.length > 0 ? found : [targetDate],
            isSingleDate: true,
            label: formatDateLabel(targetDate),
            type: 'single'
          };
        }
      }
    }
  }

  // 3. MONTH QUERY RESOLUTION: "september", "august", "in september", "for the month of september"
  // Only trigger if not already a range query like "last 7 days"
  if (!q.match(/last\s+\d+\s*day/i) && !q.match(/\d+\s*day/i)) {
    for (const [monthWord, monthNum] of Object.entries(monthNames)) {
      if (monthWord.length >= 3 && q.includes(monthWord)) {
        // Check that it's a standalone month mention, not part of a specific date we already caught above
        const monthDates = sorted.filter(d => {
          const parts = d.split('-');
          return parts[1] === monthNum;
        });

        if (monthDates.length > 0) {
          const monthLabel = monthWord.charAt(0).toUpperCase() + monthWord.slice(1);
          return {
            dates: monthDates,
            isSingleDate: false,
            label: `${monthLabel} 2026`,
            type: 'month'
          };
        }
      }
    }
  }

  // 4. RELATIVE RANGE: "last 7 days", "last 30 days", "last N days"
  const rangeMatch = q.match(/(?:last|past)\s+(\d+)\s*days?/i) || q.match(/(\d+)\s*days?\s*(?:data|revenue|trend|wise)?/i);
  if (rangeMatch) {
    const n = parseInt(rangeMatch[1], 10);
    if (n > 0 && n <= 365) {
      const sliced = sorted.slice(-n);
      return {
        dates: sliced,
        isSingleDate: n === 1,
        label: `Last ${n} days`,
        type: n === 1 ? 'single' : 'range'
      };
    }
  }

  // 5. Fallback: return all dates
  return { dates: sorted, isSingleDate: false, label: query, type: 'all' };
}

// =========================================================================
// 🤖 GEMINI 2.0 FLASH AGENT TOOL EXECUTION DISPATCHER
// =========================================================================

export function executeToolByName(name, args = {}, contextData = {}) {
  switch (name) {
    case 'query_renewals':
      return executeRenewalsTool(args, contextData);
    case 'query_funnel':
      return executeFunnelTool(args, contextData);
    case 'query_subscription':
      return executeSubscriptionTool(args, contextData);
    case 'query_realtime':
      return executeRealtimeTool(args, contextData);
    case 'query_general_qa':
      return executeGeneralQATool(args, contextData);
    default:
      return { status: "unknown_tool", message: `Tool '${name}' is not recognized.` };
  }
}

// Helpers for flexible platform and plan category matching
function isPlatformMatch(rowPlat, targetPlat) {
  if (!targetPlat || targetPlat.toLowerCase() === 'all' || targetPlat.toLowerCase() === 'all platforms') return true;
  const t = String(targetPlat).toLowerCase().replace(/[\s\-_]/g, '');
  const r = String(rowPlat || '').toLowerCase().replace(/[\s\-_]/g, '');
  if (r === t || r.includes(t) || t.includes(r)) return true;
  if (t.includes('ios') && r.includes('ios')) return true;
  if (t.includes('android') && r.includes('android')) return true;
  if ((t.includes('wap') || t.includes('mweb')) && (r.includes('wap') || r.includes('mweb'))) return true;
  if ((t.includes('web') || t.includes('desktop')) && (r.includes('web') || r.includes('desktop'))) return true;
  return false;
}

function matchPlanName(rowPlan, targetPlan) {
  if (!targetPlan || targetPlan.toLowerCase() === 'all' || targetPlan.toLowerCase() === 'all plans') return true;
  const t = String(targetPlan).toLowerCase().replace(/\s+/g, ' ').trim();
  const r = String(rowPlan || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return r === t || r.includes(t) || t.includes(r);
}

export function executeRenewalsTool(args = {}, contextData = {}) {
  const { renewalsData = [] } = contextData;
  if (!renewalsData || renewalsData.length === 0) {
    return { status: "data_unavailable", message: "Renewals dataset is not loaded yet. Please wait for the dashboard to finish loading and try again." };
  }
  const period = String(args.period || '').trim();
  const platform = String(args.platform || 'All').trim();
  const planCategory = String(args.planCategory || 'All').trim();
  const granularity = String(args.granularity || '').trim().toLowerCase();
  const lower = period.toLowerCase();
  const wanted = /^(all|overall|combined)?$/i.test(platform) ? [] : platformsWanted(platform);
  const applyFilters = (recs) => filterPlatforms(recs, wanted).filter(r => matchPlanName(r.plan_category, planCategory));
  const shape = (recs) => {
    const a = renewalsAgg(recs);
    return {
      due: a.due, renewed: a.renewed, rate: fmtPct(a.rate),
      platforms: renewalsByPlatform(recs).map(x => ({ platform: x.name, due: x.due, renewed: x.renewed, rate: fmtPct(x.rate) })),
      plans: renewalsByPlan(recs).map(x => ({ planCategory: x.name, due: x.due, renewed: x.renewed, rate: fmtPct(x.rate) })),
    };
  };

  // Month-by-month across everything loaded
  if (granularity === 'monthly_trend' || (/trend|all months|month[\s-]?wise|monthly|range|since|till now/.test(lower) && !/\bvs\b|compare|versus/.test(lower))) {
    const months = renewalsByMonth(applyFilters(renewalsData)).map(m => ({ period: m.label, due: m.due, renewed: m.renewed, rate: fmtPct(m.rate) }));
    return { query_period: period, type: "monthly_trend", platform, planCategory, months };
  }

  // Two months compared: the ones named, else the latest two
  if (granularity === 'comparison' || /\bvs\b|compare|versus/.test(lower)) {
    const [a, b] = comparisonMonths(period, renewalsData, 'renew_date');
    if (!a || !b) return { status: "data_unavailable", message: "Not enough months loaded to compare." };
    return {
      query_period: period, type: "comparison", platform, planCategory,
      periods: [
        { period: a.label, ...shape(applyFilters(a.records)) },
        { period: b.label, ...shape(applyFilters(b.records)) },
      ],
    };
  }

  // A single window: a named month, "last 30 days", yesterday... (default: last 30 days)
  const w = resolveWindow(period || 'last 30 days', renewalsData, 'renew_date', { defaultDays: 30 });
  const recs = applyFilters(w.records);
  if (!recs.length) return { status: "data_unavailable", message: `No renewal rows for ${w.label}${wanted.length ? ' on the requested platform' : ''}.` };
  const base = { query_period: period, period: w.label, window: { start: w.start, end: w.end }, platform, planCategory };

  if (granularity === 'daily' || /day[\s-]?wise|daily/.test(lower)) {
    const daily = renewalsDaily(recs).map(d => ({ date: d.date, due: d.due, renewed: d.renewed, rate: fmtPct(d.rate) }));
    const a = shape(recs);
    return { ...base, type: "daily_trend", metrics: { period: w.label, due: a.due, renewed: a.renewed, rate: a.rate }, dailyBreakdown: daily, platformBreakdown: a.platforms, planBreakdown: a.plans };
  }
  const a = shape(recs);
  const type = granularity === 'plan_breakdown' || /plan[\s-]?wise|plan category|1 month vs 1 year|1 year vs 1 month/.test(lower) ? "plan_breakdown" : "platform_breakdown";
  return { ...base, type, metrics: { period: w.label, due: a.due, renewed: a.renewed, rate: a.rate }, platformBreakdown: a.platforms, planBreakdown: a.plans };
}

export function executeFunnelTool(args = {}, contextData = {}) {
  const { funnelData = [] } = contextData;

  if (!funnelData || funnelData.length === 0) {
    return { status: "data_unavailable", message: "Funnel dataset is not loaded yet. Please wait for the dashboard to finish loading and try again." };
  }

  const platformArg = (args.platform || 'Combined').trim();
  const datePreset = (args.datePreset || args.dateRange || 'Last 30 days').trim();
  const marketingTeam = (args.marketingTeam || 'Overall').trim();
  const countryArg = (args.country || 'Overall').trim();
  const granularity = (args.granularity || 'aggregate').trim().toLowerCase();

  // Date filtering logic — use universal date parser
  const allDates = Array.from(new Set(funnelData.map(r => r.dateStr || '').filter(Boolean))).sort();
  const dateInfo = parseSpecificDateOrRange(datePreset, allDates);
  const allowedDates = new Set(dateInfo.dates.length > 0 ? dateInfo.dates : allDates);

  // ─── CRITICAL DIMENSION FILTERING RULES ───
  // The funnel sheet has MULTIPLE rows per date for every combination of:
  //   view_type × ET_Platform × Country × Marketing_team
  //
  // The SINGLE true aggregate row per date is:
  //   view_type="Overall", ET_Platform="Combined", Country="Overall", Marketing_team="Overall"
  //
  // Unless the user explicitly asks for a specific platform, country, or marketing team,
  // we MUST filter to these defaults to avoid double/quadruple counting.

  const isOverall = platformArg.toLowerCase() === 'combined' || platformArg.toLowerCase() === 'overall';
  const isPlatformBreakdown = platformArg.toLowerCase() === 'breakdown' || 
                              platformArg.toLowerCase().includes('all platform') || 
                              platformArg.toLowerCase().includes('platform-wise') ||
                              platformArg.toLowerCase().includes('platform wise') ||
                              granularity === 'platform_breakdown';
  const isSpecificPlatform = !isOverall && !isPlatformBreakdown;

  // Determine marketing team filter
  const mTeamLower = marketingTeam.toLowerCase();
  const isSpecificMktTeam = mTeamLower !== 'all' && mTeamLower !== 'overall';

  // Determine country filter
  const countryLower = countryArg.toLowerCase();
  const isSpecificCountry = countryLower !== 'all' && countryLower !== 'overall';

  // Helper: check if a dimension value matches "Overall" (aggregate)
  function isOverallValue(val) {
    const v = String(val || '').trim().toLowerCase();
    return v === 'overall' || v === '' || v === 'all';
  }

  // ─── STEP 1: Apply date filter ───
  let dateFiltered = funnelData.filter(r => {
    const dKey = r.dateStr || '';
    return allowedDates.size === 0 || allowedDates.has(dKey);
  });

  // ─── STEP 2: Apply dimension filters ───
  // For OVERALL / COMBINED queries (no specific platform, no specific team, no specific country):
  //   → Use the single aggregate row: view_type=Overall, ET_Platform=Combined, Country=Overall, Marketing_team=Overall
  //
  // For SPECIFIC PLATFORM queries (e.g. "MWeb funnel"):
  //   → Use view_type="By Platform", ET_Platform=<requested>, Country=Overall (or India), Marketing_team=Overall
  //
  // For PLATFORM BREAKDOWN queries:
  //   → Use view_type="By Platform", ET_Platform=<each individual>, Country=Overall, Marketing_team=Overall
  //
  // For SPECIFIC MARKETING TEAM queries:
  //   → Use view_type=Overall, ET_Platform=Combined, Country=Overall/India, Marketing_team=<requested>

  function filterRows(rows, { viewType, etPlatform, country, mktTeam }) {
    return rows.filter(r => {
      const rViewType = String(r.viewType || r.view_type || '').trim().toLowerCase();
      const rPlatform = String(r.ET_Platform || r.platform || '').trim();
      const rCountry = String(r.country || r.Country || '').trim().toLowerCase();
      const rMktTeam = String(r.marketingTeam || r.Marketing_team || '').trim().toLowerCase();

      // View type filter
      if (viewType === 'overall' && rViewType !== 'overall') return false;
      if (viewType === 'by platform' && !rViewType.includes('platform')) return false;

      // Platform filter
      if (etPlatform === 'Combined') {
        if (rPlatform !== 'Combined') return false;
      } else if (etPlatform === '__exclude_combined__') {
        if (rPlatform === 'Combined') return false;
      } else if (etPlatform) {
        if (!isPlatformMatch(rPlatform, etPlatform)) return false;
      }

      // Country filter
      if (country === 'overall') {
        if (!isOverallValue(rCountry)) return false;
      } else if (country) {
        if (!rCountry.includes(country.toLowerCase())) return false;
      }

      // Marketing team filter
      if (mktTeam === 'overall') {
        if (!isOverallValue(rMktTeam)) return false;
      } else if (mktTeam) {
        if (!rMktTeam.includes(mktTeam.toLowerCase())) return false;
      }

      return true;
    });
  }

  // Determine the correct dimension filters for this query
  let overallRows, platformRows;

  if (isSpecificMktTeam) {
    // Marketing team split → view_type=Overall, ET_Platform=Combined, Country=Overall, Marketing_team=<specific>
    overallRows = filterRows(dateFiltered, { viewType: 'overall', etPlatform: 'Combined', country: isSpecificCountry ? countryLower : 'overall', mktTeam: mTeamLower });
    platformRows = []; // Not applicable for marketing team queries
  } else if (isSpecificPlatform) {
    // Specific platform → view_type="By Platform", ET_Platform=<specific>, Country=Overall, Marketing_team=Overall
    overallRows = filterRows(dateFiltered, { viewType: 'by platform', etPlatform: platformArg, country: isSpecificCountry ? countryLower : 'overall', mktTeam: 'overall' });
    platformRows = overallRows; // Same set
  } else if (isPlatformBreakdown) {
    // Platform breakdown → each individual platform, view_type="By Platform", Country=Overall, Marketing_team=Overall
    overallRows = filterRows(dateFiltered, { viewType: 'overall', etPlatform: 'Combined', country: isSpecificCountry ? countryLower : 'overall', mktTeam: 'overall' });
    platformRows = filterRows(dateFiltered, { viewType: 'by platform', etPlatform: '__exclude_combined__', country: isSpecificCountry ? countryLower : 'overall', mktTeam: 'overall' });
  } else {
    // Default overall → view_type=Overall, ET_Platform=Combined, Country=Overall, Marketing_team=Overall
    overallRows = filterRows(dateFiltered, { viewType: 'overall', etPlatform: 'Combined', country: isSpecificCountry ? countryLower : 'overall', mktTeam: 'overall' });
    platformRows = filterRows(dateFiltered, { viewType: 'by platform', etPlatform: '__exclude_combined__', country: isSpecificCountry ? countryLower : 'overall', mktTeam: 'overall' });
  }

  // Helper to extract clean funnel metrics from any row
  function extractFunnelRow(r) {
    return {
      dau: parseInt(r.DAU || r.dau || 0, 10) || 0,
      paywallHits: parseInt(r.paywalling_hits || r.paywall_hits || r.paywall_hit || 0, 10) || 0,
      planPageLoads: parseInt(r.Plan_Page_Loaded || r.Plan_Page_Load || r.plan_page_loads || 0, 10) || 0,
      planSelected: parseInt(r.Plan_Selected || 0, 10) || 0,
      payInitiated: parseInt(r.Pay_Initiated || 0, 10) || 0,
      purchased: parseInt(r.Purchased || r.purchased || r.purchases || 0, 10) || 0
    };
  }

  // Helper to aggregate rows
  function sumFunnelRows(rows) {
    let dau = 0, hits = 0, loads = 0, selected = 0, initiated = 0, purchased = 0;
    const dates = new Set();
    rows.forEach(r => {
      const m = extractFunnelRow(r);
      dau += m.dau;
      hits += m.paywallHits;
      loads += m.planPageLoads;
      selected += m.planSelected;
      initiated += m.payInitiated;
      purchased += m.purchased;
      if (r.dateStr) dates.add(r.dateStr);
    });
    const days = dates.size || 1;
    const dailyAvgDAU = Math.round(dau / days);
    const paywallHitRate = dau > 0 ? ((hits / dau) * 100).toFixed(2) + '%' : '0.00%';
    const pageLoadToPurchaseConv = loads > 0 ? ((purchased / loads) * 100).toFixed(2) + '%' : '0.00%';
    const dauToPurchaseConv = dau > 0 ? ((purchased / dau) * 100).toFixed(4) + '%' : '0.0000%';

    return {
      totalDAU: dau,
      totalPaywallHits: hits,
      totalPlanPageLoads: loads,
      totalPlanSelected: selected,
      totalPayInitiated: initiated,
      totalPurchases: purchased,
      dailyAvgDAU: dailyAvgDAU >= 1000000 ? (dailyAvgDAU / 1000000).toFixed(2) + 'M users/day' : dailyAvgDAU.toLocaleString() + ' users/day',
      paywallHitRate: paywallHitRate + ' of DAU (~' + Math.round(hits / days).toLocaleString() + ' hits/day)',
      pageLoadToPurchaseConv,
      dauToPurchaseConv,
      totalDays: days
    };
  }

  // 1. Daily breakdown (only when not specifically requesting a platform-wise breakdown)
  const isDaily = !isPlatformBreakdown && (granularity === 'daily' || datePreset.toLowerCase().includes('day wise') || datePreset.toLowerCase().includes('daily'));
  if (isDaily) {
    const targetRows = isSpecificPlatform ? overallRows : overallRows;
    const dateMap = {};

    targetRows.forEach(r => {
      const d = r.dateStr || 'Unknown';
      if (!dateMap[d]) dateMap[d] = { date: d, dau: 0, hits: 0, loads: 0, selected: 0, initiated: 0, purchased: 0 };
      const m = extractFunnelRow(r);
      dateMap[d].dau += m.dau;
      dateMap[d].hits += m.paywallHits;
      dateMap[d].loads += m.planPageLoads;
      dateMap[d].selected += m.planSelected;
      dateMap[d].initiated += m.payInitiated;
      dateMap[d].purchased += m.purchased;
    });

    const dailyBreakdown = Object.keys(dateMap).sort().map(d => {
      const entry = dateMap[d];
      return {
        date: d,
        dau: entry.dau,
        paywallHits: entry.hits,
        paywallingHits: entry.hits, // synonym support
        planPageLoads: entry.loads,
        planSelected: entry.selected,
        payInitiated: entry.initiated,
        purchased: entry.purchased,
        paywallHitRate: entry.dau > 0 ? ((entry.hits / entry.dau) * 100).toFixed(2) + '%' : '0.00%',
        conversionRate: entry.loads > 0 ? ((entry.purchased / entry.loads) * 100).toFixed(2) + '%' : '0.00%'
      };
    });

    const agg = sumFunnelRows(targetRows);

    return {
      timeframe: datePreset,
      platform: isSpecificPlatform ? platformArg : 'Combined (Overall)',
      granularity: "daily",
      totals: agg,
      dailyBreakdown
    };
  }

  // 2. Specific Platform or Platform Breakdown
  let chosenRows = overallRows;
  let chosenPlatformLabel = isSpecificPlatform ? platformArg : 'Combined (Overall)';

  const agg = sumFunnelRows(chosenRows.length > 0 ? chosenRows : dateFiltered);

  // Compute per-platform breakdown from individual platform rows (avoiding Combined duplicate)
  const platMap = {};
  platformRows.forEach(r => {
    const p = r.platform || r.ET_Platform || 'Other';
    if (!platMap[p]) platMap[p] = { dau: 0, hits: 0, loads: 0, selected: 0, initiated: 0, purchases: 0 };
    const m = extractFunnelRow(r);
    platMap[p].dau += m.dau;
    platMap[p].hits += m.paywallHits;
    platMap[p].loads += m.planPageLoads;
    platMap[p].selected += m.planSelected;
    platMap[p].initiated += m.payInitiated;
    platMap[p].purchases += m.purchased;
  });

  const platformBreakdown = Object.keys(platMap).map(p => ({
    platform: p,
    dau: platMap[p].dau,
    hits: platMap[p].hits,
    paywallHits: platMap[p].hits,
    pageLoads: platMap[p].loads,
    planPageLoads: platMap[p].loads,
    purchases: platMap[p].purchases,
    convRate: platMap[p].loads > 0 ? ((platMap[p].purchases / platMap[p].loads) * 100).toFixed(2) + '%' : '0.00%'
  }));

  return {
    timeframe: datePreset,
    platform: chosenPlatformLabel,
    dailyAvgDAU: agg.dailyAvgDAU,
    paywallHitRate: agg.paywallHitRate,
    pageLoadToPurchaseConv: agg.pageLoadToPurchaseConv,
    dauToPurchaseConv: agg.dauToPurchaseConv,
    totalDAU: agg.totalDAU,
    totalPaywallHits: agg.totalPaywallHits,
    totalPageLoads: agg.totalPlanPageLoads,
    totalPlanSelected: agg.totalPlanSelected,
    totalPayInitiated: agg.totalPayInitiated,
    totalPurchases: agg.totalPurchases,
    totalDays: agg.totalDays,
    platformBreakdown
  };
}

export function executeSubscriptionTool(args = {}, contextData = {}) {
  const { subscriptionData = [] } = contextData;

  if (!subscriptionData || subscriptionData.length === 0) {
    return { status: "data_unavailable", message: "Subscription dataset is not loaded yet. Please wait for the dashboard to finish loading and try again." };
  }

  const platformArg = (args.platform || 'All').trim();
  const datePreset = (args.datePreset || args.dateRange || 'Last 30 days').trim();
  const userTxnType = (args.userTxnType || 'All').trim().toLowerCase();
  const planCategory = (args.planCategory || 'All').trim();
  const granularity = (args.granularity || 'aggregate').trim().toLowerCase();

  // Date filtering — use universal date parser
  const allDates = Array.from(new Set(subscriptionData.map(r => r.dateStr || '').filter(Boolean))).sort();
  const dateInfo = parseSpecificDateOrRange(datePreset, allDates);
  const allowedDates = new Set(dateInfo.dates.length > 0 ? dateInfo.dates : allDates);

  const filtered = subscriptionData.filter(r => {
    if (allowedDates.size > 0 && !allowedDates.has(r.dateStr)) return false;
    if (!isPlatformMatch(r.platform || r.rawPlatform, platformArg)) return false;
    if (!matchPlanName(r.plan_category, planCategory)) return false;

    // Txn Type filter
    if (userTxnType !== 'all') {
      const txn = String(r.user_txn_type || '').toLowerCase();
      if (userTxnType === 'new' && txn !== 'new') return false;
      if (userTxnType.includes('renew') && !txn.includes('renewal')) return false;
      if (userTxnType === 'manual_renewal' && txn !== 'manual_renewal') return false;
      if (userTxnType === 'auto_renewal' && txn !== 'auto_renewal') return false;
    }
    return true;
  });

  // Aggregate metrics
  let totalRevenue = 0, totalConversions = 0;
  const platformMap = {};
  const txnTypeMap = {};
  const planMap = {};
  const dateMap = {};

  filtered.forEach(r => {
    const rev = parseFloat(r.revenue) || parseFloat(r.net_amount) || 0;
    const conv = parseInt(r.conversions, 10) || parseInt(r.purchase_count, 10) || 1;
    const dateKey = r.dateStr || r.rawDate || '';
    const platName = r.platform || r.rawPlatform || 'Other';
    const txnType = r.user_txn_type || 'other';
    const plan = r.plan_category || 'Unknown';

    totalRevenue += rev;
    totalConversions += conv;

    if (!platformMap[platName]) platformMap[platName] = { revenue: 0, conversions: 0 };
    platformMap[platName].revenue += rev;
    platformMap[platName].conversions += conv;

    if (!txnTypeMap[txnType]) txnTypeMap[txnType] = { revenue: 0, conversions: 0 };
    txnTypeMap[txnType].revenue += rev;
    txnTypeMap[txnType].conversions += conv;

    if (!planMap[plan]) planMap[plan] = { revenue: 0, conversions: 0 };
    planMap[plan].revenue += rev;
    planMap[plan].conversions += conv;

    if (dateKey) {
      if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, revenue: 0, conversions: 0 };
      dateMap[dateKey].revenue += rev;
      dateMap[dateKey].conversions += conv;
    }
  });

  const days = Object.keys(dateMap).length || 1;
  const dailyAvg = totalRevenue / days;
  const avgPerTxn = totalConversions > 0 ? totalRevenue / totalConversions : 0;

  // Find top platform
  let topPlatform = 'N/A';
  let topRev = 0;
  for (const [p, v] of Object.entries(platformMap)) {
    if (v.revenue > topRev) { topRev = v.revenue; topPlatform = p; }
  }
  const topPct = totalRevenue > 0 ? ((topRev / totalRevenue) * 100).toFixed(0) : '0';

  // Format currency helpers
  const fmtCr = val => val >= 10000000 ? '₹' + (val / 10000000).toFixed(2) + ' Cr' : '₹' + (val / 100000).toFixed(2) + ' L';

  // 0. SINGLE DATE RETURN (yesterday, specific date, today)
  if (dateInfo.isSingleDate && dateInfo.dates.length > 0) {
    const targetDate = dateInfo.dates[0];
    const dailyBreakdown = Object.keys(dateMap).sort().map(d => ({
      date: d,
      revenue: dateMap[d].revenue,
      revenueFormatted: fmtCr(dateMap[d].revenue),
      conversions: dateMap[d].conversions,
      avgRevPerTxn: dateMap[d].conversions > 0 ? '₹' + Math.round(dateMap[d].revenue / dateMap[d].conversions).toLocaleString() : '₹0'
    }));

    // Platform breakdown for this single day
    const platformBreakdown = Object.keys(platformMap).map(p => ({
      platform: p,
      revenue: platformMap[p].revenue,
      revenueFormatted: fmtCr(platformMap[p].revenue),
      conversions: platformMap[p].conversions,
      share: totalRevenue > 0 ? ((platformMap[p].revenue / totalRevenue) * 100).toFixed(1) + '%' : '0.0%'
    }));

    // Txn type breakdown for this day
    const userTxnTypeBreakdown = Object.keys(txnTypeMap).map(t => ({
      userTxnType: t,
      revenue: txnTypeMap[t].revenue,
      revenueFormatted: fmtCr(txnTypeMap[t].revenue),
      conversions: txnTypeMap[t].conversions,
      share: totalRevenue > 0 ? ((txnTypeMap[t].revenue / totalRevenue) * 100).toFixed(1) + '%' : '0.0%'
    }));

    // Plan breakdown for this day
    const planBreakdown = Object.keys(planMap).map(p => ({
      planCategory: p,
      revenue: planMap[p].revenue,
      revenueFormatted: fmtCr(planMap[p].revenue),
      conversions: planMap[p].conversions,
      share: totalRevenue > 0 ? ((planMap[p].revenue / totalRevenue) * 100).toFixed(1) + '%' : '0.0%'
    }));

    return {
      isSingleDate: true,
      targetDate: targetDate,
      timeframe: dateInfo.label,
      platform: platformArg,
      userTxnType,
      planCategory,
      totalRevenue: fmtCr(totalRevenue),
      totalRevenueRaw: totalRevenue,
      totalConversions: totalConversions.toLocaleString(),
      avgRevPerTxn: totalConversions > 0 ? '₹' + (avgPerTxn / 1000).toFixed(2) + 'K' : '₹0',
      topSalesPlatform: topPlatform + ' (' + topPct + '% total volume)',
      platformBreakdown,
      userTxnTypeBreakdown,
      planBreakdown,
      dailyBreakdown
    };
  }

  // 1. Daily Breakdown
  const isDaily = granularity === 'daily' || datePreset.toLowerCase().includes('day wise') || datePreset.toLowerCase().includes('daily');
  if (isDaily) {
    const dailyBreakdown = Object.keys(dateMap).sort().map(d => ({
      date: d,
      revenue: dateMap[d].revenue,
      revenueFormatted: fmtCr(dateMap[d].revenue),
      conversions: dateMap[d].conversions,
      avgRevPerTxn: dateMap[d].conversions > 0 ? '₹' + Math.round(dateMap[d].revenue / dateMap[d].conversions).toLocaleString() : '₹0'
    }));

    return {
      timeframe: datePreset,
      platform: platformArg,
      userTxnType,
      planCategory,
      granularity: "daily",
      totals: {
        totalRevenue: fmtCr(totalRevenue),
        dailyAvgRevenue: '₹' + (dailyAvg / 100000).toFixed(2) + ' L/day',
        totalConversions: totalConversions.toLocaleString(),
        totalDays: days
      },
      dailyBreakdown
    };
  }

  // 2. Txn Type Breakdown (New User vs Renewal Split)
  const userTxnTypeBreakdown = Object.keys(txnTypeMap).map(t => ({
    userTxnType: t,
    revenue: txnTypeMap[t].revenue,
    revenueFormatted: fmtCr(txnTypeMap[t].revenue),
    conversions: txnTypeMap[t].conversions,
    share: totalRevenue > 0 ? ((txnTypeMap[t].revenue / totalRevenue) * 100).toFixed(1) + '%' : '0.0%'
  }));

  // 3. Plan Breakdown
  const planBreakdown = Object.keys(planMap).map(p => ({
    planCategory: p,
    revenue: planMap[p].revenue,
    revenueFormatted: fmtCr(planMap[p].revenue),
    conversions: planMap[p].conversions,
    share: totalRevenue > 0 ? ((planMap[p].revenue / totalRevenue) * 100).toFixed(1) + '%' : '0.0%'
  }));

  // 4. Platform Breakdown
  const platformBreakdown = Object.keys(platformMap).map(p => ({
    platform: p,
    revenue: platformMap[p].revenue,
    revenueFormatted: fmtCr(platformMap[p].revenue),
    conversions: platformMap[p].conversions,
    share: totalRevenue > 0 ? ((platformMap[p].revenue / totalRevenue) * 100).toFixed(1) + '%' : '0.0%'
  }));

  return {
    timeframe: datePreset,
    platform: platformArg,
    userTxnType,
    planCategory,
    totalRevenue: fmtCr(totalRevenue),
    totalRevenueRaw: totalRevenue,
    dailyAvgRevenue: '₹' + (dailyAvg / 100000).toFixed(2) + ' L/day',
    totalConversions: totalConversions.toLocaleString(),
    avgRevPerTxn: '₹' + (avgPerTxn / 1000).toFixed(2) + 'K',
    topSalesPlatform: topPlatform + ' (' + topPct + '% total volume)',
    platformBreakdown,
    userTxnTypeBreakdown,
    planBreakdown
  };
}

export function executeRealtimeTool(args = {}, contextData = {}) {
  const { realtimeData } = contextData;
  const platformArg = (args.platform || 'Combined').trim();

  // If realtimeData is an array of raw sheet records
  if (Array.isArray(realtimeData) && realtimeData.length > 0) {
    const isCombined = platformArg.toLowerCase() === 'combined' || platformArg.toLowerCase() === 'all' || platformArg.toLowerCase() === 'overall';

    // 1. Identify the latest date in the dataset (i.e. "Today")
    let maxDateObj = new Date(0);
    let todayDateStr = "";

    realtimeData.forEach(r => {
      const rawDate = r.event_date || r.dateStr || r.date || '';
      if (!rawDate) return;
      const d = new Date(rawDate);
      if (!isNaN(d.getTime()) && d > maxDateObj) {
        maxDateObj = d;
        todayDateStr = String(rawDate).trim();
      }
    });

    // 2. Filter to records for today and matching platform
    const todayRows = realtimeData.filter(r => {
      const rawDate = String(r.event_date || r.dateStr || r.date || '').trim();
      if (todayDateStr && rawDate !== todayDateStr) return false;
      const p = String(r.ET_Platform || r.platform || '').trim();
      if (isCombined) return p === 'Combined';
      return isPlatformMatch(p, platformArg);
    });

    let currentHour = -1;
    let todayPurchases = 0;
    let todayPageLoads = 0;
    let todayPayInitiated = 0;
    const hourMap = {};

    todayRows.forEach(r => {
      const evt = String(r.event_name || r.event || '').toLowerCase();
      const count = parseInt(r.event_count ?? r.count ?? 0, 10) || 0;
      const hr = parseInt(r.event_hour ?? r.hour ?? 0, 10);

      if (!isNaN(hr) && hr > currentHour) {
        currentHour = hr;
      }

      if (evt.includes('purchase')) {
        todayPurchases += count;
        if (!hourMap[hr]) hourMap[hr] = 0;
        hourMap[hr] += count;
      } else if (evt.includes('page load') || evt.includes('page_load')) {
        todayPageLoads += count;
      } else if (evt.includes('pay init') || evt.includes('pay_init')) {
        todayPayInitiated += count;
      }
    });

    // Run-rate projection based on hours elapsed today
    const hoursElapsed = currentHour >= 0 ? currentHour + 1 : 17;
    const projectedEOD = hoursElapsed > 0 ? Math.round(todayPurchases * (24 / hoursElapsed)) : todayPurchases;

    // Fill hourly breakdown up to currentHour
    const hourlyBreakdown = [];
    const maxHourToDisplay = currentHour >= 0 ? currentHour : 23;
    for (let h = 0; h <= maxHourToDisplay; h++) {
      hourlyBreakdown.push({
        hour: `${String(h).padStart(2, '0')}:00`,
        purchases: hourMap[h] || 0,
        count: hourMap[h] || 0
      });
    }

    const displayHour = currentHour >= 0 ? `${String(currentHour).padStart(2, '0')}:00` : 'Live';

    return {
      timeframe: todayDateStr ? `Today (${todayDateStr} as of ${displayHour})` : 'Today',
      todayDate: todayDateStr,
      currentHour: displayHour,
      platform: isCombined ? 'Combined (Overall)' : platformArg,
      todayPurchases: todayPurchases.toLocaleString(),
      todayPurchasesNum: todayPurchases,
      projectedEOD: projectedEOD.toLocaleString(),
      totalPlanPageLoads: todayPageLoads.toLocaleString(),
      totalPayInitiated: todayPayInitiated.toLocaleString(),
      conversionRate: todayPageLoads > 0 ? ((todayPurchases / todayPageLoads) * 100).toFixed(2) + '%' : '0.00%',
      hourlyBreakdown
    };
  }

  // Precomputed realtime stats fallback
  if (realtimeData && typeof realtimeData === 'object' && !Array.isArray(realtimeData)) {
    return {
      platform: platformArg,
      todayPurchases: (realtimeData.todayPurchases ?? 'N/A').toLocaleString(),
      projectedEOD: (Math.round(realtimeData.projectedTotal ?? 0) || 'N/A').toLocaleString(),
      benchmarkTitle: realtimeData.benchmarkTitle || '4-Week Benchmark',
      benchmarkTotal: (Math.round(realtimeData.benchmarkTotal ?? 0) || 'N/A').toLocaleString(),
      currentHour: realtimeData.currentHour !== undefined ? `${String(realtimeData.currentHour).padStart(2, '0')}:00` : 'Live'
    };
  }

  return { status: "data_unavailable", message: "Realtime pacing data is not loaded yet. Please wait for the dashboard to finish loading and try again." };
}

export function executeGeneralQATool(args = {}, contextData = {}) {
  return {
    topic: String(args.topic || 'general'),
    facts: generalQAFacts(contextData),
    guidance: "Answer conversationally. The facts above are computed from the datasets loaded in the dashboard right now; do not quote numbers that are not in them.",
  };
}
