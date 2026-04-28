# XChain Wallet — Manual QA Checklist

Pre-release sanity check. Automated suites (smokes, vitest, Playwright, repro-build) cover code correctness; this checklist covers feature correctness — does the wallet actually behave the way a user expects when they hold it.

Run this against every shell (web, extension, desktop) before tagging a release. Skip a section only with a written note in the release CHANGELOG explaining why (e.g., "extension only — no desktop changes this cycle").

**Status icons:**

- ✅ Passed
- ⬜ Not yet checked
- ❌ Failed (open issue + reference here)
- ⏸ Skipped (note why)

---

## Pre-flight

- ⬜ `pnpm install` succeeds against a fresh checkout, sibling `xchain-sdk` present.
- ⬜ `node test/smoke/_run-smokes.js` reports the documented baseline (24 / 171 as of v0.194.0; update this checklist if the baseline shifts).
- ⬜ `pnpm typecheck` is clean.
- ⬜ `git status` is clean against the tagged commit (no stray edits, no `node_modules` drift).
- ⬜ `CHANGELOG.md` has a `## [x.y.z]` entry for the release with a meaningful summary.
- ⬜ `WALLET_VERSION` in `packages/core/src/buildInfo.js` matches every `package.json`.
- ⬜ `SECURITY.md` link in About panel resolves (`buildInfo.SECURITY_PUBLISHED === true`).

---

## Onboarding

Run on a clean profile (extension: fresh install / clear `chrome.storage`; web: incognito; desktop: clean `userData/`).

- ⬜ License agreement gate appears on first launch.
- ⬜ License-accept checkbox is disabled until the panel is scrolled to the end.
- ⬜ Once accepted, license gate does not reappear on subsequent launches.
- ⬜ Create wallet — 12-word selection — recovery phrase displayed, copy works, verify-quiz mismatch surfaces the offending word.
- ⬜ Create wallet — 24-word selection — same as above; verify-quiz scales position count.
- ⬜ BIP39 passphrase advanced toggle: matched-pair input, permanent-loss warning visible, threaded into vault.
- ⬜ Import recovery phrase — typed input, drag-drop `.txt`, scan QR (where camera is available).
- ⬜ Import encrypted backup `.xchain-wallet` — file picker + paste both work; backup password unlocks the file.
- ⬜ Try-before-commit demo mode — entry button works; demo banner mounts; "Exit demo & wipe" clears the wallet.
- ⬜ ADS onboarding consent screen surfaces during create (extension + web; desktop where applicable).

---

## Send

- ⬜ Send native coin (BTC / DOGE / LTC) — address paste, amount entry, fee selector.
- ⬜ Send token — picker shows pinned + visible tokens; hidden hidden until expanded.
- ⬜ Recipient autocomplete from contacts + history.
- ⬜ Address paste runs through paste-integrity check (clipboard hijack rejected).
- ⬜ Lookalike-address banner fires when an address closely resembles a recent recipient with one differing character.
- ⬜ Test-send protection prompts on a never-used recipient.
- ⬜ Fiat / token amount toggle works; `Max` button populates the form.
- ⬜ Custom fee mode shows DOGE per-kB unit-aware input.
- ⬜ RBF toggle defaults from settings; enabling it surfaces the speed-up affordance in History.
- ⬜ Broadcast success — pending card with txid, copy works, explorer link opens.
- ⬜ Broadcast cancel from HW — "Transaction cancelled." toast, return to form, no half-state.

## Receive

- ⬜ Address QR renders, copy works.
- ⬜ "Request payment" sub-form generates a BIP21 URI, share button posts to the OS share sheet (where supported).

---

## History

- ⬜ Activity feed loads; skeleton rows show during the initial fetch, replaced when data lands.
- ⬜ Empty-state nudge with Receive CTA renders for an unused address.
- ⬜ Filter chips (action type, status, date) work alone and combined.
- ⬜ Search box filters by tick / address / txid substring.
- ⬜ Grouped mode collapses ISSUE+MINT, DISPENSER+DISPENSE, ORDER+fills.
- ⬜ Tx detail expands; status timeline shows Broadcast / Mempool / Confirmed.
- ⬜ Export CSV / JSON respects active filters; downloaded file opens correctly.

---

## Token detail

- ⬜ Clicking a balance row from Home opens TokenDetail.
- ⬜ "View activity" lands History pre-filtered to the asset.
- ⬜ Star toggle moves the token to the pinned section on Home.
- ⬜ Hide toggle moves it under "Show N hidden tokens".

---

## Sign screens

- ⬜ Send sign approval — plain-English summary shows `to`, `amount`, `asset` as the user typed them.
- ⬜ Balance-change preview accurate for SEND.
- ⬜ Raw PSBT viewer expands; bytes match the hex copy.
- ⬜ User-initiated Sign Message — text → signature → verify with same address succeeds.
- ⬜ User-initiated Verify Signature — paste signature/address/message → ok / not-ok rendered correctly.
- ⬜ User-initiated PSBT paste-in form — paste hex → preview → sign → signed PSBT hex output.

