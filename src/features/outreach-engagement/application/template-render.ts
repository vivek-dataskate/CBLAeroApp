/**
 * Mustache-style `{{var}}` substitution for SMS template bodies.
 *
 * ~50 LOC, zero dependencies. Intentionally does NOT escape HTML — SMS is
 * plain text; raw angle-brackets are legitimate characters, never markup.
 *
 * Behavior:
 *   - `{{key}}` is replaced by `String(context[key])` when key is present.
 *   - Missing keys are left as `{{key}}` and reported in `missingKeys`.
 *   - `{{first_name}}` fallback is applied by the caller, not this function,
 *     so tests can distinguish between "renderer left it in" and "caller
 *     substituted a fallback".
 *   - Unicode and emoji passthrough unchanged.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Upper bound matches the DB `sms_templates_body_length` CHECK. */
export const MAX_RENDERED_BODY_LENGTH = 1600;

export interface RenderTemplateResult {
  rendered: string;
  /** Placeholder keys present in the body but NOT provided in context. */
  missingKeys: string[];
  /** Placeholder keys provided in context but NOT present in the body. */
  unusedKeys: string[];
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

export function renderTemplate(
  body: string,
  context: Record<string, unknown>,
): RenderTemplateResult {
  if (typeof body !== 'string') {
    throw new TemplateRenderError('renderTemplate: body must be a string');
  }

  const missingSet = new Set<string>();
  const usedSet = new Set<string>();

  const rendered = body.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const raw = context[key];
      if (raw === undefined || raw === null) {
        missingSet.add(key);
        return match;
      }
      usedSet.add(key);
      return String(raw);
    }
    missingSet.add(key);
    return match;
  });

  if (rendered.length > MAX_RENDERED_BODY_LENGTH) {
    throw new TemplateRenderError(
      `renderTemplate: rendered body exceeds ${MAX_RENDERED_BODY_LENGTH} characters (got ${rendered.length})`,
    );
  }

  const unusedKeys = Object.keys(context).filter((k) => !usedSet.has(k));

  return {
    rendered,
    missingKeys: [...missingSet].sort(),
    unusedKeys: unusedKeys.sort(),
  };
}

/** Extract the set of `{{var}}` placeholders present in a template body. */
export function extractPlaceholders(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    found.add(m[1]);
  }
  return [...found].sort();
}
