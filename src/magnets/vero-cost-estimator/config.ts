import type { MagnetConfig } from "../types";
import { type EstimatorInput, estimate, isCadenceKey, isSizeKey } from "./model";
import { buildReportData } from "./report";

/**
 * Vero cost estimator.
 *
 * Unlike a plain download magnet, this one has no `asset`: the deliverable is a
 * PDF rendered from the visitor's own calculator answers and attached to the
 * email. See `report.buildData` below for the hand-off into the model.
 *
 * The page owns its own submit, success state and redirect, so it does not load
 * `/lm.js` — its `submitLead()` posts to the API directly.
 */

/** Reads an integer answer, tolerating the strings a form sends. */
function int(fields: Record<string, string>, key: string): number {
  const value = Number.parseInt(fields[key] ?? "", 10);
  return Number.isFinite(value) ? value : Number.NaN;
}
function float(fields: Record<string, string>, key: string): number {
  const value = Number.parseFloat(fields[key] ?? "");
  return Number.isFinite(value) ? value : Number.NaN;
}

export const veroCostEstimator: MagnetConfig = {
  slug: "vero-cost-estimator",
  name: "Vero Cost Estimator",
  published: true,

  report: {
    filename: "Vero cost estimate — {company}.pdf",
    template: "vero-cost-estimator/report-template.html",
    width: 816,
    height: 1056,

    /**
     * Rebuilds the estimate server-side from the six raw inputs.
     *
     * The browser sends its computed figures too, but they are not used: the
     * report is the only place these numbers are ever seen, so recomputing costs
     * nothing and means a doctored payload cannot mint a report full of
     * invented savings.
     */
    buildData(fields, email) {
      const size = fields.warehouse_size_key ?? "";
      const cadence = fields.sync_cadence_key ?? "";
      if (!isSizeKey(size) || !isCadenceKey(cadence)) return null;

      const cloud = float(fields, "cloud_spend_month");
      const input: EstimatorInput = {
        pipelines: int(fields, "data_sources"),
        size,
        cadence,
        kpis: int(fields, "kpi_count"),
        engineers: int(fields, "inhouse_engineers"),
        salary: float(fields, "engineer_salary"),
        // `>= 0`, not `> 0`. A visitor who enters 0 has answered the question,
        // and the page honours that; treating it as unanswered would silently
        // substitute our estimate and print a figure they never gave us.
        ...(Number.isFinite(cloud) && cloud >= 0 ? { infra: cloud } : {}),
      };

      const required = [input.pipelines, input.kpis, input.engineers, input.salary];
      if (required.some((n) => !Number.isFinite(n))) return null;
      if (input.pipelines < 1 || input.engineers < 1 || input.salary <= 0) return null;

      return buildReportData(estimate(input), {
        firstName: fields.firstname ?? "",
        lastName: fields.lastname ?? "",
        company: fields.company ?? "",
        email,
      });
    },
  },

  email: {
    subject: "Your Vero cost estimate is attached",
    heading: "Your Vero cost estimate is attached",
    body: [
      "Hi {{firstname}},",
      "Attached below is your number. It shows what building this yourself would actually cost you, worked out line by line for your situation specifically.",
      "Most people are only guessing at this, but you don't have to guess anymore. Take a look and see what stands out to you.",
      "If it lands the way you'd expect, [grab 30 minutes with me](https://www.datumlabs.io/vero?utm_source=lead_magnet&utm_medium=cost_of_bad_data_calculator#v-book). I'm the one who'd actually build it. I'll show you exactly how we'd close that gap.",
      "Nidal",
      "Datum Labs, Vero",
    ],
  },

  fields: [
    {
      name: "firstname",
      label: "First name",
      required: true,
      hubspotProperty: "firstname",
      maxLength: 80,
    },
    {
      name: "lastname",
      label: "Last name",
      required: true,
      hubspotProperty: "lastname",
      maxLength: 80,
    },
    {
      name: "company",
      label: "Company",
      required: true,
      hubspotProperty: "company",
      maxLength: 120,
    },
    { name: "marketing_consent", label: "Marketing consent" },

    // Calculator answers. Kept in Supabase for analysis and fed to the report;
    // only the ones sales would segment on are pushed to HubSpot.
    { name: "warehouse_size_key", label: "Warehouse size (key)", maxLength: 20 },
    { name: "sync_cadence_key", label: "Sync cadence (key)", maxLength: 20 },
    {
      name: "data_sources",
      label: "Data sources",
      hubspotProperty: "vero_est_data_sources",
      maxLength: 10,
    },
    {
      name: "warehouse_size",
      label: "Warehouse size",
      hubspotProperty: "vero_est_warehouse_size",
      maxLength: 40,
    },
    {
      name: "sync_cadence",
      label: "Sync cadence",
      hubspotProperty: "vero_est_sync_cadence",
      maxLength: 40,
    },
    {
      name: "kpi_count",
      label: "KPIs",
      hubspotProperty: "vero_est_kpi_count",
      maxLength: 10,
    },
    {
      name: "inhouse_engineers",
      label: "In-house engineers",
      hubspotProperty: "vero_est_inhouse_engineers",
      maxLength: 10,
    },
    {
      name: "engineer_salary",
      label: "Engineer salary",
      hubspotProperty: "vero_est_engineer_salary",
      maxLength: 12,
    },
    { name: "cloud_spend_month", label: "Cloud spend / month", maxLength: 12 },

    // Computed by the page. Stored for analysis only — the report recomputes
    // everything from the inputs above rather than trusting these.
    // The figure the page computed. Safe to send as-is: model.test.ts proves
    // the server's recomputation agrees across the whole input space, so this
    // cannot show sales a different number from the one in the customer's PDF.
    {
      name: "saving_year_one",
      label: "Saving, year one (reported)",
      hubspotProperty: "vero_est_saving_year_one",
      maxLength: 16,
    },
    { name: "saving_three_year", label: "Saving, three years (reported)", maxLength: 16 },
    { name: "hours_freed_y1", label: "Hours freed, year one (reported)", maxLength: 16 },
    { name: "days_to_live", label: "Days to live (reported)", maxLength: 10 },
    // Sent as null when there is no break-even inside 36 months, which is a
    // common outcome rather than an edge case.
    { name: "breakeven_month", label: "Break-even month (reported)", maxLength: 10 },
    { name: "engineer_months", label: "Engineer-months freed (reported)", maxLength: 16 },
    { name: "inhouse_cost_y1", label: "In-house cost, year one (reported)", maxLength: 16 },
    { name: "datumlabs_cost_y1", label: "Datum Labs cost, year one (reported)", maxLength: 16 },
  ],

  hubspot: {
    lifecycleStage: "lead",
    source: "vero-cost-estimator",
    // The portal already had a `vero_lead_magnet` enumeration from an earlier
    // ROI calculator. Setting it too keeps this magnet visible to reporting
    // built on that taxonomy, alongside our own `lead_magnet_source`.
    properties: {
      vero_lead_magnet: "Vero Cost Estimator",
    },
  },
};
