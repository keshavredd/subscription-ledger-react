/**
 * engineAnswers.js — the deterministic answers of the Conversational
 * Analytics engine, one builder per domain. Every figure comes from the rows
 * in contextData through engineData.js; a question the datasets cannot answer
 * says so instead of showing an estimate.
 *
 * Each builder returns { domain, text, kpis, chart, table, suggestedFollowups }.
 * The engine adds the opening commentary lines afterwards (insightLines.js).
 */
import {
  inr, pct, num, compact, rate, sgn, prettyYmd, shortYmd, monthKeyOf, monthLabelOf, MONTHS_SHORT,
  resolveWindow, comparisonMonths, monthsInQuery, monthWindow, latestDate, earliestDate, isYmd, parseYmd, ymd, addDays,
  canonPlatform, platformLabel, platformsWanted, filterPlatforms,
  renewalsAgg, renewalsByPlatform, renewalsByPlan, renewalsByMonth, renewalsByWeek, renewalsDaily,
  funnelOverallRows, funnelPlatformRows, funnelTeamRows, funnelDates, lastN, funnelDaily, funnelAverages, funnelByKey, FUNNEL_STEPS,
  teamWanted, teamsWanted, rowInTeams, teamLabelOf, funnelTeamRowsFor, funnelTeamPlatformRows,
  subAgg, subBy, subByPlatform, subByPlan, subByChannel, subByTxnType, subDaily, recurringShareBy, planOf, channelOf, ledgerTeamOf, ledgerRowInTeam,
  realtimeSummary, realtimeEventsToday, overviewStats,
  geoWanted, funnelCountryRows, funnelCountryPlatformRows,
  txnTypesWanted, countryOf, subSourceOf, subByHour, filterTxnTypes, filterCountry, plansWanted, filterPlans, planKeyOf, comparisonWindows,
  arpuTeamOf, arpuThemeOf, arpuOfferOf, arpuStatusOf, arpuBase, arpuBy,
} from './engineData.js';

const NO_DATA = (what, hint) => ({
  domain: 'CLARIFICATION',
  text: `I don't have ${what} loaded yet${hint ? ` — ${hint}` : '.'}`,
  kpis: null, chart: null, table: null,
  suggestedFollowups: ['Which platform leads sales in the last 30 days?', 'Give me funnel data for the last 7 days, day-wise', 'What is the renewal rate for the last 30 days?'],
});
const notAvailable = (domain, what, alternative, followups) => ({
  domain,
  text: `**${what} is not part of the dashboard data**, so I can't compute it. ${alternative}`,
  kpis: null, chart: null, table: null,
  suggestedFollowups: followups,
});
const nicePlan = (name) => String(name).replace(/^(\d+)\s+(YEAR|MONTH|DAY)S?$/i, (_, n, u) => `${n}-${u.charAt(0) + u.slice(1).toLowerCase()}`);
const bar = (title, labels, values) => ({ type: 'bar', title, labels, values: values.map((v) => (Number.isFinite(v) ? parseFloat(Number(v).toFixed(2)) : 0)) });
const line = (title, labels, values) => ({ type: 'line', title, labels, values: values.map((v) => parseFloat(Number(v).toFixed(2))) });

// ===========================================================================
// DATA OVERVIEW
// ===========================================================================
export function answerDataOverview(rawQuery, ctx = {}) {
  const o = overviewStats(ctx);
  if (!o.sub && !o.ren && !o.fun) return NO_DATA('the dashboard datasets', 'give the page a moment to finish loading and ask again.');
  const lines = [];
  const kpis = [];
  if (o.sub) {
    lines.push(`• **Subscriptions & GTV**: ${num(o.sub.rows)} ledger rows from **${prettyYmd(o.sub.from)}** to **${prettyYmd(o.sub.to)}**, ${inr(o.sub.all.revenue)} in total. Over ${o.sub.window.label}: **${inr(o.sub.w30.revenue)}** (${inr(o.sub.w30.dailyRevenue)}/day, ${num(o.sub.w30.conversions)} conversions${o.sub.topPlatform ? `; ${o.sub.topPlatform.name} leads with ${pct(o.sub.topPlatform.share)} of GTV` : ''}).`);
    kpis.push({ label: 'GTV (last 30 days)', value: inr(o.sub.w30.revenue), sub: `${inr(o.sub.w30.dailyRevenue)}/day` });
  }
  if (o.ren) {
    const m = o.ren.months;
    lines.push(`• **Renewals**: ${prettyYmd(o.ren.from)} to ${prettyYmd(o.ren.to)}, ${num(o.ren.agg.renewed)} renewed of ${num(o.ren.agg.due)} due (**${pct(o.ren.agg.rate)}**)${m.length > 1 ? `; monthly rate ranged from ${pct(o.ren.worst.rate)} (${o.ren.worst.short}) to ${pct(o.ren.best.rate)} (${o.ren.best.short})` : ''}.`);
    kpis.push({ label: 'Renewal rate (all loaded)', value: pct(o.ren.agg.rate), sub: `${num(o.ren.agg.renewed)} renewed` });
  }
  if (o.fun) {
    const a = o.fun.avg;
    lines.push(`• **Acquisition funnel**: daily averages over ${a.days} days to ${prettyYmd(o.fun.to)} — ${compact(a.dau)} DAU, ${num(a.hits)} paywall hits, ${num(a.loads)} plan page loads, ${num(a.purchased)} purchases (**${pct(a.rates.purchasedPctLoads, 2)}** of plan page loads).`);
    kpis.push({ label: 'Load → purchase', value: pct(a.rates.purchasedPctLoads, 2), sub: `${num(a.purchased)} purchases/day` });
  }
  const chart = o.sub && o.sub.platforms.length ? bar('GTV share by platform (last 30 days, %)', o.sub.platforms.map((p) => p.name), o.sub.platforms.map((p) => p.share)) : null;
  return {
    domain: 'DATA_OVERVIEW',
    text: `Here is what is loaded in the dashboard right now:\n\n${lines.join('\n')}\n\nAsk about any of these by platform, plan, channel, month or a rolling window such as "last 7 days".`,
    kpis: kpis.slice(0, 3), chart, table: null,
    suggestedFollowups: ['Which platform leads sales in the last 30 days?', 'Give me funnel data for the last 7 days, day-wise', 'Which plan duration has the highest renewal rate in the last 30 days?'],
  };
}

// ===========================================================================
// REALTIME
// ===========================================================================
export function answerRealtime(q, ctx = {}) {
  const t = String(q || '').toLowerCase();
  const wanted = platformsWanted(t);
  // "iOS" alone means the main app in the realtime feed; name Market iOS to get the store app
  const platform = wanted.length ? wanted[0] : null;
  const team = teamWanted(t);
  const benchmark = /last 7|past 7|7[\s-]?day|last week/.test(t) ? 'last7' : 'sameWeekday';
  const opts = { platform, team: team && team.isRow ? team : null, benchmark };
  const s = realtimeSummary(ctx.realtimeData, opts);
  if (!s) return NO_DATA(`realtime rows${platform ? ` for ${platformLabel(platform)}` : ''}${team ? ` for ${team.label}` : ''}`, 'the Realtime tab loads the feed a few seconds after sign-in.');
  const scope = [platform ? platformLabel(platform) : null, team && team.isRow ? `${team.label} team` : null].filter(Boolean).join(', ');
  const hourLabel = s.currentHour >= 0 ? `${String(s.currentHour).padStart(2, '0')}:00` : 'the start of the day';
  const ev = realtimeEventsToday(ctx.realtimeData, opts);
  const funnelLine = ev.loads || ev.initiated ? `\n\nToday's steps so far: **${num(ev.loads)}** plan page loads → **${num(ev.selected)}** plan selected → **${num(ev.initiated)}** pay initiated → **${num(s.todayPurchases)}** purchases${ev.loads ? ` (${pct(rate(s.todayPurchases, ev.loads), 2)} of loads)` : ''}.` : '';
  const benchLine = s.benchDays
    ? `Against the **${s.benchLabel}** benchmark (${s.benchDays} days), the same-hour average is **${num(s.benchToHour)}**, so today is pacing **${sgn(s.pacingPct)}%**; those days closed at **${num(s.benchFull)}** on average.`
    : 'No comparison days are in the feed yet, so the projection is a straight run-rate.';
  const kpis = [
    { label: 'Purchases today', value: num(s.todayPurchases), sub: `up to ${hourLabel}` },
    { label: 'Projected EOD', value: num(s.projected), sub: s.benchDays ? `from the ${s.benchLabel} curve` : 'run-rate' },
  ];
  if (s.benchDays) kpis.push({ label: 'Pacing vs benchmark', value: `${sgn(s.pacingPct)}%`, sub: `${num(s.benchToHour)} at this hour` });
  const labels = s.hourly.map((h) => `${String(h.hour).padStart(2, '0')}:00`);
  return {
    domain: 'REALTIME',
    insights: 'custom',
    text: `Today (**${prettyYmd(s.today)}**, data up to **${hourLabel}**)${scope ? ` for **${scope}**` : ''}: **${num(s.todayPurchases)} purchases** so far, projecting to **${num(s.projected)}** by end of day.\n\n${benchLine}${funnelLine}`,
    kpis,
    chart: s.benchDays
      ? { type: 'line', title: `Hourly purchases${scope ? ` — ${scope}` : ''}: today vs ${s.benchLabel}`, labels, series: [{ name: 'Today', values: s.hourly.map((h) => h.today), type: 'line' }, { name: 'Benchmark', values: s.hourly.map((h) => parseFloat(h.bench.toFixed(1))), type: 'line' }] }
      : line(`Hourly purchases today${scope ? ` — ${scope}` : ''}`, labels, s.hourly.map((h) => h.today)),
    table: { headers: ['Hour', 'Purchases today', s.benchDays ? 'Benchmark avg' : '—'], rows: s.hourly.map((h) => [labels[h.hour] || `${h.hour}:00`, num(h.today), s.benchDays ? h.bench.toFixed(1) : '—']) },
    suggestedFollowups: ["Today's purchases for the telecalling team", "Today's iOS purchases vs last 7 days", 'Give me funnel data for the last 7 days, day-wise'],
  };
}

