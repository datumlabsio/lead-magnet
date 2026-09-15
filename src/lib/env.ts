import "server-only";

/**
 * Server environment.
 *
 * Every value here is a credential or a credential-adjacent setting, so nothing
 * in this file may ever be read into a client component or prefixed
 * `NEXT_PUBLIC_`. Anything the bundler inlines ships to every browser.
 *
 * Reads are lazy and per-call rather than validated at module load: the Vercel
 * build step imports these modules without the runtime environment attached, and
 * a top-level throw would turn a missing variable into a failed build instead of
 * a clear error on the first request.
 */

class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = "MissingEnvError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new MissingEnvError(name);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  resendApiKey: () => required("RESEND_API_KEY"),
  /** Must be a verified sender on the Resend domain, e.g. `Team <hi@acme.com>`. */
  resendFrom: () => required("RESEND_FROM"),

  /** Optional: HubSpot sync is best-effort and the system runs without it. */
  hubspotToken: () => optional("HUBSPOT_PRIVATE_APP_TOKEN"),

  /** Optional: internal address notified on every new lead. */
  notifyEmail: () => optional("LEAD_NOTIFY_EMAIL"),

  /** Salt for hashing submitter IPs. Falls back to the service key if unset. */
  ipHashSalt: () => optional("LEAD_IP_HASH_SALT") ?? required("SUPABASE_SERVICE_ROLE_KEY"),
} as const;

/**
 * True when HubSpot is configured. The route uses this to skip the sync cleanly
 * rather than recording a failure for every lead on an install that never wired
 * HubSpot up.
 */
export function hubspotConfigured(): boolean {
  return env.hubspotToken() !== undefined;
}
