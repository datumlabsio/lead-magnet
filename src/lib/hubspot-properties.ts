import type { MagnetConfig } from "@/magnets/types";

/**
 * Builds the HubSpot contact properties for a submission.
 *
 * Pure and separate from the API client so the mapping can be tested without a
 * network or a token — this is the part most likely to break quietly when
 * someone adds a field to a magnet config and mistypes the HubSpot property.
 *
 * Only fields that declare a `hubspotProperty` cross over; the rest stay in
 * Supabase. That keeps the CRM free of one-off columns for questions that were
 * only ever interesting on a single landing page.
 */
export function buildContactProperties(
  magnet: MagnetConfig,
  email: string,
  fields: Record<string, string>,
): Record<string, string> {
  const properties: Record<string, string> = { email };

  for (const field of magnet.fields ?? []) {
    const value = fields[field.name];
    if (field.hubspotProperty && value) {
      properties[field.hubspotProperty] = value;
    }
  }

  if (magnet.hubspot?.lifecycleStage) {
    properties.lifecyclestage = magnet.hubspot.lifecycleStage;
  }
  if (magnet.hubspot?.source) {
    properties.lead_magnet_source = magnet.hubspot.source;
  }
  for (const [key, value] of Object.entries(magnet.hubspot?.properties ?? {})) {
    properties[key] = value;
  }

  return properties;
}
