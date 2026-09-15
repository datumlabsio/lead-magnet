/**
 * Inlines Google Fonts into a report template.
 *
 *   node scripts/embed-fonts.mjs src/magnets/<slug>/report-template.html
 *
 * Report templates arrive exported from a design tool, and the export leaves
 * @font-face rules pointing at asset blobs that did not come with the file:
 *
 *   src: url("f055d991-a064-4c16-a38a-47a3470c515d") format('woff2')
 *
 * Chrome silently falls back to a system sans when those 404, so the PDF a lead
 * receives is visibly not the design that was signed off, and nothing errors to
 * tell you. This replaces the whole broken block with real woff2 files embedded
 * as data URIs.
 *
 * Embedded rather than linked to fonts.googleapis.com on purpose: the renderer
 * then needs no network, so a Google outage or a locked-down egress rule cannot
 * quietly change what the customer sees.
 *
 * Re-run it after replacing a template. It is idempotent.
 */

import { readFileSync, writeFileSync } from "node:fs";

const out = (line = "") => process.stdout.write(`${line}\n`);

const templatePath = process.argv[2];
if (!templatePath) {
  process.stderr.write("usage: node scripts/embed-fonts.mjs <template.html>\n");
  process.exit(1);
}

/** Only the families and weights the templates actually render. */
const FAMILIES = [
  { name: "Poppins", weights: [200, 300, 400, 500, 600, 700] },
  { name: "Lexend", weights: [300, 400] },
];

/** English reports, so the CJK and Vietnamese subsets are pure weight. */
const KEEP_SUBSETS = ["latin", "latin-ext"];

// Google serves woff2 only to user agents it believes support it.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const query = FAMILIES.map((f) => `family=${f.name}:wght@${f.weights.join(";")}`).join("&");
const cssUrl = `https://fonts.googleapis.com/css2?${query}&display=swap`;

out(`Fetching font CSS…`);
const cssResponse = await fetch(cssUrl, { headers: { "user-agent": UA } });
if (!cssResponse.ok) {
  process.stderr.write(`Google Fonts returned ${cssResponse.status}\n`);
  process.exit(1);
}
const css = await cssResponse.text();

// Google emits a `/* subset */` comment before each @font-face it belongs to.
const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]+\})/g)];
out(`  ${blocks.length} @font-face blocks offered`);

const wanted = blocks.filter(([, subset]) => KEEP_SUBSETS.includes(subset));
out(`  ${wanted.length} kept (${KEEP_SUBSETS.join(", ")})`);

const embedded = [];
let bytes = 0;
for (const [, subset, block] of wanted) {
  const urlMatch = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);
  if (!urlMatch) continue;

  const fontResponse = await fetch(urlMatch[1], { headers: { "user-agent": UA } });
  if (!fontResponse.ok) {
    process.stderr.write(`  failed to fetch ${urlMatch[1]} (${fontResponse.status})\n`);
    process.exit(1);
  }
  const buffer = Buffer.from(await fontResponse.arrayBuffer());
  bytes += buffer.length;

  const family = block.match(/font-family:\s*'([^']+)'/)?.[1] ?? "?";
  const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? "?";
  out(`  ${family} ${weight} ${subset} — ${(buffer.length / 1024).toFixed(1)} KB`);

  embedded.push(
    block.replace(
      /url\(https:\/\/[^)]+\.woff2\)/,
      `url(data:font/woff2;base64,${buffer.toString("base64")})`,
    ),
  );
}

const html = readFileSync(templatePath, "utf8");

// Replace every existing @font-face (the broken UUID ones, or a previous run's
// embedded set) with the freshly fetched block. Rewriting wholesale is what
// makes re-running safe.
const withoutOldFaces = html.replace(/@font-face\s*\{[^}]*\}/g, "");
const cleaned = withoutOldFaces
  // The export references a script asset that did not come with the file.
  .replace(/<script\s+src="[0-9a-f-]{36}"><\/script>/g, "")
  // Leftover subset comments from a previous embed.
  .replace(/\/\*\s*(vietnamese|latin|latin-ext|cyrillic[\w-]*|greek[\w-]*|devanagari)\s*\*\//g, "");

const marker = "<style>";
const at = cleaned.indexOf(marker);
if (at === -1) {
  process.stderr.write("No <style> block found to inject fonts into\n");
  process.exit(1);
}
const result =
  cleaned.slice(0, at + marker.length) +
  `\n/* Fonts embedded by scripts/embed-fonts.mjs. Do not hand-edit. */\n${embedded.join("\n")}\n` +
  cleaned.slice(at + marker.length);

writeFileSync(templatePath, result);
out("");
out(`Embedded ${embedded.length} faces, ${(bytes / 1024).toFixed(0)} KB of woff2`);
out(`Template is now ${(result.length / 1024).toFixed(0)} KB — ${templatePath}`);
