/**
 * The Vero cost model.
 *
 * A faithful port of the model in the estimator's own page script
 * (`public/m/vero-cost-estimator/index.html`). The server recomputes every
 * figure from the six raw inputs rather than trusting the numbers the browser
 * sends, so a tampered payload cannot produce a report full of invented
 * savings.
 *
 * Keeping it server-side is safe here because the page masks its results —
 * `REVEAL_ON_PAGE` is false, so the visitor only ever sees these numbers in the
 * PDF. If that flag is ever turned on, the two implementations become visible
 * to the same person at the same time and MUST be kept in step.
 */

/** Blended $/hr for build and maintenance. */
const RATE = 70;
const HOURS_PER_PIPELINE = 12;
const MODEL_HOURS_PER_PIPELINE = 10;
const BI_SETUP_HOURS = 8;
const HOURS_PER_KPI = 2.5;
const DISCOVERY_HOURS = 12;
/** 3 engineers x 6 focused hours, which sets our delivery timeline. */
const POD_HOURS_PER_DAY = 18;

/** Benefits, payroll tax, equipment, tooling seats. */
const LOADED_MULT = 1.3;
/** Search, interview, notice period. Unpaid, so a time cost only. */
const HIRE_LAG_MONTHS = 3;
const RAMP_MONTHS = 3;
const RAMP_OUTPUT = 0.5;
const ENG_HRS_PER_MONTH = 120;
const WORK_DAYS_MONTH = 21.7;

export type SizeKey = "u10gb" | "u100gb" | "u500gb" | "u1tb" | "u5tb" | "u10tb" | "u50tb" | "o50tb";
export type CadenceKey = "weekly" | "daily" | "hourly" | "realtime";

type SizeRow = {
  label: string;
  warehouseHrs: number;
  modelMult: number;
  maintMult: number;
  infraBase: number;
};
type CadenceRow = {
  label: string;
  orchHrs: number;
  /** One-off streaming engineering: CDC, replay, exactly-once, alerting. */
  premiumHrs: number;
  maintMult: number;
  infraMult: number;
};

export const SIZE: Record<SizeKey, SizeRow> = {
  u10gb: { label: "under 10 GB", warehouseHrs: 8, modelMult: 0.75, maintMult: 0.8, infraBase: 100 },
  u100gb: {
    label: "10 to 100 GB",
    warehouseHrs: 12,
    modelMult: 0.85,
    maintMult: 0.9,
    infraBase: 250,
  },
  u500gb: {
    label: "100 to 500 GB",
    warehouseHrs: 16,
    modelMult: 0.95,
    maintMult: 0.95,
    infraBase: 400,
  },
  u1tb: {
    label: "500 GB to 1 TB",
    warehouseHrs: 18,
    modelMult: 1.0,
    maintMult: 1.0,
    infraBase: 600,
  },
  u5tb: { label: "1 to 5 TB", warehouseHrs: 22, modelMult: 1.15, maintMult: 1.1, infraBase: 1000 },
  u10tb: {
    label: "5 to 10 TB",
    warehouseHrs: 26,
    modelMult: 1.25,
    maintMult: 1.2,
    infraBase: 1600,
  },
  u50tb: {
    label: "10 to 50 TB",
    warehouseHrs: 32,
    modelMult: 1.45,
    maintMult: 1.3,
    infraBase: 2600,
  },
  o50tb: {
    label: "over 50 TB",
    warehouseHrs: 40,
    modelMult: 1.7,
    maintMult: 1.45,
    infraBase: 4500,
  },
};

export const CADENCE: Record<CadenceKey, CadenceRow> = {
  weekly: { label: "weekly", orchHrs: 0, premiumHrs: 0, maintMult: 0.8, infraMult: 0.8 },
  daily: { label: "daily", orchHrs: 16, premiumHrs: 0, maintMult: 1.0, infraMult: 1.0 },
  hourly: { label: "hourly", orchHrs: 24, premiumHrs: 0, maintMult: 1.35, infraMult: 1.4 },
  realtime: {
    label: "near real-time",
    orchHrs: 32,
    premiumHrs: 150,
    maintMult: 1.6,
    infraMult: 1.9,
  },
};

