import { getSharedGraphClient, DEFAULT_GRAPH_BASE_URL } from '../providers/graph';
import type { GraphProviderClient } from '../providers/graph';
import type { ProviderCallResult } from '../providers/types';
import { fetchWithRetry } from '../ingestion/fetch-with-retry';
import { extractCandidateFromEmail } from './nlp-extract-and-upload';

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

function requireGraph(): GraphProviderClient {
  const client = getSharedGraphClient();
  if (!client) {
    throw new Error(
      'MicrosoftGraphEmailParser: Graph client not configured. Required: CBL_SSO_ALLOWED_TENANT_ID, CBL_SSO_CLIENT_ID, CBL_SSO_CLIENT_SECRET',
    );
  }
  return client;
}

/**
 * Decode an HTTP failure body from the Graph client into a short,
 * caller-friendly error string. Only used for throw-path messages.
 */
function graphError(context: string, status: number, error: string | undefined): Error {
  return new Error(`${context} (${status}): ${error ?? 'unknown error'}`);
}

export class MicrosoftGraphEmailParser implements EmailParser {
  name = 'MicrosoftGraph';
  // Cache folder IDs per mailbox to avoid repeated lookups
  private processedFolderIds = new Map<string, string>();
  private errorFolderIds = new Map<string, string>();

