import { describe, expect, it } from "vitest";
import type { MagnetConfig } from "@/magnets/types";
import { buildContactProperties } from "./hubspot-properties";

const base: MagnetConfig = {
  slug: "test",
  name: "Test",
  published: true,
  asset: { path: "test/test.pdf" },
  email: { subject: "s", heading: "h", body: ["b"] },
};

describe("buildContactProperties", () => {
  it("always sends the email", () => {
    expect(buildContactProperties(base, "a@b.com", {})).toEqual({ email: "a@b.com" });
  });

  it("maps only fields that declare a hubspot property", () => {
    const magnet: MagnetConfig = {
      ...base,
      fields: [
        { name: "first_name", label: "First name", hubspotProperty: "firstname" },
        { name: "how_did_you_hear", label: "How did you hear" },
      ],
    };
    const properties = buildContactProperties(magnet, "a@b.com", {
      first_name: "Sam",
      how_did_you_hear: "a friend",
    });
    expect(properties).toEqual({ email: "a@b.com", firstname: "Sam" });
  });

  it("skips a mapped field with no answer rather than clearing it in the CRM", () => {
    const magnet: MagnetConfig = {
      ...base,
      fields: [{ name: "company", label: "Company", hubspotProperty: "company" }],
    };
    expect(buildContactProperties(magnet, "a@b.com", {})).toEqual({ email: "a@b.com" });
  });

  it("applies lifecycle stage, source and literal properties", () => {
    const magnet: MagnetConfig = {
      ...base,
      hubspot: {
        lifecycleStage: "lead",
        source: "seo-guide",
        properties: { hs_lead_status: "NEW" },
      },
    };
    expect(buildContactProperties(magnet, "a@b.com", {})).toEqual({
      email: "a@b.com",
      lifecyclestage: "lead",
      lead_magnet_source: "seo-guide",
      hs_lead_status: "NEW",
    });
  });
});