// ===========================================================================
// FUNNEL
// ===========================================================================
function funnelWindowDates(q, rows, defaultDays) {
  const dates = funnelDates(rows);
  if (!dates.length) return { dates: [], label: 'the selected period' };
  const w = resolveWindow(q, rows.map((r) => ({ d: String(r.dateStr || '').slice(0, 10) })), 'd', { defaultDays });
  const sel = dates.filter((d) => d >= w.start && d <= w.end);
  return { dates: sel, label: w.label, kind: w.kind };
}
const stepRows = (a) => [
  ['DAU', a.dau, null], ['Paywall Hits', a.hits, a.rates.hitsPctDau], ['Plan Page Loads', a.loads, a.rates.loadsPctHits],
  ['Plan Selected', a.selected, a.rates.selectedPctLoads], ['Pay Initiated', a.initiated, a.rates.initiatedPctSelected], ['Purchased', a.purchased, a.rates.purchasedPctInitiated],
];

export function answerFunnel(q, funnelData = []) {
  const overall = funnelOverallRows(funnelData);
  if (!overall.length) return NO_DATA('acquisition funnel data', 'the Funnel Analysis tab loads it shortly after sign-in.');
  const t = String(q || '').toLowerCase();
  const teamsNamed = teamsWanted(t);
  const team = teamsNamed.length === 1 ? teamsNamed[0] : null;
  const geo = team ? null : geoWanted(t);
  const followups = team
    ? [`Platform-wise split of the ${team.label} funnel for the last 7 days`, 'Team-wise funnel for the last 7 days', 'Give me funnel data for the last 7 days, day-wise']
    : ['Show the platform-wise split of the funnel for the last 7 days', 'Team-wise funnel for the last 7 days', 'Where does the funnel leak the most?'];
  const scope = team ? (team.isRow ? ` for the **${team.label}** team` : ' for **organic / unattributed** traffic') : (geo ? ` for **${geo === 'india' ? 'India' : 'International'}** traffic` : '');
  // Team rows repeat the site-wide DAU and paywall hits, so a team is described from plan page loads onward.
  const teamNote = team ? `\n\n_DAU and paywall hits are site-wide, so the ${team.isRow ? team.label : 'organic'} figures start at plan page loads._` : '';
  const stepsFor = (a) => (team ? stepRows(a).slice(2) : stepRows(a));
  const firstStep = team ? 'loads' : 'dau';

  // rows that describe the asked scope (organic = overall minus every attributed team, per day)
  const scopeRows = (dates) => {
    if (geo) {
      const india = funnelDaily(funnelCountryRows(funnelData, 'india'), dates);
      if (geo === 'india') return india;
      const all = funnelDaily(overall, dates);
      return all.map((d) => { const x = india.find((y) => y.date === d.date) || {}; const o = { ...d }; FUNNEL_STEPS.forEach(([k]) => { o[k] = Math.max(d[k] - (x[k] || 0), 0); }); return o; });
    }
    if (!team) return funnelDaily(overall, dates);
    if (team.isRow) return funnelDaily(funnelTeamRowsFor(funnelData, team), dates);
    const all = funnelDaily(overall, dates);
    const attributed = funnelDaily(funnelTeamRows(funnelData), dates);
    return all.map((d) => { const x = attributed.find((y) => y.date === d.date) || {}; const o = { ...d }; ['loads', 'selected', 'initiated', 'purchased'].forEach((k) => { o[k] = Math.max(d[k] - (x[k] || 0), 0); }); return o; });
  };

  // 0. India vs International split
  if (!team && /india vs international|international vs india|country[\s-]?wise|by country|geo[\s-]?wise|by geography|geography split|india and international/.test(t)) {
    const { dates, label } = funnelWindowDates(q, overall, 7);
    const all = funnelAverages(funnelDaily(overall, dates));
    const ind = funnelAverages(funnelDaily(funnelCountryRows(funnelData, 'india'), dates));
    if (!ind.days) return NO_DATA(`India-level funnel rows for ${label}`);
    const intl = { days: all.days };
    FUNNEL_STEPS.forEach(([k]) => { intl[k] = Math.max(all[k] - ind[k], 0); });
    const rows = [{ name: 'India', ...ind }, { name: 'International', ...intl }].map((r) => ({ ...r, hitsToPurchase: rate(r.purchased, r.hits), loadsToPurchase: rate(r.purchased, r.loads), share: rate(r.purchased, all.purchased) }));
    return {
      domain: 'FUNNEL',
      insights: 'custom',
      text: `India vs International funnel for ${label} (daily averages):

` + rows.map((r) => `• **${r.name}**: ${compact(r.dau)} DAU → ${num(r.hits)} paywall hits → ${num(r.loads)} plan page loads → **${num(r.purchased)} purchases** (${pct(r.share)} of all purchases; ${pct(r.hitsToPurchase, 2)} of hits, ${pct(r.loadsToPurchase, 2)} of loads)`).join('\n'),
      kpis: [{ label: 'India purchases/day', value: num(rows[0].purchased), sub: `${pct(rows[0].share)} of total` }, { label: 'International purchases/day', value: num(rows[1].purchased), sub: `${pct(rows[1].share)} of total` }, { label: 'Better hits → purchase', value: rows[0].hitsToPurchase >= rows[1].hitsToPurchase ? 'India' : 'International', sub: pct(Math.max(rows[0].hitsToPurchase, rows[1].hitsToPurchase), 2) }],
      chart: { type: 'grouped_bar', title: `Daily funnel averages: India vs International — ${label}`, labels: ['Paywall Hits', 'Plan Page Loads', 'Purchased'], series: [{ name: 'India', values: [ind.hits, ind.loads, ind.purchased], type: 'bar' }, { name: 'International', values: [intl.hits, intl.loads, intl.purchased], type: 'bar' }] },
      table: { headers: ['Geography', 'DAU', 'Paywall Hits', 'Plan Page Loads', 'Purchased', 'Hits → Purchase', 'Loads → Purchase'], rows: rows.map((r) => [r.name, num(r.dau), num(r.hits), num(r.loads), num(r.purchased), pct(r.hitsToPurchase, 2), pct(r.loadsToPurchase, 2)]) },
      suggestedFollowups: ['India funnel for the last 7 days, day-wise', 'Platform-wise split of the international funnel', 'Team-wise funnel for the last 7 days'],
    };
  }

  // 1. team-wise split (all teams, or just the ones named when several are)
  if (!team && (teamsNamed.length >= 2 || /team[\s-]?wise|by team|per team|across teams|marketing teams?|which team/.test(t))) {
    const { dates, label } = funnelWindowDates(q, overall, 7);
    let teams = funnelByKey(funnelTeamRows(funnelData), dates, (r) => teamLabelOf(r.Marketing_team ?? r.marketingTeam));
    if (teamsNamed.length >= 2) teams = teams.filter((r) => rowInTeams(teamsNamed, r.name));
    if (!teams.length) return NO_DATA(`marketing-team funnel rows for ${label}`);
    const a = funnelAverages(funnelDaily(overall, dates));
    const org = { name: 'Organic / unattributed' };
    ['loads', 'selected', 'initiated', 'purchased'].forEach((k) => { org[k] = Math.max(a[k] - teams.reduce((s2, r) => s2 + r[k], 0), 0); });
    org.loadsToPurchase = rate(org.purchased, org.loads);
    const wantOrganic = teamsNamed.length < 2 || teamsNamed.some((tm) => !tm.isRow);
    const rows = (wantOrganic ? [...teams, org] : [...teams]).sort((x, y) => y.purchased - x.purchased);
    const total = rows.reduce((s2, r) => s2 + r.purchased, 0);
    const best = [...teams].sort((x, y) => y.loadsToPurchase - x.loadsToPurchase)[0];
    return {
      domain: 'FUNNEL',
      text: `Team-wise funnel for ${label} (daily averages):\n\n` + rows.map((r) => `• **${r.name}**: ${num(r.loads)} plan page loads → ${num(r.selected)} selected → ${num(r.initiated)} pay initiated → **${num(r.purchased)} purchases** (${pct(r.loadsToPurchase, 2)} of loads, ${pct(rate(r.purchased, total))} of all purchases)`).join('\n') + `\n\n_DAU and paywall hits are site-wide and not split by team._`,
      kpis: [{ label: 'Most purchases', value: rows[0].name, sub: `${num(rows[0].purchased)}/day` }, { label: 'Best load → purchase', value: best ? best.name : '—', sub: best ? pct(best.loadsToPurchase, 2) : '' }, { label: 'Purchases/day (all)', value: num(total), sub: `${teams.length} teams + organic` }],
      chart: bar(`Purchases per day by marketing team — ${label}`, rows.map((r) => r.name), rows.map((r) => r.purchased)),
      table: { headers: ['Team', 'Plan Page Loads', 'Plan Selected', 'Pay Initiated', 'Purchased', 'Loads → Purchase'], rows: rows.map((r) => [r.name, num(r.loads), num(r.selected), num(r.initiated), num(r.purchased), pct(r.loadsToPurchase, 2)]) },
      suggestedFollowups: followups,
    };
  }

  // 2. leakage / drop-off
  if (/\bleak|drop[\s-]?off|drops? the most|biggest drop|where do we lose/.test(t)) {
    const { dates, label } = funnelWindowDates(q, overall, 30);
    const a = funnelAverages(scopeRows(dates));
    const steps = stepsFor(a);
    const drops = steps.slice(1).map((s2, i) => ({ from: steps[i][0], to: s2[0], keep: rate(s2[1], steps[i][1]), lost: 100 - rate(s2[1], steps[i][1]) }));
    if (!drops.length || !steps[0][1]) return NO_DATA(`funnel rows${scope.replace(/\*\*/g, '')} for ${label}`);
    const worst = drops.reduce((x, y) => (y.lost > x.lost ? y : x));
    return {
      domain: 'FUNNEL',
      insights: 'custom',
      text: `Funnel leakage${scope} for ${label} (daily averages over ${a.days} days):\n\n` + drops.map((d) => `• **${d.from} → ${d.to}**: **${pct(d.keep)}** carry on, ${pct(d.lost)} drop off`).join('\n') +
        `\n\nThe biggest leak is **${worst.from} → ${worst.to}** (${pct(worst.lost)} lost). End to end, **${pct(rate(a.purchased, a.loads), 2)}** of plan page loads${team ? '' : ` and **${pct(a.rates.purchasedPctHits, 2)}** of paywall hits`} become purchases.${teamNote}`,
      kpis: [{ label: 'Biggest leak', value: pct(worst.lost), sub: `${worst.from} → ${worst.to}` }, { label: 'Loads → purchase', value: pct(rate(a.purchased, a.loads), 2), sub: `${num(a.loads)} loads/day` }, { label: 'Purchases/day', value: num(a.purchased), sub: label.replace(/\s*\(.*\)$/, '') }],
      chart: bar(`Step-to-step conversion (%)${team ? ` — ${team.label}` : ''} — ${label}`, drops.map((d) => d.to), drops.map((d) => d.keep)),
      table: { headers: ['Step', 'Daily avg', 'Of previous step'], rows: steps.map(([n, v], i) => [n, num(v), i === 0 ? '—' : pct(rate(v, steps[i - 1][1]), 2)]) },
      suggestedFollowups: followups,
    };
  }

  // 3. platform split (optionally within a team)
  if (/\bplatform/.test(t) && /split|breakdown|wise|by platform|per platform|across platforms|which platform/.test(t)) {
    const plat = team && team.isRow ? funnelTeamPlatformRows(funnelData, team) : (geo === 'india' ? funnelCountryPlatformRows(funnelData, 'india') : funnelPlatformRows(funnelData));
    const { dates, label } = funnelWindowDates(q, overall, 7);
    let rows = funnelByKey(plat, dates, (r) => platformLabel(r.ET_Platform ?? r.platform));
    if (geo === 'international') {
      const ind = funnelByKey(funnelCountryPlatformRows(funnelData, 'india'), dates, (r) => platformLabel(r.ET_Platform ?? r.platform));
      rows = rows.map((r) => { const x = ind.find((y) => y.name === r.name) || {}; const o = { ...r }; FUNNEL_STEPS.forEach(([k]) => { o[k] = Math.max(r[k] - (x[k] || 0), 0); }); o.loadsToPurchase = rate(o.purchased, o.loads); o.hitsToPurchase = rate(o.purchased, o.hits); return o; }).sort((x, y) => y.purchased - x.purchased);
    }
    if (!rows.length) return NO_DATA(`platform-level funnel rows${scope.replace(/\*\*/g, '')} for ${label}`, team && !team.isRow ? 'organic traffic is not split by platform in the feed.' : '');
    const best = [...rows].sort((a, b) => b.loadsToPurchase - a.loadsToPurchase)[0];
    const total = rows.reduce((s2, r) => s2 + r.purchased, 0);
    return {
      domain: 'FUNNEL',
      text: `Platform-wise funnel${scope} for ${label} (daily averages):\n\n` + rows.map((r) => `• **${r.name}**: ${team ? '' : `${num(r.hits)} paywall hits → `}${num(r.loads)} plan page loads → **${num(r.purchased)} purchases** (${pct(r.loadsToPurchase, 2)} of loads, ${pct(rate(r.purchased, total))} of all purchases)`).join('\n') + teamNote,
      kpis: [{ label: 'Most purchases', value: rows[0].name, sub: `${num(rows[0].purchased)}/day` }, { label: 'Best load → purchase', value: best.name, sub: pct(best.loadsToPurchase, 2) }, { label: 'Purchases/day', value: num(total), sub: `${rows.length} platforms` }],
      chart: bar(`Purchases per day by platform${team ? ` — ${team.label}` : ''} — ${label}`, rows.map((r) => r.name), rows.map((r) => r.purchased)),
      table: team
        ? { headers: ['Platform', 'Plan Page Loads', 'Plan Selected', 'Pay Initiated', 'Purchased', 'Loads → Purchase'], rows: rows.map((r) => [r.name, num(r.loads), num(r.selected), num(r.initiated), num(r.purchased), pct(r.loadsToPurchase, 2)]) }
        : { headers: ['Platform', 'DAU', 'Paywall Hits', 'Plan Page Loads', 'Purchased', 'Loads → Purchase'], rows: rows.map((r) => [r.name, num(r.dau), num(r.hits), num(r.loads), num(r.purchased), pct(r.loadsToPurchase, 2)]) },
      suggestedFollowups: followups,
    };
  }

  // 4. paywall hits (site-wide; with the team split of downstream steps)
  if (!team && /paywall hit|hit rate/.test(t)) {
    const { dates, label } = funnelWindowDates(q, overall, 30);
    const a = funnelAverages(funnelDaily(overall, dates));
    const teams = funnelByKey(funnelTeamRows(funnelData), dates, (r) => teamLabelOf(r.Marketing_team ?? r.marketingTeam));
    const attributed = teams.reduce((s2, r) => s2 + r.purchased, 0);
    const organic = Math.max(a.purchased - attributed, 0);
    const teamLines = teams.length ? `\n\nPurchases by marketing team (daily avg): ` + teams.map((r) => `**${r.name}** ${num(r.purchased)}`).join(', ') + `, **Organic / unattributed** ${num(organic)}.` : '';
    return {
      domain: 'FUNNEL',
      insights: 'custom',
      text: `Paywall performance for ${label} (daily averages over ${a.days} days):\n\n• **${compact(a.dau)} DAU** → **${num(a.hits)} paywall hits** (**${pct(a.rates.hitsPctDau, 2)}** hit rate)\n• ${num(a.loads)} plan page loads (${pct(a.rates.loadsPctHits)} of hits) → ${num(a.purchased)} purchases (**${pct(a.rates.purchasedPctHits, 2)}** of hits)${teamLines}`,
      kpis: [{ label: 'Paywall hit rate', value: pct(a.rates.hitsPctDau, 2), sub: `${num(a.hits)} hits/day` }, { label: 'DAU', value: compact(a.dau), sub: 'daily average' }, { label: 'Hits → purchase', value: pct(a.rates.purchasedPctHits, 2), sub: `${num(a.purchased)}/day` }],
      chart: teams.length ? bar(`Purchases per day by marketing team — ${label}`, [...teams.map((r) => r.name), 'Organic / unattributed'], [...teams.map((r) => r.purchased), organic]) : bar(`Daily funnel averages — ${label}`, ['Paywall Hits', 'Plan Page Loads', 'Purchased'], [a.hits, a.loads, a.purchased]),
      table: { headers: ['Step', 'Daily avg', 'Of previous step'], rows: stepRows(a).map(([n, v, r]) => [n, num(v), r === null ? '—' : pct(r, 2)]) },
      suggestedFollowups: followups,
    };
  }

  // 5. two windows compared (e.g. 7 days vs 30 days)
  const two = t.match(/(\d{1,3})\s*(?:days?|d)\b[^\d]*(?:vs|versus|against|compared? (?:to|with))[^\d]*(\d{1,3})\s*(?:days?|d)\b/);
  if (two || (/compare|vs|versus/.test(t) && /7\s*d|7 days/.test(t) && /30\s*d|30 days/.test(t))) {
    const n1 = two ? parseInt(two[1], 10) : 7, n2 = two ? parseInt(two[2], 10) : 30;
    const dates = funnelDates(overall);
    const a1 = funnelAverages(scopeRows(lastN(dates, n1)));
    const a2 = funnelAverages(scopeRows(lastN(dates, n2)));
    const steps = team ? FUNNEL_STEPS.slice(2) : FUNNEL_STEPS;
    const rowsT = steps.map(([k, n]) => [n, num(a1[k]), num(a2[k]), `${sgn(rate(a1[k] - a2[k], a2[k]))}%`]);
    return {
      domain: 'FUNNEL',
      insights: 'custom',
      text: `Daily funnel averages${scope}, last ${a1.days} days vs last ${a2.days} days:\n\n` + steps.map(([k, n]) => `• **${n}**: ${num(a1[k])} vs ${num(a2[k])} (**${sgn(rate(a1[k] - a2[k], a2[k]))}%**)`).join('\n') +
        `\n\nLoad → purchase: **${pct(rate(a1.purchased, a1.loads), 2)}** vs ${pct(rate(a2.purchased, a2.loads), 2)}.${teamNote}`,
      kpis: [{ label: `Purchases/day (${n1}d)`, value: num(a1.purchased), sub: `${sgn(rate(a1.purchased - a2.purchased, a2.purchased))}% vs ${n2}d` }, { label: `Load → purchase (${n1}d)`, value: pct(rate(a1.purchased, a1.loads), 2), sub: `${pct(rate(a2.purchased, a2.loads), 2)} over ${n2}d` }, { label: `Plan page loads (${n1}d)`, value: num(a1.loads), sub: `${num(a2.loads)} over ${n2}d` }],
      chart: { type: 'grouped_bar', title: `Daily averages${team ? ` — ${team.label}` : ''}: last ${n1} vs ${n2} days`, labels: steps.filter(([k]) => k !== 'dau').map(([, n]) => n), series: [{ name: `Last ${n1} days`, values: steps.filter(([k]) => k !== 'dau').map(([k]) => a1[k]), type: 'bar' }, { name: `Last ${n2} days`, values: steps.filter(([k]) => k !== 'dau').map(([k]) => a2[k]), type: 'bar' }] },
      table: { headers: ['Step', `Last ${n1} days`, `Last ${n2} days`, 'Change'], rows: rowsT },
      suggestedFollowups: followups,
    };
  }

  // 6. day-wise
  const { dates, label } = funnelWindowDates(q, overall, 30);
  const daily = scopeRows(dates);
  if (!daily.length || !daily.some((d) => d[firstStep] > 0)) return NO_DATA(`funnel rows${scope.replace(/\*\*/g, '')} for ${label}`);
  const wantsDaily = /day[\s-]?wise|daily|by date|day by day|each day|trend|per day/.test(t) || dates.length <= 15;
  const a = funnelAverages(daily);
  if (wantsDaily) {
    const first = daily[0].purchased, last = daily[daily.length - 1].purchased;
    const hi = daily.reduce((x, y) => (y.purchased > x.purchased ? y : x));
    const lo = daily.reduce((x, y) => (y.purchased < x.purchased ? y : x));
    const move = Math.abs(rate(last - first, first)) < 1 ? 'held flat' : (last >= first ? `rose **${sgn(rate(last - first, first), 0)}%**` : `fell **${Math.abs(rate(last - first, first)).toFixed(0)}%**`);
    return {
      domain: 'FUNNEL',
      insights: 'custom',
      text: `Here is the **day-wise funnel**${scope} for ${label}:\n\n` +
        `Daily purchases ${move} from **${num(first)}** on ${shortYmd(daily[0].date)} to **${num(last)}** on ${shortYmd(daily[daily.length - 1].date)}; the best day was **${shortYmd(hi.date)}** (${num(hi.purchased)}) and the weakest **${shortYmd(lo.date)}** (${num(lo.purchased)}). ` +
        (team ? `**${pct(rate(a.purchased, a.loads), 2)}** of ${team.label} plan page loads ended in a purchase.` : `DAU averaged **${compact(a.dau)}** and **${pct(a.rates.purchasedPctHits, 2)}** of paywall hits ended in a purchase.`) + `\n\n` +
        (team ? `• **Average daily plan page loads**: **${num(a.loads)}**\n` : `• **Average daily DAU**: **${compact(a.dau)}**\n`) + `• **Average daily purchases**: **${num(a.purchased)}**\n• **Total purchases (${a.days} days)**: **${num(daily.reduce((s2, d) => s2 + d.purchased, 0))}**${teamNote}`,
      kpis: [{ label: `Purchases (${a.days}d)`, value: num(daily.reduce((s2, d) => s2 + d.purchased, 0)), sub: `${num(a.purchased)}/day` }, team ? { label: 'Plan page loads/day', value: num(a.loads), sub: team.label } : { label: 'Daily avg DAU', value: compact(a.dau), sub: 'active users/day' }, { label: team ? 'Loads → purchase' : 'Hits → purchase', value: team ? pct(rate(a.purchased, a.loads), 2) : pct(a.rates.purchasedPctHits, 2), sub: team ? `${num(a.loads)} loads/day` : `${num(a.hits)} hits/day` }],
      chart: line(`Day-wise purchases${team ? ` — ${team.label}` : ''} — ${label}`, daily.map((d) => d.date), daily.map((d) => d.purchased)),
      table: team
        ? { headers: ['Date', 'Plan Page Loads', 'Plan Selected', 'Pay Initiated', 'Purchased'], rows: daily.map((d) => [d.date, num(d.loads), num(d.selected), num(d.initiated), num(d.purchased)]) }
        : { headers: ['Date', 'DAU', 'Paywall Hits', 'Plan Page Loads', 'Plan Selected', 'Pay Initiated', 'Purchased'], rows: daily.map((d) => [d.date, num(d.dau), num(d.hits), num(d.loads), num(d.selected), num(d.initiated), num(d.purchased)]) },
      suggestedFollowups: followups,
    };
  }

  // 7. summary
  const steps = stepsFor(a);
  return {
    domain: 'FUNNEL',
    insights: 'custom',
    text: `Acquisition funnel${scope} for ${label} (daily averages over ${a.days} days):\n\n` + steps.map(([n, v], i) => `• **${n}**: **${n === 'DAU' ? compact(v) : num(v)}**${i === 0 ? '' : ` (${pct(rate(v, steps[i - 1][1]), 2)} of the previous step)`}`).join('\n') +
      `\n\nEnd to end, **${pct(rate(a.purchased, a.loads), 2)}** of plan page loads${team ? '' : ` and **${pct(a.rates.purchasedPctHits, 2)}** of paywall hits`} convert.${teamNote}`,
    kpis: [team ? { label: 'Plan page loads/day', value: num(a.loads), sub: team.label } : { label: 'Daily avg DAU', value: compact(a.dau), sub: 'users/day' }, team ? { label: 'Pay initiated/day', value: num(a.initiated), sub: `${pct(rate(a.initiated, a.selected))} of selected` } : { label: 'Paywall hit rate', value: pct(a.rates.hitsPctDau, 2), sub: `${num(a.hits)} hits/day` }, { label: 'Load → purchase', value: pct(rate(a.purchased, a.loads), 2), sub: `${num(a.purchased)} purchases/day` }],
    chart: bar(`Daily funnel averages${team ? ` — ${team.label}` : ''} — ${label}`, steps.filter(([n]) => n !== 'DAU').map(([n]) => n), steps.filter(([n]) => n !== 'DAU').map(([, v]) => v)),
    table: { headers: ['Step', 'Daily avg', 'Of previous step'], rows: steps.map(([n, v], i) => [n, num(v), i === 0 ? '—' : pct(rate(v, steps[i - 1][1]), 2)]) },
    suggestedFollowups: followups,
  };
}

