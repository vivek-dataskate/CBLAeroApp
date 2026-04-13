export type TenantContext = {
  tenantId: string | null;
};

export function resolveTenantContext(): TenantContext {
  // Story 1.1 baseline: tenant resolution is a placeholder for future middleware.
  return {
    tenantId: null,
  };
}
