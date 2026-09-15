import "server-only";
import type { MagnetConfig } from "@/magnets/types";
import { env } from "./env";
import { buildContactProperties } from "./hubspot-properties";

const UPSERT_URL = "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert";

/**
 * How long we wait on HubSpot before giving up.
 *
 * The lead is already saved and the magnet email has already gone out by the
 * time this runs, so a slow CRM must not hold the browser. The failure is
 * recorded on the lead row and can be replayed.
 */
const TIMEOUT_MS = 8000;

type UpsertResponse = {
  results?: Array<{ id?: string }>;
};

/**
 * Creates or updates the contact, keyed on email.
 *
 * Returns the contact id, or throws. The caller treats a throw as non-fatal and
 * records it against the lead — a CRM outage must never cost us the lead or
 * stop the magnet reaching the person who asked for it.
 */
export async function upsertContact(
  magnet: MagnetConfig,
  email: string,
  fields: Record<string, string>,
): Promise<string> {
  const token = env.hubspotToken();
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set");

  const response = await fetch(UPSERT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inputs: [
        {
          id: email,
          idProperty: "email",
          properties: buildContactProperties(magnet, email, fields),
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`HubSpot upsert failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as UpsertResponse;
  const contactId = payload.results?.[0]?.id;
  if (!contactId) {
    throw new Error("HubSpot upsert returned no contact id");
  }

  return contactId;
}