// ===========================================================================
// RENEWALS
// ===========================================================================
export function answerRenewals(q, ctx = {}) {
  const ren = ctx.renewalsData || [];
  const t = String(q || '').toLowerCase();
  const followups = ['Give me the platform-wise breakup of renewals for the last 30 days', 'Which plan duration has the highest renewal rate in the last 30 days?', 'Compare this month vs last month renewals'];

  // auto-renew / recurring share comes from the subscription ledger (fresh sales only)
  if (/auto[\s-]?renew|opt[\s-]?in|recurring/.test(t)) {
    const sub = ctx.subscriptionData || [];
    if (!sub.length) return NO_DATA('the subscription ledger (needed for recurring share)');
    const w = resolveWindow(q, sub, 'dateStr', { defaultDays: 30 });
    const byPlan = /\bplan/.test(t), byTeam = /team|channel/.test(t);
    const keyFn = byPlan ? planOf : byTeam ? channelOf : (r) => platformLabel(r.platform);
    const cut = byPlan ? 'plan' : byTeam ? 'channel' : 'platform';
    const { rows, totals } = recurringShareBy(w.records, keyFn);
    if (!rows.length) return NO_DATA(`fresh sales for ${w.label}`);
    const top = [...rows].sort((a, b) => b.share - a.share)[0];
    return {
      domain: 'RENEWALS',
      text: `Recurring adoption for ${w.label}, measured on fresh sales only (auto and manual renewals excluded): **${pct(totals.share)}** of **${num(totals.sold)}** fresh sales chose a recurring plan (**${num(totals.recurring)}**, ${inr(totals.recRevenue)} of GTV).\n\n` + rows.map((r) => `• **${byPlan ? nicePlan(r.name) : r.name}**: **${pct(r.share)}** recurring (${num(r.recurring)} of ${num(r.sold)} sold | ${inr(r.recRevenue)})`).join('\n'),
      kpis: [{ label: 'Recurring share', value: pct(totals.share), sub: `${num(totals.recurring)} of ${num(totals.sold)} fresh sales` }, { label: 'Recurring GTV', value: inr(totals.recRevenue), sub: w.kind === 'rolling' || w.kind === 'default' ? 'in the window' : w.label }, { label: `Highest share (${cut})`, value: byPlan ? nicePlan(top.name) : top.name, sub: pct(top.share) }],
      chart: bar(`Recurring share of fresh sales by ${cut} (%) — ${w.label}`, rows.map((r) => (byPlan ? nicePlan(r.name) : r.name)), rows.map((r) => r.share)),
      table: { headers: [cut.charAt(0).toUpperCase() + cut.slice(1), 'Fresh sales', 'Recurring', 'Recurring share', 'Recurring GTV'], rows: rows.map((r) => [byPlan ? nicePlan(r.name) : r.name, num(r.sold), num(r.recurring), pct(r.share), inr(r.recRevenue)]) },
      suggestedFollowups: followups,
    };
  }

  if (!ren.length) return NO_DATA('renewal data', 'the Renewals & Recurring tab loads it shortly after sign-in.');

  // weekly split of a month
  if (/weekly|by week|per week|week[\s-]?wise|split into weeks?/.test(t)) {
    const named = monthsInQuery(t, parseYmd(latestDate(ren, 'renew_date')).getFullYear());
    let w;
    if (named.length) w = monthWindow(ren, 'renew_date', named[0].year, named[0].month);
    else { const k = monthKeyOf(latestDate(ren, 'renew_date')); const [y, m] = k.split('-').map(Number); w = monthWindow(ren, 'renew_date', y, m - 1); }
    if (!w.records.length) return NO_DATA(`renewal rows for ${w.label}`);
    const weeks = renewalsByWeek(w.records, w.start, w.end).filter((x) => x.due > 0);
    const agg = renewalsAgg(w.records);
    const best = weeks.reduce((a, b) => (b.rate > a.rate ? b : a));
    return {
      domain: 'RENEWALS',
      text: `Week-by-week renewals for **${w.label}** (overall **${pct(agg.rate)}**, ${num(agg.renewed)} of ${num(agg.due)} due):\n\n` + weeks.map((x) => `• **${x.label}**: **${pct(x.rate)}** (${num(x.renewed)} renewed of ${num(x.due)} due)`).join('\n') + `\n\nThe strongest week was **${best.label}** at ${pct(best.rate)}.`,
      kpis: [{ label: 'Monthly renewal rate', value: pct(agg.rate), sub: w.label }, { label: 'Best week', value: pct(best.rate), sub: best.label.replace(/\s*\(.*\)$/, '') }, { label: 'Renewed', value: num(agg.renewed), sub: `of ${num(agg.due)} due` }],
      chart: bar(`Weekly renewal rate (%) — ${w.label}`, weeks.map((x) => x.label.replace(/\s*\(.*\)$/, '')), weeks.map((x) => x.rate)),
      table: { headers: ['Week', 'Due', 'Renewed', 'Renewal rate'], rows: weeks.map((x) => [x.label, num(x.due), num(x.renewed), pct(x.rate)]) },
      suggestedFollowups: followups,
    };
  }

  // monthly trend
  if (/monthly|month[\s-]?wise|month by month|all months|mthly|montly|month on month|mom\b|trend/.test(t) && !/compare|vs|versus/.test(t)) {
    const months = renewalsByMonth(ren);
    if (!months.length) return NO_DATA('monthly renewal rows');
    const best = months.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = months.reduce((a, b) => (b.rate < a.rate ? b : a));
    const first = months[0], last = months[months.length - 1];
    return {
      domain: 'RENEWALS',
      text: `Monthly renewal rate across the ${months.length} months loaded (${first.short} – ${last.short}):\n\n` + months.map((m) => `• **${m.short}**: **${pct(m.rate)}** (${num(m.renewed)} renewed / ${num(m.due)} due)`).join('\n') + `\n\nThe rate peaked in **${best.short} (${pct(best.rate)})** and was lowest in **${worst.short} (${pct(worst.rate)})**; ${last.short} is ${sgn(last.rate - first.rate)} points versus ${first.short}.`,
      kpis: [{ label: `Highest (${best.short})`, value: pct(best.rate), sub: `${num(best.renewed)} renewed` }, { label: `Lowest (${worst.short})`, value: pct(worst.rate), sub: `${num(worst.renewed)} renewed` }, { label: `Latest (${last.short})`, value: pct(last.rate), sub: `${sgn(last.rate - first.rate)} pts vs ${first.short}` }],
      chart: line(`Monthly renewal rate (%) — ${first.short} to ${last.short}`, months.map((m) => m.short), months.map((m) => m.rate)),
      table: { headers: ['Month', 'Due', 'Renewed', 'Renewal rate'], rows: months.map((m) => [m.label, num(m.due), num(m.renewed), pct(m.rate)]) },
      suggestedFollowups: followups,
    };
  }

  // plan duration
  if (/plan duration|1[\s-]*year|3[\s-]*year|duration|plan category|plan[\s-]?wise|by plan|tenure|\bplans?\b/.test(t)) {
    const w = resolveWindow(q, ren, 'renew_date', { defaultDays: 30 });
    const pw = platformsWanted(t);
    const scoped = filterPlatforms(w.records, pw);
    const cats = renewalsByPlan(scoped).sort((a, b) => b.rate - a.rate);
    if (!cats.length) return NO_DATA(`renewal rows for ${w.label}${pw.length ? ` on ${pw.map((k) => platformLabel(k)).join(', ')}` : ''}`);
    const platScope = pw.length ? ` on ${pw.map((k) => platformLabel(k)).join(' + ')}` : '';
    const y1 = cats.find((c) => /^1\s*YEAR$/.test(c.name)), y3 = cats.find((c) => /^3\s*YEAR$/.test(c.name));
    const top = cats[0];
    const agg = renewalsAgg(scoped);
    let head;
    if (/1[\s-]*year|3[\s-]*year/.test(t) && y1 && y3) {
      const lead = y1.rate >= y3.rate ? y1 : y3, lag = lead === y1 ? y3 : y1;
      head = `For ${w.label}${platScope}, **${nicePlan(lead.name)} plans** renew at a higher rate (**${pct(lead.rate)}**) than **${nicePlan(lag.name)} plans** (**${pct(lag.rate)}**), a gap of **${(lead.rate - lag.rate).toFixed(1)} points**.`;
    } else head = `For ${w.label}${platScope}, **${nicePlan(top.name)} plans** have the highest renewal rate at **${pct(top.rate)}** (${num(top.renewed)} of ${num(top.due)} due).`;
    const kpis = [];
    if (y1) kpis.push({ label: '1-Year renewal rate', value: pct(y1.rate), sub: `${num(y1.renewed)} of ${num(y1.due)} due` });
    if (y3) kpis.push({ label: '3-Year renewal rate', value: pct(y3.rate), sub: `${num(y3.renewed)} of ${num(y3.due)} due` });
    kpis.push({ label: 'Highest category', value: nicePlan(top.name), sub: pct(top.rate) });
    return {
      domain: 'RENEWALS',
      text: `${head}\n\n` + cats.map((c) => `• **${nicePlan(c.name)} plans**: **${pct(c.rate)}** (${num(c.renewed)} renewed of ${num(c.due)} due)`).join('\n') + `\n\nOverall for ${w.label}: **${pct(agg.rate)}** (${num(agg.renewed)} of ${num(agg.due)} due).`,
      kpis: kpis.slice(0, 3),
      chart: bar(`Renewal rate by plan category (%) — ${w.label}`, cats.map((c) => nicePlan(c.name)), cats.map((c) => c.rate)),
      table: { headers: ['Plan category', 'Due', 'Renewed', 'Renewal rate'], rows: cats.map((c) => [c.name, num(c.due), num(c.renewed), pct(c.rate)]) },
      suggestedFollowups: followups,
    };
  }

  // two periods compared
  if (/compare|\bvs\b|versus|difference|variance|against/.test(t)) {
    const [a, b] = comparisonMonths(q, ren, 'renew_date');
    if (!a || !b || !a.records.length || !b.records.length) return NO_DATA('two months of renewal rows to compare', 'name two months that are loaded, e.g. "August vs July".');
    const aggA = renewalsAgg(a.records), aggB = renewalsAgg(b.records);
    const pa = renewalsByPlatform(a.records), pb = renewalsByPlatform(b.records);
    const names = [...new Set([...pa.map((x) => x.name), ...pb.map((x) => x.name)])];
    const rows = names.map((n) => { const x = pa.find((p) => p.name === n) || { rate: 0, due: 0, renewed: 0 }; const y = pb.find((p) => p.name === n) || { rate: 0, due: 0, renewed: 0 }; return { name: n, a: x, b: y, delta: x.rate - y.rate }; }).sort((x, y) => y.a.due - x.a.due);
    const up = rows.filter((r) => r.delta > 0).sort((x, y) => y.delta - x.delta)[0];
    const down = rows.filter((r) => r.delta < 0).sort((x, y) => x.delta - y.delta)[0];
    return {
      domain: 'RENEWALS',
      insights: 'custom',
      text: `**${a.label}** renewed at **${pct(aggA.rate)}** (${num(aggA.renewed)} of ${num(aggA.due)} due) against **${pct(aggB.rate)}** in **${b.label}** (${num(aggB.renewed)} of ${num(aggB.due)} due), a change of **${sgn(aggA.rate - aggB.rate)} points**.\n\n` +
        rows.map((r) => `• **${r.name}**: ${pct(r.b.rate)} → **${pct(r.a.rate)}** (${sgn(r.delta)} pts)`).join('\n') +
        (up ? `\n\nBiggest gain: **${up.name}** (${sgn(up.delta)} pts)` : '') + (down ? `${up ? '; ' : '\n\n'}biggest drop: **${down.name}** (${sgn(down.delta)} pts).` : (up ? '.' : '')),
      kpis: [{ label: a.label, value: pct(aggA.rate), sub: `${num(aggA.renewed)} renewed` }, { label: b.label, value: pct(aggB.rate), sub: `${num(aggB.renewed)} renewed` }, { label: 'Change', value: `${sgn(aggA.rate - aggB.rate)} pts`, sub: `${sgn(rate(aggA.renewed - aggB.renewed, aggB.renewed))}% renewed volume` }],
      chart: { type: 'grouped_bar', title: `Renewal rate by platform (%): ${a.label} vs ${b.label}`, labels: rows.map((r) => r.name), series: [{ name: a.label, values: rows.map((r) => parseFloat(r.a.rate.toFixed(1))), type: 'bar' }, { name: b.label, values: rows.map((r) => parseFloat(r.b.rate.toFixed(1))), type: 'bar' }] },
      table: { headers: ['Platform', `${a.label} due`, `${a.label} rate`, `${b.label} due`, `${b.label} rate`, 'Change'], rows: rows.map((r) => [r.name, num(r.a.due), pct(r.a.rate), num(r.b.due), pct(r.b.rate), `${sgn(r.delta)} pts`]) },
      suggestedFollowups: followups,
    };
  }

  // day-wise
  if (/day[\s-]?wise|daily|by date|day by day|each day|per day/.test(t)) {
    const w = resolveWindow(q, ren, 'renew_date', { defaultDays: 30 });
    const daily = renewalsDaily(w.records);
    if (!daily.length) return NO_DATA(`renewal rows for ${w.label}`);
    const agg = renewalsAgg(w.records);
    return {
      domain: 'RENEWALS',
      text: `Daily renewals for ${w.label}: **${pct(agg.rate)}** overall (${num(agg.renewed)} of ${num(agg.due)} due) across ${daily.length} days.`,
      kpis: [{ label: 'Renewal rate', value: pct(agg.rate), sub: w.label }, { label: 'Due', value: num(agg.due), sub: `${num(Math.round(agg.due / daily.length))}/day` }, { label: 'Renewed', value: num(agg.renewed), sub: `${num(Math.round(agg.renewed / daily.length))}/day` }],
      chart: line(`Daily renewal rate (%) — ${w.label}`, daily.map((d) => d.date), daily.map((d) => d.rate)),
      table: { headers: ['Date', 'Due', 'Renewed', 'Renewal rate'], rows: daily.map((d) => [d.date, num(d.due), num(d.renewed), pct(d.rate)]) },
      suggestedFollowups: followups,
    };
  }

  // platform-wise (default): window + optional platform filter
  const w = resolveWindow(q, ren, 'renew_date', { defaultDays: 30 });
  const wanted = platformsWanted(t);
  const plansAsked = plansWanted(t);
  const records = filterPlans(filterPlatforms(w.records, wanted), plansAsked);
  const planScope = plansAsked.length ? ` (${plansAsked.map(nicePlan).join(' + ')} plans)` : '';
  if (!records.length) return NO_DATA(`renewal rows for ${w.label}${wanted.length ? ` on ${wanted.map((k) => platformLabel(k)).join(', ')}` : ''}${planScope}`);
  const plats = renewalsByPlatform(records);
  const agg = renewalsAgg(records);
  const best = [...plats].sort((a, b) => b.rate - a.rate)[0];
  const biggest = plats[0];
  return {
    domain: 'RENEWALS',
    text: `Here is the **platform-wise breakdown of renewals** for **${w.label}**${planScope} (overall renewal rate **${pct(agg.rate)}**, ${num(agg.renewed)} of ${num(agg.due)} due):\n\n` + plats.map((p) => `• **${p.name}**: **${pct(p.rate)}** renewal rate (${num(p.renewed)} renewed out of ${num(p.due)} due)`).join('\n'),
    kpis: [{ label: 'Overall renewal rate', value: pct(agg.rate), sub: w.kind === 'month' ? w.label : 'in the window' }, { label: 'Total due', value: num(agg.due), sub: `${num(agg.renewed)} renewed` }, { label: 'Best rate', value: best ? best.name : '—', sub: best ? pct(best.rate) : '' }],
    chart: bar(`Platform-wise renewal rate (%) — ${w.label}`, plats.map((p) => p.name), plats.map((p) => p.rate)),
    table: { headers: ['Platform', 'Due', 'Renewed', 'Renewal rate'], rows: plats.map((p) => [p.name, num(p.due), num(p.renewed), pct(p.rate)]) },
    suggestedFollowups: followups,
  };
}

