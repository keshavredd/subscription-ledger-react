/**
 * Insights Hub reset — lists (and, with --delete, removes) every document in
 * the Firestore collection `insight_reports` of the dashboard's Firebase
 * project. Nothing else is touched (alert_catalog, alert_optins, admin_* stay).
 *
 * Usage (from the repo root or this folder):
 *   node cloud_run_weekly_report/tools/purge_insight_reports.cjs            # dry run: list only
 *   node cloud_run_weekly_report/tools/purge_insight_reports.cjs --delete   # delete everything listed
 *
 * Credentials: the Firebase Admin SDK key of subscription-ledger-849a8.
 *   Default path: %USERPROFILE%\Downloads\subscription-ledger-849a8-firebase-adminsdk-fbsvc-33117a2a6e.json
 *   Override with FIREBASE_SA_KEY=<path>.
 *
 * firebase-admin: resolved from the nearest node_modules; if the repo does not
 * have it, `npm i --no-save firebase-admin` once, or point NODE_PATH at a folder
 * that has it.
 */
const path = require('path');
const os = require('os');

function load(mod) {
  try { return require(mod); } catch (_) { /* fall through */ }
  throw new Error(`${mod} not found — run "npm i --no-save firebase-admin" in the repo root, or set NODE_PATH to a node_modules that has it.`);
}
const { initializeApp, cert } = load('firebase-admin/app');
const { getFirestore } = load('firebase-admin/firestore');

const keyPath = process.env.FIREBASE_SA_KEY
  || path.join(os.homedir(), 'Downloads', 'subscription-ledger-849a8-firebase-adminsdk-fbsvc-33117a2a6e.json');
const doDelete = process.argv.includes('--delete');

initializeApp({ credential: cert(require(keyPath)) });
const db = getFirestore();

(async () => {
  const snap = await db.collection('insight_reports').get();
  console.log(`insight_reports: ${snap.size} document(s)`);
  const rows = snap.docs.map(d => {
    const x = d.data() || {};
    return { id: d.id, type: x.reportType, week: `${x.weekStart} .. ${x.weekEnd}`, schema: x.schemaVersion ?? 1, source: x.narrative?.source ?? '-', generated: x.generatedAt };
  });
  rows.sort((a, b) => String(a.week).localeCompare(String(b.week)) || String(a.id).localeCompare(String(b.id)));
  for (const r of rows) console.log(`  ${r.id.padEnd(42)} ${r.week}  schema=${r.schema}  narrative=${r.source}  generated=${r.generated}`);

  if (!doDelete) {
    console.log('\nDry run only. Re-run with --delete to remove all of the above.');
    return;
  }
  if (snap.empty) { console.log('Nothing to delete.'); return; }

  // Firestore batches take up to 500 writes; chunk defensively.
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(400, docs.length - i);
  }
  const after = await db.collection('insight_reports').count().get();
  console.log(`\nDeleted ${deleted} document(s). insight_reports now holds ${after.data().count}.`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
