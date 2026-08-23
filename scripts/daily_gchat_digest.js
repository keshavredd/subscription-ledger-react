import Papa from 'papaparse';
import https from 'https';
import http from 'http';

/**
 * DATASET URLS
 */
const DATASET_URLS = {
  subscription: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
  renewals: "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw"
};

/**
 * Strict date parsing helper
 * Converts various date formats (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY) to YYYY-MM-DD
 */
function parseStrictDate(rawDateStr) {
  if (!rawDateStr) return '';
  const s = String(rawDateStr).trim();
  
  let year, month, day;
  
  if (s.includes('-') && s.split('-')[0].length === 4) {
    const parts = s.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2].substring(0, 2), 10);
  } else if (s.includes('/')) {
    const parts = s.split('/');
    if (parts[0].length === 4) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2].substring(0, 2), 10);
    } else if (parts.length === 3) {
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2].substring(0, 4), 10);
    }
  } else {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
      day = d.getDate();
    }
  }
  
  if (!year || !month || !day || isNaN(year) || isNaN(month) || isNaN(day)) {
    return '';
  }
  
  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Helper to add/subtract days from a date string (YYYY-MM-DD)
 */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Format currency in Indian Rupees (₹) with Lakhs/Thousands formatting
 */
function formatCurrency(amount) {
  if (isNaN(amount) || amount === 0) return '₹0';
  const val = Math.abs(amount);
  if (val >= 100000) {
    const lakhs = (amount / 100000).toFixed(2);
    return `₹${lakhs} L`;
  } else if (val >= 1000) {
    const thousands = (amount / 1000).toFixed(1);
    return `₹${thousands} K`;
  }
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/**
 * Normalize Platform names
 */
function normalizePlatform(rawPlatform) {
  if (!rawPlatform) return 'Web';
  const str = String(rawPlatform).trim().toLowerCase();

  if (str.includes('market') && str.includes('android')) return 'Market Android';
  if (str.includes('market') && str.includes('ios')) return 'Market iOS';
  if (str.includes('main') && str.includes('android')) return 'Main Android';
  if (str.includes('main') && str.includes('ios')) return 'Main iOS';

  if (str === 'android' || str.includes('android')) return 'Main Android';
  if (str === 'ios' || str.includes('ios') || str.includes('apple')) return 'Main iOS';

  if (str.includes('wap') || str.includes('mweb')) return 'WAP';
  if (str.includes('web') || str.includes('desktop') || str.includes('site')) return 'Web';

  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Normalize Channel / Marketing Team names
 */
function normalizeChannel(rawChannel) {
  if (!rawChannel) return 'Organic / Direct';
  const str = String(rawChannel).trim();
  if (!str || str.toLowerCase() === 'unknown' || str.toLowerCase() === 'others') return 'Organic / Direct';
  return str;
}

/**
 * Normalize User Txn Type
 */
function normalizeTxnType(rawType) {
  if (!rawType) return 'New Acquisition';
  const str = String(rawType).trim().toLowerCase();
  if (str.includes('auto')) return 'Auto Renewal';
  if (str.includes('manual') || str.includes('renew')) return 'Manual Renewal';
  if (str.includes('new') || str.includes('fresh') || str.includes('acq')) return 'New Acquisition';
  if (str.includes('upgrade')) return 'Upgrade';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
/**
 * Fetch text content with redirect following
 */
function fetchTextWithRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        return fetchTextWithRedirects(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/**
 * Fetch and parse CSV from URL
 */
async function fetchCSV(url) {
  const text = await fetchTextWithRedirects(url);
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err)
    });
  });
}

/**
 * Main execution function
 */
