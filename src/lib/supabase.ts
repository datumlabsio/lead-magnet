import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let cached: SupabaseClient | undefined;

/**
 * The service-role client. It bypasses row level security, so it must never be
 * constructed anywhere that could run in a browser — hence `server-only` above.
 *
 * Cached because each `createClient` call builds its own fetch stack, and a
 * serverless function can handle many requests in one instance.
 */
export function supabase(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
