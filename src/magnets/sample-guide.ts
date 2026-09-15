import type { MagnetConfig } from "./types";

/**
 * The worked example. Copy this file to start a new magnet, or delete it once
 * a real one exists — `registry.ts` is the only other place it is referenced.
 */
export const sampleGuide: MagnetConfig = {
  slug: "sample-guide",
  name: "Sample Guide",
  published: false,

  asset: {
    path: "sample-guide/sample-guide.pdf",
    expiresInSeconds: 60 * 60 * 24 * 3,
  },

  email: {
    subject: "Your guide is ready",
    heading: "Here's your guide",
    body: [
      "Thanks for requesting the guide — the download link is below.",
      "The link works for 3 days. Reply to this email if you have any trouble.",
    ],
    buttonLabel: "Download the guide",
  },

  fields: [
    { name: "first_name", label: "First name", hubspotProperty: "firstname", maxLength: 80 },
    { name: "company", label: "Company", hubspotProperty: "company", maxLength: 120 },
  ],

  hubspot: {
    lifecycleStage: "lead",
    source: "sample-guide",
  },

  successMessage: "Check your inbox — the guide is on its way.",
};
