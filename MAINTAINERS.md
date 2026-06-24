# Maintainers

This file lists who maintains XChain Wallet, what each person owns, how to
escalate, and how someone becomes (or stops being) a maintainer. It is meant
to be scrapable: keep the headings and the areas table stable so downstream
packagers and the OWNERS-file ecosystem can read it.

Companion documents: [`CONTRIBUTING.md`](./CONTRIBUTING.md) (how to contribute),
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) (community standards), and
[`SECURITY.md`](./SECURITY.md) (how to report a vulnerability).

## Primary maintainer

The project is pre-launch and currently has a **single primary maintainer**.
This is the honest state today, not an aspirational committee; the structure
below describes how authority is partitioned and how it is expected to grow.

| Maintainer | GitHub | Role |
| --- | --- | --- |
| J-Dog | <https://github.com/J-Dog> | Lead maintainer, final decision-maker |

## Areas of responsibility

Every area is currently owned by the lead maintainer. The partition exists so
a future contributor knows which part of the tree a change belongs to and who
to expect review from as the team grows.

| Area | Owner | Scope |
| --- | --- | --- |
| Core flows | J-Dog | `packages/core/src/flows`, state, messaging |
| Schemas | J-Dog | `packages/core/src/schemas`, migrations, versioned data |
| Signers | J-Dog | `packages/core/src/signers`, `packages/signers-trezor`, `packages/signers-ledger` |
| Bridge | J-Dog | `window.xchain` provider + `packages/bridge-spec` |
| Extension shell | J-Dog | `packages/extension` (MV3 popup, full-screen, service worker) |
| Web shell | J-Dog | `packages/web` (Vite SPA) |
| Desktop shell | J-Dog | `packages/desktop` (Electron main, preload, renderer) |
| Documentation | J-Dog | in-repo `docs/`, user docs in `xchain-documentation` |
| Release engineering | J-Dog | reproducible builds, `tools/build-reproduce`, release gates |
| Smokes + tests | J-Dog | `test/smoke`, `test/vitest`, `test/e2e` |

## Adding a maintainer

1. An existing maintainer nominates a candidate, or a sustained contributor
   asks to be considered.
2. The candidate should have a track record of merged, reviewed contributions
   and demonstrated good judgment in at least one area above.
3. The lead maintainer confirms, then adds the person to the tables in this
   file (and to the relevant GitHub team) in a PR. The PR being merged is the
   record of the decision.

## Removing a maintainer

A maintainer is removed when they step down, become unreachable for an extended
period, or act in serious violation of the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
Removal is recorded the same way it is granted: a PR that edits this file. While
there is a single primary maintainer, removal is not applicable to that role
without a successor first being added.

## Escalation paths

Reach the right person quickly by topic. While there is one maintainer, every
path resolves to the same person, but the channels are stable so they survive
the team growing.

| Topic | Channel |
| --- | --- |
| Security vulnerability | **security@dankest.llc** (see [`SECURITY.md`](./SECURITY.md); do not open a public issue) |
| Code of conduct | **conduct@dankest.llc** (see [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)) |
| Dependency / supply-chain concern | **security@dankest.llc** |
| Release / build integrity | open an issue tagged `release`, or **security@dankest.llc** if sensitive |

## Decision-making

Day-to-day changes use **lazy consensus**: a reviewed PR that nobody objects to
is approved. Disagreements are resolved by discussion; if discussion stalls, the
**lead maintainer has the tiebreak**. Larger changes (architecture, the public
bridge API, the build pipeline, the threat model, the legal text, or the
protocol) start with an issue to align on direction before a PR, as described in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). As more maintainers join, the tiebreak is
expected to move from a single lead to a maintainer majority.

## Cross-project relationships

XChain Wallet is one repository in a larger platform. A maintainer's authority
here does not extend to these sibling projects; coordinate with their owners for
changes that cross a boundary.

- **`xchain-sdk`**: the single source of truth for data and signing. The wallet
  never duplicates SDK functionality; SDK behavior changes are decided in that
  repo and the wallet adapts.
- **`xchain-platform`**: the protocol and the backend services (encoder,
  decoder, indexer, explorer, hub). Wire-format and ACTION semantics are owned
  there; the wallet conforms to them.
- **`xchain-documentation`**: the protocol spec and the user-facing docs. Wallet
  user docs and the `window.xchain` bridge reference live there and must stay in
  sync with this repo.

---

Last reviewed: 2026-06-24.
