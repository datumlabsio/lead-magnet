import { describe, expect, it } from "vitest";
import {
  type CadenceKey,
  type EstimatorInput,
  estimate,
  isCadenceKey,
  isSizeKey,
  type SizeKey,
  suggestedInfra,
} from "./model";

/**
 * Differential test against the estimator's own script.
 *
 * The reference below is transcribed from the `compute()` in
 * `public/m/vero-cost-estimator/index.html`, deliberately kept in its original
 * shape rather than tidied. Its whole value is being an independent copy: if
 * the TypeScript port drifts from the page, or a constant is mistyped, these
 * assertions fail. Tidying it into something that shares structure with the
 * port would quietly destroy that.
 */

const RATE = 70;
const HOURS_PER_PIPELINE = 12;
const MODEL_HOURS_PER_PIPELINE = 10;
const BI_SETUP_HOURS = 8;
const HOURS_PER_KPI = 2.5;
const DISCOVERY_HOURS = 12;
const POD_HOURS_PER_DAY = 18;
const LOADED_MULT = 1.3;
const HIRE_LAG_MONTHS = 3;
const RAMP_MONTHS = 3;
const RAMP_OUTPUT = 0.5;
const ENG_HRS_PER_MONTH = 120;
const WORK_DAYS_MONTH = 21.7;

const SIZE_REF: Record<
  string,
  { warehouseHrs: number; modelMult: number; maintMult: number; infraBase: number }
> = {
  u10gb: { warehouseHrs: 8, modelMult: 0.75, maintMult: 0.8, infraBase: 100 },
  u100gb: { warehouseHrs: 12, modelMult: 0.85, maintMult: 0.9, infraBase: 250 },
  u500gb: { warehouseHrs: 16, modelMult: 0.95, maintMult: 0.95, infraBase: 400 },
  u1tb: { warehouseHrs: 18, modelMult: 1.0, maintMult: 1.0, infraBase: 600 },
  u5tb: { warehouseHrs: 22, modelMult: 1.15, maintMult: 1.1, infraBase: 1000 },
  u10tb: { warehouseHrs: 26, modelMult: 1.25, maintMult: 1.2, infraBase: 1600 },
  u50tb: { warehouseHrs: 32, modelMult: 1.45, maintMult: 1.3, infraBase: 2600 },
  o50tb: { warehouseHrs: 40, modelMult: 1.7, maintMult: 1.45, infraBase: 4500 },
};

const CADENCE_REF: Record<
  string,
  { orchHrs: number; premiumHrs: number; maintMult: number; infraMult: number }
> = {
  weekly: { orchHrs: 0, premiumHrs: 0, maintMult: 0.8, infraMult: 0.8 },
  daily: { orchHrs: 16, premiumHrs: 0, maintMult: 1.0, infraMult: 1.0 },
  hourly: { orchHrs: 24, premiumHrs: 0, maintMult: 1.35, infraMult: 1.4 },
  realtime: { orchHrs: 32, premiumHrs: 150, maintMult: 1.6, infraMult: 1.9 },
};

function refInHouseBuildMonths(hours: number, engineers: number) {
  let done = 0;
  for (let m = 1; m <= 120; m++) {
    done += engineers * ENG_HRS_PER_MONTH * (m <= RAMP_MONTHS ? RAMP_OUTPUT : 1);
    if (done >= hours) return m;
  }
  return 120;
}

function refBreakEven(buildTotal: number, retainer: number, monthlyPayroll: number) {
  for (let m = 1; m <= 36; m++) {
    const ours = buildTotal + retainer * (m - 1);
    const theirs = monthlyPayroll * Math.max(0, m - HIRE_LAG_MONTHS);
    if (theirs > 0 && ours <= theirs) return m;
  }
  return null;
}

function reference(i: EstimatorInput) {
  const pipelines = i.pipelines;
  const kpis = i.kpis;
  const engineers = Math.max(1, i.engineers);
  const salary = i.salary;
  const size = SIZE_REF[i.size];
  const cadence = CADENCE_REF[i.cadence];
  if (!size || !cadence) throw new Error("bad key");

  const infra =
    i.infra ?? Math.round((size.infraBase * cadence.infraMult + pipelines * 15) / 25) * 25;

  const kpiHrs = kpis > 0 ? BI_SETUP_HOURS + kpis * HOURS_PER_KPI : 0;

  const totalHours =
    pipelines * HOURS_PER_PIPELINE +
    pipelines * MODEL_HOURS_PER_PIPELINE * size.modelMult +
    kpiHrs +
    DISCOVERY_HOURS +
    cadence.orchHrs +
    size.warehouseHrs +
    cadence.premiumHrs;

  const buildLabor = totalHours * RATE;
  const maintHrs = (2 + pipelines * 1.2) * cadence.maintMult * size.maintMult + kpis * 0.1;
  const maintLabor = maintHrs * RATE;
  const retainer = maintLabor + infra;
  const buildTotal = buildLabor + retainer;

  const ourFeeY1 = buildLabor + maintLabor * 12;
  const ourFeeY3 = buildLabor + maintLabor * 36;

  const loadedAnnual = salary * LOADED_MULT;
  const payrollMonth = (loadedAnnual / 12) * engineers;
  const theirsY1 = payrollMonth * Math.max(0, 12 - HIRE_LAG_MONTHS);
  const theirsY3 = payrollMonth * Math.max(0, 36 - HIRE_LAG_MONTHS);

  const theirBuildMonths = refInHouseBuildMonths(totalHours, engineers);
  const theirLiveMonths = HIRE_LAG_MONTHS + theirBuildMonths;
  const ourDays = Math.max(1, Math.ceil(totalHours / POD_HOURS_PER_DAY));
  const soonerMonths = Math.max(0, theirLiveMonths - ourDays / WORK_DAYS_MONTH);
  const hoursFreedY1 = totalHours + maintHrs * 12;

  return {
    infra,
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
    breakEven: refBreakEven(buildTotal, retainer, payrollMonth),
  };
}

