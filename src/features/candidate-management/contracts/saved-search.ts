export type SavedSearch = {
  id: string;
  tenantId: string;
  actorId: string;
  actorEmail: string;
  name: string;
  filters: Record<string, unknown>;
  digestEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SavedSearchCreateParams = {
  tenantId: string;
  actorId: string;
  actorEmail: string;
  name: string;
  filters: Record<string, unknown>;
};

export type SavedSearchUpdateParams = {
  name?: string;
  digestEnabled?: boolean;
};
