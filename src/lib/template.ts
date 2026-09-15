/**
 * The report template renderer.
 *
 * Handles the two constructs the handed-over report templates use:
 *
 *   {{ name }}                                  a value
 *   <sc-for list="{{ items }}" as="x"> … </sc-for>   a repeated block,
 *                                               whose body uses {{ x.prop }}
 *
 * Deliberately not a general template engine. There are no conditionals, no
 * expressions and no partials, because the templates do not use them and every
 * feature added here is another way for a marketing template to break a lead's
 * report at render time.
 *
 * Every interpolated value is HTML-escaped. Report data comes from the lead's
 * own form input — a company name is attacker-controlled text — and it lands
 * inside both element bodies and `style="…"` attributes.
 */

export type Scalar = string | number;
export type TemplateRow = Record<string, Scalar>;
export type TemplateData = Record<string, Scalar | TemplateRow[]>;

export type RenderResult = {
  html: string;
  /** Placeholders the data did not supply. Rendered as empty, reported here. */
  missing: string[];
};

function escapeHtml(value: Scalar): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
// Non-greedy body: the templates never nest one loop inside another, and a
// greedy match would swallow everything up to the last closing tag.
const LOOP = /<sc-for\s+list="\{\{\s*([\w.]+)\s*\}\}"\s+as="(\w+)"[^>]*>([\s\S]*?)<\/sc-for>/g;

function fill(template: string, lookup: (key: string) => Scalar | undefined, missing: string[]) {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = lookup(key);
    if (value === undefined) {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return escapeHtml(value);
  });
}

export function renderTemplate(template: string, data: TemplateData): RenderResult {
  const missing: string[] = [];

  // Loops first: their bodies contain placeholders that only resolve against a
  // row, and expanding them afterwards would leave {{ cat.name }} unresolved.
  const expanded = template.replace(
    LOOP,
    (_match, listKey: string, alias: string, body: string) => {
      const rows = data[listKey];
      if (!Array.isArray(rows)) {
        if (!missing.includes(listKey)) missing.push(listKey);
        return "";
      }
      const prefix = `${alias}.`;
      return rows
        .map((row) =>
          fill(
            body,
            (key) => (key.startsWith(prefix) ? row[key.slice(prefix.length)] : undefined),
            missing,
          ),
        )
        .join("");
    },
  );

  const html = fill(
    expanded,
    (key) => {
      const value = data[key];
      return Array.isArray(value) ? undefined : value;
    },
    missing,
  );

  return { html, missing };
}
