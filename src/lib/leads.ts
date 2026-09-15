import "server-only";
import { createHash } from "node:crypto";
import { env } from "./env";
import { supabase } from "./supabase";

export type LeadInput = {
  magnetSlug: string;
  email: string;
  fields: Record<string, string>;
  utm: Record<string, string>;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
};

/**
 * Stores the raw IP nowhere. A salted hash still lets us spot one address
 * hammering the form without keeping personal data we have no use for.
 */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env.ipHashSalt()}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Attempts the hash and gives up quietly. Used by the rate limiter, which is a
 * soft control: if the salt is unreadable we would rather not count than turn a
 * configuration problem into a blanket refusal of real leads.
 */
function tryHashIp(ip: string | null): string | null {
  try {
    return hashIp(ip);
  } catch {
    return null;
  }
}

/**
 * Writes the lead and returns its id.
 *
 * This is the first thing the submit route does, before the email and before
 * HubSpot. Everything downstream can fail and be retried from this row; nothing
 * downstream can be retried from a lead we never wrote down.
 */
export async function recordLead(input: LeadInput): Promise<string> {
  const { data, error } = await supabase()
    .from("leads")
    .insert({
      magnet_slug: input.magnetSlug,
      email: input.email,
      fields: input.fields,
      utm: input.utm,
      ip_hash: hashIp(input.ip),
      user_agent: input.userAgent,
      referrer: input.referrer,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Could not record lead: ${error?.message ?? "no row returned"}`);
  }

  return data.id as string;
}

/**
 * Applies a status update to a lead, and says so when it fails.
 *
 * These writes are all best-effort — none of them should unwind a delivery that
 * already happened. But discarding the error outright means a wrong column name
 * or a schema that was never migrated looks exactly like success, and the first
 * sign of trouble is a report column that is empty for every lead. Log it.
 */
async function patchLead(leadId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase().from("leads").update(patch).eq("id", leadId);
  if (error) {
    console.error(
      `Could not update lead ${leadId} (${Object.keys(patch).join(", ")}): ${error.message}`,
    );
  }
}

export async function markEmailSent(leadId: string): Promise<void> {
  await patchLead(leadId, { email_sent_at: new Date().toISOString() });
}

export async function markHubspotResult(
  leadId: string,
  result: { contactId: string } | { error: string },
): Promise<void> {
  const patch =
    "contactId" in result
      ? { hubspot_contact_id: result.contactId, hubspot_synced_at: new Date().toISOString() }
      : { hubspot_error: result.error.slice(0, 500) };

  await patchLead(leadId, patch);
}

/**
 * Records what happened to a generated report.
 *
 * `path` is where our own copy was filed, or null when the report was sent but
 * storing the copy failed — a distinction worth keeping, because the first means
 * sales can pull up exactly what the prospect received and the second does not.
 */
export async function markReportResult(
  leadId: string,
  result: { path: string | null } | { error: string },
): Promise<void> {
  const patch =
    "error" in result
      ? { report_error: result.error.slice(0, 500) }
      : { report_path: result.path, report_error: null };

  await patchLead(leadId, patch);
}

/**
 * Submissions from one IP hash for this magnet in the last hour. The route uses
 * it as a soft ceiling — a database count rather than in-memory state, because
 * serverless instances do not share memory and an in-memory limiter on Vercel
 * mostly limits nothing.
 */
export async function recentSubmissionCount(
  ip: string | null,
  magnetSlug: string,
): Promise<number> {
  const ipHash = tryHashIp(ip);
  if (!ipHash) return 0;

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase()
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .eq("magnet_slug", magnetSlug)
      .gte("created_at", since);

    if (error) return 0;
    return count ?? 0;
  } catch {
    // Fails open. The durable write in recordLead is the step allowed to reject
    // a submission; this one only ever throttles.
    return 0;
  }
}
