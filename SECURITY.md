# Security Policy

XChain Wallet is a self-custodial multi-chain wallet. Vulnerabilities can put real user funds at risk, so we treat reports seriously and respond fast.

If you've found a security issue, please **do not open a public issue or pull request**. Use the private channels below.

---

## How to report

### Preferred: GitHub Private Vulnerability Reporting

Open a draft advisory at:

<https://github.com/XChain-platform/xchain-wallet/security/advisories/new>

This is the fastest path. The advisory is private until we publish it.

### Alternative: Email

Email **security@dankest.llc** with:

- A description of the issue and the threat it poses.
- Reproduction steps or a proof-of-concept.
- The affected version (`packages/core/src/buildInfo.js → WALLET_VERSION`) and the shell you tested against (extension / web / desktop).
- Any patches or mitigations you'd like considered.

For sensitive reports, please encrypt the email body to our PGP key. The fingerprint will be published alongside the first GPG-signed release artifact (tracked as G180 in `claude/reports/xchain-wallet/SPEC_GAPS.md`); until then, the email channel is acceptable for first contact and we will coordinate an encrypted exchange before you share PoC details.

We do not currently offer a paid bug bounty. We do offer public credit in release notes and the advisory itself, unless you prefer to remain anonymous.

---

## Response timeline

| Stage | Target |
|---|---|
| Initial acknowledgement | within 72 hours |
| Triage + severity assignment | within 7 days |
| Fix or mitigation in main | within 30 days for high/critical, 90 days for lower severities |
| Coordinated public disclosure | up to 90 days from initial report, or sooner if a fix has shipped and users are protected |

If we cannot meet a timeline, we will tell you why and propose a new one. We will not silently let a report age.

---

## Scope

### In scope

- All packages under `packages/` in this repository: `core`, `extension`, `web`, `desktop`, `bridge-spec`, `test-dapp`.
- The dApp bridge surface (`window.xchain` / extension content script).
- Vault encryption, key derivation (Argon2id), and at-rest storage (`chrome.storage.local`, IndexedDB, Electron `userData`).
- Hardware-signer transports (Trezor, Ledger) as integrated by this wallet.
- The deep-link / URI-scheme handlers (`xchain:` / `web+xchain:`).
- Reproducible-build claims for the desktop and extension targets.

### Out of scope

These are documented in `docs/Threat_Model.md` §3 and are not bugs we can fix in this codebase:

- Zero-day browser sandbox escapes.
- Compromise of upstream dependencies (we mitigate via `pnpm audit` + `docs/DEPENDENCIES.md` review, but a backdoor in a dep is the dep author's incident).
- Physical access to an unlocked device.
- Social engineering, phishing of the user's recovery phrase outside the wallet UI.
- Side-channel timing attacks on `@noble/hashes` constructions beyond what the JS engine permits.
- Findings that require an attacker who already has the user's password or seed.

If you are unsure, send the report anyway and we will tell you whether it falls in scope.

---

## What we ask

- Give us a reasonable window to fix before disclosing publicly. The 90-day ceiling is firm; earlier is fine if a fix has shipped and users are protected.
- Do not test against accounts that aren't yours, do not move other users' funds, and do not access more data than necessary to demonstrate the issue.
- Test against `regtest` chains where possible (`xchain-regtest-miner` + `xchain-platform` regtest stack). Mainnet PoCs are accepted but should be the minimum needed.
- Do not run automated scanners against `wallet.xchain.io` or our infrastructure that would impact availability for other users.

---

## What we will do

- Confirm receipt within the SLA above.
- Keep you informed as triage and remediation proceed.
- Credit you in the advisory and CHANGELOG entry, on request.
- Coordinate a CVE assignment when the severity warrants it.
- Publish a post-fix advisory describing the issue, the fix, and the affected version range.

---

## Threat model

The architectural threat model (assets we protect, threats explicitly in scope, threats explicitly out of scope, attacker scenarios, and known open items) lives at:

- `docs/Threat_Model.md`

Read that document before reporting. It tells you what we already know, what we have already mitigated, and what we have already declared out of scope. A report citing the threat-model section it relates to gets triaged faster.

---

## Verifying releases

When release-signing infrastructure ships (tracked as G158 / G159 / G180), the procedure for verifying a release artifact will be documented at `docs/Verify_Release.md`. Until then, build from source against a tagged commit; the reproducible-build pipeline targets at `tools/build-reproduce/` and `packages/desktop/Reproducible_Builds.md` document the procedure.

---

## Versions covered

We ship security fixes against the latest tagged release. Older releases are unsupported. The version under your installation is exposed in the **About** panel of every shell, and machine-readable at `packages/core/src/buildInfo.js → WALLET_VERSION`.

---

Last reviewed: 2026-04-27 at v0.194.0.
