const REQUIRED_TARGETS = [
  { kind: "data", envKey: "CBL_DATA_REGION" },
  { kind: "logs", envKey: "CBL_LOG_REGION" },
  { kind: "backups", envKey: "CBL_BACKUP_REGION" },
];

function parseRegionList(value) {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function normalizeRegion(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function isUsRegionIdentifier(value) {
  return /^us-[a-z0-9-]+$/.test(value);
}

function validateUsaDataResidencyPolicyFromEnv(env = process.env) {
  const approvedRegions = parseRegionList(env.CBL_APPROVED_US_REGIONS);

  const targets = {
    data: null,
    logs: null,
    backups: null,
  };

  const violations = [];

  if (approvedRegions.length === 0) {
    violations.push(
      "CBL_APPROVED_US_REGIONS is required and must include approved USA regions.",
    );
  }

  for (const approvedRegion of approvedRegions) {
    if (!isUsRegionIdentifier(approvedRegion)) {
      violations.push(
        `CBL_APPROVED_US_REGIONS contains non-USA region value: ${approvedRegion}.`,
      );
    }
  }

  for (const target of REQUIRED_TARGETS) {
    const value = normalizeRegion(env[target.envKey]);
    targets[target.kind] = value;

    if (!value) {
      violations.push(`${target.envKey} is required and cannot be empty.`);
      continue;
    }

    if (!approvedRegions.includes(value)) {
      const approved = approvedRegions.length > 0 ? approvedRegions.join(", ") : "<none>";
      violations.push(
        `${target.envKey}=${value} is not in approved USA regions: ${approved}.`,
      );
    }
  }

  return {
    valid: violations.length === 0,
    approvedRegions,
    targets,
    violations,
  };
}

module.exports = {
  REQUIRED_TARGETS,
  parseRegionList,
  normalizeRegion,
  isUsRegionIdentifier,
  validateUsaDataResidencyPolicyFromEnv,
};