export function isSizeKey(value: string): value is SizeKey {
  return value in SIZE;
}
export function isCadenceKey(value: string): value is CadenceKey {
  return value in CADENCE;
}

export type EstimatorInput = {
  pipelines: number;
  size: SizeKey;
  cadence: CadenceKey;
  kpis: number;
  engineers: number;
  salary: number;
  /** Monthly cloud and tooling spend. Omitted means "use our estimate". */
  infra?: number;
};

/** One line of the build-cost breakdown, for the report's category tables. */
export type CostCategory = {
  name: string;
  hours: number;
  cost: number;
  description: string;
  formula: string;
};

export type Estimate = {
  input: EstimatorInput;
  sizeLabel: string;
  cadenceLabel: string;
  infra: number;

  categories: CostCategory[];
  totalHours: number;
  maintHrs: number;

  ourFeeY1: number;
  ourFeeY3: number;
  loadedAnnual: number;
  theirsY1: number;
  theirsY3: number;
  saveY1: number;
  saveY3: number;

  theirBuildMonths: number;
  theirLiveMonths: number;
  ourDays: number;
  soonerMonths: number;

  hoursFreedY1: number;
  engMonthsFreed: number;
  breakEven: number | null;
};

/** Cloud spend is optional on the form; this is the fallback estimate. */
export function suggestedInfra(input: Pick<EstimatorInput, "size" | "cadence" | "pipelines">) {
  const raw = SIZE[input.size].infraBase * CADENCE[input.cadence].infraMult + input.pipelines * 15;
  return Math.round(raw / 25) * 25;
}

/** How long an in-house team needs to deliver `hours` of build work, with ramp. */
function inHouseBuildMonths(hours: number, engineers: number): number {
  let done = 0;
  for (let m = 1; m <= 120; m++) {
    done += engineers * ENG_HRS_PER_MONTH * (m <= RAMP_MONTHS ? RAMP_OUTPUT : 1);
    if (done >= hours) return m;
  }
  return 120;
}

/** First month our cumulative spend sits below what the in-house team has cost. */
function breakEvenMonth(buildTotal: number, retainer: number, monthlyPayroll: number) {
  for (let m = 1; m <= 36; m++) {
    const ours = buildTotal + retainer * (m - 1);
    const theirs = monthlyPayroll * Math.max(0, m - HIRE_LAG_MONTHS);
    if (theirs > 0 && ours <= theirs) return m;
  }
  return null;
}