// ===========================================================================
// SUBSCRIPTION / GTV
// ===========================================================================
export function answerSubscription(q, ctx = {}) {
  const sub = Array.isArray(ctx) ? ctx : (ctx.subscriptionData || []);
  const arpuRows = Array.isArray(ctx) ? [] : (ctx.arpuData || []);
  const t = String(q || '').toLowerCase();
  if (!sub.length) return NO_DATA('the subscription ledger', 'the Subscription Report tab loads it shortly after sign-in.');
  const followups = ['Which platform leads sales in the last 30 days?', 'GTV by marketing team for the last 7 days', 'Compare this week vs last week GTV'];

  // questions the ledger cannot answer
  if (/\broas\b|ad spend|\bspend\b|cost per|\bcac\b|\bcpa\b/.test(t)) {
    return notAvailable('SUBSCRIPTION', 'Marketing spend (and therefore ROAS / CAC)', 'I can show GTV and conversions by acquisition channel or marketing team — ask "GTV by channel" or "GTV by marketing team".', ['GTV by channel for the last 30 days', 'GTV by marketing team for the last 7 days']);
  }
  if (/(?<!marketing[\s_-])campaign(?!\s*theme)/.test(t)) {
    return notAvailable('SUBSCRIPTION', 'Campaign-level performance', 'The ledger carries the acquisition channel and sub-source per transaction, and the ARPU sheet carries the campaign theme — ask "GTV by channel", "GTV by sub-source" or "ARPU by campaign theme".', ['GTV by channel for the last 30 days', 'ARPU by campaign theme this month']);
  }

  // scopes that compose: window, platform(s), transaction type(s), geography, plan(s)
  const w = resolveWindow(q, sub, 'dateStr', { defaultDays: 30 });
  const wanted = platformsWanted(t);
  const types = txnTypesWanted(t);
  const geo = geoWanted(t);
  const plans = plansWanted(t);
  const applyScopes = (rows) => filterPlans(filterCountry(filterTxnTypes(filterPlatforms(rows, wanted), types), geo), plans);
  const scopeBits = [
    wanted.length ? wanted.map((k) => platformLabel(k)).join(' + ') : null,
    types.length ? `${types.map((x) => x.replace(/_/g, ' ')).join(' + ')} transactions` : null,
    geo ? (geo === 'india' ? 'India' : 'international') : null,
    plans.length ? `${plans.map(nicePlan).join(' + ')} plans` : null,
  ].filter(Boolean);
  const scope = scopeBits.length ? ` on ${scopeBits.join(', ')}` : '';

  // Team GTV: the ledger's `channel` column carries the marketing team on every
  // transaction, so team answers use the same rows (and the same window) as every
  // other GTV answer. The ARPU sheet is only a fallback when the ledger has no
  // team labels at all.
  const ledgerHasTeams = sub.some((r) => teamLabelOf(String(r.channel || '')) !== String(r.channel || '').trim());
  const teamRows = (teams) => {
    if (ledgerHasTeams) {
      const rows = applyScopes(w.records).filter((r) => teams.some((tm) => ledgerRowInTeam(r, tm)));
      return { rows, label: w.label, teamOf: ledgerTeamOf, source: 'ledger' };
    }
    if (!arpuRows.length) return { rows: [], label: w.label, teamOf: arpuTeamOf, source: 'none' };
    const wa = resolveWindow(q, arpuRows, 'dateStr', { defaultDays: 30 });
    const rows = filterPlans(filterTxnTypes(filterPlatforms(wa.records, wanted), types), plans).filter((r) => rowInTeams(teams, String(r.marketing_team || '')));
    return { rows, label: wa.label, teamOf: arpuTeamOf, source: 'arpu' };
  };

  // several teams named -> side-by-side team comparison
  const teamsNamed = teamsWanted(t).filter((tm) => tm.isRow);
  if (teamsNamed.length >= 2) {
    const { rows: rowsA, label: waLabel, teamOf } = teamRows(teamsNamed);
    const wa = { label: waLabel };
    const rows = subBy(rowsA, teamOf);
    if (rows.length < 2) return NO_DATA(`rows for ${teamsNamed.map((tm) => tm.label).join(' and ')} in ${wa.label}${scope}`);
    const [lead, ...rest] = rows;
    const trail = rows[rows.length - 1];
    const tot = subAgg(rowsA);
    return {
      domain: 'SUBSCRIPTION',
      insights: 'custom',
      text: `For ${wa.label}, **${lead.name}** leads with **${inr(lead.revenue)}** GTV (${num(lead.conversions)} conversions, ARPU ${inr(lead.arpu)}) against **${inr(trail.revenue)}** for **${trail.name}** (${num(trail.conversions)} conversions, ARPU ${inr(trail.arpu)}), a gap of **${inr(lead.revenue - trail.revenue)}** (${sgn(rate(lead.revenue - trail.revenue, trail.revenue))}%).\n\n` +
        rows.map((r) => `• **${r.name}**: **${inr(r.revenue)}** (${pct(r.share)} of the ${rows.length} teams' GTV, ${num(r.conversions)} conversions, ARPU ${inr(r.arpu)})`).join('\n'),
      kpis: rows.slice(0, 2).map((r) => ({ label: `${r.name} GTV`, value: inr(r.revenue), sub: `${num(r.conversions)} conversions · ARPU ${inr(r.arpu)}` })).concat([{ label: 'Gap', value: inr(lead.revenue - trail.revenue), sub: `${lead.name} ahead by ${sgn(rate(lead.revenue - trail.revenue, trail.revenue))}%` }]),
      chart: { type: 'grouped_bar', title: `GTV and conversions by team — ${wa.label}`, labels: rows.map((r) => r.name), series: [{ name: 'GTV (₹)', values: rows.map((r) => Math.round(r.revenue)), type: 'bar' }, { name: 'Conversions', values: rows.map((r) => r.conversions), type: 'bar' }] },
      table: { headers: ['Marketing team', 'GTV', 'Share of compared teams', 'Conversions', 'ARPU'], rows: rows.map((r) => [r.name, inr(r.revenue), pct(r.share), num(r.conversions), inr(r.arpu)]) },
      suggestedFollowups: [`${lead.name} funnel for the last 7 days, day-wise`, 'GTV by marketing team for the last 30 days', 'Which marketing team has the highest ARPU?'],
    };
  }

  // two periods compared
  if (/compare|\bvs\b|versus|growth|change|difference|week on week|month on month|\bwow\b|\bmom\b/.test(t) && !/day[\s-]?wise|daily/.test(t)) {
    const [pa, pb] = comparisonWindows(q, sub, 'dateStr');
    if (!pa || !pb) return NO_DATA('two periods to compare', 'name two months or say "this week vs last week".');
    const A = subAgg(applyScopes(pa.records)), B = subAgg(applyScopes(pb.records));
    if (!A.days || !B.days) return NO_DATA(`ledger rows for both periods${scope}`);
    const byA = subByPlatform(applyScopes(pa.records)), byB = subByPlatform(applyScopes(pb.records));
    const names = [...new Set([...byA.map((x) => x.name), ...byB.map((x) => x.name)])];
    const rows = names.map((n) => { const x = byA.find((p) => p.name === n) || { revenue: 0, conversions: 0 }; const y = byB.find((p) => p.name === n) || { revenue: 0, conversions: 0 }; return { name: n, a: x, b: y, delta: rate(x.revenue - y.revenue, y.revenue) }; }).sort((x, y) => y.a.revenue - x.a.revenue);
    const dailyNote = A.days !== B.days ? ` (${A.days} vs ${B.days} days, so the daily rates are the fair comparison)` : '';
    return {
      domain: 'SUBSCRIPTION',
      insights: 'custom',
      text: `GTV${scope} was **${inr(A.revenue)}** for ${pa.label} against **${inr(B.revenue)}** for ${pb.label}, a change of **${sgn(rate(A.revenue - B.revenue, B.revenue))}%**${dailyNote}. Daily GTV ran ${inr(A.dailyRevenue)} vs ${inr(B.dailyRevenue)} (**${sgn(rate(A.dailyRevenue - B.dailyRevenue, B.dailyRevenue))}%**) and conversions ${num(A.conversions)} vs ${num(B.conversions)} (**${sgn(rate(A.conversions - B.conversions, B.conversions))}%**).\n\n` +
        rows.map((r) => `• **${r.name}**: ${inr(r.b.revenue)} → **${inr(r.a.revenue)}** (${sgn(r.delta)}%)`).join('\n'),
      kpis: [{ label: pa.label.replace(/\s*\(.*\)$/, ''), value: inr(A.revenue), sub: `${inr(A.dailyRevenue)}/day` }, { label: pb.label.replace(/\s*\(.*\)$/, ''), value: inr(B.revenue), sub: `${inr(B.dailyRevenue)}/day` }, { label: 'Daily GTV change', value: `${sgn(rate(A.dailyRevenue - B.dailyRevenue, B.dailyRevenue))}%`, sub: `${sgn(rate(A.dailyConversions - B.dailyConversions, B.dailyConversions))}% conversions/day` }],
      chart: { type: 'grouped_bar', title: `GTV by platform: ${pa.label.replace(/\s*\(.*\)$/, '')} vs ${pb.label.replace(/\s*\(.*\)$/, '')}`, labels: rows.map((r) => r.name), series: [{ name: pa.label.replace(/\s*\(.*\)$/, ''), values: rows.map((r) => Math.round(r.a.revenue)), type: 'bar' }, { name: pb.label.replace(/\s*\(.*\)$/, ''), values: rows.map((r) => Math.round(r.b.revenue)), type: 'bar' }] },
      table: { headers: ['Platform', `${pa.label.replace(/\s*\(.*\)$/, '')} GTV`, `${pb.label.replace(/\s*\(.*\)$/, '')} GTV`, 'Change', 'Conversions (A)', 'Conversions (B)'], rows: rows.map((r) => [r.name, inr(r.a.revenue), inr(r.b.revenue), `${sgn(r.delta)}%`, num(r.a.conversions), num(r.b.conversions)]) },
      suggestedFollowups: followups,
    };
  }

  const records = applyScopes(w.records);
  const totals = subAgg(records);
  if (!records.length) return NO_DATA(`ledger rows for ${w.label}${scope}`);
  const splitAnswer = (title, dim, rows, extraFollowups) => ({
    domain: 'SUBSCRIPTION',
    text: `GTV by ${dim} for ${w.label}${scope} — **${inr(totals.revenue)}** from **${num(totals.conversions)}** conversions:\n\n` + rows.map((r) => `• **${r.name}**: **${inr(r.revenue)}** (${pct(r.share)} of GTV, ${num(r.conversions)} conversions, ARPU ${inr(r.arpu)})`).join('\n'),
    kpis: [{ label: 'GTV', value: inr(totals.revenue), sub: w.label.replace(/\s*\(.*\)$/, '') }, { label: `Top ${dim}`, value: rows[0].name, sub: `${pct(rows[0].share)} of GTV` }, { label: 'Conversions', value: num(totals.conversions), sub: `${num(totals.dailyConversions)}/day` }],
    chart: bar(`${title} — ${w.label}`, rows.map((r) => r.name), rows.map((r) => Math.round(r.revenue))),
    table: { headers: [dim.charAt(0).toUpperCase() + dim.slice(1), 'GTV', 'Share', 'Conversions', 'ARPU'], rows: rows.map((r) => [r.name, inr(r.revenue), pct(r.share), num(r.conversions), inr(r.arpu)]) },
    suggestedFollowups: extraFollowups || followups,
  });

  // marketing team split — one named team, or all teams side by side
  if (/marketing team|team[\s-]?wise|by team|per team|teams?\b.*(gtv|revenue|sales|conversion)|(gtv|revenue|sales|conversion).*\bteams?\b|telecall|product marketing|paid marketing|marketing campaign/.test(t)) {
    const team = teamWanted(t);
    let rowsA, wa, teamOf;
    if (team && team.isRow) ({ rows: rowsA, label: wa, teamOf } = teamRows([team]));
    else if (ledgerHasTeams) ({ rows: rowsA, label: wa, teamOf } = { rows: records, label: w.label, teamOf: ledgerTeamOf });
    else {
      if (!arpuRows.length) return NO_DATA('team labels (the ledger has no channel column and the ARPU sheet is not loaded)');
      const wr = resolveWindow(q, arpuRows, 'dateStr', { defaultDays: 30 });
      rowsA = filterPlans(filterTxnTypes(filterPlatforms(wr.records, wanted), types), plans); wa = wr.label; teamOf = arpuTeamOf;
    }
    wa = { label: wa };
    const tot = subAgg(rowsA);
    if (!rowsA.length) return NO_DATA(`${team ? `${team.label} ` : ''}transactions for ${wa.label}${scope}`);
    if (team && team.isRow) {
      const byP = subByPlatform(rowsA);
      return {
        domain: 'SUBSCRIPTION',
        insights: 'custom',
        text: `**${team.label}** delivered **${inr(tot.revenue)}** GTV for ${wa.label} from **${num(tot.conversions)}** conversions (ARPU ${inr(tot.arpu)}, ${inr(tot.dailyRevenue)}/day).\n\n` + byP.map((r) => `• **${r.name}**: ${inr(r.revenue)} (${pct(r.share)}), ${num(r.conversions)} conversions`).join('\n'),
        kpis: [{ label: `${team.label} GTV`, value: inr(tot.revenue), sub: wa.label.replace(/\s*\(.*\)$/, '') }, { label: 'Conversions', value: num(tot.conversions), sub: `${num(tot.dailyConversions)}/day` }, { label: 'ARPU', value: inr(tot.arpu), sub: 'per conversion' }],
        chart: bar(`${team.label} GTV by platform — ${wa.label}`, byP.map((r) => r.name), byP.map((r) => Math.round(r.revenue))),
        table: { headers: ['Platform', 'GTV', 'Share', 'Conversions', 'ARPU'], rows: byP.map((r) => [r.name, inr(r.revenue), pct(r.share), num(r.conversions), inr(r.arpu)]) },
        suggestedFollowups: ['GTV by marketing team for the last 30 days', `${team.label} funnel for the last 7 days, day-wise`, 'Which platform leads sales in the last 30 days?'],
      };
    }
    const rows = subBy(rowsA, teamOf);
    return {
      domain: 'SUBSCRIPTION',
      text: `GTV by marketing team for ${wa.label}${scope} — **${inr(tot.revenue)}** from **${num(tot.conversions)}** conversions:\n\n` + rows.map((r) => `• **${r.name}**: **${inr(r.revenue)}** (${pct(r.share)} of GTV, ${num(r.conversions)} conversions, ARPU ${inr(r.arpu)})`).join('\n'),
      kpis: [{ label: 'GTV', value: inr(tot.revenue), sub: wa.label.replace(/\s*\(.*\)$/, '') }, { label: 'Top team', value: rows[0].name, sub: `${pct(rows[0].share)} of GTV` }, { label: 'Conversions', value: num(tot.conversions), sub: `${num(tot.dailyConversions)}/day` }],
      chart: bar(`GTV by marketing team — ${wa.label}`, rows.map((r) => r.name), rows.map((r) => Math.round(r.revenue))),
      table: { headers: ['Marketing team', 'GTV', 'Share', 'Conversions', 'ARPU'], rows: rows.map((r) => [r.name, inr(r.revenue), pct(r.share), num(r.conversions), inr(r.arpu)]) },
      suggestedFollowups: ['Telecalling GTV for the last 7 days', 'Team-wise funnel for the last 7 days', 'ARPU by campaign theme this month'],
    };
  }

  if (/sub[\s-]?source/.test(t)) return splitAnswer('GTV by acquisition sub-source', 'sub-source', subBy(records, subSourceOf));
  if (/channel|acq(?:uisition)? source|\bsource\b/.test(t)) return splitAnswer('GTV by channel', 'channel', subByChannel(records));
  if (/user[\s-]?type|txn[\s-]?type|new vs renewal|new vs auto|renewal vs new|transaction type/.test(t)) return splitAnswer('GTV by user type', 'user type', subByTxnType(records));
  if (/by country|country[\s-]?wise|which countr|top countr|geograph|india vs international|international vs india/.test(t)) {
    const rows = subBy(records, countryOf).slice(0, 12);
    return splitAnswer('GTV by country', 'country', rows, ['International GTV for the last 30 days', 'India vs international funnel for the last 7 days']);
  }
  if (/hour|time of day|what time|peak time|hourly/.test(t)) {
    const rows = subByHour(records);
    if (!rows.length) return NO_DATA('transaction times in the ledger');
    const top = [...rows].sort((a, b) => b.revenue - a.revenue)[0];
    const total = rows.reduce((s2, r) => s2 + r.revenue, 0);
    const busiest = [...rows].sort((a, b) => b.conversions - a.conversions).slice(0, 3).map((r) => `${String(r.hour).padStart(2, '0')}:00`);
    return {
      domain: 'SUBSCRIPTION',
      insights: 'custom',
      text: `GTV by hour of day for ${w.label}${scope}: the strongest hour is **${String(top.hour).padStart(2, '0')}:00** with **${inr(top.revenue)}** (${pct(rate(top.revenue, total))} of GTV); the busiest hours by conversions are ${busiest.join(', ')}.`,
      kpis: [{ label: 'Peak hour (GTV)', value: `${String(top.hour).padStart(2, '0')}:00`, sub: inr(top.revenue) }, { label: 'GTV', value: inr(total), sub: w.label.replace(/\s*\(.*\)$/, '') }, { label: 'Conversions', value: num(rows.reduce((s2, r) => s2 + r.conversions, 0)), sub: 'with a transaction time' }],
      chart: bar(`GTV by hour of day — ${w.label}`, rows.map((r) => `${String(r.hour).padStart(2, '0')}:00`), rows.map((r) => Math.round(r.revenue))),
      table: { headers: ['Hour', 'GTV', 'Conversions'], rows: rows.map((r) => [`${String(r.hour).padStart(2, '0')}:00`, inr(r.revenue), num(r.conversions)]) },
      suggestedFollowups: followups,
    };
  }
  if (/\bplan|1 year|1 month|2 year|3 year|annual|tenure/.test(t) && !/platform/.test(t) && !plans.length) {
    const rows = subByPlan(records).map((r) => ({ ...r, name: nicePlan(r.name) }));
    return splitAnswer('GTV by plan', 'plan', rows);
  }

  // single day
  if (w.kind === 'day') {
    const rows = subByPlatform(records);
    return {
      domain: 'SUBSCRIPTION',
      text: `On **${w.label}**${scope}: **${inr(totals.revenue)}** GTV from **${num(totals.conversions)}** conversions (ARPU ${inr(totals.arpu)}).\n\n` + rows.map((r) => `• **${r.name}**: ${inr(r.revenue)} (${pct(r.share)}), ${num(r.conversions)} conversions`).join('\n'),
      kpis: [{ label: 'GTV', value: inr(totals.revenue), sub: w.label }, { label: 'Conversions', value: num(totals.conversions), sub: `ARPU ${inr(totals.arpu)}` }, { label: 'Top platform', value: rows[0]?.name || '—', sub: rows[0] ? pct(rows[0].share) : '' }],
      chart: bar(`GTV by platform — ${w.label}`, rows.map((r) => r.name), rows.map((r) => Math.round(r.revenue))),
      table: { headers: ['Platform', 'GTV', 'Share', 'Conversions', 'ARPU'], rows: rows.map((r) => [r.name, inr(r.revenue), pct(r.share), num(r.conversions), inr(r.arpu)]) },
      suggestedFollowups: followups,
    };
  }

  // daily trend
  if (/day[\s-]?wise|daily|by date|day by day|each day|trend|per day|trajectory/.test(t)) {
    const daily = subDaily(records);
    const wantsConv = /conversion|volume|count|sold/.test(t) && !/gtv|revenue/.test(t);
    return {
      domain: 'SUBSCRIPTION',
      text: `Daily ${wantsConv ? 'conversions' : 'GTV'} for ${w.label}${scope}: **${inr(totals.revenue)}** in total (**${inr(totals.dailyRevenue)}/day**) from **${num(totals.conversions)}** conversions (${num(totals.dailyConversions)}/day).`,
      kpis: [{ label: 'GTV', value: inr(totals.revenue), sub: `${inr(totals.dailyRevenue)}/day` }, { label: 'Conversions', value: num(totals.conversions), sub: `${num(totals.dailyConversions)}/day` }, { label: 'ARPU', value: inr(totals.arpu), sub: w.label.replace(/\s*\(.*\)$/, '') }],
      chart: line(wantsConv ? `Daily conversions — ${w.label}${scope}` : `Daily GTV (₹) — ${w.label}${scope}`, daily.map((d) => d.date), daily.map((d) => (wantsConv ? d.conversions : Math.round(d.revenue)))),
      table: { headers: ['Date', 'GTV', 'Conversions'], rows: daily.map((d) => [d.date, inr(d.revenue), num(d.conversions)]) },
      suggestedFollowups: followups,
    };
  }

  // platform share / leader (also the answer for a named platform or any scoped total)
  const rows = subByPlatform(records);
  const lead = rows[0];
  const head = scopeBits.length
    ? `GTV${scope} for ${w.label} was **${inr(totals.revenue)}** from **${num(totals.conversions)}** conversions (ARPU ${inr(totals.arpu)}, ${inr(totals.dailyRevenue)}/day).`
    : `**${lead.name}** leads GTV for ${w.label} with **${inr(lead.revenue)}** (**${pct(lead.share)}** of ${inr(totals.revenue)}) from ${num(lead.conversions)} conversions.`;
  return {
    domain: 'SUBSCRIPTION',
    text: `${head}\n\n` + rows.map((r) => `• **${r.name}**: **${inr(r.revenue)}** (${pct(r.share)} of GTV, ${num(r.conversions)} conversions, ARPU ${inr(r.arpu)})`).join('\n'),
    kpis: [{ label: 'GTV', value: inr(totals.revenue), sub: `${inr(totals.dailyRevenue)}/day` }, { label: scopeBits.length ? 'Conversions' : 'Leading platform', value: scopeBits.length ? num(totals.conversions) : lead.name, sub: scopeBits.length ? `ARPU ${inr(totals.arpu)}` : `${pct(lead.share)} of GTV` }, { label: 'Conversions', value: num(totals.conversions), sub: `${num(totals.dailyConversions)}/day` }],
    chart: bar(`GTV by platform — ${w.label}${scope}`, rows.map((r) => r.name), rows.map((r) => Math.round(r.revenue))),
    table: { headers: ['Platform', 'GTV', 'Share', 'Conversions', 'ARPU'], rows: rows.map((r) => [r.name, inr(r.revenue), pct(r.share), num(r.conversions), inr(r.arpu)]) },
    suggestedFollowups: followups,
  };
}

