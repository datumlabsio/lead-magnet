/**
 * Setup doctor.
 *
 *   pnpm run doctor
 *
 * Checks every external service this system depends on and says exactly what is
 * wrong and where to fix it. Run it after filling in .env.local, and again after
 * changing anything in Supabase, Resend or HubSpot.
 *
 * It never prints a credential. Values are reported only as present/absent, or
 * as something derived that is safe to show — the domain part of a from address,
 * the name of a bucket. If you paste this output into a chat or a ticket, you
 * are not pasting a secret.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// console.log is a lint warning in this repo. A CLI writing to stdout is the
// legitimate case, so it writes to the stream directly rather than suppressing
// the rule.
const out = (line = "") => process.stdout.write(`${line}\n`);

// Escape sequence rather than a literal control character, so the source
// stays clean text that greps and diffs sanely.
const ESC = "\u001b[";
const PASS = `${ESC}32m✓${ESC}0m`;
const FAIL = `${ESC}31m✗${ESC}0m`;
const WARN = `${ESC}33m!${ESC}0m`;
const DIM = (s) => `${ESC}2m${s}${ESC}0m`;
const BOLD = (s) => `${ESC}1m${s}${ESC}0m`;

let failures = 0;
let warnings = 0;

function pass(label, detail) {
  out(`  ${PASS} ${label}${detail ? ` ${DIM(detail)}` : ""}`);
}
function fail(label, fix) {
  failures += 1;
  out(`  ${FAIL} ${label}`);
  if (fix) out(`      ${DIM(`-> ${fix}`)}`);
}
function warn(label, fix) {
  warnings += 1;
  out(`  ${WARN} ${label}`);
  if (fix) out(`      ${DIM(`-> ${fix}`)}`);
}
function section(title) {
  out();
  out(BOLD(title));
}

const env = (name) => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
};

// ---------------------------------------------------------------- environment

section("Environment");

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_FROM"];
const OPTIONAL = ["HUBSPOT_PRIVATE_APP_TOKEN", "LEAD_NOTIFY_EMAIL", "LEAD_IP_HASH_SALT"];

for (const name of REQUIRED) {
  if (env(name)) pass(name, "set");
  else fail(`${name} is missing`, "Add it to .env.local - see .env.example");
}
for (const name of OPTIONAL) {
  if (env(name)) pass(name, "set");
  else out(`  ${DIM(`. ${name} not set (optional)`)}`);
}

for (const name of [...REQUIRED, ...OPTIONAL]) {
  if (process.env[`NEXT_PUBLIC_${name}`]) {
    fail(
      `NEXT_PUBLIC_${name} is set`,
      "Anything NEXT_PUBLIC_* is inlined into the browser bundle and readable with view-source. Remove it.",
    );
  }
}

// ------------------------------------------------------------------- supabase

section("Supabase");

/**
 * Works out which key is configured, without printing it.
 *
 * This check exists because the failure it catches is close to invisible. RLS is
 * on with no policies, so an anon key querying `leads` returns zero rows and no
 * error - the table looks reachable and healthy. Every real insert would then be
 * rejected in production, losing every lead, while this doctor reported green.
 *
 * Supabase has two key generations: legacy JWTs carrying a `role` claim, and
 * newer `sb_secret_` / `sb_publishable_` prefixed keys.
 */
function supabaseKeyRole(key) {
  if (key.startsWith("sb_secret_")) return "service_role";
  if (key.startsWith("sb_publishable_")) return "anon";
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.role ?? "unknown";
  } catch {
    return "unknown";
  }
}

const supabaseKey = env("SUPABASE_SERVICE_ROLE_KEY");
if (supabaseKey) {
  const role = supabaseKeyRole(supabaseKey);
  if (role === "service_role") {
    pass("key is a service role / secret key");
  } else if (role === "anon") {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY holds the ANON / PUBLISHABLE key",
      "Use the secret key instead: Project Settings -> API Keys -> Secret keys (sb_secret_..., formerly service_role). The anon key cannot write leads or sign downloads, and RLS makes it fail silently rather than loudly.",
    );
  } else {
    warn(
      `could not identify the Supabase key type (${role})`,
      "Confirm it is the secret / service_role key, not the publishable one",
    );
  }
}

if (env("SUPABASE_URL") && supabaseKey) {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: tableError, count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true });

  if (tableError) {
    fail(
      `leads table unreachable: ${tableError.message}`,
      "Run supabase/schema.sql in the Supabase SQL editor",
    );
  } else {
    pass("leads table reachable", `${count ?? 0} row(s)`);
  }

  const { data: bucket, error: bucketError } = await supabase.storage.getBucket("magnets");
  if (bucketError || !bucket) {
    fail(
      `magnets bucket missing: ${bucketError?.message ?? "not found"}`,
      "Run supabase/schema.sql, or create a private bucket named 'magnets'",
    );
  } else if (bucket.public) {
    fail(
      "magnets bucket is PUBLIC",
      "Make it private. A public bucket makes the signed link meaningless - anyone can take the asset without giving an email.",
    );
  } else {
    pass("magnets bucket exists and is private");

    const { data: top } = await supabase.storage.from("magnets").list("", { limit: 100 });
    const objects = [];
    for (const entry of top ?? []) {
      if (entry.id === null) {
        const { data: inner } = await supabase.storage
          .from("magnets")
          .list(entry.name, { limit: 100 });
        for (const file of inner ?? []) objects.push(`${entry.name}/${file.name}`);
      } else {
        objects.push(entry.name);
      }
    }
    if (objects.length === 0) {
      warn(
        "bucket is empty",
        "Upload each magnet's asset to <slug>/<filename>, matching asset.path in its config",
      );
    } else {
      pass(`${objects.length} asset(s) in bucket`);
      for (const path of objects) out(`      ${DIM(path)}`);
      out(`      ${DIM("compare these against asset.path in each src/magnets/*.ts")}`);
    }
  }
} else {
  fail("skipped - Supabase env vars missing");
}

