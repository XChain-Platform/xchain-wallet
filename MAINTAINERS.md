# Maintainers

This file lists the people responsible for XChain Wallet, what each
of them owns, and how to escalate issues that need a human's attention
beyond what `CONTRIBUTING.md` and `SECURITY.md` cover.

XChain Wallet is in pre-launch development — the project ships under
a single primary maintainer today. As contributors take on durable
responsibility for areas of the codebase, they will be added here.
This is a conventional MAINTAINERS file (open-source norm, used by
distros and downstream packagers), not an aspirational org chart.

---

## Primary maintainer

| Role | Name | GitHub | Areas |
|---|---|---|---|
| Lead | J-Dog | [@J-Dog](https://github.com/J-Dog) | Everything — core, three shells (extension / web / desktop), bridge, signers, releases |

Contact:

- General + non-sensitive: open an issue at <https://github.com/XChain-platform/xchain-wallet/issues>.
- Code conduct: `conduct@dankest.llc` (per `CODE_OF_CONDUCT.md`).
- Security disclosures: GitHub Private Vulnerability Reporting, or
  `security@dankest.llc` (per `SECURITY.md`).

---

## Areas of responsibility

Until additional maintainers join, the lead owns every area below. The
table is here so a future contributor (or downstream packager) can see
what each area entails when scoping a contribution.

| Area | What it covers |
|---|---|
| Core flows | `packages/core/src/flows/` — encode + sign pipelines, vault read/write, settings, multisig, contracts, dispensers, orders, swaps, links, messaging |
| Schemas | `packages/core/src/schemas/` — Wallet / Address / Account / Settings / ConnectedSite record shapes + validators |
| Signers | `packages/core/src/signers/` — software signer, Trezor, Ledger; firmware-manifest advisory data |
| Bridge | `packages/extension/src/bridge/` + `packages/bridge-spec/` — `window.xchain` provider surface, approvals broker, error codes, throttle, blocklist |
| Extension shell | `packages/extension/src/{popup,background}/` — Manifest V3 service worker, popup React app, content script |
| Web shell | `packages/web/src/` — SPA entry, routing, messaging adapter |
| Desktop shell | `packages/desktop/{main,renderer,scripts,Dockerfile,electron-builder.config.cjs}/` — Electron main + renderer, reproducible-build pipeline, packaging, auto-updater |
| Documentation | `docs/`, root markdown files (`README`, `SECURITY`, `CODE_OF_CONDUCT`, `CONTRIBUTING`, `MAINTAINERS`), `claude/reports/specs/` |
| Release engineering | Tag cuts, `RELEASE_HASHES.txt` publication, GPG signing (pending G158 / G180), reproducible-build verification |
| Smokes + tests | `test/smoke/`, `test/integration/`, `test/e2e/` |

---

## Adding a maintainer

A contributor becomes a maintainer when they have:

1. Sustained contribution in a specific area for at least one minor
   version cycle (typically 2–3 weeks of active work).
2. Reviewed and merged at least three PRs from outside contributors.
3. Demonstrated awareness of the project's conventions — synchronized
   versioning across packages, smoke baseline preservation,
   `claude/reports/xchain-wallet/SPEC_GAPS.md` as the canonical gap
   ledger, no-CI-during-build-phase, the `Keep a Changelog` format.
4. Agreed in writing to the project's release-signing trust model
   (publishing GPG-signed artifacts under their own key, or operating
   under the lead's release key during onboarding).

Open a PR adding the new maintainer to the table above with their
GitHub handle and area(s) of responsibility. The lead approves and
merges.

## Removing a maintainer

A maintainer steps down by opening a PR removing their row. The lead
also removes a maintainer who has been inactive for six months or who
violates the Code of Conduct, after a written notice period.

---

## Escalation paths

If you cannot reach the relevant area maintainer within a reasonable
window:

| Situation | Escalate to |
|---|---|
| Active security incident | `security@dankest.llc` (per `SECURITY.md`) |
| Suspected compromise of the release key | Open a public issue marked `[KEY-COMPROMISE]` AND email `security@dankest.llc` — public visibility is the point |
| Code-of-conduct concern | `conduct@dankest.llc` (per `CODE_OF_CONDUCT.md`) |
| PR has been open without review for 14+ days | Comment `@J-Dog` on the PR; if no response within 7 more days, open an issue tagged `governance` with the PR link |

---

## Decision-making

The lead makes final calls on:

- Architectural direction (package boundaries, shell split, signer
  abstraction).
- Release timing and version policy.
- Adopting a new language / framework / heavy dependency.
- Code-of-conduct enforcement.
- Maintainer additions / removals.

Smaller calls — bug fixes, feature additions in an existing area,
documentation, dependency bumps inside an existing minor — go through
PR review by the area maintainer.

---

## Cross-project relationships

| Project | Relationship |
|---|---|
| [`xchain-sdk`](https://github.com/XChain-platform/xchain-sdk) | Wallet depends on SDK for encoder, action shapes, broadcast. Versioned independently — wallet's `package.json` pins a specific SDK semver |
| [`xchain-platform`](https://github.com/XChain-platform/xchain-platform) | Hosts the regtest stack the wallet uses for integration testing (`docker compose up` in that repo provides nodes, indexers, mempool miner) |
| [`xchain-documentation`](https://github.com/XChain-platform/xchain-documentation) | Protocol spec — ACTION definitions, database naming, Token Information Standard. Wallet UI and bridge type definitions cite specific sections |

The wallet maintainer is not automatically a maintainer of those
sibling projects. Cross-project changes go through each project's own
review process.
