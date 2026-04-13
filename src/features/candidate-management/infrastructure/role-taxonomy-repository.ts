import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from '@/modules/persistence';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type RoleTaxonomyEntry = {
  id: number;
  tenantId: string;
  roleName: string;
  category: 'aviation' | 'it' | 'other';
  aliases: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type RoleTaxonomyRow = {
  id: number;
  tenant_id: string;
  role_name: string;
  category: string;
  aliases: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function toEntry(row: RoleTaxonomyRow): RoleTaxonomyEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleName: row.role_name,
    category: row.category as RoleTaxonomyEntry['category'],
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// -----------------------------------------------------------------------
// In-memory store (test mode only)
// -----------------------------------------------------------------------

const taxonomyStore = new Map<string, RoleTaxonomyEntry>();

export function seedRoleTaxonomyForTest(entry: RoleTaxonomyEntry): void {
  taxonomyStore.set(`${entry.tenantId}:${entry.roleName.toLowerCase()}`, entry);
}

export function clearRoleTaxonomyCacheForTest(): void {
  taxonomyStore.clear();
  roleCache.clear();
}

// -----------------------------------------------------------------------
// Module-level cache (10-minute TTL)
// -----------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type CacheEntry = {
  data: RoleTaxonomyEntry[];
  timestamp: number;
};

const roleCache = new Map<string, CacheEntry>();

function getCached(key: string): RoleTaxonomyEntry[] | null {
  const entry = roleCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    roleCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: RoleTaxonomyEntry[]): void {
  roleCache.set(key, { data, timestamp: Date.now() });
}

// -----------------------------------------------------------------------
// Repository functions
// -----------------------------------------------------------------------

export async function getAllRoles(tenantId: string): Promise<RoleTaxonomyEntry[]> {
  const cacheKey = `all:${tenantId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (shouldUseInMemoryPersistenceForTests()) {
    const results = [...taxonomyStore.values()].filter(
      (e) => e.tenantId === tenantId && e.isActive,
    );
    setCache(cacheKey, results);
    return results;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from('role_taxonomy')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('role_name');

  if (error) throw new Error(`Failed to load role taxonomy: ${error.message}`);
  const entries = (data as RoleTaxonomyRow[]).map(toEntry);
  setCache(cacheKey, entries);
  return entries;
}

export async function getRolesByCategory(
  tenantId: string,
  category: string,
): Promise<RoleTaxonomyEntry[]> {
  const cacheKey = `cat:${tenantId}:${category}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (shouldUseInMemoryPersistenceForTests()) {
    const results = [...taxonomyStore.values()].filter(
      (e) => e.tenantId === tenantId && e.category === category && e.isActive,
    );
    setCache(cacheKey, results);
    return results;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from('role_taxonomy')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('category', category)
    .eq('is_active', true)
    .order('role_name');

  if (error) throw new Error(`Failed to load roles by category: ${error.message}`);
  const entries = (data as RoleTaxonomyRow[]).map(toEntry);
  setCache(cacheKey, entries);
  return entries;
}

export async function findRoleByName(
  tenantId: string,
  roleName: string,
): Promise<RoleTaxonomyEntry | null> {
  // Check cache first (H6 fix — avoid unnecessary DB round-trips)
  const cacheKey = `all:${tenantId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    const lower = roleName.toLowerCase();
    const found = cached.find((e) => e.roleName.toLowerCase() === lower);
    if (found) return found;
  }

  if (shouldUseInMemoryPersistenceForTests()) {
    return taxonomyStore.get(`${tenantId}:${roleName.toLowerCase()}`) ?? null;
  }

  // Use RPC-style exact case-insensitive match (H5 fix — ilike treats %/_ as wildcards)
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc('find_role_by_name_exact', {
    p_tenant_id: tenantId,
    p_role_name: roleName,
  });

  if (error) throw new Error(`Failed to find role: ${error.message}`);
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return toEntry(row as RoleTaxonomyRow);
}

export async function insertRole(
  tenantId: string,
  roleName: string,
  category: 'aviation' | 'it' | 'other',
): Promise<RoleTaxonomyEntry> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const key = `${tenantId}:${roleName.toLowerCase()}`;
    const existing = taxonomyStore.get(key);
    if (existing) return existing;
    const entry: RoleTaxonomyEntry = {
      id: taxonomyStore.size + 1,
      tenantId,
      roleName,
      category,
      aliases: [],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    taxonomyStore.set(key, entry);
    // Invalidate caches
    roleCache.delete(`all:${tenantId}`);
    roleCache.delete(`cat:${tenantId}:${category}`);
    return entry;
  }

  const client = getSupabaseAdminClient();
  // Use upsert to handle concurrent inserts for the same role (§4.2)
  const { data, error } = await client
    .from('role_taxonomy')
    .upsert(
      { tenant_id: tenantId, role_name: roleName, category },
      { onConflict: 'tenant_id,role_name' },
    )
    .select('*')
    .single();

  if (error) throw new Error(`Failed to upsert role: ${error.message}`);
  // Invalidate caches
  roleCache.delete(`all:${tenantId}`);
  roleCache.delete(`cat:${tenantId}:${category}`);
  return toEntry(data as RoleTaxonomyRow);
}

export async function getRolesWithAliases(
  tenantId: string,
): Promise<RoleTaxonomyEntry[]> {
  // Uses same data as getAllRoles — aliases are always included
  return getAllRoles(tenantId);
}
