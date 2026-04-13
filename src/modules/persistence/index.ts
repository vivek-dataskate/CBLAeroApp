import { createClient } from "@supabase/supabase-js";

import { assertUsaDataResidencyPolicyConfigured } from "./data-residency";

function createSchemaBoundClient(url: string, key: string, schema: string) {
  return createClient(url, key, {
    db: {
      schema,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "x-cbl-persistence": "cblaero",
        "x-cbl-schema": schema,
      },
    },
  });
}

type SchemaBoundSupabaseClient = ReturnType<typeof createSchemaBoundClient>;

let cachedClient: SchemaBoundSupabaseClient | null = null;

function getSupabaseUrl(): string | null {
  const value = process.env.CBL_SUPABASE_URL?.trim() ?? null;
  return value && value.length > 0 ? value : null;
}

function getSupabaseServiceRoleKey(): string | null {
  const value = process.env.CBL_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? null;
  return value && value.length > 0 ? value : null;
}

function getSupabaseSchema(): string | null {
  const value = process.env.CBL_SUPABASE_SCHEMA?.trim() ?? null;
  return value && value.length > 0 ? value : null;
}

export function isSupabaseConfigured(): boolean {
  return !!(getSupabaseUrl() && getSupabaseServiceRoleKey() && getSupabaseSchema());
}

export function shouldUseInMemoryPersistenceForTests(): boolean {
  if (process.env.NODE_ENV !== "test") {
    return false;
  }

  return process.env.CBL_FORCE_SUPABASE_FOR_TESTS !== "true";
}

export function assertSupabasePersistenceConfigured(): void {
  if (shouldUseInMemoryPersistenceForTests()) {
    return;
  }

  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase persistence is required. Set CBL_SUPABASE_URL, CBL_SUPABASE_SERVICE_ROLE_KEY, and CBL_SUPABASE_SCHEMA.",
    );
  }

  assertUsaDataResidencyPolicyConfigured();
}

export function getSupabaseAdminClient(): SchemaBoundSupabaseClient {
  assertSupabasePersistenceConfigured();

  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  const schema = getSupabaseSchema();
  if (!url || !key || !schema) {
    throw new Error("Supabase configuration is missing.");
  }

  if (schema.toLowerCase() === "public") {
    throw new Error("CBL_SUPABASE_SCHEMA must be a dedicated non-public schema.");
  }

  if (!cachedClient) {
    cachedClient = createSchemaBoundClient(url, key, schema);
  }

  return cachedClient;
}

export function toDeterministicVectorLiteral(input: string, dimensions: number): string {
  const bucket = new Array<number>(dimensions).fill(0);

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const slot = index % dimensions;
    bucket[slot] += code;
  }

  const max = Math.max(...bucket, 1);
  const normalized = bucket.map((value) => Number((value / max).toFixed(6)));

  return `[${normalized.join(",")}]`;
}
