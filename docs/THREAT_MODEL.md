# Threat model — XChain Wallet (Phase 1)

**Status:** Initial draft  
**Last reviewed:** 2026-04-22  
**Spec reference:** `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md` §12 (Security & Threat Model) and §14 (Key Management)

This document names what the wallet defends against, what it deliberately doesn't, and which specific mitigations ship with Phase 1. It is the artifact called for by the release-gating checklist in `IMPLEMENTATION_STATUS.md` and should be reviewed by an external security reader before any Phase-1 mainnet release. Nothing here is secret — the goal is to make the posture reviewable.

## 1. Protected assets

| Asset | Location | Consequence of compromise |
|---|---|---|
| BIP39 seed phrase | Only in the user's own possession (paper / hardware). The wallet holds it encrypted at rest. | Full loss of funds across every chain the wallet can derive. |
| Wallet master key | Derived from password via Argon2id, held in memory while unlocked. | Decryption of the persisted vault → access to all private keys. |
| Vault blob (encryptedSeed, per-wallet keys, contacts, settings) | `chrome.storage.local` (extension) or IndexedDB (web). AES-256-GCM with the master key. | Offline access to the ciphertext. Still requires the password to decrypt. |
| Session master key | `chrome.storage.session` (extension) or in-memory (web). Cleared on browser close / tab close. | Skips the Argon2id cost of re-unlocking. Not the raw password. |
| User password | Never persisted. In memory only during unlock / sign operations, zeroed after use. | Full access to every locked vault on the device. |
| Connected-site permissions | Persisted in the vault's `connectedSites` collection. | Silent approval of dApp requests the user previously granted. |

## 2. Explicitly in scope

### 2.1 Browser-execution threats

- **XSS against the dApp bridge.** Mitigated by content-script isolation (extension) and CSP on the web app. `origin` is stamped by the content script, never read from the page. Handled by `packages/extension/src/content/contentScript.js` and the bridge handler's `requireSite` check.
- **Malicious same-origin scripts in the web app.** Acknowledged as a gap — §9.3.3 spells out that the web app cannot match the extension's key isolation. Mitigations: short session lifetime (in-memory only; refresh = re-locked), no master key in sessionStorage, no third-party script tags on `wallet.xchain.io`.
- **Compromised extension page chrome (content + page isolation).** The popup and approval window run in the extension's origin, isolated from page content. Password never leaves the approval window.

### 2.2 Storage threats

- **Offline attacker with the encrypted blob.** Wallet is password-locked with Argon2id (floor: 64 MiB memory × 3 iterations × 1 parallelism, calibrated per-device on create). Without the password, the blob is AES-256-GCM-protected.
- **Tampering with the ciphertext.** AES-GCM tag mismatch surfaces as an unlock failure. An attacker who modifies the blob cannot produce a valid plaintext that opens.
- **Key recovery from `chrome.storage.session`.** Session key is the derived master key (32 bytes), not the password. On browser close, the session namespace is cleared by Chrome. Attackers with runtime access to the session have already won — this is not where the line is held.

### 2.3 Network threats

- **MITM against SDK endpoints.** Every shell endpoint is HTTPS-by-default. Per-chain URLs live in the `ChainDescriptor` and are user-settable only via explicit Settings action.
- **Malicious Hub / Explorer.** Balances, UTXOs, and address-history reads are informational; a lying server can mis-report balances but cannot sign transactions. Signing paths never trust the server for destination / amount — both come from the user-authored Send form.
- **Malicious Encoder.** Returns a PSBT the wallet signs. Mitigation: the Send form renders a plain-English decoder summary (§30) BEFORE sign; the user sees `to`, `amount`, `asset` as they typed them, even if the encoder fabricates garbage. **Known gap:** the wallet does not yet cross-check the encoder's PSBT against the user's intent at a byte level. A §21.2 simulator is the Phase-2 target.

### 2.4 User-error threats

- **Forgotten password.** Irrecoverable without the recovery phrase. Copy in the onboarding flow states this explicitly. No "forgot password" link by design.
- **Lost recovery phrase.** Irrecoverable. The onboarding Create flow requires the user to acknowledge they've saved the phrase before persisting the vault — a user who closes the tab at the mnemonic stage leaves no persisted wallet behind.
- **Phishing domain.** The extension-detect banner on the web app encourages users with the extension installed to use it (browser URL bar = trust anchor). Store-listing copy (pending) will emphasize the canonical domain.

## 3. Explicitly out of scope

- **Zero-day browser sandbox escapes.** If the browser is compromised, so is the wallet. Users with extreme threat models should use air-gapped PSBT-QR flows (§20) or hardware wallets (Phase 2).
- **Supply-chain attacks on vendored deps.** Mitigated by `pnpm audit --prod --audit-level=high` in CI + `docs/DEPENDENCIES.md` per-dep review cadence. Not bulletproof — reproducible builds (§51.4) narrow the blast radius.
- **Physical access to an unlocked device.** No wallet can defend against this. Mitigations: foreground auto-lock (§26, piece 6) and manual lock button.
- **Social engineering.** Out of scope by design. The wallet refuses to sign on a user's behalf without explicit approval; beyond that, defending against users who are tricked into signing is not a technical problem.
- **Side-channel timing attacks on Argon2id.** `@noble/hashes` is constant-time within the limits of the JS engine. Extreme-threat-model users should prefer a hardware signer where possible.

