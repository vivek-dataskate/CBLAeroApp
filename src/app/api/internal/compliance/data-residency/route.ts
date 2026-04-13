import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import {
  listDataResidencyCheckEvents,
  recordDataResidencyCheckEvent,
} from "@/modules/audit";
import { evaluateUsaDataResidencyPolicy } from "@/modules/persistence/data-residency";

export const GET = withAuth(async ({ session, request, traceId }) => {
  const requestedTenantId = request.nextUrl.searchParams.get("tenantId");
  const tenantId = requestedTenantId ?? session.tenantId;
  const validation = evaluateUsaDataResidencyPolicy();
  const status = validation.valid ? "pass" : "fail";

  if (!validation.valid) {
    // Never turn an explicit policy failure into a 500 due to audit persistence issues.
    try {
      await recordDataResidencyCheckEvent({
        traceId,
        actorId: session.actorId,
        tenantId,
        status,
        approvedRegions: validation.approvedRegions,
        checkedTargets: validation.targets,
        violations: validation.violations,
      });
    } catch (error) {
      console.error("[compliance/data-residency] failed to persist failed-policy audit event", {
        traceId,
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json(
      {
        data: {
          current: {
            status,
            approvedRegions: validation.approvedRegions,
            checkedTargets: validation.targets,
            violations: validation.violations,
          },
          checks: [],
        },
        meta: {
          tenantId,
          count: 0,
        },
        error: {
          code: "data_residency_policy_failed",
          message: `USA data residency policy gate failed: ${validation.violations.join(" ")}`,
        },
      },
      { status: 412 },
    );
  }

  await recordDataResidencyCheckEvent({
    traceId,
    actorId: session.actorId,
    tenantId,
    status,
    approvedRegions: validation.approvedRegions,
    checkedTargets: validation.targets,
    violations: validation.violations,
  });

  const events = await listDataResidencyCheckEvents(tenantId);
  const latestChecks = events.slice(0, 50).reverse();

  const responseBody = {
    data: {
      current: {
        status,
        approvedRegions: validation.approvedRegions,
        checkedTargets: validation.targets,
        violations: validation.violations,
      },
      checks: latestChecks,
    },
    meta: {
      tenantId,
      count: latestChecks.length,
    },
  };

  return NextResponse.json(responseBody);
}, { action: "compliance:read-data-residency" });
