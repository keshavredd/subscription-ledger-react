/**
 * scheduled_sync.js
 * Hourly sync runner: Automatically triggers node scripts/sync_to_turso.js at the 20th minute of every hour.
 */
import { exec } from 'child_process';

function getMsUntilNextMinute20() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(20, 0, 0);
  if (now.getMinutes() >= 20) {
    next.setHours(next.getHours() + 1);
  }
  return next.getTime() - now.getTime();
}

function runSync() {
  const timestamp = new Date().toLocaleString();
  console.log(`\n⏰ [${timestamp}] Running scheduled hourly sync to Turso DB...`);
  
  exec('node scripts/sync_to_turso.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Sync error:`, error);
      scheduleNext();
      return;
    }
    console.log(stdout);
    console.log(`✅ [${new Date().toLocaleString()}] Hourly sync completed successfully.`);
    scheduleNext();
  });
}

function scheduleNext() {
  const ms = getMsUntilNextMinute20();
  const nextTime = new Date(Date.now() + ms).toLocaleTimeString();
  console.log(`📅 Next automated sync scheduled for ${nextTime} (in ${Math.round(ms / 60000)} mins)`);
  setTimeout(runSync, ms);
}

console.log("🚀 Turso DB Hourly Sync Daemon started.");
scheduleNext();
