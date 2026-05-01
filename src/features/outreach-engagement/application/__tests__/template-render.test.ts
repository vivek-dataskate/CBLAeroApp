import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  extractPlaceholders,
  TemplateRenderError,
  MAX_RENDERED_BODY_LENGTH,
} from '../template-render';

describe('renderTemplate', () => {
  it('substitutes a single placeholder', () => {
    const r = renderTemplate('Hi {{first_name}}', { first_name: 'Sam' });
    expect(r.rendered).toBe('Hi Sam');
    expect(r.missingKeys).toEqual([]);
  });

  it('substitutes multiple placeholders', () => {
    const r = renderTemplate('Hi {{first_name}}, {{role}} role', {
      first_name: 'Sam',
      role: 'A&P',
    });
    expect(r.rendered).toBe('Hi Sam, A&P role');
  });

  it('handles the same placeholder repeated', () => {
    const r = renderTemplate('{{x}} and {{x}}', { x: 'foo' });
    expect(r.rendered).toBe('foo and foo');
    expect(r.missingKeys).toEqual([]);
  });

  it('leaves unknown placeholders intact and reports them', () => {
    const r = renderTemplate('Hi {{first_name}} at {{missing}}', { first_name: 'Sam' });
    expect(r.rendered).toBe('Hi Sam at {{missing}}');
    expect(r.missingKeys).toContain('missing');
  });

  it('treats undefined and null as missing', () => {
    const r = renderTemplate('Hi {{x}} {{y}}', { x: undefined, y: null });
    expect(r.rendered).toBe('Hi {{x}} {{y}}');
    expect(r.missingKeys.sort()).toEqual(['x', 'y']);
  });

  it('coerces numbers and booleans via String()', () => {
    const r = renderTemplate('{{n}} / {{b}}', { n: 42, b: true });
    expect(r.rendered).toBe('42 / true');
  });

  it('reports unused context keys', () => {
    const r = renderTemplate('Hi {{first_name}}', { first_name: 'Sam', unused: 'x' });
    expect(r.unusedKeys).toEqual(['unused']);
  });

  it('tolerates whitespace inside the braces', () => {
    const r = renderTemplate('Hi {{ first_name }}', { first_name: 'Sam' });
    expect(r.rendered).toBe('Hi Sam');
  });

  it('passes through raw angle brackets (plain-text SMS, no HTML escaping)', () => {
    const r = renderTemplate('Hi {{n}}, visit <url>', { n: '<script>' });
    // The renderer is intentionally NOT HTML-escaping — SMS is plain text.
    expect(r.rendered).toBe('Hi <script>, visit <url>');
  });

  it('preserves Unicode and emoji', () => {
    const r = renderTemplate('Hola {{n}} 🛫', { n: 'Ángel' });
    expect(r.rendered).toBe('Hola Ángel 🛫');
  });

  it('returns an empty body unchanged', () => {
    const r = renderTemplate('', {});
    expect(r.rendered).toBe('');
    expect(r.missingKeys).toEqual([]);
  });

  it('returns a body with no placeholders unchanged', () => {
    const r = renderTemplate('Reply STOP to opt out.', {});
    expect(r.rendered).toBe('Reply STOP to opt out.');
  });

  it('throws on non-string body', () => {
    // @ts-expect-error — intentional runtime guard
    expect(() => renderTemplate(42, {})).toThrow(TemplateRenderError);
  });

  it('throws when rendered body exceeds MAX_RENDERED_BODY_LENGTH', () => {
    const body = '{{long}}';
    const long = 'x'.repeat(MAX_RENDERED_BODY_LENGTH + 1);
    expect(() => renderTemplate(body, { long })).toThrow(/exceeds/);
  });

  it('does NOT match keys starting with a digit', () => {
    const r = renderTemplate('{{1bad}} ok', { '1bad': 'x' });
    // Regex requires [a-zA-Z_] lead — the placeholder is left as-is.
    expect(r.rendered).toBe('{{1bad}} ok');
  });
});

describe('extractPlaceholders', () => {
  it('returns a sorted unique set of placeholders', () => {
    const keys = extractPlaceholders('{{z}} {{a}} {{a}} {{b}}');
    expect(keys).toEqual(['a', 'b', 'z']);
  });

  it('returns an empty array when the body has no placeholders', () => {
    expect(extractPlaceholders('plain text')).toEqual([]);
  });
});
