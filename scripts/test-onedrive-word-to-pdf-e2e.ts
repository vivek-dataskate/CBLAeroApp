/**
 * End-to-end test for OneDriveWordToPdfJob against a real (but isolated)
 * OneDrive folder. Creates a clearly-named throwaway path, uploads sample
 * .docx files, runs the job, verifies results, and ALWAYS cleans up.
 *
 * Usage: npx tsx scripts/test-onedrive-word-to-pdf-e2e.ts
 *
 * Safe to run repeatedly — the test folder is deleted on every exit path.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ── Env load (mirrors run-onedrive-poller.ts) ────────────────────────────
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

// Override the resume path to our isolated test root
const TEST_ROOT_PARENT = 'CBLAeroCons';
const TEST_ROOT_NAME = 'Resumes-Test-Claude';
const TEST_ROOT_PATH = `${TEST_ROOT_PARENT}/${TEST_ROOT_NAME}`;
process.env.CBL_ONEDRIVE_RESUME_PATH = TEST_ROOT_PATH;

const TEST_FILES = [
  { recruiter: 'Test Recruiter A', subPath: '', name: 'flat.docx', kind: 'docx' as const },
  { recruiter: 'Test Recruiter A', subPath: 'Sub1/Sub2', name: 'deep.docx', kind: 'docx' as const },
  { recruiter: 'Test Recruiter B', subPath: '', name: 'single.docx', kind: 'docx' as const },
  { recruiter: 'Test Recruiter B', subPath: '', name: 'cover.txt', kind: 'txt' as const },
  { recruiter: 'Test Recruiter B', subPath: '', name: 'legacy.rtf', kind: 'rtf' as const },
  { recruiter: 'Test Recruiter B', subPath: '', name: 'page.html', kind: 'html' as const },
  { recruiter: 'Test Recruiter B', subPath: '', name: 'readme.md', kind: 'md' as const },
];

const PY_SCRIPT = [
  'import zipfile, sys',
  'ct = \'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>\'',
  'rels = \'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>\'',
  'doc = \'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>\' + sys.argv[2] + \'</w:t></w:r></w:p></w:body></w:document>\'',
  'with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:',
  '    z.writestr("[Content_Types].xml", ct)',
  '    z.writestr("_rels/.rels", rels)',
  '    z.writestr("word/document.xml", doc)',
].join('\n');

function generateDocx(localPath: string, content: string) {
  const scriptPath = path.join(os.tmpdir(), `make-docx-${process.pid}.py`);
  fs.writeFileSync(scriptPath, PY_SCRIPT);
  try {
    execSync(`python3 ${JSON.stringify(scriptPath)} ${JSON.stringify(localPath)} ${JSON.stringify(content)}`);
  } finally {
    fs.unlinkSync(scriptPath);
  }
}

function generateTxt(localPath: string, content: string) {
  fs.writeFileSync(localPath, content + '\n');
}

function generateRtf(localPath: string, content: string) {
  // Minimal valid RTF — Graph renders this to PDF
  fs.writeFileSync(localPath, `{\\rtf1\\ansi\\deff0 ${content.replace(/[{}\\]/g, (c) => '\\' + c)}}`);
}

function generateHtml(localPath: string, content: string) {
  fs.writeFileSync(localPath, `<!doctype html><html><head><title>Test</title></head><body><h1>Resume</h1><p>${content}</p></body></html>`);
}

function generateMd(localPath: string, content: string) {
  fs.writeFileSync(localPath, `# Resume\n\n${content}\n`);
}

type FileKind = 'docx' | 'txt' | 'rtf' | 'html' | 'md';

function contentTypeFor(kind: FileKind): string {
  switch (kind) {
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'txt':  return 'text/plain';
    case 'rtf':  return 'application/rtf';
    case 'html': return 'text/html';
    case 'md':   return 'text/markdown';
  }
}

async function main() {
  const { ensureProvidersInitialized } = await import('../src/modules/providers');
  const { getSharedGraphClient } = await import('../src/modules/providers/graph');
  const { OneDriveWordToPdfJob } = await import('../src/modules/ingestion/jobs');

  await ensureProvidersInitialized();
  const graphMaybe = getSharedGraphClient();
  if (!graphMaybe) throw new Error('Graph client not configured');
  const graph = graphMaybe;

  const driveUser = process.env.CBL_ONEDRIVE_USER?.trim() || 'vivek@cblsolutions.com';
  const userEnc = encodeURIComponent(driveUser);

  // Idempotent pre-cleanup: if a prior aborted run left the test folder, nuke it first.
  const preCleanup = await graph.get<{ id: string }>(`/users/${userEnc}/drive/root:/${TEST_ROOT_PATH}`);
  if (preCleanup.status === 200 && preCleanup.data?.id) {
    console.log(`[setup] Existing ${TEST_ROOT_PATH} found, deleting first…`);
    await graph.delete(`/users/${userEnc}/drive/items/${preCleanup.data.id}`);
  }

  let testRootId: string | null = null;
  let pass = 0, fail = 0;

  try {
    // ── Generate local .docx files ──────────────────────────────
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-test-'));
    console.log(`[setup] Generating fixture files in ${tmpDir}`);
    for (const f of TEST_FILES) {
      const local = path.join(tmpDir, f.name);
      const content = `Sample resume for ${f.recruiter} (${f.name}) — test, safe to delete`;
      if (f.kind === 'docx') generateDocx(local, content);
      else if (f.kind === 'txt') generateTxt(local, content);
      else if (f.kind === 'rtf') generateRtf(local, content);
      else if (f.kind === 'html') generateHtml(local, content);
      else if (f.kind === 'md') generateMd(local, content);
    }

    // ── Create test root in OneDrive ────────────────────────────
    const rootCreate = await graph.post<{ id: string }>(
      `/users/${userEnc}/drive/root:/${TEST_ROOT_PARENT}:/children`,
      { name: TEST_ROOT_NAME, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
    );
    if (!rootCreate.ok || !rootCreate.data?.id) {
      throw new Error(`Failed to create test root (${rootCreate.status}): ${rootCreate.error ?? ''}`);
    }
    testRootId = rootCreate.data.id;
    console.log(`[setup] Created test root: ${TEST_ROOT_PATH}`);

    // ── Build folder tree + upload files ────────────────────────
    async function ensureChildFolder(parentId: string, name: string): Promise<string> {
      const create = await graph.post<{ id: string }>(
        `/users/${userEnc}/drive/items/${parentId}/children`,
        { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      );
      if (create.ok && create.data?.id) return create.data.id;
      // Race / already exists — fetch
      const lookup = await graph.get<{ id: string }>(`/users/${userEnc}/drive/items/${parentId}:/${encodeURIComponent(name)}`);
      if (lookup.ok && lookup.data?.id) return lookup.data.id;
      throw new Error(`Could not create or find ${name} (${create.status})`);
    }

    const uploaded: Array<{ recruiter: string; subPath: string; name: string; parentId: string }> = [];

    for (const f of TEST_FILES) {
      let parentId = await ensureChildFolder(testRootId, f.recruiter);
      if (f.subPath) {
        for (const seg of f.subPath.split('/')) {
          parentId = await ensureChildFolder(parentId, seg);
        }
      }
      const buffer = fs.readFileSync(path.join(tmpDir, f.name));
      const token = await graph.getAccessToken();
      const url = `https://graph.microsoft.com/v1.0/users/${userEnc}/drive/items/${parentId}:/${encodeURIComponent(f.name)}:/content`;
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentTypeFor(f.kind),
        },
        body: buffer as unknown as BodyInit,
      });
      if (!resp.ok) throw new Error(`Upload ${f.name} failed: ${resp.status}`);
      uploaded.push({ ...f, parentId });
      console.log(`[setup] Uploaded ${f.recruiter}/${f.subPath ? f.subPath + '/' : ''}${f.name}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });

    // ── Run the job ─────────────────────────────────────────────
    console.log('\n[run] Invoking OneDriveWordToPdfJob...\n');
    await new OneDriveWordToPdfJob().run();

    // ── Verify ──────────────────────────────────────────────────
    console.log('\n[verify] Inspecting OneDrive state...');

    function flatPdfName(subPath: string, filename: string): string {
      const ext = filename.match(/\.(?:docx?|rtf|txt|html?|odt|md)$/i)?.[0] ?? '';
      const baseNoExt = ext ? filename.slice(0, filename.length - ext.length) : filename;
      const segments = subPath ? subPath.split('/') : [];
      const parts = [...segments, baseNoExt].map((s) => s.replace(/\s+/g, ''));
      return `${parts.join('-')}.pdf`;
    }

    // PDF should land in pdfs/ under the recruiter, with the flat name
    for (const f of uploaded) {
      const flat = flatPdfName(f.subPath, f.name);
      const pdfPath = `${TEST_ROOT_PATH}/${f.recruiter}/pdfs/${flat}`;
      const pdfCheck = await graph.get(`/users/${userEnc}/drive/root:/${pdfPath}`);
      if (pdfCheck.status === 200) {
        console.log(`  ✓ Flat PDF: ${f.recruiter}/pdfs/${flat}`);
        pass++;
      } else {
        console.log(`  ✗ Flat PDF MISSING: ${f.recruiter}/pdfs/${flat} (status ${pdfCheck.status})`);
        fail++;
      }

      // Original should now live under converted/<original/sub/path>/<filename>
      const mirroredPath = `${TEST_ROOT_PATH}/${f.recruiter}/converted/${f.subPath ? f.subPath + '/' : ''}${f.name}`;
      const mirroredCheck = await graph.get(`/users/${userEnc}/drive/root:/${mirroredPath}`);
      if (mirroredCheck.status === 200) {
        console.log(`  ✓ Original mirrored at converted/${f.subPath ? f.subPath + '/' : ''}${f.name}`);
        pass++;
      } else {
        console.log(`  ✗ Original NOT at expected mirrored path: ${mirroredPath} (status ${mirroredCheck.status})`);
        fail++;
      }

      // Original should NOT remain at its source parent
      const origCheck = await graph.get(`/users/${userEnc}/drive/items/${f.parentId}:/${encodeURIComponent(f.name)}`);
      if (origCheck.status === 404) {
        console.log(`  ✓ Original removed from source location`);
        pass++;
      } else {
        console.log(`  ✗ Original still at source: status ${origCheck.status}`);
        fail++;
      }
    }

    console.log(`\n[verify] ${pass} passed, ${fail} failed`);
  } finally {
    if (testRootId) {
      console.log(`\n[teardown] Deleting ${TEST_ROOT_PATH}...`);
      const del = await graph.delete(`/users/${userEnc}/drive/items/${testRootId}`);
      console.log(`[teardown] Cleanup ${del.ok || del.status === 204 ? 'OK' : 'FAILED (' + del.status + ')'}`);
    }
  }

  if (fail > 0) {
    console.error(`\n=== E2E FAILED: ${fail} verification(s) failed ===`);
    process.exit(1);
  }
  console.log('\n=== E2E PASSED ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
