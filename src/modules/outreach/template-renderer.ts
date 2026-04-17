/**
 * Pure template rendering — no I/O, fully unit-testable.
 * Resolves {{variable}} placeholders from a variables map.
 */

import { createHash } from "crypto";

export type RenderResult = {
  rendered: string;
  contentHash: string;
  warnings: string[];
};

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const MAX_SMS_LENGTH = 1600;

/**
 * Render an SMS template body by substituting {{variable}} placeholders.
 * Unresolved variables are replaced with empty string and warned.
 */
export function renderTemplate(
  body: string,
  variables: Record<string, string | undefined | null>,
): RenderResult {
  const warnings: string[] = [];

  const rendered = body.replace(VARIABLE_PATTERN, (_match, varName: string) => {
    const value = variables[varName];
    if (value == null || value === "") {
      warnings.push(`Unresolved variable: {{${varName}}}`);
      return "";
    }
    return value;
  });

  if (rendered.length > MAX_SMS_LENGTH) {
    warnings.push(
      `Rendered message exceeds ${MAX_SMS_LENGTH} chars (${rendered.length})`,
    );
  }

  const contentHash = computeContentHash(rendered);

  return { rendered, contentHash, warnings };
}

/**
 * SHA-256 hash of rendered body — used for dedup and audit.
 * Optionally include recipient phone for per-send uniqueness.
 */
export function computeContentHash(
  renderedBody: string,
  recipientPhone?: string,
): string {
  const input = recipientPhone
    ? `${renderedBody}:${recipientPhone}`
    : renderedBody;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Extract all variable names from a template body.
 */
export function extractVariables(body: string): string[] {
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
  while ((match = pattern.exec(body)) !== null) {
    if (!vars.includes(match[1])) {
      vars.push(match[1]);
    }
  }
  return vars;
}