const SIZES = Object.keys(SIZE_REF) as SizeKey[];
const CADENCES = Object.keys(CADENCE_REF) as CadenceKey[];

describe("estimate matches the estimator page's own model", () => {
  const cases: EstimatorInput[] = [];
  for (const size of SIZES) {
    for (const cadence of CADENCES) {
      cases.push({ pipelines: 6, size, cadence, kpis: 12, engineers: 2, salary: 130_000 });
    }
  }
  // Edges: no KPIs, a single tiny setup, and a large one.
  cases.push({
    pipelines: 1,
    size: "u10gb",
    cadence: "weekly",
    kpis: 0,
    engineers: 1,
    salary: 80_000,
  });
  cases.push({
    pipelines: 40,
    size: "o50tb",
    cadence: "realtime",
    kpis: 200,
    engineers: 8,
    salary: 220_000,
  });
  cases.push({
    pipelines: 6,
    size: "u1tb",
    cadence: "daily",
    kpis: 12,
    engineers: 2,
    salary: 130_000,
    infra: 900,
  });

  for (const input of cases) {
    it(`${input.pipelines}src ${input.size}/${input.cadence} ${input.kpis}kpi ${input.engineers}eng`, () => {
      const got = estimate(input);
      const want = reference(input);

      // totalHours is the one worth stating explicitly: the port sums the six
      // report categories, while the page sums six inline expressions. They
      // must agree, or the breakdown would not add up to the headline figure.
      expect(got.totalHours).toBeCloseTo(want.totalHours, 9);
      expect(got.categories.reduce((s, c) => s + c.hours, 0)).toBeCloseTo(want.totalHours, 9);

      expect(got.infra).toBe(want.infra);
      expect(got.maintHrs).toBeCloseTo(want.maintHrs, 9);
      expect(got.ourFeeY1).toBeCloseTo(want.ourFeeY1, 6);
      expect(got.ourFeeY3).toBeCloseTo(want.ourFeeY3, 6);
      expect(got.loadedAnnual).toBeCloseTo(want.loadedAnnual, 6);
      expect(got.theirsY1).toBeCloseTo(want.theirsY1, 6);
      expect(got.theirsY3).toBeCloseTo(want.theirsY3, 6);
      expect(got.saveY1).toBeCloseTo(want.saveY1, 6);
      expect(got.saveY3).toBeCloseTo(want.saveY3, 6);
      expect(got.theirBuildMonths).toBe(want.theirBuildMonths);
      expect(got.theirLiveMonths).toBe(want.theirLiveMonths);
      expect(got.ourDays).toBe(want.ourDays);
      expect(got.soonerMonths).toBeCloseTo(want.soonerMonths, 9);
      expect(got.hoursFreedY1).toBeCloseTo(want.hoursFreedY1, 9);
      expect(got.engMonthsFreed).toBeCloseTo(want.engMonthsFreed, 9);
      expect(got.breakEven).toBe(want.breakEven);
    });
  }
});

describe("category breakdown", () => {
  const input: EstimatorInput = {
    pipelines: 6,
    size: "u1tb",
    cadence: "daily",
    kpis: 12,
    engineers: 2,
    salary: 130_000,
  };

  it("always produces the six categories the report template expects", () => {
    expect(estimate(input).categories).toHaveLength(6);
  });

  it("costs each category at the blended rate", () => {
    for (const c of estimate(input).categories) {
      expect(c.cost).toBeCloseTo(c.hours * 70, 9);
    }
  });

  it("keeps zero-hour categories rather than hiding them, and says why", () => {
    const noKpis = estimate({ ...input, kpis: 0, cadence: "weekly" });
    const kpiRow = noKpis.categories.find((c) => c.name === "KPIs and reporting");
    const rtRow = noKpis.categories.find((c) => c.name === "Real-time engineering");
    expect(kpiRow?.hours).toBe(0);
    expect(kpiRow?.formula).toBe("no KPIs requested");
    expect(rtRow?.hours).toBe(0);
    expect(rtRow?.formula).toBe("not required at this cadence");
  });
});

describe("input guards", () => {
  it("recognises every valid key and rejects others", () => {
    expect(isSizeKey("u1tb")).toBe(true);
    expect(isSizeKey("nope")).toBe(false);
    expect(isCadenceKey("realtime")).toBe(true);
    expect(isCadenceKey("yearly")).toBe(false);
  });

  it("treats zero engineers as one rather than dividing by nothing", () => {
    const got = estimate({
      pipelines: 3,
      size: "u1tb",
      cadence: "daily",
      kpis: 4,
      engineers: 0,
      salary: 100_000,
    });
    expect(Number.isFinite(got.theirsY1)).toBe(true);
    expect(got.theirsY1).toBeGreaterThan(0);
  });

  it("rounds the suggested infra estimate to the nearest 25", () => {
    const value = suggestedInfra({ size: "u5tb", cadence: "hourly", pipelines: 7 });
    expect(value % 25).toBe(0);
  });
});
