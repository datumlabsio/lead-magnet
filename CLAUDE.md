# lead-magnet — A plug-and-play lead magnet delivery system designed to capture emails

## Context

Archetype `web-app` (DES §8). Born from `datumlabsio/scaffolds`;
`.copier-answers.yml` records which version, and the org conformance workflow
reads it.

CI is a thin caller to `datumlabsio/actions`, pinned to `v1.6.0`.
Org defaults — pull request template, issue forms, security policy — come from
`datumlabsio/.github` and are not files in this repo.


A browser-delivered front end (DES §8), built with **Next**.

It server-renders, so the container runs a Node process. `next.config.ts` sets
`output: "standalone"` — the image carries the server and only the dependencies
it needs, not the whole `node_modules`.

Deploy is pull-based: CI publishes the image and the install's GitOps picks up
the tag (DES §4). CI here stops at the artifact — `scan` and `publish` arrive
once the container registry is chosen.


## Commands

```bash
copier update --trust    # take improvements, or change an answer
```

It re-asks with your current answers filled in, so changing one is a keystroke on
that question and enter through the rest.

```bash
```

```bash
pnpm install --frozen-lockfile
pnpm run lint         # biome: lint and format in one pass
pnpm run typecheck    # tsc --noEmit
pnpm run test         # vitest
pnpm run test:coverage
pnpm run build
pnpm run dev
```

Exactly what CI runs, from the versions pinned in `web-tool-versions.txt`. Use
`pnpm run format` to fix formatting rather than arguing with the linter.

Coverage is **reported on every run and enforced once this repo serves
production** (DES §11). This repo is `draft`, so it is currently
reported but not gated — the number is still visible in every run.

## Conventions

- **Vocabulary is load-bearing** (RFC-0008). `install` = one client deployment.
  `application` = an installed tool with a my-apps tile. The two structural
  words are **protocol** and **implements**. `service`, `role` and `binding` are
  retired as categories.
- **Never write bespoke CI.** A gate is fixed in `datumlabsio/actions` and the
  pin here is bumped. If a check is wrong, it is wrong for everyone.
- **The template owns some files.** `.copier-answers.yml`, the CI caller,
  `renovate.json` and any vendored config are bumped by `copier update`, never
  hand-edited — an edit is lost on the next update and breaks the fleet-upgrade
  path.
- **Renovate opens the bumps.** It inherits every rule from
  `datumlabsio/.github`, so this repo configures nothing. A bump to
  `datumlabsio/actions` arrives as its own pull request; tool pins arrive grouped
  on a Monday. Merging those is how this repo stays current.
- Conventional Commits. Branches `feat/…` `fix/…` `chore/…`, short-lived.

## Guardrails

- **NEVER commit a secret**, or a plaintext value that resolves to one. Only
  references to the secret manager. Push protection has no exceptions (DES §6).
- **NEVER push directly to `main`.** Branch, pull request, review.
- **NEVER hand-edit a file the template owns.** Bump instead.
- **NEVER weaken a linter or a gate to make a check pass.** That is a spec
  change, and it goes through the RFC process.
- **NEVER let CI hold production credentials.** CI publishes an artifact; the
  install pulls it (DES §4).
- **NEVER put a secret in client-side code or in `NEXT_PUBLIC_*`/`VITE_*`.**
  Anything the bundler inlines ships to every browser and is readable with view
  source. A browser cannot keep a secret; the API it calls holds the credential.
- **NEVER add a package to `onlyBuiltDependencies` to make an install work.**
  That list is what stops a dependency running arbitrary code on install (DES
  §6). If something new needs it, say why in the pull request.
- **NEVER raise a single `@vitest/*` pin by hand.** They move together, and a
  mismatched one resolves to a version pnpm's release-age policy then rejects.
  Let Renovate bump the set.
- **NEVER disable `strict` in TypeScript, or add `any` to silence an error.**
  Both are the gate doing its job.

## Docs

- What the archetype's CI does: `datumlabsio/actions/docs/`
- The rules all of this enforces: [datumlabsio/datum-standards](https://github.com/datumlabsio/datum-standards)
