declare module "../../../scripts/data-residency-policy.cjs" {
  export type SharedResidencyTargetKind = "data" | "logs" | "backups";

  export type SharedResidencyTargets = Record<SharedResidencyTargetKind, string | null>;

  export type SharedDataResidencyValidation = {
    valid: boolean;
    approvedRegions: string[];
    targets: SharedResidencyTargets;
    violations: string[];
  };

  export function validateUsaDataResidencyPolicyFromEnv(
    env?: NodeJS.ProcessEnv,
  ): SharedDataResidencyValidation;
}
