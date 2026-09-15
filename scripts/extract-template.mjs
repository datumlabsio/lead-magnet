/**
 * Extracts a report template from a design-tool "bundled page" export.
 *
 *   node scripts/extract-template.mjs <export.html> <out.html>
 *
 * Report templates arrive as a single self-unpacking HTML file: the real
 * document is a JSON-escaped string inside a bundler script, and its images and
 * fonts live in a `__bundler/manifest` block as gzipped base64, addressed by
 * UUID. Opened in a browser the bundler reassembles it; read as a file it is
 * 1 MB of noise with `<img src="de8bdf9c-…">` references that resolve to
 * nothing.
 *
 * This unpacks it into one clean, self-contained HTML file: the document, with
 * every manifest asset inlined as a data URI. Run `scripts/embed-fonts.mjs` on
 * the result afterwards to deal with the web fonts, which the export references
 * but does not carry.
 *
 * If a future export is not in this format the script says so and changes
 * nothing, rather than writing a mangled template.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const out = (line = "") => process.stdout.write(`${line}\n`);

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) {
  process.stderr.write("usage: node scripts/extract-template.mjs <export.html> <out.html>\n");
  process.exit(1);
}

const bundle = readFileSync(sourcePath, "utf8");

/* ------------------------------------------------------------------ assets */

const manifestMatch = bundle.match(
  /<script type="__bundler\/manifest">\s*(\{[\s\S]*?\})\s*<\/script>/,
);

const assets = new Map();
if (manifestMatch) {
  const manifest = JSON.parse(manifestMatch[1]);
  for (const [id, entry] of Object.entries(manifest)) {
    const raw = Buffer.from(entry.data, "base64");
    const bytes = entry.compressed ? gunzipSync(raw) : raw;
    assets.set(id, `data:${entry.mime};base64,${bytes.toString("base64")}`);
    out(`  asset ${id.slice(0, 8)}… ${entry.mime} — ${(bytes.length / 1024).toFixed(1)} KB`);
  }
  out(`Found ${assets.size} asset(s) in the manifest`);
} else {
  out("No bundler manifest found — continuing, any asset references will stay broken");
}

/* ---------------------------------------------------------------- document */

// The document is a JSON string literal; walk it honouring escapes rather than
// regex-matching to a closing quote, which a quote inside the HTML would break.
const start = bundle.indexOf('"<!DOCTYPE html>');
if (start === -1) {
  process.stderr.write("No embedded document found. Is this a bundled-page export?\n");
  process.exit(1);
}

let i = start + 1;
while (i < bundle.length) {
  if (bundle[i] === "\\") {
    i += 2;
    continue;
  }
  if (bundle[i] === '"') break;
  i += 1;
}

let html = JSON.parse(bundle.slice(start, i + 1));
out(`Extracted document — ${(html.length / 1024).toFixed(0)} KB`);

/* ------------------------------------------------------------------ inline */

let replaced = 0;
for (const [id, dataUri] of assets) {
  const before = html;
  html = html.split(id).join(dataUri);
  if (html !== before) replaced += 1;
}
out(`Inlined ${replaced} asset reference(s)`);

// Scripts in the export point at bundler machinery that is not being shipped,
// and a report template has no business running JavaScript anyway.
const scriptsRemoved = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? []).length;
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
html = html.replace(/<script\b[^>]*\/?>/g, "");
if (scriptsRemoved) out(`Removed ${scriptsRemoved} script tag(s)`);

const orphans = [...html.matchAll(/(?:src|href)="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]+)"/g)];
if (orphans.length > 0) {
  out("");
  out(`WARNING: ${orphans.length} asset reference(s) had no manifest entry:`);
  for (const [, id] of orphans) out(`  ${id}`);
  out("  These will render as broken. Ask for the missing assets.");
}

writeFileSync(targetPath, html);
out("");
out(`Wrote ${targetPath} — ${(html.length / 1024).toFixed(0)} KB`);
out(`Next: node scripts/embed-fonts.mjs ${targetPath}`);
