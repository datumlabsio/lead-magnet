import { describe, expect, it } from "vitest";
import { isServerless } from "./runtime";

describe("isServerless", () => {
  it("detects Vercel Fluid Compute, where no Lambda variable is set", () => {
    // The regression: production ran here, found no AWS_LAMBDA_FUNCTION_NAME,
    // took the local-Chrome branch and failed every render.
    expect(isServerless({ VERCEL: "1" })).toBe(true);
  });

  it("detects classic Lambda", () => {
    expect(isServerless({ AWS_LAMBDA_FUNCTION_NAME: "fn" })).toBe(true);
  });

  it("detects a Vercel build as well as a Vercel runtime", () => {
    expect(isServerless({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
  });

  it("is false on a developer machine", () => {
    expect(isServerless({ HOME: "/Users/someone", SHELL: "/bin/zsh" })).toBe(false);
  });

  it("is false for an empty environment rather than guessing", () => {
    expect(isServerless({})).toBe(false);
  });
});
