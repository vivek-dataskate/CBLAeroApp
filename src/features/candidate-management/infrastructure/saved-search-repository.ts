import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import type {
  SavedSearch,
  SavedSearchCreateParams,
  SavedSearchUpdateParams,
} from "../contracts/saved-search";

export class SavedSearchNotFoundError extends Error {
  constructor() {
    super("Saved search not found.");
    this.name = "SavedSearchNotFoundError";
  }
}

// In-memory store (test mode only)
const savedSearchStore = new Map<string, SavedSearch>();

export function seedSavedSearchForTest(search: SavedSearch): void {
  savedSearchStore.set(search.id, { ...search });
}

export function clearSavedSearchStoreForTest(): void {
  savedSearchStore.clear();
}

// Row mapping
type SavedSearchRow = {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_email: string;
  name: string;
  filters: Record<string, unknown>;
  digest_enabled: boolean;
  created_at: string;
  updated_at: string;
};

function toSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    name: row.name,
    filters: row.filters,
    digestEnabled: row.digest_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSavedSearches(actorId: string, tenantId: string): Promise<SavedSearch[]> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return [...savedSearchStore.values()]
      .filter((s) => s.actorId === actorId && s.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("saved_searches")
    .select("*")
    .eq("actor_id", actorId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list saved searches: ${error.message}`);
  }

  return (data as SavedSearchRow[]).map(toSavedSearch);
}

export async function createSavedSearch(params: SavedSearchCreateParams): Promise<SavedSearch> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const now = new Date().toISOString();
    const search: SavedSearch = {
      id: crypto.randomUUID(),
      tenantId: params.tenantId,
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      name: params.name,
      filters: params.filters,
      digestEnabled: true,
      createdAt: now,
      updatedAt: now,
    };
    savedSearchStore.set(search.id, search);
    return search;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("saved_searches")
    .insert({
      tenant_id: params.tenantId,
      actor_id: params.actorId,
      actor_email: params.actorEmail,
      name: params.name,
      filters: params.filters,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create saved search: ${error.message}`);
  }

  return toSavedSearch(data as SavedSearchRow);
}

export async function updateSavedSearch(
  id: string,
  actorId: string,
  tenantId: string,
  updates: SavedSearchUpdateParams,
): Promise<SavedSearch> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const search = savedSearchStore.get(id);
    if (!search || search.actorId !== actorId || search.tenantId !== tenantId) {
      throw new SavedSearchNotFoundError();
    }
    if (updates.name !== undefined) search.name = updates.name;
    if (updates.digestEnabled !== undefined) search.digestEnabled = updates.digestEnabled;
    search.updatedAt = new Date().toISOString();
    savedSearchStore.set(id, search);
    return { ...search };
  }

  const client = getSupabaseAdminClient();
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.digestEnabled !== undefined) updateData.digest_enabled = updates.digestEnabled;

  const { data, error } = await client
    .from("saved_searches")
    .update(updateData)
    .eq("id", id)
    .eq("actor_id", actorId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update saved search: ${error.message}`);
  }

  if (!data) {
    throw new SavedSearchNotFoundError();
  }

  return toSavedSearch(data as SavedSearchRow);
}

export async function deleteSavedSearch(
  id: string,
  actorId: string,
  tenantId: string,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const search = savedSearchStore.get(id);
    if (!search || search.actorId !== actorId || search.tenantId !== tenantId) {
      throw new SavedSearchNotFoundError();
    }
    savedSearchStore.delete(id);
    return;
  }

  const client = getSupabaseAdminClient();
  const { error, count } = await client
    .from("saved_searches")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("actor_id", actorId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Failed to delete saved search: ${error.message}`);
  }

  if (count === 0) {
    throw new SavedSearchNotFoundError();
  }
}

export async function listDigestEnabledSearches(): Promise<SavedSearch[]> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return [...savedSearchStore.values()].filter((s) => s.digestEnabled);
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("saved_searches")
    .select("*")
    .eq("digest_enabled", true);

  if (error) {
    throw new Error(`Failed to list digest searches: ${error.message}`);
  }

  return (data as SavedSearchRow[]).map(toSavedSearch);
}
