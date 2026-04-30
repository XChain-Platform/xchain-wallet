# Contributing to XChain Wallet

Thanks for considering a contribution. This wallet holds real keys for real users; we trade speed for safety on every commit.

If you're reporting a security issue, **stop here** and read `SECURITY.md` instead — security reports go through a private channel.

---

## Quick links

- Project README: `README.md` (architecture overview, shell matrix, scripts)
- Threat model: `docs/THREAT_MODEL.md` (assets, in-scope vs out-of-scope, attacker scenarios)
- Disclosure policy: `SECURITY.md` (private vulnerability reporting)
- Code of Conduct: `CODE_OF_CONDUCT.md`
- License: `LICENSE.md` + `NOTICE.md` (Dankest Community License)

---

## Repo layout in 30 seconds

```
xchain-wallet/                  pnpm monorepo (workspace root)
├── packages/
│   ├── core/                   shared React components, flows, signers, schemas
│   ├── web/                    Vite SPA shell
│   ├── extension/              Chrome MV3 shell (popup + full-screen + service worker)
│   ├── desktop/                Electron shell (main + renderer)
│   ├── bridge-spec/            window.xchain TS type definitions
│   └── test-dapp/              reference dApp exercising the bridge
├── test/                       cross-package test runners (smoke entry + e2e)
├── tools/build-reproduce/      reproducible-build helpers
├── docs/                       in-repo architecture / threat-model / dependency notes
├── CHANGELOG.md                authoritative — sub-packages do not maintain their own
├── SECURITY.md                 private vulnerability disclosure
└── package.json                workspace root; version = single source of truth
```

All packages ship at the **same version number**. See "Versioning" below.

---

## Setting up

### Prerequisites

- **Node.js** ≥ 18 (`engines.node` in `package.json`).
- **pnpm** 9.x (declared in `packageManager`). Install with `corepack enable && corepack prepare pnpm@9.0.0 --activate`.
- A sibling `xchain-sdk` checkout. The wallet's web + extension packages link `xchain-sdk` from `../../../xchain-sdk` (a symlink resolved at install time). Clone https://github.com/XChain-platform/xchain-sdk next to `xchain-wallet` before installing.

### First-time install

```bash
git clone https://github.com/XChain-platform/xchain-wallet.git
cd xchain-wallet
pnpm install
```

If you skip the sibling SDK checkout, install will warn but not fail; the extension and web shells will fall back to a dev-mock SDK at runtime, with a `console.warn` that signing and broadcast will not work. Mainnet-shaped flows require the real SDK.

---

## Running each shell

```bash
pnpm --filter @xchain-wallet/web dev          # web SPA at http://localhost:5173
pnpm --filter @xchain-wallet/extension build  # MV3 unpacked extension to packages/extension/dist/
pnpm --filter @xchain-wallet/desktop start    # build renderer + launch Electron locally
```

For the extension, load `packages/extension/dist/` via `chrome://extensions → Developer Mode → Load unpacked`.

For the desktop packaged build:

```bash
pnpm --filter @xchain-wallet/desktop dist           # signed installers
pnpm --filter @xchain-wallet/desktop dist:unpacked  # pre-signing Linux bundle (reproducible target)
pnpm --filter @xchain-wallet/desktop reproduce      # rebuild and verify against RELEASE_HASHES.txt
```

---

## Tests

The wallet runs a layered test suite. Pick the right tier for the change you're making:

| Tier | Command | When to run |
|---|---|---|
| Node-script smokes | `node test/smoke/_run-smokes.js` | Every commit. Fast, headless, asserts module shape + smoke-route renders |
| Vitest unit | `pnpm test:unit` | When you change pure functions, flows, or schemas |
| Vitest integration | `pnpm test:integration` | When you change a host-side handler or messaging shim |
| Vitest a11y | `pnpm test:a11y` | When you change a route, a primitive, or a CSS token |
| Playwright E2E | `pnpm test:e2e` | When you change onboarding, send, or any cross-screen flow |

**Smoke baseline (as of v0.194.0): 24 of 171 smokes fail.** All 24 are unrelated to current work and are tracked separately. New work must preserve this exact count — do not "fix" the baseline failures as part of a feature commit, and do not let a new failure slip through. If your change drifts the baseline, diff before vs. after to find the new entry, then either fix it or back out the change that introduced it.

```bash
node test/smoke/_run-smokes.js > /tmp/before.txt   # before your change
# ... edit ...
node test/smoke/_run-smokes.js > /tmp/after.txt    # after
grep -E "^FAIL " /tmp/before.txt /tmp/after.txt | sed 's/ ([0-9].*//' | sort  # diff
```

Smokes pin specific call shapes (e.g. `messaging.importMnemonic({ password, mnemonic, name })`). When the legitimate API evolves, update the smoke — do not undo the API change.

---

## Versioning

