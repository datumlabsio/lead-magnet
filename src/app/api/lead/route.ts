import { type NextRequest, NextResponse } from "next/server";
import { sendInternalNotification, sendMagnetEmail } from "@/lib/email";
import { hubspotConfigured } from "@/lib/env";
import { upsertContact } from "@/lib/hubspot";
import { markEmailSent, markHubspotResult, recentSubmissionCount, recordLead } from "@/lib/leads";
import { signAssetUrl } from "@/lib/storage";
import { looksAutomated, submissionSchema, validateSubmission } from "@/lib/validation";
import { getPublishedMagnet } from "@/magnets/registry";

// node:crypto in the lead hashing path, so this cannot run on the edge runtime.
export const runtime = "nodejs";

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

const GENERIC_FAILURE = "Something went wrong on our end. Please try again.";

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

  // 2. The promise we made to the person who filled in the form.
  try {
    const asset = await signAssetUrl(magnet);
    await sendMagnetEmail(magnet, validated.email, asset);
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

  // 3. Best-effort from here. The lead has the asset and we have the record, so
  //    a CRM outage is an operational problem, not a lost lead.
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
