# Running the lead magnets

Two audiences. Part 1 is done once, by someone technical. Part 2 is what a
non-technical person needs every time a new magnet is launched.

---

## Part 1 — One-time setup

### Supabase

1. Create a project. Free tier is fine. **Note the caveat below.**
2. SQL Editor → paste `supabase/schema.sql` → Run. It creates the `leads` table,
   its indexes, and the private `magnets` storage bucket. Safe to re-run.
3. Project Settings → API → copy the URL and the **service role** key.

> **Free-tier caveat.** Supabase pauses a project after about a week with no
> activity, and it takes a manual click to resume. A magnet that sits quiet
> between campaigns can therefore go dark without warning. If these pages must
> be reliably live, either keep the project warm or move to a paid plan.

### Resend

1. Add and verify your sending domain. Skip this and every delivery email goes
   to spam — verification is not optional in practice.
2. Create an API key.

### HubSpot (optional)

1. Settings → Integrations → Private Apps → **Create a private app**.
2. On the Scopes tab, grant all three:
   - `crm.objects.contacts.write` — required, creates and updates the contact
   - `crm.objects.contacts.read` — lets `pnpm run doctor` verify the token
   - `crm.schemas.contacts.read` — lets the doctor check the custom property
3. Create, then copy the access token into `HUBSPOT_PRIVATE_APP_TOKEN`.
4. If you want to segment by which magnet a contact came from, create a custom
   contact property `lead_magnet_source` (single-line text).

It has to be a **private app token**. A HubSpot *personal access key* is for the
`hs` CLI and will not authenticate these calls, and legacy `hapikey` API keys
were sunset in 2022.

Leave HubSpot unconfigured and everything else still works — leads land in
Supabase and still get their email.

### Vercel

Project Settings → Environment Variables. Use `.env.example` as the list.

**None of these may ever be renamed with a `NEXT_PUBLIC_` prefix.** That prefix
inlines a value into the browser bundle, where anyone can read it with
view-source. These are all full-access credentials.

### Check it all works

Fill in `.env.local` locally, then:

```bash
pnpm run doctor
```

It checks every service and tells you exactly what is wrong and where to fix it:
whether the `leads` table exists, whether the `magnets` bucket is private, which
assets are in it, whether your Resend sending domain is actually verified,
whether the HubSpot token has the right scope and the `lead_magnet_source`
property exists, and whether each landing page satisfies the form contract.

It never prints a credential — only present/absent, or safe derived detail like
a domain name. The output is safe to paste into a ticket or a chat.

Run it again after changing anything in Supabase, Resend or HubSpot.

---

## Part 2 — Launching a new magnet

### What to hand over

Put these four things in one place — a folder, a Drive link, a message:

1. **The landing page** — the HTML file, plus its images/CSS folders if it has them.
2. **The file you are giving away** — the PDF, guide, checklist, template.
3. **A short name** — e.g. "SEO Audit Checklist". The web address gets derived from it.
4. **The email people receive** — subject line, and what the email should say.

If you do not have the email copy, say so and ask for a draft.

### Then say this to the coding agent

> I have a new lead magnet to add. Use the add-magnet skill.
>
> - Landing page: `<where the HTML is>`
> - Asset: `<where the PDF is>`
> - Name: `<e.g. SEO Audit Checklist>`
> - Email subject: `<subject line>`
> - Email body: `<what it should say>`
>
> Set it up as unpublished first and tell me the preview URL to check.

The agent does the rest. It will come back with a preview link.

### Before it goes live

Run `pnpm run doctor` first — it catches the mechanical mistakes (wrong asset
path, missing script tag, unverified domain) before you spend attention on them.

Then open the preview and check the things only a human can:

- The page looks the way the designer intended.
- Fill the form in with **your own real email address**.
- The email arrives, and the download link in it works.
- Ask whoever owns HubSpot to confirm your test contact appeared.

Then tell the agent to publish it. This is the last point at which a broken
magnet costs nothing.

### After it is live

Leads are in the Supabase `leads` table — Table Editor, filter by `magnet_slug`.
Every lead is written there **before** the email and before HubSpot, so a lead
that reached the system is recorded even if the email or the CRM later failed.

Useful columns when something looks wrong:

| Column | Means |
|---|---|
| `email_sent_at` | Empty → the delivery email never went out |
| `hubspot_contact_id` | Filled → synced to the CRM |
| `hubspot_error` | Filled → why the CRM sync failed |
| `utm` | Which campaign the lead came from |

---

## How it works

```
  /m/<slug>                  public/m/<slug>/index.html, exactly as handed over
      │                      + one <script src="/lm.js"> tag
      ▼
  POST /api/lead             honeypot + timing + rate-limit checks
      │
      ├─ 1. Supabase `leads` ──── durable first, so a lead is never lost
      ├─ 2. Signed URL + Resend ─ the promise made to the person
      └─ 3. HubSpot upsert ────── best-effort; failure recorded, not fatal
```

The ordering is the design. Steps 2 and 3 can fail and be replayed from the row
written in step 1. Nothing can be replayed from a lead that was never written
down.

Bot submissions and rate-limited ones get a response identical to success. A
precise rejection message is free tuning advice for whoever is probing the form.

### Where things live

| Path | What |
|---|---|
| `public/m/<slug>/` | The landing page bundle, verbatim |
| `public/lm.js` | The form bridge dropped into every page |
| `src/magnets/<slug>.ts` | One magnet's config |
| `src/magnets/registry.ts` | The list of all magnets |
| `src/app/api/lead/route.ts` | The submission pipeline |
| `supabase/schema.sql` | Database and bucket setup |
| `.claude/skills/add-magnet/` | Instructions the coding agent follows |
| `scripts/doctor.mjs` | `pnpm run doctor` — checks every integration |
