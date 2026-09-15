import type { TemplateData, TemplateRow } from "@/lib/template";
import { type Estimate, MODEL_CONSTANTS } from "./model";

/**
 * Turns an estimate into the values the report template asks for.
 *
 * The template's contract is fixed by the designer's file: ten scalars, plus
 * `metric_cards` ({value,label}) and `categories`
 * ({name,barPct,cost,costPct,description,formula}). Everything here exists to
 * satisfy exactly that, so a change to the template is the only reason to
 * change this file.
 */

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const monthsFmt = (m: number) => {
  if (m < 1) {
    return `${Math.max(1, Math.round(m * MODEL_CONSTANTS.WORK_DAYS_MONTH))} working days`;
  }
  if (m < 2) return "about a month";
  return `${Math.round(m)} months`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type ReportContact = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
};

export function buildReportData(estimate: Estimate, contact: ReportContact): TemplateData {
  const positive = estimate.saveY1 >= 0;
  const { input } = estimate;

  const maxCost = Math.max(...estimate.categories.map((c) => c.cost), 1);
  const totalCost = estimate.categories.reduce((sum, c) => sum + c.cost, 0) || 1;

  const categories: TemplateRow[] = estimate.categories.map((c) => ({
    name: c.name,
    // Bars are scaled against the largest category so the chart uses its full
    // width; the percentage label is of the total, which is the useful number.
    barPct: `${((c.cost / maxCost) * 100).toFixed(1)}%`,
    cost: money(c.cost),
    costPct: `${Math.round((c.cost / totalCost) * 100)}%`,
    description: c.description,
    formula: c.formula,
  }));

  const metricCards: TemplateRow[] = [
    { value: money(Math.abs(estimate.saveY3)), label: "saved over three years" },
    { value: estimate.engMonthsFreed.toFixed(1), label: "engineer-months freed, year one" },
    { value: `${estimate.ourDays}`, label: "working days to go live" },
  ];

  const savingContext = positive
    ? `against ${plural(input.engineers, "in-house data engineer")} at ${money(input.salary)} base. ` +
      "Cloud and tooling spend is excluded from both sides."
    : `At this scope an in-house team of ${input.engineers} is cheaper on paper. ` +
      `The trade is ${monthsFmt(estimate.soonerMonths)} of delay before anything works.`;

  const executiveSummary = positive
    ? `Building this in-house would cost ${money(estimate.theirsY1)} in fully loaded payroll in ` +
      `year one. Datum Labs delivers the same scope for ${money(estimate.ourFeeY1)}, a saving of ` +
      `${money(estimate.saveY1)}. You would also have a working stack in ` +
      `${plural(estimate.ourDays, "working day")} rather than ${monthsFmt(estimate.theirLiveMonths)}.`
    : `At this scope, ${plural(input.engineers, "in-house engineer")} costs ` +
      `${money(estimate.theirsY1)} in year one against our ${money(estimate.ourFeeY1)}. ` +
      `The case for us here is speed, not price: ${plural(estimate.ourDays, "working day")} to a ` +
      `working stack against ${monthsFmt(estimate.theirLiveMonths)}.`;

  const breakEven = estimate.breakEven
    ? `We are cheaper than hiring from month ${estimate.breakEven} onward.`
    : "Over a three-year horizon, hiring remains the cheaper option on price alone.";

  const whatThisMeans =
    `The in-house figure assumes ${MODEL_CONSTANTS.HIRE_LAG_MONTHS} months to hire, during which ` +
    "nobody is on payroll and nothing gets built, then a further " +
    `${plural(estimate.theirBuildMonths, "month")} of build at half output for the first ` +
    `${MODEL_CONSTANTS.RAMP_MONTHS} while the team learns your systems. ` +
    `A fully loaded engineer is costed at ${MODEL_CONSTANTS.LOADED_MULT}× base salary. ` +
    `Our figure is ${Math.round(estimate.totalHours)} build hours plus ` +
    `${estimate.maintHrs.toFixed(1)} hours a month of maintenance, at ` +
    `${money(MODEL_CONSTANTS.RATE)}/hr blended. ${breakEven}`;

  const inputsSummary =
    `${plural(input.pipelines, "data source")}, ${estimate.sizeLabel} in the warehouse, ` +
    `synced ${estimate.cadenceLabel}, ${plural(input.kpis, "KPI")} to model. ` +
    `Compared against ${plural(input.engineers, "engineer")} at ${money(input.salary)} base salary. ` +
    `Cloud and tooling spend of ${money(estimate.infra)}/month is excluded from both sides, ` +
    "because you pay it either way.";

  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    report_title: `Vero cost estimate for ${contact.company}`,
    meta_line: `Prepared for ${contact.firstName} ${contact.lastName}, ${contact.company} · ${date}`,
    hero_kicker: positive ? "Estimated year-one saving" : "Estimated year-one difference",
    // The hero sits on near-black, so these are the on-dark pair from the
    // estimator's own palette rather than the on-white ones.
    hero_figure_color: positive ? "#3ecf8e" : "#f26d6d",
    saving_year_one_abs: money(Math.abs(estimate.saveY1)),
    saving_year_one_context: savingContext,
    executive_summary: executiveSummary,
    what_this_means: whatThisMeans,
    inputs_summary: inputsSummary,
    footer_line: `Prepared by Datum Labs for ${contact.company}. Figures are an estimate based on the inputs above.`,
    metric_cards: metricCards,
    categories,
  };
}
