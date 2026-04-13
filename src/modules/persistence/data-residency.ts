export type DataResidencyTargetKind = "data" | "logs" | "backups";

export type DataResidencyTargets = Record<DataResidencyTargetKind, string | null>;

export type DataResidencyValidation = {
  valid: boolean;
  approvedRegions: string[];
  targets: DataResidencyTargets;
  violations: string[];
};

import { validateUsaDataResidencyPolicyFromEnv } from "../../../scripts/data-residency-policy.cjs";

function shouldEnforcePolicy(env: NodeJS.ProcessEnv): boolean {
  const mode = (env.NODE_ENV ?? "development").trim().toLowerCase();
  return mode !== "test";
}

export function evaluateUsaDataResidencyPolicy(
  env: NodeJS.ProcessEnv = process.env,
): DataResidencyValidation {
  const validation = validateUsaDataResidencyPolicyFromEnv(env);

  return {
    valid: validation.valid,
    approvedRegions: validation.approvedRegions,
    targets: {
      data: validation.targets.data,
      logs: validation.targets.logs,
      backups: validation.targets.backups,
    },
    violations: validation.violations,
  };
}

export function assertUsaDataResidencyPolicyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): DataResidencyValidation {
  const validation = evaluateUsaDataResidencyPolicy(env);

  if (!shouldEnforcePolicy(env)) {
    return validation;
  }

  if (!validation.valid) {
    throw new Error(
      `USA data residency policy gate failed: ${validation.violations.join(" ")}`,
    );
  }

  return validation;
}