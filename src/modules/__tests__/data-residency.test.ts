import { describe, expect, it } from "vitest";

import {
  assertUsaDataResidencyPolicyConfigured,
  evaluateUsaDataResidencyPolicy,
} from "../persistence/data-residency";

describe("story 1.6 data residency policy validation", () => {
  it("fails when approved US regions list is missing", () => {
    const result = evaluateUsaDataResidencyPolicy({
      NODE_ENV: "development",
      CBL_DATA_REGION: "us-east-1",
      CBL_LOG_REGION: "us-east-1",
      CBL_BACKUP_REGION: "us-west-2",
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "CBL_APPROVED_US_REGIONS is required and must include approved USA regions.",
    );
  });

  it("fails when any target region is outside approved list", () => {
    const result = evaluateUsaDataResidencyPolicy({
      NODE_ENV: "development",
      CBL_APPROVED_US_REGIONS: "us-east-1,us-west-2",
      CBL_DATA_REGION: "eu-central-1",
      CBL_LOG_REGION: "us-east-1",
      CBL_BACKUP_REGION: "us-west-2",
    });

    expect(result.valid).toBe(false);
    expect(result.violations.some((issue) => issue.includes("CBL_DATA_REGION=eu-central-1"))).toBe(
      true,
    );
  });

  it("fails when approved region allowlist contains non-US identifiers", () => {
    const result = evaluateUsaDataResidencyPolicy({
      NODE_ENV: "development",
      CBL_APPROVED_US_REGIONS: "us-east-1,eu-west-1",
      CBL_DATA_REGION: "us-east-1",
      CBL_LOG_REGION: "us-east-1",
      CBL_BACKUP_REGION: "us-east-1",
    });

    expect(result.valid).toBe(false);
    expect(
      result.violations.some((issue) =>
        issue.includes("CBL_APPROVED_US_REGIONS contains non-USA region value: eu-west-1."),
      ),
    ).toBe(true);
  });

  it("passes when all configured targets are in approved US regions", () => {
    const result = evaluateUsaDataResidencyPolicy({
      NODE_ENV: "development",
      CBL_APPROVED_US_REGIONS: "us-east-1, us-west-2",
      CBL_DATA_REGION: "us-east-1",
      CBL_LOG_REGION: "us-west-2",
      CBL_BACKUP_REGION: "us-east-1",
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.targets).toEqual({
      data: "us-east-1",
      logs: "us-west-2",
      backups: "us-east-1",
    });
  });

  it("throws explicit error message in non-test mode when policy is invalid", () => {
    expect(() =>
      assertUsaDataResidencyPolicyConfigured({
        NODE_ENV: "production",
        CBL_APPROVED_US_REGIONS: "us-east-1,us-west-2",
        CBL_DATA_REGION: "ap-southeast-1",
        CBL_LOG_REGION: "us-east-1",
        CBL_BACKUP_REGION: "us-west-2",
      }),
    ).toThrow(/USA data residency policy gate failed:.*CBL_DATA_REGION=ap-southeast-1/);
  });

  it("does not throw in test mode even if invalid", () => {
    expect(() =>
      assertUsaDataResidencyPolicyConfigured({
        NODE_ENV: "test",
      }),
    ).not.toThrow();
  });
});