All packages in this repository — root, `packages/core`, `packages/extension`, `packages/web`, `packages/desktop`, `packages/bridge-spec`, `packages/test-dapp` — **ship at the same version number**. Sub-package `package.json` files track the root in lockstep. The `WALLET_VERSION` constant in `packages/core/src/buildInfo.js` is bumped alongside every release.

When you ship a change worth a version bump:

```bash
# bump every package.json + buildInfo.js together
for f in package.json packages/core/package.json packages/extension/package.json \
         packages/web/package.json packages/desktop/package.json \
         packages/bridge-spec/package.json packages/test-dapp/package.json; do
  sed -i 's/"version": "0\.OLD\.0"/"version": "0.NEW.0"/' "$f"
done
sed -i "s/WALLET_VERSION = '0\.OLD\.0'/WALLET_VERSION = '0.NEW.0'/" packages/core/src/buildInfo.js
```

Skip `test/e2e/package.json` — it does not participate in the release version.

`CHANGELOG.md` at the repo root is authoritative. Sub-packages do not maintain their own changelogs.

---

## Changelog

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Each release gets its own `## [x.y.z] - YYYY-MM-DD` section above the previous one. Keep entries terse — one short paragraph describing what changed and why, then a bullet list of touched files / surfaces. Avoid "behavior preserved" filler; if the entry is about preserving behavior, the version bump is wrong.

Pattern that works well in this repo:

```markdown
## [0.X.Y] - YYYY-MM-DD

§NN — Cluster Z Step N of M — <one-line title> (<gap-id>).

<one-paragraph rationale>.

### Added | Changed | Fixed | Removed

- **`path/to/file.js`** — terse one-line description.
- ...

Closes G<NNN>.
```

---

## Commit messages

Match the existing log style:

```
v0.X.Y — §NN Cluster Z — Step N of M — <short title>

<two-or-three-paragraph rationale>

Closes G<NNN>.
```

Branch off `master`, keep history linear (rebase, don't merge). One commit per release-worthy change is fine; don't batch unrelated work into a single commit.

**No `Co-Authored-By` trailers.** This is a project policy, enforced at review time.

**Never `--no-verify`.** If a hook fails, fix the cause; don't bypass.

---

## Coding style

- **JS + JSDoc** throughout. No TypeScript files; types live in `.d.ts` for the bridge-spec package only.
- **No ESLint configured globally.** Each package may run its own lint; the root `pnpm lint` runs whatever exists.
- **Comments are rare on purpose.** Don't comment what well-named code already says. Do comment a *why* that isn't obvious — a hidden invariant, a workaround for a bug with a ticket reference, a constraint that would surprise the next reader.
- **No emojis** in code or docs unless the user / spec asks for one.
- **Trailing two-spaces** on consecutive bold-label markdown lines (e.g. `**Status:** open  `) so CommonMark renders the line break instead of collapsing.
- **Logical CSS properties** (`margin-inline-start`, not `margin-left`) so RTL works without per-locale forks.

---

## Pull requests

CI is intentionally not configured against `master` during the active build phase — the smoke suite is the gate. Before opening a PR:

1. Run the smoke suite. Confirm 24 / 171 baseline preserved.
2. Bump versions + update `CHANGELOG.md`.
3. Make sure your `git status` is clean apart from intended changes (no `node_modules/`, no editor leftovers, no `.env`).
4. Open the PR with a clear title and a description that lists what changed and why. Reference the gap ID(s) it closes.

**A PR that breaks the smoke baseline will not be merged.** A PR that bumps the version without a CHANGELOG entry will not be merged.

---

## Reporting bugs

For non-security bugs, open an issue at:

<https://github.com/XChain-platform/xchain-wallet/issues/new>

Include: shell (extension / web / desktop), wallet version (visible in the About panel and machine-readable as `packages/core/src/buildInfo.js → WALLET_VERSION`), reproduction steps, expected vs. actual behavior, and a screenshot if the bug is visual.

For security bugs, see `SECURITY.md` — these go through a private channel.

---

## Asking questions

The fastest channel today is the Issues tab with the `question` label. We're a small team; please search existing issues first.

---

## Code of Conduct

We follow the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). Be kind, assume good faith, and disagree without being a jerk.

---

## Governance

The wallet is currently led by a single maintainer. See [`MAINTAINERS.md`](./MAINTAINERS.md) for the full picture, including:

- Lead maintainer and their areas of responsibility
- Who to escalate to for security / dependency / release / build issues
- How to add (or remove) a maintainer
- How decisions are made today (lazy consensus + lead-maintainer tiebreak) and how that's expected to evolve as the project grows
- Cross-project relationships with `xchain-platform`, `xchain-sdk`, and `xchain-documentation`

If you're proposing a change that's larger than a bug fix or a single-feature PR — anything that touches the architecture, the public bridge API, the build pipeline, the threat model, the legal text, or the protocol — please open an issue first to align on direction before opening the PR. The maintainers will weigh in within a few days.

For everything smaller (a bug fix, a new test, a docs tweak, a single self-contained feature) feel free to open a PR directly.

---

Last reviewed: 2026-04-29 at v0.310.0.
