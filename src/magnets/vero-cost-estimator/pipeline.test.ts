import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/template";
import { submissionSchema, validateSubmission } from "@/lib/validation";
import { veroCostEstimator } from "./config";
import { CADENCE, type CadenceKey, SIZE, type SizeKey } from "./model";

/**
 * End-to-end pipeline test, minus the PDF render itself.
 *
 * Exercises exactly what a submission goes through — schema, validation, report
 * data, template fill — across the whole input space the form can produce.
 *
 * This exists because the failures that matter on a marketing form are the ones
 * that only strike some answers. `breakeven_month` arrives as null whenever
 * there is no break-even inside 36 months, which rejected the entire submission
 * for those visitors while everyone else sailed through. A test that only ever
 * tried one set of numbers would never have found it.
 *
 * The payloads below mirror what the page actually sends, captured from the
 * live form: numbers for the calculator answers, a boolean for consent, and
 * null for a break-even that never arrives.
 */

const template = readFileSync(
  path.join(process.cwd(), "src", "magnets", veroCostEstimator.report?.template ?? ""),
  "utf8",
);

type Answers = {
  pipelines: number;
  size: SizeKey;
  cadence: CadenceKey;
  kpis: number;
  engineers: number;
  salary: number;
  cloud: number | null;
  breakEven: number | null;
};

/** Builds the payload shape the page posts, including its null-able fields. */
function payload(a: Answers) {
  return {
    magnet: "vero-cost-estimator",
    data: {
      email: "ann@example.com",
      firstname: "Ann",
      lastname: "Lee",
      company: "Acme",
      marketing_consent: true,
      data_sources: a.pipelines,
      warehouse_size: SIZE[a.size].label,
      sync_cadence: CADENCE[a.cadence].label,
      warehouse_size_key: a.size,
      sync_cadence_key: a.cadence,
      kpi_count: a.kpis,
      inhouse_engineers: a.engineers,
      engineer_salary: a.salary,
      cloud_spend_month: a.cloud,
      saving_year_one: 1000,
      saving_three_year: 3000,
      hours_freed_y1: 300,
      engineer_months: 2.5,
      inhouse_cost_y1: 250000,
      datumlabs_cost_y1: 40000,
      days_to_live: 12,
      breakeven_month: a.breakEven,
    },
    utm: {},
    elapsedMs: 9000,
  };
}

/** Runs a payload all the way to filled HTML, failing loudly at each stage. */
function run(a: Answers) {
  const parsed = submissionSchema.safeParse(payload(a));
  expect(parsed.success, `schema rejected: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  if (!parsed.success) throw new Error("unreachable");

  const validated = validateSubmission(veroCostEstimator, parsed.data);
  expect(validated.ok, `validation rejected: ${"message" in validated ? validated.message : ""}`).toBe(
    true,
  );
  if (!validated.ok) throw new Error("unreachable");

  const data = veroCostEstimator.report?.buildData(validated.fields, validated.email);
  expect(data, "buildData returned null — no report would be sent").not.toBeNull();

  const rendered = renderTemplate(template, data ?? {});
  return { fields: validated.fields, data, rendered };
}

const SIZES = Object.keys(SIZE) as SizeKey[];
const CADENCES = Object.keys(CADENCE) as CadenceKey[];

const base: Answers = {
  pipelines: 6,
  size: "u1tb",
  cadence: "daily",
  kpis: 12,
  engineers: 2,
  salary: 130_000,
  cloud: null,
  breakEven: 4,
};

describe("every size and cadence the form offers", () => {
  for (const size of SIZES) {
    for (const cadence of CADENCES) {
      it(`${size} / ${cadence} renders a complete report`, () => {
        const { rendered } = run({ ...base, size, cadence });
        expect(rendered.missing).toEqual([]);
        expect(rendered.html).not.toContain("{{");
        expect(rendered.html).not.toContain("<sc-for");
      });
    }
  }
});

describe("the edges of the form's own limits", () => {
  const cases: Array<[string, Answers]> = [
    ["minimum everything", { ...base, pipelines: 1, size: "u10gb", cadence: "weekly", kpis: 0, engineers: 1, salary: 1, breakEven: null }],
    ["maximum everything", { ...base, pipelines: 100, size: "o50tb", cadence: "realtime", kpis: 300, engineers: 10, salary: 500_000 }],
    ["no KPIs", { ...base, kpis: 0 }],
    ["no break-even", { ...base, pipelines: 81, size: "u50tb", cadence: "weekly", kpis: 208, engineers: 1, salary: 395_077, cloud: 82_518, breakEven: null }],
    ["cloud spend of zero", { ...base, cloud: 0 }],
    ["cloud spend left blank", { ...base, cloud: null }],
    ["fractional salary", { ...base, salary: 99_999.99, cloud: 12.5 }],
    ["negative saving", { ...base, pipelines: 40, kpis: 200, engineers: 1, salary: 60_000 }],
  ];

  for (const [name, answers] of cases) {
    it(name, () => {
      const { rendered } = run(answers);
      expect(rendered.missing).toEqual([]);
      expect(rendered.html).not.toContain("{{");
    });
  }
});

describe("known failure shapes", () => {
  it("accepts a null break-even, which killed real submissions", () => {
    // Regression: `breakeven_month: null` rejected the whole payload as
    // "Malformed request." for anyone whose numbers had no break-even.
    const { rendered } = run({ ...base, breakEven: null });
    expect(rendered.missing).toEqual([]);
  });

  it("honours a cloud spend of zero instead of substituting an estimate", () => {
    const zero = run({ ...base, cloud: 0 });
    const blank = run({ ...base, cloud: null });
    // A visitor who typed 0 must not get the same report as one who left it
    // empty — the estimate is non-zero, so the figures differ.
    expect(zero.data).not.toEqual(blank.data);
  });

  it("keeps the computed fields the page reports", () => {
    const { fields } = run(base);
    for (const key of ["engineer_months", "inhouse_cost_y1", "datumlabs_cost_y1", "days_to_live"]) {
      expect(fields, `${key} was dropped`).toHaveProperty(key);
    }
  });

  it("escapes a company name that contains markup", () => {
    const parsed = submissionSchema.parse({
      ...payload(base),
      data: { ...payload(base).data, company: '<img src=x onerror="alert(1)">' },
    });
    const validated = validateSubmission(veroCostEstimator, parsed);
    if (!validated.ok) throw new Error("expected valid");
    const data = veroCostEstimator.report?.buildData(validated.fields, validated.email);
    const { html } = renderTemplate(template, data ?? {});
    // The point is that no *tag* is produced. The characters "onerror=" still
    // appear, escaped and inert, inside the rendered text — asserting on that
    // substring would be testing the wrong thing.
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("survives a name with an apostrophe", () => {
    const parsed = submissionSchema.parse({
      ...payload(base),
      data: { ...payload(base).data, company: "O'Brien & Sons" },
    });
    const validated = validateSubmission(veroCostEstimator, parsed);
    expect(validated.ok).toBe(true);
  });

  it("rejects an unknown warehouse size rather than rendering a wrong report", () => {
    const parsed = submissionSchema.parse({
      ...payload(base),
      data: { ...payload(base).data, warehouse_size_key: "u999tb" },
    });
    const validated = validateSubmission(veroCostEstimator, parsed);
    if (!validated.ok) throw new Error("expected valid");
    expect(veroCostEstimator.report?.buildData(validated.fields, validated.email)).toBeNull();
  });
});
