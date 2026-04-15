#!/usr/bin/env node

import { config } from 'dotenv';
import residencyPolicy from "./data-residency-policy.cjs";

// Load .env.local
config({ path: '.env.local' });

const { validateUsaDataResidencyPolicyFromEnv } = residencyPolicy;
const validation = validateUsaDataResidencyPolicyFromEnv(process.env);

if (!validation.valid) {
  console.error(`USA data residency policy gate failed: ${validation.violations.join(" ")}`);
  process.exit(1);
}

console.log("USA data residency preflight passed.");