async function run() {
  const isDryRun = process.argv.includes('--dry-run') || !process.env.GCHAT_WEBHOOK_URL;
  const webhookUrl = process.env.GCHAT_WEBHOOK_URL;
  
  // Custom target date option (e.g. node scripts/daily_gchat_digest.js --date=2026-08-22)
  const dateArg = process.argv.find(a => a.startsWith('--date='));
  let targetDate = dateArg ? dateArg.split('=')[1] : null;

  console.log('🔄 Fetching datasets from Google Sheets...');
  const [rawSubData, rawRenewalData] = await Promise.all([
    fetchCSV(DATASET_URLS.subscription),
    fetchCSV(DATASET_URLS.renewals)
  ]);

  console.log(`✅ Loaded ${rawSubData.length} subscription rows & ${rawRenewalData.length} renewal rows.`);

  // Process & Clean Subscription Rows
  const cleanedSub = [];
  const datesSet = new Set();

  for (const row of rawSubData) {
    const cleanRow = {};
    Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);

    const dateStr = parseStrictDate(cleanRow['txn_date']);
    if (!dateStr) continue;

    datesSet.add(dateStr);
    const revenue = parseFloat(cleanRow['revenue_above_rs_6_txn']) || 0.0;
    const conversion = parseInt(cleanRow['conversion'], 10) || 1;
    const platform = normalizePlatform(cleanRow['platform'] || cleanRow['et_platform']);
    const channel = normalizeChannel(cleanRow['channel'] || cleanRow['marketing_team']);
    const rawTxnType = String(cleanRow['user_txn_type'] || '').trim().toLowerCase();
    const txnType = normalizeTxnType(rawTxnType);
    const isAutoRenew = String(cleanRow['auto_renew'] || '').trim().toLowerCase() === 'true' || rawTxnType.includes('auto');

    cleanedSub.push({
      dateStr,
      revenue,
      conversion,
      platform,
      channel,
      txnType,
      rawTxnType,
      isAutoRenew
    });
  }

  // Sorted available dates descending
  const availableDates = Array.from(datesSet).sort().reverse();
  
  if (availableDates.length === 0) {
    console.error('❌ No valid dates found in subscription dataset!');
    process.exit(1);
  }

  // Determine target "Yesterday" date
  if (!targetDate) {
    // Calculate actual yesterday in IST
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    nowIST.setDate(nowIST.getDate() - 1);
    const yesterdayStr = nowIST.toISOString().split('T')[0];

    // If yesterday is present in data, use it; otherwise fallback to latest date in dataset
    if (datesSet.has(yesterdayStr)) {
      targetDate = yesterdayStr;
    } else {
      targetDate = availableDates[0];
      console.warn(`⚠️ Target date yesterday (${yesterdayStr}) not in dataset. Using latest available date: ${targetDate}`);
    }
  }

  console.log(`📅 Target Date for Report: ${targetDate}`);

  // Calculate 4 Benchmark Dates (Same day of week for previous 4 weeks)
  const benchmarkDates = [
    addDays(targetDate, -7),
    addDays(targetDate, -14),
    addDays(targetDate, -21),
    addDays(targetDate, -28)
  ];

  console.log(`📊 Benchmark Dates (4-Week Same-Day):`, benchmarkDates.join(', '));

  // Helper to compute dataset stats for a given list of dates
  function computeStats(targetDates) {
    const datesGroup = new Set(targetDates);
    const rows = cleanedSub.filter(r => datesGroup.has(r.dateStr));

    const totalSub = rows.reduce((acc, r) => acc + r.conversion, 0);
    const totalRev = rows.reduce((acc, r) => acc + r.revenue, 0);

    const nonAutoRows = rows.filter(r => !r.rawTxnType.includes('auto_renewal') && !r.rawTxnType.includes('auto'));
    const nonAutoSub = nonAutoRows.reduce((acc, r) => acc + r.conversion, 0);
    const nonAutoRev = nonAutoRows.reduce((acc, r) => acc + r.revenue, 0);

    const recurringSub = rows.filter(r => r.isAutoRenew).reduce((acc, r) => acc + r.conversion, 0);

    const platformRev = {};
    const channelRev = {};
    const txnTypeRev = {};

    rows.forEach(r => {
      platformRev[r.platform] = (platformRev[r.platform] || 0) + r.revenue;
      channelRev[r.channel] = (channelRev[r.channel] || 0) + r.revenue;
      txnTypeRev[r.txnType] = (txnTypeRev[r.txnType] || 0) + r.revenue;
    });

    return {
      count: rows.length,
      daysCount: targetDates.length,
      totalSub,
      totalRev,
      arpuOverall: totalSub > 0 ? totalRev / totalSub : 0,
      nonAutoSub,
      nonAutoRev,
      arpuExclAuto: nonAutoSub > 0 ? nonAutoRev / nonAutoSub : 0,
      recurringSub,
      platformRev,
      channelRev,
      txnTypeRev
    };
  }

  // Calculate Yesterday's Stats
  const yesterdayStats = computeStats([targetDate]);

  // Calculate 4-Week Benchmark Stats
  const benchRawStats = computeStats(benchmarkDates);
  const numBenchDays = benchmarkDates.filter(d => datesSet.has(d)).length || 4;

  const benchStats = {
    totalSub: benchRawStats.totalSub / numBenchDays,
    totalRev: benchRawStats.totalRev / numBenchDays,
    arpuOverall: benchRawStats.totalSub > 0 ? benchRawStats.totalRev / benchRawStats.totalSub : 0,
    arpuExclAuto: benchRawStats.nonAutoSub > 0 ? benchRawStats.nonAutoRev / benchRawStats.nonAutoSub : 0,
    platformRev: {},
    channelRev: {},
    txnTypeRev: {}
  };

  Object.keys(benchRawStats.platformRev).forEach(k => benchStats.platformRev[k] = benchRawStats.platformRev[k] / numBenchDays);
  Object.keys(benchRawStats.channelRev).forEach(k => benchStats.channelRev[k] = benchRawStats.channelRev[k] / numBenchDays);
  Object.keys(benchRawStats.txnTypeRev).forEach(k => benchStats.txnTypeRev[k] = benchRawStats.txnTypeRev[k] / numBenchDays);

  // Process Renewals Data for Renewal Rate
  const cleanedRenewals = [];
  rawRenewalData.forEach(row => {
    const cleanRow = {};
    Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);
    const rDate = parseStrictDate(cleanRow['renew_date']);
    if (rDate) {
      cleanedRenewals.push({
        dateStr: rDate,
        due: parseInt(cleanRow['renewal_due'], 10) || 0,
        renewed: parseInt(cleanRow['renewed'], 10) || 0
      });
    }
  });

  const yestRenewals = cleanedRenewals.filter(r => r.dateStr === targetDate);
  const yestDue = yestRenewals.reduce((acc, r) => acc + r.due, 0);
  const yestRenewed = yestRenewals.reduce((acc, r) => acc + r.renewed, 0);
  const renewalRate = yestDue > 0 ? ((yestRenewed / yestDue) * 100).toFixed(1) : 'N/A';

  const benchRenewals = cleanedRenewals.filter(r => benchmarkDates.includes(r.dateStr));
  const benchDue = benchRenewals.reduce((acc, r) => acc + r.due, 0);
  const benchRenewed = benchRenewals.reduce((acc, r) => acc + r.renewed, 0);
  const benchRenewalRate = benchDue > 0 ? ((benchRenewed / benchDue) * 100).toFixed(1) : 'N/A';

  // Helper for formatting % difference
  function formatVar(current, bench) {
    if (!bench || bench === 0) return '';
    const diff = ((current - bench) / bench) * 100;
    const sign = diff >= 0 ? '+' : '';
    const emoji = diff >= 0 ? '🟢' : '🔴';
    return ` \`[4W Avg: ${typeof bench === 'number' && bench > 1000 ? formatCurrency(bench) : Math.round(bench)} | ${emoji} ${sign}${diff.toFixed(1)}%]\``;
  }

  // Format Date for Card Title
  const [y, m, d] = targetDate.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const monthName = dateObj.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const formattedDateHeader = `${dayName}, ${monthName} ${d}, ${y}`;

  // Build Platform Breakdown Text
  const platformLines = Object.entries(yesterdayStats.platformRev)
    .sort((a, b) => b[1] - a[1])
    .map(([platform, rev]) => {
      const share = yesterdayStats.totalRev > 0 ? ((rev / yesterdayStats.totalRev) * 100).toFixed(1) : '0';
      const benchRev = benchStats.platformRev[platform] || 0;
      const varText = formatVar(rev, benchRev);
      return `• *${platform}:* ${formatCurrency(rev)} (${share}%)${varText}`;
    })
    .join('\n');

  // Build Channel Breakdown Text
  const channelLines = Object.entries(yesterdayStats.channelRev)
    .sort((a, b) => b[1] - a[1])
    .map(([channel, rev]) => {
      const share = yesterdayStats.totalRev > 0 ? ((rev / yesterdayStats.totalRev) * 100).toFixed(1) : '0';
      return `• *${channel}:* ${formatCurrency(rev)} (${share}%)`;
    })
    .join('\n');

  // Build User Txn Type Breakdown Text
  const txnTypeLines = Object.entries(yesterdayStats.txnTypeRev)
    .sort((a, b) => b[1] - a[1])
    .map(([type, rev]) => {
      const share = yesterdayStats.totalRev > 0 ? ((rev / yesterdayStats.totalRev) * 100).toFixed(1) : '0';
      return `• *${type}:* ${formatCurrency(rev)} (${share}%)`;
    })
    .join('\n');

  // Build Recurring Plans Text
  const recurringPct = yesterdayStats.totalSub > 0 
    ? ((yesterdayStats.recurringSub / yesterdayStats.totalSub) * 100).toFixed(1) 
    : '0';

  // Construct Google Chat Card Payload
  const messageText = `📊 *ET Prime Daily Performance Report*
🗓 *Date:* ${formattedDateHeader}
⚖️ _Benchmark: 4-Week Same-Day Average (${dayName}s)_

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
💰 *HIGH-LEVEL METRICS & ARPU*
• *Total Subscriptions:* *${yesterdayStats.totalSub.toLocaleString('en-IN')}*${formatVar(yesterdayStats.totalSub, benchStats.totalSub)}
• *Total Revenue:* *${formatCurrency(yesterdayStats.totalRev)}*${formatVar(yesterdayStats.totalRev, benchStats.totalRev)}
• *Overall ARPU:* *₹${Math.round(yesterdayStats.arpuOverall).toLocaleString('en-IN')}*${formatVar(yesterdayStats.arpuOverall, benchStats.arpuOverall)}
• *ARPU (Excl. Auto-Renewal):* *₹${Math.round(yesterdayStats.arpuExclAuto).toLocaleString('en-IN')}*${formatVar(yesterdayStats.arpuExclAuto, benchStats.arpuExclAuto)}

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
📱 *PLATFORM REVENUE BREAKDOWN*
${platformLines || '• No platform data available'}

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
📢 *CHANNEL REVENUE BREAKDOWN*
${channelLines || '• No channel data available'}

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
🔄 *USER TXN TYPE REVENUE BREAKDOWN*
${txnTypeLines || '• No transaction type data available'}

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
📌 Renewal Rate: *${renewalRate}%* (4W Avg: ${benchRenewalRate}%) | Recurring Plans Sold: *${yesterdayStats.recurringSub} (${recurringPct}%)*`;

  console.log('\n--- GENERATED GCHAT MESSAGE PAYLOAD ---');
  console.log(messageText);
  console.log('----------------------------------------\n');

  if (isDryRun) {
    console.log('ℹ️ Running in DRY-RUN mode. Message was not posted to Google Chat.');
    console.log('To send live messages, set GCHAT_WEBHOOK_URL environment variable.');
    return;
  }

  // Post message to Google Chat webhook
  console.log('🚀 Sending message to Google Chat webhook...');
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text: messageText })
  });

  if (res.ok) {
    console.log('🎉 Successfully delivered daily report to Google Chat Space!');
  } else {
    const errText = await res.text();
    console.error(`❌ Failed to post to Google Chat: HTTP ${res.status} - ${errText}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('❌ Critical script execution error:', err);
  process.exit(1);
});