---

## Lock, unlock, panic

- ⬜ Auto-lock fires after the configured timeout (default 5 min); session key cleared.
- ⬜ Manual lock action returns to Locked screen.
- ⬜ Failed-attempts escalating delay kicks in after 3 failed unlocks; banner counts down.
- ⬜ Caps-lock warning appears when caps is active in the password field.
- ⬜ Privacy blur engages on window blur (extension + desktop).
- ⬜ Biometric unlock works on supported devices (WebAuthn PRF).
- ⬜ Panic mode arms — sign attempts reject with `PANIC_MODE`; 24h countdown visible in Settings.
- ⬜ Duress passphrase silently arms panic mode and shows a decoy wallet.

---

## Backup and recovery

- ⬜ Encrypted backup export — file downloads with `.xchain-wallet` extension; size > 0.
- ⬜ Reveal seed phrase — password gate, tap-to-reveal, words match what was created.
- ⬜ Dry-run restore — paste mnemonic → preview accounts/addresses without writing.
- ⬜ Publish labels now — FILE action broadcasts (software wallets only).
- ⬜ Backup-reminder card surfaces on Home for an unverified wallet; "Back up now" routes to the right place.

---

## Hardware signers

Run with a real Trezor and Ledger device. Skip the row + add a note if a device isn't available.

- ⬜ Trezor pair flow opens Trezor Connect; address derived correctly.
- ⬜ Ledger pair flow opens WebHID picker; address derived correctly.
- ⬜ Signer-select form appears when adding accounts/addresses; HW path skips the wallet password.
- ⬜ Send via HW signer — full sign + broadcast round-trip.
- ⬜ Show Private Key surface is unavailable for HW addresses (gating enforced).

---

## Multisig

- ⬜ Create n-of-m config from Settings → Multisig.
- ⬜ PSBT-QR cosigner round-trip (animated frames + manual stepping under reduced motion).
- ⬜ Paste-inbox accepts partial PSBT hex; combiner finalizes once threshold is reached.

---

## dApp bridge

Use `packages/test-dapp/` against the extension under test.

- ⬜ `connect()` opens the approval popup; user can narrow chains.
- ⬜ Approval popup is OS-rendered (not in-page DOM).
- ⬜ `getAccounts` / `getBalances` return after connect.
- ⬜ `signMessage` round-trip — verifiable signature.
- ⬜ `signAction({ action: 'SEND' })` — approval, sign, broadcast.
- ⬜ `signIn` round-trip — challenge parses, signature verifies.
- ⬜ `disconnect` fires the `disconnect` event back to the provider; `accountsChanged` fires when the user revokes from Settings.
- ⬜ `Connected Sites` settings panel shows the test dApp; revoking removes it; revoke fires `disconnect`.

---

## Offline / degraded mode

- ⬜ Disable network — `ReachabilityBanner` appears within 30s.
- ⬜ Attempt a Send while offline — broadcast fails, banner remains; queued-broadcast UI shows the entry (where wired).
- ⬜ Re-enable network — banner clears; queue prompt appears (when wired).
- ⬜ `StalenessLabel` updates correctly across surfaces that mount it.

---

## Accessibility

- ⬜ Tab from the unlocked Home reveals the skip-to-main-content link as the first focusable element.
- ⬜ Every form has a visible focus ring on inputs, buttons, and clickable primitives (CopyButton, AddressText, etc.).
- ⬜ Status / error / success messages announce via `aria-live`.
- ⬜ `prefers-reduced-motion` clears entrance animations on Onboarding.
- ⬜ `prefers-contrast: more` palette is readable end-to-end.
- ⬜ Forced-colors mode (Windows high contrast) renders without obvious layout breakage.

---

## URI schemes

- ⬜ `xchain:<address>` opens the wallet (web shell registers via `navigator.registerProtocolHandler`).
- ⬜ Extension popup deep-link opens with the URI as a routable intent (where wired).
- ⬜ Desktop `xchain:` URI from the OS opens the wallet on macOS / Windows / Linux.

---

## Build and release artifacts

- ⬜ `pnpm --filter @xchain-wallet/web build` produces a deployable `dist/`.
- ⬜ `pnpm --filter @xchain-wallet/extension build` produces an unpacked dist that loads as an MV3 extension.
- ⬜ `pnpm --filter @xchain-wallet/desktop dist` produces signed installers for the target platform.
- ⬜ `pnpm --filter @xchain-wallet/desktop dist:unpacked` produces the reproducible Linux bundle.
- ⬜ `pnpm --filter @xchain-wallet/desktop reproduce` runs and matches `RELEASE_HASHES.txt`.
- ⬜ Diagnostic dump (About → Copy diagnostics) produces JSON with the new version stamped.

---

## Sign-off

Release manager: ___________________________  
Date: ___________________________  
Version under test: ___________________________  
Shell(s) covered: ___________________________  
Notes / known waivers: ___________________________  

---

Last reviewed: 2026-04-27 at v0.199.0.