// ===========================================================================
// ARPU (arpu_data sheet: campaign theme, offer, sale status, marketing team)
// ===========================================================================
export function answerArpu(q, ctx = {}) {
  const rowsAll = ctx.arpuData || [];
  const t = String(q || '').toLowerCase();
  if (!rowsAll.length) return NO_DATA('the ARPU sheet', 'the ARPU tab loads it shortly after sign-in.');
  const includeAuto = /includ(e|ing) auto|with auto/.test(t);
  const w = resolveWindow(q, rowsAll, 'dateStr', { defaultDays: 30 });
  const wanted = platformsWanted(t);
  const plans = plansWanted(t);
  const teamsNamed = teamsWanted(t).filter((tm) => tm.isRow);
  const team = teamsNamed.length === 1 ? teamsNamed[0] : null;
  let records = arpuBase(filterPlans(filterPlatforms(w.records, wanted), plans), includeAuto);
  if (team) records = records.filter((r) => team.isRow(String(r.marketing_team || '')));
  else if (teamsNamed.length >= 2) records = records.filter((r) => rowInTeams(teamsNamed, String(r.marketing_team || '')));
  const scopeBits = [wanted.length ? wanted.map((k) => platformLabel(k)).join(' + ') : null, plans.length ? `${plans.map(nicePlan).join(' + ')} plans` : null, team && team.isRow ? `${team.label} team` : null].filter(Boolean);
  const scope = scopeBits.length ? ` on ${scopeBits.join(', ')}` : '';
  const basis = includeAuto ? 'all transactions' : 'auto-renewals excluded';
  if (!records.length) return NO_DATA(`ARPU rows for ${w.label}${scope}`);
  const totals = subAgg(records);
  const followups = ['ARPU by campaign theme this month', 'ARPU by offer for the last 30 days', 'Which marketing team has the highest ARPU?'];

  let dim = null, keyFn = null;
  if (/theme|campaign/.test(t)) { dim = 'campaign theme'; keyFn = arpuThemeOf; }
  else if (/\boffer/.test(t)) { dim = 'offer'; keyFn = arpuOfferOf; }
  else if (/sale status|status/.test(t)) { dim = 'sale status'; keyFn = arpuStatusOf; }
  else if ((/team/.test(t) || teamsNamed.length >= 2) && !team) { dim = 'marketing team'; keyFn = arpuTeamOf; }
  else if (/\bplan/.test(t) && !plans.length) { dim = 'plan'; keyFn = (r) => nicePlan(planKeyOf(r) || 'UNKNOWN'); }
  else if (/user[\s-]?type|txn[\s-]?type/.test(t)) { dim = 'user type'; keyFn = txnTypeOfArpu; }
  else if (/platform/.test(t) || !/trend|daily|day[\s-]?wise/.test(t)) { dim = 'platform'; keyFn = (r) => platformLabel(r.platform); }

  if (dim) {
    const rows = arpuBy(records, keyFn).filter((r) => r.conversions > 0);
    if (!rows.length) return NO_DATA(`ARPU rows by ${dim} for ${w.label}${scope}`);
    const top = rows[0], bottom = rows[rows.length - 1];
    return {
      domain: 'ARPU',
      insights: 'custom',
      text: `ARPU by ${dim} for ${w.label}${scope} (${basis}): blended ARPU is **${inr(totals.arpu)}** on ${num(totals.conversions)} conversions. **${top.name}** yields the most at **${inr(top.arpu)}**${rows.length > 1 ? ` and **${bottom.name}** the least at **${inr(bottom.arpu)}**` : ''}.\n\n` +
        rows.map((r) => `• **${r.name}**: **${inr(r.arpu)}** ARPU (${num(r.conversions)} conversions, ${inr(r.revenue)} GTV, ${pct(r.convShare)} of volume)`).join('\n'),
      kpis: [{ label: 'Blended ARPU', value: inr(totals.arpu), sub: basis }, { label: `Top ${dim}`, value: top.name, sub: inr(top.arpu) }, { label: 'Conversions', value: num(totals.conversions), sub: w.label.replace(/\s*\(.*\)$/, '') }],
      chart: bar(`ARPU (₹) by ${dim} — ${w.label}`, rows.map((r) => r.name), rows.map((r) => Math.round(r.arpu))),
      table: { headers: [dim.charAt(0).toUpperCase() + dim.slice(1), 'ARPU', 'Conversions', 'GTV', 'Volume share'], rows: rows.map((r) => [r.name, inr(r.arpu), num(r.conversions), inr(r.revenue), pct(r.convShare)]) },
      suggestedFollowups: followups,
    };
  }

  // trend
  const daily = subDaily(records).map((d) => ({ ...d, arpu: d.conversions > 0 ? d.revenue / d.conversions : 0 }));
  return {
    domain: 'ARPU',
    text: `Daily ARPU for ${w.label}${scope} (${basis}): blended **${inr(totals.arpu)}** over ${num(totals.conversions)} conversions and ${inr(totals.revenue)} GTV.`,
    kpis: [{ label: 'Blended ARPU', value: inr(totals.arpu), sub: basis }, { label: 'GTV', value: inr(totals.revenue), sub: w.label.replace(/\s*\(.*\)$/, '') }, { label: 'Conversions', value: num(totals.conversions), sub: `${num(totals.dailyConversions)}/day` }],
    chart: line(`Daily ARPU (₹) — ${w.label}${scope}`, daily.map((d) => d.date), daily.map((d) => Math.round(d.arpu))),
    table: { headers: ['Date', 'ARPU', 'Conversions', 'GTV'], rows: daily.map((d) => [d.date, inr(d.arpu), num(d.conversions), inr(d.revenue)]) },
    suggestedFollowups: followups,
  };
}
const txnTypeOfArpu = (r) => String(r.user_txn_type || 'unknown').trim().toLowerCase().replace(/_/g, ' ');

