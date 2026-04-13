/**
 * Shared Supabase Storage upload for all candidate file types (resumes, email attachments).
 * Single function for all ingestion paths — OneDrive poller, dashboard upload, email ingestion.
 */
import { getSupabaseAdminClient, shouldUseInMemoryPersistenceForTests } from '@/modules/persistence';

const BUCKET = 'candidate-attachments';

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
  };
  return mimeMap[ext ?? ''] ?? 'application/octet-stream';
}

/**
 * Upload a file to Supabase Storage and return the public URL.
 *
 * @param buffer - File content
 * @param filename - Original filename (will be sanitized)
 * @param storagePath - Path segments joined with `/` (e.g. `resume-uploads/cbl-aero/batch123/file456`)
 * @returns `{ url, warning? }` — url is empty string if upload fails or in test mode
 */
export async function uploadFileToStorage(
  buffer: Buffer,
  filename: string,
  storagePath: string,
): Promise<{ url: string; size: number; warning?: string }> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return { url: '', size: buffer.length };
  }

  const client = getSupabaseAdminClient();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fullPath = `${storagePath}/${safeName}`;

  const { error } = await client.storage
    .from(BUCKET)
    .upload(fullPath, buffer, {
      contentType: guessMimeType(safeName),
      upsert: true,
    });

  if (error) {
    console.error(`[Storage] Upload failed for ${fullPath}: ${error.message}`);
    return { url: '', size: buffer.length, warning: 'File storage failed — the original file may not be retrievable.' };
  }

  const { data: urlData } = client.storage.from(BUCKET).getPublicUrl(fullPath);
  return { url: urlData.publicUrl, size: buffer.length };
}