  async parseInbox(addresses: string[], processedIds?: Set<string>): Promise<EmailCandidateRecord[]> {
    const client = requireGraph();
    const allEmails: EmailCandidateRecord[] = [];

    for (const address of addresses) {
      const messages = await this.fetchMessages(client, address);
      for (const msg of messages) {
        // Skip already-processed messages — fingerprint safety net
        if (processedIds?.has(msg.id)) {
          // Already processed but still unread (edge case) — mark read now
          await this.moveToProcessed(client, address, msg.id);
          continue;
        }

        // LLM classification FIRST — cheaper than fetching multi-MB attachment binaries
        const candidate = await extractCandidateFromEmail(msg.body.content, msg.subject ?? '');
        // Skip non-submission emails (treat undefined isSubmission as non-submission too)
        if (!candidate.isSubmission) {
          console.log(`[EmailParser] Skipping non-submission: ${msg.subject ?? '(no subject)'}`);
          await this.moveToProcessed(client, address, msg.id);
          continue;
        }

        // Always attempt attachment fetch — hasAttachments can be false on forwarded/CC'd emails
        const attachments = await this.fetchAttachments(client, address, msg.id);
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
    const client = requireGraph();
    let processed = 0, skipped = 0, failed = 0;

    for (const address of addresses) {
      const messages = await this.fetchMessages(client, address);
      console.log(`[EmailParser] ${messages.length} unread messages in ${address} (concurrency: ${CONCURRENCY})`);

      // Process in chunks of CONCURRENCY
      for (let i = 0; i < messages.length; i += CONCURRENCY) {
        const chunk = messages.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map(async (msg) => {
            if (processedIds.has(msg.id)) {
              await this.moveToProcessed(client, address, msg.id);
              return 'skipped' as const;
            }

            const candidate = await extractCandidateFromEmail(msg.body.content, msg.subject ?? '');
            if (!candidate.isSubmission) {
              console.log(`[EmailParser] Skipping non-submission: ${msg.subject ?? '(no subject)'}`);
              await this.moveToProcessed(client, address, msg.id);
              return 'skipped' as const;
            }

            const attachments = await this.fetchAttachments(client, address, msg.id);
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
            await this.moveToProcessed(client, address, msg.id);
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
            await this.moveToError(client, address, chunk[j].id);
          }
        }

        console.log(`[EmailParser] Chunk ${Math.floor(i / CONCURRENCY) + 1}: ${processed} ok, ${skipped} skipped, ${failed} failed`);
      }
    }

    return { processed, skipped, failed };
  }

  /** Mark as read + move to Inbox/Processed folder */
  async moveToProcessed(client: GraphProviderClient, mailbox: string, messageId: string): Promise<void> {
    await this.moveToFolder(client, mailbox, messageId, 'Processed', this.processedFolderIds);
  }

  /** Mark as read + move to Inbox/Error folder (prevents infinite retry) */
  async moveToError(client: GraphProviderClient, mailbox: string, messageId: string): Promise<void> {
    await this.moveToFolder(client, mailbox, messageId, 'Error', this.errorFolderIds);
  }

  private async moveToFolder(
    client: GraphProviderClient, mailbox: string, messageId: string,
    folderName: string, cache: Map<string, string>,
  ): Promise<void> {
    const userPath = `/users/${encodeURIComponent(mailbox)}`;
    try {
      // 1. Mark as read
      const patchResult = await client.patch(`${userPath}/messages/${messageId}`, { isRead: true });
      if (!patchResult.ok) {
        console.warn(`[EmailParser] markAsRead FAILED (${patchResult.status})`);
      }

      // 2. Move to target folder
      const folderId = await this.getOrCreateFolder(client, mailbox, folderName, cache);
      const moveResult = await client.post<unknown>(`${userPath}/messages/${messageId}/move`, { destinationId: folderId });
      if (!moveResult.ok) {
        console.warn(`[EmailParser] moveTo${folderName} FAILED (${moveResult.status}): ${(moveResult.error ?? '').slice(0, 200)}`);
      } else {
        console.log(`[EmailParser] Moved to ${folderName}: ${messageId.slice(-10)}`);
      }
    } catch (err) {
      console.error(`[EmailParser] moveTo${folderName} THREW:`, err instanceof Error ? err.message : err);
    }
  }

  private async getOrCreateFolder(
    client: GraphProviderClient, mailbox: string, folderName: string, cache: Map<string, string>,
  ): Promise<string> {
    const cached = cache.get(mailbox);
    if (cached) return cached;

    const userPath = `/users/${encodeURIComponent(mailbox)}`;

    // Check if folder exists under Inbox
    const listPath = `${userPath}/mailFolders/Inbox/childFolders?$filter=displayName eq '${folderName}'`;
    const listResult = await client.get<{ value: Array<{ id: string }> }>(listPath);

    // Patch (review F1.12b): only fall through to folder-create when the
    // list call SUCCEEDED with an empty result set. A transient list failure
    // (429 / 5xx) used to fall through to create, risking duplicate folders
    // in Exchange and a corrupt cache entry. If list fails, surface the
    // error so the caller (moveToFolder) logs it and skips the move — the
    // message stays in the inbox for the next poll cycle, which is the
    // correct behavior for a transient issue.
    if (!listResult.ok) {
      throw graphError(
        `Failed to list "${folderName}" folder candidates`,
        listResult.status,
        listResult.error,
      );
    }
    if (listResult.data?.value?.length) {
      const firstId = listResult.data.value[0].id;
      cache.set(mailbox, firstId);
      console.log(`[EmailParser] Found existing "${folderName}" folder for ${mailbox}`);
      return firstId;
    }

    // List succeeded with zero results → folder genuinely does not exist yet.
    const createResult = await client.post<{ id: string }>(
      `${userPath}/mailFolders/Inbox/childFolders`,
      { displayName: folderName },
    );

    if (!createResult.ok || !createResult.data?.id) {
      throw graphError(`Failed to create ${folderName} folder`, createResult.status, createResult.error);
    }

    cache.set(mailbox, createResult.data.id);
    console.log(`[EmailParser] Created "${folderName}" folder for ${mailbox}`);
    return createResult.data.id;
  }

  private async fetchMessages(client: GraphProviderClient, mailbox: string): Promise<GraphMessage[]> {
    const MAX_PAGES = 10; // Safety cap: 10 pages × 50 = 500 messages max
    type MessagesPage = { value: GraphMessage[]; '@odata.nextLink'?: string };
    let nextPath: string | null = `/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages` +
      `?$top=50&$filter=isRead eq false&$select=id,subject,receivedDateTime,body,hasAttachments&$orderby=receivedDateTime desc`;

    const allMessages: GraphMessage[] = [];
    let page = 0;

    while (nextPath && page < MAX_PAGES) {
      const result: ProviderCallResult<MessagesPage> = await client.get<MessagesPage>(nextPath);
      if (!result.ok) {
        throw graphError(`Graph messages fetch failed for ${mailbox}`, result.status, result.error);
      }
      const data: MessagesPage | null = result.data;
      allMessages.push(...(data?.value ?? []));
      // Treat empty string as end-of-pagination. Graph never emits an
      // empty nextLink in practice, but misbehaving proxies/mocks can —
      // and `nextPath = ""` would loop until MAX_PAGES silently (review
      // finding E6).
      const rawNext = data?.['@odata.nextLink'];
      nextPath = rawNext && rawNext.length > 0 ? rawNext : null;
      page++;
    }

    if (nextPath) {
      console.warn(`[EmailParser] MAX_PAGES (${MAX_PAGES}) reached for ${mailbox} — some messages may not have been processed`);
    }

    return allMessages;
  }

  private async fetchAttachments(
    client: GraphProviderClient,
    mailbox: string,
    messageId: string,
  ): Promise<Array<{ filename: string; content: Buffer }>> {
    const userPath = `/users/${encodeURIComponent(mailbox)}`;
    const result = await client.get<{ value: GraphAttachment[] }>(`${userPath}/messages/${messageId}/attachments`);

    if (!result.ok) {
      console.warn(`[EmailParser] Attachments fetch failed for ${messageId.slice(-10)} (${result.status})`);
      return [];
    }

    const allAtts = result.data?.value ?? [];
    if (allAtts.length === 0) return [];

    const results: Array<{ filename: string; content: Buffer }> = [];

    for (const att of allAtts) {
      if (att.contentBytes) {
        // File attachments have contentBytes inline
        results.push({ filename: att.name, content: Buffer.from(att.contentBytes, 'base64') });
      } else if (att['@odata.type'] === '#microsoft.graph.itemAttachment') {
        // Item attachments (embedded emails) return raw MIME, not JSON.
        // BaseProviderClient's `parseJson: false` mode discards the body
        // since there's no binary consumer hook — fall back to a direct
        // bearer-auth'd fetch. Retries + timeout still come from
        // `fetchWithRetry`. Registry health IS NOT wired (no onSuccess/
        // onFailure hook) — but the structured `provider_log` entry below
        // fills AC 1 bullet 2's logging gap (review patch A2).
        const itemStart = Date.now();
        const itemPath = `${userPath}/messages/${messageId}/attachments/${att.id}/$value`;
        const itemUrl = `${DEFAULT_GRAPH_BASE_URL}${itemPath}`;
        let itemStatus: number | null = null;
        let itemError: string | undefined;
        try {
          const token = await client.getAccessToken();
          const itemResp = await fetchWithRetry(itemUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          itemStatus = itemResp.status;
          if (itemResp.ok) {
            const buf = Buffer.from(await itemResp.arrayBuffer());
            const safeName = (att.name || 'embedded-email').replace(/[^a-zA-Z0-9._-]/g, '_');
            results.push({ filename: `${safeName}.eml`, content: buf });
          } else {
            itemError = `HTTP ${itemResp.status}`;
            console.warn(`[EmailParser] Item attachment fetch failed for ${att.name} (${itemResp.status})`);
          }
        } catch (err) {
          itemError = err instanceof Error ? err.message : String(err);
          console.warn(`[EmailParser] Item attachment fetch threw for ${att.name}:`, itemError);
        } finally {
          // Emit a provider_log entry matching the shape BaseProviderClient
          // writes, so log-drain dashboards can include this path in the
          // graph-provider success/failure counts.
          console.log(
            JSON.stringify({
              kind: 'provider_log',
              provider: 'graph',
              method: 'GET',
              path: itemPath,
              statusCode: itemStatus,
              durationMs: Date.now() - itemStart,
              attempt: 1,
              error: itemError,
              subPath: 'item-attachment-binary',
            }),
          );
        }
      }
    }

    console.log(`[EmailParser] Message ${messageId.slice(-10)}: ${allAtts.length} attachments, ${results.length} saved (types: ${allAtts.map(a => a['@odata.type']).join(', ')})`);
    return results;
  }
}

