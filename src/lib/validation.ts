import { z } from "zod";
import type { MagnetConfig } from "@/magnets/types";

/**
 * A submission is a flat bag of whatever the handed-over form contained, plus
 * the bits `lm.js` adds. The server decides what matters: the email, the fields
 * the magnet's config declares, and the two spam signals. Anything else in the
 * form is dropped rather than stored.
 *
 * That asymmetry is deliberate. A designer adding an input to their HTML must
 * never be able to break the pipeline or quietly widen what we persist.
 */
export const submissionSchema = z.object({
  magnet: z.string().min(1).max(100),
  data: z.record(z.string(), z.string()).default({}),
  utm: z.record(z.string(), z.string()).default({}),
  /** Milliseconds between page load and submit, reported by the browser. */
  elapsedMs: z.number().int().nonnegative().optional(),
});

export type Submission = z.infer<typeof submissionSchema>;

/** Name of the hidden input `lm.js` injects. A bot fills it; a human cannot see it. */
export const HONEYPOT_FIELD = "_hp";

/** Faster than this and it was not typed by a person. */
const MIN_ELAPSED_MS = 1500;

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
] as const;

export type ValidationFailure = { ok: false; status: number; message: string };
export type ValidationSuccess = {
  ok: true;
  email: string;
  fields: Record<string, string>;
  utm: Record<string, string>;
};

const emailSchema = z.email().max(254);

/**
 * Silent rejection cases return 200 with a success-shaped body at the route, not
 * an error: telling a bot precisely which signal caught it is free tuning advice.
 */
export function looksAutomated(submission: Submission): boolean {
  const honeypot = submission.data[HONEYPOT_FIELD];
  if (honeypot !== undefined && honeypot.trim() !== "") return true;
  if (submission.elapsedMs !== undefined && submission.elapsedMs < MIN_ELAPSED_MS) return true;
  return false;
}

/** Pulls the email and the configured fields out of the raw form payload. */
export function validateSubmission(
  magnet: MagnetConfig,
  submission: Submission,
): ValidationFailure | ValidationSuccess {
  const rawEmail = (submission.data.email ?? "").trim().toLowerCase();
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) {
    return { ok: false, status: 400, message: "Please enter a valid email address." };
  }

  const fields: Record<string, string> = {};
  for (const field of magnet.fields ?? []) {
    const value = (submission.data[field.name] ?? "").trim();

    if (!value) {
      if (field.required) {
        return { ok: false, status: 400, message: `${field.label} is required.` };
      }
      continue;
    }

    if (value.length > (field.maxLength ?? 200)) {
      return { ok: false, status: 400, message: `${field.label} is too long.` };
    }

    fields[field.name] = value;
  }

  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = submission.utm[key];
    if (value) utm[key] = value.slice(0, 200);
  }

  return { ok: true, email: email.data, fields, utm };
}
