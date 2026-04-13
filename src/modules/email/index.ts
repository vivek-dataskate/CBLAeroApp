import { acquireGraphToken } from './graph-auth';
import { extractCandidateFromEmail } from './nlp-extract-and-upload';
import { fetchWithRetry } from '../ingestion/fetch-with-retry';

export interface EmailParser {
  name: string;
  parseInbox(addresses: string[], processedIds?: Set<string>): Promise<EmailCandidateRecord[]>;
  /** Stream-process: fetch message list, call handler per email, avoid holding all in memory */
  processInbox(
    addresses: string[],
    processedIds: Set<string>,
    handler: (record: EmailCandidateRecord) => Promise<void>,
  ): Promise<{ processed: number; skipped: number; failed: number }>;
}

export interface EmailCandidateRecord {
  id: string;
  mailbox: string;
  candidate: Record<string, unknown> & { firstName: string; lastName: string; email: string };
  receivedAt: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}

type GraphMessage = {
  id: string;
  subject: string;
  receivedDateTime: string;
  body: { content: string; contentType: string };
  hasAttachments: boolean;
};

type GraphAttachment = {
  id: string;
  name: string;
  contentBytes: string; // base64
  '@odata.type': string;
};

export class MicrosoftGraphEmailParser implements EmailParser {
  name = 'MicrosoftGraph';
  // Cache folder IDs per mailbox to avoid repeated lookups
  private processedFolderIds = new Map<string, string>();
  private errorFolderIds = new Map<string, string>();

  async parseInbox(addresses: string[], processedIds?: Set<string>): Promise<EmailCandidateRecord[]> {
    const token = await acquireGraphToken();
    const allEmails: EmailCandidateRecord[] = [];

    for (const address of addresses) {
      const messages = await this.fetchMessages(token, address);
      for (const msg of messages) {
        // Skip already-processed messages — fingerprint safety net
        if (processedIds?.has(msg.id)) {
          // Already processed but still unread (edge case) — mark read now
          await this.moveToProcessed(token, address, msg.id);
          continue;
        }

        // LLM classification FIRST — cheaper than fetching multi-MB attachment binaries
        const candidate = await extractCandidateFromEmail(msg.body.content, msg.subject ?? '');
        // Skip non-submission emails (treat undefined isSubmission as non-submission too)
        if (!candidate.isSubmission) {
          console.log(`[EmailParser] Skipping non-submission: ${msg.subject ?? '(no subject)'}`);
          await this.moveToProcessed(token, address, msg.id);
          continue;
        }

        // Always attempt attachment fetch — hasAttachments can be false on forwarded/CC'd emails
        const attachments = await this.fetchAttachments(token, address, msg.id);
        allEmails.push({
          id: msg.id,
          mailbox: address,
          candidate: candidate as unknown as Record<string, unknown> & { firstName: string; lastName: string; email: string },
          receivedAt: msg.receivedDateTime,
          subject: msg.subject ?? '',
          body: msg.body.content,
          attachments,
        });
      }
    }

    return allEmails;
  }