// ===========================================================================
// GENERAL Q&A tool (Gemini) — same facts as the overview, as plain data
// ===========================================================================
export function generalQAFacts(ctx = {}) {
  const o = overviewStats(ctx);
  return {
    subscriptions: o.sub ? { rows: o.sub.rows, from: o.sub.from, to: o.sub.to, totalGTV: inr(o.sub.all.revenue), last30dGTV: inr(o.sub.w30.revenue), last30dDailyAvg: inr(o.sub.w30.dailyRevenue), last30dConversions: o.sub.w30.conversions, topPlatform: o.sub.topPlatform ? `${o.sub.topPlatform.name} (${pct(o.sub.topPlatform.share)} of GTV)` : null } : 'not loaded',
    renewals: o.ren ? { from: o.ren.from, to: o.ren.to, overallRate: pct(o.ren.agg.rate), months: o.ren.months.map((m) => ({ month: m.label, due: m.due, renewed: m.renewed, rate: pct(m.rate) })) } : 'not loaded',
    funnel: o.fun ? { window: `${o.fun.from} to ${o.fun.to}`, dailyAvg: { dau: o.fun.avg.dau, paywallHits: o.fun.avg.hits, planPageLoads: o.fun.avg.loads, purchased: o.fun.avg.purchased }, loadToPurchase: pct(o.fun.avg.rates.purchasedPctLoads, 2) } : 'not loaded',
  };
}