## 4. Attacker scenarios + mitigations

### 4.1 Malicious dApp requesting every permission

**Attack:** `window.xchain.connect()` with an aspirational `requestedChains` list, followed by `signAction` on unsupported or destructive kinds.

**Mitigations:**
- Connect approval screen defaults to *nothing checked* when the dApp requests a chain set — the user must opt in per chain. (`packages/extension/src/approval/kinds/ConnectApproval.jsx`)
- `canSignAction: {}` starts empty at connect — per-action "Always allow" is its own opt-in at sign time.
- Bridge handler returns `UNSUPPORTED_ACTION` for anything outside `SEND` / `SWEEP` in Phase 1 (no approval popup opens at all).
- Sign approvals render the decoded ACTION in plain English + warnings for suspicious params (`packages/core/src/decoder/actionDecoder.js`).

### 4.2 Password-guessing offline attacker

**Attack:** Attacker steals the vault blob + kdfParams meta and brute-forces the password offline.

**Mitigations:**
- Argon2id with 64 MiB memory + ≥3 iterations. Per-device calibration tunes upward to target ~1s on the user's machine.
- No password hint stored on-device.
- No account lockout / rate-limiting — irrelevant since the attack is offline. Defender budget goes entirely into Argon2id cost.

### 4.3 Malicious approval-window spoof

**Attack:** A page renders a lookalike "Approve" overlay to trick the user into confirming a different payload.

**Mitigations:**
- Approval popup is a real `chrome.windows.create({ type: 'popup' })` window, with its own origin (`chrome-extension://<id>/approval.html`). The OS renders its chrome, not the page's.
- Every approval fetches the parked request via `approval.fetch({ id })` — the page cannot forge a request id that the broker has accepted.
- Window-close = user-rejected (§43.4). A closed window never consents.

### 4.4 Compromised one-time broadcast endpoint

**Attack:** The Encoder returns a PSBT with a swapped output.

**Mitigations (partial):**
- The sign screen renders the user's stated `to` + `amount` + `asset` (from the form), not the encoder's values. If the two diverge the user has the inputs to notice.
- **Gap:** No byte-level PSBT inspection before sign. Planned: a §21.2 simulator that parses the PSBT and shows "this transaction sends X to Y" independently of what the user typed. Tracked against Phase 2.

### 4.5 Dev-SDK-mock addresses reach mainnet

**Attack:** A user onboards under a dev build, generates pseudo-addresses, receives mainnet funds to them, then loses access when the real SDK replaces the mock.

**Mitigations:**
- `createDevMockSdk` is flagged "DO NOT USE FOR MAINNET" in-line in `packages/web/src/hostBridge.js` / `packages/extension/src/background/sdkFactory.js`.
- Fallback to the dev mock fires a single `console.warn` visible in DevTools: "xchain-sdk unavailable — falling back to dev-mock SDK. Signing + broadcast will fail."
- Production builds pin `xchain-sdk` as a dependency; the fallback path should never trigger in a packaged release. CI should `grep 'dev-mock'` in build output as a pre-release gate (TODO).

## 5. Known open items

These are tracked but not blocking Phase 1; each has a pointer.

| Item | Reference | Owner |
|---|---|---|
| PSBT byte-level simulator before sign | spec §21.2 | Phase 2 |
| Hardware-wallet transports | spec §17.3–17.4 | Phase 2 |
| Background-mediated auto-lock (survives popup close/reopen) | §26 | flagged in CHANGELOG v0.38.0 |
| Reproducible-build pipeline | spec §51.4 / `tools/build-reproduce/` | piece 22 (this batch) |
| External security review | this doc | **pending** — required before Phase-1 mainnet RC |
| Threat-model gap log for incidents | n/a | open a section here after every resolved incident |

## 6. Change review cadence

This document is updated:
- Before each release (review + sign-off in the release checklist).
- After any security-adjacent change to crypto, storage, or the bridge (reviewer verifies the relevant Mitigations section still matches the code).
- After any reported incident, even if the incident was out-of-scope — to capture the scope-boundary argument for future reviewers.

## 7. Verification

Every claim in §2 has a code pointer. A reviewer can confirm each one by reading the cited file and running the matching smoke:

- §2.1 content-script / bridge isolation → `packages/core/test/bridge-e2e.smoke.js`
- §2.2 AES-GCM + Argon2id → `packages/core/test/unlock-flow.smoke.js`
- §2.3 decoder warnings → `packages/core/test/action-decoder.smoke.js`
- §2.4 onboarding acknowledge-before-persist → `packages/core/test/web-onboarding.smoke.js`

All 21+ Node-script smokes pass under `pnpm -C packages/core test:smoke`. The Vitest suite under `packages/core` exercises the component + decoder layers with coverage reporting.