// --------------------------------------------------------------------- resend

section("Resend");

if (env("RESEND_API_KEY")) {
  const response = await fetch("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${env("RESEND_API_KEY")}` },
  });

  if (response.status === 401) {
    fail("API key rejected", "Check RESEND_API_KEY in the Resend dashboard");
  } else if (!response.ok) {
    fail(`Resend returned ${response.status}`);
  } else {
    pass("API key accepted");

    const payload = await response.json();
    const domains = Array.isArray(payload) ? payload : (payload.data ?? []);
    const from = env("RESEND_FROM") ?? "";
    const fromDomain = from.includes("@")
      ? from
          .split("@")
          .pop()
          .replace(/[>\s"]/g, "")
      : null;

    if (!fromDomain) {
      fail(
        `RESEND_FROM has no email address: ${from}`,
        "Use the form: Name <hello@yourdomain.com>",
      );
    } else {
      const match = domains.find((d) => d.name === fromDomain);
      if (!match) {
        fail(
          `${fromDomain} is not added to Resend`,
          "Add and verify the domain, or every delivery email lands in spam",
        );
      } else if (match.status !== "verified") {
        fail(
          `${fromDomain} is "${match.status}", not verified`,
          "Finish the DNS records in Resend. Unverified domains go to spam.",
        );
      } else {
        pass(`${fromDomain} verified`);
      }
    }
  }
} else {
  fail("skipped - RESEND_API_KEY missing");
}

// -------------------------------------------------------------------- hubspot

section("HubSpot");

// The three scopes this system uses: write to upsert the contact, and the two
// read scopes so this doctor can verify the token and the custom property.
const SCOPES = "crm.objects.contacts.write, crm.objects.contacts.read, crm.schemas.contacts.read";

if (env("HUBSPOT_PRIVATE_APP_TOKEN")) {
  const auth = { authorization: `Bearer ${env("HUBSPOT_PRIVATE_APP_TOKEN")}` };

  const probe = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
    headers: auth,
  });

  if (probe.status === 401) {
    fail(
      "token rejected",
      "Must be a PRIVATE APP token. A personal access key is for the hs CLI and will not work here, and legacy hapikey API keys were sunset in 2022.",
    );
  } else if (probe.status === 403) {
    fail("token lacks the contacts read scope", `Grant ${SCOPES} to the private app`);
  } else if (!probe.ok) {
    fail(`HubSpot returned ${probe.status}`);
  } else {
    pass("token accepted with contact access");

    const property = await fetch(
      "https://api.hubapi.com/crm/v3/properties/contacts/lead_magnet_source",
      { headers: auth },
    );
    // 403 and 404 mean different things and have different fixes. Collapsing
    // them sends you to HubSpot to create a property that is already there.
    if (property.ok) {
      pass("lead_magnet_source property exists");
    } else if (property.status === 403) {
      warn(
        "cannot check lead_magnet_source - token lacks crm.schemas.contacts.read",
        "Grant that scope to verify the property, or check it by hand in HubSpot. Syncing still works without it.",
      );
    } else {
      warn(
        "lead_magnet_source property does not exist",
        "Create it in HubSpot (contact property, single-line text) or drop hubspot.source from the magnet configs - otherwise every sync fails",
      );
    }
  }
} else {
  out(`  ${DIM(". skipped - HUBSPOT_PRIVATE_APP_TOKEN not set. Leads still save and send.")}`);
}

// -------------------------------------------------------------- landing pages

section("Landing pages");

const magnetDir = join(process.cwd(), "public", "m");
if (!existsSync(magnetDir)) {
  warn("public/m does not exist yet", "Nothing to check until a landing page is added");
} else {
  const slugs = readdirSync(magnetDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (slugs.length === 0) warn("no landing pages found in public/m");

  for (const slug of slugs) {
    const indexPath = join(magnetDir, slug, "index.html");
    if (!existsSync(indexPath)) {
      fail(`${slug}: no index.html`, `Expected public/m/${slug}/index.html`);
      continue;
    }

    const html = readFileSync(indexPath, "utf8");
    const problems = [];
    if (!html.includes("/lm.js")) problems.push("missing the lm.js script tag");
    if (!html.includes(`data-magnet="${slug}"`)) {
      problems.push(`no data-magnet="${slug}" (slug must match the folder name)`);
    }
    if (!/name=["']email["']/.test(html)) problems.push('no input with name="email"');
    if (/<form[^>]+action=/i.test(html)) {
      problems.push("a form still has an action= that will bypass lm.js");
    }

    if (problems.length === 0) pass(`${slug}`, "form contract satisfied");
    else fail(`${slug}: ${problems.join("; ")}`, "See .claude/skills/add-magnet/SKILL.md step 2");
  }
}

// --------------------------------------------------------------------- result

out();
if (failures > 0) {
  out(
    `${ESC}31m${failures} problem(s) to fix${ESC}0m${warnings ? `, ${warnings} warning(s)` : ""}`,
  );
  process.exit(1);
}
if (warnings > 0) {
  out(`${ESC}33mReady, with ${warnings} warning(s)${ESC}0m`);
} else {
  out(`${ESC}32mEverything checks out.${ESC}0m`);
}
