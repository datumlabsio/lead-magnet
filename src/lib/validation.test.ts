import { describe, expect, it } from "vitest";
import type { MagnetConfig } from "@/magnets/types";
import { looksAutomated, submissionSchema, validateSubmission } from "./validation";

const magnet: MagnetConfig = {
  slug: "test",
  name: "Test",
  published: true,
  asset: { path: "test/test.pdf" },
  email: { subject: "s", heading: "h", body: ["b"] },
  fields: [
    { name: "first_name", label: "First name", required: true, maxLength: 10 },
    { name: "company", label: "Company" },
  ],
};

function submission(data: Record<string, string>, extra: Record<string, unknown> = {}) {
  return submissionSchema.parse({ magnet: "test", data, utm: {}, ...extra });
}

describe("looksAutomated", () => {
  it("catches a filled honeypot", () => {
    expect(looksAutomated(submission({ email: "a@b.com", _hp: "spam" }))).toBe(true);
  });

  it("ignores an empty honeypot", () => {
    expect(looksAutomated(submission({ email: "a@b.com", _hp: "  " }))).toBe(false);
  });

  it("catches a submission faster than a human can type", () => {
    expect(looksAutomated(submission({ email: "a@b.com" }, { elapsedMs: 200 }))).toBe(true);
  });

  it("allows a plausible fill time", () => {
    expect(looksAutomated(submission({ email: "a@b.com" }, { elapsedMs: 9000 }))).toBe(false);
  });

  it("allows a missing timing signal rather than assuming the worst", () => {
    expect(looksAutomated(submission({ email: "a@b.com" }))).toBe(false);
  });
});

describe("validateSubmission", () => {
  it("normalises the email to lowercase and trims it", () => {
    const result = validateSubmission(
      magnet,
      submission({ email: "  A@B.COM ", first_name: "Sam" }),
    );
    expect(result).toMatchObject({ ok: true, email: "a@b.com" });
  });

  it("rejects an invalid email", () => {
    const result = validateSubmission(magnet, submission({ email: "not-an-email" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = validateSubmission(magnet, submission({ email: "a@b.com" }));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a field over its max length", () => {
    const result = validateSubmission(
      magnet,
      submission({ email: "a@b.com", first_name: "Bartholomew the Third" }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("keeps an optional field when present and omits it when blank", () => {
    const withCompany = validateSubmission(
      magnet,
      submission({ email: "a@b.com", first_name: "Sam", company: "Acme" }),
    );
    expect(withCompany).toMatchObject({ ok: true, fields: { first_name: "Sam", company: "Acme" } });

    const without = validateSubmission(
      magnet,
      submission({ email: "a@b.com", first_name: "Sam", company: "   " }),
    );
    expect(without.ok && "company" in without.fields).toBe(false);
  });

  it("drops inputs the magnet never declared", () => {
    const result = validateSubmission(
      magnet,
      submission({ email: "a@b.com", first_name: "Sam", surprise: "not in the config" }),
    );
    expect(result.ok && result.fields).toEqual({ first_name: "Sam" });
  });

  it("keeps known utm params and ignores unknown ones", () => {
    const parsed = submissionSchema.parse({
      magnet: "test",
      data: { email: "a@b.com", first_name: "Sam" },
      utm: { utm_source: "linkedin", nonsense: "drop me" },
    });
    const result = validateSubmission(magnet, parsed);
    expect(result.ok && result.utm).toEqual({ utm_source: "linkedin" });
  });
});
