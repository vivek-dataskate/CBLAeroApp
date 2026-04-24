/**
 * Scan a OneDrive folder tree and report file types found.
 * Read-only — does not modify anything.
 *
 * Usage: npx tsx scripts/scan-onedrive-extensions.ts [folderPath]
 *   defaults to CBL_ONEDRIVE_RESUME_PATH or 'CBLAeroCons/Resumes'
 */
import fs from 'fs';
import path from 'path';

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
process.env.CBL_APPROVED_US_REGIONS ??= 'us-east-1,us-west-2';
process.env.CBL_DATA_REGION ??= 'us-west-2';
process.env.CBL_LOG_REGION ??= 'us-west-2';
process.env.CBL_BACKUP_REGION ??= 'us-west-2';

const FOLDER_PATH = process.argv[2] || process.env.CBL_ONEDRIVE_RESUME_PATH?.trim() || 'CBLAeroCons/Resumes';
const PAGE_SIZE = 200;

async function main() {
  const { ensureProvidersInitialized } = await import('../src/modules/providers');
  const { getSharedGraphClient } = await import('../src/modules/providers/graph');

  await ensureProvidersInitialized();
  const graph = getSharedGraphClient();
  if (!graph) throw new Error('Graph not configured');

  const driveUser = process.env.CBL_ONEDRIVE_USER?.trim() || 'vivek@cblsolutions.com';
  const userEnc = encodeURIComponent(driveUser);

  console.log(`Scanning ${FOLDER_PATH} for ${driveUser}...\n`);

  // Resolve root
  const rootResult = await graph.get<{ id: string }>(`/users/${userEnc}/drive/root:/${FOLDER_PATH}`);
  if (!rootResult.ok || !rootResult.data?.id) {
    throw new Error(`Cannot find folder: ${FOLDER_PATH} (${rootResult.status})`);
  }
  const rootId = rootResult.data.id;

  // BFS collect every file
  const extCounts = new Map<string, number>();
  const noExtCount = { value: 0 };
  const examplesByExt = new Map<string, string[]>();
  let totalFiles = 0;
  let totalFolders = 0;

  type GraphItem = { id: string; name: string; size: number; file?: object; folder?: object };
  type Page = { value: GraphItem[]; '@odata.nextLink'?: string };

  const queue: string[] = [`/users/${userEnc}/drive/items/${rootId}/children?$top=${PAGE_SIZE}`];

  while (queue.length > 0) {
    let url: string | null = queue.shift()!;
    while (url) {
      const result = await graph.get<Page>(url) as { ok: boolean; status: number; data: Page | null };
      if (!result.ok) {
        console.warn(`  listing failed (${result.status})`);
        break;
      }
      for (const item of result.data?.value ?? []) {
        if (item.folder) {
          totalFolders++;
          // Don't recurse into our own output folders
          const lower = item.name.toLowerCase();
          if (lower === 'pdfs' || lower === 'converted') continue;
          queue.push(`/users/${userEnc}/drive/items/${item.id}/children?$top=${PAGE_SIZE}`);
        } else if (item.file) {
          totalFiles++;
          const dotIdx = item.name.lastIndexOf('.');
          if (dotIdx === -1 || dotIdx === item.name.length - 1) {
            noExtCount.value++;
            continue;
          }
          const ext = item.name.slice(dotIdx + 1).toLowerCase();
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
          const examples = examplesByExt.get(ext) ?? [];
          if (examples.length < 3) {
            examples.push(item.name);
            examplesByExt.set(ext, examples);
          }
        }
      }
      const next = result.data?.['@odata.nextLink'];
      url = next && next.length > 0 ? next : null;
    }
  }

  console.log(`Scanned ${totalFiles} files across ${totalFolders} folders.\n`);
  console.log('Extension counts (descending):');
  const sorted = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    const examples = examplesByExt.get(ext) ?? [];
    console.log(`  .${ext.padEnd(8)} ${String(count).padStart(5)}   e.g. ${examples.slice(0, 2).join(', ')}`);
  }
  if (noExtCount.value > 0) {
    console.log(`  (no ext) ${String(noExtCount.value).padStart(5)}`);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
