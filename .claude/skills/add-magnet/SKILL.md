---
name: add-magnet
description: Wire up a new lead magnet from a handed-over HTML landing page. Use when someone provides a landing page, form, or design for a new lead magnet, asks to add/launch/publish a magnet, or says they have a new PDF/guide/checklist to give away in exchange for an email.
---

# Adding a lead magnet

Someone has handed over a landing page. Your job is to make its form capture
leads, deliver the asset, and sync to HubSpot — **without redesigning their
page**.

## The one rule

**Do not rewrite their HTML.** Their page is the deliverable of somebody else's
work. You add a script tag and, if needed, `name` attributes. That is all. If
the page looks wrong to you, say so — do not fix it unprompted.

## What you need before starting

Ask for anything missing. Do not guess:

1. **The landing page** — an `index.html`, ideally with its `css/`, `images/`, `js/` folders.
2. **The asset** — the PDF/file the lead receives.
3. **A slug** — lowercase, hyphens, e.g. `seo-audit-checklist`. Derive one from the page title and confirm it.
4. **The email copy** — subject line and the body of the delivery email. If they have no preference, draft it and show them.

## Steps

### 1. Drop the page in, untouched

```
public/m/<slug>/index.html      ← plus their css/, images/, fonts/ alongside it
```

Keep their folder structure exactly as given. Relative paths like
`images/hero.png` resolve correctly from here, which is the whole reason the
page lives in `public/` rather than being converted to a React component.

The page is then served at `/m/<slug>` by the rewrite in `next.config.ts`.
Nothing needs registering for the URL to work.

### 2. Make the form satisfy the contract

Open their HTML and check three things. Change as little as possible.

- The email input **must** be `name="email"`. If theirs is `name="user_email"` or has no `name`, change that one attribute.
- Every other input you want to capture needs a `name`, and that name must match a `fields[].name` in the config you write next. Inputs you do not declare are silently dropped — that is intended, not a bug.
- Add this as the last thing before `</body>`:

```html
<script src="/lm.js" data-magnet="<slug>" defer></script>
```

If their page already posts somewhere (Mailchimp, a `formspree` action, an
inline handler), remove the `action`/`onsubmit` — `lm.js` takes over the submit.

Optional hooks, only if they help:

| Attribute | On | Effect |
|---|---|---|
| `data-lm-fields` | wrapper around the inputs | Hidden on success, so the message replaces the form |
| `data-lm-message` | any element | Status text goes here, styled by them not by `lm.js` |
| `data-lm-sending="…"` | the `<form>` | Button label while submitting |
| `data-lm-ignore` | a `<form>` | Leave this form alone entirely (search boxes, newsletter footers) |

`public/m/sample-guide/index.html` is a working reference.

### 3. Upload the asset to Supabase

Storage → `magnets` bucket (private) → upload to `<slug>/<filename>`.

The bucket must stay **private**. The emailed link is a time-limited signature;
a public bucket makes that signature meaningless.

### 4. Write the config

Create `src/magnets/<slug>.ts`. Copy `sample-guide.ts` and edit. Types and
per-field documentation are in `src/magnets/types.ts`.

**Ship it as `published: false`.** Preview it, submit a real test, then flip.

### 5. Register it

Add the import and the array entry in `src/magnets/registry.ts`. Two lines. The
import is deliberately explicit so a broken magnet fails the build instead of
404ing in production.

### 6. Check the HubSpot mapping

Every field with a `hubspotProperty` must name a property that **actually exists
in HubSpot**. A typo here fails the sync for every lead on this magnet. Standard
properties: `firstname`, `lastname`, `company`, `phone`, `jobtitle`, `website`.
Anything else is a custom property somebody has to create in HubSpot first —
flag it rather than assuming it exists.

`lead_magnet_source` is a custom property. If it does not exist yet, tell them to
create it (single-line text) or drop `hubspot.source` from the config.

### 7. Verify before publishing

```bash
pnpm run doctor                                                  # integrations
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
```

`pnpm run doctor` is the fast one to run first. It confirms the asset is actually
in the bucket at the path your config names, that the landing page satisfies the
form contract, and that Resend and HubSpot are configured — the four things that
account for most broken magnets. It prints no credentials.

Then run `pnpm run dev` and check, on the real page:

- `/m/<slug>` renders with its styling and images intact
- submitting with a bad email shows an inline error
- a real submission returns a success message or redirect
- the row appears in Supabase `leads`
- the email arrives and its download link works
- the contact appears in HubSpot

Only then set `published: true`.

## What not to do

- **Do not** convert their HTML into a React component. `dangerouslySetInnerHTML` is a lint error here anyway, and their inline `<script>` tags would stop running.
- **Do not** put the asset in `public/`. That makes it downloadable without an email, which is the entire thing we are selling.
- **Do not** add any secret to `NEXT_PUBLIC_*`. See the guardrails in `CLAUDE.md`.
- **Do not** commit the PDF to the repo. It belongs in Supabase Storage.
- **Do not** weaken a lint rule or a gate to make something pass.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Form reloads the page instead of submitting | `lm.js` tag missing, or the slug does not match |
| `This form is not available.` | `published: false`, or the slug is not in `registry.ts` |
| Lead lands but no email | Resend `from` domain not verified, or the asset path does not exist in the bucket |
| Email arrives, link 404s | `asset.path` does not match the object's path in the bucket |
| Leads land, HubSpot empty | Token missing or a `hubspotProperty` does not exist — check `hubspot_error` on the lead row |
| Everything silently "succeeds" but no lead | Honeypot or the <1.5s timing check fired; both return a fake success on purpose |
