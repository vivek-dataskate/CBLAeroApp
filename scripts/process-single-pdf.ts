import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const envPath = path.resolve(__dirname, '../.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
process.env.CBL_APPROVED_US_REGIONS ??= 'us-east-1,us-west-2';
process.env.CBL_DATA_REGION ??= 'us-west-2';
process.env.CBL_LOG_REGION ??= 'us-west-2';
process.env.CBL_BACKUP_REGION ??= 'us-west-2';

async function main() {
  const { extractCandidateFromDocument } = await import('../src/features/candidate-management/application/candidate-extraction');
  const { mapToCandidateRow } = await import('../src/modules/ingestion');
  const { uploadFileToStorage } = await import('../src/features/candidate-management/infrastructure/storage');
  const { upsertCandidateByEmail, insertCandidateNoEmail } = await import('../src/features/candidate-management/infrastructure/candidate-repository');
  const { recordFingerprint } = await import('../src/features/candidate-management/infrastructure/fingerprint-repository');

  const pdfPath = process.argv[2];
  if (!pdfPath) { console.error('Usage: npx tsx scripts/process-single-pdf.ts <path>'); process.exit(1); }

  const buffer = fs.readFileSync(pdfPath);
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileId = crypto.randomUUID().slice(0, 8);
  console.log(`File: ${path.basename(pdfPath)} | ${buffer.length} bytes | hash: ${fileHash.slice(0, 16)}`);

  // Upload to storage
  console.log('\nUploading to Supabase Storage...');
  const storagePath = `resume-uploads/cbl-aero/manual-test/${fileId}`;
  const storage = await uploadFileToStorage(buffer, path.basename(pdfPath), storagePath);
  console.log(`Storage URL: ${storage.url || '(empty — test mode)'}`);
  if (storage.warning) console.warn('Warning:', storage.warning);

  // Extract
  console.log('\nExtracting via LLM...');
  const result = await extractCandidateFromDocument(buffer, 'pdf', {
    source: 'resume_upload', tenantId: 'cbl-aero',
  });

  if (result.error || !result.extraction) {
    console.error('Extraction failed:', result.error);
    process.exit(1);
  }

  const ext = result.extraction;
  console.log('\n--- Extracted ---');
  console.log(`  Name:   ${ext.firstName} ${ext.lastName}`);
  console.log(`  Email:  ${ext.email}`);
  console.log(`  Phone:  ${ext.phone}`);
  console.log(`  Title:  ${ext.jobTitle}`);
  console.log(`  Skills: ${Array.isArray(ext.skills) ? ext.skills.join(', ') : ext.skills}`);

  // Upsert with resume_url via repository
  const baseRow = mapToCandidateRow(
    { ...ext },
    'resume_upload',
    { ingestion_state: 'pending_enrichment' },
  );

  const candidateRow = {
    ...baseRow,
    tenant_id: 'cbl-aero',
    resume_url: storage.url || null,
    extra_attributes: {},
  };

  console.log('\nUpserting to Supabase...');
  const email = typeof ext.email === 'string' ? ext.email.trim().toLowerCase() : '';
  let candidateId: string;
  if (email) {
    candidateId = await upsertCandidateByEmail(candidateRow);
  } else {
    candidateId = await insertCandidateNoEmail(candidateRow);
  }
  console.log(`Upserted candidate: ${candidateId}`);

  // Fingerprint via repository
  await recordFingerprint({
    tenantId: 'cbl-aero',
    type: 'file_sha256',
    hash: fileHash,
    source: 'resume_upload',
    candidateId,
    metadata: { filename: path.basename(pdfPath), fileSize: buffer.length },
  });
  console.log('Fingerprint recorded');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
