import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MagnetConfig } from "@/magnets/types";
import { renderPdf } from "./pdf";
import { renderTemplate } from "./template";

export type RenderedReport = {
  pdf: Buffer;
  filename: string;
};

/** Templates live beside their magnet's config. */
const TEMPLATE_ROOT = path.join(process.cwd(), "src", "magnets");

const templateCache = new Map<string, string>();

async function loadTemplate(relative: string): Promise<string> {
  const cached = templateCache.get(relative);
  if (cached) return cached;

  // Resolve and confirm containment: the path comes from a config file, but a
  // traversal here would turn a typo into an arbitrary file read.
  const full = path.resolve(TEMPLATE_ROOT, relative);
  if (!full.startsWith(TEMPLATE_ROOT + path.sep)) {
    throw new Error(`Template path escapes the magnets directory: ${relative}`);
  }

  const html = await readFile(full, "utf8");
  templateCache.set(relative, html);
  return html;
}

/** Replaces `{company}` in the configured filename, and keeps it filesystem-safe. */
function buildFilename(pattern: string, fields: Record<string, string>): string {
  const company = (fields.company ?? "report").replace(/[/\\:*?"<>|]/g, "").trim();
  return pattern.replace("{company}", company || "report");
}

/**
 * Renders a magnet's personalised report.
 *
 * Returns null when the magnet has no report configured, or when the answers
 * cannot produce one — a lead who somehow submitted without completing the
 * calculator. Null is a caller-handled outcome rather than a throw, because the
 * lead is already saved and the right response is to log it, not to unwind.
 */
export async function renderMagnetReport(
  magnet: MagnetConfig,
  fields: Record<string, string>,
  email: string,
): Promise<RenderedReport | null> {
  const report = magnet.report;
  if (!report) return null;

  const data = report.buildData(fields, email);
  if (!data) return null;

  const template = await loadTemplate(report.template);
  const { html, missing } = renderTemplate(template, data);

  if (missing.length > 0) {
    // Not fatal: a missing value renders as a blank rather than leaving `{{ }}`
    // on the page. Worth shouting about, because it means the template and the
    // data builder have drifted apart.
    console.warn(
      `Report template "${report.template}" had unresolved placeholders: ${missing.join(", ")}`,
    );
  }

  const pdf = await renderPdf(html, {
    width: report.width,
    height: report.height,
    keepShadows: report.keepShadows,
  });
  return { pdf, filename: buildFilename(report.filename, fields) };
}
