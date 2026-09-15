import { after, type NextRequest, NextResponse } from "next/server";
import { sendInternalNotification, sendMagnetEmail, sendReportEmail } from "@/lib/email";
import { hubspotConfigured } from "@/lib/env";
import { upsertContact } from "@/lib/hubspot";
import {
  markEmailSent,
  markHubspotResult,
  markReportResult,
  recentSubmissionCount,
  recordLead,
} from "@/lib/leads";
import { renderMagnetReport } from "@/lib/report-render";
import { signAssetUrl, storeReport } from "@/lib/storage";
import { looksAutomated, submissionSchema, validateSubmission } from "@/lib/validation";
import { getPublishedMagnet } from "@/magnets/registry";
import type { MagnetConfig } from "@/magnets/types";

// node:crypto in the lead hashing path, and headless Chrome for report
// rendering, so this cannot run on the edge runtime.
export const runtime = "nodejs";

// Chrome needs considerably longer than the default to boot and render.
export const maxDuration = 60;

/**
 * Submissions per IP hash per magnet per hour before we stop accepting.
 *
 * Set high on purpose. A shared office NAT puts a whole company behind one
 * address, and this limit answers with a fake success — so a number tuned to
 * catch bots would silently swallow real leads from exactly the kind of company
 * worth capturing. The honeypot and the timing check do the real bot filtering;
 * this is only a backstop against someone hammering one form.
 */
const HOURLY_LIMIT = 40;

const GENERIC_FAILURE = "Something went wrong on our end. Please try again.";

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : request.headers.get("x-real-ip");
}

/**
 * Shown to a bot that tripped the honeypot or the timing check, and to anyone
 * over the rate limit. It is deliberately indistinguishable from a real success:
 * a precise rejection message is free tuning advice for whoever is probing.
 */
function silentSuccess(): NextResponse {
  return NextResponse.json({ ok: true });
}

/**
 * Outermost guard. Every failure the handler anticipates is already answered
 * with its own message; this only catches the ones it does not, so an
 * unexpected throw still reaches the browser as JSON. A blank 500 renders as a
 * dead form with no explanation, which is the worst thing this endpoint can do.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handleSubmission(request);
  } catch (cause) {
    console.error("Unhandled error in lead submission", cause);
    return NextResponse.json({ ok: false, message: GENERIC_FAILURE }, { status: 500 });
  }
}

/**
 * Renders the personalised report, emails it, and files a copy.
 *
 * Runs after the response has been sent. A page that shows its own confirmation
 * and redirects a few seconds later must not sit waiting on a Chrome cold
 * start, and the lead is already durably recorded before this begins — so the
 * worst case here is a report that has to be re-sent, not a lead that is lost.
 */
async function deliverReport(
  magnet: MagnetConfig,
  leadId: string,
  email: string,
  fields: Record<string, string>,
  tokens: Record<string, string>,
): Promise<void> {
  try {
    const rendered = await renderMagnetReport(magnet, fields, email);
    if (!rendered) {
      await markReportResult(leadId, { error: "Answers did not produce a report" });
      console.error(`Lead ${leadId} produced no report for magnet "${magnet.slug}"`);
      return;
    }

    await sendReportEmail(magnet, email, rendered.pdf, rendered.filename, tokens);
    await markEmailSent(leadId);

    // Filing our own copy is a convenience, not part of the promise to the
    // lead, so it must never turn a delivered report into a recorded failure.
    try {
      const path = await storeReport(magnet.slug, leadId, rendered.pdf);
      await markReportResult(leadId, { path });
    } catch (cause) {
      console.warn(`Report for lead ${leadId} was sent but not stored`, cause);
      await markReportResult(leadId, { path: null });
    }
  } catch (cause) {
    console.error(`Could not deliver report for lead ${leadId}`, cause);
    await markReportResult(leadId, {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function handleSubmission(request: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const parsed = submissionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }
  const submission = parsed.data;

  const magnet = getPublishedMagnet(submission.magnet);
  if (!magnet) {
    // Unknown and unpublished are the same answer on purpose: an unpublished
    // slug should not be discoverable by probing this endpoint.
    return NextResponse.json(
      { ok: false, message: "This form is not available." },
      { status: 404 },
    );
  }

  if (looksAutomated(submission)) {
    return silentSuccess();
  }

  const validated = validateSubmission(magnet, submission);
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, message: validated.message },
      { status: validated.status },
    );
  }

  const ip = clientIp(request);
  if ((await recentSubmissionCount(ip, magnet.slug)) >= HOURLY_LIMIT) {
    return silentSuccess();
  }

  // 1. Durability first. Everything below can fail and be replayed from this
  //    row; nothing below can be replayed from a lead we never wrote down.
  let leadId: string;
  try {
    leadId = await recordLead({
      magnetSlug: magnet.slug,
      email: validated.email,
      fields: validated.fields,
      utm: validated.utm,
      ip,
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    });
  } catch (cause) {
    console.error("Could not record lead", cause);
    return NextResponse.json({ ok: false, message: GENERIC_FAILURE }, { status: 500 });
  }

  // Available to the email copy as {{ firstname }}, {{ company }} and so on.
  const tokens = { ...validated.fields, email: validated.email };

  // 2. The promise we made to the person who filled in the form.
  if (magnet.report) {
    // Rendering is slow, so it happens after the response. The page has already
    // been told the report is on its way, which is true.
    after(() => deliverReport(magnet, leadId, validated.email, validated.fields, tokens));
  } else {
    try {
      const asset = await signAssetUrl(magnet);
      await sendMagnetEmail(magnet, validated.email, asset, tokens);
      await markEmailSent(leadId);
    } catch (cause) {
      console.error(`Could not deliver magnet "${magnet.slug}" to lead ${leadId}`, cause);
      return NextResponse.json(
        {
          ok: false,
          message: "We saved your details but couldn't send the email. We'll follow up shortly.",
        },
        { status: 500 },
      );
    }
  }

  // 3. Best-effort from here. The lead has been recorded and the delivery is
  //    under way, so a CRM outage is an operational problem, not a lost lead.
  if (hubspotConfigured()) {
    try {
      const contactId = await upsertContact(magnet, validated.email, validated.fields);
      await markHubspotResult(leadId, { contactId });
    } catch (cause) {
      console.error(`HubSpot sync failed for lead ${leadId}`, cause);
      await markHubspotResult(leadId, {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  await sendInternalNotification(magnet, validated.email, validated.fields);

  return NextResponse.json({
    ok: true,
    redirect: magnet.thankYouUrl ?? null,
    message: magnet.successMessage ?? "Check your inbox — it's on its way.",
  });
}