  /**
   * Stream-process inbox with concurrency: fetch message list, then process
   * chunks of CONCURRENCY emails in parallel. Each email: LLM classify →
   * fetch attachments → persist → move to Processed folder.
   */
  async processInbox(
    addresses: string[],
    processedIds: Set<string>,
    handler: (record: EmailCandidateRecord) => Promise<void>,
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    const CONCURRENCY = 10;
    const token = await acquireGraphToken();
    let processed = 0, skipped = 0, failed = 0;

    for (const address of addresses) {
      const messages = await this.fetchMessages(token, address);
      console.log(`[EmailParser] ${messages.length} unread messages in ${address} (concurrency: ${CONCURRENCY})`);

      // Process in chunks of CONCURRENCY
      for (let i = 0; i < messages.length; i += CONCURRENCY) {
        const chunk = messages.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map(async (msg) => {
            if (processedIds.has(msg.id)) {
              await this.moveToProcessed(token, address, msg.id);
              return 'skipped' as const;
            }

            const candidate = await extractCandidateFromEmail(msg.body.content, msg.subject ?? '');
            if (!candidate.isSubmission) {
              console.log(`[EmailParser] Skipping non-submission: ${msg.subject ?? '(no subject)'}`);
              await this.moveToProcessed(token, address, msg.id);
              return 'skipped' as const;
            }

            const attachments = await this.fetchAttachments(token, address, msg.id);
            const record: EmailCandidateRecord = {
              id: msg.id,
              mailbox: address,
              candidate: candidate as unknown as Record<string, unknown> & { firstName: string; lastName: string; email: string },
              receivedAt: msg.receivedDateTime,
              subject: msg.subject ?? '',
              body: msg.body.content,
              attachments,
            };

            await handler(record);
            await this.moveToProcessed(token, address, msg.id);
            return 'processed' as const;
          }),
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled') {
            if (result.value === 'skipped') skipped++;
            else processed++;
          } else {
            failed++;
            console.error(`[EmailParser] Failed to process ${chunk[j].subject ?? chunk[j].id}:`,
              result.reason instanceof Error ? result.reason.message : result.reason);
            // Move failed email to Error folder so it doesn't retry forever
            await this.moveToError(token, address, chunk[j].id);
          }
        }

        console.log(`[EmailParser] Chunk ${Math.floor(i / CONCURRENCY) + 1}: ${processed} ok, ${skipped} skipped, ${failed} failed`);
      }
    }

    return { processed, skipped, failed };
  }

  /** Mark as read + move to Inbox/Processed folder */
  async moveToProcessed(token: string, mailbox: string, messageId: string): Promise<void> {
    await this.moveToFolder(token, mailbox, messageId, 'Processed', this.processedFolderIds);
  }

  /** Mark as read + move to Inbox/Error folder (prevents infinite retry) */
  async moveToError(token: string, mailbox: string, messageId: string): Promise<void> {
    await this.moveToFolder(token, mailbox, messageId, 'Error', this.errorFolderIds);
  }

  private async moveToFolder(
    token: string, mailbox: string, messageId: string,
    folderName: string, cache: Map<string, string>,
  ): Promise<void> {
    const userPath = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
    try {
      // 1. Mark as read
      const patchResp = await fetchWithRetry(`${userPath}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      if (!patchResp.ok) {
        console.warn(`[EmailParser] markAsRead FAILED (${patchResp.status})`);
      }

      // 2. Move to target folder
      const folderId = await this.getOrCreateFolder(token, mailbox, folderName, cache);
      const moveResp = await fetchWithRetry(`${userPath}/messages/${messageId}/move`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId: folderId }),
      });
      if (!moveResp.ok) {
        const errText = await moveResp.text().catch(() => '');
        console.warn(`[EmailParser] moveTo${folderName} FAILED (${moveResp.status}): ${errText.slice(0, 200)}`);
      } else {
        console.log(`[EmailParser] Moved to ${folderName}: ${messageId.slice(-10)}`);
      }
    } catch (err) {
      console.error(`[EmailParser] moveTo${folderName} THREW:`, err instanceof Error ? err.message : err);
    }
  }

  private async getOrCreateFolder(
    token: string, mailbox: string, folderName: string, cache: Map<string, string>,
  ): Promise<string> {
    const cached = cache.get(mailbox);
    if (cached) return cached;

    const userPath = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;

    // Check if folder exists under Inbox
    const listUrl = `${userPath}/mailFolders/Inbox/childFolders?$filter=displayName eq '${folderName}'`;
    const listResp = await fetchWithRetry(listUrl, { headers: { Authorization: `Bearer ${token}` } });

    if (listResp.ok) {
      const listData = await listResp.json() as { value: Array<{ id: string }> };
      if (listData.value?.length > 0) {
        cache.set(mailbox, listData.value[0].id);
        console.log(`[EmailParser] Found existing "${folderName}" folder for ${mailbox}`);
        return listData.value[0].id;
      }
    }

    // Create the folder
    const createResp = await fetchWithRetry(`${userPath}/mailFolders/Inbox/childFolders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: folderName }),
    });

    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => '');
      throw new Error(`Failed to create ${folderName} folder (${createResp.status}): ${errText.slice(0, 200)}`);
    }

    const createData = await createResp.json() as { id: string };
    cache.set(mailbox, createData.id);
    console.log(`[EmailParser] Created "${folderName}" folder for ${mailbox}`);
    return createData.id;
  }

  private async fetchMessages(token: string, mailbox: string): Promise<GraphMessage[]> {
    const MAX_PAGES = 10; // Safety cap: 10 pages × 50 = 500 messages max
    let url: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages` +
      `?$top=50&$filter=isRead eq false&$select=id,subject,receivedDateTime,body,hasAttachments&$orderby=receivedDateTime desc`;

    const allMessages: GraphMessage[] = [];
    let page = 0;

    while (url && page < MAX_PAGES) {
      const response = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Graph messages fetch failed for ${mailbox} (${response.status}): ${text}`);
      }

      const data = await response.json() as { value: GraphMessage[]; '@odata.nextLink'?: string };
      allMessages.push(...(data.value ?? []));
      url = data['@odata.nextLink'] ?? null;
      page++;
    }

    if (url) {
      console.warn(`[EmailParser] MAX_PAGES (${MAX_PAGES}) reached for ${mailbox} — some messages may not have been processed`);
    }

    return allMessages;
  }

  private async fetchAttachments(
    token: string,
    mailbox: string,
    messageId: string
  ): Promise<Array<{ filename: string; content: Buffer }>> {
    const userPath = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
    const url = `${userPath}/messages/${messageId}/attachments`;

    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      console.warn(`[EmailParser] Attachments fetch failed for ${messageId.slice(-10)} (${response.status})`);
      return [];
    }

    const data = await response.json() as { value: GraphAttachment[] };
    const allAtts = data.value ?? [];
    if (allAtts.length === 0) return [];

    const results: Array<{ filename: string; content: Buffer }> = [];

    for (const att of allAtts) {
      if (att.contentBytes) {
        // File attachments have contentBytes inline
        results.push({ filename: att.name, content: Buffer.from(att.contentBytes, 'base64') });
      } else if (att['@odata.type'] === '#microsoft.graph.itemAttachment') {
        // Item attachments (embedded emails) need a separate fetch for raw MIME content
        try {
          const itemUrl = `${userPath}/messages/${messageId}/attachments/${att.id}/$value`;
          const itemResp = await fetchWithRetry(itemUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (itemResp.ok) {
            const buf = Buffer.from(await itemResp.arrayBuffer());
            const safeName = (att.name || 'embedded-email').replace(/[^a-zA-Z0-9._-]/g, '_');
            results.push({ filename: `${safeName}.eml`, content: buf });
          } else {
            console.warn(`[EmailParser] Item attachment fetch failed for ${att.name} (${itemResp.status})`);
          }
        } catch (err) {
          console.warn(`[EmailParser] Item attachment fetch threw for ${att.name}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    console.log(`[EmailParser] Message ${messageId.slice(-10)}: ${allAtts.length} attachments, ${results.length} saved (types: ${allAtts.map(a => a['@odata.type']).join(', ')})`);
    return results;
  }
}
