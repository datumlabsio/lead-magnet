import "server-only";
import { Resend } from "resend";
import type { MagnetConfig } from "@/magnets/types";
import { env } from "./env";
import type { SignedAsset } from "./storage";

let cached: Resend | undefined;

function resend(): Resend {
  if (!cached) cached = new Resend(env.resendApiKey());
  return cached;
}

/**
 * Magnet copy is plain text by contract, so it is escaped on the way into the
 * template. A config file is not a trusted authoring surface for HTML — it is
 * edited by whoever is shipping a landing page that week.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Fills `{{ token }}` from the lead's own answers.
 *
 * Marketing writes "Hi {{first_name}}," and expects it to work. A token with no
 * answer collapses to nothing rather than printing the raw braces at someone.
 */
function fillTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => tokens[key] ?? "");
}

/**
 * Turns `[label](https://…)` into a link, after escaping.
 *
 * Escaping first means the label and the surrounding copy cannot introduce
 * markup; only this deliberate pattern produces a tag. Only http(s) is linked,
 * so a `javascript:` URL in a config stays inert text.
 */
function linkify(escaped: string): string {
  return escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${href}" style="color:#237fde;text-decoration:underline;">${label}</a>`,
  );
}

function paragraphs(body: string[], tokens: Record<string, string>): string {
  return body
    .map(
      (line) => `<p style="margin:0 0 16px;">${linkify(escapeHtml(fillTokens(line, tokens)))}</p>`,
    )
    .join("");
}

function plainText(body: string[], tokens: Record<string, string>): string[] {
  // Markdown links read fine as "label (url)" in a text part.
  return body.map((line) =>
    fillTokens(line, tokens).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)"),
  );
}

function hoursFrom(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function shell(inner: string): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;">
    <tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#1a1a1a;">
${inner}
    </td></tr>
  </table>
</body></html>`;
}

export type EmailTokens = Record<string, string>;

/** Sends the magnet as a signed download link. A throw means it did not arrive. */
export async function sendMagnetEmail(
  magnet: MagnetConfig,
  to: string,
  asset: SignedAsset,
  tokens: EmailTokens = {},
): Promise<void> {
  const buttonLabel = escapeHtml(magnet.email.buttonLabel ?? "Download now");
  const html = shell(
    `      <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;">${escapeHtml(
      fillTokens(magnet.email.heading, tokens),
    )}</h1>
${paragraphs(magnet.email.body, tokens)}
      <p style="margin:28px 0;">
        <a href="${asset.url}" style="display:inline-block;padding:13px 26px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${buttonLabel}</a>
      </p>
      <p style="margin:0;font-size:13px;color:#6b6b6b;">
        This link expires in ${hoursFrom(asset.expiresInSeconds)}. Reply to this email if it stops working and we'll send a fresh one.
      </p>`,
  );

  const text = [
    fillTokens(magnet.email.heading, tokens),
    "",
    ...plainText(magnet.email.body, tokens),
    "",
    magnet.email.buttonLabel ?? "Download now",
    asset.url,
    "",
    `This link expires in ${hoursFrom(asset.expiresInSeconds)}.`,
  ].join("\n");

  const { error } = await resend().emails.send({
    from: magnet.email.from ?? env.resendFrom(),
    to,
    subject: fillTokens(magnet.email.subject, tokens),
    html,
    text,
    ...(magnet.email.replyTo ? { replyTo: magnet.email.replyTo } : {}),
  });

  if (error) throw new Error(`Resend rejected the delivery email: ${error.message}`);
}

/**
 * Sends a generated report as an attachment.
 *
 * No download button and no expiry notice: the PDF is in the message, so
 * telling the reader a link will expire would be nonsense.
 */
export async function sendReportEmail(
  magnet: MagnetConfig,
  to: string,
  pdf: Buffer,
  filename: string,
  tokens: EmailTokens = {},
): Promise<void> {
  const html = shell(
    `      <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;">${escapeHtml(
      fillTokens(magnet.email.heading, tokens),
    )}</h1>
${paragraphs(magnet.email.body, tokens)}`,
  );

  const text = [
    fillTokens(magnet.email.heading, tokens),
    "",
    ...plainText(magnet.email.body, tokens),
  ].join("\n");

  const { error } = await resend().emails.send({
    from: magnet.email.from ?? env.resendFrom(),
    to,
    subject: fillTokens(magnet.email.subject, tokens),
    html,
    text,
    attachments: [{ filename, content: pdf }],
    ...(magnet.email.replyTo ? { replyTo: magnet.email.replyTo } : {}),
  });

  if (error) throw new Error(`Resend rejected the report email: ${error.message}`);
}

/**
 * Tells the team a lead arrived. Best-effort by design — the lead is already in
 * Supabase, so a failed internal notification is noise, not data loss.
 */
export async function sendInternalNotification(
  magnet: MagnetConfig,
  email: string,
  fields: Record<string, string>,
): Promise<void> {
  const to = env.notifyEmail();
  if (!to) return;

  const rows = [
    ["Magnet", magnet.name],
    ["Email", email],
    ...(magnet.fields ?? []).map((field) => [field.label, fields[field.name] ?? "—"] as const),
  ];

  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td><strong>${escapeHtml(String(label))}</strong></td><td>${escapeHtml(String(value))}</td></tr>`,
    )
    .join("");

  try {
    await resend().emails.send({
      from: env.resendFrom(),
      to,
      subject: `New lead: ${magnet.name}`,
      html: `<table cellpadding="6">${body}</table>`,
      replyTo: email,
    });
  } catch (cause) {
    console.warn("Internal lead notification failed", cause);
  }
}
