/**
 * Run the OneDrive resume poller directly (bypasses HTTP route).
 * Usage: npx tsx scripts/run-onedrive-poller.ts
 */
import fs from 'fs';
import path from 'path';

// Load .env.local
const envPath = path.resolve(__dirname, '../.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}

// Data residency env vars required by persistence module
process.env.CBL_APPROVED_US_REGIONS ??= 'us-east-1,us-west-2';
process.env.CBL_DATA_REGION ??= 'us-west-2';
process.env.CBL_LOG_REGION ??= 'us-west-2';
process.env.CBL_BACKUP_REGION ??= 'us-west-2';

async function main() {
  // Dynamic import after env is set
  const { OneDriveResumePollerJob } = await import('../src/modules/ingestion/jobs');

  console.log('=== OneDrive Resume Poller — Manual Run ===\n');
  const job = new OneDriveResumePollerJob();
  await job.run();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
