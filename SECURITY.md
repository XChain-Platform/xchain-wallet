# Security Policy

XChain Wallet is a self-custodial multi-chain wallet. Vulnerabilities can put real user funds at risk, so we treat reports seriously and respond fast.

If you've found a security issue, please **do not open a public issue or pull request**. Use the private channels below.

---

## How to report

### Preferred: GitHub Private Vulnerability Reporting

Open a draft advisory at:

<https://github.com/XChain-Platform/xchain-wallet/security/advisories/new>

This is the fastest path. The advisory is private until we publish it.

### Alternative: Email

Email **security@dankest.llc** with:

- A description of the issue and the threat it poses.
- Reproduction steps or a proof-of-concept.
- The affected version (`packages/core/src/buildInfo.js → WALLET_VERSION`) and the shell you tested against (extension / web / desktop).
- Any patches or mitigations you'd like considered.

For sensitive reports, please encrypt the email body to our PGP key.

> **PGP fingerprint: 1A29E7C4C228F0E55D40A8C3B5B0E5ADAFDA7CE7**  
> `XChain Wallet Release Signing <releases@dankest.llc>`, ed25519, created 2026-08-06, expires 2028-08-05. The primary key is certify-only and offline; the signing subkey that actually signs a release manifest is `27A1593607C828903EF67DAD10ADF79899B41573`.
>
> This fingerprint is published at <https://xchain.io/security>, and that is currently the **only** place a public reader can read it: this file is a second copy, but this repository is private, so every URL naming it returns 404 to anyone outside the project. **Two independent channels is the design and one is the reality**, so do not treat the pair as a cross-check yet. When the second channel is genuinely reachable, both copies will name the other by URL and the rule for a disagreement will be: trust neither, and email us to ask which is current.
>
> **One XChain Wallet release has been signed with this key: `v0.336.0`, published 2026-08-06, covering the Android lane only.** Nothing else has been signed with it, so a file offered to you today as a signed desktop, extension or iOS release is not one. See "Verifying releases" below for where the Android artifact and its manifest live.
>
> The email channel above is acceptable for first contact. We will coordinate an encrypted exchange with you (a session key over a second channel, or a short-lived one-time key) before you share proof-of-concept details or anything else sensitive.

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

These are documented in the [threat model](https://docs.xchain.io/components/wallet/threat-model) §3 and are not bugs we can fix in this codebase:

- Zero-day browser sandbox escapes.
- Compromise of upstream dependencies (we mitigate via `pnpm audit` + the [dependency review](https://docs.xchain.io/components/wallet/dependencies), but a backdoor in a dep is the dep author's incident).
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

- [https://docs.xchain.io/components/wallet/threat-model](https://docs.xchain.io/components/wallet/threat-model)

Read that document before reporting. It tells you what we already know, what we have already mitigated, and what we have already declared out of scope. A report citing the threat-model section it relates to gets triaged faster.

---

## Verifying releases

The release signing key exists, its fingerprint is published above, and **one release has now been signed with it: `v0.336.0`, published 2026-08-06, covering the Android lane only.** The `.apk` is at <https://downloads.xchain.io/wallet/android/> and the manifest describing it is at <https://downloads.xchain.io/wallet/RELEASE_HASHES/v0.336.0.txt> with its detached signature beside it. That manifest declares `coverage: partial` and `lanes: android` in its own signed header, so it is full proof for the artifacts it lists and says nothing about any other lane.

No desktop, extension or iOS release has been signed or published yet (tracked as G158 / G159 / G180), so a file offered as one of those is not a release of ours. For those platforms, build from source against a tagged commit; the reproducible-build pipeline targets at `tools/build-reproduce/` and the desktop section of [https://docs.xchain.io/components/wallet/reproducible-builds](https://docs.xchain.io/components/wallet/reproducible-builds) document the procedure. The procedure for verifying any release artifact is documented at [https://docs.xchain.io/components/wallet/release/verify-release](https://docs.xchain.io/components/wallet/release/verify-release).

### Android APK signing certificate

The direct-download signing key (K10) was generated 2026-08-01. Its SHA-256
certificate fingerprint is below, and **this file is the canonical copy**. The
copy on the download page is a convenience only: a fingerprint served by the
same origin as the file it authenticates proves nothing if that origin is
compromised, so the value people should compare against is the one in this
repository, reachable independently.

    Fingerprint (SHA-256):
    4B:5D:E0:91:CF:39:97:31:06:11:B8:46:8B:67:79:DC:
    72:F5:8A:2A:94:0E:53:4F:1E:0A:59:AD:D8:25:9E:28

This key signs only the APK downloaded directly from us. An APK installed from
Google Play carries a **different** signature: Play App Signing means Google
re-signs what it serves, so a Play install cannot be checked against the value
above, and that is expected rather than a warning sign.

Verify a downloaded APK against it with:

```bash
apksigner verify --print-certs xchain-wallet-vX.Y.Z.apk
```

Two things this fingerprint is not:

- It is **not** the fingerprint of the Google Play build. Play re-signs
  uploads with its own app-signing key and serves device-split APKs, so a
  Play install cannot be verified against this value, or against our release
  manifest, at all. The directly downloaded APK is the only verifiable
  Android artifact we ship.
- It **cannot be rotated**. Android refuses an update signed by a different
  key, so replacing K10 means every direct install must uninstall (which
  erases the on-device wallet) and reinstall. If this value ever changes,
  it will be accompanied by a signed advisory saying why.

---

## Versions covered

We ship security fixes against the latest tagged release. Older releases are unsupported. The version under your installation is exposed in the **About** panel of every shell, and machine-readable at `packages/core/src/buildInfo.js → WALLET_VERSION`.

---

Last reviewed: 2026-04-27 at v0.194.0.
