/**
 * Which runtime this process is in.
 *
 * Kept out of `pdf.ts` so it can be tested without pulling in `server-only` and
 * a browser binary. The decision it drives — bundled Chromium or a Chrome on
 * the machine — has exactly one wrong answer per environment, and getting it
 * wrong in production failed silently: every report errored after the response
 * had already told the visitor it was on its way.
 */

/**
 * True on a hosted serverless runtime rather than a developer's machine.
 *
 * `VERCEL` is the one that matters. Vercel runs functions on Fluid Compute by
 * default, and `AWS_LAMBDA_FUNCTION_NAME` is NOT set there — testing only for
 * that is what sent production down the local-Chrome path. Classic Lambda stays
 * covered for anywhere else this runs.
 */
export function isServerless(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
}