export function estimate(input: EstimatorInput): Estimate {
  const engineers = Math.max(1, input.engineers);
  const size = SIZE[input.size];
  const cadence = CADENCE[input.cadence];
  const infra = input.infra ?? suggestedInfra(input);

  const kpiHrs = input.kpis > 0 ? BI_SETUP_HOURS + input.kpis * HOURS_PER_KPI : 0;

  // The six build categories, in the order the report lists them. Each carries
  // the formula that produced it, because the report shows its working.
  const categories: CostCategory[] = [
    {
      name: "Pipeline build",
      hours: input.pipelines * HOURS_PER_PIPELINE,
      cost: 0,
      description: "Connecting each source, handling its quirks, and landing it reliably.",
      formula: `${input.pipelines} sources × ${HOURS_PER_PIPELINE} hrs`,
    },
    {
      name: "Data modeling",
      hours: input.pipelines * MODEL_HOURS_PER_PIPELINE * size.modelMult,
      cost: 0,
      description: "Shaping raw tables into models the business can query with confidence.",
      formula: `${input.pipelines} × ${MODEL_HOURS_PER_PIPELINE} hrs × ${size.modelMult} (${size.label})`,
    },
    {
      name: "KPIs and reporting",
      hours: kpiHrs,
      cost: 0,
      description: "Defining each metric once, modelling it, and testing it holds.",
      formula:
        input.kpis > 0
          ? `${BI_SETUP_HOURS} hrs BI setup + ${input.kpis} KPIs × ${HOURS_PER_KPI} hrs`
          : "no KPIs requested",
    },
    {
      name: "Deployment",
      hours: DISCOVERY_HOURS + cadence.orchHrs,
      cost: 0,
      description: "Discovery, access and IAM, then orchestration on your chosen schedule.",
      formula: `${DISCOVERY_HOURS} hrs discovery + ${cadence.orchHrs} hrs orchestration (${cadence.label})`,
    },
    {
      name: "Warehouse setup",
      hours: size.warehouseHrs,
      cost: 0,
      description: "Sizing, partitioning and tuning the warehouse for your data volume.",
      formula: `${size.warehouseHrs} hrs for ${size.label}`,
    },
    {
      name: "Real-time engineering",
      hours: cadence.premiumHrs,
      cost: 0,
      description: "Change data capture, replay, exactly-once delivery and alerting.",
      formula:
        cadence.premiumHrs > 0
          ? `${cadence.premiumHrs} hrs for ${cadence.label}`
          : "not required at this cadence",
    },
  ].map((c) => ({ ...c, cost: c.hours * RATE }));

  const totalHours = categories.reduce((sum, c) => sum + c.hours, 0);
  const buildLabor = totalHours * RATE;

  const maintHrs =
    (2 + input.pipelines * 1.2) * cadence.maintMult * size.maintMult + input.kpis * 0.1;
  const maintLabor = maintHrs * RATE;
  const retainer = maintLabor + infra;
  const buildTotal = buildLabor + retainer;

  // Cloud spend is stripped out of both sides so the comparison is people only.
  const ourFeeY1 = buildLabor + maintLabor * 12;
  const ourFeeY3 = buildLabor + maintLabor * 36;

  const loadedAnnual = input.salary * LOADED_MULT;
  const payrollMonth = (loadedAnnual / 12) * engineers;

  // Conservative: nobody is on payroll during the hiring gap, so it costs time
  // rather than money.
  const theirsY1 = payrollMonth * Math.max(0, 12 - HIRE_LAG_MONTHS);
  const theirsY3 = payrollMonth * Math.max(0, 36 - HIRE_LAG_MONTHS);

  const theirBuildMonths = inHouseBuildMonths(totalHours, engineers);
  const theirLiveMonths = HIRE_LAG_MONTHS + theirBuildMonths;
  const ourDays = Math.max(1, Math.ceil(totalHours / POD_HOURS_PER_DAY));
  const soonerMonths = Math.max(0, theirLiveMonths - ourDays / WORK_DAYS_MONTH);
  const hoursFreedY1 = totalHours + maintHrs * 12;

  return {
    input,
    sizeLabel: size.label,
    cadenceLabel: cadence.label,
    infra,
    categories,
    totalHours,
    maintHrs,
    ourFeeY1,
    ourFeeY3,
    loadedAnnual,
    theirsY1,
    theirsY3,
    saveY1: theirsY1 - ourFeeY1,
    saveY3: theirsY3 - ourFeeY3,
    theirBuildMonths,
    theirLiveMonths,
    ourDays,
    soonerMonths,
    hoursFreedY1,
    engMonthsFreed: hoursFreedY1 / ENG_HRS_PER_MONTH,
    breakEven: breakEvenMonth(buildTotal, retainer, payrollMonth),
  };
}

export const MODEL_CONSTANTS = {
  RATE,
  HIRE_LAG_MONTHS,
  RAMP_MONTHS,
  LOADED_MULT,
  ENG_HRS_PER_MONTH,
  WORK_DAYS_MONTH,
} as const;
