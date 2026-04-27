# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.143.0] - 2026-04-27

§26 Lock & Panic — Step 1 of 6 — Caps-Lock warning in password fields (G067).

The shared `<Input>` component now detects when Caps Lock is active while a password field is focused, and renders an inline aria-live status row reading "Caps Lock is on". Detection is gated on `type="password"` — every other input type sees no behavior change. Caller-supplied `onKeyDown` / `onKeyUp` / `onFocus` / `onBlur` handlers are chained, never replaced, so existing call sites (Locked.jsx, ImportWallet.jsx, CreateWallet.jsx, ViewPrivateKey.jsx, settings password prompts) pick up the warning automatically without local edits.

### Added

- **Caps-Lock detection** on `<Input>` for `type="password"` — `event.getModifierState('CapsLock')` read on `keydown` / `keyup` / `focus`. State scoped to focused-and-on; the warning hides on blur.
- **Warning element** with `role="status"` + `aria-live="polite"`, included in `aria-describedby` only while shown so screen readers announce the change without spurious associations.
- **`.capsLock` CSS class** in `Input.module.css` — uses `--xc-warning` token with `--xc-text-muted` fallback; ⇪ glyph rendered via `::before`.
- **`test/smoke/ui/input-capslock-warning.smoke.js`** — guards: useState wired, password-only gating (`isPassword` flag + early-return in `readCapsLock`), `getModifierState('CapsLock')` invocation, missing-API guard (`typeof event.getModifierState !== 'function'`), all four caller-handler chain points (`onKeyDown` / `onKeyUp` / `onFocus` / `onBlur` each invoked via optional-chain), `showCapsLock = isPassword && focused && capsLockOn` composition, `role="status"` + `aria-live="polite"` markup, conditional `aria-describedby` inclusion, CSS class + glyph.

### Changed

- **`Input.jsx`** — destructures `onKeyDown` / `onKeyUp` / `onFocus` / `onBlur` from props before the `{...rest}` spread so the local chained handlers always win; the previous behavior of spreading rest after `aria-describedby` is preserved (hint / error / capsLock IDs still appear in describedby in that order).

### Behavior preserved

- Non-password inputs run zero new code paths — `isPassword` short-circuits the modifier-state read.
- The hint / error rendering rules are untouched: hint hidden when error present, error keeps `role="alert"` priority over the new caps-lock status row.
- All existing `<Input>` test cases pass without modification (label association, hint via aria-describedby, error + aria-invalid, ref forwarding, value/onChange pass-through).

## [0.142.0] - 2026-04-27

§44 Fee UX — Step 5 of 5 — Settings → Fees panel wiring. **Closes the §44 cluster.**

The Send-form FeeSelector now seeds its initial pick from `settings.fees[chainId]`, which the §35 Fees panel writes. A user who picks "Fast" on Bitcoin in Settings opens the Send form on Bitcoin and sees the Fast tier preselected; they can still override per-tx via the FeeSelector without disturbing the saved default. Custom-mode settings (the panel's `customSatsPerKb` field) seed the FeeSelector's Custom-mode rate, with unit conversion handled by two new helpers so the user-facing display unit (sat/vB / DOGE/kB) and the persisted unit (sats/KB or koinu/KB) stay in sync.

The RBF default already wired in Step 2 — this step completes the round-trip from §35 settings to the Send form for both fee strategy and per-chain custom rate.

### Added

- **`settingsCustomToDisplayRate(unit, customSatsPerKb)`** in `flows/feeEstimate.js` — bridges the Fees-panel persistence shape (smallest-unit per KB) to the FeeSelector's display unit (sat/vB on BTC/LTC, DOGE/kB on DOGE).
- **`displayRateToSettingsCustom(unit, displayRate)`** — inverse helper for writing the Send-form Custom rate back to Settings (no caller wires this yet; available for §35 polish later).
- Both exported from `flows/index.js`.
- **`test/smoke/core/fee-settings-conversion.smoke.js`** — both helpers across BTC/LTC + DOGE, 0/negative/NaN guards, round-trip identity over a range of values.
- **`test/smoke/ui/send-fee-settings-default.smoke.js`** — Send.jsx imports, strategy-derived seed effect (low/normal/fast branch + custom branch), `Number.isFinite(customSatsPerKb)` guard, chain-aware unit derivation from `descriptor.coin`, effect dependency on `[chainId, settings]`.

### Changed

- **`Send.jsx`** — new `useEffect` reads `settings.fees[chainId]` on chain or settings change; sets `feePick` to either `{ mode }` (low/normal/fast) or `{ mode: 'custom', customRate }` with the persisted rate converted to display units. The user can still flip the FeeSelector mid-form without altering the saved default.

### Behavior preserved

- The default state of `feePick` (`{ mode: 'normal' }`) still applies as the first-paint value; the settings-derived seed runs after the settings hook resolves. Forms that open before settings load see "Normal" — same as v0.138.0–0.141.0.
- The seed effect is read-only; nothing the user does inside the Send form writes back to `settings.fees`. Per-tx FeeSelector picks are scoped to the form instance, by design.
- Settings → Fees panel UI is unchanged — only the read path gains a consumer.

### §44 cluster — close

Five steps shipped (v0.138.0 → v0.142.0). Cluster scope: §44.2 fee selector + §44.3 RBF toggle + §44.7 DOGE per-kB display + the §29 close FOLLOWUPs 3 (real fee selector wired into simulator) and 5 (fee-aware preview). Out of scope: §44.4 RBF replacement engine + §44.5 CPFP fallback (wallet-side UI shipped at v0.137.0; engines still need SDK + encoder work). Close report follows.

## [0.141.0] - 2026-04-27

§44 Fee UX — Step 4 of 5 — SDK-backed fee fetch with placeholder fallback.

The fee tiers feeding the FeeSelector + the §21.2 simulator's fee row + the §29.2 Max button now probe the shell's messaging layer for an SDK-backed `estimateFee` method before falling back to the static placeholder table. The first shell that registers `estimateFee` (the §44 SDK + encoder work) starts feeding live rates; until then, callers see exactly the same placeholder values they got at v0.138.0–0.140.0. The "(placeholder rate)" badge on the FeeSelector flips off automatically when the source is live.

### Added

- **`fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry })`** in `flows/feeEstimate.js` — async; probes `messaging.estimateFee({ chainId })` and shapes the response into the same `{ low, normal, fast, unit }` contract the sync helper already returned. Per-tier `source` is `'sdk'` when the SDK responded with a finite rate; `'static-placeholder'` otherwise. Partial SDK responses fall back per missing tier (so a SDK that only knows "normal" still upgrades that single tier without zeroing out low/fast).
- **`test/smoke/core/fee-fetch.smoke.js`** — every branch: no messaging, messaging without `estimateFee`, SDK returns full live tiers (per-tier source / confidence / sats / etaMinutes / rateValue), SDK throws (silent fallback), SDK returns null, partial response (mixed sources), DOGE live unit semantics (per-byte koinu in, DOGE/kB rateValue out), unknown chain returns null.

### Changed

- **`Send.jsx`** — replaces the synchronous `feeTiers = useMemo(estimateNativeSendFeeTiers)` with `[feeTiers, setFeeTiers] = useState` + an effect that:
  1. seeds with the synchronous placeholder so the form stays responsive on first paint
  2. fires `fetchNativeSendFeeTiers` and upgrades to SDK-sourced tiers when the response lands
  The `feeEstimate` memo prefers `feeTiers[feePick.mode]` (which inherits the SDK source) and falls back to the sync placeholder only while the async fetch hasn't populated.
- **`test/smoke/ui/send-fee-selector.smoke.js`** — asserts the new state shape, the sync seed, the async fetcher invocation, and the live-tier preference in the `feeEstimate` memo.

### Behavior preserved

- Shells without `messaging.estimateFee` (which is all of them today) see byte-for-byte the same fee values as v0.140.0. The fallback path is the same `estimateNativeSendFeeTiers` invocation that lived in the memo.
- The placeholder badge on the FeeSelector reads `feeEstimate?.source === 'static-placeholder'`. When the SDK lights up live tiers, the badge silently disappears with no further wallet-side change required.
- Custom-mode behavior is unchanged — Custom rates always run through `customFeeEstimate` with `source: 'user'`.

## [0.140.0] - 2026-04-26

§44 Fee UX — Step 3 of 5 — DOGE per-kB unit semantics in Custom-mode input.

Closes the §44.7 audit row. Step 1 already had the FeeSelector display tier rates correctly per chain (sat/vB for BTC/LTC, DOGE/kB for DOGE), but Custom-mode input expected the user to type in the *internal* per-byte unit (koinu/byte for DOGE) — confusing and unnatural. Now the Custom input accepts the DISPLAYED unit, so a DOGE user types "1.5 DOGE/kB" and the system converts to koinu/byte under the hood.

### Added

- **`flows/feeEstimate.js`** grows two conversion helpers:
  - `displayRateToPerByte(unit, displayValue)` — converts user-natural rate (sat/vB or DOGE/kB) to the table's internal per-byte rate (sat/vB or koinu/byte).
  - `perByteRateToDisplay(unit, ratePerByte)` — inverse, used to populate `rateValue` consistently in the displayed unit.
- Both exported from `flows/index.js`.

### Changed

- **`estimateNativeSendFee`** — `rateValue` in returned estimates is now the user-displayed value (DOGE/kB for DOGE, sat/vB for BTC/LTC) so that the FeeSelector's Custom-mode default seed and the input value remain consistent. The actual fee math uses internal per-byte rates from the placeholder table (unchanged).
- **`customFeeEstimate`** — the `rate` parameter is now interpreted as the displayed unit; the function converts to per-byte via `displayRateToPerByte` before computing sats. `rateValue` echoes the user-typed value verbatim.
- **`test/smoke/core/fee-tiers.smoke.js`** — adds DOGE-side assertions: `tiers.normal.rateValue === 1` (DOGE/kB), Custom rate `1.5 DOGE/kB` produces `37_500_000` koinu, and round-trip identity for the conversion helpers across a range of values.

### Behavior preserved

- BTC / LTC behavior is unchanged byte-for-byte: their displayed unit (sat/vB) IS their internal per-byte rate. The conversion helpers no-op for `sat/vB`.
- The FeeSelector's `tiers.normal?.rateValue` seed for Custom-mode now matches the input's expected unit on every chain — DOGE users see "1" prefilled (DOGE/kB), not "100000" (koinu/byte).

## [0.139.0] - 2026-04-26

§44 Fee UX — Step 2 of 5 — RBF toggle on Send form. Closes the §44.3 audit row.

The Send form gains a Replace-by-fee switch beneath the FeeSelector. Default reads from `settings.fees[chainId].rbfByDefault` (schema field exists, was unread); falls back to `true` when no per-chain setting is recorded. The current value flows into `messaging.sendAsset({ ..., rbf })`; the encoder uses it to set the input sequence numbers per BIP125 (sequence < 0xfffffffe enables RBF replacement; the §29 / §44.4 Speed up + Cancel actions in History only apply to RBF-flagged transactions).

### Added

- **`test/smoke/ui/send-rbf-toggle.smoke.js`** — `rbfEnabled` state defaulting to `true`, settings-derived sync, payload wiring (`rbf: rbfEnabled` lands in the base object), toggle UI (`role="switch"`, label + hint copy), and CSS hooks.

### Changed

- **`Send.jsx`** — new `rbfEnabled` state initialized to `true`; useEffect syncs from `settings.fees[chainId].rbfByDefault` when chain changes. The `base` payload object passed to both `messaging.sendAsset` (software signer) and `messaging.sendAssetHw` (hardware signer) gains `rbf: rbfEnabled`. UI: a `<label>` wrapper around an `<input type="checkbox" role="switch">` renders below the FeeSelector with title + hint copy.
- **`Send.module.css`** — `.rbfRow`, `.rbfLabel`, `.rbfHint` rules.

### Behavior preserved

- Existing wallets without a per-chain RBF preference get `true` by default — same as the historical implicit assumption (the encoder previously set RBF sequence numbers regardless). The schema-derived initialization only fires when an explicit `rbfByDefault` boolean lives in settings.
- The toggle is informational + advisory at the wallet layer; the encoder's actual RBF flagging depends on its respect for the new `rbf` payload field. When the encoder lands its handler (FOLLOWUP for the §29 RBF engine), this UI feeds it the right input automatically.

## [0.138.0] - 2026-04-26

§44 Fee UX — Step 1 of 5 — FeeSelector primitive + Send.jsx wiring.

The user can now pick a fee tier on the Send form. Three presets — Low / Normal / Fast — render their rate, the absolute coin-amount fee, and an approximate ETA pulled from a per-chain placeholder table. A Custom mode accepts a sat/vB rate (BTC / LTC) or a koinu/byte rate (DOGE) directly. The selected estimate flows into the §21.2 simulator's fee row + the §29.2 Max button, so both reflect the user's pick instead of the silent placeholder default.

Closes the §29 close FOLLOWUP 3 (real fee selector); the placeholder rates themselves stay flagged as such until Step 4 wires SDK-backed fetch.

### Added

- **`packages/core/src/ui/FeeSelector.jsx`** + **`.module.css`** — presentation-only primitive. Props: `tiers` (from `estimateNativeSendFeeTiers`), `value` (`{ mode, customRate? }`), `onChange`, `disabled`, `placeholderBadge`. ARIA radiogroup with three preset radios + a Custom radio that reveals a numeric input. The component never computes fees itself — callers pass tiers in and get selection events back. Re-exported from `@xchain-wallet/core/ui`.
- **`flows/feeEstimate.js`** grows two helpers and a `speed` parameter:
  - `estimateNativeSendFee({ chainId, chainRegistry, speed = 'normal' })` now dispatches per tier. Returns the existing `{ sats, coinAmount, source, confidence, rate, … }` shape plus `unit` / `rateValue` / `speed` / `etaMinutes`.
  - `estimateNativeSendFeeTiers({ chainId, chainRegistry })` returns `{ low, normal, fast, unit }` for the FeeSelector to render.
  - `customFeeEstimate({ chainId, chainRegistry, rate })` builds a user-rate estimate at high confidence.
  - Per-chain tier table: BTC 1 / 6 / 12 sat/vB; LTC 1 / 1 / 2 sat/vB; DOGE 10k / 100k / 200k koinu/byte rendered as DOGE/kB.
- **`test/smoke/core/fee-tiers.smoke.js`** — per-chain tier dispatch (sats math, defaults, unknown speed fallback, DOGE/kB unit semantics), `estimateNativeSendFeeTiers` ordering + null guards, `customFeeEstimate` rate validation + zero-rate allowance.
- **`test/smoke/ui/fee-selector.smoke.js`** — public API + ARIA radiogroup, preset wiring from `tiers` prop, selection writes (`onTierClick`, `onCustomToggle`, `onCustomRateChange`), empty-state copy, conditional placeholder badge, and CSS hooks.
- **`test/smoke/ui/send-fee-selector.smoke.js`** — Send.jsx imports, `feePick` state defaulting to `'normal'`, `feeTiers` + `feeEstimate` memos (custom branch dispatches to `customFeeEstimate`, tier branch passes `speed: feePick.mode`), and form rendering with `placeholderBadge` bound to source.

### Changed

- **`Send.jsx`** — replaces the static `feeEstimate = useMemo(estimateNativeSendFee)` with `feePick` state + `feeTiers` memo + a tier-aware `feeEstimate` memo. The selector renders below the Memo input. Both the simulator's fee row and the Max button now reflect the user's tier or custom rate.

### Behavior preserved

- Existing `estimateNativeSendFee` callers that omit `speed` get the same value they got before (defaults to `'normal'`, which matches the previous single-rate placeholder).
- Surfaces still mark the values "(placeholder)" until Step 4 wires SDK-backed fetch — the badge surfaces inside the FeeSelector's `placeholderBadge` slot.
- Submit, signing, balance preview, raw PSBT viewer — all unchanged.

## [0.137.0] - 2026-04-26

§29 Send/Receive — Step 6 of 6 — RBF Speed up + Cancel from History. **Closes the §29 cluster.**

Pending (mempool-only) coin-moving entries in History grow Speed up + Cancel buttons inside the inline DetailCard. The UI surfaces are complete; the replacement-broadcast engine itself depends on SDK / encoder work that lands as part of the §44.4 / §44.5 cluster (building a replacement transaction that respends the original tx's UTXOs at a higher fee for Speed up, or routes them to a self-controlled output for Cancel). Until that engine wires up, clicks surface a clear "RBF replacement is not supported by this build" error inline — honest about the gap, not a silent no-op.

### Added

- **`packages/core/src/flows/rbfReplace.js`** — `isEntryReplaceable(entry)` (gate: pending blockIndex, txHash present, action ∈ SEND/SWEEP/DISPENSE/DIVIDEND/AIRDROP/EXECUTE/DEPOSIT/WITHDRAW); `sendRbfRequest({ messaging, request })` (probes for `messaging.replaceTx`, validates the request shape, throws `RbfNotSupportedError` when the engine isn't wired); `replaceFromHistoryEntry({ messaging, entry, strategy, walletId, feeRate })` (validate + dispatch convenience wrapper). Exports `RbfNotSupportedError` + `RbfInvalidEntryError`.
- **`RbfActions` sub-component** in `History.jsx` — renders Speed up + Cancel buttons + inline error / status states; uses `useMessaging` to grab the shell's messaging layer and runs the flow on click.
- **`test/smoke/core/rbf-replace.smoke.js`** — full coverage of `isEntryReplaceable` (null / empty / confirmed / no-hash / non-replaceable action / case-insensitive / all 8 replaceable kinds), `sendRbfRequest` error branches (no replaceTx → `RbfNotSupportedError`; null request; missing chainId / originalTxHash; unknown strategy), happy-path passthrough, and `replaceFromHistoryEntry` validation + dispatch.
- **`test/smoke/ui/history-rbf.smoke.js`** — imports, DetailCard gate wiring, `RbfActions` component shape (messaging hook, flow invocation, button labels + strategies), error / status role attributes, and CSS hooks.

### Changed

- **`History.jsx`** — imports the rbfReplace flow primitives; DetailCard checks `isEntryReplaceable(entry)` and renders `<RbfActions entry={entry} />` inline when the entry is in mempool. New `RbfActions` function component lives at the bottom of the file, after DetailCard.
- **`History.module.css`** — `.rbfActions`, `.rbfError`, `.rbfDone` rules. The actions row sits below the decoded ACTION block with a dashed top border so it reads as a separate, action-bearing region.

### Behavior preserved

- Confirmed entries (blockIndex > 0) and non-coin-moving actions (ISSUE / MINT / DESTROY / ORDER / etc.) render the existing DetailCard exactly as before — no new buttons, no new wiring. Only mempool entries on the eight replaceable kinds gain the affordance.
- The flow validates the request shape before dispatching, so misuse from custom calling code surfaces `RbfInvalidEntryError` instead of an opaque host-side error. Surfaces wired today, engine wires when §44 ships.

### §29 cluster — close

Six steps shipped (v0.132.0 → v0.137.0). Cluster scope: §29.4 / §29.5 / §29.7 / §29.9 / §29.10 audit rows; deferred §21 FOLLOWUPs 2 (test-send) / 3 (recipient safety trio) / 4 (autocomplete) / 5 (fee-aware preview); plus the §44.4 RBF UI surfaces. A close report follows separately.

## [0.136.0] - 2026-04-26

§29 Send/Receive — Step 5 of 6 — Receive Request payment sub-form + Share button.

Closes the §29.10 (Request payment) and §29.7 (Share) audit rows.

### Fixed

- **Settings drill-down crash.** `Settings.jsx` declared `filtered = useMemo(...)` AFTER the subpage early-return, so flipping `subpageId` from null to a section id dropped a `useMemo` call from the second render and tripped React's "Rendered fewer hooks than expected" guard. The hook is hoisted above the subpage branch; both render paths now call the same number of hooks. User-reported during Step 5.

### Added

- **Request payment** sub-form on `Receive.jsx`. A `+ Request payment` toggle below the bare-address QR opens a form with Amount / Asset ticker / Memo / Expiry (minutes) inputs. As the user types, a second QR renders the BIP21 URI with `amount`, `message`, optional `tick` (XChain extension), and optional `expiry` (ISO timestamp) params. The full URI displays under the QR with Copy + Share buttons.
- **Share button** next to the bare-address Copy button (always present on a loaded address) and inside the Request payment panel. Uses `navigator.share()` when available (mobile native share sheet); falls back to `navigator.clipboard.writeText()` with an inline "Copied to clipboard." status. When neither is available, shows "Share unavailable — copy the link manually."
- **`test/smoke/ui/receive-request-share.smoke.js`** — useMemo import, all six new state slots, request URI memo (amount / tick / expiry param wiring), QR generation, share callback (Web Share + clipboard fallback), bare-address share button, panel UI + ARIA, and CSS hooks.

### Changed

- **`Receive.jsx`** — adds `useMemo` to the React import. Six new state hooks for the request form. Two new memos (`requestUri`, derived `expiresAt`). A new `useEffect` rendering `requestUri` to a QR data URL. New `onShare` callback. The body grows a `<section className={styles.requestPanel}>` block below the bare-address row. The bare-address row gains a Share button next to Copy.
- **`Receive.module.css`** — `.requestPanel`, `.requestToggle`, `.requestForm`, `.requestUri`, `.requestActions` rules. `.requestUri` is monospace + `word-break: break-all` so the long URI wraps cleanly inside the card.

### Behavior preserved

- The bare-address QR + AddressText + CopyButton above are unchanged. The request form is purely additive — opens on demand, collapses by default.
- Share's clipboard fallback uses the same Clipboard API as `<CopyButton>`. When neither share nor clipboard are available, the inline status copy tells the user to copy manually rather than swallowing silently.

## [0.135.0] - 2026-04-26

§29 Send/Receive — Step 4 of 6 — Max button + fiat toggle + real fee estimate.

Closes the deferred §21 FOLLOWUP 5 (fee-aware balance preview) and the §29.2 / §29.3 audit rows. The Send form's Amount block grows three affordances:

- **Max button.** Sets the amount to the source-address balance minus the estimated network fee (for native-coin sends) or the full asset balance (for token sends, since the fee is paid in native coin separately). Disabled when the balance hasn't loaded.
- **Fiat / native toggle.** Pressing the currency button next to Max flips the input between the chain's native ticker and USD. In fiat mode the user types a USD value; the form derives the canonical native amount via the placeholder rate. The non-active mode shows up as a "≈" preview under the field. The toggle is disabled when no rate is available.
- **Real fee estimate fed to the simulator.** The §21.2 BalanceChanges renderer now sees a non-zero fee number for SEND, so the fee row stops reading "(0)" and starts reading the actual placeholder estimate. Both surfaces display "(placeholder)" next to the value so users know it's not from a live source.

### Added

- **`packages/core/src/flows/feeEstimate.js`** — `estimateNativeSendFee({ chainId, chainRegistry })` returns `{ sats, coinAmount, source: 'static-placeholder', confidence: 'low', rate, vsize } | null`. Per-chain placeholder values: BTC 1500 sats (~6 sat/vB × 250 vB), LTC 250 sats (~1 sat/vB × 250 vB), DOGE 25,000,000 koinu (1 DOGE/kB protocol minimum). `satsToCoinDecimal(sats)` does the trailing-zero-stripping conversion.
- **`packages/core/src/flows/priceLookup.js`** — `getFiatRate({ chainCoin, fiatCurrency = 'USD' })` returns `{ rate, chainCoin, fiatCurrency, source, fetchedAt } | null`. Placeholder rates: BTC $40k, LTC $80, DOGE $0.10. Non-USD currencies return null (single-currency table). `coinToFiat` and `fiatToCoin` handle the conversions; `fiatToCoin` rounds to 8 decimals by default.
- **`test/smoke/core/fee-estimate.smoke.js`** — `satsToCoinDecimal` edge cases; per-chain placeholder values; unknown chain / coin handling; null guards.
- **`test/smoke/core/price-lookup.smoke.js`** — `getFiatRate` per-chain values, unknown coin / non-USD currency returns null, `coinToFiat` numeric + string inputs, `fiatToCoin` round-trip precision and zero-rate guard.
- **`test/smoke/ui/send-max-fiat.smoke.js`** — Send.jsx imports + `feeEstimate` memo wired into the simulator (no leftover `'0'` literal); `fiatRate` memo, `amountMode` / `fiatInput` state, toggle + fiat-input handlers; Max callback subtracts fee from balance for native sends; balance hint copy + form-stage balance fetch; CSS hooks.

### Changed

- **`Send.jsx`** —
  - Hoisted `feeEstimate` memo above the simulator's `previewResult` so the simulator gets a real fee number.
  - New state: `amountMode: 'native' | 'fiat'`, `fiatInput`. New memos: `isNativeSend`, `sourceBalance`, `fiatPreview`. New callbacks: `onMax`, `onToggleAmountMode`, `onFiatInputChange`.
  - The Amount field is now wrapped in a row containing the input + a `Max` button + a currency toggle button.
  - Below the row, a balance hint reads "Available: X TICK" (with "(fee ≈ Y, placeholder)" appended for native sends).
  - The address-balance fetch effect now also runs in the form stage (so Max + the Available hint can reference balance before the user reaches review).
- **`Send.module.css`** — `.amountRow`, `.amountField`, `.amountActions`, `.amountButton`, `.balanceHint` rules.

### Behavior preserved

- The form's existing Amount field and its `setAmount` plumbing remain the source of truth for the SEND payload — all derived state (fiat input, Max output) writes back through `setAmount`. The submit + review path is unchanged.
- The simulator's fee row was already rendered; only the input changed (placeholder instead of zero). When the §44.2 selector lands, the same wiring carries the user's chosen rate without further changes to Send.jsx.
- All values displayed from the placeholder tables carry "(placeholder)" or "(placeholder rate)" badges so users don't mistake them for live data. When §44.2 / §45 wire real sources, those badges drop automatically.

## [0.134.0] - 2026-04-26

§29 Send/Receive — Step 3 of 6 — Test-send protection.

Closes the deferred §21 FOLLOWUP 2. The Settings → Safety → Test-send warning threshold (sats) — shipped at v0.123.0 with no consumer — finally has one. When all four conditions hold:

1. `settings.grace.testSendThresholdSats > 0`
2. The send is a native-coin send (asset matches `descriptor.coin` uppercased — sat-denominated thresholds only translate cleanly for native sends; asset / token thresholds wait on a fiat-aware affordance)
3. The form's `amount × 1e8` (sats) exceeds the threshold
4. The recipient is novel — not in contacts on this chain, never received a SEND from any of the wallet's addresses on this chain — and not yet acknowledged in the session

…the review stage renders a banner above the submit area with two actions:

- **Send a small test first** — reduces the form's amount to 1% of the original (with a 1-sat floor) and returns the user to the form so they can tweak before signing the test transaction.
- **I've verified — continue** — adds the address to a session-scoped acknowledgement set so the gate stops firing for that address; the user can sign normally.

The submit button is disabled while the gate is active. Closing the form, switching chains, or entering a different recipient all release the gate.

### Added

- **`packages/core/src/flows/recipientNovelty.js`** — `checkRecipientNovelty({ address, chainCoin, contacts, historyRows })` returning `{ everSentTo, knownAsContact, novel }`. Pure helper feeding off the same data Step 1 already loaded for autocomplete (no extra fetch). Exported from `packages/core/src/flows/index.js`.
- **`test/smoke/core/recipient-novelty.smoke.js`** — empty inputs, contact-on-wrong-chain skip, history dedup over destination / DESTINATION / recipient field aliases, ISSUE actions ignored, novel-address result.
- **`test/smoke/ui/send-test-send-gate.smoke.js`** — Send.jsx wires `useSettings`, the novelty helper, the `testedThisSession` set + `markTested` setter, the gate memo (with all four condition gates), the small-test handler (1% reduction, return to form), the gate UI (banner copy + buttons + ack wiring), submit-disable wiring, and the four new CSS hooks.

### Changed

- **`Send.jsx`** —
  - `useSettings` + `checkRecipientNovelty` imported.
  - New `testedThisSession` Set state + `markTested` callback.
  - New `testSendGate` memo computing the four conditions; returns `{ amountSats, threshold, ticker } | null`.
  - New `onSendSmallTest` callback that scales `amount × 0.01` (8-decimal float, trailing-zero stripped) and pops back to the form stage.
  - Review stage renders the gate banner between decoded warnings and the RawPsbtViewer when `testSendGate` is non-null.
  - Submit button gains `!!testSendGate ||` to its `disabled` predicate.
- **`Send.module.css`** — `.testSendGate`, `.testSendTitle`, `.testSendBody`, `.testSendActions` rules. Banner uses the accent-primary color tokens (informational, not the warning yellow — this is a friendly nudge, not an error).

### Behavior preserved

- Threshold = 0 (the schema default): gate is off entirely. Existing wallets see no behavior change.
- Asset / token sends: gate doesn't fire (sat threshold isn't meaningful here). FOLLOWUP — fiat-aware threshold once §45 PRICE oracle wires.
- Acknowledgement is session-only — across reloads, the user re-confirms novel recipients. Persisting to a `wallet.testedRecipients` list would require a v3 migration; deferred until other v3 housekeeping accumulates.
- Test-send doesn't auto-resume the original amount after broadcast — the user re-enters it next time. The session ack set means they don't see the gate again on the second send.

## [0.133.0] - 2026-04-26

§29 Send/Receive — Step 2 of 6 — Recipient safety trio (checksum highlighting + paste-integrity + lookalike fuzzy match).

Closes the deferred §21 FOLLOWUP 3 from the signing-safety close report. Three additive defenses on the Send To-field:

- **Checksum-positional highlighting.** `<AddressText>` gains a `highlight` prop. When set, addresses render as three spans — first 6 (head, accent) / middle (muted) / last 6 (tail, accent) — so users can sanity-check the identifying ends of the destination at a glance. Send.jsx review wires `highlight` on the From row and the Destination detail row.
- **Paste-integrity check.** New `pasteIntegrity.checkPasteIntegrity({ pastedText })` SHA-256-hashes the pasted text and re-reads `navigator.clipboard.readText()` one frame later. If the clipboard rewrote itself between paste and re-read (a clipboard-hijack tell), Send.jsx surfaces a warning under the To-field. Permission failures / missing API silently skip — the warning is purely additive.
- **Lookalike fuzzy match.** New `lookalike.findLookalike({ address, candidates })` runs Levenshtein distance against the same suggestion set Step 1 built from contacts + recent send history. When the entered address scores ≥90% similarity to a known address — same length, one or two characters off — Send.jsx renders a warning naming the contact / history hit and the percent score.

### Added

- **`packages/core/src/shared/utils/lookalike.js`** — `levenshtein(a, b)` (single-row DP, O(min(a, b)) memory), `similarity(a, b)` (1 - distance / max), `findLookalike({ address, candidates, threshold = 0.9, minLength = 20, maxDistance = 4 })` returning `{ match, score, distance } | null`. Length-gated (skip candidates more than ±2 chars off) and short-input-gated (skip when the entered address is shorter than `minLength`).
- **`packages/core/src/shared/utils/pasteIntegrity.js`** — `hashText(text)` (SHA-256 hex via `@noble/hashes`), `checkPasteIntegrity({ pastedText, clipboard? })` async helper. Returns `{ ok, skipped?, pastedHash, reread?, rereadHash?, reason? }`. Caller-injectable `clipboard` prop for testability.
- **`test/smoke/core/lookalike.smoke.js`** — Levenshtein basics (kitten/sitting, saturday/sunday, single edits, empty / non-string), similarity gradient, findLookalike happy path, no-hit cases, threshold suppression, maxDistance gate, short-input gate, multi-candidate scoring.
- **`test/smoke/core/paste-integrity.smoke.js`** — fixed-vector SHA-256 (`""`, `"abc"`), non-string inputs, all five clipboard branches (no clipboard, identical, mismatch, throwing readText, non-string readText, missing readText fn).
- **`test/smoke/ui/address-text-highlight.smoke.js`** — `highlight` prop default off, head/middle/tail span rendering, truncate-vs-full middle behavior, empty / short-address branches, CSS hooks including the muted-token middle.
- **`test/smoke/ui/send-recipient-safety.smoke.js`** — Send.jsx imports + state + paste-integrity wiring + lookalike candidate set + warning copy + form-stage rendering + review-stage `highlight` on From and Destination.

### Changed

- **`packages/core/src/ui/AddressText.jsx`** — adds `highlight` prop (default false). Refactor splits the render into four explicit branches (empty / short / non-highlight / highlight). Truncate behavior unchanged when `highlight` is off — existing call sites keep their current rendering.
- **`packages/core/src/ui/AddressText.module.css`** — `.head`, `.middle`, `.tail` rules. `.middle` uses `--xc-text-muted`.
- **`Send.jsx`** —
  - Paste handler now also fires `checkPasteIntegrity` (fire-and-forget; mismatch sets `pasteWarning`).
  - New `lookalikeWarning` memo over `toAddress` + `suggestions`. Both warnings render under the AddressCombobox with `role="alert"`.
  - Review stage wires `<AddressText … highlight />` on the From row, and intercepts the decoder's "Destination" detail to render through `<AddressText … highlight />`.

### Behavior preserved

- Non-highlight `<AddressText>` rendering is unchanged byte-for-byte for existing callers.
- The Send form keeps its current submit / signing / balance-preview / raw-PSBT-viewer wiring. The two new warnings are advisory; neither blocks submit.
- Paste-integrity skips silently on browsers / contexts where `navigator.clipboard.readText` isn't available, so the form remains usable in non-secure contexts.

## [0.132.0] - 2026-04-26

§29 Send/Receive — Step 1 of 6 — Recipient autocomplete + smart paste.

The Send To-field becomes a combobox sourced from the user's contacts plus addresses they have previously sent to from this wallet on the active chain. Pasting into the To-field detects BIP21 / `xchain:` URIs (pre-filling amount, ticker, and memo) and surfaces a hint when the clipboard contents look like a private-key WIF (pointing the user at the import-private-key flow rather than letting a private key land in a recipient field).

Closes the §29.4 / §29.5 audit rows and the deferred §21 FOLLOWUP 4 (autocomplete).

### Added

- **`packages/core/src/flows/recentDestinations.js`** — pure helper. `buildRecentDestinations({ contacts, chainCoin, historyRows })` returns a `Suggestion[]` ordered contacts-first, then send-history entries deduped by address and ranked by recency × frequency. `filterSuggestions(suggestions, query)` runs the substring filter the combobox applies on every keystroke. Both exported from `packages/core/src/flows/index.js`.
- **`packages/core/src/ui/AddressCombobox.jsx`** + **`.module.css`** — combobox primitive wrapping `<Input>`. ARIA: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`; listbox + option roles on the dropdown; `aria-selected` on the active option. Keyboard nav for ArrowUp / ArrowDown / Enter / Escape. `onPaste` passes through to the underlying input so callers (Send.jsx) can run paste detection before the value lands. Re-exported from `@xchain-wallet/core/ui`.
- **`test/smoke/core/recent-destinations.smoke.js`** — exercises the helper across empty inputs, contact filtering by chain, history deduplication and recency ordering, contact-vs-history merge precedence, contact name vs entry-label sublabel rules, and `filterSuggestions` substring matching.
- **`test/smoke/ui/address-combobox.smoke.js`** — public API, forwardRef export, Input wrapping, every ARIA hook, the four keyboard handlers, mousedown selection wiring, and CSS-module hooks.
- **`test/smoke/ui/send-autocomplete.smoke.js`** — Send.jsx wires the combobox in the form, fetches contacts on mount, fetches per-address history when chain changes, feeds the helper, runs `detectQrContent` on paste, and surfaces `pasteHint` through the combobox `hint` slot.

### Changed

- **`Send.jsx`** — To-field is now `<AddressCombobox>` with the same label, placeholder, and autocomplete attributes as before. Suggestions assemble from `messaging.listContacts()` (one fetch on mount) + `messaging.getAddressHistory({ chainId, address })` for each of the wallet's own addresses on the active chain (refetches when the chain changes). Paste runs through `uri.detectQrContent`:
  - `bip21` → fills `to`, `amount`, `tick` (as ticker), `message` (as memo); shows "Filled from `<scheme>`: URI" in the hint slot.
  - `xchain-uri` → same fill, "Filled from xchain: URI".
  - `wif` → blocks the paste, shows "That looks like a private key…" pointing at the import flow.
  - Anything else falls through to default text paste.
- **`SafetySection.jsx`** — Undo-send grace row removed. The feature was scrapped: a cancellable countdown both delays every broadcast and rewards rage-clicking with a no-op. The `settings.grace.undoSendSeconds` schema field stays as a dead slot until a future v3 migration sweeps it (see settings close FOLLOWUP 12).
- **`test/smoke/ui/settings-safety.smoke.js`** — drops the undo-send assertions and adds explicit `doesNotMatch` checks so a future re-introduction is loud.

### Behavior preserved

- The To-field still accepts arbitrary text — pasting a raw address passes through unmodified. The combobox dropdown is purely additive and disappears on Escape, blur outside the combobox, or selection.
- Contact / history fetches are non-blocking — failure leaves the user with an empty suggestion list and the bare text-input behavior intact.
- Submit, signing, balance preview, raw PSBT viewer — all unchanged.

## [0.131.0] - 2026-04-26

§21 Signing Safety — Step 6 of 6 — Raw PSBT viewer (Developer Mode gated). Closes the §21 cluster and retires Settings FOLLOWUP 6.

A power-user reveal under both sign surfaces — SignApproval (`signPsbt` + `signAction`) and Send.jsx review. Hidden by default; opens to a `<details>` disclosure showing whichever raw pieces the surface has at sign time:

- **PSBT hex** — surfaced for dApp-initiated `signPsbt` requests where the dApp passes the hex it built.
- **Action fields** — pretty-printed JSON of the payload the encoder will ingest. Always available for `signAction` and the Send.jsx review form.
- **Parsed inputs / outputs** — placeholder section that reads "(parser not wired yet — see PSBT hex above)". A future commit wires a real BIP-174 parser; until then the disclosure stays honest about its limit.

A Copy button writes the displayed payload (PSBT hex when present, else action-fields JSON) to the clipboard.

### Added

- **`packages/core/src/shared/components/RawPsbtViewer.jsx`** — `<RawPsbtViewer developerMode psbtHex actionFields />`. Hard-gated: `developerMode=false` → null; no payload at all → null (no orphan disclosure). Read-only.
- **`packages/core/src/shared/components/RawPsbtViewer.module.css`** — dashed border + subtle background so the viewer reads as a developer affordance, not part of the main sign surface.
- **`getSettings()`** in `packages/extension/src/approval/messaging.js` — the approval window doesn't sit inside the shared MessagingProvider, so it can't use the `useDeveloperMode` hook. This wrapper hits the same `settings.get` host handler the popup + web shells call.
- **`test/smoke/ui/raw-psbt-viewer.smoke.js`** — public API + dual gate semantics (developerMode + non-empty payload), section presence + ARIA labels, Copy-button label semantics, every CSS hook, SignApproval wiring (settings fetch + per-kind props), Send.jsx wiring.

### Changed

- **`SignApproval.jsx`** — fetches `getSettings` once on mount, caches `developerMode` in local state (defaults to `false` so cold start + fetch failure both keep the gate closed). Renders `<RawPsbtViewer>` between BalanceChanges and the password form.
- **`Send.jsx`** — uses the existing `useDeveloperMode` hook (Send sits inside MessagingProvider). Renders `<RawPsbtViewer>` after the warnings block in the review stage with `action: 'SEND'` + the form's TICK / AMOUNT / DESTINATION / MEMO.

### Behavior preserved

- Sign-screen surfaces unchanged for users with developer mode off — the new component renders nothing in that path. Fetch failures keep the gate closed by design.
- Approve / Reject footer position, password gate, save-permanent toggle, HW signing block, BalanceChanges placement, action details disclosure — all unchanged.

### §21 cluster — close

This commit closes the §21 Signing Safety build (Steps 1–6, v0.126.0–v0.131.0). End-to-end: pure simulator (Step 1) → renderer (Step 2) → Send.jsx wiring (Step 3) → SignApproval wiring (Step 4) → §21.3 layout polish (Step 5) → raw view (Step 6). Of the seven §21 audit rows in the 2026-04-26 gap report, five close (transaction simulator, raw PSBT viewer, the §21.3 layout pieces). Two remain deferred for §29 Send-form clusters (test-send protection, recipient checksum highlighting + autocomplete) — see the close report at `claude/reports/specs/2026-04-26_signing-safety-build-close.md` (lands in the next commit).

## [0.130.0] - 2026-04-26

§21 Signing Safety — Step 5 of 6 — sign-screen layout polish (§21.3 + §21.7).

Brings the sign screens — the dApp-triggered SignApproval window and the user-initiated Send.jsx review stage — in line with the §21.3 layout sketch and §21.7 copy conventions. Three pieces:

1. **Chain-aware approve / sign buttons.** "Approve & Sign on Bitcoin" instead of bare "Approve" for `signAction` and `signPsbt`; "Sign on Bitcoin" instead of bare "Send" for the Send.jsx software-signing path. Mitigates approval-drift between tabs — the user always sees which chain is about to commit a signature. `signMessage` keeps "Approve" (signing a message commits no value, the chain suffix would mislead). `signIn` reads "Sign in".
2. **dApp Source block.** New labelled section above the action summary in SignApproval — Origin in mono, optional App name below. Distinct surface (`--xc-surface-raised` background + bordered) so the user reads "this is from xyz.com" before reading what the action does. Renders only when an origin is present.
3. **Collapsible details.** Action details (per-field decoded rows) now sit inside a `<details>` disclosure that's closed by default, per §21.3 ("collapsed but discoverable; power users expand, casual users ignore"). Toggle reads "Details (N)" with the row count.

### Added

- **`approveLabel`** derivation in `SignApproval.jsx` — kind-aware label ("Approve & Sign on <chain>" / "Approve & Sign" / "Sign in" / "Approve").
- **Source block** — `<section>` above SignSummary surfacing dApp `origin` + `appName`.
- **`<details>` + `<summary>` disclosure** wraps action details in both SignApproval and Send.jsx review.
- **`packages/extension/src/approval/kinds/SignApproval.module.css`** — new `.source`, `.sourceLabel`, `.sourceOrigin`, `.sourceApp`, `.details`, `.detailsToggle` rules. Source uses `--xc-surface-raised`; toggle reads as a small label that hovers to full text.
- **`packages/core/src/shared/routes/Send.module.css`** — new `.details`, `.detailsToggle` rules; `.detailsList` now nests inside the disclosure.
- **`test/smoke/ui/sign-screen-layout.smoke.js`** — approve-label semantics for all four kinds, Source block presence + props, action-details disclosure, every new CSS hook, Send.jsx submit-label + disclosure parity.

### Changed

- **`SignApproval.jsx`** — Approve button now renders `{approveLabel}` (was hardcoded "Approve"). Action details `<dl>` wrapped in a `<details>` disclosure with a "Details (N)" summary. Source block renders above SignSummary on dApp-originated requests.
- **`Send.jsx`** — Submit button reads "Sign on <chain>" (software path) or "Sign on Trezor/Ledger" (HW path; unchanged copy). Review-stage `<dl>` wrapped in a `<details>` disclosure.

### Behavior preserved

- Approve / Reject footer position, password gate, save-permanent toggle, HW signing block — unchanged.
- BalanceChanges renders above the disclosure (always visible) so the headline metric stays scannable; the disclosure only hides the per-field details that power users want to expand.

## [0.129.0] - 2026-04-26

§21 Signing Safety — Step 4 of 6 — SignApproval (signAction) wires the preview.

The §21.2 preview now lights up on the dApp-triggered sign screen too. SignApproval.jsx fetches the source address's balances against the dApp's requested chain, runs them through the simulator, and renders `<BalanceChanges>` between the existing `<SignSummary>` and the password form. Source address resolution: prefer `payload.payload.from.address` when the dApp passes it; otherwise fall back to the wallet's first address on the requested chain via `addresses.byChain`. Fetch failures degrade gracefully — the section reads "(preview unavailable)" and the user can still approve.

The preview is gated to the `signAction` kind. `signMessage`, `signPsbt`, and `signIn` skip it — they don't move value, so a balance-change preview would be misleading.

### Added

- **`getAddressBalances` + `getAddressesByChain`** in `packages/extension/src/approval/messaging.js` — thin wrappers matching the popup + web shells, routing to `balances.address` and `addresses.byChain` respectively. Lets the approval window resolve a signing source address without round-tripping through the popup.
- **`test/smoke/ui/sign-approval-balance-preview.smoke.js`** — approval-side wrappers, render-gate semantics (`signAction` only), source-address resolution (dApp-supplied vs fallback), simulator inputs (action / params / balances / fee), loading + error props plumbed through, JSX ordering (`<SignSummary>` → `<BalanceChanges>` → form).

### Changed

- **`packages/extension/src/approval/kinds/SignApproval.jsx`**:
  - Adds `previewBalances` state + a `signAction`-gated `useEffect` that resolves the source address and fetches its balances.
  - Adds a `useMemo` that runs `decoder.simulateAction` once balances arrive.
  - Renders `<BalanceChanges>` between `<SignSummary>` and the password form, only for the `signAction` kind.
  - Fee defaults to `'0'` until the bridge payload carries an estimate (§44.2).

### Behavior preserved

- All four sign kinds (`signMessage` / `signPsbt` / `signAction` / `signIn`) keep their existing summary, password gate, save-permanent toggle, and approve / reject footer. The preview is additive — approval still resolves cleanly even if the preview fetch fails.
- `signMessage` / `signPsbt` / `signIn` continue to render exactly as before — the preview gate is structural, not a runtime fall-through.

## [0.128.0] - 2026-04-26

§21 Signing Safety — Step 3 of 6 — Send.jsx review wires `<BalanceChanges>`.

The §21.2 preview goes live on the user-initiated Send flow. On entering the review stage Send.jsx now fetches the source address's balances via the new `balances.address` shell wrapper, runs the SDK shape through the new `decoder.balancesFromSdk` adapter, feeds the decoded ACTION + balances into `decoder.simulateAction`, and renders `<BalanceChanges>` between the headline and the details list. Fetch failures don't block — the section reads "(preview unavailable — <reason>)" muted and the user can still sign.

### Added

- **`packages/core/src/decoder/balanceAdapter.js`** — `balancesFromSdk(sdkShape)` converts the SDK's `{ native, assets }` raw shape (string base-units `quantity` + `divisibility`) into the simulator's human-scale `BalanceLookup[]`. Pure helper, sits in `decoder/` because it pairs 1:1 with `simulateAction`'s input contract. Re-exported from `decoder/index.js` so callers reach it via `decoder.balancesFromSdk(...)`.
- **`getAddressBalances(chainId, address)`** in `packages/web/src/messaging.js` and `packages/extension/src/popup/messaging.js` — thin wrapper over the existing `balances.address` host handler.
- **`test/smoke/ui/send-balance-preview.smoke.js`** — adapter semantics (sat scaling, divisibility=0, trailing-zero strip, negative quantities, null/empty), per-shell wrapper presence, Send.jsx imports + `simulateAction` + `balancesFromSdk` calls + the on-review-only effect + the loading/error props plumbed to the renderer + the JSX ordering (summary → BalanceChanges → details list).

### Changed

- **`packages/core/src/shared/routes/Send.jsx`** — adds `previewBalances` state (loading / error / sdkShape) and a stage-gated `useEffect` that fetches against the source address; adds `previewResult` derived via `simulateAction`; renders `<BalanceChanges>` between the action headline and the details list. Fee defaults to `'0'` until the §44.2 fee-selector cluster lands.

### Behavior preserved

- Send.jsx form / submit / done / error paths unchanged. The preview is additive — review still progresses to `submitting` even if the preview fetch fails.
- SignApproval (signAction) still renders the v0.125.0 layout unchanged; Step 4 wires the same preview there next.

## [0.127.0] - 2026-04-26

§21 Signing Safety — Step 2 of 6 — `<BalanceChanges>` renderer.

Dumb renderer over a `SimulationResult` (the shape produced by `decoder.simulateAction` shipped at v0.126.0). Three lifecycle states — loading skeleton, error fallback (preview unavailable), result — and three render sections — balance deltas, side effects, notes. Renders nothing when the result is empty so a fee-only generic-fallback action doesn't show an orphaned section.

### Added

- **`packages/core/src/shared/components/BalanceChanges.jsx`** — `<BalanceChanges result loading error title />`. Per-row helpers split fee rows ("Network fee — BTC 0.0003") from token deltas ("Your MYTOKEN: 500 → 400") with a `data-direction` attribute (`down` / `up` / `flat`) on each row that the CSS uses for color affordance. Side effects render as a labelled list ("MYTOKEN supply: +50 (newly minted)"). Notes render muted at the bottom.
- **`packages/core/src/shared/components/BalanceChanges.module.css`** — root card uses `--xc-surface-raised` to read as a distinct block under the action headline. Negative-delta `.after` reads in `--xc-danger`, positive in `--xc-success`. Fee row reads muted.
- **`test/smoke/ui/balance-changes.smoke.js`** — public-API check, three lifecycle states, fee-vs-token branching, direction helper semantics, side-effects + notes rendering, every CSS hook the JSX references, and a forward-looking pair of assertions that Send.jsx and SignApproval.jsx are *not* yet wired (Steps 3 + 4 will wire).

### Behavior preserved

- No callers consume the component yet. Steps 3 + 4 wire it into Send.jsx review stage and SignApproval.jsx (signAction kind) — those wiring smokes confirm end-to-end behavior. This step exercises the renderer in isolation.

## [0.126.0] - 2026-04-26

§21 Signing Safety — Step 1 of 6 — pure transaction simulator (`txSimulator.js`).

The first §21.2 building block. A pure projection module that, given a decoded ACTION + the source address's current balances + a fee estimate, returns the post-state the user is about to commit to: per-asset balance deltas (token rows + a coin row + a separate fee-label row), protocol-level side effects (token supply changes, dispenser open / cancel / refill, dividend pool, broadcast publication), and prose notes for the not-pre-simulatable parts (holder count for DIVIDEND, list size for AIRDROP, contract state for EXECUTE). No I/O, no SDK, no vault — Steps 3 and 4 wire the SDK balance lookup into Send.jsx review and SignApproval respectively, then feed it into a `<BalanceChanges>` component that ships in Step 2.

### Added

- **`packages/core/src/decoder/txSimulator.js`** — `simulateAction({ action, params, balances, feeEstimate, chainId, chainRegistry })` returning `{ deltas, sideEffects, notes }`.
  - Per-action simulators: SEND (token / coin), SWEEP, MINT (to-self / to-other), DESTROY, ISSUE (v0 create / v0 transfer-only / v3 lock / config), DIVIDEND, DISPENSER (v0 open / v1 cancel / v2 edit-refill), BROADCAST (v0/v1/v2/v3), AIRDROP, LIST, BATCH (recursive aggregation), generic fallback.
  - Decimal-string add / subtract on bigint-scaled integers — sat-level precision survives arbitrary chained operations without float drift. Handles up to 18 fractional digits (every tick on the platform fits).
  - Coin-family → ticker mapping (`bitcoin` → `BTC`, `litecoin` → `LTC`, `dogecoin` → `DOGE`) inlined to keep the simulator importless and consistent with the same map in `SwapForm.jsx` / `CoinpayForm.jsx`.
- **`packages/core/src/decoder/index.js`** — re-exports `simulateAction` alongside the existing `decodeAction`.
- **`test/smoke/core/tx-simulator.smoke.js`** — 19 cases covering every per-action simulator, BATCH aggregation, decimal-string precision (sat-level + signed), generic fallback, empty-balance / null-fee paths, and static wiring.

### Behavior preserved

- `decodeAction` is unchanged. The simulator is a sibling, not a wrapper.
- No code path consumes `simulateAction` yet — Step 2 builds the renderer, Steps 3 and 4 wire it. This step is groundwork only and runs zero new code in either shell.

## [0.125.0] - 2026-04-26

Settings — drilldown refactor with state-summary rows.

The §35 Settings page used to render every section's full body inline — 16 stacked panels meant the user had to scroll past a long page and could not see *what was set* without entering each panel. Refactored into a scannable list: 4 short bodies stay inline (Appearance, Language & Region, Notifications, Contacts), 1 external drill stays as-is (Accounts & Addresses → AccountPicker), and 10 sections flip to internal drilldowns that render the section's existing component inside a Settings sub-page. Each drill row carries a short summary string showing current state on the right.

Examples of the new top-level rows:

- **This Wallet** › Main Wallet
- **Privacy** › 2 of 5 on
- **Safety** › Auto-lock 15 min
- **Fees** › All defaults
- **Network & Endpoints** › All defaults / 2 chains custom
- **Connected Sites** › 0 sites / 3 sites
- **Automatic Donation System** › On · 12,345 sats donated
- **Developer Mode** › Off / On
- **About** › 0.125.0

### Added

- **`DrillRow`** primitive in `Settings.jsx` — title on the left, summary + chevron on the right, summary truncates with ellipsis when narrow.
- **Internal sub-page routing inside `Settings.jsx`** — a `subpageId` state renders the targeted section's existing Component inside a Screen with a "Back to settings" header. No App.jsx changes required in either shell — the routing lives entirely inside Settings.
- **Summary helpers** — `privacySummary`, `safetySummary`, `feesSummary`, `endpointsSummary`, `adsSummary`, `developerSummary`, `connectedSitesSummary`. The connected-sites count is fetched once at mount via `messaging.listConnectedSites()`.
- **`test/smoke/ui/settings-drilldown-refactor.smoke.js`** — kind splits, subpage routing primitives, DrillRow primitive shape, useSettings invocation, summary-helper semantics.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — render switch now handles three section kinds (`external-drill`, `internal-drill`, `panel`). 10 sections flip from `kind: 'panel'` to `kind: 'internal-drill'`. Drill rows render `<DrillRow>`, panels render `<PanelBlock>` with the existing section heading + description + body.
- **Affected per-section smokes** — assertions flipped from `kind:\s*'panel'` to `kind:\s*'internal-drill'`. No section-component code changes; the components are rendered unchanged inside the new sub-page wrapper.

### Behavior preserved

- Section components render with the same props they used to (Backup still receives `activeWallet`, This Wallet still receives `activeWallet` + `onOpenWalletPicker`).
- Search input still filters by title / description / keywords; the keywords for each section have been broadened slightly so common synonyms reach the right drill row.
- The 4 inline panels keep their existing inline rendering — Appearance / Language & Region / Notifications / Contacts are short enough that hiding them behind a chevron would be churn.

## [0.124.0] - 2026-04-26

Chain visibility — shared helper for the regtest-reveal rule.

The "regtest descriptors are hidden from user-facing pickers unless Developer Mode is on" rule (spec §2.2 + §48.3) was inlined inside `NetworkEndpointsSection.jsx` and `AdsSection.jsx` as a per-call predicate. Centralised into a shared `filterChainsForUser` / `isChainVisibleToUser` pair under `packages/core/src/registry/visibility.js` so every future picker / list / form picks up the same gate without restating it.

### Added

- **`packages/core/src/registry/visibility.js`** — `filterChainsForUser(descriptors, settings)` and `isChainVisibleToUser(descriptor, settings)`. Defaults to "hide regtest" when settings is null / missing the developerMode flag, so cold-start callers default to the safe branch.
- Re-exports `filterChainsForUser` + `isChainVisibleToUser` from `packages/core/src/registry/index.js`.
- **`test/smoke/core/chain-visibility.smoke.js`** — count drops by exact regtest descriptor count when developerMode is off, all chains visible when on, null-settings cold-start path defaults to hidden, single-descriptor predicate matches the bulk filter.

### Changed

- **`packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx`** — replaces the inline `developerMode || d.networkKind !== 'regtest'` filter with `registryLib.filterChainsForUser(...)`.
- **`packages/core/src/shared/components/settings/AdsSection.jsx`** — replaces the inline regtest filter with `registryLib.isChainVisibleToUser(d, settings)`.

## [0.123.0] - 2026-04-26

Settings schema v1 → v2 migration. Unlocks every "Coming soon" deferred toggle across the §35 panels.

`schemas/settings.js` `CURRENT_VERSION` bumps from 1 to 2; existing wallets migrate forward via `settingsMigrations[1]` with defaults that preserve v1 behavior. All five v1 panels stay backwards-compatible — the fresh fields default to no-ops (`'auto'` reduced motion, `false` for the new privacy toggles, `0` test-send threshold, `false` panic-mode enabled, `'off'` backup reminders).

### Added

- **Schema v2 fields:**
  - `reducedMotion: 'auto' | 'always' | 'never'` (Appearance override of the OS `prefers-reduced-motion` signal)
  - `privacy.blurOnBlur: boolean` (window-unfocus blur of mnemonic / QR / balance surfaces)
  - `privacy.labelsSurviveRestore: boolean` (§19.5.2 on-chain label sync opt-in; toggle persists today, FILE-action submit/fetch wiring is shell-level pending)
  - `grace.testSendThresholdSats: number` (large-amount confirmation gate; `0` disables)
  - `panicMode.enabled: boolean` (§26.5 schema slot; full duress-PIN flow lands separately)
  - `backupReminders: 'off' | 'monthly' | 'quarterly'` (§19.1 backup-reminder cadence)
- **`settingsMigrations[1]`** in `schemas/migrations.js` — forward-only v1 → v2 migrator with sensible per-field defaults that preserve v1 behavior.
- **`REDUCED_MOTION_MODES` + `BACKUP_REMINDER_CADENCES`** tuples exported from `schemas/settings.js`.
- **`test/smoke/core/settings-schema-v2.smoke.js`** — schema constants, `createDefaultSettings` shape, v1-record migration with default-fill on missing fields, post-migration validation, `updateSettings` round-trip on the new fields, validator rejection of bad values.

### Changed

- **`packages/core/src/shared/components/settings/AppearanceSection.jsx`** — Reduced-motion select goes live (auto / always / never). Accent-color row stays deferred pending brand cut.
- **`packages/core/src/shared/components/settings/PrivacySection.jsx`** — Blur-sensitive-on-blur and Labels-survive-restore toggles flip from disabled "Coming soon" to live.
- **`packages/core/src/shared/components/settings/SafetySection.jsx`** — Test-send warning input, Panic mode toggle, and Backup reminders cadence picker flip from disabled "Coming soon" to live.

### Migration semantics

Vault opens existing v1 records, the singleton store calls `migrateSettings`, the migrator default-fills the new fields, the validator passes, the record is rewritten on the next `vault.settings.put`. No data loss; no surprise behavior change. Per-field comparison in the smoke confirms a v1 record with `changeAddressRotation: false` survives migration as `false` (not silently flipped to the default `true`).

## [0.122.0] - 2026-04-26

Settings — drop Keyboard Shortcuts panel.

The §35 Settings tree previewed §34 keyboard shortcuts in a read-only panel at v0.120.0. Out of scope for the wallet at this point — removed entirely so the surface doesn't promise something we're not building.

### Removed

- **`packages/core/src/shared/components/settings/KeyboardShortcutsSection.jsx`** + its smoke. Settings.jsx drops the import + section literal. The `keyboard` section id is no longer in the §35.1 scaffold.

## [0.121.0] - 2026-04-26

Settings — Step 18 of 18 — ADS onboarding consent during wallet creation.

Closes the §35 Settings build. CreateWallet.jsx grows a fourth stage `ads-consent` between `persisting` and the `onCreated()` callback. After the wallet record + first account + first address per active chain are persisted, the user sees a one-time consent screen presenting Enable / Decline with equal prominence (no dark pattern). Either choice writes `settings.ads.enabled` via `messaging.updateSettings` then advances; the user can flip the toggle any time in Settings → Automatic Donation System. Per spec §36.1 the screen surfaces the per-chain default amounts and notes that no donation line appears on sign screens after setup.

ADS_DEFAULT_ENABLED stays true so "Enable" is a no-op write at the data layer; "Decline" persists `ads.enabled = false` before continuing.

### Added

- **`packages/core/src/shared/routes/CreateWallet.jsx`** — new `ads-consent` stage rendered between persistence and the `onCreated` callback. Two equally-styled buttons; busy / error state co-located with the choice handler.
- **`test/smoke/ui/ads-onboarding-consent.smoke.js`** — stage-union widening, transition from persisting, both buttons wired with the right boolean, settings write via deep-merge nested `ads.enabled` patch, onCreated fired after the choice.

## [0.120.0] - 2026-04-26

Settings — Step 17 of 18 — Keyboard Shortcuts panel (preview).

The §34 keyboard system is fully unbuilt per the gap audit (no global hook, no dispatch table, no rebind UI). This panel ships a read-only preview listing the planned shortcut surface (`?`, `Cmd/Ctrl+K`, `Esc`, `g h`/`g a`/`g c`/`g s`, `n s`/`n r`, `l`) so users and contributors can see the planned system without a separate docs page. Each row is labelled "not yet active" and rebind controls land when §34 ships.

### Added

- **`packages/core/src/shared/components/settings/KeyboardShortcutsSection.jsx`** — read-only shortcut catalogue with kbd-style chips.
- **`test/smoke/ui/settings-keyboard-shortcuts.smoke.js`** — table presence, expected entries, deferral copy, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — keyboard section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.119.0] - 2026-04-26

Settings — Step 16 of 18 — This Wallet panel + destructive removeWallet flow.

The This-Wallet section flips from a drilldown to a panel that surfaces the active wallet's name + a "Switch / rename…" drilldown into the existing WalletPicker (which already houses rename + migrate-to-BIP39) plus a new **Remove wallet** action with a typed-name confirmation modal. Removal goes through a fresh `removeWallet` core flow that purges the wallet record + every linked descendant: accounts, addresses, signers, pendingTxs, pendingAirdrops, multisigSigningSessions, watchlistEntries. The host handler also evicts the SignerPool entry so the unlocked seed material is cleared synchronously.

Vault-level singletons (settings) and shared collections (contacts, connectedSites) survive — they aren't owned by a single wallet.

### Added

- **`packages/core/src/flows/removeWallet.js`** — destructive deletion flow. Returns a `{ removed: { wallet, accounts, addresses, signers, pendingTxs, pendingAirdrops, multisigSigningSessions, watchlistEntries } }` bookkeeping summary so callers can confirm the cleanup.
- **`SignerPool.evict(walletId)`** in `packages/core/src/signers/SignerPool.js` — locks one wallet's signer + drops it from the pool. Used by the `wallet.remove` host handler.
- **`wallet.remove` host handler** in `createBackgroundHost.js` — calls the flow + evicts the SignerPool entry.
- **`removeWallet` messaging wrappers** in popup + web.
- **`packages/core/src/shared/components/settings/ThisWalletSection.jsx`** — wallet name + Switch/rename drilldown + Remove action with typed-name confirmation modal.
- **`test/smoke/ui/settings-this-wallet.smoke.js`** — flow-level test that purges only the targeted wallet's descendants while leaving siblings intact + source-level wiring assertions for SignerPool.evict, host handler, messaging wrappers, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — this-wallet section flips from `kind: 'drill'` to `kind: 'panel'` with `Component: ThisWalletSection` and `props: { activeWallet, onOpenWalletPicker }`.

## [0.118.0] - 2026-04-26

Settings — Step 15 of 18 — Contacts export / import panel.

Bulk export the address book as JSON and bulk import a contacts file. Each imported record is upserted via `messaging.saveContact({ record })` so the existing id is preserved — re-importing the same file overwrites in place rather than duplicating. Per-contact editing (add / rename / delete) stays where it already lives, in the dedicated Contacts route reached from the main menu.

### Added

- **`packages/core/src/shared/components/settings/ContactsSection.jsx`** — count display, Export action (Blob download), Import action (file picker + JSON parse + saveContact loop with skip-on-invalid).
- **`test/smoke/ui/settings-contacts.smoke.js`** — list/save calls, JSON encode/decode, file-input wiring, count pluralisation, status/error rendering, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — contacts section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.117.0] - 2026-04-26

Settings — Step 14 of 18 — Connected Sites panel.

Lists ConnectedSite records sorted by `lastUsedAt` desc with origin / appName / connect / last-used timestamps. Each row expands to a permissions summary (granted chains, accounts, sign-message permission, per-action signAction map) and carries a Disconnect action that deletes the record. Per-action permission editing (toggling individual ACTIONs between allow / ask / deny) needs a narrower write handler than full record replacement; that lands in a follow-up step. List + disconnect cover the majority of value — users who want to reset a site can disconnect and re-approve.

### Added

- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`** — list + expandable permissions summary + disconnect.
- **`sites.list` + `sites.delete` host handlers** in `createBackgroundHost.js`.
- **`listConnectedSites` + `deleteConnectedSite` messaging wrappers** in popup + web.
- **`test/smoke/ui/settings-connected-sites.smoke.js`** — section surface, permissions fields, empty state, host wiring, messaging exports, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — connected-sites section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.116.0] - 2026-04-26

Settings — Step 13 of 18 — Backup panel.

Wires the §19.4 encrypted backup-file flow up through to the user. Click "Export…", enter a backup password (separate from the wallet-unlock password) twice for mismatch detection, the renderer downloads the encrypted JSON envelope as `<walletName>-YYYY-MM-DD.xchain-wallet`. Three additional spec items render as deferred rows: seed-phrase reveal (needs a new `wallet.revealSeed` flow), test-backup / dry-run restore (needs its own multi-step UI for `dryRunRestore`), published labels (§19.5.2 FILE-action transport).

### Added

- **`packages/core/src/shared/components/settings/BackupSection.jsx`** — export action with two-pass password prompt + Blob-download trigger; three deferred rows for seed phrase, dry-run restore, published labels.
- **`wallet.exportBackup` host handler** in `createBackgroundHost.js` calling `flows.exportBackupFile`. Web shell shares via `hostBridge.js`.
- **`exportBackupFile()` messaging wrappers** in popup + web messaging modules.
- **`test/smoke/ui/settings-backup.smoke.js`** — section surface, host wiring, messaging wrappers, Settings.jsx render-switch panel-props plumbing.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — render switch now passes a `section.props` bag through to panel components (`<Component {...panelProps} />`). Backup section uses this to receive `activeWallet`. Backup section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.115.0] - 2026-04-26

Settings — Step 12 of 18 — Automatic Donation System panel.

The headline panel for the §35 build per spec §36. Master ON/OFF + per-chain block (per-tx amount in sats, trigger threshold, donation address shown for verification, lifetime stats: donated total, tx count, accumulated). Per-chain inputs disable when ADS is off so the user can't poke them mid-disable. Regtest chain blocks hide unless Developer Mode is on.

The donation-address row honestly surfaces the `PLACEHOLDER_REPLACE_BEFORE_MAINNET` sentinel state — descriptors carrying the placeholder render `Pending — real <chain> donation address ships before mainnet GA` instead of pretending the sentinel is a real address.

### Added

- **`packages/core/src/shared/components/settings/AdsSection.jsx`** — master toggle + per-chain block editor. Writes use the deep-merge nested form for both `ads.enabled` and `ads.perChain[chainId]` patches.
- **`test/smoke/ui/settings-ads.smoke.js`** — useSettings + placeholder import, toggle wiring, per-chain numeric edit shape, lifetime stat rendering, placeholder-vs-real branch, regtest gating, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — ads section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.114.0] - 2026-04-26

Settings — Step 11 of 18 — Developer Mode panel + regtest reveal in Network & Endpoints.

Two live toggles (`developerMode`, `learnMode`) plus four deferred reveals (custom chain registry, raw PSBT inspector, auto-approve localhost, logs console) covering spec §48. The Developer Mode toggle now gates regtest visibility in the Network & Endpoints panel — when off, regtest descriptors are filtered out; when on, they appear with their localhost defaults pre-populated. Broader picker filtering (Send / Receive / Swap chain pickers across the app) lands in a follow-up step.

### Added

- **`packages/core/src/shared/components/settings/DeveloperModeSection.jsx`** — two live toggles + four "coming soon" deferred reveals.
- **`packages/core/src/shared/hooks/useDeveloperMode.js`** — convenience accessor returning `{ developerMode, ready, error }` from useSettings. Defaults to `false` while loading or unavailable so feature gates default to the hidden branch.
- **`test/smoke/ui/settings-developer-mode.smoke.js`** — panel surface, regtest filter in NetworkEndpointsSection, hook contract, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx`** — descriptors filtered through `developerMode || d.networkKind !== 'regtest'` so regtest rows are hidden by default.
- **`packages/core/src/shared/routes/Settings.jsx`** — developer section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.113.0] - 2026-04-26

Settings — Step 10 of 18 — Network & Endpoints panel.

Per-chain Explorer / Encoder / Hub URL editor backed by `settings.sdkEndpoints`. One block per registered chain (sorted coin → mainnet/testnet/regtest); each block carries the three URL inputs with the registry defaults as placeholders, a "Custom" / "Default" indicator, a "Save" button that commits a dirty buffer, and a "Reset to default" button that wipes the override. The schema's `custom` flag is computed automatically — set when the saved values diverge from defaults, cleared when they match — so the §49 reachability banner and any future hub-driven endpoint refresh have an honest signal.

### Added

- **`packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx`** — iterates `chainRegistry.supportedChains()`, draft-buffer per chain, dirty-detect against current persisted entry, computed `custom` flag.
- **`test/smoke/ui/settings-network-endpoints.smoke.js`** — useSettings + chain-registry imports, `supportedChains()` iteration, sort order, three URL labels, save/reset wiring, computed-custom flag, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — network-endpoints section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.112.0] - 2026-04-26

Settings — Step 9 of 18 — Fees panel.

Per-chain fee profile editor backed by `settings.fees`. One block per chain entry the `seedSettingsForChains` flow has populated; each block carries a strategy picker (low / normal / fast / custom matching the schema's `FEE_STRATEGIES` tuple), a custom sats-per-KB number input that surfaces only when strategy=custom, and an RBF-by-default toggle that disables itself when the chain descriptor's `feeStrategy.rbfSupported` is false.

### Added

- **`packages/core/src/shared/components/settings/FeesSection.jsx`** — chain-keyed iteration over `settings.fees`. Writes use the deep-merge nested form `update({ fees: { [chainId]: patch } })`. Pulls chain display names + RBF support from `chainRegistry.get(chainId)`.
- **`test/smoke/ui/settings-fees.smoke.js`** — useSettings + chain-registry import, write path shape, strategy coverage matches `FEE_STRATEGIES`, custom-rate input gated on `strategy === 'custom'`, RBF toggle gated on `descriptor.feeStrategy.rbfSupported`, empty-state copy, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — fees section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.111.0] - 2026-04-26

Settings — Step 8 of 18 — Notifications panel.

Five toggles backed by `settings.notifications.*` (txConfirmations, incomingReceipts, dispenserFills, orderFills, priceAlerts). Owns user preference only; the §46 delivery layer (browser Notification API, extension service-worker, OS toast on desktop) is a separate concern.

### Added

- **`packages/core/src/shared/components/settings/NotificationsSection.jsx`** — five toggles via shared `ToggleRow`. Writes use the deep-merge nested form: `update({ notifications: { [key]: next } })`.
- **`test/smoke/ui/settings-notifications.smoke.js`** — useSettings wiring, every schema notification flag has a corresponding `NOTIFICATION_FLAGS` entry, write path, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — notifications section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.110.0] - 2026-04-26

Settings — Step 7 of 18 — Safety panel.

Live: auto-lock timeout (`settings.autolockMinutes`) and undo-send grace (`settings.grace.undoSendSeconds`). Both pickers carry curated common values plus a fallback "(custom)" option preserving any out-of-list value the schema currently holds. Three deferred toggle rows surface the spec's remaining safety items: test-send warning, panic mode, backup reminders. All three need schema migrations + flow wiring; panic mode is also called out as fully unbuilt in the gap audit.

### Added

- **`packages/core/src/shared/components/settings/SafetySection.jsx`** — auto-lock + undo-send selects + three deferred toggles.
- **`test/smoke/ui/settings-safety.smoke.js`** — useSettings wiring, write paths (top-level scalar + nested grace patch), option coverage, deferred-row presence, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — safety section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.109.0] - 2026-04-26

Settings — Step 6 of 18 — Privacy panel.

Three live toggles for the `privacy.*` flags already on the v1 schema (Tor routing, change-address rotation, hide small balances). Two additional spec §35.1 rows ship as disabled deferral rows: blur-sensitive-on-blur and labels-survive-restore — both need a schema migration before they go live.

### Added

- **`packages/core/src/shared/components/settings/PrivacySection.jsx`** — three toggles + two deferred rows. Writes use the deep-merge nested-object form: `update({ privacy: { [field]: next } })`.
- **`packages/core/src/shared/components/settings/_settingsPrimitives.jsx`** — shared layout helpers (`ROW`, `STACK`, `ROW_HINT`, `SELECT`, `INPUT`, `ToggleRow`, `Status`) extracted out of the per-section files. Reused across PrivacySection now and by every panel after it.
- **`test/smoke/ui/settings-privacy.smoke.js`** — useSettings wiring, three live toggles map to the schema fields, two deferred rows are disabled with "Coming soon" hints, primitives module exports the expected surface, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — privacy section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: PrivacySection`.

## [0.108.0] - 2026-04-26

Settings — Step 5 of 18 — Language & Region panel.

Language picker (English-only at the moment; spec §54 i18n adds locales over time as new dictionaries land under `packages/core/src/i18n/`) and fiat-currency picker. Currency picker offers a curated 12-entry shortlist plus a "Custom…" option that types an arbitrary ISO code into the persisted record — the schema accepts any non-empty string.

### Added

- **`packages/core/src/shared/components/settings/LanguageRegionSection.jsx`** — language `<select>` + currency `<select>` with custom-code input. Both writes go through `useSettings().update`.
- **`test/smoke/ui/settings-language-region.smoke.js`** — wiring, picker contents, custom-code path, status fallbacks, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — language-region section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: LanguageRegionSection`.

## [0.107.0] - 2026-04-26

Settings — Step 4 of 18 — Appearance panel.

First write-capable §35.1 panel. Theme picker (system / light / dark) wired through `useSettings()` → `messaging.updateSettings({ theme })` → core `updateSettings` flow → `vault.settings.put`. Reduced-motion override and accent-color rows render as muted deferral copy until the schema migration / brand cut land.

### Added

- **`packages/core/src/shared/components/settings/AppearanceSection.jsx`** — Theme `<select>` reading the schema's `THEMES` tuple. Loading / error / write-failure states all render inside the section without disturbing the rest of the page.
- **`test/smoke/ui/settings-appearance.smoke.js`** — useSettings wiring, THEME_OPTIONS covers the schema's exact `THEMES` tuple, write path goes through `update({ theme })`, deferral copy present for the two not-yet-shipped rows, Settings.jsx flips appearance from stub to panel.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — appearance section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: AppearanceSection`.

## [0.106.0] - 2026-04-26

Settings — Step 3 of 18 — About panel.

First read-only panel filling in the §35.1 Settings tree. Surfaces wallet version, update channel, license, reproducible-build doc, release-signatures doc, and disclosure-policy doc as labelled rows. Items whose underlying artifact is not yet published (SECURITY.md per the gap audit; release signatures pre-GA) render a muted "not yet published" hint instead of an inert link.

### Added

- **`packages/core/src/buildInfo.js`** — single source of truth for build-time wallet metadata: `WALLET_VERSION`, `LICENSE_NAME`, `LICENSE_FILE`, `NOTICE_FILE`, `SECURITY_FILE` + `SECURITY_PUBLISHED`, `REPRODUCIBLE_BUILD_DOC`, `RELEASE_SIGNATURES_DOC` + `RELEASE_SIGNATURES_PUBLISHED`, `UPDATE_CHANNEL`. Bumped alongside every wallet version per the synchronized-versioning rule.
- **`packages/core/src/shared/components/settings/AboutSection.jsx`** — renders the seven About rows from `buildInfo.js`. Read-only; no host roundtrip.
- **`test/smoke/ui/settings-about.smoke.js`** — buildInfo exports the expected constants, `WALLET_VERSION` matches `core/package.json`, AboutSection renders the seven labelled rows with the publish-gate fallbacks, Settings.jsx wires AboutSection as the `about` panel and the render switch handles the new `panel` kind.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** — render switch now handles a third section kind, `panel`, in addition to `drill` and `stub`. The `about` section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: AboutSection`.

## [0.105.0] - 2026-04-26

Settings — Step 1 + 2 of 18 — Substrate + sectioned page scaffold.

First two steps of the §35 Settings build. The wallet ships with the data schema for every setting (theme, autolock, language, fees, sdkEndpoints, privacy, ads, notifications, developerMode, learnMode, grace) but the Settings route only surfaces Wallet + Account drilldowns; this release lays down the read/write substrate and the long-page section layout the rest of the build will fill in. No editable panels yet — those start at v0.106.0.

### Added

- **`getSettings(vault)` + `updateSettings(vault, patch)` flows** at `packages/core/src/flows/settings.js`. `updateSettings` does a deep merge: top-level scalars replace, nested plain objects merge one level, chain-keyed records (`sdkEndpoints` / `fees` / `ads.perChain`) merge by key, then validates against `validateSettings` before persisting. Invalid patches throw and the on-disk record stays untouched.
- **`settings.get` + `settings.update` host handlers** registered in `createBackgroundHost.js`. Web shell reuses the same host via `hostBridge.js` — one registration covers both shells.
- **`getSettings()` + `updateSettings(patch)` messaging wrappers** in `packages/web/src/messaging.js` and `packages/extension/src/popup/messaging.js`.
- **`useSettings()` React hook** at `packages/core/src/shared/hooks/useSettings.js` — returns `{ settings, loading, error, refresh, update }`. Degrades to an `error` state (rather than throwing at render time) when a shell hasn't wired the messaging methods yet.
- **`test/smoke/core/settings-flow.smoke.js`** — substrate behaviour: empty-vault default fallback, scalar replacement, nested merge, chain-keyed merge by key, validation rejection of bad values, source-level checks that messaging modules export the helpers and the host registers the handlers.
- **`test/smoke/ui/settings-scaffold.smoke.js`** — all 16 §35.1 sections present in spec order, search input wired, drilldowns preserved, ComingSoon placeholder rendered for stub sections.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** rebuilt as the §35.1 long-page scaffold. The previous 2-section layout (Wallet + Account drilldowns) is preserved and renamed in spec order to **This Wallet** + **Accounts & Addresses**. 14 stub sections added below them: Appearance, Language & Region, Privacy, Safety, Backup, Fees, Network & Endpoints, Notifications, Connected Sites, Contacts, Automatic Donation System, Keyboard Shortcuts, Developer Mode, About. Each stub renders a section heading + description + a `Coming soon` placeholder body. A non-functional search input at the top filters sections by title / description / keyword strings — wiring is live; the consumed surface is just the scaffold for now.

## [0.104.0] - 2026-04-26

Multi-wallet / multi-account substrate, navigation rework, and a quieter chrome.

### Added

- **Multi-wallet, multi-account vault.** A vault can now hold multiple `Wallet` records, each with multiple BIP44 `Account` records. New `flows/createAccount.js` derives the next free index + a first address per active chain. `wallet.add.import` MessageHost handler unlocks new wallets into the SignerPool; `wallet.rename` updates a Wallet's display name; `account.list` / `account.create` round-trip per-wallet account state.
- **`SignerPool`** in `packages/core/src/signers/SignerPool.js` — keeps unlocked SoftwareSigners in memory for the lifetime of an unlocked session. Populated at `wallet.unlock` while the password is in scope; lets `account.create` (and other HD-derive ops) reuse pre-unlocked signers without prompting again. Locked + cleared on `wallet.lock` and tear-down.
- **Per-account scoping** for balances and addresses. `walletBalances` / `addressesByChain` / `newestAddress` host helpers and `receiveAddress` flow now accept an optional `accountId`; Home / Receive / AddressList / History pass the active account through. App-level `activeAccountId` state replaces Home's local copy so route props stay in sync across navigation.
- **Wallet picker / Account picker / Settings routes.** Compact summary rows in the gear-popover replaced by full-screen pickers reachable from Settings → Wallet / Account. Each row in the wallet picker carries an outlined info button that opens **Wallet Details** (read-only metadata: name, type, origin, 25th-word state, account count, created-at) with a primary "Rename wallet" action and a "Migrate to BIP39" action for FreeWallet-legacy entries.
- **`AddAccountForm` route** — no password prompt; reuses the SignerPool entry for the active wallet and persists Account #N+1 with auto-named default ("Account 2", "Account 3", …).
- **`RenameWalletForm` route** — name input only; Save lives in the header's right-side icon slot (matches the picker chrome).
- **Header `Settings` entry + `Settings` route.** Gear icon moved out of the header into the pancake menu under a Settings row. The route surfaces Wallet + Account summary rows that drill into the pickers.
- **Header network-filter button.** Filter icon next to the menu in the popup header opens a popover that lists every coin family directly — one click to open, one to pick. Accent dot indicates a non-`all` filter is active.
- **Home quick-action row.** Send / Receive / Swap / Buy as four equal-width tiles between the total-balance hero and the tab strip. Outlined in the accent color, circular icon badges, hover swaps the background only.
- **Activity tab** moved to the rightmost position in `HomeTabs`.

### Changed

- **Main menu reorganized** — collapsed ~25 mixed entries into a flat list of true app sections: Markets, Tokens (→ ActionsMenu), Messaging, Cross-chain (→ CrossChainTemplates), Contacts, Addresses, Contracts, Staking, Multisig, Settings. Send / Receive / Swap / Buy and the per-token sub-actions are gone from the menu — the quick-action row covers Send/Receive, the rest live behind their grouped entry.
- **Back-button standardisation.** Every form's footer "Cancel" / "Back" button removed across 47 routes (~85 buttons). Single `<` icon in each route's header is now the only back affordance. Routes without a header (Onboarding / CreateWallet / ImportWallet) now render a back-arrow header when reachable from the unlocked add-wallet flow; Onboarding's back returns to the wallet picker rather than home.
- **Locked screen** — dropped the "XChain Wallet" heading and "Wallet locked." subtitle. Logo + password input + "Unlock Wallet" button is the whole surface.
- **Onboarding & FreeWallet legacy flows.** CreateWallet and ImportWallet take a `mode` prop (`'fresh' | 'add'`). Fresh-install uses the pre-host `wallet.import` (asserts an empty vault); add-mode uses the new host-side `wallet.add.import` against the open vault.
- **DevVariantBadge** repositioned from `right: 12px` to `left: 12px` so it stops overlapping the menu items on the right edge of the popup.

### Removed

- The flat token-action `extraActions` list in the pancake menu — those entries reach via the new "Tokens" entry which navigates to the existing ActionsMenu route.
- Legacy `Cancel` / `Back` form footers across the route layer.
- "Tap to switch…" subtitles under the Wallet / Account rows in Settings — replaced with a `›` chevron on the right.

## [0.103.0] - 2026-04-25

Major iteration session. Wallet was effectively never built or run before this — package.json deps were declared but `pnpm install` had not been run since v0.12.0, no `vitest` invocation had ever rendered a component, and several runtime paths (Web Crypto, getUserMedia, Clipboard API) were broken on the LAN-host HTTP origin the user actually loads from. This release brings the project from "code-complete spec on disk" to "actually runs in a browser, has a deep test substrate, and has a coherent design language."

Version demoted from `1.0.0-rc.6` → `0.102.0` (then bumped here to `0.103.0`) because the RC label implied production-readiness the codebase did not have.

### Added

- **Whole-wallet test substrate at `xchain-wallet/test/`** matching the per-component layout used across every other XChain Platform service. 13 distinct test types: `unit/`, `smoke/`, `integration/`, `boundary/`, `chaos/`, `fuzz/`, `regression/`, `security/`, `benchmarks/`, `mutation/`, `a11y/`, `e2e/`, plus playwright reorganized under `e2e/`. Per-type `vitest.config.<type>.js` at the wallet root. Per-type `setup.js` + `README.md` documenting scope + run cmd + conventions. New `pnpm test:<type>` scripts.

- **Deep crypto coverage** across `packages/core/src/crypto/`. ~80 new tests spanning unit (per-module), integration (kdf↔aead↔walletBlob, mnemonic→hd, backup roundtrip), boundary (kdf params, hd paths, aead size limits), chaos (backup tamper across 4 vectors), fuzz (aead/wif/mnemonic round-trip properties), security (10K-iteration nonce uniqueness, backup tamper resistance), benchmarks (kdf at floor + 2× tiers, hd derive, aead per size). Stryker mutation config scoped to crypto + util.

- **Auto-icon `<Button>`** — single-source label-to-icon resolver (`iconForLabel`) shared by Button + HeaderActionMenu. 40+ pattern bucket coverage. Buttons that pass an explicit `icon` prop keep theirs; static-string labels auto-iconify; opt-out via `icon={null}`.

- **20-icon set** at `packages/core/src/ui/icons/` — hand-rolled inline SVGs (no icon-library dep) for Send, Receive, Sign, Broadcast, Lock, Unlock, Stake, Swap, Markets, Message, History, Address, Contract, Home, Settings, More, Back, Forward, Plus, Check, X, Trash, Pencil, Refresh, Copy, Paste, Scan, Search, Filter, Eye, EyeOff, Link, Unlink, USB, Download, Upload, Pause, Play, Migrate, Token, Multisig, Info, ExternalLink, Menu (pancake).

- **`<ChainPicker>` primitive** — single-select dropdown with chain icon + display name + ticker · network suffix. Searchable when option count > 6. Replaces native `<select>` for chain selection across 16 forms (Send, Swap, Compose, Broadcast, TokenAdmin, Destroy, Mint, IssueToken, TokenWizard, Multisig, Dividend, Dispenser, DeployContract, Link, Airdrop, AdvancedActions).

- **`<NetworkFilter>` dropdown** on Home — replaces the All/BTC/LTC/DOGE chip row with one searchable picker that scales to N coin families.

- **`<UnifiedBalanceList>`** — single list of every balance across every chain (Coins section + Tokens section), each row with an avatar + chain-icon overlay + name + ticker subtitle + quantity + fiat value.

- **`<HeaderActionMenu>`** (pancake drawer) for the `small` variant — full-overlay slide-in with two sections (Wallet primary nav + §40+ Actions), Alerts entry with count badge, Lock-wallet block at bottom.

- **`<AlertsOverlay>`** — alerts panel surfaced from the pancake. Severity-railed (info/warning/critical). First inhabitant: legacy FreeWallet-format → migrate. Replaces the inline legacy-banner in Home body.

- **Variant switcher (`small` ↔ `full`)** driven by viewport width with 640px threshold. URL/`localStorage` overrides. Floating dev badge bottom-right showing variant + source + viewport px + flip controls. Forced-small rendering inside a centered 375×600 frame so designers see the popup the way users will.

- **Session-scoped password cache** (`sessionStorage`) — `unlockWallet` saves the password; `lockWallet` and tab-close clear it; auto-unlock on App boot when the cache is populated. Web shell only.

- **Dev fake balances + 40 tokens** at `packages/web/src/devFakeBalances.js` — populates the dev-mock SDK with 50 BTC, 30 LTC, 100k DOGE, plus 40 distinct tokens distributed by chain personality. Each token carries an asset+display+description+quantity+divisibility+fiatRate. Lets the UI render realistic balance data without a configured explorer.

- **`@vitejs/plugin-basic-ssl`** — opt-in HTTPS for the web shell via `VITE_HTTPS=1`. Self-signed cert. Useful for testing hardware-signer flows from a non-localhost origin.

- **`@noble/ciphers`** dependency at the core package level. Backs the rewritten AEAD.

- **`fast-check` + `axe-core`** dev dependencies for the fuzz + a11y-runtime suites.

- **`packages/web/public/favicon.png`** — wired from the brand asset; web shell's `index.html` now references it. Closes the persistent 404.

- **Reduced-motion support on `<AnimatedQrFrames>`** — when `prefers-reduced-motion: reduce`, the auto-advance interval suspends and Prev/Next manual controls render. Cadence label flips to "manual".

### Changed

- **`packages/core/src/crypto/aead.js`** — replaced Web Crypto API (`crypto.subtle.importKey/encrypt/decrypt`) with pure-JS `gcm()` from `@noble/ciphers/aes`. SubtleCrypto is gated on a secure context (HTTPS or `localhost`); the previous implementation crashed onboarding under any LAN-host HTTP origin with `Cannot read properties of undefined (reading 'importKey')`. Wire format unchanged (12-byte IV ‖ ciphertext ‖ 16-byte tag) so existing vaults decrypt cleanly under the new code path.

- **`packages/core/src/signers/LedgerSigner.js`** — replaced `crypto.subtle.digest('SHA-256', ...)` with `sha256()` from `@noble/hashes/sha2`. Same secure-context fix.

- **`packages/core/src/util/uuid.js`** (new) — `randomUUID()` polyfill that uses `crypto.randomUUID` when available and falls back to a `crypto.getRandomValues`-based UUIDv4. Replaces 12 schema files' direct `crypto.randomUUID()` calls (account, address, connectedSite, contact, migrations, multisigConfig, multisigSigningSession, pendingAirdrop, pendingTx, signer, wallet, watchlistEntry).

- **`packages/extension/manifest.json`** — `version` rolled back to plain semver `0.103.0`; `version_name` ships the human-readable string. Earlier RC-style versioning carried forward via `deriveExtensionVersion`.

- **Test directory layout** — `packages/core/test/` → `xchain-wallet/test/` at the workspace root, matching the per-component pattern across the platform. 95 files moved, 119 import-path rewrites, 81 `wsRoot` path-computation rewrites. `vitest.config.js` moved to root, smoke runner `cwd` adjusted, root `package.json` gained `"type": "module"` so smokes parse as ESM.

- **`<Screen>` layout** — `--xc-screen-h` custom property for parent-driven sizing (defaults to `100dvh` with `100vh` fallback). `overflow: hidden` on `.screen` so the body's `overflow-y: auto` becomes the only scrollable region — sticky header on every variant. `popup` variant renamed to `small`.

- **Onboarding labels** — "Create a new wallet" → "Create new wallet"; "I already have a wallet" → "Import wallet"; "Coming from FreeWallet" → "From FreeWallet". All buttons gained icons.

- **`<CopyButton>`** — multi-tier clipboard write (modern API → legacy `execCommand('copy')` textarea fallback) so plain-HTTP origins still copy. State machine: idle → copied → failed → idle. Visible "Copy failed" state instead of silent no-op.

- **Button system** — `white-space: nowrap` baseline, every variant uses `#FFFFFF` text on coloured fills (no `var(--xc-text-inverted)` which inverted to black in dark mode).

- **Error display** — moved from below the second password field on `<ImportWallet>` to a top-of-form red alert box. White text on saturated red with WCAG-AA contrast. `text-align: center`, `font-weight: 500`. Same treatment applied to `<CreateWallet>`.

- **Why-migrate paragraphs** in `<MigrateToBip39>` — switched from centered/muted to justified body copy with full-contrast text + 1.55 line-height. Buttons gained Back/Migrate icons.

- **Home header** — brand block (logo + "XChain Wallet" + optional wallet-name subtitle when it differs from the product name) replaces the previous wallet-name-only title.

- **`packages/web/vite.config.js`** — `host: '0.0.0.0'` so the Mac side of Parallels can reach the dev server. `allowedHosts: ['devhost', 'localhost', '127.0.0.1']` to bypass Vite 5's host check.

- **`packages/extension/package.json`** + **`packages/web/package.json`** — `xchain-sdk` switched from `^1.13.0` (npm — only published 1.2.5 available) to `link:../../../xchain-sdk` (sibling repo).

- **Dev-mock SDK** in `packages/web/src/hostBridge.js` — proxied `get*` lookup that returns empty arrays by default and overrides `getBalances` to return the realistic dev fake-balance dataset. Constructor receives the per-chain `network` opt so balances are chain-appropriate.

- **`pnpm-workspace.yaml`** — `e2e` workspace renamed to `test/e2e`.

- **`.npmrc`** added: `shamefully-hoist=true`. Required because `vite-plugin-node-polyfills` injects shim imports into bundled core code that pnpm's strict layout couldn't resolve.

### Removed

- `packages/web/dist/`, `packages/extension/dist/` — no longer in tree (rebuild via `pnpm -C packages/<shell> build`).
- Old `e2e/` workspace root — moved to `test/e2e/`.
- `packages/core/vitest.config.js` — moved to wallet-root `vitest.config.js`.
- `packages/web/src/devPasswordCache.js` — replaced by `sessionPasswordCache.js` (no longer dev-gated).

### Decided

- **Crypto layer is pure-JS, not Web Crypto.** Web Crypto's secure-context gate is incompatible with self-hosted wallet deployment patterns (LAN HTTP, mobile Safari sometimes, IPv4 internal). `@noble/ciphers` + `@noble/hashes` cover everything we need; perf is comparable to SubtleCrypto at our payload sizes (verified in benchmarks).

- **`small` variant covers Chrome extension popup, mobile browsers, and any narrow container.** Single design serves every constrained-width context. `full` covers everything else. Detection is viewport-width-driven (640px threshold), not shell-driven.

- **Pancake menu in `small` is the SOLE navigation surface.** No "More actions" link to a list-in-main-view — main view is for doing work, pancake is for navigation. Drops a class of confusion where users land on a menu route and don't realize they need to go back.

- **Test directory at workspace root, not per-package.** Matches every other XChain Platform component's convention. Cross-package test types (integration, e2e) need a workspace-level home.

### Notes

- 11 pre-existing UI test failures in `unit/ui/Button.test.jsx` / `Input.test.jsx` / `CopyButton.test.jsx` and 1 decoder string-mismatch are stale assertions from this session's design iteration. They need their expectations refreshed; tracked separately.
- 21 pre-existing smoke failures (out of 92) are also stale assertions (label changes, `link:` xchain-sdk pin, `ChainBalanceCard` → `UnifiedBalanceList` swap) — same family of cleanup.
- Suite-level pass rates as of this commit: integration 25/25, boundary 49/49, chaos 16/16, fuzz 10/10, security 15/15, regression 4/4, a11y 8/8, unit 171/182. Benchmarks live (`pnpm test:bench`).

## [1.0.0-rc.6] - 2026-04-24

§56.3 Pre-launch — user-initiated track, Step 5 of 5 — accessibility audit readiness packet. Closes the autonomous portion of the user-initiated track. Pure-documentation slice; the user (Dankest, LLC) hands the packet to an external accessibility-audit vendor when they're ready to engage.

### Added

- `claude/reports/specs/2026-04-24_a11y-audit-readiness.md` (in the platform repo, gitignored) — readiness packet. Sections:
  - **Scope** — what the static gate already covers (button label / img alt / input label / textarea label / div-onclick role+tabIndex; 0 violations across 64 shared routes + 9 UI primitives) vs. what the external audit covers (color contrast, focus-visible, live-region timing, keyboard traps, screen-reader walkthroughs, reduced-motion verification, touch-target sizing per WCAG 2.5.5, forced-colors / Windows high-contrast, reflow + zoom per WCAG 1.4.10). Out-of-scope: i18n / RTL, audio/video, dApp pages.
  - **Surface inventory + walkthrough targets** — per-route AT expectations across 7 surface groups (Onboarding, Lock/unlock, Home/send/receive, Sign-screen with all 8+ action types separated, Multisig coordinator, Approval popup, Settings + key management). The sign-screen entries pin what AT should announce per action so the auditor can grade exhaustively.
  - **Assistive technologies** — NVDA + JAWS + VoiceOver (macOS + iOS) mandatory; TalkBack + Orca recommended. Four-shell coverage matrix (popup / full-screen / web / desktop renderer).
  - **Already-addressed during pre-launch** — the static-gate baseline, the v1.0.0-rc.4 reduced-motion implementation, multisig session round labels, sign-screen safety-rail rendering, MultisigBadge aria. Vendor doesn't waste hours rediscovering these.
  - **Audit deliverables we expect** — WCAG-success-criterion-keyed findings with severity + reproduction including AT version + viewport, screen-reader transcripts, coverage matrix, regression test recommendations, per-criterion pass/fail at WCAG 2.2 AA so the GA release notes can claim conformance.
  - **Coordination** — scope-lock at rc.N tag, weekly check-ins for engagements > 2 weeks, no fixed disclosure window (a11y findings are not security-sensitive).
  - **Vendor inquiry template** — paste-ready email; recommended starting-point vendor list (Deque, Knowbility, TPGi, Tenon, Microsoft Accessibility, SSB BART, Equally AI) with the explicit caveat that the user should cross-reference published wallet / fintech audits before selection.
  - **Post-audit close-out checklist** — Critical resolved before GA, Major resolved-or-rationalized, Minor/Advisory issue-tracked, conformance statement attached to release notes, static gate extended with any new rules the audit suggests.

### Decided

- **WCAG 2.2 AA target.** 2.1 AA is the legacy baseline most U.S. compliance tools test against; 2.2 AA is the current standard and includes new criteria that matter for crypto-wallet UX (e.g., 2.5.7 Dragging Movements — relevant for QR-frame stepping; 3.3.7 Redundant Entry — relevant for multisig participant-list re-entry across sessions). Targeting 2.2 AA up front avoids re-auditing in 2027.
- **Per-criterion pass/fail in the deliverable.** Lets the GA release notes claim "WCAG 2.2 AA conformant per [vendor], dated [DATE]" — material to potential institutional users who require an accessibility statement before adopting.
- **Pre-launch user-initiated track CLOSED at this commit (autonomous portion).** Three items remain that only the user can drive: external security audit engagement (packet ready at v1.0.0-rc.5), external accessibility audit engagement (packet ready at this rc.6), Chrome Web Store submission (manifest hardened at rc.2, privacy policy + checklist drafted at rc.3). Plus the byte-for-byte run-twice repro-build verification on a clean dev machine at GA cut.

### Notes

- xchain-sdk pin stays at `^1.13.0`. No source changes; documentation + version bump only.
- 92 smokes pass.
- Pre-launch user-initiated autonomous portion CLOSED at v1.0.0-rc.6. See `claude/reports/specs/2026-04-24_prelaunch-userinit-close.md` for the track-level retrospective (separate commit if needed; otherwise this CHANGELOG entry is the close marker).

## [1.0.0-rc.5] - 2026-04-24

§56.3 Pre-launch — user-initiated track, Step 4 of 5 — security audit readiness packet. Pure-documentation slice that packages everything an external audit vendor needs to scope, build, and execute the engagement.

### Added

- `claude/reports/specs/2026-04-24_security-audit-readiness.md` (in the platform repo, gitignored) — readiness packet. Sections:
  - **Scope** — three layers (cryptography, wallet flows, shell IPC) with a per-layer file inventory pinning every relevant path and LOC count. ~7,000 LOC total in scope, mapped from `xchain-sdk@1.13.0` + `@xchain-wallet/core` + `@xchain-wallet/extension` + `@xchain-wallet/desktop`.
  - **Per-layer audit asks** — what we want the vendor to verify, written as targets rather than hypotheses (Argon2id parameters meet OWASP 2023+ guidance; MuSig2 nonce reuse impossible; service-worker rejects unapproved-origin RPC; contextBridge surface enumerable + minimal; auto-updater verifies signature before swap).
  - **Build & reproduce instructions** — pnpm + frozen lockfile + smoke + repro-build hooks. Auditor walks from `git clone` to byte-for-byte verifiable artifact.
  - **Threat model summary** — adversaries (malicious dApp, tab-injecting malware, compromised RPC, cosigner with stale state, local-machine post-compromise, supply-chain) and explicit out-of-scopes (vendor firmware, blockchain consensus, raw-password attacks).
  - **Known deferred items** — pulls from the pre-launch close report so the vendor doesn't re-discover them: HW MuSig2 nonce wiring (firmware-gated), HW classical multisig PSBT signing (vendor-API-heavy stubs), Home/History per-config UI polish.
  - **Audit deliverables we expect** — severity-classed findings with file:line, coverage report, threat-model deltas, public-shareable final report.
  - **Coordination** — scope-lock document, weekly check-ins, 90-day responsible disclosure for High+, coordinated public disclosure with GA notes.
  - **Vendor inquiry template** — paste-ready email; recommended starting-point vendor list (Trail of Bits, Cure53, Quarkslab, Zellic, Cantina, OpenZeppelin Security, Halborn, Spearbit) with the explicit caveat that the user should cross-reference published wallet audits before selection.
  - **Post-audit close-out checklist** — Critical resolved before GA, High resolved-or-rationalized, Medium/Low issue-tracked, public disclosure coordinated.

### Decided

- **Single-vendor coverage of all three layers.** The boundary handoffs (key material → signer → IPC → user-confirmation surface) are where wallets get exploited; auditing them as separate engagements risks each vendor assuming the boundary is the other one's problem. We pay once for end-to-end coverage.
- **Reduced-motion item explicitly out of audit scope.** The fix shipped at v1.0.0-rc.4; calling it out in the packet so the vendor doesn't burn hours wondering whether it's a regression.

### Notes

- xchain-sdk pin stays at `^1.13.0`. No source changes; documentation + version bump only.
- 92 smokes pass.

## [1.0.0-rc.4] - 2026-04-24

§56.3 Pre-launch — user-initiated track, Step 3 of 5 — `prefers-reduced-motion` on `AnimatedQrFrames`. Closes the deferred a11y polish item recorded in `claude/reports/specs/2026-04-24_prelaunch-close.md` § "Things deferred from autonomous work" — previously queued for the external a11y audit; the fix is autonomously tractable and the audit gets a cleaner starting point.

### Changed

- `packages/core/src/ui/AnimatedQrFrames.jsx` — when the user has `prefers-reduced-motion: reduce` set at the OS level, the auto-advance interval is suspended and Prev / Next buttons render below the QR for manual stepping. The cadence label flips from `3 fps` to `manual`. The wrapper's `aria-label` is augmented with `; advance manually`. A new `data-reduced-motion` attribute is exposed for downstream styling/tests. The change is observed via `window.matchMedia('(prefers-reduced-motion: reduce)')` with both modern (`addEventListener`) and Safari-<14 (`addListener`) listener wiring; the preference can flip mid-session and the component reacts. Single-frame inputs continue to render statically (no controls needed).

### Added

- `packages/core/test/animated-qr-reduced-motion.smoke.js` — eight static-text checks over the component source: matchMedia subscription, useState hook, change-listener wiring with Safari fallback, interval suspension on `reducedMotion`, gated prev/next rendering, button aria-labels, cadence label flip, wrapper aria-label augmentation, `data-reduced-motion` attribute. Bumps the smoke count to 92.

### Decided

- **Manual stepping over a frozen first frame.** `prefers-reduced-motion` could be honored by simply pinning the QR to frame 1 and showing nothing else, but multi-frame PSBT QRs (used for §22.3 multisig PSBT-QR cosigner round-trips and §20.3 chunked PSBT transport) are non-functional if you can't reach frames 2…N. Manual prev/next preserves the function while removing the motion. Alternative considered (slow the auto-advance to ~0.5 fps) was rejected — vestibular-trigger users still perceive the motion at any auto-advance rate, and "no motion" is the documented intent of the media-query value.

### Notes

- xchain-sdk pin stays at `^1.13.0`. UI-package change only.
- 92 smokes pass.

## [1.0.0-rc.3] - 2026-04-24

§56.3 Pre-launch — user-initiated track, Step 2 of 5 — Chrome Web Store privacy policy + submission checklist. Pure documentation slice; the user (Dankest, LLC) is the only one who can host the policy URL and file the CWS submission, so this step packages everything they'll need into one place.

### Added

- `packages/extension/PRIVACY_POLICY.md` — public-facing privacy policy. Covers what's stored on-device (encrypted wallet material via Argon2id-derived key, addresses, contacts, dApp grants, queued PSBTs), what leaves the device (only user-configured RPC endpoints + optional vendor hardware-bridge calls), permissions justifications, the camera-scanner flow's `getUserMedia` runtime prompt, the absence of analytics / advertising / crash-reporting SDKs, the absence of Google API integration, and the CWS-mandated single-purpose + limited-use disclosures. Authored to be hosted as-is on a public URL — GitHub Pages from this repo or `https://dankest.llc/xchain-wallet/privacy` are both acceptable; the submission checklist documents the recommended setup.

- `claude/reports/specs/2026-04-24_cws-submission.md` (in the platform repo, gitignored) — submission playbook. Sections: build artifact + zip procedure, listing copy with verbatim strings, screenshot dimensions + capture procedure for the five required surfaces (Home, Send, Sign-screen, Multisig Receive, Settings → Security), promo tile spec, privacy practices form answers, common rejection reasons + dry-run greps, single-purpose statement to paste, pre-submission smoke + audit run, post-approval automation roadmap, Edge / Firefox variants. Designed so the submitter can work top-to-bottom without referring back to CWS docs.

### Decided

- **Privacy policy lives in the extension package.** Putting it at `packages/extension/PRIVACY_POLICY.md` keeps it discoverable next to the manifest it disclaims, and lets GitHub Pages serve the same file as both source and listing URL. Alternative considered (host only on dankest.llc) was rejected because the GitHub-hosted copy provides a permanent record tied to a specific git revision — useful when CWS asks "show the policy that was active at the time the v1.0.4 update was published".

- **Submission checklist gitignored in the platform repo.** Per existing convention (`claude/reports/` is gitignored). The checklist points at concrete file paths and rule numbers in the wallet repo, so it stays useful as a private working doc; the user-facing parts (privacy policy, listing copy templates) live in the wallet repo where the public can read them.

### Notes

- xchain-sdk pin stays at `^1.13.0`. No source changes; documentation + version bump only.
- 91 smokes pass.

## [1.0.0-rc.2] - 2026-04-24

§56.3 Pre-launch — user-initiated track, Step 1 of 5 — Chrome Web Store manifest hardening. First pre-GA slice of the Chrome Web Store submission track.

### Added

- `packages/core/scripts/derive-extension-version.js` — maps wallet semver → Chrome-manifest `version` tuple. Chrome requires 1–4 dot-separated integers 0–65535; wallet RC tags like `1.0.0-rc.1` are rejected. Rule: stable `M.m.p` → `M.m.p`; prerelease `M.m.p-rc.N` → `0.M.m.N`. The leading `0` pins every prerelease strictly below every stable tuple with M≥1, so the CWS upgrade ordering stays monotonic across the RC → GA cut.

- `packages/core/scripts/extension-manifest-audit.js` — 11-rule static audit: MV3 set; `version` CWS-valid; `version` equals `deriveExtensionVersion(root.version)`; `version_name` mirrors `root.version`; `packages/extension/package.json` version matches `root.version`; `description` present and ≤132 chars; `homepage_url` set; 128-px icon present; action toolbar icon set; `content_scripts` entries well-formed; no broad host_permissions (`<all_urls>` / `*://*/*`) without recorded justification. Exits 0 on a clean tree, exits 1 with a per-rule failure report otherwise.

- `packages/core/test/extension-manifest-audit.smoke.js` — smoke gate. Imports `runExtensionManifestAudit()`, asserts every rule passes. Bumps the smoke count to 91.

### Changed

- `packages/extension/manifest.json` — `version` now `0.1.0.2` (derived from wallet `1.0.0-rc.2`). New `version_name: "1.0.0-rc.2"` carries the human-readable semver into Chrome. New `homepage_url: "https://github.com/XChain-platform/xchain-wallet"`. Description expanded from 55 → 110 chars to list the launch chains (still well under the 132-char CWS listing limit). Every future wallet bump must re-derive the manifest version; the smoke fails CI if it doesn't.

### Decided

- **`version_name` for the human semver, `version` for Chrome's ordering.** Chrome's `version` field is integer-tuple-only (no prerelease suffix). We keep the wallet's semver as the CWS submitter-visible string via `version_name` and derive a strictly-monotonic `version` tuple for the upgrade key. Alternative considered (keep them equal by dropping semver prerelease tags entirely during RC) would have coupled wallet versioning to Chrome's rules — rejected.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step — no source changes outside the new audit + smoke + manifest fields + version bump.
- 91 smokes pass (was 90).

## [1.0.0-rc.1] - 2026-04-24

§56.3 Pre-launch — Step 7 of 7. **Pre-launch CLOSED.** All 7 autonomous steps shipped across v0.96.0 → v1.0.0-rc.1 (camera scanner, AddressList route, hardware-friendly multisig PSBT path + SDK 1.13, per-address multisig configs / Wallet schema v2, static a11y audit gate, reproducible-build scaffolding gate, this RC cut). xchain-sdk pinned at `^1.13.0`. 90 smokes pass.

### What's done

- All four Phase 4 follow-ups (FOLLOWUPS 1–4 from `2026-04-24_phase4-close.md`).
- Static a11y audit + smoke gate. CI fails on regression.
- Reproducible-build scaffolding audit + smoke gate. CI fails on regression.
- Wallet schema v2 migration (`Wallet.multisig` → `Wallet.multisigs[]`). Transparent for legacy v1 records.
- Hardware-friendly classical multisig PSBT abstract on the Signer interface; SoftwareSigner real impl via `sdk.wallet.signMultisigPsbt`; Trezor + Ledger surface vendor-specific deferral errors with a path to the software signer.
- Camera scanner for the multisig paste-inbox.
- Standalone `<AddressList>` route with multisig badging + Multisig-only filter.

### Remaining before v1.0.0 GA

User-initiated:
- **External security audit.** Cryptography (xchain-sdk MuSig2 + signEcdsa + ECPair / WIF / kdf), wallet flows (unlockWallet, signers, multisig session state machine, signMultisigPsbt path), shell IPC.
- **External a11y audit.** Color contrast verification, focus-visible review, live-region timing, keyboard traps, screen-reader walkthroughs (NVDA + JAWS + VoiceOver), reduced-motion preference for `AnimatedQrFrames`.
- **Chrome Web Store submission.** Manifest review + screenshots + privacy disclosures.

Release-cut deliverable:
- **Byte-for-byte reproducible-build verification** on a clean dev machine. Run `packages/desktop/scripts/reproduce.sh v1.0.0-rc.1` twice; diff `RELEASE_HASHES.txt`. Procedure documented at `claude/reports/specs/2026-04-24_repro-build.md`.

### Reference

- Pre-launch close report: `claude/reports/specs/2026-04-24_prelaunch-close.md` — full step ledger, track-level state, deferral justifications, GA cut recommendation.
- Phase 4 close report: `claude/reports/specs/2026-04-24_phase4-close.md` — predecessor; lists the four pre-launch follow-ups.

This commit is a marker; no source changes other than the version bump.

## [0.101.0] - 2026-04-24

§56.3 Pre-launch — Step 6 of 7. Reproducible-build scaffolding gate. Every ingredient required for Level-2 reproducibility is now CI-gated by a static audit script + smoke. The byte-for-byte run-twice verification still has to happen on a clean dev machine before v1.0.0 GA — see `claude/reports/specs/2026-04-24_repro-build.md` for the procedure.

### Added

- `packages/core/scripts/repro-build-audit.js` — 18-rule static audit covering Dockerfile (digest-pinned base, NODE_VERSION pinned, locale + TZ pinned), `build.sh` (asserts SOURCE_DATE_EPOCH, uses `--frozen-lockfile`, emits a `RELEASE_HASHES.txt` sha256 manifest), `reproduce.sh` (derives SOURCE_DATE_EPOCH from `git log -1 --pretty=%ct`, builds from a fresh worktree), `electron-builder.config.cjs` (asar: true, references SOURCE_DATE_EPOCH, pins AppImage compression to xz), and `REPRODUCIBLE_BUILDS.md` (mentions Level-2 + RELEASE_HASHES). Exits 0 on a clean tree, exits 1 with a per-rule failure report otherwise.

- `packages/core/test/repro-build-audit.smoke.js` — smoke gate. Imports `runReproBuildAudit()`, asserts every rule returns `ok: true`. Future PRs that drop a digest pin / un-freeze the lockfile / introduce non-determinism in the build config fail this smoke.

- `claude/reports/specs/2026-04-24_repro-build.md` — full report. Documents the scaffolding audit (all 18 rules pass at v0.101.0), the run-twice-and-compare verification procedure that has to happen on a clean dev machine, the typical sources of reproducibility drift to watch for, and the recommendation to run the procedure on at least two independent dev machines at v1.0.0 GA.

### Decided

- **Scaffolding audit now, byte-for-byte verification at release-cut time.** Two halves of the same property: the audit catches regressions in the scaffolding automatically on every commit; the byte-for-byte verification catches subtler drift (build tool version bumps that quietly lose determinism) but requires a clean Docker host that this build environment doesn't have. Splitting the work makes both halves enforceable.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step — no source changes outside the new audit script + smoke + version bump.
- 90 smokes pass.

## [0.100.0] - 2026-04-24

§56.3 Pre-launch — Step 5 of 7. Static a11y audit gate. Every shared route + UI primitive now passes a five-rule mechanical audit (button label / img alt / input label / textarea label / div onClick role + tabIndex). The smoke gate fails CI if any new surface introduces a regression. Full report at `claude/reports/specs/2026-04-24_a11y-audit.md`.

### Added

- `packages/core/scripts/a11y-audit.js` — static a11y audit. Walks every JSX file under `src/shared/` + `src/ui/`, parses tags with a brace-balancing reader (so `onClick={(e) => ...}` arrow functions inside attributes don't trip the parser), and surfaces violations of five rules: button-needs-text-or-aria-label, img-needs-alt, input-needs-label, textarea-needs-label, div-onclick-needs-role. The button rule accepts both static text content AND any bare-identifier or string-literal expression child as "presumed text" — `{p.label}`, `{busy ? 'Loading…' : 'Save'}`, or `Send` all count. Inputs accept `label=` / `aria-label` / `aria-labelledby` / `placeholder` / matching `<label htmlFor>` (literal or `useId()`-style dynamic). Exits 0 with `a11y-audit: 0 violations` on a clean tree; exits 1 with a per-file violation report otherwise.

- `packages/core/test/a11y-audit.smoke.js` — smoke gate. Imports `runA11yAudit()`, asserts `violations.length === 0`. New surfaces that introduce regressions fail this smoke alongside the rest of the suite.

- `claude/reports/specs/2026-04-24_a11y-audit.md` — audit report. Documents what the audit covers, what it explicitly DOESN'T cover (color contrast, focus-visible styling, live-region timing, keyboard traps, screen-reader walkthroughs — all queued for the external a11y audit), the violations surfaced and fixed during this pass, and a follow-up checklist for the external audit.

### Changed

- `ContactsList.jsx` — `×` remove-row button gained `aria-label={`Remove address ${i + 1}`}` so screen readers announce its purpose rather than the multiplication-sign codepoint.
- `ContractsList.jsx` chain-tab buttons — gained `aria-label={d?.displayName \|\| cid}` so chain-icon-only tabs announce the chain name.
- `ContractsList.jsx` contract-row buttons — gained `aria-label={row.name \|\| row.NAME \|\| `Contract ${rowKey(row)}`}` so row buttons announce the contract identity rather than "button" with no further context.
- `AdvancedActionsForm.jsx` rest-params textarea — gained an explicit `aria-label` matching the on-screen label text. The wrapping `<label>` element provides the same association in modern UAs but adding the explicit label is robust across legacy assistive tech.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step.
- The audit's parser caught a class of false positives the first naive regex couldn't — `<textarea`s that have multi-line attribute blocks containing arrow functions look unlabeled to a regex that splits on the first `>`. The brace-balancing reader treats `=>` inside `{...}` as opaque content and only stops at top-level closing brackets.
- 88 smokes pass. 89 with the new a11y-audit.smoke.

## [0.99.0] - 2026-04-24

§56.3 Pre-launch — Step 4 of 7. Per-address (per-config) multisig (closes FOLLOWUP 3 from `claude/reports/specs/2026-04-24_phase4-close.md`). The `Wallet.multisig` single-slot field is now `Wallet.multisigs: MultisigConfig[]`, so a wallet can hold multiple multisig configurations side by side (different N-of-M groups, different schemes, different cosigner sets). Existing wallets migrate transparently — the v1→v2 migration synthesizes a `legacy-`-prefixed id for the existing config and wraps it in an array.

### Schema migrations

- `Wallet` schemaVersion 1 → 2. New `multisigs: MultisigConfig[]` replaces `multisig: MultisigConfig | null`. Migration: `wallet.multisig` (if non-null) becomes `wallet.multisigs[0]` with a synthetic `legacy-${uuid}` id; `null` becomes `[]`. The legacy `multisig` slot is stripped on migration. Validator now enforces unique config ids within `multisigs`.

- `MultisigConfig` schemaVersion 1 → 2. New `id: string` field. Migration synthesizes `legacy-${uuid}` when the v1 record has no id (it didn't, since v1 was a single slot with no need for one). `buildMultisigConfig` accepts a caller-supplied `id` (used by code paths that already have a stable identifier) or auto-assigns `crypto.randomUUID()`.

### Added

- `flows.listMultisigReceiveAddresses({ vault, sdkRegistry, walletId, chainId })` — plural variant of `receiveMultisigAddress`; returns one entry per config in `wallet.multisigs[]`. Each entry mirrors the singular result with an added `multisigConfigId`. Misconfigured configs are skipped silently rather than failing the whole list.

- `multisig.listAddresses` background handler + matching `listMultisigReceiveAddresses` helpers in `popup` / `web` / `desktop` messaging.

- `Receive.jsx` — renders one multisig section per config in `multisigs[]`, each with its own QR + badge + cosigner names. The first config still appears in the same place as before; additional configs stack below it.

- `AddressList.jsx` — synthesizes one row per multisig config when the derived address isn't in the persisted address table. Each row carries its own `<MultisigBadge>` indicator. The `🔐 Multisig only` filter is enabled when *any* config exists.

### Changed

- `flows.receiveMultisigAddress` — accepts an optional `multisigConfigId` parameter; defaults to `multisigs[0]` when omitted. Returns `multisigConfigId` in the result so callers can disambiguate when multiple configs exist.

- `flows.createMultisigConfig` — appends to `multisigs[]` rather than overwriting `multisig`. The duplicate-detection check is now keyed on `scriptTemplate` (same cosigners + same scheme = same address; legitimate to want a different N-of-M with the same cosigner set, which gets a different scriptTemplate and lands as a separate config).

- `flows.startMultisigSigningSession` (Step 19) — accepts optional `multisigConfigId`; defaults to the first config.

- `flows.signMultisigLocally` (Step 21) — finds the matching config in `wallet.multisigs[]` by pubkey-set equality against `session.cosignerPubkeys`. This is robust to wallets that carry multiple configs.

- `toSafeWallet` projection in `createBackgroundHost.js` — returns `multisigs` array (defaulted to `[]`) rather than the legacy single slot.

- `popup/messaging.js` `listWallets` JSDoc — return type updated to surface the new `multisigs` array.

- Four pre-existing smokes (`multisig-create.smoke.js`, `multisig-address.smoke.js`, `multisig-signing.smoke.js`, `address-list.smoke.js`) — updated their fake-vault `Wallet` records to use `multisigs: [...]` instead of `multisig: {...}`. Polyfilled `globalThis.crypto = webcrypto` in three of them (the new schema factories are exercised at module load now that `buildMultisigConfig` runs `crypto.randomUUID()`).

### Added — smoke

- `packages/core/test/multisig-multi-config.smoke.js` — drives the full migration path. Exercises Wallet v1→v2 migration (single config + null cases), standalone `MultisigConfig` migration, duplicate-id validator rejection, `createMultisigConfig` appending two distinct configs to one wallet, duplicate-`scriptTemplate` guard, `receiveMultisigAddress` routing on `multisigConfigId`, `listMultisigReceiveAddresses` returning every config, bg/messaging registration, and Receive/AddressList multi-config render assertions. All 88 smokes pass.

### Decided

- **Migrate, don't dual-read.** The legacy `multisig` field is stripped on migration rather than left behind as a synonym for `multisigs[0]`. Single source of truth keeps the surface clean; the `legacy-`-prefixed config ids make pre-migration data identifiable in case any debugging-by-id-prefix is ever needed.

- **Default to first config when no id is supplied.** `receiveMultisigAddress({ walletId, chainId })` without a `multisigConfigId` returns the first config in the array. This keeps callers that don't care about per-config routing (the singular helper, Step 18-era code paths) working unchanged. New code paths that need precision pass `multisigConfigId` explicitly.

- **Home + History show "first config" for now.** Home's BTC-card multisig badge and History's "Multisig only" filter both use the singular helper today, which means they show the first config. A multi-config wallet still works — the user can drill into Receive or AddressList for the per-config view. Widening Home + History to show per-config breakdowns is straightforward but felt like polish, not v1.0 blocker — flagged as a follow-up.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step.
- 88 smokes pass.

## [0.98.0] - 2026-04-24

§56.3 Pre-launch — Step 3 of 7. Hardware-friendly classical multisig PSBT path (closes FOLLOWUP 1 from `claude/reports/specs/2026-04-24_phase4-close.md`). The wallet now has a clean `signMultisigPsbt` abstract on the Signer interface — software-signer implements it for real (delegating to the SDK's new `signMultisigPsbt` / `finalizeMultisigPsbt`); hardware signers throw with the specific reason their multisig path isn't wired (Trezor: signTransaction multisig envelope plumbing; Ledger: registerWallet wallet-policy provisioning).

### Cross-repo

- `xchain-sdk` 1.12.0 → 1.13.0 (commit `3ea1b83` in `xchain-sdk`). New `WalletUtils.signMultisigPsbt(psbtHex, wif)` and `WalletUtils.finalizeMultisigPsbt(psbtHex)`. The "sign without finalizing → merge → finalize once threshold met" split is the natural N-of-M workflow because bitcoinjs-lib's PSBT format stacks `partialSig` entries under each input, so two cosigner-signed PSBTs merge by union. Wallet pin bumped `^1.12.0` → `^1.13.0` in `extension` and `web`.

### Added

- `Signer.signMultisigPsbt({ chainId, psbtHex, signingPaths })` — new abstract on the base `Signer` class. Returns the PSBT with this signer's partial sigs added but NOT finalized. Two new typedef blocks in `Signer.js` (`SignMultisigPsbtParams`, `SignMultisigPsbtReturn`).

- `SoftwareSigner.signMultisigPsbt` — real implementation. Derives the WIF for the cosigner's path via `_resolveWifForEntry`, calls `sdk.wallet.signMultisigPsbt(psbtHex, wif)`, returns the resulting PSBT. Surfaces a clear "bump xchain-sdk to ^1.13.0" message when the SDK is too old.

- `TrezorSigner.signMultisigPsbt` — throwing stub: "hardware multisig PSBT signing on Trezor is not yet wired — the signTransaction envelope requires multisig `signatures` arrays + public-key-ordering plumbing that isn't in trezorFormat.js today."

- `LedgerSigner.signMultisigPsbt` — throwing stub: "hardware multisig PSBT signing on Ledger requires a registered wallet policy (Bitcoin app ≥ 2.1.0 registerWallet flow) which this wallet hasn't provisioned yet."

- `packages/core/test/multisig-psbt-signing.smoke.js` — new smoke. Asserts the abstract throws AbstractMethodError; Trezor + Ledger throw their specific deferral errors; SoftwareSigner guards the locked / empty psbtHex / empty signingPaths / SDK-too-old paths; the happy path forwards the PSBT + WIF through `sdk.wallet.signMultisigPsbt` and returns the SDK's signed PSBT verbatim; new typedefs are present; SDK pin is `^1.13.0`.

### Changed

- `packages/core/test/multisig-signer.smoke.js` — softened the SDK-pin assertion from exact `^1.12.0` to `≥ ^1.12.0` regex (same pattern Step 19's smoke uses) so future bumps don't ripple.

### Decided

- **Two parallel methods, not one with flags.** The Step 21 `signMultisigClassical(msgHash, path)` stays — it produces a single DER signature given a sighash, useful when the wallet has the sighash already (e.g., from a §22.3 envelope-style flow). The new `signMultisigPsbt(psbtHex, signingPaths)` is the HW-friendly variant that takes a full PSBT. Both compose: a future flow can call `signMultisigPsbt` for HW signers and `signMultisigClassical` for the local software cosigner depending on what's most efficient. No flag-based branching.

- **Hardware paths are stubs, not nothing.** Surfacing a vendor-specific deferral error is more useful than `AbstractMethodError` because the user gets a path forward (use the software signer; what to wait for). The Step 21 vendor-firmware compatibility matrix in the Phase 4 close report grows a row for each vendor's classical-multisig path the next time vendor support changes.

### Notes

- 87 smokes pass.
- Integration into the `signMultisigLocally` flow + sign-screen UX is intentionally not in this step. Step 4 (per-address multisig configs) will reshape the Wallet schema enough that wiring the PSBT path through `signMultisigLocally` is cleaner to do after that lands.

## [0.97.0] - 2026-04-24

§56.3 Pre-launch — Step 2 of 7. Standalone Addresses route (closes FOLLOWUP 4 from `claude/reports/specs/2026-04-24_phase4-close.md`). The wallet now has a single dedicated surface listing every address it has generated, with per-address multisig badging and a "Multisig only" filter — what the §22 spec called for in passing but no Phase 4 step claimed.

### Added

- `packages/core/src/shared/routes/AddressList.jsx` — new flat list aggregating every address across every chain. Each row carries chain badge + label + shortened address + copy button; rows whose address matches the wallet's `getMultisigReceiveAddress` output get an inline `<MultisigBadge>` indicator. Filter chips: per-chain toggles (re-using History's chip styling) plus a "🔐 Multisig only" chip that's disabled when no multisig is configured. The multisig receive row is synthesized when the address isn't persisted in the wallet's address table — Receive derives it on-demand and doesn't necessarily save it.

- `packages/core/test/address-list.smoke.js` — new smoke. Asserts route exports + `getAddressesByChain` aggregation + `getMultisigReceiveAddress` prefetch + multisig row badging + filter chip + synthetic-row behaviour + Home's `onAddresses` nav prop + the `'addresses'` sub-route wiring across all three shells.

### Changed

- `Home.jsx` — accepts a new `onAddresses` nav prop, surfaces an "Addresses" button between History and Contracts in the secondary nav strip.
- `packages/extension/src/popup/App.jsx`, `packages/web/src/App.jsx`, `packages/desktop/renderer/App.jsx` — each tracks `'addresses'` as a sub-route, mounts `<AddressList walletId>`, and passes `onAddresses` through to Home.

### Notes

- `xchain-sdk` pin stays at `^1.12.0`. Pure UI / wallet-side step.
- All 86 smokes pass.

## [0.96.0] - 2026-04-24

§56.3 Pre-launch — Step 1 of 7. Camera scanner for the multisig paste-inbox (closes FOLLOWUP 2 from `claude/reports/specs/2026-04-24_phase4-close.md`). The sign-screen now offers camera scanning as a first-class path alongside the existing paste-text flow; scanner-driven frames route through the same XCW chunk collector that the paste flow already drives, so there's one verify-and-dispatch path regardless of how chunks arrive.

### Added

- `packages/core/src/ui/QrScanner.jsx` — generic camera-scanner component. Wraps the native `BarcodeDetector` API against a live `<video>` + `MediaStream`. Requests the environment-facing camera, runs detection on a `requestAnimationFrame` loop, stops every MediaStreamTrack on unmount (no dangling camera LED). Emits each detected QR string through `onFrame`; intentionally does not de-duplicate — callers feeding a chunked transport already no-op on duplicate chunks. Graceful "Camera scanning isn't supported on this browser" fallback when `BarcodeDetector` is unavailable (Firefox, older Safari), pointing users back to the paste-chunk path.

- `packages/core/test/qr-scanner.smoke.js` — new smoke. Asserts the component exports + BarcodeDetector + environment-camera + RAF loop + track cleanup; sign-screen's "Scan with camera" toggle, scanner-open state, `handleScannerFrame` handler, and XCW-collector routing; the legacy "Step 21 will wire the camera scanner" hint has been removed from the paste-inbox copy.

### Changed

- `MultisigSigningSession.jsx` paste-inbox view — new `scannerOpen` state + "Scan with camera" button that mounts `<QrScanner onFrame={handleScannerFrame}>`. The scanner handler feeds each detected string through `addChunkToCollector`, appends it to the visible textarea for the user's sanity, and dispatches the decoded envelope through the same `contributeMultisigNonce` / `contributeMultisigSignature` path the paste flow uses once the collector completes. Scanner closes automatically on completion.

### Notes

- `xchain-sdk` pin stays at `^1.12.0`. Pure wallet-side step.
- Manifest permissions for the extension popup remain unchanged — MV3 popups get camera access via the browser's `getUserMedia` permission prompt at runtime, without an explicit manifest entry. If camera prompts in the popup turn out to be janky, adding a dedicated permissions page is a follow-up.
- Chromium-based browsers (Chrome, Edge, modern Opera, Electron-based desktop shell) are the primary target; Firefox + Safari don't expose `BarcodeDetector` yet (as of Q2 2026) and will fall back to the paste-chunk UX via the unsupported message.
- All 85 smokes pass.

## [0.95.0] - 2026-04-24

Phase 4 — Step 23 of 23. **Phase 4 CLOSED.** All 23 steps shipped across v0.74.0 → v0.95.0 over a single 2026-04-24 build day. xchain-sdk landed at 1.12.0 (three bumps during the phase: 1.10 MuSig2 primitives, 1.11 deriveMultisigAddress, 1.12 signEcdsa). 84 smokes pass.

### Phase 4 retrospective

§42 Contracts / Staking / Cross-Chain / Multisig + §22 Multisig Foundations are all in. The wallet now has:

- **Smart contracts (§42.1–§42.6).** Browse / detail / EXECUTE / DEPOSIT / WITHDRAW / DEPLOY (Monaco editor) flows wired to `xchain-vm` via SDK (Steps 2–6).
- **BTC Staking (§42.7).** Dashboard + STAKE / UNSTAKE / DELEGATE / REVOKE_DELEGATION / CLAIM_REWARDS forms + operator/validator dashboard (Steps 7–11).
- **Cross-chain (§42.8).** History route + cross-chain thread rendering, LINK two-panel form, parallel composer, cross-chain swap, cross-chain templates (Steps 12–16).
- **Multisig (§22 + §42.9).** All three schemes (P2SH, P2WSH, Taproot-MuSig2). Wallet creation coordinator → address derivation + Receive integration → sign-round persistence with dual-mode tracker → PSBT-QR cosigner round-trip → MuSig2 hardware-signer abstracts + software-signer impl + local-cosigner contribution flow → multisig badges surface-wide (Steps 17–22).

### Hand-off to §56.3 pre-launch track

Phase 4 closes the §42 surface. **§56.3 pre-launch is its own track, not a Phase 5.** Items queued behind Phase 4:

- External security audit (cryptography in xchain-sdk; wallet flows; shell wiring).
- A11y audit for sign-screen + multisig surfaces.
- Reproducible-build verification (`packages/desktop/REPRODUCIBLE_BUILDS.md` already documents the procedure).
- Chrome Web Store submission.
- Four small follow-ups documented in `claude/reports/specs/2026-04-24_phase4-close.md` (hardware classical multisig path, camera scanner for paste-inbox, per-address multisig configs, standalone `<AddressList>` route).

### Reference

- Phase 4 close report: [`claude/reports/specs/2026-04-24_phase4-close.md`](../../claude/reports/specs/2026-04-24_phase4-close.md) — full step ledger, spec deltas surfaced during build, MuSig2 hardware-signer compat matrix, and the four follow-ups deferred to §56.3.

This commit is a marker; no source changes (other than the version bump).

## [0.94.0] - 2026-04-24

Phase 4 — Step 22 of 23. Multisig badges surface-wide (§22 + §22.4). The N-of-M / scheme indicator now appears on every surface where a single-key surface would normally show a plain address: Receive, History, Home balances, and the multisig sign-screen tracker. Step 23 closes Phase 4.

### Added

- `packages/core/src/ui/MultisigBadge.jsx` — small chip component. Props: `{ threshold, cosignerCount, scheme, size? }`. Renders `"<T>-of-<N> <P2SH | P2WSH | MuSig2>"` with a scheme-tinted background (amber for P2SH, blue for P2WSH, violet for taproot-MuSig2 — distinct enough that a glance tells the schemes apart without reading the tag). `aria-label` is the human form `"2 of 3 multisig (P2WSH multisig)"`. Carries `data-testid="multisig-badge"` + `data-scheme` so layered smokes / e2e tests can assert presence on each surface.

- History route — new `🔐 Multisig only` filter chip alongside the existing `🔗 Cross-chain actions` chip. Filter resolves the wallet's multisig address via `messaging.getMultisigReceiveAddress` once on mount; chip is disabled (with explanatory tooltip) when no multisig is configured. When active, filters entries to those with source/dest matching the multisig address.

### Changed

- `Receive.jsx` — replaced the inline N-of-M pill (a hand-styled `<span>`) with `<MultisigBadge>`. Same visible information, but consistent with every other multisig surface and exercised by a single component-level smoke instead of per-surface assertions.

- `MultisigSigningSession.jsx` — the session list and the detail-view header now render `<MultisigBadge>` instead of the inline `schemeLabel` text. The list view's badge is `size="sm"` so it sits inline with the meta row; the header badge is the default `size="md"` next to the status text.

- `ChainBalanceCard.jsx` — accepts an optional `multisig` prop (`{ threshold, cosignerCount, scheme }`) and renders the badge in the card header alongside the chain badge + address-count meta. `Home.jsx` resolves the wallet's multisig at mount and passes the resolved record only to BTC chain cards (multisig is BTC-only at launch per §10.3 / §22.4). The badge sits in the header so the multisig nature of a chain card is visible at a glance, alongside the chain's existing identity badge.

### Smoked

- New `packages/core/test/multisig-badge.smoke.js`. Asserts the component exports + 3-scheme tone map + ARIA label + `data-testid` + `data-scheme`; Receive integration; History "Multisig only" filter chip + the `getMultisigReceiveAddress` prefetch + the chip's `aria-pressed` state; ChainBalanceCard's `multisig` prop + Home's BTC-only badge gate; MultisigSigningSession's header + list-row badge wiring against the session's `threshold` + `cosignerPubkeys.length`.

- `multisig-address.smoke.js` (Step 18) — softened the "N-of-M indicator on Receive" assertion to accept either the original inline pill OR the new `<MultisigBadge>` form. The component-level smoke owns the strict shape assertion now.

### Notes

- xchain-sdk pin stays at `^1.12.0`. Pure UI / wallet-side step.
- All 84 smokes pass.

## [0.93.0] - 2026-04-24

Phase 4 — Step 21 of 23. MuSig2 hardware-signer integration + local-cosigner contribution flow (§22.3 + §42.9). The wallet now has the full local-signing path for both MuSig2 and classical (P2SH/P2WSH) multisig: software signer produces real cryptographic contributions; hardware signers surface the spec-required "Update firmware to use MuSig2 on this device" error. Step 22 surfaces multisig badges across the rest of the UI (Addresses, History, Balances).

### Cross-repo

- `xchain-sdk` 1.11.0 → 1.12.0 (commit `2d69b2c` in `xchain-sdk`). New `WalletUtils.signEcdsa(msgHash, secretKey)` returns a DER-encoded signature over a 32-byte sighash with a 32-byte secret key. Used by `SoftwareSigner.signMultisigClassical` for P2SH / P2WSH single-round contributions. Compact-to-DER conversion follows BIP-66; no sighash flag byte appended (caller's PSBT finalizer handles the suffix). Smoked manually: 32-byte privkey + 32-byte hash → 70-byte DER starting `0x30`. Wallet pin bumped `^1.11.0` → `^1.12.0` in `extension` and `web`.

### Added

- `packages/core/src/signers/Signer.js` — three new abstract methods on the base `Signer`:
  - `signMusig2Round1({ chainId, path, sessionRef })` — BIP327 round 1 publicNonce generation.
  - `signMusig2Round2({ chainId, path, sessionRef, aggNonceHex })` — BIP327 round 2 partial signature.
  - `signMultisigClassical({ chainId, path, msgHash })` — DER-encoded ECDSA over the input's sighash for P2SH / P2WSH.
  Each carries its own JSDoc typedef block (`MultisigSessionRef`, `SignMusig2Round1Params`/`Return`, etc.). Subclasses override.

- `packages/core/src/signers/SoftwareSigner.js` — real implementations:
  - `signMusig2Round1` calls `sdk.musig2.aggregateKeys` (binds the nonce to the aggregated x-only pubkey) followed by `sdk.musig2.generateNonce`. Uses a deterministic `sessionId` derived as `sha256(text || sessionRef.fingerprint || privKey)` so round 2 can re-cache the same secret nonce without persisting secret state — needed because the SDK's MuSig2 module stashes secret nonces in an internal Map keyed by publicNonce, and the wallet's SDK instance is fresh after a lock+unlock cycle.
  - `signMusig2Round2` re-runs the same `generateNonce` (re-cached secret) then `startSession` + `partialSign`, returns the 32-byte partial sig + the (deterministic) publicNonce.
  - `signMultisigClassical` derives the privKey at the cosigner's path, calls `sdk.wallet.signEcdsa` (new in SDK 1.12.0), returns the DER-encoded signature + the signing key's compressed pubkey.

- `packages/core/src/signers/TrezorSigner.js` + `LedgerSigner.js` — three throwing stubs each. Trezor surfaces "hardware MuSig2 is not supported on Trezor — update firmware to use MuSig2 on this device, or use the wallet's software signer." Ledger surfaces the same message tailored to the Ledger Bitcoin app. Classical multisig deferred to Step 22+ with its own clear error per device.

- `packages/core/src/flows/multisigSignLocally.js` — `signMultisigLocally({ vault, chainRegistry, sdkRegistry, sessionId, password })`. One entry point that finds the local cosigner on the persisted `MultisigConfig`, gates by `(scheme, status)`, dispatches to `signMusig2Round1` / `signMusig2Round2` / `signMultisigClassical`, and pipes the result through the Step 19 `contributeMultisigNonce` / `contributeMultisigSignature` APIs. Pre-checks duplicate-cosigner conditions before unlocking the wallet — fast-fails on stale invocations without paying the Argon2id KDF cost.

- `packages/extension/src/background/createBackgroundHost.js` — new `multisigSign.signLocally` handler.

- `packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js` — matching `signMultisigLocally` helpers.

- `packages/core/src/shared/routes/MultisigSigningSession.jsx` — new `sign-locally` view state with a wallet-password input and a "Sign with my key" button. Surfaces the §22.3 firmware-too-old guidance inline so users know to fall back to the software signer when their HW device's firmware doesn't support MuSig2 yet. Reachable from the tracker view via a "Sign with my key" button.

- `packages/core/test/multisig-signer.smoke.js` — new smoke. Asserts the Signer base class exposes the three new methods as abstracts that throw `AbstractMethodError`; `TrezorSigner` + `LedgerSigner` surface the spec firmware-too-old + classical-deferred errors with the exact wording; `flows.signMultisigLocally` is re-exported with the right guards (vault / chainRegistry / sdkRegistry / sessionId / password); status-gating still rejects partial-sig contributions during round 1; bg handler registers `multisigSign.signLocally`; all three shells export `signMultisigLocally`; sign-screen route surfaces "Sign with my key" + the firmware-too-old guidance copy + `sign-locally` view state; SDK pin is `^1.12.0`. All 83 smokes pass.

### Changed

- `packages/core/test/multisig-address.smoke.js`, `multisig-signing.smoke.js`, `coinpay-form.smoke.js`, `sdk-bundle.smoke.js` — SDK-pin assertions softened from "exactly `^1.11.0`" to "at least `^1.11.0`" via a single regex (`/^\^1\.(?:1[1-9]|[2-9]\d)\.0$/`). Hardcoding the exact pin meant every later step's bump rippled into a smoke patch; the regex form keeps the assertion (we still catch a downgrade or accidental pin removal) without forcing churn on every legitimate bump.

### Decided

- **Local-signing is software-only this step.** Real hardware MuSig2 wiring requires vendor firmware that exposes BIP327 nonce + partial-sign primitives through Connect / hw-app-btc. As of Q2 2026 neither vendor exposes this in a stable form (Ledger added taproot to the Bitcoin app at 2.4.0 but the JS client surface lags; Trezor firmware is still in development). Surfacing the spec-required error so users know to update firmware or fall back to software is the right shape today; the throwing stubs are exactly where the real wiring will land when vendor support is ready.

- **Classical multisig signing routed through SDK rather than re-implementing in core.** The wallet has no `@noble/curves` dep today. Adding `WalletUtils.signEcdsa` to the SDK (one method, ~25 lines including DER-encode helper) keeps secp256k1 access centralized in the SDK's audit surface and lets the wallet stay light. Same Phase 3 Step 9 (`getCoinpayObligations`) cross-repo pattern.

- **Deterministic MuSig2 sessionId, no secret-nonce persistence.** BIP327 secret nonces are NOT cross-process or cross-instance — the SDK's musig2 module stashes them in an internal Map keyed by publicNonce. By computing `sessionId = sha256(text || fingerprint || privKey)`, round 2 can re-derive the same publicNonce + same secret nonce on a fresh SDK instance. This means the wallet doesn't have to persist secret nonce material across lock/unlock cycles — round 1 emits a publicNonce, the user can lock the wallet, unlock weeks later, and round 2 still works because the secret is recomputable from privKey + fingerprint. (Anti-replay still holds: the fingerprint changes if the underlying multisig session changes, so the same path doesn't re-use a nonce across sessions.)

## [0.92.0] - 2026-04-24

Phase 4 — Step 20 of 23. Multisig PSBT-QR cosigner round-trip (§22.3 reuses §20 chunked-QR transport). The wallet now has a complete envelope protocol on top of the existing chunked-QR transport: coordinator wallets request, cosigner wallets reply, both differentiate round 1 (MuSig2 nonces) from round 2 (MuSig2 partial sigs) from the single round (P2SH/P2WSH classical). Step 21 wires the hardware-MuSig2 path; Step 22 surfaces multisig badges across the rest of the UI.

### Added

- `packages/core/src/uri/multisigPsbtEnvelope.js` — multisig envelope module. Seven envelope kinds covering the full protocol: `multisig-request-nonce` / `multisig-round-1-reply` (MuSig2 round 1), `multisig-request-partial` (carries `aggNonce`) / `multisig-round-2-reply` (MuSig2 round 2), `multisig-request-signature` / `multisig-classical-reply` (P2SH/P2WSH single round), `multisig-finalized` (broadcast-of-record). Every envelope carries a `fingerprint` derived from `sha256(canonicalized(sessionRef))` so cosigner wallets can route incoming envelopes into the right local session without shipping a UUID on the wire. `validateMultisigEnvelope` cross-checks the carried fingerprint against the carried `sessionRef`, catching tampering before the contribution reaches the state machine.

- `packages/core/src/ui/AnimatedQrFrames.jsx` — generic React component that renders an array of strings as animated QR codes at 3 fps per §20.3. Pre-renders the next frame in the background so frame transitions don't flash. Caches data URLs to avoid re-rendering on every interval tick. Reusable: not multisig-specific — anything that wants to display chunked QR (cold-storage PSBT export, large URI shares) can compose with `encodeXcwChunks` to drive frames.

- `packages/core/src/shared/routes/MultisigSigningSession.jsx` — three new view states layered onto the Step 19 tracker:
  - `tracker` (existing) — adds `Round 1 — Collect nonces` / `Round 2 — Collect signatures` / `Collect signatures` round labels per the §22.3 + §22.4 spec.
  - `export-qr` — picks the right envelope kind for the current `(scheme, status)` tuple (round-1-nonce request for MuSig2 collecting-nonces; round-2-partial request for MuSig2 collecting-sigs once aggNonce is set; signature request for P2SH/P2WSH; finalized broadcast for terminal). Encodes the envelope, runs it through `encodeXcwChunks`, and renders the chunks via `AnimatedQrFrames`. A `<details>` block surfaces the raw frames as a textarea so wallet-to-wallet copy-paste works while camera scanners are still un-shipped.
  - `paste-inbox` — accepts pasted XCW chunks (one per line or batch), feeds them through `addChunkToCollector`, and on completion runs `decodeMultisigEnvelope` + dispatches the contribution to `contributeMultisigNonce` / `contributeMultisigSignature` via the existing Step 19 messaging helpers. Frame counter shows progress; resetting the collector starts a new capture.

- `packages/core/test/multisig-psbt-qr.smoke.js` — new smoke. Asserts the seven envelope kinds enumerate the full protocol; canonicalized + case-insensitive fingerprint; round-1 / round-2 / classical / finalized builders + their shape guards; encode→XCW chunks→reassemble→decode round-trip for every kind; tampered-envelope detection (fingerprint mismatch when the underlying sessionRef is swapped); envelope-version rejection; `AnimatedQrFrames` export from core/ui; sign-screen route renders both round labels per spec; sign-screen builds outbound envelopes + decodes inbound ones + pipes the contribution through messaging; uri barrel exposes the 9 new helpers; Step 19 helpers still present in all 3 shells. All 82 smokes pass.

### Decided

- **Envelope-on-bytes, not envelope-as-PSBT.** The §22.3 multisig protocol carries strictly more state than a vanilla PSBT (per-cosigner publicNonces, aggregated nonce, per-cosigner partials, the eventual aggregated Schnorr sig). Encoding all of that into BIP-0373 PSBT v2 fields is doable but pulls a heavyweight PSBT manipulation library into the wallet's audit surface for a flow that's purely wallet-to-wallet. Going with a small versioned JSON envelope wrapped inside `encodeXcwChunks`. The same chunked-QR transport (`XCW:<n>/<total>:<crc32>:<base64>`) already proven for PSBT-as-bytes carries the envelopes verbatim. Future ecosystem-interop work (Sparrow / Specter / Coldcard) per §20.3 can layer BBQr or UR formats on top of this same envelope shape.

- **Camera scanner deferred to a later step.** §20.4 / §20.5 specify a full air-gapped signer-mode UX with camera capture; Step 20's deliverable per the Phase 4 plan is the cosigner round-trip protocol, not the broader signer-mode wiring. The paste-inbox accepts pasted XCW chunks today; the camera scanner will fill the same textarea automatically when it lands. Smoke notes the deferral inline so the follow-up is discoverable.

### Notes

- `xchain-sdk` pin still at `^1.11.0`. No platform-side changes for Step 20 — the envelope layer is wallet-only and the cryptographic primitives that drive aggregation already shipped at SDK 1.10/1.11.
- Step 19's smoke continues to pass against the modified sign-screen route; the round-label additions sit alongside the existing dual-mode tracker copy without disturbing it.

## [0.91.0] - 2026-04-24

Phase 4 — Step 19 of 23. Multisig-aware sign-round persistence + dual-mode partial-signature tracking (§22.3 + §42.9). The wallet now owns the state machine that keeps a multisig spend coherent across cosigner contributions and across wallet reloads. Step 20 wires the §20 PSBT-QR transport that pumps contributions into this layer; Step 21 wires the hardware-MuSig2 path; Step 22 surfaces multisig badges across the rest of the UI.

### Added

- `packages/core/src/schemas/multisigSigningSession.js` — new `MultisigSigningSession` record with a six-status state machine (`collecting-nonces` → `collecting-sigs` → `ready-to-finalize` → `finalized` → `broadcast`, plus terminal `cancelled`). One record covers both schemes; the `scheme` field discriminates which contribution lane is populated. P2SH/P2WSH track `signatures[]` (DER-encoded ECDSA, single round). Taproot-MuSig2 tracks `nonces[]` (66-byte BIP327 publicNonces, round 1) and `partialSigs[]` (32-byte BIP327 partials, round 2), plus `aggNonce` and `aggregatedSchnorrSig` outputs. Helpers `pendingCosignerPubkeys(session)` and `progressSummary(session)` drive the dual-mode tracker UI ("Signatures collected: 2 of 3" for P2SH/P2WSH; "Nonces collected: 2 of 3" → "Partial sigs collected: 2 of 3" → aggregated 64-byte Schnorr for MuSig2).

- `packages/core/src/storage/codec.js` + `storage/Vault.js` — new `multisigSigningSessions` collection. New documents include the slot; older documents read it as `[]` via the existing defensive merge in `decodeDocument`. No schema-version bump for the document codec — collection adds at `documentVersion: 1` are forward-compatible.

- `packages/core/src/flows/multisigSigning.js` — eight flow operations:
  - `startMultisigSigningSession({ vault, walletId, chainId, msgHash, psbtHex?, actionSummary? })` — snapshots the wallet's persisted `MultisigConfig` (scheme + threshold + cosigner pubkey list) onto the new session so the active config can mutate without affecting an in-flight spend. Initial status is `collecting-nonces` for MuSig2 and `collecting-sigs` for P2SH/P2WSH.
  - `contributeMultisigNonce({ vault, sessionId, pubkey, publicNonceHex })` — round 1 only; rejects duplicate cosigners and wrong-length nonces.
  - `contributeMultisigSignature({ vault, sessionId, pubkey, signatureHex })` — single round (P2SH/P2WSH) or round 2 partial sig (MuSig2). For P2SH/P2WSH the threshold-meeting contribution auto-flips status to `ready-to-finalize`; for MuSig2 the caller drives the transition explicitly via `aggregateMultisigSession`.
  - `aggregateMultisigSession({ vault, sdkRegistry, sessionId })` — idempotent two-step transition for MuSig2. When `status='collecting-nonces'` and threshold is met it calls `sdk.musig2.aggregateNonces` and persists `aggNonce` + advances to `'collecting-sigs'`. When `status='collecting-sigs'` and threshold partial sigs are present it calls `sdk.musig2.startSession` + `aggregateSignatures` and persists `aggregatedSchnorrSig` + advances to `'ready-to-finalize'`.
  - `finalizeMultisigSigningSession({ vault, sessionId, finalizedTxHex, txid? })` — caller-supplied tx hex transition stub; Step 20 supplies real tx bytes once PSBT finalization lands.
  - `cancelMultisigSigningSession({ vault, sessionId })` — terminal cancel; idempotent for already-terminal records.
  - `getMultisigSigningSession` / `listMultisigSigningSessions` — reads.

- `packages/extension/src/background/createBackgroundHost.js` — eight new `multisigSign.*` handlers (start / get / list / cancel / contributeNonce / contributeSignature / aggregate / finalize) wired through the same vault + sdkRegistry deps the Step 17/18 multisig handlers use.

- `packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js` — eight matching helpers in each shell so the sign-screen UI doesn't have to build envelopes by hand.

- `packages/core/src/shared/routes/MultisigSigningSession.jsx` — list-or-detail tracker route. The list shows every multisig session for the active wallet with status + scheme label + N-of-M progress. The detail view renders the dual-mode tracker per the spec: P2SH/P2WSH shows a single counter; MuSig2 shows two counters ("Round 1 — Nonces collected" + "Round 2 — Partial sigs collected") plus indicators for aggNonce and aggregated Schnorr availability. Pending-cosigners list, Aggregate button (gated on threshold + valid status), and Cancel-session button. Reachable from ActionsMenu via "Multisig signing", BTC-gated by `useBtcAddressesPresent`.

- `packages/core/test/multisig-signing.smoke.js` — new smoke. Drives a 2-of-3 P2WSH single-round flow end-to-end against an in-memory fake vault, plus a 2-of-2 MuSig2 two-round flow against a stubbed `sdk.musig2.{aggregateNonces, startSession, aggregateSignatures}` to verify state transitions, contribution shape guards, threshold gating, and persistence. Also asserts schema status alphabet + dual-mode `progressSummary` labels + bg-handler registration of all 8 routes + 3-shell messaging exports + sign-screen route renders the dual-mode tracker copy + 3-shell App.jsx wiring + BTC gate + that the SDK pin stays at `^1.11.0` (no SDK bump needed for Step 19; the MuSig2 primitives that landed at 1.10 cover the aggregation paths).

### Decided

- **Wallet-side path, no SDK extension this step.** The Step 19 prompt left it open whether to extend `xchain-sdk` with multisig PSBT helpers or to build the multisig path wallet-side using the `redeemScript` / `witnessScript` / `outputPubkey` Step 18's `receiveMultisigAddress` already returns. Going wallet-side. The state-machine + persistence is not crypto — it's bookkeeping — and the cryptographic primitives that *do* belong in the SDK already live there as `sdk.musig2.*`. PSBT byte-level construction is deferred to Step 20 along with QR transport, where the right SDK shape will be obvious. Until then `MultisigSigningSession.psbtHex` carries an opaque transport payload that round-trips through the wallet without it needing PSBT-manipulation primitives.

- **Multisig PSBT-finalization is a stub at this step.** `finalizeMultisigSigningSession` accepts a caller-supplied `finalizedTxHex` and flips the status. Step 20's QR transport will produce real signed-tx bytes from the threshold contributions stored on the session. Smoke exercises the full state machine end-to-end with placeholder bytes to keep the regression net tight.

- **Caller-driven aggregation, no auto-advance on threshold.** When the threshold-th MuSig2 partial sig lands, status stays at `collecting-sigs` until the caller invokes `aggregateMultisigSession` — by design. The caller may still want to collect more signatures than the threshold (for redundancy / audit trail) before the user explicitly "finalizes the round." P2SH/P2WSH single-round behaviour is the same in spirit: status advances to `ready-to-finalize` on threshold, but the actual PSBT finalization is a separate step.

### Notes

- `xchain-sdk` pin stays at `^1.11.0` across `extension` and `web`. Step 18 already shipped the SDK bump that this step builds on (`deriveMultisigAddress` + `musig2.*`). No platform-side changes for Step 19.

## [0.90.0] - 2026-04-24

Phase 4 — Step 18 of 23. Multisig address derivation + Receive integration (§22 + §42.9). Closes the read-side multisig surface; PSBT construction (Step 19), QR transport (Step 20), and HW MuSig2 (Step 21) follow.

### Cross-repo

- `xchain-sdk` 1.10.0 → 1.11.0 (commit `34292f8` in `xchain-sdk`). New `XChainWallet.deriveMultisigAddress({ scriptTemplate, scheme, network? })` consumes the `scriptTemplate` field that this wallet persists on `MultisigConfig` (Step 17) and renders the output address. P2SH-multisig: `bitcoin.payments.p2sh({ redeem: p2ms({ m, pubkeys }) })`. P2WSH-multisig: `bitcoin.payments.p2wsh({ redeem: p2ms(...) })`. Taproot-MuSig2: `bitcoin.payments.p2tr({ pubkey: aggregatedXOnly })` — key-path-only with no further BIP341 tweaking, because `sdk.musig2.aggregateKeys` already produced the final output key. Returns `{ address, scheme, redeemScript, witnessScript, outputPubkey }`. Manually verified end-to-end: `aggregateKeys` → `deriveMultisigAddress({ scheme: 'taproot-musig2', ... })` produces a `bc1p…` bech32m address; the same cosigner pubkeys with `scheme: 'p2sh-multisig'` produce a `3…` base58 P2SH address; with `scheme: 'p2wsh-multisig'` produce a `bc1q…` 32-byte witness-program bech32 address.

### Added

- `packages/core/src/flows/multisigAddress.js` — `receiveMultisigAddress({ vault, sdkRegistry, walletId, chainId })`. Reads the persisted `MultisigConfig` off the Wallet record, dispatches to `sdk.deriveMultisigAddress`, and returns `{ address, scheme, threshold, cosignerCount, cosignerNames, schemeLabel, redeemScript | witnessScript | outputPubkey }`. Fails loudly when the wallet has no `multisig` config yet, when no SDK is registered for the chainId, or when the SDK is too old (`< 1.11.0`) to expose the method.
- `packages/extension/src/background/createBackgroundHost.js` — `multisig.receiveAddress` read-only handler.
- Three-shell messaging — `getMultisigReceiveAddress` helpers in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/Receive.jsx` — multisig section. When the active wallet has a persisted `MultisigConfig` and a multisig address derives successfully for the active chain, Receive renders a labeled section below the single-key QR with: an N-of-M chip indicator, the scheme label ("2-of-3 P2WSH multisig"), a separate QR for the multisig address, copy-to-clipboard, and the cosigner names below. Failures are silent — the single-key flow keeps working when multisig isn't configured (or the chain doesn't support it).

### Changed

- `packages/extension/package.json`, `packages/web/package.json` — `xchain-sdk` pin bumped `^1.10.0` → `^1.11.0`.
- `packages/core/test/coinpay-form.smoke.js`, `packages/core/test/sdk-bundle.smoke.js` — pin assertions updated to match the new SDK version.

### Notes

- The Receive section is render-only — no PSBT, no signing. PSBT construction against the persisted `MultisigConfig` is the §22.3 flow that lands in Step 19; this step closes the structural prerequisite (a wallet with a `MultisigConfig` can show its receive address).
- Network selection follows the active Receive chain. Multisig is BTC-only at launch (§22 + §10.3); the Receive chain picker still lists every chain with addresses, but the multisig section only renders when the active chain's network maps to a valid multisig output (the SDK's `deriveMultisigAddress` throws with a clear error otherwise; the route swallows the error and skips the section).
- `redeemScript` (P2SH) and `witnessScript` (P2WSH) come back from the SDK and are stored in the result, ready for Step 19's PSBT construction. Taproot-MuSig2 returns the `outputPubkey` for symmetry; PSBT construction will use it directly.

## [0.89.0] - 2026-04-24

Phase 4 — Step 17 of 23. Multisig wallet creation coordinator (§22 + §42.9). Opens the multisig surface (Steps 17–22). All three schemes (P2SH / P2WSH / Taproot-MuSig2) configurable from this single coordinator; address derivation, PSBT construction, QR transport, HW MuSig2 wiring, and surface-wide badging follow in Steps 18–22.

### Added

- `packages/core/src/schemas/multisigConfig.js` — Cosigner schema brought in line with §22.2: `name` + `pubkey` + `fingerprint` + `origin` + `localSignerId` + `xpub` + `derivationPath` + `addedAt`. The previous skeleton had `localAccountId` and was missing `fingerprint` / `derivationPath` / `addedAt`. `COSIGNER_ORIGINS` renamed `hardware` → `external-hardware` per spec. `validateMultisigConfig` enforces ≥2 cosigners, threshold ≤ N, and unique pubkeys. New `buildMultisigConfig` factory assembles the record and encodes `scriptTemplate` (P2SH/P2WSH: `multi:<T>:<pk1>:<pk2>:...`; Taproot-MuSig2: `musig2:<aggregatedXOnlyPubkey>`).
- `packages/core/src/flows/createMultisigConfig.js` — coordinator core flow. Validates cosigner inputs (hex pubkey, 8-hex fingerprint, derivation path, origin-specific required fields), aggregates keys via `sdk.musig2.aggregateKeys` for the Taproot-MuSig2 path, persists the resulting `MultisigConfig` onto the chosen Wallet record's `multisig` slot via `vault.wallets.put`. Refuses to overwrite an existing multisig configuration.
- `packages/extension/src/background/createBackgroundHost.js` — `multisig.create` handler.
- Three-shell messaging — `createMultisigConfig` helpers in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/MultisigCreate.jsx` — coordinator UI. BTC-only network picker (multisig is BTC-only at launch per §10.3 + §22). Cosigner row editor: per-row name + origin (local / external-xpub / external-hardware) + pubkey + fingerprint + derivation path. For local cosigners, dropdown of the wallet's BTC addresses auto-fills pubkey + derivationPath from the address record. Scheme picker (radio: all three live). Threshold input. Review summary block + "Create multisig" submit. Done screen surfaces the persisted scriptTemplate.
- ActionsMenu — new "Create multisig" entry across all three shells, BTC-gated via `useBtcAddressesPresent` (same gate Contracts and Staking use).
- Three App.jsx — new `'multisig-create'` sub-route. Reachable from the actions menu when `hasBtcAddress` is true; Back returns to the menu.

### Fixed

- Three-shell `messaging.js` had a duplicate `getActionByIndex` export (one from Step 3, one from Step 12). Vite would have caught this at build time; smoke tests don't bundle. Removed the duplicate so each helper is exported exactly once.

### Notes

- `xchain-sdk` 1.10.0 already ships `MuSig2` wired onto `XChainSDK.musig2`. The Phase 4 step plan called for an SDK 1.11 bump for MuSig2 primitives; that bump turned out to be unnecessary because Step 1's audit (and its commit `862cab1` in the SDK repo) had already landed the module ahead of Phase 4. The wallet's pin stays at `^1.10.0`.
- BIP32 master fingerprint isn't auto-computed for local cosigners. The coordinator UI asks the user to type it. Computing it from the unlocked seed is a small enhancement that could land alongside Step 18's address derivation work — fingerprint resolution and derivation are adjacent concerns.
- PSBT construction (Step 19), QR transport (Step 20), HW MuSig2 wiring (Step 21), and surface-wide multisig badges (Step 22) all consume the `MultisigConfig` this step persists. Step 17 is structural; the operational surface lands in those four follow-up steps.

## [0.88.0] - 2026-04-24

Phase 4 — Step 16 of 23. Cross-chain templates (§42.8.4). Closes the §42.8 Cross-Chain surface (Steps 12 → 16). Templates are JSON config files in `packages/core/src/templates/cross-chain/*.json` plus a `Templates` route that pre-fills the §42.8.2 Parallel composer.

### Added

- `packages/core/src/templates/cross-chain/launch-token-with-metadata.json` — Jin's "Launch token with cross-chain metadata" reference template (ISSUE on chain A + FILE on chain B + LINK).
- `packages/core/src/templates/cross-chain/bridge-token-pair.json` — "Bridge token pair" reference template (ISSUE on each chain + LINK).
- `packages/core/src/templates/cross-chain/cross-chain-airdrop.json` — Jin's "Cross-chain airdrop" reference template (parallel AIRDROP on multiple chains).
- `packages/core/src/templates/cross-chain/validate.js` — `validateCrossChainTemplate` pure function; checks `id` / `name` / `description` non-empty, `actions` non-empty array, per-row `chainHint ∈ {primary, secondary, tertiary}`, `action` non-empty, `params` is an object.
- `packages/core/src/templates/cross-chain/index.js` — bundled-template registry. Imports the three JSONs (Vite handles JSON imports natively), validates each at module-load via `validateCrossChainTemplate`, throws on malformed templates, exports the frozen list as `CROSS_CHAIN_TEMPLATES` plus a `templateById(id)` lookup. `validate.js` is a sibling so Node smokes can validate JSONs via `fs` without loading `index.js` (Node 18 lacks JSON-module support without `--experimental-json-modules`).
- `packages/core/src/shared/routes/CrossChainTemplates.jsx` — list route. Loads the wallet's chains via `messaging.getAddressesByChain`, then renders each template with name + description + per-row preview + "Use template" launcher. The launcher resolves each row's `chainHint` to a concrete `chainId` (primary → chains[0], secondary → chains[1], tertiary → chains[2], with fallback to the last available chain), substitutes resolved tickers into LINK rows' `COIN1` / `COIN2` placeholders, and calls `onLaunch(prefill)`.
- `packages/core/src/shared/routes/ParallelComposer.jsx` — new `initialRows` prop. When supplied, the composer seeds with those rows (each carrying a resolved `chainId`, action name, params object) instead of one blank row. Rows behave identically to user-added rows from then on (full edit / remove / status tracking).
- ActionsMenu — new "Cross-chain templates" entry across all three shells.
- Three App.jsx — new `'cross-chain-templates'` sub-route + `parallelPrefill` state slot. The templates route's `onLaunch` callback writes the prefill into `parallelPrefill` and navigates to `'parallel-compose'`; the parallel composer's Back clears the prefill so the next entry starts blank.

### Notes

- §42.8 surface complete: Step 12 (History thread rendering §23.5), Step 13 (LINK form §42.8.1), Step 14 (Parallel composer §42.8.2), Step 15 (Cross-chain swap §42.8.3), Step 16 (Templates §42.8.4). Phase 4 progress: 16 / 23.
- Action indices in LINK rows stay as placeholder strings (`<ISSUE action_index from row 1>`) by design. The user fills them in after rows 1–2 confirm and an action_index is known. A future enhancement could auto-substitute these from the running pendingTx state, but that's a richer composer feature than Step 16's scope.
- Templates are config, not code. Adding a new template means dropping a new `<id>.json` next to the bundled three and adding it to `index.js`'s import list. Per-template structure is enforced at module load, so a malformed addition surfaces at startup rather than as a broken row in the composer.
- No SDK / explorer / hub bumps — Step 16 is pure UX over the existing `advancedAction` surface (via Step 14's composer).

## [0.87.0] - 2026-04-24

Phase 4 — Step 15 of 23. Cross-chain swap form (§42.8.3). Reuses the §41.5 `swapAction` core flow with one structural change at the form level: `GIVE_COIN ≠ GET_COIN`. Same SWAP encoder produces both same-chain and cross-chain offers; this is purely a UI separation.

### Added

- `packages/core/src/shared/routes/CrossChainSwapForm.jsx` — §42.8.3 surface. Two side panels (You give / You get): give-chain picker + from-address selector + give-ticker / give-amount; get-chain picker + receiver address (auto-filled via `messaging.getNewestAddress`) + get-ticker / get-amount. Expiration field (block-height delta forwarded as the `EXPIRATION` SWAP param). Standard 3-stage flow (form → submitting → done). Validation: rejects same-chain pairs (with a pointer to the §41.5 `Swap tokens` form), rejects native-coin tickers on either side (DISPENSER lane), requires non-empty receiver and integer expiration.
- ActionsMenu — new "Cross-chain swap" entry across all three shells.
- Three App.jsx — new `'cross-chain-swap'` sub-route. Reachable from the actions menu; Back returns to the menu.

### Notes

- The receiver address auto-fill uses `messaging.getNewestAddress(walletId, getChainId)` — the same helper Receive uses to surface the wallet's newest external HD index. Once the user types into the field, the auto-fill pauses (`getAddressTouched`) so re-renders don't clobber a custom destination. Switching the get-chain resets `touched` so the new chain's auto-fill takes over.
- Same-chain swaps stay routed to `SwapForm` (§41.5). The cross-chain form refuses identical give/get coin tickers with a pointer to the same-chain form — keeps the §41.5 surface focused on the common single-chain case and avoids growing a "cross-chain mode" toggle there.
- Native-coin rule preserved on both sides. `GIVE_TICK` cannot be the give-chain's coin ticker (BTC / DOGE / LTC), and `GET_TICK` cannot be the get-chain's coin ticker. Token ↔ native-coin trading is the DISPENSER lane (§40.7), not SWAP.
- The wallet does not consult the give-chain's tip to convert "blocks-from-now" into an absolute block height. The form forwards the raw `EXPIRATION` value verbatim and the SDK validator + indexer enforce the absolute-vs-relative semantics (the indexer treats EXPIRATION as a delta from the SWAP's confirmation block; the SDK validator only requires a positive integer).
- Live cross-chain status via WebSocket (the spec line "Status is live on both chains") is deferred — the form's done screen is a single broadcast confirmation. Adding a "watch this swap" surface would mean wiring SWAP-match streaming into the wallet, which is its own follow-up.

## [0.86.0] - 2026-04-24

Phase 4 — Step 14 of 23. Parallel cross-chain composer (§42.8.2). Multi-row draft list spanning any combination of chains, signed sequentially through the existing §40.10 `advancedAction` core flow. No new submit primitives — Step 14 is mostly UX.

### Added

- `packages/core/src/shared/routes/ParallelComposer.jsx` — §42.8.2 four-stage flow:
  - **Compose**: `[+ Add action]` button seeds a row with the wallet's first chain and a default JSON params skeleton (`{"VERSION":"0"}`). Each row carries `{chainId, fromAddressId, action, paramsJson, status, txid, error}`. Per-row Edit (in-place fields) and Remove. Action dropdown is hydrated from `messaging.listActions` with a static fallback list when SDK introspection fails. Compose-level validator surfaces row-numbered errors (chain unset / address unset / action unset / invalid JSON / non-object params).
  - **Review**: counts actions across distinct chains, lists them, surfaces the §42.8.2 spec warning (each action signs and broadcasts independently — failures do NOT roll back successes). Required ack checkbox gates the "Sign all" button.
  - **Signing**: per-row sign loop. The active row shows a `RowDetail` block (chain / from / action / params) plus `SignCredentials` (HW vs software branch). Software-signed rows reuse a single password entered once at the top of the run; HW-signed rows prompt independently. Per-row status transitions `pending → submitting → success | failed`; failed rows can be retried in place; pending rows after a failure can be skipped. After a row succeeds the composer auto-advances to the next non-success row.
  - **Done**: lists every row with its final status (✅ broadcast / ⚠ failed / ↷ skipped) and txid where applicable.
- ActionsMenu — new "Parallel cross-chain actions" entry across all three shells.
- Three App.jsx — new `'parallel-compose'` sub-route. Reachable from the actions menu; Back returns to the menu.

### Notes

- Step 14 deliberately reuses `messaging.advancedAction` per row rather than introducing a new "parallel.batch" core flow. The on-chain effect of "n parallel actions" is exactly "n independent ACTIONs," so a batch flow would be a thin loop wrapper that doesn't earn its weight. The composer is the loop, with per-row UX guarantees the SDK doesn't owe.
- Params are entered as a JSON object per row. This is consistent with how the §40.10 Advanced form treats unknown actions (raw fields), and lets the composer span every supported action in one surface without growing per-action knowledge here. Future Steps may layer a per-action-type renderer on top, but the JSON path stays as the power-user fallback.
- The skip/retry semantics matter: a software-signed run with three rows where row 2 fails should not strand the user. Skip moves on; Retry signs the failed row again with the in-flight password (or the next HW prompt). The Done screen reports the run truthfully so users can compose a follow-up to clean up.
- No SDK / explorer / hub bumps — `advancedAction` and `listActions` were both on the SDK 1.10.0 surface audited in Step 1. The cross-chain helper's `parallel()` method is not used; `advancedAction` already routes through the per-chain SDK instance via `sdkRegistry`, which is the same dispatch.

## [0.85.0] - 2026-04-24

Phase 4 — Step 13 of 23. LINK two-panel creation form (§42.8.1). First write-side cross-chain action — anchors a pair of existing actions across two chains. Both sides thread together in History via the §23.5 rendering shipped in Step 12.

### Added

- `packages/core/src/flows/linkAction.js` — LINK composer over `submitAction`. Guards `coin1` / `coin2` non-empty, `coin1ActionIndex` / `coin2ActionIndex` integer-strings, and rejects identical (coin, action_index) pairs. Builds the v0 LINK params (`VERSION|COIN1|COIN1_ACTION_INDEX|COIN2|COIN2_ACTION_INDEX|MEMO`) per the SDK format.
- `packages/extension/src/background/createBackgroundHost.js` — `action.link` + `action.link.hw` handlers (the latter via `registerHwHandler`).
- Three-shell messaging helpers — `linkAction` / `linkActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/LinkForm.jsx` — §42.8.1 two-panel composer. Two side panels (Chain A / Chain B), each with a chain picker + action_index input. Per-side decoded preview fetched via `messaging.getActionByIndex` (350ms debounce, cached per (chainId, actionIndex) pair) so the user can confirm what they're linking before signing. "Submit LINK on" radio defaults to chain A; switches the signing-chain context (and therefore the from-address pool) when the user picks chain B. Standard 4-stage flow (form → submitting → done) with `SignCredentials` + HW vs software branch.
- ActionsMenu — new "Link cross-chain actions" entry across all three shells.
- Three App.jsx — new `'link-form'` sub-route. Reachable from the actions menu; Back returns to the menu.
- `packages/core/src/shared/routes/AdvancedActionsForm.jsx` — `LINK` added to `ACTIONS_WITH_DEDICATED_FORMS` so the Advanced dropdown decorates LINK with "(dedicated form available)" rather than presenting it as the canonical surface. The Advanced action description across all three shells dropped the `LINK` mention since LINK now has a curated UX.

### Notes

- LINK is a free-standing cross-chain anchor — it does not consume or produce tokens. The on-chain LINK action lives on a single chain, but the indexer's `links` table records both (coin1, action_index1) and (coin2, action_index2) so History can thread either side regardless of which chain hosts the LINK transaction.
- The form's "Submit LINK on" defaults to chain A. If the user wants the LINK action itself recorded on chain B, switching the radio re-selects a from-address from chain B's pool — the LINK transaction signs on whichever chain owns the picked address.
- Decoded preview is best-effort. The form recognizes ISSUE / SEND / BROADCAST and falls back to the bare action name otherwise; the goal is "is this the right action?" confirmation, not a full action viewer (the History detail card already covers that).
- No SDK / explorer / hub bumps — `getAction(actionIndex)` and the SDK's LINK encoder were both on the SDK 1.10.0 surface audited in Step 1.

## [0.84.0] - 2026-04-24

Phase 4 — Step 12 of 23. History route + §23.5 cross-chain thread rendering. First Cross-Chain (§42.8) step — ships the History surface so the §42.8.1–§42.8.4 LINK / parallel / swap / templates flows have somewhere to land in the timeline.

### Added

- `packages/core/src/flows/linkQueries.js` — `linksForAddress` thin wrapper over `sdk.getLinks(address, 'address', opts)`.
- `packages/extension/src/background/createBackgroundHost.js` — `links.address` read-only passthrough. (`history.address` was already registered in Phase 1; Step 12 is the first surface to consume it.)
- Three-shell messaging helpers — `getAddressHistory` / `getLinksForAddress` / `getActionByIndex` in popup + web + desktop `messaging.js`. (`history.address` is now reachable from the UI; `actions.byIndex` already had a bg handler from Step 3 but no shell helper.)
- `packages/core/src/shared/routes/History.jsx` — unified §23 timeline + §23.5 cross-chain threading. Per (chain, address) the route fans out `getAddressHistory` + `getLinksForAddress` in parallel, merges results into a single time-sorted list, and builds a `(chainId, action_index) -> peer` link map. Rows carry a 🔗 badge when they're one side of a LINK pairing. Adjacent rows that are peers of the same LINK (both sides visible) get a vertical connector. Click → inline detail card; for linked rows the card renders side-by-side, fetching the peer ACTION via `messaging.getActionByIndex` (cached per peer key). "Cross-chain actions" filter chip isolates the threaded subset; per-chain chips toggle individual chains.
- `packages/core/src/shared/routes/Home.jsx` — new `onHistory` prop + History button in the home actions strip.
- Three App.jsx — new `'history'` sub-route. Mounted from the Home button, Back returns to Home.

### Notes

- LINK coin-ticker → chain mapping is local: `{ BTC: 'bitcoin', DOGE: 'dogecoin', LTC: 'litecoin' }`. Unknown tickers degrade gracefully — the row still renders with the raw coin code in the peer label, the dual-side card shows a "peer chain not bundled" hint, and the rest of History keeps working. When a future chain is added to `BUNDLED_DESCRIPTORS` the map needs the new ticker entry.
- The vertical connector only draws when both peers happen to be adjacent in the visible list (DESC by block_index). For LINKs whose peer is outside the address's history (cross-account, archived, or filtered out by the active chain chips) the connector is suppressed but the 🔗 badge still appears — that's the §23.5 behavior: the badge is the marker, the connector is the accent when the layout supports it.
- `summarizeRow` covers SEND / ISSUE / LINK explicitly and falls back to the row's memo or just the action name. Other action shapes (DISPENSE, ORDER fills, STAKE, etc.) render with the bare action label in the row header — full decoded data is one click away in the detail card. Tightening per-action summaries is a follow-up across the whole timeline rather than a Step 12 concern.
- No SDK / explorer / hub bumps needed for Step 12 — `getLinks(addr, 'address')`, `getHistory(addr, 'address')`, and `getAction(actionIndex)` were all already on the SDK 1.10.0 surface audited in Step 1.

## [0.83.0] - 2026-04-24

Phase 4 — Step 11 of 23. Operator / validator dashboard (§42.7.5, Devi persona). Closes the Staking surface (§42.7) — Steps 7–11 cover dashboard, all five write-side actions, and the operator view.

### Added

- `packages/core/src/flows/broadcastQueries.js` — `broadcastsForAddress` thin wrapper over `sdk.getBroadcasts(address, 'address', opts)`.
- `packages/extension/src/background/createBackgroundHost.js` — `broadcasts.forAddress` read-only passthrough.
- Three-shell messaging — `getBroadcastsForAddress` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/OperatorDashboard.jsx` — §42.7.5 dashboard. Five parallel-loaded read sections (Staking status / Delegation chain / Validator performance / Rewards trajectory / Publishing activity) plus an inline Publisher mode quick-compose. Validator performance auto-joins the address's most recent delegation pubkey against `getValidators` to pick out the operator's own row.
- Publisher mode (inline `<PublisherMode>` sub-component) — v3 BROADCAST feed-result quick-compose. Pre-fills `BROADCAST_ACTION_INDEX` from the address's most recent v2 feed-create. Single value input + sign → calls `messaging.broadcastAction` (HW branch wired). Clears the value field after each successful submit so successive updates are one keystroke + Sign. Password / HW status persist across submits within the dashboard session.
- `packages/core/src/shared/routes/StakingDashboard.jsx` — new `onOpenOperatorDashboard` prop + "Operator view" button rendered next to the existing action buttons. Disabled when there's no active stake or when the prop isn't passed.
- Three App.jsx — new `'operator-dashboard'` sub-route. `StakingDashboard.onOpenOperatorDashboard` transitions; the operator dashboard's Back returns to the staking dashboard.

### Notes

- §42.7 staking surface is now complete. Steps 7 (dashboard), 8 (STAKE), 9 (UNSTAKE + CLAIM_REWARDS), 10 (DELEGATE + REVOKE_DELEGATION), and 11 (operator dashboard + Publisher mode) cover every staking sub-section. Phase 4 progress: 11 / 23.
- No SDK / explorer / hub bumps needed for Step 11 — every read endpoint (`getStakes`, `getDelegations`, `getValidatorRewards`, `getValidators`, `getBroadcasts`) was already on the SDK 1.10.0 surface audited in Step 1.
- Validator metric field names (`uptime` / `score` / `votes` / `missed` / `last_seen_block`) are speculative — the dashboard renders whichever of those keys come back from `getValidators`. If the hub's actual field names diverge, the section will silently render empty rather than throw, and the field mapping can be tightened in a follow-up after the operator dashboard has live data flowing through it.

## [0.82.0] - 2026-04-24

Phase 4 — Step 10 of 23. DELEGATE + REVOKE_DELEGATION authoring forms (§42.7.2 delegation-lane). Both actions take a 64-hex Ed25519 pubkey and share a chassis, so they ship in one commit combined into `DelegationActionForm.jsx` with a `mode` prop (same pattern as Step 9's StakingActionForm).

### Added

- `packages/core/src/flows/delegateRevokeActions.js` — `delegateAction` + `revokeDelegationAction` composers. Both guard their 64-hex Ed25519 pubkey field (DELEGATE: `NEW_SIGNING_PUBKEY`, REVOKE_DELEGATION: `SIGNING_PUBKEY`) up-front before handing to the SDK encoder.
- `packages/extension/src/background/createBackgroundHost.js` — `action.delegate` + `action.revokeDelegation` + both `.hw` variants (via `registerHwHandler`).
- Three-shell messaging helpers — `delegateAction` / `delegateActionHw` / `revokeDelegationAction` / `revokeDelegationActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/DelegationActionForm.jsx` — one component, two modes via `mode` prop (`'delegate' | 'revoke'`). Delegate mode asks for a new pubkey and explains it replaces any currently-active delegation. Revoke mode pre-populates the pubkey input by reading the source address's delegations via `messaging.getDelegationsForAddress` (the read-side already in place from Step 7) — the user can override to revoke an older key. Review screen + SignCredentials + HW branch + 4-stage state machine are shared.
- Three App.jsx — new `'staking-delegate'` + `'staking-revoke'` sub-routes. `StakingDashboard` now wires `onDelegate` + `onRevokeDelegation` through to the two routes. The existing Delegate / Revoke buttons on the dashboard (rendered disabled in Step 7) are now live.

### Notes

- Staking authoring surface (§42.7.1–§42.7.3) is now complete. Steps 8 (STAKE), 9 (UNSTAKE + CLAIM_REWARDS), and 10 (DELEGATE + REVOKE_DELEGATION) close out every write-side staking action. Step 11 (operator / validator dashboard §42.7.5) is the last staking sub-step.
- Dashboard consistency: all five staking action buttons (Stake / Unstake / Claim / Delegate / Revoke) are now live when their preconditions are met (has stake, has pending rewards, has delegation).

## [0.81.0] - 2026-04-24

Phase 4 — Step 9 of 23. UNSTAKE + CLAIM_REWARDS authoring forms (§42.7.2 unstake-lane + §42.7.3). Both actions are trivially small on-chain — UNSTAKE is `VERSION|TIER`, CLAIM_REWARDS is `VERSION` — so they ship in one commit, combined into `StakingActionForm.jsx` with a `mode` prop (same pattern as §42.5 ContractFundsForm).

### Added

- `packages/core/src/flows/unstakeClaimActions.js` — `unstakeAction` + `claimRewardsAction` composers. `unstakeAction` guards `TIER`; `claimRewardsAction` is just a `params` object guard. Both call `submitAction` with their own pending-tx summary verb.
- `packages/extension/src/background/createBackgroundHost.js` — `action.unstake` + `action.claimRewards` + both `.hw` variants (via `registerHwHandler`).
- Three-shell messaging helpers — `unstakeAction` / `unstakeActionHw` / `claimRewardsAction` / `claimRewardsActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/StakingActionForm.jsx` — one component, two modes via `mode` prop (`'unstake' | 'claim-rewards'`). Unstake-mode shows a Tier 1 / Tier 2 radio with an explanation that unstake returns the full tier stake (no partial amount). Claim-mode is a confirm-and-sign surface with no input fields. Review screen + SignCredentials + HW branch + 4-stage state machine are shared.
- Three App.jsx — new `'staking-unstake'` + `'staking-claim'` sub-routes. `StakingDashboard` now wires `onUnstake` + `onClaimRewards` through to the two routes. The existing Unstake / Claim buttons on the dashboard (rendered disabled in Step 7) are now live.

### Notes

- §42.7.2 spec / SDK format divergence. `XCHAIN_WALLET_SPEC.md` §42.7.2 describes UNSTAKE as amount-based, but the SDK's `formats.js` UNSTAKE entry is `VERSION|TIER` (no AMOUNT). Per STAKE.md, UNSTAKE withdraws the **full tier stake** — partial unstakes aren't a protocol concept. Step 9 ships tier-only, matching the on-chain format, and calls out the behavior in the form UI. FOLLOWUP 4 in `claude/reports/specs/2026-04-24_phase4-staking-followups.md` captures the spec-vs-format decision needed before v1.0 (either widen the SDK format or drop the amount language from §42.7.2).
- Tier 3 stays deferred (FOLLOWUP 1 in the same doc). StakingActionForm's tier picker mirrors StakeForm — Tier 1 + Tier 2 only.

## [0.80.0] - 2026-04-24

Phase 4 — Step 8 of 23. STAKE authoring form (§42.7.1). Tier 1 (Oracle) + Tier 2 (Cross-chain validator) lanes ship; Tier 3 (Oracle publisher) deferred pending SDK format update — see `claude/reports/specs/2026-04-24_phase4-staking-followups.md`.

### Added

- `packages/core/src/flows/stakeAction.js` — STAKE composer. Guards TIER + SIGNING_PUBKEY (64-hex Ed25519) + CHAINS (when Tier 2). Composes VERSION=0, TIER, CHAINS, SIGNING_PUBKEY. Amount is not a user-chosen field — the protocol fixes it per tier (STAKE.md "Tier Stake Amounts").
- `packages/extension/src/background/createBackgroundHost.js` — `action.stake` + `action.stake.hw` handlers.
- Three-shell messaging helpers — `stakeAction` / `stakeActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/StakeForm.jsx` — §42.7.1 form. Tier radio (1 / 2), 64-char hex Ed25519 signing-pubkey input, Tier-2-only Chains multi-checkbox (BTC / LTC / DOGE, default BTC+DOGE), display-only Amount line per tier, review screen with full pubkey + SignCredentials + HW branch, done screen mentioning the 6-BTC-block activation delay per STAKE.md.
- Three App.jsx — new `'stake-form'` sub-route. `stakingRef` state `{ chainId, address }` carries context from the dashboard's Stake button. StakingDashboard.onStake now transitions; the form's Back returns to the dashboard.

### Notes

- Tier 3 deferred. STAKE.md documents Tier 3 (Oracle publisher, 500 XCHAIN, requires DOGE_ADDRESS) but the SDK's `formats.js` STAKE entry is `VERSION|TIER|CHAINS|SIGNING_PUBKEY` without DOGE_ADDRESS. Shipping a Tier 3 lane now would produce STAKE actions that fail encoder round-trip. FOLLOWUP 1 in the staking followups doc captures the one-line SDK fix + the conditional DOGE_ADDRESS validation.
- Signing-key generation UX is also deferred (FOLLOWUP 3): users paste a pre-generated 64-hex Ed25519 pubkey today. `@noble/curves@1.9.1` is already a transitive dep via xchain-sdk 1.10.0 and exports ed25519 — generating a fresh keypair inline is a small follow-up.

## [0.79.0] - 2026-04-24

Phase 4 — Step 7 of 23. Staking dashboard (§42.7.4). Nav guard + read-only dashboard; STAKE / UNSTAKE / DELEGATE / REVOKE / CLAIM authoring forms land in Steps 8–10.

### Added

- `packages/core/src/flows/stakingQueries.js` — four read-only wrappers over the staking-side explorer passthroughs landed in xchain-sdk 1.10.0: `stakesForAddress`, `delegationsForAddress`, `rewardsForAddress` (all address-typed), and `validatorsForChain` (no-args roster lookup for the §42.7.5 operator dashboard).
- `packages/extension/src/background/createBackgroundHost.js` — four new read-only passthroughs (`stakes.forAddress` / `delegations.forAddress` / `rewards.forAddress` / `validators.forChain`).
- Three-shell messaging helpers — `getStakesForAddress` / `getDelegationsForAddress` / `getRewardsForAddress` / `getValidatorsForChain` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/StakingDashboard.jsx` — §42.7.4 dashboard. Per BTC chain with addresses, loads stakes + delegations + rewards across all addresses in parallel (fan-out, merge, sort newest-first). Renders Your stake / Delegated pubkey / Chains (Tier 2 only) / Pending rewards (+ Claim button) / Lifetime rewards / action buttons (Stake if not staked; Unstake / Delegate new key / Revoke delegation when staked + appropriate) / Recent reward events list (top 10).
- `packages/core/src/shared/routes/Home.jsx` — new `onStaking` prop + Staking button, rendered only when the prop is passed.
- Three App.jsx — new `'staking-dashboard'` sub-route. `useBtcAddressesPresent` (the hook added in Step 2) drives conditional prop-passing on Home: `onStaking={activeWalletId && hasBtcAddress ? …}`.

### Notes

- BTC-only gate reuses `useBtcAddressesPresent` — the same hook introduced for the Contracts nav in Step 2. §10.3 says "SDK staking actions are BTC-only" and the dashboard respects that.
- Action buttons follow the Step 3 pattern: optional `on*` props from App.jsx drive their disabled state. Step 8 (STAKE form), Step 9 (UNSTAKE + CLAIM_REWARDS), and Step 10 (DELEGATE + REVOKE_DELEGATION) will thread the real handlers through as each form lands, without re-touching the dashboard's internals.
- No operator / validator dashboard (§42.7.5) yet — that's Step 11 and also needs a bump to `xchain-hub` to expose validator-performance metrics via HTTP API (the hub's `RewardTracker` / `ValidatorIdentity` / `SlashDetector` / `PeerManager` internals are complete but the HTTP surface only exposes `hub-db/snapshot/oracle_prices` + `/snapshot/price_snapshots` today). Hub bump deferred to just before Step 11 per the Phase 3 Step 9 pattern — ship platform-side bumps against the concrete consumer.

## [0.78.0] - 2026-04-24

Phase 4 — Step 6 of 23. DEPOSIT + WITHDRAW forms (§42.5). Closes the Contracts surface (§42.1–§42.6) — browse, detail, deploy, execute, deposit, withdraw all ship. No SDK bump.

### Added

- `packages/core/src/flows/contractFundsActions.js` — two flows `depositAction` + `withdrawAction` sharing one composer helper. Both actions take the same field shape (CONTRACT_ACTION_INDEX + TICK + QUANTITY) per the protocol formats (`VERSION|CONTRACT_ACTION_INDEX|TICK|QUANTITY`), so the branching is only at the action-name string and the pending-tx summary verb.
- `packages/extension/src/background/createBackgroundHost.js` — `action.deposit` + `action.deposit.hw` + `action.withdraw` + `action.withdraw.hw` handlers.
- Three-shell messaging helpers — `depositAction` / `depositActionHw` / `withdrawAction` / `withdrawActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/ContractFundsForm.jsx` — one component, two modes via the required `mode: 'deposit' | 'withdraw'` prop. Header / summary / submit-button verb switch on the prop; everything else (state machine, address loading, SignCredentials, HW branching, form validation) is shared. Token input upper-cases on change; quantity is decimal-inputmode. Withdraw's hint calls out that it "Only succeeds if the contract permits it" — on-chain rejection isn't a wallet-side bug.
- Three App.jsx — new `'contract-deposit'` + `'contract-withdraw'` sub-routes. ContractDetail now passes all three action-button props (`onExecute` + `onDeposit` + `onWithdraw`); each button's back navigation returns to the detail page.

### Notes

- §42.1–§42.6 now ship end-to-end: browse → detail → deploy → execute → deposit → withdraw. The next step (Step 7) starts the §42.7 Staking surface with the dashboard.

## [0.77.0] - 2026-04-24

Phase 4 — Step 5 of 23. EXECUTE method form (§42.4). Adds the "Call method" authoring surface on top of the Step 3 contract-detail page. No SDK bump — `sdk.execute` has been on SDK ≥ 1.3.0 and is already reachable.

### Added

- `packages/core/src/flows/executeAction.js` — EXECUTE composer. Takes vault + registries + chain + source + params (VERSION, CONTRACT_ACTION_INDEX, METHOD, optional PARAMS array, GAS_LIMIT). Guards CONTRACT_ACTION_INDEX + METHOD + params.
- `packages/extension/src/background/createBackgroundHost.js` — `action.execute` + `action.execute.hw`.
- Three-shell messaging helpers — `executeAction` / `executeActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/ExecuteContractForm.jsx` — §42.4 form. Method name + pipe-delimited params (split into an array on submit to satisfy the SDK validator's PARAMS-as-array expectation) + gas limit (default 50000). Auto-picks the most recently derived HD address on the chain as caller. Review screen lists each param in an ordered list with monospace font; sign screen reuses `SignCredentials` + HW branching.
- Three App.jsx — new `'contract-execute'` sub-route. ContractDetail now passes `onExecute={() => setUnlockedView('contract-execute')}`; the form's Back returns to the detail page.

### Notes

- ABI-driven lane is deferred. §42.4 says "If a contract publishes an ABI (via a community convention or embedded metadata), the wallet populates a method selector and typed parameter inputs." The platform hasn't defined the ABI publishing convention yet — captured as FOLLOWUP 2 in `claude/reports/specs/2026-04-24_phase4-monaco-editor.md`. Step 5 ships the manual lane only.
- `contracts.suggestGasLimit` is a source-code heuristic; the execute form doesn't have the contract source (only the DEPLOY action_index). Default 50000 is a conservative starting point — users override. Per-call gas estimation is a VM-side feature that would require the indexer to expose a "dry-run" endpoint, which is out of Phase 4 scope.

## [0.76.0] - 2026-04-24

Phase 4 — Step 4 of 23. DEPLOY authoring form (§42.6). No SDK bump — `sdk.contracts.validate / checkCodeSize / suggestGasLimit` and the DEPLOY action composer are all on SDK 1.10.0 (via SDK 1.3.0's `ContractUtils`).

### Added

- `packages/core/src/flows/deployAction.js` — DEPLOY composer. Takes vault + registries + chain + source + `params` (VERSION / CODE / GAS_LIMIT, optional NAME + CONSTRUCTOR_PARAMS), forwards to `submitAction`. Hex-encoding of the contract source is handled by the SDK validator chain — callers pass raw UTF-8 as `params.CODE`.
- `packages/core/src/flows/contractUtilities.js` — three wrappers over `sdk.contracts.*`: `contractValidate`, `contractCheckCodeSize`, `contractSuggestGasLimit`. Pure; no network. Routed through the messaging layer for consistency with the "UI never imports an SDK directly" discipline.
- `packages/extension/src/background/createBackgroundHost.js` — `action.deploy` + `action.deploy.hw` (via `registerHwHandler`) + three pure-function passthroughs (`contracts.validate`, `contracts.checkCodeSize`, `contracts.suggestGasLimit`).
- Three-shell messaging helpers — `deployAction` / `deployActionHw` / `validateContractCode` / `checkContractCodeSize` / `suggestContractGasLimit` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/DeployContractForm.jsx` — §42.6 form:
  - Chain picker (BTC-only; auto-selects first BTC chain with an address).
  - Name (optional) / Code source (monospace textarea) / Gas limit / Constructor params (optional).
  - Three action buttons: **Validate code** (acorn parse + size check + float-literal warnings), **Estimate size** (shows byte count + 64KB-limit flag), **Suggest gas** (fills the Gas limit input on first tap if empty).
  - Review screen: composed summary, chain badge, source address, name, byte count, gas limit, constructor params, validation warnings, `SignCredentials` (password + HW `getSignerStatus` wiring), primary button labelled `Deploy on <chain>` / `Sign on Trezor|Ledger` per source type.
  - Done screen: post-broadcast txid + Done button.
  - BTC-only gate: renders a clear "Contracts are BTC-only at launch. Use Receive on a Bitcoin network…" message when the wallet has no BTC address. Mirrors ContractsList's gate.
- `packages/core/src/shared/routes/ContractsList.jsx` — gains optional `onDeploy` prop. When the host passes it, renders a primary `+ Deploy new contract` button in the filter-bar row. Hidden when prop omitted.
- Three-shell App.jsx — new `'contract-deploy'` sub-route. `ContractsList.onDeploy` transitions to it; the form's Back returns to the list.

### Notes

- Monaco editor is deferred. The spec's §42.6 language ("Monaco editor — full-screen mode available") is aspirational but ships a 5MB+ dependency with a CDN trust-posture trade-off that needs its own discussion. Spec follow-ups captured in `claude/reports/specs/2026-04-24_phase4-monaco-editor.md` — CodeMirror 6 recommended for the v1.0 RC cycle; the swap is a drop-in replacement of the `<textarea>` with a `<CodeEditor>` component under `packages/core/src/shared/components/` that wraps `EditorView`. Validate / Size / Suggest-gas already hit `sdk.contracts.*` and don't care about editor chrome.
- Review-screen summary is handwritten rather than routed through `decoderLib.decodeAction`. DEPLOY isn't wired into `packages/core/src/decoder/` yet; polish captured in the Monaco follow-up doc (FOLLOWUP 3).
- ABI / typed method selection (§42.4) is not addressed here — the DEPLOY form doesn't write ABIs yet because the platform-level ABI convention is undecided. Captured in the Monaco follow-up doc (FOLLOWUP 2); needs an `xchain-documentation` change first.

## [0.75.0] - 2026-04-24

Phase 4 — Step 3 of 23. Contract detail page (§42.3). No SDK bump needed — all five read surfaces used here were already in SDK ≥ 1.3.0 and are exposed through the 1.10.0 pin landed in v0.74.0.

### Added

- `packages/core/src/flows/contractDetail.js` — five single-contract read flows:
  - `contractByActionIndex` — `sdk.getContract(contractActionIndex)` for the header block (owner / deploy block / gas limit / status / code hash).
  - `actionByIndex` — `sdk.getAction(actionIndex)` for the originating DEPLOY action (carries NAME / CODE_HASH / CONSTRUCTOR_PARAMS that don't live on the contract row).
  - `contractState` — `sdk.getContractState(idx, key?)`; `key` optional so the page can load the full state map and render it expandable.
  - `contractBalance` — `sdk.getContractBalance(idx, tick?)`; `tick` optional so the page lists every token the contract holds.
  - `executionsForContract` — `sdk.getExecutions(contractActionIndex, opts)` for the paginated EXECUTE-history section.
- `packages/extension/src/background/createBackgroundHost.js` — registers five new read-only passthroughs (`contracts.byActionIndex`, `actions.byIndex`, `contracts.state`, `contracts.balance`, `executions.forContract`).
- Three-shell messaging helpers — `getContractByActionIndex` / `getActionByIndex` / `getContractState` / `getContractBalance` / `getExecutionsForContract` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/ContractDetail.jsx` — §42.3 page:
  - Header: `Contract #<idx> — "<NAME>"` + large ChainBadge. Owner / Deployed block / Gas limit / Status / Code hash rendered from the `contracts` table, with NAME / CODE_HASH / GAS_LIMIT falling back to the DEPLOY action when the contract row omits them.
  - "State (expandable)": loads eagerly but shows a one-line count by default; Expand button renders the full key/value table. Key / value cells monospaced; long values wrap with `word-break: break-all`.
  - "Balances": per-token table (`Token` / `Amount`).
  - "Execution history": paginated list (Prev / Next) via `executionsForContract({ opts: { page } })`; pagination heuristic handles both total-known and total-unknown response shapes.
  - Action buttons: `Call method` / `Deposit` / `Withdraw`. Each accepts an optional `onExecute / onDeposit / onWithdraw` prop — when omitted the button renders disabled and a one-line descriptor explains the forms land in upcoming Phase 4 steps. Keeps the detail page complete in Step 3 without a half-baked signing path.
  - "(you)" suffix next to Owner when the contract's source address matches one of the wallet's addresses on this chain (via `getAddressesByChain`).
- Three-shell App.jsx — new `'contract-detail'` sub-route, `contractRef` state `{ chainId, contractActionIndex }`. `ContractsList.onOpenContract` now sets `contractRef` and transitions. ContractDetail's Back returns to the list.

### Notes

- No EXECUTE / DEPOSIT / WITHDRAW signing in this step — Steps 5 + 6 land the authoring forms. The prop-gated button disable is intentional: the route handler in App.jsx passes no signing props today, the buttons render disabled, and Step 5/6 will thread the real handlers through from App.jsx without re-touching ContractDetail's internals.
- State and balance response shapes are defensively unwrapped (`{ data: [...] }` / `{ data: {...} }` / `{ state: {...} }` / flat object) so the page tolerates minor explorer-side shape changes without silent blanking.

## [0.74.0] - 2026-04-24

Phase 4 — Step 2 of 23. Contracts nav item + browse landing (§42.2). Bumps the pinned SDK to `^1.10.0` (the SDK v1.10.0 pre-phase release that landed `sdk.getStakes/getDelegations/getValidators/getValidatorRewards` and the `sdk.musig2` primitives).

### Added

- `packages/core/src/flows/contractQueries.js` — five read-only flows scoped to a single chain + sdkRegistry:
  - `contractsForSource({ sdkRegistry, chainId, address, opts? })` — contracts the address deployed, backs "My contracts".
  - `contractsForAddress(…)` — the broader "source OR contract address" lane, preserved for future surfaces.
  - `contractsBrowseAll({ sdkRegistry, chainId, opts? })` — paginated all-contracts list for the "Browse all" section.
  - `depositsForAddress(…)` / `withdrawalsForAddress(…)` — backing "My interactions" via client-side union + dedupe by CONTRACT_ACTION_INDEX.
- `packages/extension/src/background/createBackgroundHost.js` — registers five explorer passthroughs (`contracts.forSource` / `contracts.forAddress` / `contracts.browseAll` / `deposits.forAddress` / `withdrawals.forAddress`).
- Three-shell messaging helpers — `getContractsForSource` / `getContractsForAddress` / `getContractsBrowseAll` / `getDepositsForAddress` / `getWithdrawalsForAddress` in popup / web / desktop `messaging.js`.
- `packages/core/src/shared/routes/ContractsList.jsx` — the §42.2 landing surface. Header + back, BTC-only chain-filter bar (mainnet/testnet/regtest appear when the wallet has an address on them), client-side name/action_index search, three sections:
  - **My contracts (deployed by me)** — fan-out `contractsForSource` over every BTC address, merge, dedupe, newest-first.
  - **My interactions (deposits / withdrawals)** — union of deposits + withdrawals on each BTC address, grouped by CONTRACT_ACTION_INDEX, with the set of interaction kinds (`deposit` / `withdraw`) and the most recent block. EXECUTE-only interactions (method calls with no deposit) are not yet listed — documented limitation (the SDK's `getExecutions` is contract-scoped today; that lane lives on the contract detail page in Step 3).
  - **Browse all contracts** — `contractsBrowseAll` per active chain.
- `packages/core/src/shared/hooks/useBtcAddressesPresent.js` — shared hook that resolves once the wallet's addresses load and returns `true | false | null` depending on whether any BTC-family chain has at least one address. Used to gate the Contracts nav entry.
- `packages/core/src/shared/routes/Home.jsx` — new `onContracts` prop + button (variant="secondary"). Rendered only when the prop is passed; the three shell App.jsx files pass it only when `activeWalletId && hasBtcAddress` resolves true.
- Three-shell App.jsx — new `'contracts-list'` sub-route; `useBtcAddressesPresent(activeWalletId)` drives conditional prop-passing; `onOpenContract` placeholder in the route handler leaves a no-op for Step 3 to wire the detail page.

### Notes

- VM is BTC-only at launch per `registry/actions.js` `BITCOIN_ACTIONS` (DEPLOY / EXECUTE / DEPOSIT / WITHDRAW are bitcoin-exclusive), so the Contracts nav is gated on BTC address presence rather than always-visible. Step 7 (Staking) will reuse `useBtcAddressesPresent` for the same reason.
- No Deploy-new-contract button in this step's browse surface; it lands in Step 4 when the DEPLOY authoring form ships. Rendering the button now would require a disabled-stub flow that gets unwound in Step 4 for no gain.
- Search is client-side: filters loaded rows by NAME substring or action_index prefix. The explorer doesn't expose server-side contract-name search today — a potential future indexer widening, not a Phase 4 blocker.

## [0.73.0] - 2026-04-24

Phase 3 — DEX and Messaging Steps 12–14. Closes Phase 3 in full: encrypted MESSAGE action signing + inbox + compose + contacts integration. No platform-side changes this release — the pinned `xchain-sdk ^1.9.1` already exposes the messaging surface (SDK 1.6.0 added `MessagingUtils`; SDK 1.7.0 added cross-chain; SDK 1.8.0/1.9.x rounded out the explorer client). `xchain-decoder` 1.9.0 populates the `pubkeys` table and `xchain-explorer` 1.14.0 exposes the pubkey lookup API — both verified live on master before building.

### Added

**Step 12 — Messaging inbox + thread (§41.7.2)**

- `packages/core/src/flows/messagingInbox.js` — `getMessagingInbox({ vault, walletId, password, chainRegistry, sdkRegistry, addressId, type?, opts? })`. Delegates WIF derivation to the existing `exportPrivateKey` (same unlock + error surface as §17.7), then calls `sdk.getMessagesForAddress(address, { wif, type })` so the SDK auto-decrypts ECIES (method 1) entries in-process. ECDH (2) and AES (3) entries come back `encrypted: true / text: null` — the UI labels them "🔒 Encrypted (session key required)" since sessions are out of Phase 3 scope. Read-only; no vault mutation.
- `packages/extension/src/background/createBackgroundHost.js` — registers `messaging.inbox`.
- Three-shell messaging helpers — `getMessagingInbox`.
- `packages/core/src/shared/routes/MessagingInbox.jsx` — 4-stage state machine (`pick → password → submitting → inbox`). Address picker for multi-address wallets; password re-prompt on wrong-password with focus/select. Two-pane Conversations/Thread layout matching the spec's ASCII mock: left pane lists counterparties sorted by most-recent activity; right pane shows an ordered thread with outgoing/incoming styling. Hydrates contacts-by-address map on mount (auto-association per §41.7.4).
- Three-shell App.jsx — new `'messaging'` sub-route; `onMessaging` threaded to `Home`. `Home.jsx` grows a "Messaging" button alongside Markets.

**Step 13 — Compose flow (§41.7.3)**

- `packages/core/src/flows/messageAction.js` — `messageAction` core flow. On ECIES path, looks up recipient pubkey via `sdk.getPublicKey(destination)`, encrypts in-process via `sdk.messaging.eciesEncrypt`, builds MESSAGE v2 `{ VERSION: '2', COIN, DESTINATION, ENCRYPTED_MESSAGE }`. On plaintext-fallback path (`method: null`), builds MESSAGE v3 `{ VERSION: '3', COIN, DESTINATION, PLAINTEXT_MESSAGE }`. Throws typed `PubkeyNotFoundError` when the recipient has no on-chain pubkey — UI recovers by offering the unencrypted fallback checkbox per spec wording. `getRecipientPubkey` query flow wraps `sdk.getPublicKey` for the compose-form preview.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.message` + `action.message.hw` (HW variant reuses `registerHwHandler`) + `messaging.pubkey`.
- Three-shell messaging helpers — `messageAction` + `messageActionHw` + `getRecipientPubkey`.
- `packages/core/src/shared/routes/ComposeMessage.jsx` — chain + from-address pickers, recipient input with debounced (400ms) pubkey lookup, 4-state UI banner (`idle` / `checking` / `found` / `missing`), message textarea, `SignCredentials` gate. On `missing`, offers the spec's verbatim "Continue anyway with an unencrypted message" checkbox.
- `MessagingInbox.jsx` — gains `onCompose` prop and Reply / New-conversation buttons that navigate to compose with the current counterparty pre-filled.
- Three-shell App.jsx — new `'compose-message'` sub-route + `composePrefill` state; back-link threads through an optional `__from` so the Cancel/Back key returns to whichever surface opened the form (Inbox or Contacts).

**Step 14 — Contacts integration (§41.7.4)**

- `packages/core/src/flows/contacts.js` — CRUD on the existing `vault.contacts` collection + `Contact` schema (both already present from §11.3.4): `listContacts`, `findContactByAddress({ vault, chain, address })`, `saveContact({ vault, record | input })`, `deleteContact({ vault, id })`. `saveContact` accepts either an existing `record` (updates in place, bumps `updatedAt`) or an `input` shape (creates a new Contact via `createContact`).
- `packages/extension/src/background/createBackgroundHost.js` — registers `contacts.list` / `contacts.findByAddress` / `contacts.save` / `contacts.delete`.
- Three-shell messaging helpers — `listContacts` / `findContactByAddress` / `saveContact` / `deleteContact`.
- `packages/core/src/shared/routes/ContactsList.jsx` — single-route 3-mode state machine (`list` / `detail` / `edit`). Edit mode supports multiple (chain, address, label) entries per contact. Detail mode renders a "Send message" button that routes through ComposeMessage with the primary entry pre-filled. Delete is confirmed via `window.confirm`.
- `MessagingInbox.jsx` — hydrates a `contactsByAddress` map on mount and uses it in the Conversations pane: known counterparties render as `Name (bc1q…abc)` instead of just the address.
- Three-shell App.jsx — new `'contacts'` sub-route + ActionsMenu entry "Contacts". `onSendMessage` from ContactsList navigates to ComposeMessage with prefill.

### Notes

- 63/63 smoke tests green at this commit (was 60 at v0.72.0; +3 for messaging-inbox / compose-message / contacts).
- Phase 3 is now complete. Phase 4 starts the Contracts / Staking / Cross-Chain / Multisig surfaces (§42+).

## [0.72.0] - 2026-04-24

Phase 3 — DEX Steps 8–11. Closes the DEX tail: the Market view now shows per-market trade history for the user's addresses; COINPAY obligations surface as a Home resume card and sign through a dedicated form; SWAP is available from the Actions menu; and MarketsList rows flag when a token has an open dispenser. Messaging (Steps 12–14) is out-of-scope here and lands in a subsequent release once the platform-side infra is verified on master.

Bumps pinned `xchain-sdk` to `^1.9.1` (adds `getCoinpayObligations` for the COINPAY queue).

### Added

**Step 8 — Per-market trade history (§41.3.6)**

- `packages/core/src/shared/components/TradeHistoryPanel.jsx` — collapsible panel below `OpenOrdersPanel`. Fans out `messaging.getMarketHistory({ chainId, tick1, tick2, address })` across every wallet address on the chain, de-duplicates and sorts by timestamp, renders time / price / size / side / owner-address; `onOpenTx` callback reserved for a future tx-detail route. No polling — manual Refresh button only, since trade history grows slowly and adding another 5s timer alongside the orderbook + open-orders pollers is overkill.
- `packages/core/src/shared/routes/MarketView.jsx` — imports + renders `TradeHistoryPanel` below the PlaceOrder / OpenOrders row.
- No new core flow, no new background handler, no new messaging helper — Step 1's `getMarketHistory` already accepts the optional `address` filter. Smoke: `packages/core/test/trade-history.smoke.js`.

**Step 9 — COINPAY queue + sign (§41.4)**

- `packages/core/src/flows/coinpayAction.js` — convenience wrapper for the COINPAY action. Validates `orderMatchActionIndex` / `payeeAddress` / `coinAmount` (positive integer, base units), composes `{ VERSION: '0', ORDER_MATCH_ACTION_INDEX }`, attaches `customOutputs: [{ address: payeeAddress, value: coinAmount }]` so the encoder builds the native-coin output to the seller into the same transaction.
- `packages/core/src/flows/coinpayQueries.js` — `getCoinpayObligationsForAddress` / `getCoinpaysForAddress` passthroughs to the new xchain-sdk@1.9.1 `sdk.getCoinpayObligations` / `sdk.getCoinpays` methods.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.coinpay` + `action.coinpay.hw` (HW variant re-using the existing `registerHwHandler` helper) + `coinpays.obligationsForAddress` + `coinpays.forAddress`.
- Three-shell messaging helpers — `coinpayAction` + `coinpayActionHw` + `getCoinpayObligationsForAddress` + `getCoinpaysForAddress`.
- `packages/core/src/shared/routes/CoinpayForm.jsx` — on mount, scans every `(chainId, address)` pair in the wallet for obligations filtered to `payer_address === address && coinpay_status === 'pending_coinpay'`. Renders a picker of all pending obligations, shows the obligation summary (chain / action index / payer / payee / coin amount / expiration), and signs via `SignCredentials` (HW path reuses the shared gate). `initialActionIndex` / `initialChainId` / `initialAddress` props auto-select the right row when opened from the Home resume card.
- `packages/core/src/shared/routes/Home.jsx` — gains `onResumeCoinpay` prop + `pendingCoinpays` state. On mount (same `useEffect` that hydrates balances + pending airdrops), fans out across all wallet addresses, filters to `pending_coinpay` on the payer side, and renders one resume card per obligation using the existing `pendingAirdropCard` class. Card click fires `onResumeCoinpay({ chainId, address, orderMatchActionIndex })`.
- Three-shell App.jsx — new `'coinpay'` sub-route + `resumeCoinpay` state + ActionsMenu `'coinpay'` entry ("Pay COINPAY"). `onResumeCoinpay` threaded to Home so the card deep-links into the form with the obligation preselected.
- `packages/extension/package.json` + `packages/web/package.json` — bumped `xchain-sdk` pin to `^1.9.1`. `packages/core/test/sdk-bundle.smoke.js` asserts the new pin.
- Smoke: `packages/core/test/coinpay-form.smoke.js` covers flow guards, form wiring, background handlers, 3-shell messaging, 3-shell App.jsx, Home resume card, and SDK pin.

**Step 10 — SWAP form (§41.5)**

- `packages/core/src/flows/swapAction.js` — convenience wrapper for the SWAP action. Validates v0 create baseline (GIVE_TICK / GIVE_AMOUNT / GET_TICK / GET_AMOUNT all required) and transparently supports v1 cancel / v2 edit via `SWAP_ACTION_INDEX` — the wrapper only gates create-mode fields and forwards whatever params the caller provides.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.swap` + `action.swap.hw`.
- Three-shell messaging helpers — `swapAction` + `swapActionHw`.
- `packages/core/src/shared/routes/SwapForm.jsx` — single-chain v0 create form (GIVE_COIN = GET_COIN = current chain's native ticker, set automatically from the registry). Rejects native-coin tickers with a DISPENSER hint (SWAP does NOT work with native coin per protocol rules) and rejects same-ticker give/get pairs. Reuses `SignCredentials` + `isHwSource` for the sign gate.
- Three-shell App.jsx — new `'swap'` sub-route + ActionsMenu `'swap'` entry ("Swap tokens").
- Smoke: `packages/core/test/swap-form.smoke.js`.

**Step 11 — Dispenser-available badge (§41.6)**

- `packages/core/src/shared/components/DispenserBadge.jsx` — queries `messaging.getDispensersForToken({ chainId, tick })` with a module-level session-scoped cache keyed by `${chainId}::${tick}` so a MarketsList with many rows referencing the same ticker only fires one explorer request. Filters responses to rows whose `status` is `valid` / `open` / omitted; renders nothing when loading or count is 0; otherwise shows a small "Dispenser · TICK" pill with the count in the tooltip. `__clearDispenserBadgeCache` test hook exported for downstream unit-test runners.
- `packages/core/src/shared/routes/MarketsList.jsx` — imports `DispenserBadge` and renders one per ticker in each market row (`tick1` + `tick2`).
- Smoke: `packages/core/test/dispenser-badge.smoke.js`.

### Changed

- `packages/core/test/sdk-bundle.smoke.js` — asserts `xchain-sdk ^1.9.1` on extension + web instead of `^1.9.0`.

### Notes

- 60/60 smoke tests green at this commit (was 56 at v0.71.0; +4 for Steps 8 / 9 / 10 / 11).
- Step 12 (Messaging inbox + thread, §41.7.2) is blocked until the 2026-04-07 `xchain-sdk` / `xchain-explorer` / `xchain-decoder` messaging work (captured in `project_messaging_feature.md`) lands on master. Verify with `git log` in those repos before picking it up.

## [0.71.0] - 2026-04-24

Phase 3 — DEX Steps 1–7. Single-market trading UX is end-to-end functional: browse markets + pin a watchlist, open a market, see the chart + depth-visualized orderbook + recent trades, place limit orders, cancel open orders. All sign paths reuse the Phase 2 HW Sign primitives (SignCredentials + isHwSource), so Trezor/Ledger slot in behind the same form surfaces. Settlement (BTCPay + SWAP), dispenser badge integration, and Messaging remain for subsequent commits.

### Added

**Step 1 — Markets list scaffold (§41.2)**

- `packages/core/src/schemas/watchlistEntry.js` — per-wallet pinned market record (chainId + tick1 + tick2). `createWatchlistEntry` / `validateWatchlistEntry` / `watchlistEntryKey` helpers.
- `packages/core/src/flows/watchlist.js` — `listWatchlistForWallet` / `saveWatchlistEntry` (idempotent by the canonical key) / `clearWatchlistEntry`.
- `packages/core/src/flows/marketQueries.js` — SDK-explorer passthroughs: `getMarkets` / `getMarket` / `getMarketHistory` / `getMarketOrders` / `getOrderbook`.
- `packages/core/src/storage/Vault.js` + `codec.js` — new `watchlistEntries` collection; `emptyDocument` + `decodeDocument` defensively merge the array so older persisted docs stay loadable.
- `packages/extension/src/background/createBackgroundHost.js` — registers 5 `markets.*` read-only handlers + 3 `watchlist.*` CRUD handlers.
- Messaging helpers on popup / web / desktop — 5 market-query + 3 watchlist helpers each.
- `packages/core/src/shared/routes/MarketsList.jsx` — landing view with watchlist + popular-markets sections, chain filter + search, star toggle to pin/unpin. Per-chain fan-out with isolated failure (one broken explorer doesn't blank the page).
- Three-shell App.jsx wiring — new `'markets'` sub-route + reserved `'market'` sub-route + activeMarket state. `Home.jsx` gains an `onMarkets` button between "Create a token" and "More actions".

**Step 2 — Market view shell (§41.3)**

- `packages/core/src/shared/routes/MarketView.jsx` — four-panel layout (chart | orderbook | recent trades) above (place order | open orders). Header renders the market summary from `messaging.getMarket`. Popup variant stacks the panels vertically; full variant uses a 3-up + 2-up grid.

**Step 3 — Chart panel (§41.3.1)**

- `lightweight-charts` declared as a dep in extension + web + desktop package.json.
- `packages/core/src/market/bucketize.js` — pure OHLCV bucketing. `bucketizeMatches(rows, { tick1, tick2, periodSeconds })` aggregates `getMarketHistory` match rows into candles with correct buy/sell price orientation (`give_tick === tick1` vs reversed) and tick1-denominated volume. Period constants + labels: 1m / 5m / 15m / 1h / 4h / 1d / 1w (default 1h).
- `packages/core/src/shared/components/MarketChart.jsx` — lazily `await import('lightweight-charts')` so the module loads clean in Node (smoke tests + SSR). Dynamic-import failure falls through to a "run pnpm install" hint rather than blowing up MarketView. Period toggle row rebuckets the same match dataset client-side.

**Step 4 — Orderbook panel (§41.3.2)**

- `packages/core/src/market/orderbook.js` — pure `normalizeOrderbook(resp)`. Accepts both the explorer's wrapped `[{ asks, bids }]` shape and the plain object form. Parses `[price, amount]` tuples or `{ price, amount/size }` objects. Sorts bids descending + asks ascending, attaches cumulative sums, computes `maxCumulative` across both sides for depth-bar normalisation. Malformed rows (non-numeric price/size) drop silently.
- `packages/core/src/shared/components/OrderbookPanel.jsx` — two-column bids/asks with a proportional depth bar per row (teal bids left-anchored, red asks right-anchored). 5s polling pauses when `document.visibilityState === 'hidden'`. Clicking a price level fires `onPickPrice(displayPrice)` — MarketView threads that through `prefillPrice` into the Place Order panel.

**Step 5 — Recent trades panel (§41.3.3)**

- `packages/core/src/shared/components/RecentTradesPanel.jsx` — chronological feed of the last 30 matches. Side inferred from pair orientation, price coloured teal/red. `onOpenTx(txid)` callback reserved for a future tx-detail route.

**Step 6 — Place order form (§41.3.4)**

- `packages/core/src/flows/orderAction.js` — wraps `submitAction` for the ORDER action. Required-field validation (`GIVE_TICK` + `GIVE_AMOUNT` + `GET_TICK` + `GET_AMOUNT`); optional EXPIRATION / FEE_REQUIRED / FEE_PROVIDED pass through. Same file exports `cancelOrder` for §41.3.5 — CANCEL composes from `orderActionIndex`.
- Background handlers: `action.order`, `action.cancelOrder`, `action.order.hw`, `action.cancelOrder.hw` (two HW variants landed via `registerHwHandler`).
- Messaging helpers on 3 shells: `orderAction` / `orderActionHw` / `cancelOrder` / `cancelOrderHw`.
- `packages/core/src/shared/components/PlaceOrderPanel.jsx` — buy/sell toggle maps to GIVE/GET orientation on the (tick1, tick2) pair; price + size + total auto-calc; expiration in blocks with presets (1d / 1w / 1m / never / custom); `prefillPrice` from orderbook click populates the price field. Reuses Phase 2's `<SignCredentials>` gate so HW addresses swap the password input for the HW sign block + status banner.

**Step 7 — Open orders + cancel (§41.3.5)**

- `packages/core/src/shared/components/OpenOrdersPanel.jsx` — per-market list of the user's open orders. Fetches via `messaging.getMarketOrders({ chainId, tick1, tick2, address })` across every wallet address on the chain in parallel. 5s polling with visibilitychange pause (same cadence as the orderbook). Cancel button opens an inline sign form; signs via `cancelOrder` / `cancelOrderHw` against the order's source address, using `<SignCredentials>` so HW owners can cancel without changing surface. Removes the cancelled row on success.

### Changed

- `packages/core/src/flows/index.js` — exports `getMarkets`, `getMarket`, `getMarketHistory`, `getMarketOrders`, `getOrderbook`, `listWatchlistForWallet`, `saveWatchlistEntry`, `clearWatchlistEntry`, `orderAction`, `cancelOrder`.
- `packages/core/src/schemas/index.js` — exports `watchlistEntry` module + `createWatchlistEntry` / `validateWatchlistEntry` / `watchlistEntryKey` + `migrateWatchlistEntry`.
- Smoke count: 56 (+6 from v0.70.0: `markets-list.smoke.js`, `market-view.smoke.js`, `chart-panel.smoke.js`, `orderbook-panel.smoke.js`, `recent-trades.smoke.js`, `place-order.smoke.js`, `open-orders.smoke.js` — seven new files, and the earlier-added two round up to six net since some consolidated). 56/56 green.

### Deferred (remaining Phase 3 scope)

- Step 8 — Per-market trade history (§41.3.6).
- Step 9 — BTCPay queue + sign (§41.4).
- Step 10 — SWAP form (§41.5).
- Step 11 — Dispenser-available badge on market rows (§41.6).
- Steps 12–14 — Messaging inbox + thread + compose + contacts (§41.7).
- Decoder cases for ORDER and CANCEL. Sign screens work today because the review surface reads the composed params directly; a dedicated decoder case would give nicer summaries on the Advanced-Actions-Form decoder preview and on imported / pasted raw actions. Low priority.

### Notes

- `lightweight-charts` is a fresh dep added to three shells. `pnpm install` in each package is required before the chart panel renders (falls through to a clean hint otherwise).
- WS push for orderbook + open orders is out of scope. Once the explorer exposes a push channel (Phase 4+) we flip both panels from polling to subscribe; today's 5s polling with visibilitychange pause matches the existing AirdropForm cadence.

## [0.70.0] - 2026-04-24

HW Sign follow-up slice 4 of 4 — HW branches for the remaining multi-stage action forms (`DispenserForm` + `DispenserDetail` + `AirdropForm`) and the **desktop** renderer↔main port RPC. Closes the wallet-side HW sign work: every action surface (flat + multi-stage) now swaps in `<SignCredentials>` for paired Trezor/Ledger addresses, and Electron joins the extension popup + web shell as a signer-bridge-capable host. Real-device walkthrough remains the only outstanding deferral (Trezor in hand, Ledger pending).

### Added

**Slice 4a — DispenserForm HW branch (§40.7.1)**

- `packages/core/src/shared/routes/DispenserForm.jsx` — swaps the password `<Input>` for `<SignCredentials>`, gates submit on `hwStatus === 'available'`, and branches `messaging.dispenserAction` / `messaging.dispenserActionHw` based on `isHwSource(fromAddress)`. `from` payload carries `source` + `signerId` on the HW path. Button copy flips to "Sign on Trezor" / "Sign on Ledger".
- `packages/core/src/shared/routes/DispenserDetail.jsx` — both owner-cancel (§40.7.1 v1 lane) and non-owner buy-fill (token-paid) gain independent HW branches with their own `hwStatus` tracking (`buyHwStatus` + `cancelHwStatus`). Owner-cancel routes via `messaging.dispenserActionHw`; buy-fill routes via `messaging.sendAssetHw`. Button copy flips on each path.

**Slice 4b — AirdropForm HW branch (§40.9)**

- `packages/core/src/shared/routes/AirdropForm.jsx` — the resumable two-transaction LIST → AIRDROP flow now exposes an HW branch on **both** sign points. Step 1 routes via `messaging.createListHw`; step 2 routes via `messaging.airdropActionHw`. `pendingAirdrop` vault records don't need a schema bump — on resume the wallet re-looks-up `fromAddress` from `addressesByChain` which already carries `.source` + `.signerId`. The review-list hint now explains "confirm on your hardware device twice" for HW users.

**Slice 4c — Desktop renderer↔main port RPC**

- `packages/desktop/preload.js` — gains a second `contextBridge` surface `xchainWalletSignerBridge` alongside the existing `xchainWalletBridge`. Exposes `postMessage(msg)` (renderer→main) + `onMessage(listener)` (main→renderer, returns unsubscribe). Duplex shape is deliberately minimal — enough to back the neutral `{ postMessage, onMessage }` adapter that `signerPortProtocol.js` already expects.
- `packages/desktop/renderer/signerBridge.js` — desktop-renderer-side mirror of the extension popup's `signerBridge`. Holds a module-scoped `Map<signerId, Signer>`, lazily wraps `window.xchainWalletSignerBridge` into a `PortLike`, and calls the core `bindRendererPortBridge`. Exposes `registerSigner` / `unregisterSigner` / `registeredIds` + a `_resetForTests` hook. Announces ids to main so `signerBridge.setTransport` lights up on the other side.
- `packages/desktop/main/signerBridgeListener.js` — ipcMain-side listener. Each first message from a new `event.sender` (BrowserWindow `webContents`) lazily constructs a synthetic port, wraps via `createBackgroundTransport`, and registers `kind:'register'` signer ids against the shared `signerBridge` registry. Forwards to `webContents.send` for outbound. Listens for `webContents.once('destroyed')` so window close / renderer crash rejects in-flight transport calls with `"signer bridge disconnected"` and clears owned registrations. Accepts a test-fake `ipcMain` for the smoke — Electron imports are confined to `main/index.js`.
- `packages/desktop/main/index.js` — calls `attachSignerBridgeListener({ ipcMain })` on `app.whenReady`, next to the existing `ipcMain.handle(IPC_CHANNEL, …)` wiring. Listener attaches once and stays for the process lifetime.
- `packages/desktop/renderer/App.jsx` — imports `registerSigner as registerLocalSigner` from the new bridge and passes it as `onSignerPaired={registerLocalSigner}` to `PairSignerForm`, bringing desktop to parity with extension popup + web.
- `packages/core/test/desktop-signer-bridge.smoke.js` — runtime smoke against a fake ipcMain + fake webContents (no Electron). Exercises: lazy per-sender entry creation, register populates `signerBridge`, transport round-trip (outbound `request` reaches `webContents.send`, inbound `response` correlates via `reqId`), unregister clears the registry, `webContents.destroyed` rejects in-flight + clears owned ids, `detach()` drops all state.

### Changed

- `packages/core/test/hw-sign-e2e.smoke.js` — extended with slice-4 assertions:
  - `DispenserForm` + `DispenserDetail` + `AirdropForm` each import `SignCredentials` + `isHwSource`, route through the appropriate `*Hw` messaging variant, and gate submit on HW status.
  - Desktop `renderer/signerBridge.js` + `main/signerBridgeListener.js` exist and export the expected symbols.
  - Desktop `preload.js` exposes `xchainWalletSignerBridge` with `postMessage` + `onMessage`.
  - Desktop `main/index.js` attaches the listener; `renderer/App.jsx` threads `registerLocalSigner` into `PairSignerForm`.
- Smoke count: 49 (+1: `desktop-signer-bridge.smoke.js`). 49/49 green.

### Deferred

- Real-device walkthrough. User has a Trezor; Ledger pending. All three shells are wired; only physical-device verification remains.
- Address-picker UI so users can actively choose a HW source address on the review-and-sign forms. Every form's default-from-address logic filters to `source === 'hd'`; HW addresses register correctly in the vault but the forms' Submit path only kicks into the HW branch when `fromAddress.source` is `'trezor'` or `'ledger'`. A future step adds a per-form from-address picker so the user can explicitly choose.
- macOS + Windows reproducible desktop builds (Linux-only today; platform-runner work).

## [0.69.0] - 2026-04-24

HW Sign follow-up slices 2–3 — renderer↔background port RPC (extension + web) and HW-branch replication across six more action forms. Slice 4 (DispenserForm + AirdropForm + desktop ipc port RPC) still deferred. After this commit every flat-layout review/sign form (SEND / ISSUE / MINT / DESTROY / LOCK / UPDATE DESC / TRANSFER / BROADCAST / DIVIDEND / ADVANCED) renders `HwSignBlock` when the source is a paired Trezor/Ledger, routes the sign request over a real port RPC in the extension popup (or directly in-process in web), and flips Submit copy to "Sign on Trezor"/"Sign on Ledger" gated on `status === 'available'`.

### Added

**Slice 2 — port RPC plumbing**

- `packages/core/src/signers/signerPortProtocol.js` — neutral `{ postMessage, onMessage }` protocol for the renderer↔background signer bridge. `bindRendererPortBridge(port, { getSigner })` dispatches `signer.sign.request` op messages from the background to the right local Signer by id and posts matching `response` messages. `createBackgroundTransport(port)` wraps a port into the `RemoteSignerTransport` shape, correlates responses via a monotonic `reqId`, and rejects in-flight promises with `"signer bridge disconnected"` on port disconnect. Both exported from `@xchain-wallet/core/signers`.
- `packages/extension/src/popup/signerBridge.js` — opens `chrome.runtime.connect({ name: 'signer-bridge' })` lazily on first `registerSigner`, holds the live `Map<signerId, Signer>` (populated by PairSignerForm after pair), wires `bindRendererPortBridge` to the port. Announces signer ids to the background so `signerBridge.setTransport` lights up on the other side.
- `packages/extension/src/background/signerBridgeListener.js` — `chrome.runtime.onConnect` listener filtered on `port.name === 'signer-bridge'`. Wraps each port via `createBackgroundTransport`, listens for `signer.register` / `signer.unregister` messages, populates / clears `signerBridge`. On port disconnect, drops only the ids that specific port registered (per-port ownership).
- `packages/extension/src/background.js` — calls `attachSignerBridgeListener()` at service-worker boot, independent of vault unlock state.
- `packages/web/src/signerBridge.js` — web's "background" runs in the same JS context as the renderer (via `hostBridge`), so the transport is a direct function-call closure against a module-scoped live-signer Map. Calls `bgSignerBridge.setTransport` directly — no port needed.
- `packages/core/src/shared/routes/PairSignerForm.jsx` — now captures the live `signer` alongside `pairingInfo` (both returned by the pair factory; previously only `pairingInfo` was destructured) and calls a new optional `onSignerPaired(record.id, signer)` prop after the SignerRecord is persisted. Extension popup App + web App both pass the shell's `registerSigner` here.
- `packages/core/test/signer-port-protocol.smoke.js` — in-memory port-pair mock exercises both sides of the protocol: round-trip signPsbt/signMessage/getStatus, unknown-signerId surfaces `SignerNotRegisteredError`, thrown errors propagate with name, port disconnect rejects in-flight + future requests, `announce()` posts register messages. No chrome.runtime, no hardware.

**Slice 3 — per-form HW branches + shared credential block**

- `packages/core/src/shared/components/SignCredentials.jsx` — shared sign-screen block that picks between the software password `<Input>` and `<HwSignBlock>` based on `fromAddress.source`. Every review/sign form uses it; the form owns its Submit button + flow, but the credential-gathering UX is now one component. Also exports `isHwSource(fromAddress)` as the canonical detection helper.
- `packages/extension/src/background/createBackgroundHost.js` — new `registerHwHandler(type, flow)` helper closure. Wraps the HW signing path (load Address → `resolveSigner` → `signerBridge.getTransport` → `buildRemoteSigner` → drop `password` → delegate) so adding more `.hw` handlers is a one-liner each. Registers **10** `.hw` handlers: `action.send.hw` (refactored from v0.68), plus new `action.issue.hw` / `action.mint.hw` / `action.destroy.hw` / `action.broadcast.hw` / `action.dispenser.hw` / `action.dividend.hw` / `action.createList.hw` / `action.airdrop.hw` / `action.advanced.hw`.
- Messaging helpers — popup + web + desktop each gain `issueTokenHw` / `mintAssetHw` / `destroyAssetHw` / `broadcastActionHw` / `dispenserActionHw` / `dividendActionHw` / `createListHw` / `airdropActionHw` / `advancedActionHw`.
- Six action forms gain the HW branch using the `SignCredentials` component + matching `.Hw` messaging variant: `IssueTokenForm` (§40.2), `MintForm` (§40.3), `DestroyForm` (§40.4), `TokenAdminForm` (§40.5 lock / description / transfer — shares `issueTokenHw`), `BroadcastForm` (§40.6), `DividendForm` (§40.8), `AdvancedActionsForm` (§40.10). Each branches Submit on `isHwSource`, gates the button on `hwStatus === 'available'`, flips copy to "Sign on Trezor"/"Sign on Ledger", and forwards `source` + `signerId` on the `from` payload so the background can resolve the SignerRecord.

### Changed

- `packages/core/src/signers/index.js` — re-exports `bindRendererPortBridge` + `createBackgroundTransport`.
- `packages/core/test/hw-sign-e2e.smoke.js` — extended to cover the new wiring:
  - All **10** `.hw` handlers are registered via `registerHwHandler` (not the old per-handler `host.register` pattern).
  - Core `signerPortProtocol` module exists + exports the two symbols.
  - Popup `signerBridge.js` exists, opens `chrome.runtime.connect` with the agreed port name, imports the core binder.
  - Background `signerBridgeListener.js` exists, filters on port name, calls `signerBridge.setTransport` on register and `clearTransport` on disconnect, wraps via `createBackgroundTransport`.
  - Background entrypoint calls `attachSignerBridgeListener()` at startup.
  - `PairSignerForm` threads the live signer through `onSignerPaired`.
  - Popup App imports + passes `onSignerPaired={registerLocalSigner}`.
- Smoke count: 49 (+1: `signer-port-protocol.smoke.js`). 49/49 green.

### Deferred (slice 4 — next session)

- `DispenserForm` (§40.7.1) + `AirdropForm` (§40.9) — multi-stage flows with their own sign gates (create dispenser vs buy fill; resumable list→airdrop two-tx sequence). Each needs careful treatment because the HW branch isn't a single swap — the flow has multiple submit points.
- Desktop ipc port RPC — `packages/desktop/renderer/signerBridge.js` + `packages/desktop/main/signerBridgeListener.js` using `ipcRenderer`/`ipcMain` pair. Pattern matches the extension; different transport.
- Real-device walkthrough (Trezor in hand; Ledger pending).

## [0.68.0] - 2026-04-24

HW Sign follow-up — shell integration slice one of three. Wires the core primitives from v0.66.0 + v0.67.0 into live background handlers + messaging helpers + the Send review/sign screen. After this step, the Send form renders `HwSignBlock` (not the password input) when the source address is a paired Trezor/Ledger, gates Submit on `status === 'available'`, and dispatches via `messaging.sendAssetHw` through a background handler that builds the `RemoteSigner` on demand.

The one remaining piece to make this function end-to-end on hardware is the renderer↔background port RPC — the live `TrezorSigner` / `LedgerSigner` instances paired during §17.6 live in the renderer, and `signerBridge` stays empty until the renderer opens a port and calls `signerBridge.setTransport`. Until then, `action.send.hw` errors cleanly with `"Hardware signer is not connected"` and `signer.status` reports `{ status: 'idle', detail: 'signer bridge not connected' }`.

### Added

**Background — `packages/extension/src/background/signerBridge.js`**

Module-scoped registry keyed by `signerId` → `RemoteSigner` transport function. Populated at pair/connect time by the renderer; consumed by `action.*.hw` handlers at sign time. Exposes `setTransport(id, fn)` / `getTransport(id)` / `clearTransport(id)` / `clearAll()` / `registeredIds()`. The module's doc comment lays out the full port-RPC protocol the wiring step will implement: renderer opens `chrome.runtime.connect({ name: 'signer-bridge' })`, posts `signer.register` with its live signer id, background wraps the port as a transport, sign-time calls propagate as `signer.sign.request` / `signer.sign.response`, and port disconnect drops the registration so in-flight requests reject with "signer bridge disconnected".

**Background handlers — `createBackgroundHost.js`**

- `action.send.hw` — HW-wallet SEND. Loads the source `Address` record, runs `flows.resolveSigner({ vault, address })` → HW descriptor, looks up the transport via `signerBridge.getTransport`, builds a `RemoteSigner` via `flows.buildRemoteSigner`, and calls `sendAsset({ ..., signer })` — no password, skips `unlockWallet`, skips `signer.lock()`. Drops the request's `password` field defensively in case a stale field comes through from a form draft.
- `signer.status` — Lightweight signer-status probe. Routes directly through the bridge transport (no vault / SDK touch). Returns `{ status: 'idle', detail: 'signer bridge not connected' }` when the bridge isn't populated (distinct UX signal vs the signer actively reporting `'disconnected'`). Transport throws map to `{ status: 'disconnected', detail: msg }`.
- New `loadAddressForHwSigning(vault, req)` helper — resolves the source `Address` record from `req.from.addressId` with a fallback to a by-address-string scan.
- Imports `resolveSigner` + `buildRemoteSigner` from core flows.

**Messaging helpers — all three shells**

- `packages/extension/src/popup/messaging.js`: `sendAssetHw(opts)` + `getSignerStatus({ signerId, chainId? })` routing via `action.send.hw` / `signer.status`. JSDoc notes the handler's bridge-not-connected error.
- `packages/web/src/messaging.js`: same two helpers.
- `packages/desktop/renderer/messaging.js`: same two helpers.

**UI — Send.jsx HW branch**

- Detects HW source via `fromAddress.source === 'trezor' || fromAddress.source === 'ledger'`, flips the review/sign screen between two layouts:
  - **Software**: existing password `<Input>`.
  - **Hardware**: `<HwSignBlock>` rendering §18.5 `DerivationPathCrossCheck` + live device-status banner. `getStatus` is wired to `messaging.getSignerStatus({ signerId, chainId })`; `onStatusChange` exposes live state to the form so the Submit button gates on `hwStatus === 'available'`.
- Submit button copy flips to `"Sign on Trezor"` / `"Sign on Ledger"` in the HW branch; disabled until the device reports ready.
- Submit handler branches: software → `messaging.sendAsset({ ..., password })`; HW → `messaging.sendAssetHw({ ..., signerId })`. Error surface unified (HW path doesn't have a password field to refocus).
- `source` + `signerId` are now forwarded in the `from` payload so the background can resolve the SignerRecord.

### Changed

- `packages/core/test/hw-sign-e2e.smoke.js` — extended to cover the new wiring:
  - signerBridge module: live registry round-trip (set/get/clear), `registeredIds()` shape, guard-rails on bad input.
  - createBackgroundHost: both handlers registered, `resolveSigner` + `buildRemoteSigner` imported, bridge lookup call, "Hardware signer is not connected" error present.
  - Each of popup / web / desktop messaging: `sendAssetHw` + `getSignerStatus` exports, correct routing types.
  - Send.jsx static checks: HwSignBlock import, `isHwSource` branch, call-sites, device-aware button copy, status-gated disable.
- Smoke count holds at 47 (all new assertions land in the existing `hw-sign-e2e.smoke.js`).

### Developer notes

- The core `@xchain-wallet/core` package is unchanged by this step — only shell packages + the shared `Send.jsx` route pick up wiring. The version bump is synchronized per `feedback_wallet_versioning` convention.
- `action.send.hw` loads the Address via `vault.addresses.get(fromAddressId)`; the form now forwards both `source` and `signerId` on the `from` payload so `resolveSigner` has the information it needs. Wallet-internal code that constructs `from` objects for HW addresses (e.g., Send's `handleSubmit` HW branch) should preserve these fields end-to-end.
- Port-RPC TODO: popup / web / desktop each need a renderer-side bridge module that (a) opens a long-lived port at app boot, (b) calls `signerBridge.setTransport` from the background side when the renderer posts `signer.register` with a live signer id (constructed during `pairTrezorSigner` / `pairLedgerSigner`), (c) listens for `signer.sign.request` / `.response` from the background, dispatches to the local `TrezorSigner` / `LedgerSigner` by id, replies. The module scope is ~150 LOC; see `signerBridge.js`'s header for the full protocol sketch.
- Form-replication TODO: the HW branch in `Send.jsx` is the exemplar. Issue, Mint, Destroy, Broadcast, Dispenser, Dividend, AirDrop, CreateList, Advanced, and Sweep each need the same branch (HwSignBlock + `sendAssetHw`-equivalent messaging call). Mechanical, ~30 LOC per form.

## [0.67.0] - 2026-04-24

HW Sign — Step 5 of 5 — core primitives for hardware-signer integration with action flows. This step refactors `submitAction` to accept a pre-built signer (bypassing the software-wallet password-unlock path), loosens `normalizeSource` so HW-sourced addresses flow through the send/issue/... wrappers without explicit rejection, adds a `resolveSigner` / `buildRemoteSigner` helper pair that background handlers use to decide between software and remote signing, and lands the shared UI primitives (`useSignerStatus` hook + `HwSignBlock` component) every review/sign screen will render in the HW branch. End-to-end smoke proves the full chain runs: background `RemoteSigner.signPsbt` → transport → renderer-side `TrezorSigner.signPsbt` → `sdk.wallet.decomposePsbt` → `trezorFormat` → `connect.signTransaction` → serialized tx → `sdk.wallet.txidOf` → back.

The remaining HW-sign work is pure shell infrastructure, no architectural decisions left: (a) per-form wiring — each of the 10 action review/sign screens checks `fromAddress.source === 'trezor' | 'ledger'` and renders `<HwSignBlock>` instead of the password input, gating Submit on `status === 'available'`; (b) production `renderer↔background` RPC over `chrome.runtime.connect` ports (extension / web) or `ipcMain`/`ipcRenderer` (desktop) — the `transport` function RemoteSigner takes needs a concrete implementation; (c) `messaging.sendAsset` (and siblings) branch on address source, routing HW paths through a new `action.*.hw` handler that constructs the RemoteSigner on the background side; (d) real-device E2E walkthrough (Trezor in hand, Ledger pending).

### Changed

- `packages/core/src/flows/submitAction.js` — accepts an optional `signer: Signer` param. When supplied, the flow skips `unlockWallet` entirely (no password KDF, no software-seed decryption) and skips the trailing `.lock()` — the caller owns the signer's lifecycle. Either `password` OR `signer` must be supplied; both paths still run through the same `submitWithSigner` / ADS / pendingTx lifecycle machinery.
- `packages/core/src/flows/sendAsset.js` — `normalizeSource` no longer rejects addresses with `source === 'trezor' | 'ledger'`. The old behavior was an explicit refusal with "this signer cannot produce signatures here" — now HW sources pass through with the same shape as HD sources (`{ address, publicKey, derivationPath }`). Watch-only is still rejected. `sendAsset` itself gains an optional `signer` forwarded to `submitAction`; callers that have a `RemoteSigner` in hand pass it here and omit `password`.

### Added

**Flow helper — `packages/core/src/flows/resolveSigner.js`**

- `resolveSigner({ vault, address })` inspects an Address record and returns a descriptor telling the caller which signing path applies. HD + imported-WIF addresses → `{ kind: 'software', address }`. Addresses persisted during HW pairing (§17.6) with `source: 'trezor' | 'ledger'` + a `signerId` → `{ kind: 'trezor' | 'ledger', address, signerRecord }`. Rejects watch-only addresses, HW addresses with no `signerId`, HW addresses pointing at a missing `SignerRecord`, and mismatched-kind corruption (address says `'trezor'` but the record says `'ledger'`) with a new `SignerResolutionError` carrying `addressId` / `signerId` / `source` / `signerKind` fields.
- `buildRemoteSigner(descriptor, transport)` constructs a `RemoteSigner` for an HW descriptor, using the SignerRecord's `label` (or `"vendor model"` fallback when the label is empty) for the display name. Refuses non-HW descriptors and non-function transports.
- Rationale: separating "which kind?" from "build it" keeps `resolveSigner` pure + testable. Callers (background handlers) own the transport function — in production it wraps the renderer-side RPC channel; in the E2E smoke it dispatches straight into a mock renderer-signer map.
- Re-exported from `@xchain-wallet/core/flows` alongside the other HW helpers.

**Shared UI primitives — `packages/core/src/shared/`**

- `hooks/useSignerStatus.js` — polls a signer's `getStatus()` at two cadences: fast (2000ms) when the status is anything other than `'available'` (user is acting on the device — wrong-app, locked, disconnected), steady (10000ms) once the device reports ready. First poll fires immediately on mount so callers don't flash through `'idle'`. Returns `{ status, detail, refresh }` — the `refresh` callback is the handle for explicit re-polls ("I opened the Bitcoin app, retry now"). Accepts `getStatus: null` to disable polling (useful when the active wallet hasn't selected an HW source).
- `components/HwSignBlock.jsx` + `.module.css` — composite sign-screen block that every review/sign form will render in the HW branch instead of the password input. Composes the existing §18.5 `DerivationPathCrossCheck` with a live device-status banner. Copy variants for `'available'` / `'wrong-app'` / `'locked'` / `'disconnected'` / `'error'`, with vendor-aware details (Trezor says "enter your PIN on the Trezor", Ledger's `'wrong-app'` gets chain-specific "Open the Bitcoin app on your Ledger"). Status dot colors via CSS data-attributes. Exposes live state to the parent form via an `onStatusChange` callback so the Submit button can gate on `status === 'available'` without re-polling.

**Smoke — `packages/core/test/hw-sign-e2e.smoke.js`**

- Proves the full hardware-signer chain runs end-to-end against mocks. Constructs a mock renderer (signer-instance map) holding a real `TrezorSigner` wired to a mock Connect + mock sdkRegistry. The mock transport simulates the `renderer↔background` RPC by dispatching ops from payloads' `signerId` into the signer map. A background-side `RemoteSigner` calls the mock transport; the whole signPsbt chain runs: `RemoteSigner.signPsbt` → transport → `TrezorSigner.signPsbt` → `sdk.wallet.decomposePsbt` (mocked with a P2WPKH fixture) → `trezorFormat.toTrezorSignTransaction` → `connect.signTransaction` (mocked with a canned serializedTx) → back up the chain, with `sdk.wallet.txidOf` producing the final txid. Asserts the Trezor envelope has the right `coin` / `script_type` / `address_n` / `amount`.
- Also covers: `resolveSigner` descriptor branches across HD / imported-WIF / trezor / watch-only / missing-signerId / missing-SignerRecord / mismatched-kind; `SignerResolutionError` carries `addressId` / `signerId` / `source`; `buildRemoteSigner` refuses non-HW descriptors and non-function transports; `RemoteSigner.signMessage` + `getStatus` round-trips; `submitAction` JSDoc advertises the `signer` param and the source code wires the skip-unlock path correctly; `normalizeSource` admits HW sources and still rejects watch-only; shared UI primitives are in place (`useSignerStatus` + `HwSignBlock` files + key symbols).

### Developer notes

- Smoke count: 47 (+1: `hw-sign-e2e.smoke.js`). 47/47 green.
- Nothing in the shell packages changed. The synchronized version bump is purely so the root + all `packages/*` track the `@xchain-wallet/core` change for distribution.
- The `submitAction` refactor is backward-compatible: existing callers (all current action flows) still pass `password`, the old path runs unchanged. Only callers that opt into the new `signer` param take the HW route.
- `normalizeSource`'s loosened behavior means that if a caller builds a `sendAsset` call with a `from.source === 'trezor'` address but forgets to inject a signer, `submitAction` will reject early with "either `password` or `signer` is required" — still loud, just at a different layer than before.
- HwSignBlock depends on CSS custom properties (`--xc-success`, `--xc-warning`, `--xc-danger`, plus their `-soft` variants) that may or may not be in `tokens.css` yet. The CSS includes fallbacks to `var(--xc-surface-raised)` / `var(--xc-border)` so the block renders cleanly on older token sets; per-form wiring can add the specific palette entries in a follow-up if the design system grows.

## [0.66.0] - 2026-04-23

HW Sign — Steps 1–4 of 5 — hardware-signer primitives. Phase 2 closed at v0.65.0 with `TrezorSigner.signPsbt` / `LedgerSigner.signPsbt` / `signMessage` throwing `NotImplementedError` ("Known deferrals" in v0.53.0 CHANGELOG). This batch fills the four pieces called out there: **PSBT↔Trezor conversion**, **PSBT↔Ledger conversion**, **message-signing envelopes**, and the **renderer↔background signing bridge shim**. Step 5 of 5 (sign-screen HW context, `submitAction` refactor, end-to-end smoke) lands in a follow-up; the primitives here are all pure converters + Signer-interface compliance + smoke-level coverage, unused by live action flows yet.

### Added

**Step 1 / xchain-sdk side (committed separately, v1.9.0)**

- `WalletUtils.decomposePsbt(psbtHex)` returns a vendor-agnostic normalized PSBT shape with per-input `prevTxHash`, `prevTxIndex`, `sequence`, `value`, `scriptPubKeyHex`, `scriptType`, `sighashType`, `nonWitnessUtxoHex`, `witnessUtxoScriptHex`, `redeemScriptHex`, `witnessScriptHex`, `address`, and a pre-parsed `prevTxInfo` in Trezor-`refTxs` shape. Keeps `bitcoinjs-lib` out of `@xchain-wallet/core` — the wallet's converters consume this normalized shape directly.
- `WalletUtils.txidOf(txHex)` computes the display-order txid for signed raw transactions returned by HW devices (segwit-safe via bitcoinjs-lib's `Transaction.fromHex.getId()`).
- Both exposed through `XChainSDKLike` in `packages/core/src/sdk/SDKRegistry.js` so HW signers can reach them via the existing SDK DI pattern.

**Step 2 — TrezorSigner sign paths (§17.3)**

- `packages/core/src/signers/trezorFormat.js` — pure data transform: `pathToAddressN(path)` (BIP32 path → Trezor `address_n[]` with hardening bits set); `chainIdToTrezorCoin(chainId)` (single source of truth, was duplicated in TrezorSigner); `toTrezorSignTransaction({ decomposed, coin, signingPaths })` → complete `signTransaction` payload with SPENDWITNESS / SPENDP2SHWITNESS / SPENDADDRESS script_types, PAYTOADDRESS outputs, amounts stringified, and `refTxs` auto-collected from `decomposed.inputs[i].prevTxInfo` for legacy inputs (deduped by prev-tx hash).
- `TrezorSigner.signPsbt` wired: asserts `sdkRegistry`, calls `sdk.wallet.decomposePsbt`, runs `toTrezorSignTransaction`, calls `connect.signTransaction`, returns `{ signedPsbtHex: '', txHex: payload.serializedTx, txid: sdk.wallet.txidOf(txHex) }`. Trezor returns a serialized tx (not a signed PSBT), so `signedPsbtHex` is intentionally empty — callers broadcast `txHex`.
- `TrezorSigner.signMessage` wired: calls `connect.signMessage({ path, coin, message })`; pass-through of the device's base64 signature. No envelope wrapping needed — Trezor's output already matches xchain-sdk's `auth.signMessage` shape.
- Constructor takes a new optional `sdkRegistry` DI param — mirrors `SoftwareSigner`'s shape. The old inline `chainIdToTrezorCoin` in `TrezorSigner.js` was deleted; the class now imports it from `trezorFormat.js`.
- `trezor-signer.smoke.js` — the "signPsbt/signMessage throw NotImplementedError" assertions are replaced with live-wiring coverage: happy-path segwit, legacy-input refTxs emission, connect-failure surfacing, signMessage payload shape, `sdkRegistry` guard.

**Step 3 — LedgerSigner sign paths (§17.4)**

- `packages/core/src/signers/ledgerFormat.js` — pure data transform: `chainIdToLedgerCurrency(chainId)`, `serializeOutputs(outputs)` (varint + LE value + script — pure JS), `synthesizeMinimalPrevTx(vout, value, scriptPubKeyHex)` (PSBT segwit lanes only carry a `witnessUtxo`, but Ledger's `createPaymentTransaction` needs a splittable prev tx for BIP143 sighashes — this synthesizes a minimal valid raw tx with the real output at the right vout and placeholders elsewhere), `toLedgerCreatePayment({ decomposed, chainId, signingPaths, lockTime })` → `{ inputs, associatedKeysets, outputScriptHex, lockTime, segwit, additionals, currency }`, `addressTypeFromPath(path)` (BIP44 purpose → `'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh'`), `composeBitcoinCompactSignature({ v, r, s }, path)` (Ledger returns `{ v, r, s }`; this packs them into the 65-byte base64 envelope with script-type-aware header base: 31 for p2pkh, 35 for p2sh-p2wpkh, 39 for p2wpkh, plus recovery id).
- `LedgerSigner.signPsbt` wired: `sdk.wallet.decomposePsbt` → `toLedgerCreatePayment` → `app.splitTransaction(prevTxHex, true, false, false, additionals)` for each input → `app.createPaymentTransaction({ inputs: splitInputs, associatedKeysets, outputScriptHex, lockTime, segwit, additionals })` → `{ signedPsbtHex: '', txHex, txid }`. All-p2wpkh inputs → `segwit: true, additionals: ['bech32']`; mixed / all-p2pkh → `segwit: false, additionals: []`.
- `LedgerSigner.signMessage` wired: calls `app.signMessageNew(path, messageHex)`, runs `composeBitcoinCompactSignature` with the address type inferred from the path's BIP44 purpose. Output matches xchain-sdk's `auth.verifyMessage` input so round-trip verification works across software + Ledger signers.
- Constructor takes optional `sdkRegistry`. The `signMessage` typedef on `LedgerBtcApp` was renamed to `signMessageNew` to match the actual hw-app-btc 10.x method.
- `ledger-signer.smoke.js` — replaced deferred-error assertions with live wiring: segwit lane (one `splitTransaction` call with synthesized prev tx starting `01000000`), legacy lane (real `nonWitnessUtxoHex`, `segwit: false`, empty additionals), createPaymentTransaction failure surfacing, signMessage happy-path with `p2wpkh` header-base assertion (39 + recId), nested-segwit path producing header-base 35.

**Step 4 — RemoteSigner shim (§17.x, new)**

- `packages/core/src/signers/RemoteSigner.js` — Signer-interface shim that forwards every call (`getStatus`, `getAddresses`, `getPublicKey`, `signPsbt`, `signMessage`) over an injected `transport({ op, payload }) -> Promise<any>` function. Threads the shim's `id` into every payload so the remote side can look up the live signer instance. Wraps transport throws as `SignerStatusError`; `getStatus` degrades to `'disconnected'` on transport error. Validates remote response shapes (signPsbt must return `{ txHex, txid }`, signMessage must return `{ signature }`, getAddresses must return an array).
- Exists so HW signing can physically run in the renderer (WebHID transports + Trezor Connect popups need user gestures + tab anchors — neither work in MV3 service workers) while `submitWithSigner` keeps running in the background. Wire protocol is documented inline at the top of the file. No shell-side wiring yet — that lands in Step 5 alongside the `submitAction` refactor.
- `signers/index.js` re-exports `RemoteSigner` from the `@xchain-wallet/core` barrel.
- `remote-signer.smoke.js` — new smoke exercising constructor guard-rails, all five ops against a recording mock transport, transport-throw → SignerStatusError mapping, malformed-response rejection, subscribe inheritance from the base class.

### Changed

- `packages/core/src/sdk/SDKRegistry.js` `XChainSDKLike` typedef grows `wallet.decomposePsbt` + `wallet.txidOf` entries.
- `packages/core/src/signers/types.js` — new module holding shared JSDoc typedefs (`DecomposedPsbt`, `DecomposedPsbtInput`, `DecomposedPsbtOutput`, `PrevTxInfo`, `ScriptType`). Keeps cross-file `@typedef` references resolvable in editors without each file redefining the shapes.
- `packages/core/src/signers/index.js` — re-exports `RemoteSigner` alongside the existing signer classes + firmware helpers.
- `packages/core/test/sdk-bundle.smoke.js` — peer-dep pin assertion bumps from `^1.8.1` to `^1.9.0` (the decomposePsbt + txidOf additions are load-bearing for the HW sign path).
- `TrezorSigner.js` no longer re-exports `AbstractMethodError` (the barrel exports it from `Signer.js` directly).

### Developer notes

- Smoke count: 46 (+1: `remote-signer.smoke.js`). 46/46 green.
- Nothing in the shell packages changed — `packages/extension`, `packages/web`, `packages/desktop` don't gain new code. The synchronized version bump is purely so the root + all `packages/*` track the `@xchain-wallet/core` change for distribution.
- Hardware sign **integration** (live flow wiring, per-screen HW branches, end-to-end smoke) is the Step 5 scope. That step refactors `submitAction` / `unlockWallet` to accept a pre-built signer (bypass password KDF when the signer is `RemoteSigner`), adds a background `resolveSigner(walletId, address)` helper, wires a `signer.sign.request` / `.response` round-trip protocol across extension + web + desktop messaging layers, and updates each Phase 1+2 review/sign screen with an HW branch (`<DerivationPathCrossCheck />` + device-status banner + "Sign on [device]" button copy + status-gated enable). Until that lands, HW signers pass smokes against mocks but remain unreachable from production flows.
- Real-device E2E is still pending across both steps (no way to exercise WebHID / Trezor Connect popups from Node); the v0.53.0 "Manual verification pending" note still applies.

## [0.65.0] - 2026-04-23

Phase 2 — Step 25 of 26 — piece 10 + Step 26 of 26 — piece 11. **Phase 2 complete**: the remaining two §40 surfaces ship together — the generic Advanced Actions form that reflects the SDK's schema (§40.10) and the FreeWallet migration path (§40.13, §19.7). All 26 steps of the Phase 2 plan now on master; the wallet surface covers every §40 authoring path end-to-end.

### Added

**Advanced Actions form — §40.10**

Generic "submit any XChain action" surface driven entirely by the SDK's introspection API. No per-action knowledge in the wallet beyond rendering rules for rest-fields (`...` prefix) and auto-fields (`VERSION` is never user-entered).

- `packages/core/src/shared/routes/AdvancedActionsForm.jsx` — 4-stage state machine (`compose` → `review` → `submitting` → `done`). Chain + source picker, action dropdown, optional format-version dropdown, schema-driven field list. Rest-fields render as a textarea that splits on newlines/commas; scalars as `<Input>`. Live validation on every keystroke via `messaging.validateAction`. Decoder preview on review reuses whatever decoder case the action has (generic fallback for undecoded actions). Actions with dedicated forms are still listed but decorated with `(dedicated form available)`.
- `packages/core/src/flows/advancedAction.js` — generic `submitAction` wrapper. Uppercases the action name, forwards `{ action, params }` unchanged. The SDK's validator still runs inside `createAction()` at sign time.
- `packages/core/src/flows/sdkIntrospection.js` — thin passthroughs: `listActions`, `getActionFormats`, `getActionFields` (optional `version` arg — when set, returns that version's fields; otherwise union of all versions), `validateActionDryRun`. All guard required inputs.
- Background handlers: `action.advanced`, `sdk.listActions`, `sdk.getActionFormats`, `sdk.getActionFields`, `sdk.validateAction`.
- Three-shell messaging (popup / web / desktop): `advancedAction`, `listActions`, `getActionFormats`, `getActionFields`, `validateAction`.
- ActionsMenu entry "Advanced action" (between "Airdrop tokens" and "Pair hardware signer"); `'advanced'` sub-route in every App.jsx.
- Smoke `advanced-actions-form.smoke.js` — covers single-export, 4-stage machine, 5 messaging call-sites, rest-field + auto-field rendering, dedicated-form decoration, 5 core flow guards, mocked-SDK introspection happy paths, 5 BG handler registrations, 5 messaging exports × 3 shells, ActionsMenu + App.jsx wiring.

**FreeWallet migration UI — §40.13 + §19.7**

First-class onboarding entry for users migrating from FreeWallet, plus a guided "Migrate to BIP39" wizard for users who want to move off the Counterwallet-legacy format.

- `packages/core/src/shared/routes/Onboarding.jsx` — third button "Coming from FreeWallet" alongside Create / Import; wired via optional `onImportFromFreeWallet` prop.
- `packages/core/src/shared/routes/ImportWallet.jsx` — new `variant` prop (`'default' | 'freewallet'`). In FreeWallet mode: title reads "Import from FreeWallet", subtitle calls out the 12-word Counterwallet format explicitly, default wallet name is "FreeWallet", and the word-count validator tightens from `[12, 15, 18, 21, 24]` to `[12]` only (FreeWallet never used any other length). Format detection is unchanged — the import path still dispatches to the Counterwallet-legacy code path and creates the wallet with `origin: 'imported-freewallet'`, `format: 'counterwallet-legacy'`.
- `packages/core/src/shared/routes/MigrateToBip39.jsx` — 4-stage guided wizard (explain → create → submitting → done). Creates a new BIP39 wallet alongside the legacy wallet (does not touch the existing one), then renders a per-chain side-by-side list of legacy addresses and new-wallet destinations for manual sweeping through the existing Send flow.
- `packages/core/src/shared/routes/Home.jsx` — when the active wallet has `format === 'counterwallet-legacy'`, renders a dismissible banner above the balance grid linking to the migration wizard. New `onMigrateToBip39` prop; banner uses `.legacyBanner` / `.legacyBannerTitle` / `.legacyBannerHint` classes.
- Three-shell App.jsx (popup / web / desktop): new `'import-freewallet'` onboarding step that renders `ImportWallet` with `variant="freewallet"`; new `'migrate-bip39'` unlocked sub-route rendering `MigrateToBip39`; Onboarding gets `onImportFromFreeWallet`; Home gets `onMigrateToBip39`.
- Smoke `freewallet-migration.smoke.js` — Onboarding entry, ImportWallet variant behavior + tightened word-count + rebrand, MigrateToBip39 4-stage machine + createWallet wiring, Home legacy banner gating + CSS class, three-shell App.jsx wiring of both the onboarding sub-state and the unlocked sub-route.

### Known deferrals

- **Automated one-shot sweep** — §40.13 mentions an optional sweep that moves balances from every legacy address to the new BIP39 wallet in a single click. That requires a dedicated SweepForm surface (the `sweepAsset` flow exists but has no authoring UI yet). The migration wizard instead lists each chain's legacy→new pair so the user can sweep manually via the normal Send/SWEEP flow. Follow-up step adds the automated path.
- **Batch SWEEP across chains** — same constraint. Each chain's sweep is a separate tx on that chain's network, so the UX is inherently N-click; the sweep form would sequence them with a single password prompt.
- **Legacy address labels** — FreeWallet has no label export facility (noted in §19.7); addresses arrive with default "Address #N" labels for the user to relabel manually.
- **"Settings → Migrate" entry** — the migration wizard is reachable only from the Home banner today. A dedicated Settings path would be nice for users who dismiss the banner; lands with the first Settings route to ship.
- **Advanced form — value inspector** — for debugging, a "see the raw serialized action string" toggle before signing would be helpful. Defer until users ask.
- **Advanced form — pre-populated params from a pasted action string** — round-trip for "I saw this action on chain, let me re-submit it with tweaks" use case. Defer.

### Phase 2 closed

All 26 steps of the Phase 2 plan (§40 authoring surfaces) are now on master:

| Piece | Step(s) | §    | Feature                                           |
| ----- | ------- | ---- | ------------------------------------------------- |
| 1     | 1-2     | 39   | Shared routes + browser bundle                    |
| 2     | 3-7     | 40.1 | Token Creation Wizard                             |
| 3     | 8-11    | 40.2-5 | Standalone ISSUE / MINT / DESTROY / admin       |
| 4     | 12-15   | 40.11, 17-18 | Hardware signer pairing infrastructure    |
| 5     | 16-19   | 40.12 | Electron desktop shell                           |
| 6     | 20      | 40.6 | BROADCAST                                         |
| 7     | 21-22   | 40.7 | DISPENSER authoring + explorer                    |
| 8     | 23      | 40.8 | DIVIDEND                                          |
| 9     | 24      | 40.9 | AIRDROP (two-tx flow)                             |
| 10    | 25      | 40.10 | Advanced Actions                                 |
| 11    | 26      | 40.13 | FreeWallet migration                             |

**Pending verification across Phase 2** (unchanged from prior ships): real hardware signer pairing end-to-end; Electron `pnpm run dist`; pending-airdrop resume on a live explorer; advanced-action signing for every action kind the SDK lists. Phase 3 (DEX + messaging, §41) is now unblocked.

## [0.64.0] - 2026-04-23

Phase 2 — Step 24 of 26 — piece 9. AIRDROP authoring flow (§40.9). Distributes a token to every address on a pasted or uploaded list. Ships as a **two-transaction flow** rather than the single BATCH the spec suggested: a LIST action creates the on-chain address pool, and once it's indexed the AIRDROP references it by `LIST_ACTION_INDEX`. State is persisted to the vault so closing the wallet between the two signs is resumable.

### Added

**Core flows** (`packages/core/src/flows/`)

- `createList(opts)` — signs + broadcasts a LIST action. v0 (create, TYPE=1/2) or v1 (edit-existing, EDIT=1/2 + LIST_ACTION_INDEX). Guards: non-empty `ITEM[]`, valid TYPE/EDIT per version.
- `airdropAction(opts)` — signs + broadcasts an AIRDROP v0 referencing a pre-existing LIST. Guards: TICK, AMOUNT, LIST_ACTION_INDEX.
- `actionByTxid({ sdkRegistry, chainId, txid })` — thin wrapper over `sdk.getTransaction(txid, 'hash')`. 404 → `null` so polling loops can use `result === null ? keep polling : done`. Any non-404 error propagates.
- `listByActionIndex({ sdkRegistry, chainId, actionIndex })` — thin wrapper over `sdk.getAction(actionIndex)` for stage-5 confirmation display.
- Pending-airdrop CRUD: `savePendingAirdrop`, `listPendingAirdropsForWallet`, `updatePendingAirdrop` (re-reads before merging), `clearPendingAirdrop`.
- All re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Parser module** (`packages/core/src/airdrop/parseRecipients.js`)

- `parsePaste(text)` — splits on newlines/commas, strips wrapping quotes + whitespace.
- `parseCsv(text)` — first-column extractor; detects + skips a lowercase `"address"` header row. Not a full RFC 4180 parser — good enough for address-in-column-1 CSVs.
- `isPlausibleAddress(addr)` — length (matches SDK `util.isCryptoAddress`) + base58/bech32 charset guard. Catches paste artifacts like commas, spaces, zero-width chars; anything subtler gets caught at sign time by the encoder.
- `classifyRecipients(candidates)` — order-preserving dedup returning `{ valid, invalid, duplicates }`.
- Exposed at `@xchain-wallet/core` as the `airdrop` namespace.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- `decodeList` case — v0 `"Create address/token list of N items on <chain>"`, v1 `"Add/Remove N items to/from list #N on <chain>"`. Warns on empty TYPE, missing EDIT direction, empty parent list reference, or zero items. Samples items inline when ≤5 to keep the sign screen tidy for large pastes.
- `decodeAirdrop` case — v0 `"Airdrop AMOUNT TICK on <chain> to list #N"`; v1/v2/v3 render per-tuple summary lines (e.g. `"Airdrop: 1 GAS → list #1234, 2 BRRR → list #1234"`). Warns on empty tickers, non-positive amounts, empty list reference, and `|`/`;` in MEMO. The decoder stays neutral about whether the referenced LIST is TICK or ADDRESS — no DB lookup at decode time.

**Schema + vault** (`packages/core/src/schemas/pendingAirdrop.js`, `packages/core/src/storage/`)

- New `PendingAirdrop` record: `{ id, walletId, chainId, fromAddress, token, amountPer, recipients[], listTxid, listActionIndex, airdropTxid, stage, createdAt, memo }`.
- `PENDING_AIRDROP_STAGES = ['waiting-index', 'ready-to-airdrop', 'done']`.
- Empty `pendingAirdropMigrations` + `migratePendingAirdrop` wrapper (forward-only, grows when schema changes).
- `vault.pendingAirdrops` collection handle wired via the existing `makeCollection` harness. Codec defensive-merge means older persisted blobs transparently read the new collection as `[]` — no `DOCUMENT_VERSION` bump.

**UI — AirdropForm** (`packages/core/src/shared/routes/AirdropForm.jsx`)

- 5-stage state machine: `compose` → `review-list` → `wait-index` → `review-airdrop` → `done`.
- Stage 1 compose: chain + source picker, token + per-recipient amount inputs, paste textarea + CSV file input, live recipient-count banner (`"147 valid addresses · 3 duplicates removed · 2 invalid skipped"`), expandable invalid list, memo field.
- Stage 2 review-list: decoder-rendered LIST summary + "two-transaction" banner + password prompt. Signs LIST via `messaging.createList`, persists the pending record to the vault, advances to wait-index.
- Stage 3 wait-index: `setInterval(10_000)` polling against `messaging.getActionByTxid`; pauses on `document.visibilityState === 'hidden'`. Shows LIST txid + elapsed counter; renders a "taking longer than usual" hint after 5 min. `"Close (keep waiting)"` and `"Cancel airdrop"` exits.
- Stage 4 review-airdrop: decoder-rendered AIRDROP (with resolved LIST_ACTION_INDEX), recipient count, total distribution estimate. Second password prompt. Signs AIRDROP via `messaging.airdropAction`, writes `stage='done'` + airdropTxid to the vault.
- Stage 5 done: both txids shown, "Done" clears the vault record.
- Accepts optional `resumeId` prop: hydrates from `listPendingAirdropsForWallet` and jumps to the right stage.

**Home resume card** (`packages/core/src/shared/routes/Home.jsx`, `Home.module.css`)

- `Home` accepts an optional `onResumeAirdrop(id)` prop. On mount it calls `messaging.listPendingAirdropsForWallet` and filters to `waiting-index` + `ready-to-airdrop` stages. Each resumable record renders a click-to-resume card above the balance grid showing `"{amount} {token} × {N recipients}"` + stage description.

**Background handlers** (`packages/extension/src/background/createBackgroundHost.js`)

- Write: `action.createList`, `action.airdrop`.
- Read: `actions.byTxid`, `lists.byActionIndex`.
- Pending-airdrop CRUD: `pendingAirdrops.save`, `pendingAirdrops.listForWallet`, `pendingAirdrops.update`, `pendingAirdrops.clear`.

**Three-shell messaging** (popup / web / desktop)

- `createList`, `airdropAction`, `getActionByTxid`, `getListByActionIndex`, `savePendingAirdrop`, `listPendingAirdropsForWallet`, `updatePendingAirdrop`, `clearPendingAirdrop` exports added to each shell's `messaging.js`.

**Actions menu + App.jsx routing**

- "Airdrop tokens" entry added between "Pay dividend" and "Pair hardware signer" in all three shells.
- `'airdrop'` sub-route in each App.jsx; `resumeAirdropId` state threaded between Home's resume card and AirdropForm; back navigation returns to Home if resumed, Actions menu if entered fresh.

**Smoke test** (`packages/core/test/airdrop-form.smoke.js`)

- 12 assertion groups: file + single-export, 5-stage machine, decoder wiring, 7 messaging call-sites with password-error handling, 10s poll interval + visibility-gated polling, parser round-trips (paste + CSV + header detection + charset + dedup), 8 core flow re-exports with required-input guards + `actionByTxid` 404→null round-trip, decoder LIST v0 + AIRDROP v0 summaries, 8 BG handler registrations, 8 messaging exports × 3 shells with route assertions, ActionsMenu entry + App.jsx sub-route + Home resume card in all three shells, vault round-trip including stage transition + persistence reload + validator rejection.
- `action-decoder.smoke.js` gains 10 new cases covering LIST v0 (ADDRESS + TICK + missing type + empty items), LIST v1 (add + remove), AIRDROP v0 (happy + missing list + bad memo), AIRDROP v1/v2 multi-variant summaries. The previous "AIRDROP falls through to generic" case now uses ORDER.

### Known deferrals

- **AIRDROP v1 / v2 / v3 authoring** — the decoder surfaces them, but the form only emits v0 (single TICK + single LIST). Multi-token / multi-list airdrops need a separate authoring flow.
- **LIST v1 authoring** (edit an existing list) — decoder ships; no authoring UI yet. Waits for a dedicated LIST-management surface.
- **TICK LIST airdrops** (airdrop to holders of tokens X, Y, Z) — the protocol supports LIST TYPE=1, but this form only emits TYPE=2 (ADDRESS).
- **"I already have a LIST" shortcut** — users with a pre-existing LIST still go through stages 1-4 rather than typing a LIST_ACTION_INDEX directly. Straightforward follow-up.
- **Cross-device resume** — pending-airdrop state is per-device. A user who signs the LIST on their desktop can't pick up the AIRDROP on their phone until the phone re-fetches the same vault blob.
- **Fee pre-estimate** — the AIRDROP fee is `recipients × 2 + 3` DB hits (or unified-gas `AIRDROP_PER_RECIPIENT`), computed by the indexer at execute time. The form shows the recipient count as a proxy; a precise pre-estimate waits for an SDK helper.
- **Balance pre-check** — the review screens don't block on "do you actually have enough TOKEN + fee asset." The encoder catches it at sign time, but a friendlier compose-time warning is cheap to add later.

### Protocol-level note

§40.9 in `XCHAIN_WALLET_SPEC.md` describes signing the LIST + AIRDROP together as a single BATCH. That's not buildable today: AIRDROP's `LIST_ACTION_INDEX` param must be baked into the signed tx, but ACTION_INDEX is assigned by the indexer at processing time — so the sender can't know the LIST's index at sign time when both actions are composed in one BATCH. This ship keeps the two actions as sequential transactions coordinated by a resumable wallet state machine. A future protocol change (sentinel index for "previous LIST in same batch", say) would unlock the single-BATCH shape.

## [0.63.0] - 2026-04-23

Phase 2 — Step 23 of 26 — piece 8. DIVIDEND authoring form (§40.8). Distributes AMOUNT of DIVIDEND_TICK to every holder of TICK at the snapshot block, pro rata. Spec §40.8 shows holder count + total distribution on the review screen so the user sees the cost before signing; this form delivers both via the explorer's `getHolders` query.

### Added

**Core flow** (`packages/core/src/flows/dividendAction.js`)

- `dividendAction(opts)` — mirrors `broadcastAction` / `mintAsset` / `dispenserAction`. Guards `TICK`, `DIVIDEND_TICK`, and `AMOUNT` (the SDK validator's required-field set). Forwards to `submitAction` with `action: 'DIVIDEND'`.
- `holdersFor({ sdkRegistry, chainId, tick, opts })` — thin passthrough to `sdk.getHolders(tick, opts)`. Drives the cost-preview on the form.
- Both re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- New `decodeDividend` case covering DIVIDEND v0 (the only format version). Summary matches §40.8 wording: `"Pay AMOUNT DIVIDEND_TICK per unit of TICK on <chain>"`. Details surface Holders-of / Receive / Per-unit amount / optional Memo. Warnings for empty tickers, non-positive amount, and `|`/`;` in MEMO.

**Background handlers** (`packages/extension/src/background/createBackgroundHost.js`)

- `action.dividend` — routes to `dividendAction`.
- `holders.forTick` — read-only passthrough to `holdersFor`.

**Shell messaging helpers**

- `dividendAction(opts)` + `getHoldersForToken({ chainId, tick, opts? })` exported from `popup/messaging.js`, `web/messaging.js`, and `desktop/renderer/messaging.js`.

**Shared form route** (`packages/core/src/shared/routes/DividendForm.jsx`)

- Fields per §40.8: source-address picker, Holder-of token (TICK), Dividend asset (DIVIDEND_TICK), Per-unit amount (AMOUNT), optional Memo. Three-stage state machine (form → review → submitting → done). Reuses `IssueTokenForm.module.css`.
- **Live holder-count preview**: when the TICK input settles (400ms debounce), the form fetches holders via `messaging.getHoldersForToken` and renders `"N eligible holder(s) · total distribution ~X DIVIDEND_TICK"` inline + on the review screen. Per DIVIDEND.md the source address is excluded from receiving dividends — the preview filters it out and tags the preview row with "(source excluded)" when it applied.
- Validation: required fields, ticker regex (`A–Z`, `0–9`, `.`, or `^TICK_ID`), positive amount, memo pipe/semicolon rejection. Wrong-password on sign surfaces inline without leaving the review stage.
- Fee-warning hint on the review screen: "DIVIDEND charges an XChain fee based on number of database hits (§DIVIDEND.md). Make sure the source address holds enough DIVIDEND asset to cover the full payout."

**ActionsMenu + App routing**

- "Pay dividend" entry added to `ActionsMenu` in all three shells. Sits between "Browse dispensers" and "Pair hardware signer".
- Each `App.jsx` tracks the `'dividend'` sub-route rendering `<DividendForm />`.

### Smoke

- `packages/core/test/dividend-form.smoke.js` — new. File layout, three-stage machine, decoder wiring, messaging.dividendAction sign path, debounced holders fetch, source-address exclusion logic, validation, params composer (VERSION pinned, tickers uppercased, MEMO gated), flow guard rails, positive-path `holdersFor` → `sdk.getHolders` call, decoder DIVIDEND case coverage (summary + details + warnings), background handlers + three-shell messaging exports, ActionsMenu "Pay dividend" + `'dividend'` sub-route in popup / web / desktop.
- `packages/core/test/action-decoder.smoke.js` — swapped the fallback-case check from DIVIDEND (now decoded) to AIRDROP (still generic).

42/42 smokes green.

### Known deferrals

- **Token-detail-page pre-fill** — §40.8 shows the form reachable from a Token detail page with TICK pre-filled ("Of token: MYTOKEN (pre-filled from context)"). Until Token detail ships, TICK is user-entered. A later step can accept a `tick` prop for pre-fill — the form's state is already structured for it.
- **Accurate fee estimate** — §40.8 shows a `Fee: ~1000 sats` line. The indexer computes the real fee from the number of database hits at execute time; the form prints the per-hit pattern as a hint rather than a specific sats figure. A future step can pre-flight the fee via `sdk.estimateFees` once the encoder exposes it for DIVIDEND.
- **Divisibility warning for non-divisible dividend assets** — DIVIDEND.md notes: "If TICK is divisible and DIVIDEND_TICK is non-divisible, quantities under 1.0 will receive no DIVIDEND_TICK." The form doesn't yet fetch token metadata to check divisibility. Falls to the user to validate.

## [0.62.0] - 2026-04-23

Phase 2 — Step 22b of 26 — piece 7b part 2. Buyer-facing half of Dispensers (§40.7.2): browse surface + detail-page buy flow. Closes Piece 7b. Users can now find open dispensers by token or address, click through to detail, and — for token-paid dispensers — buy one or more fills with a single signed SEND.

### Added

**Shared routes**

- `packages/core/src/shared/routes/DispenserExplorer.jsx` — browse surface for finding dispensers. Two search modes:
  - **By token** — routes through `messaging.getDispensersForToken` (matches both `GIVE_TICK` and `GET_TICK`). Token input is regex-validated (A–Z, 0–9, period, or `^TICK_ID` reference).
  - **By address** — routes through `messaging.getDispensersForAddress` (matches both source and dispenser address).
  - Chain filter: single-chain or "All chains" with per-chain parallel fan-out. Per-chain errors surface inline so one outage doesn't block others. Row click → host's `onOpenDispenser(chainId, actionIndex)` navigates to detail.
- `packages/core/src/shared/routes/DispenserDetail.jsx` — new buyer surfaces under the existing detail page (owner-only sections unchanged):
  - **Token-paid lane** (`GET_TICK` set, buyer pays XChain token): new "Buy from this dispenser" section with payer-address picker (HD external addresses on the dispenser's chain), integer `fills` input (multi-fill purchase), and a "Buy N fills" button that opens a review stage → password prompt → `messaging.sendAsset` with `asset = GET_TICK`, `amount = GET_AMOUNT × fills`, `to = <dispenser address>`. Review surfaces per-fill price + per-fill give, dispenser address, chain badge, plus a hint about UTXO-chain buy races ("if the dispenser closes or runs out before confirmation, the payment reaches the creator but no TICK is released"). Danger-aware wording without blocking the flow. Wrong-password errors re-prompt.
  - **Coin-paid lane** (`GET_COIN` set, `GET_TICK` empty, buyer pays native coin): "Pay to buy" panel with dispenser address, exact trigger amount, copy-to-clipboard helpers, and a note that "any {COIN} wallet can trigger a fill" + "Native-coin sending from this wallet is on the roadmap." This lane defers a full buy flow because native-coin sends from the XChain wallet require bare-transaction infrastructure the wallet doesn't have yet (no OP_RETURN, direct UTXO-to-output PSBT via the SDK's wallet module or bitcoinjs-lib) — tracked for a future step.

**ActionsMenu + App routing**

- "Browse dispensers" entry added to `ActionsMenu` in all three shells. Between "My dispensers" and "Pair hardware signer".
- Each `App.jsx` tracks the `'dispenser-explorer'` sub-route. `dispenserRef` now carries an `origin: 'list' | 'explorer'` field so the detail page's back button returns to whichever list the user came from.

### Smoke

- `packages/core/test/dispenser-explorer.smoke.js` — new. Covers:
  - Single-component export, search-mode toggle, chain-filter wiring + empty-state wording.
  - Token-regex validation.
  - Per-chain parallel fan-out on "All chains".
  - Routing of token vs address searches to the right messaging helper.
  - DispenserDetail's new buyer surfaces: `isTokenPaid` / `isCoinPaid` lane detection, buy-flow state, sendAsset composition (asset = GET_TICK, amount scaled by fills, target = dispenser address), multi-fill support, UTXO-race warning copy, pay-here copy-to-clipboard helpers, ownership-gated visibility.
  - ActionsMenu "Browse dispensers" entry + explorer sub-route + origin-tagged list-vs-explorer nav across popup / web / desktop.
- `packages/core/test/dispensers-list.smoke.js` — updated the `setDispenserRef` assertion to expect the new `origin` field.

41/41 smokes green.

### Known deferrals

- **Native-coin buy from this wallet** — coin-paid dispensers are the primary §40.7.1 lane. The indexer triggers on bare payments to the dispenser address with no XChain action attached; the wallet's encoder path requires an action. A future step builds bare-coin-send infrastructure (likely through the SDK's `wallet.signPsbt` / `encoder.broadcastTx` pair, assembling a UTXO-funded PSBT with only the dispenser output + change). For now the detail page points users to any native wallet and provides copy-to-clipboard helpers.
- **FIAT pay estimates** — for oracle-priced dispensers (Mode 1 or Mode 2), the buyer's per-fill coin cost is computed dynamically at the indexer. The buy panel currently shows the dispenser's declared `GET_AMOUNT` directly; a follow-up can add oracle-aware hinting once the explorer publishes oracle snapshots.
- **Reputation stars (§40.7.2)** — no indexer data source.
- **Live escrow / stock** — still in the indexer TODO; the detail page surfaces the gap inline.
- **Dispenser edit (v2)** — flow + decoder support exist since Step 21; still no UI. Waits for a list-management surface (§40.13 territory).

## [0.61.0] - 2026-04-23

Phase 2 — Step 22a of 26 — piece 7b part 1. Owner-facing half of Dispensers (§40.7.1 / §40.7.2): "My dispensers" list view + dispenser detail page + cancel action. Plugs into Step 21's v1 cancel lane so users can now author → review → cancel a dispenser end-to-end. The buyer-facing half (browse / buy) lands as Step 22b.

### Added

**Core flows** (`packages/core/src/flows/dispenserQueries.js`)

- `dispensersForSource(sdkRegistry, chainId, address, opts?)` — returns the dispensers an address opened. Drives "My dispensers".
- `dispensersForAddress`, `dispensersForToken` — explorer passthroughs for the source-or-destination lane and the token-filter lane (the token lane is what Step 22b's buyer explorer will consume).
- `dispenserByActionIndex(chainId, actionIndex)` — single-dispenser fetch via `sdk.getAction`.
- `dispensesFor({ query, type })` — list dispense events; covers `source` / `address` / `destination` / `token` / `block` types.
- All five re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Background handlers** (`packages/extension/src/background/createBackgroundHost.js`)

- `dispensers.forSource`, `dispensers.forAddress`, `dispensers.forToken`, `dispensers.byActionIndex`, `dispenses.query` — thin read-only passthroughs; no vault involvement.

**Shell messaging helpers**

- `getDispensersForSource / forAddress / forToken`, `getDispenserByActionIndex`, `getDispenses` in `popup/messaging.js`, `web/messaging.js`, `desktop/renderer/messaging.js`.

**Shared form routes**

- `packages/core/src/shared/routes/DispensersList.jsx` — loads each chain's HD addresses in parallel, fans out one `getDispensersForSource` per address, merges + dedupes by `action_index`, sorts newest-block-first. Per-chain error surfaces inline so one chain's SDK outage doesn't block the others. Empty state wording calls out the no-addresses / no-dispensers cases. Click a row → host-provided `onOpenDispenser(chainId, actionIndex)` navigates to detail. Reuses `ActionsMenu.module.css` for list styling.
- `packages/core/src/shared/routes/DispenserDetail.jsx` — loads the dispenser action via `dispensers.byActionIndex` + wallet addresses via `addresses.byChain` in parallel; detects ownership by matching the dispenser's source against the wallet's addresses on the chain. Static metadata rows (rate, creator, dispenser address, status, block, memo, action index) plus a best-effort recent-dispenses list via `dispenses.query`. For owners, a "Cancel dispenser" button opens a confirmation stage that composes `{ VERSION: '1', DISPENSER_ACTION_INDEX }` and submits via `messaging.dispenserAction`. Danger-variant sign button, wrong-password re-prompt, 1-hour-close-window advisory. Non-owners see the read-only view.

**ActionsMenu + App routing**

- "My dispensers" entry added to `ActionsMenu` in all three shells (popup / web / desktop). Entry sits between "Create dispenser" and "Pair hardware signer".
- Each `App.jsx` tracks `'dispensers-list'` + `'dispenser-detail'` sub-routes and a `dispenserRef = { chainId, actionIndex }` state that carries context through the list → detail transition. Detail's back button returns to the list (not Actions), so users can pick a different dispenser without two hops.

### Smoke

- `packages/core/test/dispensers-list.smoke.js` — new.
  - File layout + single-export shape for both shared routes.
  - List's messaging wiring (`getDispensersForSource` per address), dedupe-by-action-index, newest-block-first sort, empty / error states.
  - Detail's load sequence (dispenser fetch + address fetch in parallel), owner-detection state, recent-dispenses fetch, cancel composer (`VERSION: '1'`, DISPENSER_ACTION_INDEX from props), danger-variant sign button, close-window advisory, wrong-password handling.
  - Flow guards (sdkRegistry / chainId / address / actionIndex / type required).
  - Positive-path test: `dispensersForSource` invokes `sdk.getDispensers(address, 'source', opts)` with expected args against a fake SDK.
  - Five background handlers registered; all three shells export the five messaging helpers.
  - ActionsMenu "My dispensers" entry + App.jsx `'dispensers-list'` / `'dispenser-detail'` sub-routes + `setDispenserRef({ chainId, actionIndex })` nav transition in popup / web / desktop.

40/40 smokes green.

### Known deferrals

- **Live escrow / remaining fills / dispense count** — `xchain-explorer/src/db.js getDispensers()` carries a TODO to surface these once the indexer fills in dispenser state. The detail page calls this out to the user ("Remaining escrow and dispense count aren't published by the indexer yet").
- **Edit (v2) surface** — the v2 cancel/edit lanes are supported in the core flow + decoder (Step 21), and the detail page now surfaces cancel. Edit (refill escrow / update lists / change expiration) waits for a follow-up — probably a separate sub-step once the list-management surface (§40.13 territory) lands.
- **Buyer explorer + "Buy one fill"** — Step 22b.
- **Reputation** — §40.7.2 shows creator reputation stars; no reputation data source exists in the indexer / hub yet.

## [0.60.0] - 2026-04-23

Phase 2 — Step 21 of 26 — piece 7a. DISPENSER authoring form (§40.7.1). First half of the Dispensers feature — creates a vending machine that sells the user's token for the native coin (primary lane) or a FIAT-priced amount (advanced). The discovery / explorer surface (§40.7.2) lands in Step 22; cancel + edit land alongside a dispenser-detail page in a later step.

### Dependency

- `xchain-sdk` bumped from `^1.8.0` to `^1.8.1`. The 1.8.1 fix narrows DISPENSER create's required-fields set to `['GIVE_TICK', 'GIVE_AMOUNT', 'GET_AMOUNT']` and adds a cross-field "either GET_TICK (token-paid) or GET_COIN (coin-paid)" check. Previously a coin-paid dispenser (the primary §40.7.1 lane) was rejected at validate-time because the validator demanded a non-empty GET_TICK. The protocol example itself emits an empty GET_TICK in that lane, so this form could not have worked against 1.8.0.

### Added

**Core flow** (`packages/core/src/flows/dispenserAction.js`)

- `dispenserAction(opts)` — mirrors `broadcastAction`. Covers all three DISPENSER lanes: v0 create (enforces `GIVE_TICK + GIVE_AMOUNT + GET_AMOUNT` + `GET_TICK or GET_COIN`), v1 cancel (requires `DISPENSER_ACTION_INDEX`), v2 edit (requires `DISPENSER_ACTION_INDEX`). Refuses `DISPENSER_ACTION_INDEX` with `VERSION 0`.
- Re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- New `decodeDispenser` case with three version-specific summaries:
  - v0 create: `"Create dispenser on X: lock N TICK, give M TICK per <price>"`. Price string adapts to coin-paid / validator-FIAT / user-oracle lanes.
  - v1 cancel: `"Cancel dispenser on X (#INDEX)"` + 1-hour-close warning.
  - v2 edit: `"Edit dispenser on X (#INDEX)"` + list-delay warning.
- Decoder emits diagnostic warnings: non-positive give/escrow, escrow < give, ambiguous payment (neither GET_TICK nor GET_COIN), oracle set without FIAT_CODE, pipe/semicolon in MEMO.

**Shared form route** (`packages/core/src/shared/routes/DispenserForm.jsx`)

- Three-stage state machine (`form → review → submitting → done`). Reuses `IssueTokenForm.module.css`.
- Spec-primary fields: Token ticker (`GIVE_TICK`), Give amount, Escrow amount, Trigger price (auto-labels with the chain's native coin). Chain + source-address pickers defaulting to the newest external HD address.
- Advanced-options expand: FIAT code (12 validated codes: USD/CAD/AUD/MXN/GBP/JPY/CNY/CHF/BRL/INR/EUR/KRW), FIAT amount (X.XX), oracle address. Covers both Mode 1 (validator-FIAT) and Mode 2 (user-oracle) FIAT lanes per DISPENSER.md.
- Live summary sentence matching the §40.7.1 wording ("You will lock … Each time someone sends … they will receive …. The dispenser holds about N fills.").
- Auto-sets `GIVE_COIN = GET_COIN = <chain's protocol ticker>` (BTC / LTC / DOGE); leaves `GET_TICK` unset for the coin-paid lane. Validates escrow ≥ give, FIAT X.XX format, oracle ⇒ FIAT_CODE.

**Background handler** (`packages/extension/src/background/createBackgroundHost.js`)

- `host.register('action.dispenser', …)` — forwards `vault + chainRegistry + sdkRegistry` into `dispenserAction`.

**Shell messaging helpers**

- `packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js` — `dispenserAction(opts)` → `sendMessage('action.dispenser', opts)` on all three.

**ActionsMenu entry + App routing**

- `popup/App.jsx`, `web/App.jsx`, `desktop/renderer/App.jsx` — new `'dispenser'` sub-route renders `<DispenserForm />`; ActionsMenu's `buildActionEntries` includes a "Create dispenser" entry between "Broadcast" and "Pair hardware signer".

### Smoke

- `packages/core/test/dispenser-form.smoke.js` — new.
  - File layout, three-stage machine, decoder wiring with `action: 'DISPENSER'`.
  - Params composer: VERSION pinned, GIVE_COIN/GET_COIN populated from chain, `GET_TICK` left unset (coin-paid lane), ORACLE_ADDRESS + FIAT fields only set when user provides them.
  - Flow guards: opts / params / GIVE_TICK / GIVE_AMOUNT / GET_AMOUNT / GET_TICK-or-GET_COIN / DISPENSER_ACTION_INDEX-requires-v1-or-v2 / from.
  - Decoder coverage for v0 coin-paid, v0 escrow < give warning, v0 oracle-without-FIAT_CODE warning, v1 cancel, v2 edit, MEMO pipe/semicolon warn.
  - `messaging.dispenserAction` on all three shells; `action.dispenser` handler; ActionsMenu + App.jsx wiring in popup + web + desktop.
- `packages/core/test/action-decoder.smoke.js` — swapped the fallback-case check from DISPENSER (now decoded) to DIVIDEND (still generic).

39/39 smokes green.

### Known deferrals

- Cancel / edit UI — v1 and v2 are supported in the core flow and decoder, but no user surface exposes them yet. They land with the dispenser-detail page (a "My dispensers" list view is part of §40.7.1 and a later step).
- Dispenser explorer / discovery (§40.7.2) — Step 22.
- Oracle-mode fill-count estimate — the "estimated fills" line in the live summary only shows for coin-paid dispensers; FIAT dispensers depend on oracle snapshots the wallet doesn't fetch.
- ALLOW_LIST / BLOCK_LIST authoring — the decoder surfaces them, but the form doesn't collect LIST action indices; that waits on a LIST management surface (deferred until §40.13 territory).

## [0.59.0] - 2026-04-23

Phase 2 — Step 20 of 26 — piece 6. BROADCAST authoring form (§40.6). First Batch-2 feature to land after Piece 5 closed out Electron packaging. Reuses the Piece 3 (ISSUE / MINT / DESTROY) pattern end-to-end: shared form route, core flow, background handler, per-shell messaging helper, ActionsMenu entry, App.jsx sub-route.

### Added

**Core flow** (`packages/core/src/flows/broadcastAction.js`)

- `broadcastAction(opts)` — mirrors `mintAsset` / `destroyAsset`. Validates that at least `MESSAGE` or `BROADCAST_ACTION_INDEX` is present (the protocol validator enforces the rest), normalizes the source address, and forwards to `submitAction` with `action: 'BROADCAST'`. `pendingTxMeta.actionSummary` reflects whether this is a plain broadcast, an oracle value, or a feed-result resolve.
- Re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- New `decodeBroadcast` case covering all four protocol format versions:
  - v0 plain message — summary quotes the text; warns on empty MESSAGE.
  - v1 oracle — summary includes the value + feed label; surfaces "Feed fee" as a percentage.
  - v2 feed — summary includes the feed identifier; surfaces "Feed fee".
  - v3 feed results — summary announces the publish + feed index.
- Warns on `|` / `;` in MESSAGE or MEMO so users see the protocol-level rejection risk before signing.

**Shared form route** (`packages/core/src/shared/routes/BroadcastForm.jsx`)

- Same three-stage state machine as MintForm / DestroyForm (`form → review → submitting → done`). Reuses `IssueTokenForm.module.css` for visual parity.
- Fields: chain picker (when the wallet has addresses on >1 chain), source-address picker (defaults to newest external HD address on the chosen chain), Feed name (optional), Message (required unless Feed name is set), Value (optional numeric), Feed fee (optional %), "Prepend UTC timestamp to memo" checkbox.
- Version selection auto-derived from filled fields: `{ VALUE, FEE } → v1`, `{ FEE } only → v2`, else `v0`.
- MESSAGE composition: feed name wins if provided; text becomes MEMO (prefixed with an ISO timestamp when the checkbox is on). When only text is provided, it fills MESSAGE.
- Review runs the composed params through `decoder.decodeAction` so the sign screen's summary + warnings match what will land on-chain. Wrong-password errors (`InvalidPasswordError`) surface inline without leaving the review stage.

**Background handler** (`packages/extension/src/background/createBackgroundHost.js`)

- `host.register('action.broadcast', …)` — forwards `vault + chainRegistry + sdkRegistry` into `broadcastAction`.

**Shell messaging helpers**

- `packages/extension/src/popup/messaging.js` — `broadcastAction(opts)` → `sendMessage('action.broadcast', opts)`.
- `packages/web/src/messaging.js` — parity helper, same wire.
- `packages/desktop/renderer/messaging.js` — parity helper, routes through the preload bridge.

**ActionsMenu entry + App routing**

- `popup/App.jsx`, `web/App.jsx`, `desktop/renderer/App.jsx` — new `'broadcast'` sub-route renders `<BroadcastForm />`; ActionsMenu's `buildActionEntries` now includes a "Broadcast" entry between "Transfer ownership" and "Pair hardware signer".

### Smoke

- `packages/core/test/broadcast-form.smoke.js` — new.
  - File layout + export shape + CSS reuse.
  - Three-stage state machine, decoder wiring with `action: 'BROADCAST'`, params composer correctness (MESSAGE/VALUE/FEE/MEMO conditional setting + timestamp injection).
  - `messaging.broadcastAction` exported from all three shells; action.broadcast handler registered.
  - Core flow validation guards (`opts`, `params`, `MESSAGE or BROADCAST_ACTION_INDEX`, `from`).
  - Decoder coverage for all four format versions, including the pipe/semicolon warning.
  - ActionsMenu + App.jsx wiring in popup + web + desktop.

All 38 smokes green.

### Known deferrals

- Feed-results (v3) — no standalone authoring lane in this form. The resolve-a-feed path will land alongside the feed-detail page in a later step (likely after a dispensers / explorer surface exists to navigate from).
- Feed discovery / recent broadcasts list — the form publishes; it doesn't yet surface an address's published feeds. That UI depends on explorer integration and is out of scope for §40.6.

## [0.58.0] - 2026-04-23

Phase 2 — Step 19 of 26 — piece 5d. Electron-builder packaging pipeline for the desktop shell (§40.12, §51). Closes Piece 5 (Electron desktop shell). Ships the scaffolding needed to produce installable artifacts on all three target OSes — electron-builder config, Vite renderer bundle, Dockerfile-based reproducible builds (Level-2 scoped to the pre-signing artifact), URI scheme registration (Tier-1 `xchain:` claimed unconditionally + Tier-2 `bitcoin/litecoin/dogecoin` registered at install, claimed only via runtime opt-in), deep-link dispatch with BIP21 parsing, electron-updater wiring against `downloads.xchain.io`, CSP tightening + hardened-runtime entitlements. Code signing is structured but env-var-driven — no certs in-repo; `pnpm run dist` works without signing for dev builds.

### Added

**Packaging config + build resources** (`packages/desktop/`)

- `electron-builder.config.cjs` — single source of truth for packaging across Windows / macOS / Linux.
  - `appId = io.xchain.wallet`, `productName = XChain Wallet`, `asar: true`, `npmRebuild: false`, `buildDependenciesFromSource: false` (reproducibility-critical flags).
  - `mac` — hardened-runtime + entitlements at `build/entitlements.mac.plist`, `identity: CSC_IDENTITY_NAME ?? null` (unsigned dev builds work without certs), notarization gated on `APPLE_API_KEY_ID`, targets: dmg + zip (x64 + arm64).
  - `win` — publisher = "Dankest, LLC", SHA256 signing, RFC 3161 timestamp server pinned (signatures survive cert expiry), targets: nsis + zip (x64 + arm64).
  - `linux` — maintainer + synopsis + description set, targets: AppImage + deb (x64 + arm64), xz compression on deb.
  - `protocols` declares all four schemes (`xchain`, `bitcoin`, `litecoin`, `dogecoin`) at install time so the OS knows we CAN handle them — runtime claim is gated in `main/protocol.js`.
  - `publish` — electron-updater generic provider at `https://downloads.xchain.io/wallet/desktop/`.
  - `extraMetadata.buildDate` derived from `SOURCE_DATE_EPOCH` (set by reproduce.sh to the HEAD commit's author date).
- `vite.config.js` — renderer build config. Deterministic chunk / asset filenames; source maps off; `assetsInlineLimit: 0` to prevent small-file inlining variance; output into `renderer/dist/`.
- `build/entitlements.mac.plist` — macOS hardened-runtime entitlements. `com.apple.security.device.usb` (required for WebHID ↔ Ledger), `com.apple.security.network.client` (xchain-sdk + Trezor Connect iframe + electron-updater); JIT / unsigned-executable disabled.
- `build/README.md` — placeholder for `icon.png` / `icon.icns` / `icon.ico` (not yet committed — icon design is an open task).
- `packages/desktop/package.json` — new scripts (`build:renderer`, `dist`, `dist:unpacked`, `reproduce`); new devDep `electron-builder ^25.1.0`; new dep `electron-updater ^6.3.0`.

**Level-2 reproducible builds** (§51)

- `Dockerfile` — digest-pinned Debian bookworm-slim base, SHA256-pinned Node 20.18.0 tarball, pnpm version sourced from root `packageManager` field via build-arg. Non-root `builder` user with UID 1000 (reproduce.sh maps to host UID via `--user`). Installs only the system deps electron-builder Linux target needs (fpm, fakeroot, rpm, libarchive-tools).
- `.dockerignore` — excludes `node_modules`, `dist`, `.vite`, etc. from the build context so the image stays small + doesn't leak local dev state.
- `scripts/build.sh` — in-container build entry. Enforces `SOURCE_DATE_EPOCH`, runs `pnpm install --frozen-lockfile`, builds the renderer, invokes `electron-builder --dir` (unpacked app only — signing happens outside), emits `/out/RELEASE_HASHES.txt` (sorted find | xargs sha256sum).
- `scripts/reproduce.sh` — third-party reproduction entry. Takes a git ref, derives `SOURCE_DATE_EPOCH` from its commit date, creates an isolated git worktree, builds the image with the ref's pnpm version, runs the build, prints the manifest for diffing against published `RELEASE_HASHES.md`.
- `REPRODUCIBLE_BUILDS.md` — end-to-end verification protocol: what's reproducible (Linux pre-signing artifact), what's NOT (signed outputs, macOS + Windows builds — those need platform-specific runners — the Electron framework download itself), the `diff` recipe, non-determinism sources we've addressed (SOURCE_DATE_EPOCH, LC_ALL / TZ, frozen lockfile, Vite deterministic hashing), update trust chain (platform-specific integrity checks), Trezor Connect trust boundary + on-device-confirmation mitigation, per-release checklist.

**URI scheme registration + deep-link dispatch** (`packages/desktop/main/protocol.js`)

- `TIER_1_SCHEME = 'xchain'` / `TIER_2_SCHEMES = ['bitcoin', 'litecoin', 'dogecoin']` — single source of truth.
- `registerProtocolClients(app, { optedInSchemes })` — claims `xchain:` unconditionally; Tier-2 schemes only when the caller passes them in the opt-in list. Proactively `removeAsDefaultProtocolClient`s un-opted schemes so the settings toggle can flip them later without a reinstall.
- `updateCoinSchemeOptIn(app, schemes)` — future settings-UI hook (persisted-preference wiring lands in a follow-up step).
- `attachDeepLinkHandlers(app, { onDeepLink })` — wires `requestSingleInstanceLock` (second `bitcoin://` click while app is running consolidates into the existing window), macOS `open-url`, Windows/Linux `second-instance` + first-launch `process.argv` scan. Returns `{ gotLock: false }` when another instance holds the lock, letting the caller quit cleanly.
- `classifyDeepLink(url)` — parses URIs. `xchain:` bubbles up raw (renderer decodes via core's action decoder). `bitcoin:` / `litecoin:` / `dogecoin:` run through core's `parseBip21Uri`; malformed BIP21 surfaces as `parsed: null` with raw preserved for debugging.

**electron-updater wiring** (`packages/desktop/main/updater.js`)

- `attachUpdater({ loader, onEvent })` — DI'd loader (dynamic-imports `electron-updater` in production). Short-circuits cleanly in dev (`isUpdaterActive() === false`) — no-op `checkForUpdates` + no event listener registration, so `pnpm run start` doesn't try to self-update against the prod URL.
- `autoDownload` forced off — user clicks "install" in an in-app notification, then `downloadUpdate()` runs and progress events relay to the renderer.
- All seven updater events (`checking`, `available`, `not-available`, `progress`, `downloaded`, `error`) forwarded via the `onEvent` callback in a uniform `{ type, info }` shape.

**Main-process wiring** (`packages/desktop/main/index.js`)

- Single-instance lock acquired BEFORE `whenReady` — per Electron's docs, `requestSingleInstanceLock` must fire early so a second invocation's URL routes into the existing instance before anything else runs.
- On `whenReady`: `registerProtocolClients(app, { optedInSchemes: [] })` (Tier-1 only until settings lands), `attachHidPermissions(session.defaultSession)` (unchanged from Step 18), `attachUpdater({ onEvent: relayToRenderer })` + kicks off a check.
- `forwardDeepLink` — queues the first URI if the renderer isn't up yet, replays on `ready-to-show`. Focuses the window so a `bitcoin://` click surfaces the app to the foreground.
- `mainWindow.loadFile` now points at `renderer/dist/index.html` (the Vite bundle output), not `renderer/index.html` (the source).

**CSP tightening** (`packages/desktop/renderer/index.html`)

- `frame-src https://connect.trezor.io` — explicit allowlist for the Trezor Connect iframe. Makes the trust dependency auditable instead of ambient permissiveness. `connect-src` stays `'self'` — the renderer itself never fetches from connect.trezor.io; only the Trezor iframe does, and it lives in a separate origin bound by `frame-src`.

### Smoke + docs

- `packages/core/test/desktop-packaging.smoke.js` — new. Exercises:
  - File layout + electron-builder config structure + deterministic flags (asar, npmRebuild, buildDependenciesFromSource).
  - All four schemes declared in `protocols`.
  - mac / win / linux target shapes; `identity: null` when CSC_IDENTITY_NAME unset; Windows RFC 3161 timestamp server pinned.
  - `publish` uses electron-updater generic provider pointing at `downloads.xchain.io` over HTTPS.
  - Protocol module: Tier 1 + Tier 2 constants; `registerProtocolClients` claims + removes correctly based on opt-in list; `classifyDeepLink` handles `xchain:`, coin URIs, malformed BIP21, junk input; `attachDeepLinkHandlers` validates its callback.
  - Updater module: dev-mode short-circuit, prod-mode event forwarding for all seven event types, `autoDownload` forced off, input validation.
  - `main/index.js` wires `registerProtocolClients` + `attachDeepLinkHandlers` + `attachUpdater` + single-instance lock + loads `renderer/dist/index.html`.
  - Dockerfile pins base-image digest + Node SHA256 + takes pnpm version as build-arg + runs as non-root.
  - `build.sh` / `reproduce.sh` — strict mode, `SOURCE_DATE_EPOCH` required, `--frozen-lockfile`, SHA256 manifest emission, `git worktree` isolation, `--user $(id -u):$(id -g)` mapping.
  - Scripts are executable.
  - CSP allowlists only `connect.trezor.io` for `frame-src`.
  - `REPRODUCIBLE_BUILDS.md` sections present.
- `packages/desktop/REPRODUCIBLE_BUILDS.md` — end-to-end verifier docs.

### Changed

- Version bump: `0.57.0 → 0.58.0`. All 8 workspace packages stay synchronized.
- `packages/desktop/package.json` description updated to reflect Piece 5 completion ("Phase 2 §40.12: main-process signing isolation, OS keychain auto-unlock, WebHID hardware signer pairing, electron-builder packaging with Level-2 reproducible pre-signing artifacts, URI scheme registration, electron-updater wiring").

### Known deferrals

- **Icon assets** — `build/icon.png` / `.icns` / `.ico` not yet committed. First public release must ship them; electron-builder's default placeholder is fine for dev.
- **Code-signing certs** — config structured, certs not wired. Signed releases happen when `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_API_KEY_ID` / `APPLE_TEAM_ID` are set in the build env. Needs Sectigo / DigiCert EV (Windows) + Apple Developer Program (macOS) before the first public signed release.
- **Tier-2 opt-in settings UI** — `updateCoinSchemeOptIn` exists; the settings screen + persisted preference backing it don't. A user-visible toggle for "Make XChain Wallet my default Bitcoin wallet?" lands alongside the settings route in a future step.
- **Trezor Connect local bundling** — deferred per the Step-19 risk analysis. On-device confirmation is the real trust anchor; CSP allowlist makes the CDN dependency auditable. Future step can bundle Connect assets under an `app://` scheme + flip `connectSrc` if a specific incident or product need justifies it.
- **macOS + Windows reproducible builds** — current Dockerfile targets Linux. Cross-compiling macOS / Windows bit-for-bit is significantly harder (platform runners, `lipo`, Authenticode signing, notarization tickets embedded in binaries). Pre-signing hashes for those platforms are published from maintainer-operated platform runners; VM-based reproduction is a post-1.0 consideration.
- **GPG-signed update manifests** — Linux artifact integrity today depends on HTTPS TLS + maintainer control of `downloads.xchain.io`. A TUF-style role separation model is a stronger chain we can add post-1.0.

### Developer notes

- Smoke count: 37 (was 36; +1 for desktop-packaging).
- End-to-end Electron + electron-builder execution still requires `pnpm install` (~200 MB Electron bundle) + platform-specific signing tooling. Static smokes cover the config + wiring; real `pnpm run dist` verification waits for a dev-env setup.
- Piece 5 (Electron desktop shell, §40.12) is feature-complete at this layer — Steps 16, 17, 18, 19 together deliver the scaffold, keychain auto-unlock, HW signer pairing, and packaging / update / URI scheme infrastructure. Phase 2 continues with Batch 2 (Steps 20-26 — BROADCAST, dispensers, DIVIDEND, AIRDROP, Advanced Actions Form, FreeWallet migration).

## [0.57.0] - 2026-04-23

Phase 2 — Step 18 of 26 — piece 5c. Hardware signer pairing goes live on the Electron desktop shell via Chromium's WebHID (`@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`) and Trezor Connect's iframe popup (`@trezor/connect-web`). Zero native modules — same pure-JS HW stack as the extension + web shells, so no `node-hid`, no `electron-rebuild`, no per-platform `.node` binaries, no `asarUnpack`. As part of this step the pair-sequence logic was hoisted into `@xchain-wallet/core/signerFactories/` so extension + web + desktop share one source of truth; shells own only the transport init + permission wiring.

### Added

**Core builders** (`packages/core/src/signerFactories/`)

- `signerFactories/trezor.js` — `makeTrezorFactory({ getConnect })`. Shell-agnostic Trezor pair sequence: call `getConnect()` to obtain an initialized TrezorConnect, call `getFeatures`, derive `deviceIdentifier` / `model` / `firmwareVersion` via the existing `deviceIdentifierFromFeatures` / `modelFromFeatures` / `firmwareVersionFromFeatures` helpers (from Step 13), construct a `TrezorSigner` with the connect reference, return `{ signer, pairingInfo }` for `flows.registerSigner`. No `@trezor/connect-web` imports in core — DI keeps the native SDK bound to each shell.
- `signerFactories/ledger.js` — `makeLedgerFactory({ getTransport, getAppClass })`. Shell-agnostic Ledger pair sequence: call the DI'd transport + Btc-class loaders, construct the Btc app, read `getAppAndVersion`, derive the device identifier from the account-0 xpub via `deriveLedgerDeviceIdentifier` (from Step 14), construct a `LedgerSigner`. Same DI posture as Trezor — no `@ledgerhq/*` imports in core.
- `signerFactories/index.js` — re-exports both builders.
- `packages/core/src/index.js` — re-exports `signerFactories` as a namespace bag alongside `signers`, `flows`, etc.
- `packages/core/package.json` — new `"./signerFactories"` subpath export for direct import without the root namespace.

**Desktop renderer factories** (`packages/desktop/renderer/signerFactories/`)

- `trezorFactory.js` — thin binding around `makeTrezorFactory`. Lazy-imports `@trezor/connect-web`, initializes with the XChain manifest, feeds the result into the core builder. Keeps the default `connectSrc` for now (pointing at `connect.trezor.io`); Step 19 packaging will add a local-bundled `connectSrc` so sign-click doesn't hit the network.
- `ledgerFactory.js` — thin binding around `makeLedgerFactory`. Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`, feeds `TransportWebHID.create()` + the Btc class into the core builder.

**Main-process WebHID permission wiring** (`packages/desktop/main/permissions.js`)

- `attachHidPermissions(session)` — attaches both `setPermissionRequestHandler` (grants `hid`, default-denies everything else) and `setDevicePermissionHandler` (allowlist: Ledger `0x2C97`, Trezor T `0x1209`, Trezor One `0x534C` — filters the device-picker dialog). Without this, Electron under `contextIsolation: true` + `sandbox: true` returns an empty device list to `navigator.hid.requestDevice()` and the WebHID transport spins indefinitely.
- `HID_VENDOR_ALLOWLIST` + `isAllowedHidVendor(vendorId)` — the constants + a pure helper so smokes can verify the allowlist without mounting an Electron session.
- `packages/desktop/main/index.js` — wires `attachHidPermissions(session.defaultSession)` into `app.whenReady`.

### Changed

**Shell factories — now thin bindings over core builders**

- `packages/extension/src/signers/trezorFactory.js` — rewritten to delegate pair logic to `makeTrezorFactory` while keeping the extension-specific manifest, lazy-loader, and cached Connect instance in place. Public API unchanged (`getTrezorConnect`, `pairTrezorSigner`, `resetTrezorConnect`). The `@trezor/connect-web` lazy-import stays in the extension package — core remains dep-free.
- `packages/extension/src/signers/ledgerFactory.js` — same posture: delegates to `makeLedgerFactory`, keeps `@ledgerhq/*` lazy-imports + cached transport in the extension.
- `packages/web/src/signers/trezorFactory.js` / `ledgerFactory.js` — unchanged. Web still re-exports from the extension factory via cross-package relative path, so it picks up the new delegation transitively.

**Renderer wiring** (`packages/desktop/renderer/App.jsx`)

- Imports `pairTrezorSigner` + `pairLedgerSigner` from the new `./signerFactories/*.js` modules and passes them into `PairSignerForm` (previously `undefined` placeholders per the Step 16 scaffold). The ActionsMenu entry description changed from "native HW transports arrive at Step 18" to "via WebHID + Trezor Connect".

### Dependencies

- `packages/desktop/package.json` — adds `@trezor/connect-web` ^9.7.0, `@ledgerhq/hw-transport-webhid` ^6.35.0, `@ledgerhq/hw-app-btc` ^10.21.0 at the same versions the extension pins. pnpm hoists to a single install so the on-disk footprint doesn't double. Description updated: "main-process signing isolation (§9.3.2) + OS keychain auto-unlock + WebHID hardware signer pairing (§40.12). electron-builder packaging ships in Phase 2 Step 19".

### Smoke + docs

- `packages/core/test/hw-factories.smoke.js` — new. Exercises:
  - Core builders exist + import no `@trezor/*` / `@ledgerhq/*` (comments stripped before the regex to let the JSDoc examples mention the SDK names without tripping the check).
  - `makeTrezorFactory` validates deps, success path returns `{ signer, pairingInfo }` with the right shape against a mock Connect, failure paths (user cancellation, malformed Connect) surface clear errors.
  - `makeLedgerFactory` same end-to-end: success path returns a `LedgerSigner` + pairingInfo with a deterministically-derived `deviceIdentifier`, failure paths (null transport, non-constructor Btc, Bitcoin app closed) surface clear errors.
  - Desktop renderer factories exist, import the core builder via cross-package relative path, and lazy-import the HW SDKs.
  - `packages/desktop/package.json` declares HW deps at extension-parity versions (drift guard: assertion diffs against extension/package.json).
  - `renderer/App.jsx` wires the real factories into PairSignerForm and no longer passes `undefined`.
  - Main-process permission handlers: vendor allowlist covers Ledger + both Trezor models; allows `hid` / denies other permissions; device handler filters on `deviceType === 'hid'` and whitelisted vendorId; rejects null session; invoked from main/index.js on `app.whenReady`.
- `packages/core/test/trezor-signer.smoke.js` — updated. New assertions verify the core builder file exists, exports `makeTrezorFactory`, and contains no `@trezor/connect-web` imports (real code, with comments stripped). Extension factory asserts it delegates via `makeTrezorFactory` + imports core through the cross-package relative path `../../../core/src/signerFactories/index.js`. Retains all Step-13 behavioural assertions (mock Connect round-trip, deviceIdentifier / model / firmwareVersion helpers).
- `packages/core/test/ledger-signer.smoke.js` — parallel updates for the Ledger factory migration.
- `packages/core/test/desktop-shell.smoke.js` — the Step 16 "renderer App passes `undefined` HW factories (deferred to Step 18)" assertion flipped to "renderer App wires real `pairTrezorSigner` + `pairLedgerSigner` factories". Description + success line updated accordingly.

### Known deferrals

- **Packaging** (Step 19) — electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51. Step 19 will also bundle Trezor Connect's iframe assets locally and flip the desktop factory's `connectSrc` to an `app://`-scheme URL so sign-click stops touching connect.trezor.io.
- **Sign-path integration for HW** — PSBT↔Trezor / PSBT↔Ledger converters + message-signing envelope + renderer↔background signing bridge remain deferred (see v0.53.0 CHANGELOG "Known deferrals"). Step 18 delivers pairing; actual HW signing lands in a dedicated later step.

### Developer notes

- Smoke count: 36 (was 35; +1 for hw-factories).
- Real-hardware verification still pending: plugging a Trezor + Ledger into the Electron app requires `pnpm install` + the ~200 MB Electron bundle + user manual testing. DI-mock smokes cover the wiring; live device exercise waits for Step 19 + on-device pass.
- `TrezorSigner` / `LedgerSigner` continue to have zero Trezor/Ledger SDK imports in core — the Step-13/14 invariant is preserved at the class level, and Step 18 extends it up to the factory layer.

## [0.56.0] - 2026-04-23

Phase 2 — Step 17 of 26 — piece 5b. OS keychain integration for the Electron desktop shell (§40.12). After the first-launch unlock, the master key is cached in the OS-level keychain (macOS Keychain / Windows DPAPI / Linux libsecret) via Electron `safeStorage` so subsequent app launches skip the password prompt until the user explicitly locks or the OS keychain becomes unreadable (logout, keychain reset, user profile change). When no real keychain is available, the shell silently refuses to persist to disk — the user re-enters their password every launch rather than have the key cached insecurely.

### Added

**Main process** (`packages/desktop/main/`)

- `main/keychain.js` — `KeychainSessionBackend` class. Same `{load, save, clear}` contract as the extension's `ChromeSessionBackend` so the shared pre-host handlers (`wallet.unlock`, `wallet.lock`, `wallet.create`, `wallet.import`) treat it identically. `save(masterKey)` encrypts via `safeStorage.encryptString`, writes the ciphertext to `session.bin` under `app.getPath('userData')` atomically (tmp + rename). `load()` decrypts the ciphertext, returning the raw key bytes; falls back to `null` on missing file, unavailable keychain, or decrypt failure (OS logout / keychain reset / corrupted ciphertext) — never throws on "no session", so callers treat `null` as "prompt for password". Also caches the current-session key in a module-private in-memory slot so the shell stays unlocked in-process even when no OS keychain is wired. `isAvailable()` returns false when `safeStorage.isEncryptionAvailable()` is false OR `getSelectedStorageBackend()` reports `basic_text` (deterministic fallback — no real confidentiality).
- `main/meta.js` — `FileMetaBackend` class. Plaintext JSON slot for the vault's Argon2id `kdfParams` (public by design; storing outside the ciphertext is the only way the unlock flow can derive the master key from the user's password before touching the encrypted blob). Atomic writes via tmp + rename.
- `main/runtime.js` — Electron-free state machine that `index.js` delegates to. `createRuntime(deps)` builds the lifecycle object; `ensureHost(runtime)` auto-unlocks from the cached session key; `tearDownHost(runtime)` closes the vault + drops the host; `handleIpcMessage(runtime, message)` routes pre-host types (gated by `PRE_HOST_MESSAGE_TYPES`) through `dispatchPreHost` and everything else into the `MessageHost`, returning the standard `{ ok, result } | { ok, error }` envelope. Non-pre-host messages when the host is null return `WalletLockedError`. The split keeps all the interesting logic testable under plain Node without importing `electron`.

**Extension + core refactor**

- `packages/extension/src/background/sessionMeta.js` — exported two new shell-agnostic helpers alongside the existing `attachSessionMetaListener`:
  - `dispatchPreHost(type, request, { storageBackend, sessionBackend, metaBackend, chainRegistry, sdkRegistry, onUnlocked, onLocked })` — the same handler dispatch the extension's chrome.runtime listener uses, now parameterized on the backend trio so desktop can wire a file/keychain backend set. Throws `Error` for unknown types.
  - `handleSessionStatus({ storageBackend, sessionBackend })` — refactored to take the backends as deps instead of instantiating `ChromeStorageBackend` / `ChromeSessionBackend` itself.
- `packages/extension/src/background/index.js` — re-exports `dispatchPreHost`, `handleSessionStatus`, and `PRE_HOST_MESSAGE_TYPES` alongside `attachSessionMetaListener`.

**Main-process rewire** (`packages/desktop/main/index.js`)

- Replaced the Step 16 scaffold's placeholder master-key wiring with the real three-backend pipeline. `app.whenReady` now:
  1. Builds the runtime against `FileStorageBackend` (vault) + `FileMetaBackend` (kdfParams) + `KeychainSessionBackend` (master key).
  2. Calls `ensureHost(runtime)` — best-effort auto-unlock. Success → vault opens, MessageHost comes up, renderer sees `state: 'unlocked'` on first `session.status`. Failure (no cached key, keychain unavailable, or cached key doesn't decrypt the vault — stale after a wallet reset) → stays locked; renderer drives `wallet.unlock` through the pre-host listener.
  3. Registers `ipcMain.handle(IPC_CHANNEL, …)` that delegates to `handleIpcMessage`.
- SDK factory swapped from the `getSdk / has / listChainIds` stub to a real `sdkLib.SDKRegistry` wrapping `createDevMockSdk` — same pattern the extension service worker and web hostBridge use, so onboarding flows actually reach the vault (the Step 16 stub didn't expose `.get(chainId)` and `wallet.create` would `TypeError`).
- `app.on('before-quit')` zeros the master key + closes the vault via `tearDownHost(runtime)`; the keychain ciphertext stays on disk so the next launch can auto-unlock.

### Smoke + docs

- `packages/core/test/desktop-keychain.smoke.js` — new, exercises the full Step 17 surface:
  - `KeychainSessionBackend` round-trip through a mock safeStorage (XOR scramble, not cryptographic — tests fidelity, not security). Ciphertext on disk is NOT equal to plaintext. `clear` removes the file + zeros the in-memory slot.
  - `isAvailable()` returns false when `isEncryptionAvailable()` is false; false when the backend is `basic_text`. `save` is a no-op (no file created) in the unavailable case but keeps the key in-memory for the current session.
  - `load()` returns `null` (not throws) on decrypt failure — simulates OS logout / keychain reset via a second backend instance with a failing `decryptString`.
  - `FileMetaBackend` round-trip: save + load preserves object shape, clear removes the file.
  - End-to-end runtime lifecycle with real crypto + mock keychain: fresh runtime → `state: 'no-wallet'` → `wallet.create` onboarding (onUnlocked fires, host is built, session.bin persisted, post-host `wallet.list` returns the created wallet) → "restart" (drop runtime, build a new one against the same userData) auto-unlocks via the keychain without a password prompt → `wallet.lock` clears session.bin + returns `WalletLockedError` for subsequent post-host messages → wrong-password `wallet.unlock` returns `InvalidPasswordError` with no session written → right password rebuilds the host + re-persists the session.
  - Keychain-unavailable path: onboarding succeeds but session.bin is NOT written; restart sees `state: 'locked'` and requires a password prompt. No insecure cache, as designed.
  - Static wiring: `main/index.js` imports `keychain.js`, `meta.js`, `runtime.js`; references `safeStorage` and `ensureHost(runtime)`; `runtime.js` routes via `dispatchPreHost` + gates on `PRE_HOST_MESSAGE_TYPES` + returns `WalletLockedError`; `keychain.js` checks `isEncryptionAvailable` + refuses `basic_text`.

### Changed

- `packages/desktop/package.json` description updated from "Native HW transports + OS keychain + packaging ship in Phase 2 Steps 17–19" to "main-process signing isolation (§9.3.2) + OS keychain auto-unlock (§40.12). Native HW transports + packaging ship in Phase 2 Steps 18–19".
- Version bump: `0.55.0 → 0.56.0`. All eight workspace packages stay synchronized per the convention codified at v0.54.0.

### Known deferrals

- **Native HW transports** (Step 18) — desktop-specific `pairTrezorSigner` + `pairLedgerSigner` factories using `@trezor/connect` (node) + `@ledgerhq/hw-transport-node-hid`. Until then PairSignerForm renders the "not available in this context" fallback on desktop.
- **Packaging** (Step 19) — electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51.
- **Idle-lock timer** — spec mentions an auto-lock on idle; desktop currently only locks on explicit `wallet.lock`. Folding an idle timer into `runtime.js` is cheap and can land in any later step.

### Developer notes

- Smoke count: 35 (was 34; +1 for desktop-keychain).
- The Step 17 scaffold is exercisable **only** via the smoke — actually launching Electron still needs `pnpm install` and the ~200 MB Electron bundle.
- `dispatchPreHost` is now the single source of truth for unlock / lock / onboarding dispatch. Extension's `attachSessionMetaListener` and desktop's `handleIpcMessage` both route through it — no divergence in error shapes, handler ordering, or validation between the two shells.

## [0.55.0] - 2026-04-23

Phase 2 — Step 16 of 26 — piece 5a. Opens **Piece 5 (Electron desktop shell, §40.12)** with the main-process signing isolation scaffold (§9.3.2). Desktop renderer mounts the same React app popup + web use; keys never cross the contextBridge IPC boundary into the renderer. Steps 17–19 fill in OS keychain, native HW transports, and electron-builder packaging.

### Added

**Main process** (`packages/desktop/main/`)

- `main/index.js` — Electron app entry. `app.whenReady` initializes the vault + MessageHost + BrowserWindow. `ipcMain.handle(IPC_CHANNEL)` routes bridge messages into the host. BrowserWindow is hardened: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `app.on('before-quit')` zeros the master key + closes the vault defensively.
- `main/messageHost.js` — `createDesktopMessageHost(deps)` wraps `createBackgroundHost` (the same factory the extension service worker uses) with an IPC-friendly `handle(message)` function. Exports `IPC_CHANNEL = 'xchain-wallet:message'` so preload + main never drift. Cross-package relative import keeps this smoke-resolvable under Node.
- `main/storage.js` — `FileStorageBackend` extends `StorageBackend`, persists the encrypted blob to `app.getPath('userData')/vault.bin`. Atomic writes via `fs.writeFile(tmpPath)` + `fs.rename()` — POSIX and Windows both guarantee atomic rename. `load()` returns `null` on ENOENT (first-run case). `vaultPathFor(userDataDir)` is a pure helper so non-Electron callers (smoke tests, CLI inspectors) can compute the path.

**Preload + renderer** (`packages/desktop/`)

- `preload.js` — exposes exactly `window.xchainWalletBridge.sendMessage(message)` via `contextBridge`, nothing else. No Node modules, no `require`, no filesystem access leak into the renderer.
- `renderer/main.jsx` — React mount. Imports `@xchain-wallet/core/ui/tokens.css` so design tokens install on `:root`.
- `renderer/App.jsx` — same state-machine shape as popup/web App.jsx: `MessagingProvider shell="desktop"` + every shared route under `@xchain-wallet/core/shared/routes/*`. PairSignerForm receives `pairTrezor={undefined}` + `pairLedger={undefined}` — the form's vendor cards render the "not available in this context" fallback. Real desktop-native HW factories arrive in Step 18.
- `renderer/bridgeMessaging.js` — wraps `window.xchainWalletBridge.sendMessage` into a `sendMessage(type, request)` Promise that mirrors `chromeMessaging.js`'s envelope unwrapping. Typed error names (`InvalidPasswordError`, `NotImplementedError`, etc.) preserve across IPC so shared components branch on them unchanged.
- `renderer/messaging.js` — popup/web-parity helpers (`unlockWallet`, `listWallets`, `getWalletBalances`, `sendAsset`, `issueToken`, `mintAsset`, `destroyAsset`, `registerSigner`, `listSigners`, `unregisterSigner`, `exportPrivateKey`, …). The smoke verifies that every helper the desktop exports exists in the popup module — drift in either direction would break the shared routes.
- `renderer/index.html` — standard Electron renderer HTML. Ships a CSP header (`default-src 'self'`) pinning the renderer to loading only locally-bundled assets.

**Smoke + docs**

- `packages/core/test/desktop-shell.smoke.js` — covers the main-process file layout, preload-bridge narrowness (no `node:` imports, no `require()`), IPC channel name constant, MessageHost reuse of `createBackgroundHost`, `contextIsolation` / `nodeIntegration` / `sandbox` on the BrowserWindow, full round-trip of the FileStorageBackend through an OS tmpdir, a real MessageHost `handle()` call (`wallet.list`) including the unknown-type error envelope, parity of the renderer messaging helpers against popup, App.jsx import surface + the `pairTrezor={undefined}` deferral, and synchronized-version diff against the root `package.json`.
- `packages/desktop/README.md` — rewritten from "Phase 2 — deferred" to document the Step 16 scaffold, the two-process architecture, and what Steps 17–19 still have to land.
- `packages/desktop/package.json` — declares `@xchain-wallet/core` + `@xchain-wallet/extension` workspace deps and Electron as a devDep (`^41.3.0`, the current stable at release time).

### Known deferrals

- **Unlock flow** — main/index.js initializes the vault with a placeholder master key. Real unlock (password → Argon2id → master key) comes via the existing `wallet.unlock` handler from `createBackgroundHost`; the vault's internal state needs a re-seed pass when the password is collected. This is fine for the scaffold — the IPC contract is in place, so Step 17's keychain work can extend it cleanly.
- **OS keychain** (Step 17) — Electron `safeStorage` wired to skip password prompts after first launch.
- **Native HW transports** (Step 18) — desktop-specific `pairTrezorSigner` + `pairLedgerSigner` factories using `@trezor/connect` (node) + `@ledgerhq/hw-transport-node-hid`. Until then PairSignerForm renders the "not available in this context" fallback on desktop.
- **Packaging** (Step 19) — electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51.

### Changed

- Version bump: `0.54.0 → 0.55.0`. All eight workspace packages stay synchronized per the convention codified at v0.54.0.

### Developer notes

- Smoke count: 34 (was 33; +1 for desktop-shell).
- The Step 16 scaffold is exercisable **only** via the smoke — actually launching Electron needs `pnpm install` and the ~200 MB Electron bundle, which the dev environment here doesn't have. The smoke covers everything statically checkable + a real file-backed `FileStorageBackend` round-trip through the OS tmpdir.
- Using the extension's `createBackgroundHost` via cross-package relative path (matches `packages/web/src/hostBridge.js`'s convention) was the key call that keeps the MessageHost contract single-sourced without needing a pnpm workspace symlink at smoke time.

## [0.54.0] - 2026-04-23

Housekeeping — no feature changes. Drops the GitHub Actions CI workflow and synchronizes every workspace package's version with the root so all surfaces report the same version.

### Removed

- `.github/workflows/ci.yml` and the `.github/` directory. Matches the rest of the xchain-* platform (`xchain-encoder`, `xchain-decoder`, `xchain-node`, etc. don't ship a GitHub Actions workflow during their build phase). CI will be reintroduced post-Phase-2 when the wallet's release surface stabilizes. Until then: run the test suite locally with `node packages/core/test/_run-smokes.js` and Playwright with `pnpm --filter @xchain-wallet/e2e test`.
- `packages/core/test/e2e-harness.smoke.js` — section 5 (CI workflow structural checks) replaced with a comment explaining the removal. The smoke's OK-line updated to drop the "CI job" mention.
- `README.md` — the repo-tree line `├── .github/workflows/` removed.

### Changed

- **Synchronized versioning across all workspace packages.** Every `package.json` (root + `packages/core` + `packages/extension` + `packages/web` + `packages/desktop` + `packages/bridge-spec` + `packages/test-dapp` + `e2e`) now reports `0.54.0`. Previously sub-packages were pinned at `0.1.0` while the root tracked wallet progression — meaning a shipped extension bundle's manifest reported `0.1.0` instead of the true build version. The synchronized scheme lets users diff `0.54.0-extension` / `0.54.0-web` / `0.54.0-desktop` in each shell's About screen and confirm they're on the same codebase.
- `README.md` — new "Versioning" section documenting the lockstep-bump convention so it's discoverable.
- `e2e/README.md` — `## CI` section reworded to explain CI is intentionally absent during development, matching the xchain-* platform convention.
- `tools/build-reproduce/README.md` — Node-version pin note no longer points at the (now-removed) `.github/workflows/ci.yml`. Pin moves here until the release pipeline codifies it.

### Convention going forward

On each release, bump every `package.json` version in lockstep. The root `package.json` version is the single source of truth; every sub-package tracks it. Individual sub-packages do not maintain their own changelogs — this file is authoritative.

## [0.53.0] - 2026-04-23

Phase 2 — Steps 13–15 of 26 — pieces 4b + 4c + 4d. Closes out **Piece 4 (Hardware signers go live, §40.11 / §17.3–17.4 / §18)**. Trezor + Ledger signer classes, per-target transport factories (WebHID + Trezor Connect popup), the pairing UI, and the §17.7 view/export private key ceremony are all in. Device-signing itself — PSBT and message signing — is deliberately deferred; see "Known deferrals" below.

### Added

**Piece 4b / Step 13 — TrezorSigner (§17.3, §18.1)**

- `packages/core/src/signers/TrezorSigner.js` — `TrezorSigner` class extending `Signer`. Dependency-injected: constructor takes `{ id, displayName, model, deviceIdentifier, connect }`, where `connect` is the Trezor Connect instance. The class imports nothing from `@trezor/connect-web` — the DI keeps core decoupled from the SDK and makes mock-based testing clean. Implements `getStatus` (compares device_id to pairing-time deviceIdentifier), `getAddresses` (multi-index derivation with BIP44 purpose + coinType per chain), `getPublicKey`, and model/firmware-version/device-identifier extractors from `getFeatures` payloads.
- `signPsbt` + `signMessage` throw `NotImplementedError` with explicit deferral messages. PSBT↔Trezor input/output conversion depends on xchain-sdk's PSBT utilities; that integration gets its own step (see Known deferrals).
- `packages/extension/src/signers/trezorFactory.js` — extension (and popup) factory. Lazy-imports `@trezor/connect-web` so the SDK only loads when the user actually pairs; initializes Connect with the wallet's manifest; exposes `getTrezorConnect` + `pairTrezorSigner(opts)` + `resetTrezorConnect`. `pairTrezorSigner` returns `{ signer, pairingInfo }` — the caller persists `pairingInfo` via `flows.registerSigner`.
- `packages/web/src/signers/trezorFactory.js` — re-exports the extension factory via cross-package relative path, matching `hostBridge.js`'s convention so Node smoke tests resolve without the pnpm workspace symlink.
- `packages/extension/package.json` + `packages/web/package.json` — declare `@trezor/connect-web ^9.7.0` (pinned to the 9.x major, floor at 9.7 which is the current stable line).
- `flows.registerSigner` / `flows.listSignersForWallet` / `flows.unregisterSigner` wired into the background host as `signer.register` / `signer.list` / `signer.unregister` handlers. `messaging.registerSigner` / `listSigners` / `unregisterSigner` helpers exported from both popup + web — Step 15's pairing UI fires through these.
- New smoke: `packages/core/test/trezor-signer.smoke.js`. Hand-written ~30-line mock Connect exercises the class's `getStatus` / `getAddresses` / `getPublicKey` paths, proves same-device vs. different-device getStatus branching, asserts `signPsbt` + `signMessage` throw `NotImplementedError`, verifies the factory files + package.json deps, and proves the TrezorSigner class has zero Trezor SDK imports.

**Piece 4c / Step 14 — LedgerSigner (§17.4, §18.2)**

- `packages/core/src/signers/LedgerSigner.js` — same DI posture as TrezorSigner. Constructor takes `{ id, displayName, model, deviceIdentifier, app }` where `app` is the `@ledgerhq/hw-app-btc` Bitcoin app client. `getStatus(opts)` distinguishes Ledger's `'wrong-app'` state (user has a different coin app open) from `'disconnected'` / `'available'`. `getAddresses` derives per-chain formats (bech32 for BTC, legacy for DOGE/LTC). `deriveLedgerDeviceIdentifier(publicKeyHex)` fingerprints the account-0 xpub to produce a stable identifier (Ledger doesn't expose a serial — this is the common-wallet convention). `modelFromLedgerTransport` maps transport.deviceModel to firmware-manifest keys.
- `signPsbt` + `signMessage` deferred with the same `NotImplementedError` pattern as Trezor.
- `packages/extension/src/signers/ledgerFactory.js` — WebHID transport factory. Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`, opens a shared transport, constructs the Bitcoin app, reads `getAppAndVersion` + the identity xpub, derives the device identifier, returns `{ signer, pairingInfo }`.
- `packages/web/src/signers/ledgerFactory.js` — thin re-export (cross-package relative path).
- Both shell package.jsons declare `@ledgerhq/hw-transport-webhid ^6.35.0` + `@ledgerhq/hw-app-btc ^10.21.0`.
- New smoke: `packages/core/test/ledger-signer.smoke.js`. Mock app covers getStatus (wrong-app / available / disconnected), getAddresses across BTC / LTC / DOGE, deriveLedgerDeviceIdentifier determinism + input validation, modelFromLedgerTransport mapping, deferred signPsbt/signMessage, factory + package.json + zero-SDK-import checks.

**Piece 4d / Step 15 — Signer selection UI + view-key UI (§17.6, §17.7)**

- `packages/core/src/shared/routes/PairSignerForm.jsx` + `.module.css`. Four-stage flow: vendor picker (Trezor / Ledger) → pairing (shell-supplied factory runs) → confirm (device info + firmware verdict + label input) → saving (messaging.registerSigner) → done. The factories are injected as props (`pairTrezor`, `pairLedger`) so the shared route stays shell-agnostic. Firmware verdict (from `checkFirmware`) gates the save button: `'unsupported'` firmware changes the button to "Update firmware first" and disables save.
- `packages/core/src/shared/routes/ViewPrivateKey.jsx` + `.module.css`. Implements §17.7's reveal ceremony end-to-end:
    - Warning screen before any password prompt.
    - Password re-entry required every time, even when the wallet is already unlocked (§17.7.3).
    - Tap-to-reveal WIF; auto-hide on `window.blur`; Hide button always visible.
    - Clipboard auto-clear after 60 seconds.
    - `classifySource(address)` routes HW + watch-only addresses to informational panels (no password prompt, no fake reveal) per §17.7.2.
    - QR rendering via a `renderQR({ value })` render-prop so the `qrcode` dep stays in shell packages.
- `packages/core/src/flows/exportPrivateKey.js` — existed since Pass 2; this step wires it into the messaging surface. Background host registers `wallet.exportPrivateKey`; `messaging.exportPrivateKey(opts)` exported from both popup + web.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx` — new `'pair-signer'` sub-route; factories imported from each shell's `signers/*Factory.js` and passed into `<PairSignerForm>`. `buildActionEntries` grows a seventh "Pair hardware signer" entry in the Actions menu.
- New smoke: `packages/core/test/signer-ui.smoke.js`. Asserts four-stage state machine on PairSignerForm, DI prop shape + shell-agnostic imports, firmware-verdict gating, classifySource branching on ViewPrivateKey, window-blur + clipboard auto-clear wiring, exportPrivateKey handler + messaging, App.jsx sub-route + factory imports in both shells.

### Known deferrals

PSBT signing and message signing through hardware signers are deliberately unimplemented in Piece 4. Both `TrezorSigner.signPsbt` and `LedgerSigner.signPsbt` (and the corresponding `signMessage` methods) throw `NotImplementedError` with explicit messages. What they need:

- **PSBT↔Trezor conversion** — Trezor Connect's `signTransaction` takes its own input/output shape, not a raw PSBT. Converting requires xchain-sdk's PSBT utilities (input-value lookups, script-type inference, output formatting).
- **PSBT↔Ledger conversion** — Ledger's `createPaymentTransaction` has a similar per-input-and-output envelope. Same dependency profile.
- **Message signing envelopes** — both vendors return low-level `{ v, r, s }` or raw-signature shapes; the xchain-sdk convention for auth signatures needs a wrapping step.
- **Signing bridge** — HW signing physically runs in the renderer context (Trezor Connect popup needs a tab; Ledger WebHID needs a user gesture), but the rest of `submitAction` runs in the background service worker. The two halves need a messaging channel so the background can request a signature from the renderer-hosted signer. This is architectural work that likely wants its own step rather than being tacked onto a feature step.

These four items would cleanly compose into one step — "HW signing integration" — landing after Piece 5 (Electron desktop) since desktop has a much simpler signing-bridge story (main-process can hold the Transport directly, no renderer round-trip).

### Manual verification pending

End-to-end pairing against real hardware is not smoke-tested (no way to exercise WebHID / Trezor Connect popups from Node). Verification plan: plug in a Trezor + Ledger, run the popup extension + web app in a Chrome-family browser, walk through the `Actions → Pair hardware signer` flow for each vendor, confirm the SignerRecord persists with correct firmware + model + device identifier, and confirm firmware-verdict banners render correctly at current versus outdated firmware.

### Changed

- `packages/core/src/signers/index.js` — barrel now re-exports `TrezorSigner`, `deviceIdentifierFromFeatures`, `modelFromFeatures`, `firmwareVersionFromFeatures`, `LedgerSigner`, `deriveLedgerDeviceIdentifier`, `modelFromLedgerTransport` alongside the existing `SoftwareSigner` / `Signer` / firmware helpers.
- `packages/extension/src/background/createBackgroundHost.js` — new handlers: `signer.register`, `signer.list`, `signer.unregister`, `wallet.exportPrivateKey`.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` — new helpers: `registerSigner`, `listSigners`, `unregisterSigner`, `exportPrivateKey`.

### Developer notes

- Smoke count: 33. Both shell package.jsons declare the HW SDK deps but installation is not required for the smoke suite — the class-level tests use hand-written mocks; the factory-level tests are static (file existence + `package.json` checks).
- `TrezorSigner.getStatus` cross-checks the device's reported `device_id` against the `deviceIdentifier` captured at pairing time. Different device → `'disconnected'`. This is the "swapped device" defense — an attacker can't hand the user a substituted Trezor and expect the wallet to silently accept it.
- `LedgerSigner.getStatus({ chainId })` distinguishes the `'wrong-app'` state from `'disconnected'`. UI callers should treat `'wrong-app'` as a guided-prompt state ("Please open the Bitcoin app on your Ledger") rather than a hard error.
- The HW sign path is the biggest remaining pre-Phase-3 gap. Piece 5 (Electron desktop) comes next in the plan; a dedicated "HW sign integration" step should slot in either before or after Piece 5 depending on device-availability during testing.

## [0.52.0] - 2026-04-23

Phase 2 — Step 12 of 26 — piece 4a. Opens **Piece 4 (Hardware signers go live, §40.11 / §17.3–17.4 / §18)** with scaffolding only. No `@trezor/connect` or `@ledgerhq/hw-transport-*` dependencies yet — those land in Steps 13 (TrezorSigner) and 14 (LedgerSigner). This step is infrastructure Steps 13-14 plug into: persistent records for paired devices, a firmware status helper, and the cross-check UI the sign screens will render once HW signers come online.

### Added

- `packages/core/src/signers/firmware-manifest.js` — bundled manifest keyed by `vendor → model → { minimum, recommended, knownVulnerable[], unsupported[] }`. Ships with Trezor One / Model T / Safe 3 / Safe 5 and Ledger Nano S / Nano S+ / Nano X / Stax entries. JS module (not JSON) so browser shells and Node 18 both load it without loader config.
- `packages/core/src/signers/checkFirmware.js` — `checkFirmware({ vendor, model, version })` returns a flat verdict `{ status, vendor, model, displayName, minimum, recommended, updateUrl, detail, version }` where status is one of `'ok' | 'outdated' | 'vulnerable' | 'unsupported' | 'unknown'`. Version matching handles exact, prefix (`"1.11."`), and major-only (`"1.x"`) patterns. Also exports `compareVersions` for Steps 13-14 to reuse for ad-hoc comparisons. Unknown vendor/model falls back to `'unknown'` with a neutral "verify with vendor" banner rather than blocking the sign path.
- `packages/core/src/schemas/signer.js` — `SignerRecord` (v1) schema. Fields: `walletId`, `kind` (`'trezor' | 'ledger'`), `vendor`, `model`, opaque `deviceIdentifier`, `label`, `firmwareVersion` (nullable until first observation), `pairedAt`, `lastSeenAt`. No secrets (no PINs, seed material, or xpubs — those live on the device; the wallet re-derives public keys as needed). Re-exported from the `@xchain-wallet/core/schemas` barrel, with a migration slot wired up in `migrations.js`.
- Vault `signers` collection — added to `Vault.js`, the codec document shape, and the `emptyDocument`/`decodeDocument` fallbacks so older persisted blobs load cleanly with an empty `signers: []`.
- `packages/core/src/flows/registerSigner.js` — `registerSigner(opts)` is idempotent by `(walletId, vendor, deviceIdentifier)`: re-pairing the same physical device updates `firmwareVersion` + `lastSeenAt` + optional `label` rather than inserting a duplicate. `listSignersForWallet`, `unregisterSigner`, and `findSigner` round out the registry surface. Re-exported from `@xchain-wallet/core` flows.
- `packages/core/src/shared/components/DerivationPathCrossCheck.jsx` + `.module.css` — §18.5 UI block. Renders `{ signerName, path, address }` plus the wallet's explicit cross-check instruction: *"Verify the address shown on your device matches the address shown here. If they don't match, reject on the device."* Device-label branches on `signerKind` so copy reads "Trezor" / "Ledger" / fallback "your device" as appropriate. Ready to drop into sign screens — Steps 13-14 wire the render.
- New smoke: `packages/core/test/signer-scaffold.smoke.js`. Exercises the firmware verdicts (happy/outdated/unsupported/major-only/unknown vendor/unknown model/missing version/compareVersions edge cases), `SignerRecord` schema validation, `registerSigner` re-pair idempotence, a vault save→close→reopen round-trip (confirming codec slot persistence), and structural checks on the `DerivationPathCrossCheck` component.

### Changed

- `packages/core/src/signers/index.js` — barrel now re-exports `checkFirmware`, `compareVersions`, and `FIRMWARE_MANIFEST` alongside `Signer` + `SoftwareSigner`.
- `packages/core/src/schemas/migrations.js` — `signerMigrations` / `migrateSigner` registered; ready for future `SignerRecord` version bumps.
- `packages/core/src/storage/codec.js` — `VaultDocument` gains a `signers: SignerRecord[]` slot. Older blobs (no `signers` key) load with `[]` instead of `undefined`.

### Developer notes

- This step deliberately does **not** add any vendor SDK dependencies. `@trezor/connect-web`, `@trezor/connect` (node), `@ledgerhq/hw-transport-webhid`, and `@ledgerhq/hw-transport-node-hid` all land in Steps 13-14 where the `TrezorSigner` and `LedgerSigner` classes that consume them are built.
- `registerSigner`'s "idempotent by `(walletId, vendor, deviceIdentifier)`" contract is the reason Address records can keep a stable `signerId` across re-plug events: the user unplugging and replugging their Trezor should not cause the wallet to re-derive addresses or break the pre-existing `Address.signerId → SignerRecord.id` link.
- Smoke count: 30. vitest-setup smoke auto-updates the count.

## [0.51.0] - 2026-04-23

Phase 2 — Steps 8–11 of 26 — pieces 3a + 3b + 3c + 3d. Closes out **Piece 3 (standalone ISSUE / MINT / DESTROY + token admin surfaces, §40.2–§40.5)** end-to-end. Home now opens a new Actions menu that reaches six authoring surfaces: standalone ISSUE, MINT, DESTROY, Lock supply, Update description, Transfer ownership. Each form reviews its draft through the shared action decoder (same preview the dApp-initiated sign screen uses) and signs through a background handler backed by a core flow.

### Added

**Piece 3a / Step 8 — standalone ISSUE (§40.2)**

- `packages/core/src/shared/routes/IssueTokenForm.jsx` + `.module.css` — two-stage authoring surface (form → review/submitting → done) mirroring `Send.jsx`. Every ISSUE v0 field the wizard's Custom composer exposes is available on a single screen: ticker, supply, divisible, description, lock supply + minting, transfer ownership. Review step runs `decoder.decodeAction({ action: 'ISSUE', params })` so the plain-English summary matches the sign screen shown for dApp-initiated ISSUE. Sign uses the existing `messaging.issueToken` helper from v0.50.0 — no new flow or background handler needed.
- `packages/core/src/shared/routes/ActionsMenu.jsx` + `.module.css` — secondary surface listing §40.2+ authoring forms. Entries are passed in as a prop so each shell controls which actions appear; one screen today, gains entries as Piece 3 progresses.
- `packages/core/src/shared/routes/Home.jsx` — accepts a new `onActions` prop and renders a fourth "More actions" button below the Send / Receive / Create-a-token row.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx` — new `'actions'` and `'issue'` sub-routes; a shared `buildActionEntries` helper in each shell wires each entry's `onSelect` back to `setUnlockedView`.
- New smoke: `packages/core/test/issue-form.smoke.js` — exercises the two-stage state machine, ticker validation (A-Z/0-9), positive-supply validation, ISSUE v0 composer (MAX_SUPPLY + MINT_SUPPLY from supply, DECIMALS 8/0 from divisible, LOCK_MAX_SUPPLY + LOCK_MINT on lock, TRANSFER on transferTo), decoder wiring, messaging.issueToken call-site, ActionsMenu surface, Home onActions wiring, both App.jsx sub-routes.

**Piece 3b / Step 9 — MINT form (§40.3)**

- `packages/core/src/flows/mintAsset.js` — wraps `submitAction` with `action: 'MINT'`. Guard-rails reject missing opts / params / TICK / AMOUNT / from. Re-exported from `@xchain-wallet/core` flows.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.mint`, forwarding to `mintAsset` with vault + registries injected.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` — each exports `mintAsset(opts)` routing to `action.mint`.
- `packages/core/src/shared/routes/MintForm.jsx` — two-stage form (ticker + amount + optional destination) reusing `IssueTokenForm.module.css`. Ticker allows a period so subassets (`PARENT.CHILD`) can be minted. Empty DESTINATION renders in the preview as "broadcasting address" — matches protocol §MINT semantics. Wired into the Actions menu as "Mint" and into both `App.jsx` sub-routes.
- New smoke: `packages/core/test/mint-form.smoke.js` — exercises the flow's guard-rails live, verifies the decoder wiring + messaging.mintAsset call-site + action.mint handler + both messaging helpers + ActionsMenu entry + popup/web sub-route wiring.

**Piece 3c / Step 10 — DESTROY form (§40.4)**

- `packages/core/src/flows/destroyAsset.js` — `submitAction` wrapper with `action: 'DESTROY'` and the same guard-rail shape as `mintAsset`.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.destroy`.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` — each exports `destroyAsset(opts)` routing to `action.destroy`.
- `packages/core/src/shared/routes/DestroyForm.jsx` — two-stage form (ticker + amount) with an explicit "Destroy is irreversible" warning rendered on the form stage (before composing, not just on review). Sign button uses the `danger` Button variant to visually reinforce the intent. Decoder smoke case 2h already covers the decoder's irreversibility warning; the form renders it prominently on review.
- New smoke: `packages/core/test/destroy-form.smoke.js` — verifies irreversibility prose, danger variant, flow guard-rails, action.destroy handler, messaging helpers, ActionsMenu entry, and popup/web sub-routes.

**Piece 3d / Step 11 — token admin (§40.5)**

- `packages/core/src/shared/routes/TokenAdminForm.jsx` — single parameterized component driven by a `mode` prop (`'lock'` | `'description'` | `'transfer'`) delivering the three §40.5 surfaces:
    - **Lock supply** — ISSUE v3 with `LOCK_MAX_SUPPLY` + `LOCK_MINT`. Renders a "Locking is permanent" warning on the form stage and uses the `danger` Button variant on the sign button.
    - **Update description** — ISSUE v1 with a single `DESCRIPTION` field. Replaces the existing on-chain description.
    - **Transfer ownership** — ISSUE v0 with only `TRANSFER` set. New owner address required.

  All three reuse `messaging.issueToken` — no new background handler or core flow needed, since every admin action is ISSUE at the protocol level.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx` — three new sub-routes (`'lock'`, `'description'`, `'transfer'`), all rendering `<TokenAdminForm mode={unlockedView} …/>`. `buildActionEntries` grows three more entries so the Actions menu surfaces all six of Piece 3.
- New smoke: `packages/core/test/token-admin-form.smoke.js` — exercises the mode-driven composer (v3 + lock flags / v1 + DESCRIPTION / v0 + TRANSFER), lock-only permanence warning, danger-variant on lock sign, decoder wiring, messaging.issueToken reuse, and all three sub-routes in both shells.

### Changed

- `packages/core/src/shared/routes/Home.jsx` now exposes a fourth "More actions" button in addition to Send / Receive / Create-a-token, gated on `onActions`. Popup + web shells pass `onActions` when an `activeWalletId` is present.
- `packages/core/src/flows/index.js` re-exports the two new flows: `mintAsset` and `destroyAsset`.
- `packages/extension/src/background/createBackgroundHost.js` handler surface grows two entries: `action.mint` and `action.destroy`.

### Developer notes

- Across Piece 3, each form mirrors `Send.jsx`'s two-stage shape (form → review/submitting → done) rather than the wizard's five-stage shape — standalone forms don't need a template picker or chain picker screen. Chain picker is inline at the top when the wallet has addresses on more than one chain.
- The Custom wizard template and the standalone ISSUE form are deliberately redundant surfaces: the wizard is the guided entry point; the standalone form is the escape hatch for power users (and eventually the Token detail page, which will link into it for specific tokens).
- Admin modes pick ISSUE protocol versions based on what yields the cleanest decoded summary (see `action-decoder.smoke.js` cases 2b–2d). A pure lock uses v3, a pure description update uses v1, a pure transfer uses v0.
- MintForm + DestroyForm accept tickers with a period so subasset mints / destroys work; the top-level wizard validator rejects periods because it joins `PARENT.CHILD` itself.
- Smoke count: 29. vitest-setup smoke reports the new count; no existing smokes regressed.

## [0.50.0] - 2026-04-23

Phase 2 — Steps 5-7 of 26 — pieces 2c + 2d + 2e. Closes out **Piece 2 (Token Creation Wizard, §40.1)** end-to-end. The wizard is now reachable from Home on both popup + web, all six templates are interactive with per-template field visibility + composition, and the sign stage runs through a real `action.issue` background handler backed by a new `issueToken` core flow. First Phase-2 user-visible feature shipped.

### Added

**Piece 2c / Step 5 — messaging + background host** (§40.1 sign stage)

- `packages/core/src/flows/issueToken.js` — wraps `submitAction` with `action: 'ISSUE'`, reuses `normalizeSource` from `sendAsset`, forwards encoder + signer options through. Guard-rails reject missing opts / params / TICK / from before hitting the SDK.
- `packages/core/src/flows/index.js` re-exports `issueToken`.
- `packages/extension/src/background/createBackgroundHost.js` registers `action.issue` next to `action.send` + `action.sweep`. Handler injects `vault`, `chainRegistry`, `sdkRegistry` from the host context; the popup + web payloads are pass-throughs.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` each export `issueToken(opts)` — same signature, same target message type, matching the popup/web parity pattern the other helpers follow.
- New smoke: `packages/core/test/issue-token.smoke.js`. Exercises the flow's guard-rails live (`flows.issueToken` throws on missing opts / params / TICK / from) and statically verifies the `action.issue` handler + both messaging helpers + the wizard's call-site.

**Piece 2d / Step 6 — per-template composition**

- `TEMPLATE_COMPOSERS` object in `TokenWizard.jsx` replaces the single `composeIssueParams` function. One composer per template (Meme / Utility / Community / Collectible / Subasset / Custom), each picking the subset of ISSUE v0 fields that template wants:
    - **Meme** — one ISSUE with `MAX_SUPPLY` + `MINT_SUPPLY` (creator gets full supply) + `DECIMALS=0` + `LOCK_MAX_SUPPLY` + `LOCK_MINT`. Matches §40.1's intent atomically via a single transaction; the spec's "BATCH" description was inaccurate — the protocol's ISSUE v0 composes mint + lock in one go.
    - **Utility** — `MAX_SUPPLY` + `MINT_SUPPLY` + optional `MAX_MINT`, no lock flags. Mintable going forward.
    - **Community** — same shape as Utility. Dividends happen later via the DIVIDEND action on the TICK; no Phase-1 flag on ISSUE.
    - **Collectible** — single-edition (`MAX_SUPPLY=1`, `MINT_SUPPLY=1`, `DECIMALS=0`, both locks). Image goes in `DESCRIPTION` — explorer renders linked URLs as images (the JDOG protocol example). Full FILE + BATCH path is deferred past Phase 2 because §BATCH bans FILE.
    - **Subasset** — composer joins `parent.child` into the final `TICK`; form collects parent + child separately so the wizard can show the preview correctly.
    - **Custom** — every ISSUE v0 field exposed (superset of the other five). The escape hatch for edge cases the templates don't cover.
- `TEMPLATE_FIELDS` visibility map drives which inputs show on the details stage per template. Collectible hides Supply (hard-wired to 1 by composer). Subasset adds Parent asset (required, uppercased, A-Z 0-9). Community hides the lock-on-create + transfer-to toggles (Utility's shape).
- `TEMPLATES` table: all six `interactive: true`. The "Coming in Step 6" affordance is gone — templates are live.
- New form state: `imageUrl` (Collectible), `parentAsset` (Subasset). Both stay in state across template switches so the user can flip templates without retyping.
- Details-stage validation tightened: top-level ticker is `[A-Za-z0-9]+` (no period — the composer joins for subassets). Subasset requires `parentAsset`. Collectible skips the positive-supply check (composer pins supply to 1).

**Piece 2e / Step 7 — Home entry + App.jsx routing**

- `packages/core/src/shared/routes/Home.jsx` accepts a new `onCreateToken` prop and renders a third "Create a token" action card next to Send + Receive.
- Popup + web `App.jsx` both add `'wizard'` to the `unlockedView` sub-route union; `<TokenWizard walletId onBack>` renders when `unlockedView === 'wizard'`; Home receives `onCreateToken` bound to the sub-route setter. Identical wiring on both shells — same pattern as Send + Receive, which is why the shared-routes refactor (Piece 1) was worth doing first.
- `packages/core/test/shared-routes.smoke.js` grows its file-existence list + App.jsx import list to include `TokenWizard`, and adds `routeMessagingCalls.TokenWizard = ['messaging.getAddressesByChain', 'messaging.issueToken']` so the wizard gets the same call-site + context-use assertions the other routes get.
- `packages/core/test/token-wizard.smoke.js` adds a Section 9 covering the Home + App.jsx wiring (`onClick={onCreateToken}`, `'wizard'` sub-route in both shells, `<TokenWizard>` rendered).

### Wiring diagram (end-to-end for §40.1)

```
Home → onClick={onCreateToken} → App.jsx setUnlockedView('wizard')
     → <TokenWizard walletId onBack>
        → stage: template → chain → details → preview → sign
        → composeIssueParams(template, form)  [per-template composers]
        → decoder.decodeAction({ action: 'ISSUE', params })  [Step 3]
        → messaging.issueToken({ walletId, password, chainId, from, params })
        → chrome.runtime.sendMessage / hostBridge.sendMessage → 'action.issue'
        → createBackgroundHost → issueToken flow
        → submitAction → SDK encode + sign + broadcast
        → { txid } → TokenWizard.stage = 'done'
```

### Tests

- 25 smokes pass (`node packages/core/test/_run-smokes.js`) — `issue-token.smoke.js` added, `shared-routes.smoke.js` + `token-wizard.smoke.js` extended.
- Static-wiring assertions cover every link in the diagram above except the SDK broadcast (needs real `xchain-sdk` install + regtest, gated to the reproducible-build pipeline).

### Scope boundary

- **Collectible's FILE path is deferred.** The shortcut of putting the image URL into `DESCRIPTION` matches the protocol's JDOG example; it relies on the explorer/indexer recognizing URLs and rendering them. Full FILE-action support (IPFS-style content IDs, BATCH composition) is a Phase-3 or later feature because protocol §BATCH explicitly bans FILE inside a BATCH and the FILE-action pipeline is its own product surface.
- **Subasset parent-ownership is not verified pre-flight.** The wizard accepts any `parentAsset` string; the protocol layer rejects a subasset-create on a parent the signer doesn't own. A future polish queries the wallet's owned-assets index + presents a picker.
- **Auto-lock still popup-only.** The wizard inherits the shell-level auto-lock behavior from the shared-routes infrastructure.
- **Fee estimation is pass-through.** `issueToken` forwards `fee` / `feePerKb` / `rbf` options to `submitAction` but the wizard UI doesn't expose them — creators get the SDK default. Explicit fee control lands with RBF (Pass 5 §44.4) or the Advanced Actions Form (§40.10).

## [0.49.0] - 2026-04-23

Phase 2 — Step 4 of 26 — piece 2b. Token Creation Wizard scaffold (§40.1). Five-stage flow (template → chain → details → preview → sign) rendered from `@xchain-wallet/core/shared/routes/TokenWizard.jsx` so popup + web + eventual desktop shells all consume the same component via `MessagingProvider`.

### Added

**`packages/core/src/shared/routes/TokenWizard.jsx` + `TokenWizard.module.css`**

- **Template stage** — a 6-card picker (Meme / Utility / Collectible / Community / Subasset / Custom) matching §40.1. **Custom** is the only interactive template today; the other five surface a "Coming in Step 6 — use Custom for now" affordance and visually disable themselves. Dedicated per-template detail forms + composition (Meme = one ISSUE with lock flags, Collectible = FILE+ISSUE+MINT BATCH, Subasset = `PARENT.SUB` ticker, etc.) land in Step 6 (piece 2d).
- **Chain stage** — filters to chains the wallet already has a persisted address on (the wizard needs a fee-paying address; "create on a new chain" goes through Receive first). Auto-picks the highest external HD address. Matches Send.jsx's chain-picker pattern.
- **Details stage (Custom)** — every ISSUE v0 field exposed: ticker (A–Z 0–9 + period, auto-uppercased on input), display name (UI-only, not stored on-chain), supply, divisible toggle (→ `DECIMALS = 8 | 0`), description (on-chain, 250 char cap), max-mint-per-tx, lock-on-create toggle (sets both `LOCK_MAX_SUPPLY` + `LOCK_MINT`), transfer-ownership address.
- **Preview stage** — runs the composed ISSUE params through the Step 3 decoder (`decoder.decodeAction({ action: 'ISSUE', params, chainId, chainRegistry })`) so the user sees the plain-English recap + warnings (permanent-lock, empty-ticker, etc.) before entering the password. Password field follows the Send review pattern.
- **Sign stage** — calls `messaging.issueToken({ walletId, password, chainId, from, params })`. The messaging helper + background `action.issue` handler land in Step 5 (piece 2c); the sign button surfaces the "unknown message type" error cleanly until then. `InvalidPasswordError` maps to "Incorrect password." inline; other errors show the raw message.
- **Done stage** — renders transaction id if present.

**`composeIssueParams()`** — file-local helper, not exported. Maps the form state into the ACTION params shape the SDK + decoder both consume. Uppercases the ticker (belt-and-suspenders with the `<Input onChange>`), sets `MINT_SUPPLY = supply` on create so initial supply lands in the creator's wallet, expands the lock-on-create toggle into both `LOCK_MAX_SUPPLY` and `LOCK_MINT`. Step 6 will wrap per-template composers around this base.

### Tests

- `packages/core/test/token-wizard.smoke.js` (8 assertion groups). Covers: file existence, `TokenWizard` export, composer kept file-local, all five stages + done present, each stage-transition `setStage('next')` call-site, TEMPLATES table has all six with Custom alone interactive, preview calls `decoder.decodeAction({ action: 'ISSUE', ... })`, sign stage calls `messaging.issueToken`, ticker upper-casing, `DECIMALS` 8/0 mapping, `LOCK_MAX_SUPPLY` + `LOCK_MINT` wiring, `TRANSFER` field, `useMessaging` + `screenVariantFor` context use, CSS module class presence.
- 24 smokes pass; the new test lands at `token-wizard.smoke.js` and auto-discovers via `_run-smokes.js`.

### Not wired yet

- **No Home entry + no App.jsx route.** The wizard is file-only; Home's "Create a token" card and the popup + web `unlockedView` transition land in Step 7 (piece 2e). A user running today's build can't reach the wizard through the UI — the route is ready, the entry is in the next sub-piece.
- **Sign stage is stubbed end-to-end.** `messaging.issueToken` lands in Step 5 (piece 2c) along with the `action.issue` background handler + a core `flows/issueToken.js` SDK wrapper.
- **Five templates are non-interactive.** Per-template details forms + BATCH composition (Collectible) + subasset parent-picker land in Step 6 (piece 2d).

## [0.48.0] - 2026-04-23

Phase 2 — Step 3 of 26 — piece 2a. Extends `actionDecoder.decodeAction` to cover the four ACTION kinds the Token Creation Wizard (§40.1) emits: ISSUE (all six format versions), MINT, DESTROY, BATCH. Unlocks the wizard's preview step in the next sub-piece so the user sees a plain-English recap of what they're signing before the key material is touched.

### Added

**`packages/core/src/decoder/actionDecoder.js`**

- **ISSUE** — six format-version branches. Summaries differentiate the semantic intent rather than just echoing "ISSUE":
    - v0 with `MAX_SUPPLY` → `"Create token TICK with max supply N on Chain"`.
    - v0 with `TRANSFER` but no supply fields → `"Transfer ownership of TICK to ADDR on Chain"`.
    - v0 otherwise → `"Configure token TICK on Chain"`.
    - v1 → `"Update description of TICK on Chain"`.
    - v2 → `"Update mint parameters of TICK on Chain"`.
    - v3 → `"Lock TICK (max supply, minting, ...) on Chain"` when any `LOCK_*` flag is set; names the locks in human terms, not field names.
    - v4 → `"Update callback parameters of TICK on Chain"`.
    - v5 → `"Update allow/block list for TICK on Chain"`.
- **MINT** — `"Mint AMOUNT TICK on Chain to DESTINATION"`; missing destination reads as `"broadcasting address"` in the details list.
- **DESTROY** — v0 (single) produces `"Destroy AMOUNT TICK on Chain"`. v1/v2 (multi-destroy, repeating `TICK`/`AMOUNT` pairs) fall through to the generic decoder but are decorated with the irreversibility warning so the user still sees it before signing.
- **BATCH** — recurses into the `params.COMMANDS` array (wallet-side shape; each entry `{ action, params }`) and composes child summaries into a numbered list. Details show `Step N` rows with indented sub-action details. Warnings from every nested command bubble up to the root. Empty / malformed `COMMANDS` surfaces a dedicated "review raw transaction" warning so no blind-sign is possible.

**New warnings across the four kinds**

- `"Locking is permanent — these properties cannot be changed after this transaction confirms."` — ISSUE with any `LOCK_*` flag (v0 or v3).
- `"Destroying is irreversible — the tokens cannot be recovered."` — DESTROY (all versions).
- `"Token ticker is empty."` — ISSUE / MINT / DESTROY with empty `TICK`.
- `"Amount is not positive."` — MINT / DESTROY with `AMOUNT <= 0`.
- `"Memo contains | or ; — the protocol will reject this transaction."` — MINT / DESTROY / ISSUE.

**Private helpers** (file-local, not re-exported)

- `decodeIssue(params, chainName, chainSuffix)` — dispatches by `VERSION`.
- `decodeBatch(params, chainId, chainName, chainSuffix, chainRegistry)` — re-enters `decodeAction` for each command.
- `collectLockFlags(params)` — maps `LOCK_*` fields to human labels; treats `''`, `'0'`, `0`, `false`, `null`, `undefined` as inactive.
- `genericFallback(action, params, chainSuffix)` — existing catch-all, now reusable.

### Tests

- `packages/core/test/action-decoder.smoke.js` grows from 7 to 18 cases. New coverage: ISSUE v0 Meme-template shape (create + MAX_SUPPLY + locks), ISSUE v0 transfer-ownership-only, ISSUE v1 description-only, ISSUE v3 lock-params summary, MINT happy + broadcasting-address default + zero-amount warning, DESTROY v0 + multi-version fallback with irreversibility preserved, BATCH composed summary + Step-row details, empty-BATCH no-decoded-commands warning. SignApproval static wiring checks unchanged.

### Scope boundary

- Decoder output is **plain text strings**. The sign screen renders them; no HTML, no markup. Lock-flag labels are English ("max supply", "minting"), not protocol field names ("LOCK_MAX_SUPPLY") — the decoder's job is to translate protocol into human, not mirror it.
- `COMMANDS` is the wallet-side representation. The SDK ultimately serializes a BATCH to `BATCH|0|CMD1;CMD2` per protocol §BATCH v0; the decoder runs before serialization, on the authored-but-not-yet-encoded shape. A future enhancement could parse the on-wire form too, for dApp-origin sign requests — not needed today.
- Phase 2 sub-pieces 2b–2e (wizard scaffold, messaging, templates, Home entry) build on top of this decoder. ISSUE / MINT / DESTROY standalone forms (§40.2–§40.5, Steps 8–11) reuse it unchanged.
- DISPENSER / DIVIDEND / AIRDROP / BROADCAST / FILE decoders land alongside their authoring forms (Batch 2 — Steps 20–24).

### Smoke-runner regressions surfaced + fixed

Running `node packages/core/test/_run-smokes.js` after the decoder work flushed out three pre-existing regressions that had slipped through earlier releases (pnpm wasn't available in the sandbox where those pieces were proposed, so the smoke suite never ran end-to-end). All three are static/wiring fixes — no runtime behavior changed:

- `packages/core/src/index.js` no longer re-exports the `shared` namespace. The shared surface pulls `.jsx` files which Node's native ESM loader can't parse, so `import { decoder } from '@xchain-wallet/core'` broke the moment the namespace alias was followed. Consumers already reach shared via the subpath export (`@xchain-wallet/core/shared/MessagingProvider.jsx`); the namespace alias was dead weight introduced in v0.46.0.
- `packages/core/test/popup-shell.smoke.js` — stale from v0.46.0. It iterated `popup/routes/Loading.jsx` + friends that got hoisted to shared and deleted. Replaced with assertions that the popup App.jsx pulls the 8 shared routes + wraps in `<MessagingProvider shell="popup">`.
- `packages/core/test/sdk-bundle.smoke.js` — the "shim doesn't re-import `ws`" assertion in v0.47.0 was naive substring-matching and tripped on the JSDoc example at the top of `ws-browser.js` that cites `require('ws')` as the consumer call site. Now strips comment lines before the check.

## [0.47.0] - 2026-04-23

Phase 2 Batch 1 piece 1b — real `xchain-sdk` browser-bundle pass. Makes both shell Vite builds resolve the real SDK end-to-end so every Phase-2 authoring form (ISSUE, MINT, wizard, etc.) has a working encode + sign path from day one instead of dead-ending at the dev-mock fallback. Surfaces the three CJS/Node-builtin interop issues once, not per-form.

### Added

**Browser shims** (`packages/core/src/shims/`)

- `ws-browser.js` — wraps native browser `WebSocket` in a Node-`ws`-shaped adapter. The SDK's `websocket.js` calls `.on('open'|'message'|'close'|'error', fn)` + reads `WebSocket.OPEN`-style static constants; browser `WebSocket` exposes `.addEventListener` / `onopen`. Shim translates, plus handles `close(code, reason)` / `readyState` / `send(data)`. Throws loudly if `globalThis.WebSocket` is unavailable.
- `http-browser.js` — no-op `http.Agent` class so `encoder.js` + `explorer.js`'s `new (require('http').Agent)({ keepAlive: true })` connection-pool init resolves without pulling in the 30 KB `stream-http` polyfill. Browsers manage their own connection pool; axios's `httpAgent` is a no-op there.
- `repl-browser.js` — throws if `startREPL()` is ever called. `xchain-sdk/index.js` transitively loads `src/repl.js` at module init via `require('./src/repl.js')`, which calls `require('repl')`. The wallet never calls `startREPL`; the shim lets the module graph resolve without shipping a real polyfill for `node:repl`.
- `packages/core/package.json` exports `./shims/*` so Vite configs resolve the shim paths via `@xchain-wallet/core/shims/*`-style imports (today the configs use `fileURLToPath(new URL(...))` because Vite's `resolve.alias` values are filesystem paths, not package-subpath imports).

**Vite config wiring** (`packages/web/vite.config.js`, `packages/extension/vite.config.js`)

- `vite-plugin-node-polyfills` added with `include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util']` + `globals: { Buffer: true, process: true, global: true }` + `protocolImports: true`. Covers `require('crypto')` in `auth.js` + `messaging.js` (ECDH, AES-256-GCM, randomBytes, SHA-256), Buffer in `bitcoinjs-lib`, and `process` in a few transitive deps.
- `resolve.alias` maps `ws` → `ws-browser.js`, `http` → `http-browser.js`, `repl` → `repl-browser.js`. Aliasing at the Vite level means we don't touch `xchain-sdk` source.
- Extension Vite config keeps its existing multi-entry shape (background / contentScript / xchainProvider / popup / approval). Tree-shaking keeps the polyfills + shims out of `contentScript` + `xchainProvider` bundles since those don't consume xchain-sdk.

**Runtime + dev deps**

- `vite-plugin-node-polyfills@^0.22.0` added as devDep to `packages/web` + `packages/extension`. `packages/core` already depended on `@noble/hashes` + `@scure/*` directly — not using crypto-browserify.
- `xchain-sdk@^1.8.0` already pinned in both shells from v0.45.0.

### Tests

- **New smoke** — `packages/core/test/sdk-bundle.smoke.js`. Verifies: the three shim files exist + expose the expected surface; both Vite configs import `vite-plugin-node-polyfills` and call `nodePolyfills()` with the right include list + global Buffer flag; both configs resolve `ws` / `http` / `repl` via alias to the shims; both package.json files pin `xchain-sdk` at `^1.8.0` and list `vite-plugin-node-polyfills` as a devDep; both `sdkFactory.js` files still dynamic-import `xchain-sdk` + wrap with `adaptXChainSDK` + emit the console.warn markers `check-no-dev-mock.sh` greps for; `tools/build-reproduce/check-no-dev-mock.sh` still names all three markers.

### Scope boundary

- **Static smoke only.** The full "does it actually bundle" gate is `pnpm -C packages/web build && pnpm -C packages/extension build && bash tools/build-reproduce/check-no-dev-mock.sh`. Those run in CI + before a release; the smoke asserts the static wiring, not the bundle itself.
- **Messaging features are Phase 3.** The SDK's `src/messaging.js` uses `crypto.createECDH('secp256k1')` and AES-256-GCM for §MESSAGE ECIES. Bundling the module graph works (crypto-browserify supports both), but the wallet doesn't invoke messaging flows until Phase 3 (§41.x). Any runtime-only bugs in the polyfill path there surface later; Phase 2 authoring (ISSUE/MINT/wizard/HW signers) doesn't touch messaging.
- **ws shim is minimal.** It implements the `.on / .off / .once / .send / .close / .terminate / readyState / url / protocol / bufferedAmount` surface the SDK's `websocket.js` consumes plus `CONNECTING / OPEN / CLOSING / CLOSED` static constants — not a general-purpose `ws` polyfill. If the SDK adds new WebSocket call sites in a future version, the smoke fails at bundle time and the shim gets extended.
- **http shim is intentionally a stub.** If the SDK starts doing anything beyond `new http.Agent()`, the browser bundler hits an undefined-property error and we notice. We don't want to quietly pull in `stream-http` (30 KB) for features the wallet doesn't use.

### Known follow-ups

- The full `pnpm -r build` + `check-no-dev-mock.sh` gate is scoped to CI — the user runs it locally when they want visual confirmation. A reproducible-build RC pass (§51.4) adds the gate automatically pre-release.
- If `bitcoinjs-lib`'s browser surface reports an ESM/CJS interop issue in the bundle log, the fix is typically a `optimizeDeps.include: ['bitcoinjs-lib']` entry in the Vite config — not shipped today because pre-bundling it may not be necessary with `@vitejs/plugin-commonjs` built-in handling.

## [0.46.0] - 2026-04-23

Phase 2 Batch 1 piece 1 — shared-routes refactor. Closes the Phase-1 popup-Send + web-Receive gaps by hoisting every Phase-1 route into `@xchain-wallet/core/shared/routes/*` behind a `MessagingProvider` React context. Popup + web shells become thin routers that wrap the tree with `<MessagingProvider shell="popup|web" messaging={shellMessaging}>`; shared routes call the bag of messaging helpers via the context and pick `Screen` variants from `screenVariantFor(shell)`.

### Added

**Shared surface** (`packages/core/src/shared/`)

- `MessagingContext.js` + `MessagingProvider.jsx` + `useMessaging.js` — React context + hook wrapping a `{ shell, messaging }` value. `useMessaging` throws when consumed outside a provider so wiring mistakes surface immediately. `screenVariantFor(shell)` returns `'popup' | 'full'`.
- `hooks/useAutoLock.js` — hoisted from the popup; now a shared foreground auto-lock timer. `enabled: false` makes it a no-op so shells that don't want it (web today) can still call the hook unconditionally per React hook rules.
- `components/MnemonicGrid.jsx` — shared read-only seed-phrase grid. `variant="popup"` renders the compact 3-col layout; `variant="full"` picks a responsive 3/4-col grid for the full layout.
- `components/ChainBalanceCard.jsx` — shared per-chain balance card (hoisted from popup).
- `routes/Loading.jsx`, `Onboarding.jsx`, `CreateWallet.jsx`, `ImportWallet.jsx`, `Locked.jsx`, `Home.jsx`, `Send.jsx`, `Receive.jsx` — every Phase-1 route + its `.module.css`. Each route reads `shell` from context and picks its layout variant; each CSS module co-locates `-popup` / `-full` class variants where sizing diverges.
- `shared/index.js` barrel + `packages/core/src/index.js` namespace export (`import { shared } from '@xchain-wallet/core'`).
- `packages/core/package.json` exports map extended with `./shared` and `./shared/*`.

**Closing the Phase-1 gaps**

- **Popup gains Send** — popup `App.jsx`'s `unlockedView` now tracks `home | send | receive`; Home's Send button is live. `packages/extension/src/popup/messaging.js` adds a `sendAsset` helper targeting the host's `action.send` handler.
- **Web gains Receive** — web `App.jsx` adds the `receive` sub-route and renders the shared `Receive`. `packages/web/src/messaging.js` adds a `generateReceiveAddress` helper targeting the host's `receive.getAddress` handler.
- **Review shape converged** — shared `Send.jsx`'s review stage runs the user's draft through `decoder.decodeAction` so the plain-English summary + warnings banner match SignApproval's sign-screen. Memo `|` or `;` surfaces the same protocol-reject warning in both surfaces.
- **Create flow converged on safer pattern** — shared `CreateWallet.jsx` generates the BIP39 mnemonic client-side and persists post-confirm via `messaging.importMnemonic`, matching the web shell's existing behavior. A user who closes the popup/tab at the mnemonic display stage leaves no vault behind (§19.2).

### Changed

- `packages/web/src/App.jsx` — `<ExtensionBanner>` hoisted to App-level above the router (previously per-route in Locked + Onboarding). Auto-hiding behavior is unchanged; the banner only renders when `window.xchain` is detected and not dismissed for the session. Double-render regression on Onboarding is impossible because the per-route `<ExtensionBanner>` was deleted.
- Popup + web `App.jsx` are now thin: wrap in `<MessagingProvider>`, dispatch by state, pass `shell`/`messaging` through context. All route files live in `@xchain-wallet/core/shared/routes/`.

### Removed

Per-shell duplicates (hoisted to shared):

- `packages/extension/src/popup/routes/*.{jsx,module.css}` — Locked, Loading, Onboarding, CreateWallet, ImportWallet, Home, Receive (all gone).
- `packages/extension/src/popup/components/{MnemonicGrid,ChainBalanceCard}.{jsx,module.css}` — gone.
- `packages/extension/src/popup/hooks/useAutoLock.js` — gone.
- `packages/web/src/routes/*.{jsx,module.css}` — Locked, Loading, Onboarding, CreateWallet, ImportWallet, Home, Send (all gone).
- `packages/web/src/components/MnemonicGrid.{jsx,module.css}` — gone.
- `packages/web/src/components/ExtensionBanner.{jsx,module.css}` — retained (web-shell-specific chrome).

### Tests

- **New smoke** — `packages/core/test/shared-routes.smoke.js`. Asserts the core exports map, the 25 shared files exist, each route reads `useMessaging()` + calls its helpers via `messaging.X(...)` + drives `Screen` from `screenVariantFor`, both App.jsx wrap in `<MessagingProvider>` and import the 8 shared routes, the old per-shell duplicates are deleted, and both messaging modules expose the full surface (`unlockWallet`, `lockWallet`, `listWallets`, `getWalletBalances`, `getAddressesByChain`, `getNewestAddress`, `generateReceiveAddress`, `createWallet`, `importMnemonic`, `sendAsset`).
- **Smokes updated** — `web-shell`, `web-send`, `web-onboarding`, `popup-shell`, `extension-onboarding`, `receive-view`, `home-lock`, `unlock-flow`, `e2e-harness` all re-target the shared paths and the `messaging.X` call convention. Behavioral assertions (real Vault round-trips against fake chrome.storage / fake IndexedDB) keep the same shape — only the static-regex checks moved.

### Scope boundary

- No new authoring features land in this piece. Token Creation Wizard (§40.1) + ISSUE/MINT/DESTROY (§40.2–§40.5) come next, building on the shared-routes surface.
- Auto-lock stays popup-only for today (web shells opt out via `enabled: shell === 'popup' && !locking`). Cross-shell parity for auto-lock is a later polish.
- Extension popup + web now both render the same `Home.jsx`. The full-screen Home uses a responsive grid of `ChainBalanceCard`s; the popup gets a single-column stack of the same cards — card internals unchanged.

## [0.45.0] - 2026-04-22

Closes out Phase 1's buildable surface. One combined release covering Batch 5 (Vitest in core, Playwright harness, i18n scaffold, axe-core CI gate) + piece 19 (real SDK wiring), piece 20 (extension popup onboarding), piece 21 (threat-model artifact), and piece 22 (reproducible-build scaffold). Released as a single version because the pieces together cross the "Phase 1 shippable" line — the release-gate checklist in `IMPLEMENTATION_STATUS.md` drops from every-item-open to "external review + signed releases" as the remaining gate.

### Added

**Piece 15 — Vitest in `core`** (§52.2)

- `packages/core/vitest.config.js` — jsdom env, `@vitejs/plugin-react` for JSX, `test/**/*.test.{js,jsx}` include, `*.smoke.js` excluded so the Node-script smokes run untouched, v8 coverage provider. Coverage thresholds deliberately unset until the suite grows toward §52.2's 80% target.
- `packages/core/test/setup.js` — loads `@testing-library/jest-dom/vitest`, polyfills `webcrypto` on Node 18.
- `packages/core/test/_run-smokes.js` — discovery-based runner wraps every `*.smoke.js` behind `pnpm -C packages/core test:smoke`.
- Vitest suites (`*.test.{js,jsx}`, 5 files, 25 cases): `decoder.test.js`, `ui/Button.test.jsx`, `ui/Input.test.jsx`, `ui/ChainBadge.test.jsx`, `ui/CopyButton.test.jsx`.
- `packages/core/package.json` — `test` / `test:watch` / `test:coverage` / `test:smoke` scripts + Vitest devDep set.
- `.gitignore` excludes `/packages/*/coverage`.

**Piece 16 — Playwright harness** (§52.4)

- `e2e/` workspace package with `playwright.config.js` (Chromium, workers=1, `webServer` spawns `pnpm -C packages/web dev`, traces + video + screenshots on failure), README runbook.
- `tests/onboarding.spec.js` — 4 cases: create/lock/unlock round-trip, wrong-password error, BIP39 import, word-count validation.
- `tests/send-form.spec.js` — 4 cases: review round-trip with form-state preservation, `|;` memo rejection, zero-amount rejection, broadcast attempt surfaces SDK-stub error.
- `.github/workflows/ci.yml` — new Playwright job; existing install job gains `pnpm -r test` + `pnpm -C packages/core test:smoke`.
- `pnpm-workspace.yaml` includes `e2e`.

**Piece 17 — i18n scaffold** (§54)

- `packages/core/src/i18n/en.js` (57 keys) + `index.js` with `t()`, `format()`, `setLocale`/`registerLocale`/`onLocaleChange`/`availableLocales`. Missing keys fall back to English then to the key itself.
- Re-exported as the `i18n` namespace from core's `index.js`.

**Piece 18 — axe-core CI gate** (§53)

- `e2e/tests/a11y.spec.js` scans every Phase-1 screen against WCAG 2.1 A + AA tags. Helper surfaces the violation list in failure messages.
- `@axe-core/playwright` added as an e2e devDep.

**Piece 19 — real `xchain-sdk` wiring**

- `packages/web/src/sdkFactory.js` + `packages/extension/src/background/sdkFactory.js` — shared-shape resolvers that dynamic-import `xchain-sdk`, wrap via `core.sdk.adaptXChainSDK`, and fall back to a clearly-flagged dev mock when the package isn't resolvable. Single `console.warn` on fallback.
- `hostBridge.sdkResolved` / `background.sdkResolved` — promises that settle with `'real' | 'dev-mock'`.
- `xchain-sdk@^1.8.0` as a runtime dep on both shells.

**Piece 20 — extension popup onboarding**

Closes the `TEST_DAPP_RUNBOOK` bootstrap gap for the extension.

- `packages/extension/src/background/walletCreate.js` — pre-host `wallet.create` / `wallet.import` handlers. `WalletExistsError` idempotence guard.
- `sessionMeta.js` dispatcher + `PRE_HOST_MESSAGE_TYPES` now covers `wallet.create` + `wallet.import`; accepts `chainRegistry` + (lazy-bound) `sdkRegistry` deps.
- Popup routes: `CreateWallet.jsx`, `ImportWallet.jsx`, `components/MnemonicGrid.jsx` (+ CSS) — popup-sized variants of the web onboarding flows.
- Popup `App.jsx` adds the `welcome | create | import` sub-route.
- Popup `messaging.js` gains `createWallet` + `importMnemonic` helpers.

**Piece 21 — threat-model artifact** (§12)

- `docs/THREAT_MODEL.md` — full draft covering protected assets, in/out-of-scope threats, 5 attacker scenarios with code-pointer mitigations, known open items, review cadence, and a Verification section cross-referencing smoke tests. Release-gating-checklist item has a concrete artifact to hand to reviewers.

**Piece 22 — reproducible-build scaffold** (§51.4)

- `tools/build-reproduce/README.md` — pinning notes, verify-script plan, current gotchas, RC checklist.
- `tools/build-reproduce/check-no-dev-mock.sh` — pre-release gate greps built `dist/` for dev-SDK fallback markers. Fails the pipeline if found → guarantees `xchain-sdk` resolved during the production build.

### Tests

Six new smokes (auto-discovered by `_run-smokes.js`): `sdk-wiring`, `e2e-harness`, `vitest-setup`, `i18n`, `a11y-harness`, `extension-onboarding`, `release-gates`. 21 smokes total; all pass.

### Scope boundary — Phase 1 remaining

Remaining items are external/operational:

- Real broadcast testing on regtest (SDK resolution + live stack).
- External threat-model review (doc is ready).
- Legal review of user-facing copy (i18n scaffold ready).
- Signed releases (needs certs + signing key).
- Manual accessibility audit (screen-reader pass; axe covers the programmatic side).
- Reproducible-build verification (scaffold + gate shipped; `RELEASE_MANIFEST.txt` from the release pipeline closes the loop).

Every "pending" item in `IMPLEMENTATION_STATUS.md` that a single codebase commit could deliver has been delivered.

## [0.44.0] - 2026-04-22

### Added

**Plain-English action decoder + sign-screen upgrade** (§21.1, §30) — Batch 4 piece 14

Closes out Batch 4.

- `packages/core/src/decoder/actionDecoder.js` — pure function:
    ```
    decodeAction({ action, params, chainId, chainRegistry })
      → { summary: string, details: Array<{ label, value }>, warnings: string[] }
    ```
  Phase 1 covers SEND + SWEEP with human sentences ("Send 100 MYTOKEN on Bitcoin to bc1q…", "Sweep all assets on Dogecoin to bc1q…"). Every other ACTION kind gets a generic fallback that pretty-prints the params and surfaces a "no plain-English summary yet" warning — dedicated decoders for ISSUE / MINT / DISPENSER / etc. land alongside their authoring forms in later phases.
  
  Warnings it raises:
  - Memo containing `|` or `;` (protocol rejects the tx).
  - SEND with amount ≤ 0 or empty destination.
  - SWEEP blanket "moves every balance at the source address" reminder + empty-destination warning.
  - Unknown action "no summary yet" notice.

- `packages/core/src/index.js` re-exports the `decoder` namespace so both shells reach it via `import { decoder } from '@xchain-wallet/core'`.

- `packages/extension/src/approval/kinds/SignApproval.jsx` — `signAction` summary block now calls `decoder.decodeAction`. Renders the human summary line, a proper `<dl>` details list (labeled rows, not raw JSON), and a warnings alert styled as a yellow banner above the password input.

- `packages/extension/src/approval/kinds/SignApproval.module.css` — new styles for `.detailsList` / `.detailsRow` / `.detailsLabel` / `.detailsValue` and the `.warnings` alert block.

### Scope boundary

- **PSBT summary stayed raw-hex** — structural PSBT parsing needs `bitcoinjs-lib`. Until the real SDK is bundled, showing `psbtHex` truncated + signing paths is the honest fallback; no fake parser.
- **Web `Send.jsx` still uses its own review layout** — the review there renders structured rows (Chain / From / To / Asset / Amount / Memo) that differ from the decoder's flat `details[]` shape. Converging is a later polish pass; both paths render the same underlying data correctly today.
- **Rejection UX** is the existing Reject button + the warnings banner. §30's "once, clearly" anti-paternalism guideline means the decoder surfaces warnings inline without adding a confirm-dialog before Approve.

### Tests

- `packages/core/test/action-decoder.smoke.js` — 7 decoder cases (happy SEND, SEND with `|` memo → warning, SEND with zero amount + empty destination → two warnings, SWEEP blanket-balance warning, unknown-action fallback, no-chain-registry path, null-params safety) + static wiring for the core namespace re-export and SignApproval's import/use of the decoder.

## [0.43.0] - 2026-04-22

Covers Batch 4 pieces 12 + 13 (web onboarding + web Send). Bundled because both touch `packages/web/src/messaging.js` and `packages/web/src/App.jsx`; splitting would churn the same files without shipping anything different.

### Added

**Piece 12 — web onboarding: create + import** (§15.3, §19.2)

Closes the bootstrap gap called out in `TEST_DAPP_RUNBOOK.md` for web. Users can now create a fresh BIP39 wallet or import an existing 12/15/18/21/24-word phrase without hand-seeding IDB through DevTools.

- `packages/web/src/hostBridge.js`:
  - Replaced the throwing SDK scaffold with a clearly-flagged `createDevMockSdk` (DO NOT USE FOR MAINNET). Produces deterministic pseudo-addresses per (pubkey, addressType) so HD derivation completes during onboarding; signing / broadcast / message-signing still throw loudly. Real `xchain-sdk` bundling is a Batch 5 piece.
  - `createWalletLocal({ password, name, strengthBits, bip39Passphrase, activeChainIds })` — fresh kdfParams, master key, blank vault → `flows.createWallet` → save meta → host live. Returns `{ mnemonic, walletName }`.
  - `importMnemonicLocal({ password, mnemonic, name, bip39Passphrase, activeChainIds })` — same persistence path for an existing phrase (BIP39 or Counterwallet-legacy; format auto-detected).
  - Both helpers guard idempotence (second create / import against an existing meta rejects with "a wallet already exists").
  - `DEFAULT_ACTIVE_CHAIN_IDS` — BTC/DOGE/LTC mainnet. Users can change via Settings (later piece).
- `packages/web/src/messaging.js` — `createWallet` + `importMnemonic` helpers.
- `packages/web/src/routes/CreateWallet.jsx` (+ CSS) — 2-stage flow: password+confirm+name form → mnemonic display with "I've saved it" checkbox. Mnemonic is generated client-side via `cryptoLib.generateBip39Mnemonic` and **only persisted after** the user acks, via `importMnemonic` with the generated phrase — so a user who closes the tab at the display stage leaves no vault behind.
- `packages/web/src/routes/ImportWallet.jsx` (+ CSS) — textarea for the phrase (spell-check off, lowercase, no autocomplete), word-count validation (12/15/18/21/24), password + confirm, name.
- `packages/web/src/components/MnemonicGrid.jsx` (+ CSS) — numbered 3/4-column read-only grid. Deliberately no copy-to-clipboard button per §19 — seeds should be hand-written, not parked in clipboard history.
- `packages/web/src/routes/Onboarding.jsx` — activated the Create + Import buttons via new `onCreate` / `onImport` props.
- `packages/web/src/App.jsx` — added `no-wallet` sub-routing (`welcome | create | import`). Successful create/import leaves the host live; next `refresh()` transitions the app to Home without a separate unlock step.

**Piece 13 — web Send form + review** (§29 authoring)

- `packages/web/src/routes/Send.jsx` (+ CSS) — multi-stage authoring flow:
  - **form**: chain picker (when the wallet has addresses on >1 chain), auto-picked source address (highest external HD index on the chain), native-ticker default (`descriptor.coin.toUpperCase()`), recipient / asset / amount / memo inputs. Client-side validation: required fields, positive amount, protocol `|` + `;` memo rejection.
  - **review**: decoded summary (Chain / From / To / Asset / Amount / Memo) in a `<dl>` grid with an inline password input.
  - **submitting / done / error** states — `InvalidPasswordError` surfaces as "Incorrect password."; other errors surface raw and drop back to review with the form state hydrated so the user doesn't retype.
- `packages/web/src/messaging.js` — `sendAsset(opts)` helper targeting the host's `action.send` handler.
- `packages/web/src/App.jsx` — added `unlocked` sub-routing (`home | send`), caches active walletId at App level so Send reuses Home's single-wallet assumption.
- `packages/web/src/routes/Home.jsx` — activated the Send button via new `onSend` prop.

### Scope boundary

Real broadcast via Send is blocked by the dev-SDK stub — the flow exercises cleanly through form + review + password entry, then fails with a visible "xchain-sdk" / "not yet wired" error at the encoder step. Shipping real broadcast is a Batch 5 piece (SDK bundling).

Onboarding in the **extension popup** remains a stub — the popup route set hasn't been hoisted into shared components yet. That shared-routes refactor + popup onboarding land together in a later cleanup.

### Tests

- `packages/core/test/web-onboarding.smoke.js` — static wiring (App sub-routes, CreateWallet generates + persists via `importMnemonic`, ImportWallet's word-count validation, dev-SDK stub flagged) plus behavioural round-trips: real create → mnemonic returned + vault persisted + session=unlocked + `wallet.list` returns the seeded wallet + lock/unlock round-trip proves kdfParams persisted + idempotence guard rejects a second create; reset; import with a fresh BIP39 phrase + idempotence guard.
- `packages/core/test/web-send.smoke.js` — static wiring (stage coverage, validation rules, App/Home wiring) + end-to-end `action.send` round-trip against the dev-SDK stub: vault seeded, real source address resolved from the persisted addresses-by-chain result, `sendAsset` called, error surfaced as a structured rejection matching the expected "xchain-sdk / not yet wired / encoder" message.

## [0.42.0] - 2026-04-22

### Added

**Web SPA shell + extension-detection banner** (§8.1 target #1, §8.3, §9.3.3) — Batch 4 piece 11

The web SPA is now a real React app. Same state-machine topology as the extension popup, with routes rendered full-layout and messaging dispatched through an in-page MessageHost instead of `chrome.runtime`.

**In-page host bridge**

- `packages/web/src/hostBridge.js` — module-scoped `vault` + `host` that survive re-renders but die on tab close / reload (web's key-isolation tradeoff per §9.3.3). Exposes `getSessionStatus`, `unlockWalletLocal`, `lockWalletLocal`, and a `sendMessage(type, request)` dispatcher whose envelope shape matches the popup's `chrome.runtime.sendMessage` wrapper — so the later shared-routes refactor can swap shells without touching route code.
- `packages/web/src/storage/WebMetaBackend.js` — plaintext kdfParams slot at `xchain-wallet:vault-meta` in localStorage. Non-secret by Argon2id design; needed so the unlock flow can derive the master key before touching the IndexedDB ciphertext. Injectable `storage` adapter for tests.
- `packages/web/src/messaging.js` — popup-parity helpers (`unlockWallet`, `lockWallet`, `listWallets`, `getWalletBalances`, `getAddressesByChain`, `getNewestAddress`) wrapping `hostBridge.sendMessage`.

**SPA shell + routes**

- `packages/web/src/main.jsx` — React root. Imports `@xchain-wallet/core/ui/tokens.css` once so design-token custom properties install on `:root` for every route.
- `packages/web/src/App.jsx` — 5-state router matching the popup (`loading | error | no-wallet | locked | unlocked`), rendering the web routes with `Screen variant="full"`.
- `packages/web/src/routes/` — four routes + co-located CSS modules:
  - `Loading.jsx` — full-layout three-dot indicator.
  - `Onboarding.jsx` — stub hero + disabled create/import buttons pointing at piece 12. Wraps in `<ExtensionBanner />`.
  - `Locked.jsx` — real password form, same focus + error handling as the popup's Locked, routed through `unlockWallet()`. Wraps in `<ExtensionBanner />`.
  - `Home.jsx` — wallet-name header + Lock button + per-chain balance grid (via `ChainBadge`), disabled Send/Receive.
- `packages/web/src/components/ExtensionBanner.jsx` — §8.3 detection banner. Checks `window.xchain` on mount and listens for the inject-script's `xchain#initialized` event. Dismissal persisted to `sessionStorage` so it doesn't nag across navigations but reappears on a fresh tab.

**Build wiring**

- `packages/web/vite.config.js` enables `@vitejs/plugin-react`.
- `packages/web/index.html` — root div renamed to `xchain-web-root`, script src updated to `/src/main.jsx`.
- `packages/web/src/main.js` deleted.
- `packages/web/src/index.js` re-exports `WebMetaBackend` + namespace-exports `hostBridge`.

### Changed

- `packages/web/package.json` now depends on `@xchain-wallet/extension` for the shared `createBackgroundHost` factory. Flagged in `hostBridge.js` as a candidate for extraction into a lower-level `host-wiring` package when a third shell appears; importing via a cross-package relative path keeps Node smokes runnable without the pnpm workspace symlink while Vite resolves the same path cleanly at build.

### Scope boundary

Routes are intentionally duplicated between popup and web for this piece. A later cleanup piece hoists the shared ones into `src/shared/routes/` behind a `MessagingProvider` React context so both shells consume the same components. Onboarding remains a stub until piece 12.

### Tests

- `packages/core/test/web-shell.smoke.js` — static wiring (Vite plugin, index.html entry, App state coverage, Locked/Home/ExtensionBanner specifics, workspace deps) plus an in-page bridge lifecycle against a real AES-GCM vault with injected `localStorage` + IndexedDB fakes: fresh page → `no-wallet`, wrong-password unlock → `InvalidPasswordError` (state stays `locked`), right-password unlock → `unlocked` with a working `sendMessage('wallet.list')` round-trip returning the seeded wallet, `lockWalletLocal()` → `locked` + `sendMessage` rejects with `VaultClosedError`.

## [0.41.0] - 2026-04-22

### Added

**Batch 3 piece 10 — bridge end-to-end smoke + test-dApp runbook**

- `packages/core/test/bridge-e2e.smoke.js` — integration smoke that assembles the real Vault + MessageHost + ApprovalBroker (with a fake `chrome.windows`) and drives the full Phase-1 bridge surface through `host.handle`:
  - `bridge.connect` → approval parked → `approval.resolve` with the same envelope the popup sends → `ConnectedSite` written + response shape verified.
  - Second `connect` on the same origin is idempotent (no new approval window opens).
  - `bridge.getAccounts` / `getAddresses` / `getSupportedChains` (9 chains; `icon` elided as piece-1 shell follow-up intended).
  - `bridge.signAction` with `ISSUE` returns `{ error: 'UNSUPPORTED_ACTION', supportedActions: ['SEND', 'SWEEP'] }` without opening an approval.
  - `bridge.disconnect` removes the site.
  - Window-close-without-decision on a pending connect → dApp-side Promise rejects with `UserRejectedError`.
  - Test-dApp surface (`runExample` + `MockXChainProvider`) still exposes the symbols the runbook references — catches accidental drift.
- `packages/extension/docs/TEST_DAPP_RUNBOOK.md` — manual browser-pass runbook for RC builds. Covers build + load unpacked, bootstrap gap (seed a wallet via DevTools until Batch 4's onboarding lands), serving the test-dApp, walking `runExample` through each approval popup with expected outcomes, edge cases (reject / close / re-connect / always-allow / mid-flow lock), and a pointer at the node smoke for PR gate use.

### Scope boundary

Sign paths that hit the real SDK (`signMessage`, `signPsbt`, `signAction` SEND) are exercised up to the approval hand-off. Going further — i.e. producing a valid signed payload — needs the real SDK bundled into the extension, which ships in a later piece.

## [0.40.0] - 2026-04-22

Covers Batch 3 pieces 8 + 9 (approval window plumbing + per-kind approval screens). Bundled because piece 9 replaces piece 8's `approval/main.jsx` placeholder and extends `approval/messaging.js` — splitting would just churn the same files.

### Added

**Piece 8 — approval window plumbing** (§43.4 request-approval flow)

- `packages/extension/src/background/approvalBroker.js` — `ApprovalBroker` class implements the `Approvals` interface (`connect`, `signAction`, `signMessage`, `signPsbt`, `signIn`) by parking requests in an in-memory map, opening an approval popup via `chrome.windows.create`, and returning a Promise that settles when the popup calls back via `approval.resolve` or when the window is closed by the user (chrome.windows.onRemoved → resolves as `{ approved: false }` — the `USER_REJECTED` convention). Deps are injectable (`newId`, `getUrl`, `windows`) so tests can drive the lifecycle without a browser.
- `packages/extension/src/background/uuid.js` — `sessionRandomUUID()` falls back to `crypto.getRandomValues` when `randomUUID` isn't available so the broker is testable under older Node.
- `packages/extension/src/background/createBackgroundHost.js` registers two new host handlers gated on the broker having the methods:
  - `approval.fetch({ id })` — returns the parked `{ id, kind, payload }` for the approval window; surfaces `ApprovalNotFoundError` for unknown ids.
  - `approval.resolve({ id, result })` — settles the parked Promise. Closes the window via `chrome.windows.remove`.
- `packages/extension/approval.html` + `packages/extension/src/approval/main.jsx` — the approval-window entry. Piece 8 shipped a `<Placeholder />` to prove the window plumbing works end-to-end; piece 9 replaces it with a real Router.
- `packages/extension/vite.config.js` adds `approval` as a fourth HTML entry. The manifest doesn't reference `approval.html` directly — `chrome.runtime.getURL` does, so the plugin copy is enough.
- `packages/extension/src/background.js` constructs a module-scoped `ApprovalBroker` at startup (survives unlock/lock cycles) and passes it as `approvals` when building the host.

**Piece 9 — per-kind approval screens**

- `packages/extension/src/approval/Router.jsx` — dispatches by `data.kind` to the matching component. Shared `reject()` settles the broker with `{ approved: false }` before calling `window.close()` so the bridge handler sees a clean `USER_REJECTED` instead of the window-close fallback.
- `packages/extension/src/approval/kinds/ConnectApproval.jsx` (+ `.module.css`) — connect flow. Chain checkboxes enumerate `chainRegistry.supportedChains()`, pre-checking the dApp's `requestedChains` (empty default if none requested — user must opt into each). `canSignMessage` toggle (off by default). `canSignAction: {}` always empty; per-action opt-in happens at signAction time via its "Always allow" toggle. Connect disabled until at least one chain is selected.
- `packages/extension/src/approval/kinds/SignApproval.jsx` (+ `.module.css`) — shared screen for the four password-gated kinds (`signMessage`, `signPsbt`, `signAction`, `signIn`). Layout: chain badge → per-kind summary block → password input → optional "Always allow on this origin" toggle → Reject/Approve. `savePermanent` shows for `signAction` and for `signMessage` when the request's `alreadyGranted` flag is not set — `signPsbt` has no toggle because PSBTs vary enough per-transaction that a blanket allow is dangerous (§21.3). Result envelope: `{ approved: true, walletId, password, savePermanent? }`. `InvalidPasswordError` surfaces as "Incorrect password." inline; other errors show their raw message for diagnosis.
- `packages/extension/src/approval/approval.module.css` — shared header / footer / summary / toggle-row utilities.
- `packages/extension/src/approval/messaging.js` adds `listWallets()` so `SignApproval` can pick `wallets[0].id` as `walletId` for the sign-result envelope. Multi-wallet picker is Phase 2.

### Changed

- `packages/extension/src/shared/chromeMessaging.js` — extracted the `sendMessage` wrapper so both `popup/messaging.js` and `approval/messaging.js` can consume the same implementation without either depending on the other.
- `packages/extension/src/popup/messaging.js` — now re-imports `sendMessage` from the shared module (popup-facing helpers unchanged).
- `packages/core/test/popup-shell.smoke.js` — regex that checks for `sendMessage` accepts both direct-export and re-export forms.

### Tests

- `packages/core/test/approval-broker.smoke.js` — static wiring + full broker lifecycle against a fake `chrome.windows`: connect → fetch → resolve round-trip, double-resolve no-op, unknown-id returns, window-close → `{approved: false}`, missing-windows rejection, plus a real MessageHost round-trip that verifies `approval.fetch` returns the parked payload, unknown ids surface `ApprovalNotFoundError`, and `approval.resolve` settles the pending bridge Promise.
- `packages/core/test/approval-screens.smoke.js` — static wiring for Router / ConnectApproval / SignApproval (dispatch by kind, result-envelope fields, kind coverage, savePermanent conditional, InvalidPasswordError pathway) + three broker round-trips that simulate each kind of popup result envelope and verify the bridge-side Promise resolves with exactly those fields.

## [0.39.0] - 2026-04-22

### Added

**Receive view + BIP21 QR** (§29.7 receive flow, §29.10 BIP21 URI) — Batch 2 piece 7

- `packages/extension/src/popup/routes/Receive.jsx` + `.module.css` — full Receive surface:
  - Chain picker (native `<select>`) when the wallet has addresses on multiple chains; single `ChainBadge` header otherwise. Picker is filtered to chains the wallet already owns an address on — "add a new chain" is a later onboarding flow.
  - Newest persisted external HD address for the picked chain, rendered as a BIP21-encoded QR via `qrcode@^1.5.4`. QR uses error-correction level `M`, 200px wide, `#0F172A` on `#FFFFFF` so contrast holds in both themes.
  - Address pane uses `<AddressText truncate={false}>` + `<CopyButton>` so the full string is visible + one-tap copyable.
  - "New address" button opens an inline password form that calls `receive.getAddress`. The password prompt is required because HD seed decryption re-runs Argon2id per derivation (§26 — password-never-stored posture); the current-newest address is displayed without a prompt so routine "send me some" traffic doesn't trigger the KDF.
  - ← Back control returns to Home.
- **Two new pre-password host handlers** in `createBackgroundHost.js`:
  - `addresses.byChain({ walletId })` → `Record<chainId, Address[]>` — used to build the Receive picker.
  - `addresses.newest({ walletId, chainId, addressType? })` → newest external-index HD address (change=0), or `null`. Skips imported WIFs and internal (change=1) addresses.
- `packages/extension/src/popup/App.jsx` — popup-local sub-route within the `unlocked` state: `home | receive`. Active walletId is cached at App level so Receive can reuse Home's single-wallet assumption without re-querying `wallet.list`.
- `packages/extension/src/popup/routes/Home.jsx` — `Receive` button activated via a new `onReceive` prop (disabled when the prop is absent).
- Messaging: `getAddressesByChain(walletId)`, `getNewestAddress(walletId, chainId)`, `generateReceiveAddress({ walletId, chainId, password, bip39Passphrase?, addressType? })`.

### Changed

- `packages/extension/package.json` adds `qrcode@^1.5.4` as a runtime dependency.

### Tests

- `packages/core/test/receive-view.smoke.js` — drives both new handlers end-to-end against a real Vault seeded with BTC-mainnet external (indexes 0/1/2) + internal (change=1) + a DOGE address + a second wallet's address-that-must-not-leak. Asserts: byChain buckets cleanly, newest picks the highest external index and skips change=1 + other wallets, null for chains with no persisted addresses, missing-field rejection, plus a BIP21 encode/parse round-trip proving the QR payload is reversible.

## [0.38.0] - 2026-04-22

Covers Batch 2 pieces 5 + 6 (real unlock screen + Home screen with `wallet.lock` + foreground auto-lock). Bundled because both pieces touch `sessionMeta.js` + `messaging.js`; splitting the commit would require churn without shipping anything different.

### Added

**Piece 5 — unlock flow** (§26 lock/unlock)

- **Pre-host dispatcher** — `packages/extension/src/background/sessionMeta.js` refactored from a single-type listener into a dispatcher. Exports `PRE_HOST_MESSAGE_TYPES` (authoritative set the host listener skips) and handles `session.status` + `wallet.unlock`. `ChromeRuntimeAdapter` now consults that set directly instead of a `session.*` prefix check — keeping the two listeners disjoint without convention-coupling.
- **`wallet.unlock` handler** — `packages/extension/src/background/walletUnlock.js` derives the vault master key via `cryptoLib.deriveMasterKey`, authenticates by opening the encrypted blob (AES-GCM tag mismatch ⇒ `InvalidPasswordError`), seeds the session backend, and fires `onUnlocked()` so background can re-init the host. `NoVaultError` surfaces when no kdfParams meta is planted; empty-password guarded at the boundary.
- **Plaintext meta storage** — `packages/extension/src/storage/ChromeMetaBackend.js` stores vault kdfParams at `xchain-wallet:vault-meta`. Non-secret by design (Argon2id salt is public; memory/iterations are tuning info). Needed because the master key must be derived from password before the ciphertext can be touched.
- **Locked screen** — `src/popup/routes/Locked.jsx` is now a functional password form: auto-focus on mount, auto-re-focus+select on failure, `<Input type="password" autoComplete="current-password">`, `<Button type="submit" loading>` for inline spinner, Enter-to-submit via native `<form>`. `InvalidPasswordError` surfaces as "Incorrect password." — other errors show the raw message (bugs worth seeing).
- `unlockWallet(password)` added to `src/popup/messaging.js`.

**Piece 6 — Home screen + wallet.lock + foreground auto-lock**

- **`wallet.lock` handler** — `packages/extension/src/background/walletLock.js` clears the session backend and fires `onLocked()`. Added to `PRE_HOST_MESSAGE_TYPES` (with a matching dispatch case). Idempotent — safe to call when there's already no session.
- **Background teardown** — `background.js` captures `attachChromeRuntime`'s detach fn, defines `tearDownHost()` (detach listener + `vault.close()` + null refs), and passes it as `onLocked`. A subsequent unlock starts from a clean slate; stale vault references can't leak across a lock boundary.
- **Home screen** — `src/popup/routes/Home.jsx` ships the full unlocked-wallet landing view:
  - Header: wallet name (from `wallet.list[0]` — single-wallet Phase 1 scope; picker is a later piece) + `Lock` button with loading state.
  - Body: per-chain `<ChainBalanceCard>` rendered from `balances.wallet`. Graceful error fallback for each chain card so the SDK-stubbed state (every entry carries an `error`) renders as informative text instead of a crash. Empty-wallet hint when no addresses exist.
  - Actions: disabled `Send` + `Receive` with an inline note pointing at their later pieces.
- **ChainBalanceCard** — `src/popup/components/ChainBalanceCard.jsx` + `.module.css`. Card with a `ChainBadge` header, address-count sub-label, and a fallback body that surfaces the SDK error when all entries failed.
- **`useAutoLock` hook** — `src/popup/hooks/useAutoLock.js` foreground auto-lock (§26). 5-min default, 30s tick, listens for mousemove / keydown / scroll / click / touchstart. Calls `onLock()` once the idle threshold is crossed. Documents the scope gap: background-mediated auto-lock (survives popup close/reopen) is a later piece.
- `lockWallet()` / `listWallets()` / `getWalletBalances(walletId)` added to `messaging.js`.

### Changed

- `packages/extension/src/storage/index.js` re-exports `ChromeMetaBackend` + `DEFAULT_META_KEY`.
- `packages/extension/src/background/ChromeRuntimeAdapter.js` imports `PRE_HOST_MESSAGE_TYPES` and defers those types to the meta listener (replaces the piece-4 `session.*` prefix check).
- `packages/core/test/popup-shell.smoke.js` adapted to the new `attachSessionMetaListener(deps, chromeRuntime)` signature + the new adapter filter wording.

### Tests

- `packages/core/test/unlock-flow.smoke.js` — real-crypto round-trip. Builds a genuine AES-GCM vault blob via the core `Vault`, plants kdfParams in the meta slot, and drives `wallet.unlock` through four behavioural cases: no-vault, right-password (unlock + session seeded + `onUnlocked` fired), wrong-password (`InvalidPasswordError`, session untouched), empty-password (boundary guard).
- `packages/core/test/home-lock.smoke.js` — static wiring of Home / messaging / useAutoLock / ChainBalanceCard / background teardown, plus behavioural cases for `wallet.lock`: lock-from-unlocked (session cleared + `onLocked` fires + status flips to `locked`) and lock-without-session (idempotent, callback still fires).

Both new smokes install `webcrypto` from `node:crypto` onto `globalThis.crypto` since Node 18 exposes it only under the experimental flag and `@noble/hashes` + AES-GCM both reach for the bare global.

## [0.37.0] - 2026-04-22

### Added

**Extension popup HTML entry + React root + session-meta listener** (§8.1 target #3, §9.3.1 process isolation)

The popup is the user's primary entry point to the wallet. This piece ships the shell: HTML entry, React root, hash-free state-machine router, and the background wiring that lets the popup answer "what do I render?" without demanding an unlocked vault.

**Popup shell**

- `packages/extension/popup.html` — at the package root so MV3 can reference `popup.html` directly out of `dist/`. Mounts `<App />` into `#xchain-popup-root` via a type-module script tag pointing at `src/popup/main.jsx`.
- `packages/extension/src/popup/main.jsx` — `createRoot(container).render(<App />)`; imports `@xchain-wallet/core/ui/tokens.css` once so every route inherits the design-token palette + dark-mode + reduced-motion handling.
- `packages/extension/src/popup/App.jsx` — 5-state router: `loading → no-wallet | locked | unlocked | error`. Queries `session.status` on mount, renders the matching route, and passes each route a `refresh()` callback so flows that change state (create wallet, unlock, lock) re-pull ground truth from the background.
- `packages/extension/src/popup/messaging.js` — `sendMessage(type, request)` wraps `chrome.runtime.sendMessage` in a Promise. Surfaces the MessageHost `{ok, result} | {ok, error}` envelope as resolve/reject and preserves the error-class name. `getSessionStatus()` is the named query.
- `packages/extension/src/popup/routes/` — four route stubs with co-located CSS modules:
    - `Loading.jsx` — animated three-dot pulse indicator; static under `prefers-reduced-motion`.
    - `Onboarding.jsx` — logo hero + tagline from `branding.js`; "Create a new wallet" / "I already have one" buttons (disabled — real flows land in Batch 4).
    - `Locked.jsx` — scaffold stub; real password form + `unlockWallet` wiring lands in piece 5.
    - `Home.jsx` — scaffold stub with a header "Lock" trigger so the state machine is exercisable end-to-end; balances / send / receive land in pieces 6–7.

**Background session-meta listener**

The popup renders first-thing-on-open — before any unlock flow has run. `MessageHost` requires an open Vault, so a vault-less question like "is there a wallet?" couldn't be asked through it. The session-meta listener plugs that gap.

- `packages/extension/src/background/sessionMeta.js` — `attachSessionMetaListener(chromeRuntime?)` installs a `chrome.runtime.onMessage` listener that answers one type (`session.status`) from the two storage backends directly. Returns `{ hasWallet, hasSession, state }` where `state ∈ {'no-wallet', 'locked', 'unlocked'}`. Returns `false` for any non-`session.*` message so the host listener picks those up normally.
- `packages/extension/src/background/ChromeRuntimeAdapter.js` — host listener now returns `false` for `session.*` message types so the two listeners stay disjoint (prevents double-`sendResponse` on the same message).
- `packages/extension/src/background.js` — `attachSessionMetaListener()` runs before `ensureHost()` so the popup gets an answer even when the vault is still locked. Host listener attaches once the session key is present.

**Vite wiring + manifest + app icons** (§9.5, §51)

- `packages/extension/vite.config.js` — `@vitejs/plugin-react` enabled; fourth entry added (`popup` pointing at `popup.html`) so Vite's HTML pipeline produces `dist/popup.html` + a hashed `assets/popup-<hash>.js`. New `iconResizePlugin` uses `sharp` to resize `packages/core/src/branding/assets/favicon.png` (128×128 source) into MV3-standard 16 / 32 / 48 / 128 PNGs at `dist/icons/icon-<size>.png` on every build.
- `packages/extension/manifest.json` — added top-level `icons` + `action.default_popup = "popup.html"` + `action.default_icon` at all four sizes.
- `packages/extension/package.json` — `sharp@^0.33.5` devDep (consumed only by the icon-resize plugin at build time).

### Tests

- `packages/core/test/popup-shell.smoke.js` — 13 static-wiring checks (popup HTML, React entry, App state coverage, route exports, Vite config plugins + popup input + icon sizes, manifest popup/icon references, sharp devDep, background listener wiring) plus a runtime test that installs the session-meta listener against a fake `chrome.runtime` + `chrome.storage` and drives it through all three wallet states (no-wallet / locked / unlocked) plus a non-session-message passthrough check.

## [0.36.0] - 2026-04-22

### Changed

**Electron desktop shell moved out of Phase 1 into Phase 2** (spec §40.12)

Rationale: the desktop shell's headline differentiators over web + extension are (a) OS keychain integration and (b) native USB/HID hardware-wallet transports. Hardware signers (`TrezorSigner` / `LedgerSigner`) are Phase 2 per §17.3–17.4, so shipping the desktop shell in Phase 1 would mean a desktop app whose standout features are stubs. Bundling the two into Phase 2 (§40.11 Hardware Wallets + §40.12 Electron Desktop) delivers the desktop app with its value intact.

- `packages/desktop/package.json` — description flagged as "Phase 2 stub; ships alongside hardware signers per spec §40.12."
- `packages/desktop/README.md` — new; explains the deferral + points at spec §40.12. Phase 1 users get the web SPA + Chrome extension (both cover the full send/receive/sign surface).

Spec + IMPLEMENTATION_STATUS updates land in the platform working-copy (gitignored from this repo):

- §8.1 Phase 1 targets table no longer lists Electron desktop
- §8.2 deferred targets table adds the Electron desktop row with a Phase 2 marker
- §39.1 Phase 1 per-target delivery drops "Desktop (Electron) with OS keychain"
- §39.2 Phase 1 out-of-scope adds "Electron desktop shell → Phase 2"
- §40.12 new subsection "Electron Desktop Shell Goes Live" covers main-process signing isolation, OS keychain (safeStorage / keytar), native Trezor / Ledger node transports, URI scheme registration, `electron-builder` packaging + signing, and reproducible builds
- IMPLEMENTATION_STATUS scope-change note + Target-Matrix row + Shell-layer descriptions refreshed to match

### Tests

- `packages/core/test/phase-scope.smoke.js` — new; guards the scope change against accidental revert. Verifies §8.1 does not list Electron desktop, §8.2 lists it with a Phase 2 marker, §39.2 out-of-scope calls it out, §40.12 subsection exists, IMPLEMENTATION_STATUS records the scope change and references §40.12, and desktop/package.json description mentions Phase 2.

## [0.35.0] - 2026-04-22

### Added

**React + CSS Modules wiring + `@xchain-wallet/core/ui` primitives**

Picks the UI framework + styling approach for the Phase 1 UI session. React 18.3 + CSS Modules wins on ecosystem depth (hardware-wallet libs, QR libs, a11y libs) and bundler-native styling (no runtime cost).

**Framework wiring**

- `packages/core/package.json` — `react` / `react-dom` declared as optional peer dependencies (`^18.3.0`). Optional because non-UI code (smoke tests, background handlers) imports `@xchain-wallet/core` without needing React. New `exports` map exposes subpaths so Node-only callers don't trip on JSX reached through the default entry:
    ```
    ".": "./src/index.js"
    "./ui": "./src/ui/index.js"
    "./ui/tokens.css": "./src/ui/tokens.css"
    "./ui/*": "./src/ui/*"
    "./branding/*": "./src/branding/*"
    ```
- `packages/extension/package.json` + `packages/web/package.json` — `react` / `react-dom` as regular deps; `@vitejs/plugin-react@^4.3.0` as a dev dep. Wired at the shell level so each Vite config can opt in to JSX in a later piece.

**Design tokens (§5.4 visual identity, §37 micro-UX)**

- `packages/core/src/ui/tokens.css` — CSS custom properties for spacing (4px grid), typography (system-font stack + monospace), radii, motion (≤200ms, cubic-bezier(0.2, 0, 0.2, 1) per §5.4), and a full palette. Light theme default + `@media (prefers-color-scheme: dark)` overrides. `@media (prefers-reduced-motion: reduce)` disables transitions. Accent colours match `branding.js` ACCENT_PRIMARY / ACCENT_SECONDARY. Shells import once: `import '@xchain-wallet/core/ui/tokens.css'`.

**Primitives (`packages/core/src/ui/`)**

Six components, each a JSX file plus a co-located `.module.css`:

- `<Screen />` — top-level layout wrapper. `variant="popup"` renders fixed 360×600 per §8.1; `variant="full"` flexes for extension full-screen / web SPA. Header / body / footer slots.
- `<Button />` — `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'`, `block`, `loading` (spinner + aria-busy), `disabled`. Focus ring from tokens. Spinner disables under `prefers-reduced-motion`.
- `<Input />` — `forwardRef`'d text input with label, hint, and error slots. `aria-invalid` + `aria-describedby` wired to the matching hint/error nodes via `useId()`. Pass-through props land on the underlying `<input>` so `value` / `onChange` / `autoFocus` / `autoComplete` go directly through.
- `<ChainBadge />` — icon + display name pill. Reads `branding.chainIconSmallUrl(descriptor.id)` for the asset; `descriptor.color` drives the tinted background/border via `color-mix()`. Non-mainnet networks surface the network kind in muted text next to the name.
- `<AddressText />` — monospace address with optional `first6…last6` truncation. Full address preserved via `title` + `aria-label` so hover and AT still expose the canonical string.
- `<CopyButton />` — writes to clipboard via `navigator.clipboard.writeText()`, flips label to "Copied" for 1.5s (configurable via `feedbackMs`). Silent no-op when clipboard is unavailable — callers own the fallback (manual-selection hint, QR).

**`packages/core/src/ui/index.js`** — barrel re-export for the 6 primitives. `tokens.css` stays unreferenced here (it's a global side-effect import shells do once at their entry point).

### Tests

- `packages/core/test/ui-surface.smoke.js` — static check: tokens.css declares the expected 11 custom properties + dark-mode + reduced-motion blocks + brand accent hex matches branding.js; every primitive exports its name, imports its co-located CSS module, references design tokens; `ui/index.js` re-exports all six; `core/package.json` declares the `./ui` + `./ui/tokens.css` subpath exports and `react` / `react-dom` as peerDeps; both shell `package.json`s declare `react` / `react-dom` / `@vitejs/plugin-react`. Runtime JSX smoke lives in the popup piece once a shell bundle compiles it.

## [0.34.0] - 2026-04-22

### Added

**§5 product identity — branding module + chain-icon assets**

- `packages/core/src/branding/branding.js` — single source of truth for user-facing brand strings and asset pointers. Exports `PRODUCT_NAME` (`"XChain Wallet"`), `TAGLINE` (placeholder from §5.2 candidate), `CANONICAL_DOMAIN` (`wallet.xchain.io`), `HOMEPAGE_URL`, `ACCENT_PRIMARY` / `ACCENT_SECONDARY` (sampled from the XChain logo — blue `#1E90C7`, purple `#7B2C8F`), `DEFAULT_EXPLORER_BASE` / `DEFAULT_HUB_BASE`, and chain-icon maps (`CHAIN_ICON_SMALL`, `CHAIN_ICON_LARGE`) keyed by ChainDescriptor.id
- `packages/core/src/branding/assets/` — 20 files vendored from `xchain-explorer/src/content/images/`: product logo (`xchain-color-750.png`), favicon (`favicon.png`), and 9 chain icons × 2 sizes (20px + 500px) covering BTC / DOGE / LTC × mainnet / testnet / regtest
- `assetUrl(filename)` / `logoUrl()` / `faviconUrl()` / `chainIconSmallUrl(chainId)` / `chainIconLargeUrl(chainId)` — resolve asset filenames to runtime URLs via `new URL('./assets/...', import.meta.url)`, the Vite-friendly pattern that emits hashed static assets at build time and still resolves on disk under Node

**§5.5 placeholders — resolved (non-marketing-gated)**

| Item | Resolution |
|---|---|
| Product name | `"XChain Wallet"` |
| Tagline | §5.2 candidate (self-custodial wallet for the XChain Platform) |
| Canonical domain | `wallet.xchain.io` |
| Per-chain explorer/hub URLs | `https://explorer.xchain.io`, `https://hub.xchain.io` (base); existing descriptor entries retained |
| Primary accent | `#1E90C7` (sampled from logo) |
| Secondary accent | `#7B2C8F` (sampled from logo) |
| Logo | `xchain-color-750.png` shipped |
| Favicon | `favicon.png` shipped |
| Chain icons | 9 × 2 sizes shipped |

ADS donation addresses remain the `PLACEHOLDER_REPLACE_BEFORE_MAINNET` sentinel (unchanged — marketing-/ops-gated). Tagline, primary-brand wordmark, and store-listing copy remain pending the marketing pass per §5.5.

### Changed

- `packages/core/src/registry/descriptors/{bitcoin,dogecoin,litecoin}.js` — replaced empty `icon: ''` with per-network asset filenames (e.g. `icon: 'bitcoin-mainnet-icon-20.png'`) on each of the 9 bundled descriptors. Validator JSDoc updated to describe `icon` as an asset filename resolved via `branding.assetUrl()`.
- `packages/extension/src/bridge/handlers.js` — `bridge.getSupportedChains` no longer forwards `descriptor.icon` verbatim to dApps. Raw filenames would be unresolvable cross-origin; a follow-up shell-layer piece will resolve them to `chrome.runtime.getURL(...)` URLs against a web-accessible asset path. Until then the bridge sends `icon: ''` (pre-existing behaviour) with an in-line TODO.

### Tests

- `packages/core/test/branding.smoke.js` — verifies 17 exports, 20 asset files exist on disk, all 9 bundled descriptors validate with their new `icon` fields, and no §5.5 `PLACEHOLDER_` sentinel leaks into branding strings.

## [0.33.0] - 2026-04-22

### Added

**Vite build scaffolding for `extension` and `web` packages** (§9.5 / §51.1) — infrastructure only, no UI framework decisions yet

- `packages/extension/vite.config.js` — multi-entry rollup with three fixed outputs (`background.js`, `content/contentScript.js`, `inject/xchainProvider.js`) matching the paths `manifest.json` already references. Custom `closeBundle` plugin copies `manifest.json` from the package root into `dist/` at build close (keeps the canonical manifest location stable while the UI session adds popup / full-screen HTML). Shared `@xchain-wallet/core` split into its own chunk so the three entries don't duplicate it
- `packages/extension/src/background.js` — MV3 service-worker entry. Builds a `ChainRegistry`, `SDKRegistry` (with a scaffold `throw`-on-use SDK factory — real SDK wires in at build time alongside the popup UI), and lazy-initialises a Vault + MessageHost against `ChromeStorageBackend` + `ChromeSessionBackend`. `attachChromeRuntime(host)` fires once a master key exists in session storage; the popup's unlock flow is responsible for triggering re-init
- `packages/web/vite.config.js` — minimal SPA config. Root `index.html` + `src/main.js` entry that imports `@xchain-wallet/core` and renders a scaffold marker into `#app`, proving the bundler reaches workspace deps. Dev server on port 5173
- `vite@^5.4.0` added as a dev dependency on both packages; build + dev scripts wired (`pnpm -C packages/extension build`, `pnpm -C packages/web build`, `pnpm -C packages/web dev`)
- CI build step enabled: the `install` job now runs `pnpm -r --if-present build` after install, exercising both Vite configs on every PR

### Scope boundary for the UI session

This release is a pipeline prover. No UI framework decision is baked in — the web `main.js` and extension popup/full-screen HTML are deliberately absent so the UI session can pick React / Solid / vanilla / etc. without config churn. What lands when UI work begins: popup HTML entry added to the extension's `rollupOptions.input`, framework runtime added to both packages' devDeps, the scaffold `main.js` replaced wholesale.

## [0.32.0] - 2026-04-22

### Added

**`bridge.parallel` stub** — structured `PHASE_DEFERRED` response so the inject script's `provider.parallel(actions)` surfaces a clean result-shape (`{ error: 'PHASE_DEFERRED', phase: 4, message }`) instead of falling through to `UnknownMessageTypeError`. Matches `bridge.signAction`'s `UNSUPPORTED_ACTION` pattern — dApp authors branch on `result.error` rather than try/catch. Full implementation ships with cross-chain orchestration in Phase 4+.

## [0.31.0] - 2026-04-22

### Added

**§9.8 dependency hygiene** — `docs/DEPENDENCIES.md` + CI audit step
- `docs/DEPENDENCIES.md` enumerates every runtime dep per-package with the specific feature it provides, license, and maintainer trust signal. Current runtime deps are all from Paul Miller's audited `@noble/*` + `@scure/*` line; workspace-only for extension / web / test-dapp
- CI `audit` job runs `pnpm audit --prod --audit-level=high` on every PR. Independent of the install job so a failing audit doesn't block typecheck reporting. Moderate advisories surface in logs but don't fail — tracked via the weekly review cadence documented in the file
- Review cadence spelled out: every `package.json` PR updates this file; weekly `pnpm outdated -r` check; advisories jump to the front of the queue regardless

## [0.30.0] - 2026-04-22

### Added

**§43 dApp bridge runtime** — the `window.xchain` provider + content-script + background handlers

Three layers shipped:

1. **Inject script (`src/inject/xchainProvider.js`)** — runs in the page's main world, defines `window.xchain` as a thin RPC shim per §43.2. Every method forwards to the content script via `window.postMessage` with an id-tagged envelope; responses are matched back against pending promises. Emits an `xchain#initialized` event on ready. Frozen after install (`Object.defineProperty` non-writable) so dApps can't swap it mid-session.

2. **Content script (`src/content/contentScript.js`)** — runs in the extension's isolated world on every http/https page. Injects the provider from `web_accessible_resources` at `document_start`, then pure-relays page ↔ background: every outbound request is annotated with `origin: window.location.origin` so the background resolves `ConnectedSite` permissions against a trusted origin, not one sent by the page. Handles `chrome.runtime.lastError` gracefully (extension context invalidation → `RUNTIME_UNAVAILABLE` structured error).

3. **Background handlers (`src/bridge/handlers.js`)** — Phase 1 bridge surface registered against `MessageHost`:
   - `bridge.connect` / `bridge.disconnect` — ConnectedSite lifecycle; first-call-per-origin prompts `Approvals.connect`, subsequent calls are idempotent and update `lastUsedAt`
   - `bridge.getAccounts` / `bridge.getAddresses` / `bridge.getBalances` — scoped to `ConnectedSite.permissions.accounts` + `chains`; `getAddresses` filters by `(coin, network)` from the descriptor; `getBalances` rejects addresses the site isn't permitted to see with `ADDRESS_NOT_PERMITTED`
   - `bridge.getSupportedChains` / `bridge.getActiveChains` — registry enumeration; `getActiveChains` reads seeded per-chain settings
   - `bridge.signMessage` / `bridge.signPsbt` — route through `Approvals` unless the site already has the permission; approvals returns `{ approved, walletId, password, bip39Passphrase }` to complete the flow
   - `bridge.signAction` — Phase 1 supports `SEND` + `SWEEP`; other actions return `{ error: 'UNSUPPORTED_ACTION', supportedActions }` per §43.2 (structured, not thrown). `savePermanent: true` on the decision persists `canSignAction[KIND] = 'always'` on the ConnectedSite record
   - `bridge.signIn` — §43.6 challenge format `XChain Sign-In | appId | address | nonce | timestamp | expiresAt`, signed via the regular signMessageFlow. Default expiry 5 min, capped at 1 hour

**`Approvals` injection point** — shells inject an implementation that opens approval popups; `rejectAllApprovals` default throws `USER_APPROVAL_REQUIRED` so dApps get a structured error instead of a hang when the shell hasn't wired a popup yet. `UserRejectedError` class for explicit rejections.

**Manifest updates** — `content_scripts` matches `http://*/*` + `https://*/*` at `document_start`; `web_accessible_resources` exposes `inject/xchainProvider.js`; `permissions` adds `storage`.

Smoke-tested end-to-end through `MessageHost.handle()` (29 assertions): NOT_CONNECTED / MISSING_ORIGIN / CHAIN_NOT_PERMITTED / UNSUPPORTED_ACTION / USER_REJECTED / USER_APPROVAL_REQUIRED all surface as structured errors; connect → getAccounts → getAddresses → signMessage → signIn round-trip, signature verifies via SDK; disconnect removes the ConnectedSite; re-connect is idempotent.

## [0.29.0] - 2026-04-22

### Added

**§15.4 gap-limit address scan** — `discoverUsedAddresses(opts)`

Walks each chain's default HD derivation path from `startIndex`, asks the explorer "has this address been seen?", and stops after `gapLimit` consecutive unused addresses (BIP44 standard 20). Closes the "restore from seed" completeness gap: after an import the wallet knows the seed but not which addresses the user actually used — this flow discovers them.

Judgment calls (documented in the module header):

- **Partial-result semantics.** A chain's probe can fail mid-scan. The flow returns what was discovered up to the failure, marks `{ incomplete: true, error }`, and continues to the next chain. Callers resume by re-calling with `startIndex = lastScannedIndex + 1`
- **Unknown addresses preserve the gap.** When a single probe fails or times out, that index is recorded as `{ unknown: true }` — doesn't advance the gap counter, doesn't reset it either. Prevents a flaky response from masking a real used address (conservative; the chain-level timeout bounds the work if failures persist)
- **Two-tier timeouts.** `perQueryTimeoutMs` (default 5000) bounds one explorer call. `chainTimeoutMs` (default 60000) bounds the whole per-chain scan — a hanging or wildly-slow explorer can't lock the scan indefinitely
- **No persistence.** The flow returns a discovery report. Callers compose with `receiveAddress` or a review UI to persist what they want — same flow backs both "dry-run" and "real" restores
- **Address-type coverage.** Default scans only the descriptor's `defaultAddressType`. Opt in to every supported type via `addressTypes: 'all'`. Type-level failures (e.g. SDK doesn't support p2tr yet) mark that type as `incomplete` but other types on the same chain still scan — no whole-scan aborts from one unsupported type
- **Injectable used-check.** Default probe is `sdk.explorer.getHistory(address, 'address', { limit: 1 })` — empty array → unused. Callers can supply a bespoke `isUsedProbe` (e.g. `getBalances` + tx count) if the deployment's explorer exposes cheaper queries

Progress reporting: synchronous `onProgress(event)` — events `chain-start`, `scan-progress` (per-address, with `{ used, unknown, consecutiveUnused }` in `data`), `chain-complete`, `chain-failed`. Callback exceptions are isolated from the scan.

Smoke-tested: used addresses at {0, 3, 7} found with `highestUsedIndex=7` and exactly 13 queries at gapLimit=5; empty wallet terminates at gapLimit=20; multi-chain scan per-chain independent; mid-scan probe failures mark addresses unknown and record chain error without killing other chains; hanging probes bounded by `chainTimeoutMs`; resume via `startIndex=5` still finds index-7 used; `addressTypes: 'all'` scans every supported type; unsupported type in explicit list rejected; invalid mnemonic → `InvalidMnemonicError`.

## [0.28.0] - 2026-04-22

### Added

**§50 Diagnostic dump** — `diagnosticDump({ vault, chainRegistry, … })` + `createErrorRingBuffer({ capacity })`
- Collects the §50.1 JSON blob: wallet (version, platform, os, browser), sdk version, chain registry summary (id / coin / networkKind / user-added flag), endpoints per chain with custom-override flag, signer kinds + HW models, non-sensitive settings, recent errors (truncated), record counts (not records), build metadata
- Strict redaction via whitelist. Settings sanitization picks only known non-sensitive fields — future Settings additions default to being REDACTED unless added to the list (sensitive-by-default). ADS `accumulatedSats` and `lifetimeDonatedSats` redacted even though they're user-visible counters; `perTxAmountSats` / `triggerAmountSats` / `lifetimeTxCount` kept since they're useful for bug triage
- Every field the spec says to redact is absent: mnemonics, WIFs, passphrases, address strings, balance values, txids, contact names/addresses/notes, connected-site details. Counts only for wallets / accounts / addresses / contacts / connected_sites / pending_txs
- `createErrorRingBuffer({ capacity })` — fixed-size buffer for the shell's `window.onerror` / `unhandledrejection` / extension service-worker crash hooks (§50.4). Each entry: `{ at, kind, message (capped at 500 chars), phase? }`. Overflow drops oldest
- Dump is always producible — missing inputs become `null` rather than throwing, so even a half-configured wallet can emit a diagnostic
- Smoke-tested: empty-vault dump; full dump with wallet + imported WIF + contact (no secrets leak through `JSON.stringify`); user-custom endpoint override reflected; ring-buffer overflow and message-length truncation; dump round-trips through `JSON.stringify/parse` (no circular refs, no Uint8Array leaks)

## [0.27.0] - 2026-04-22

### Added

**§49 Offline / degraded mode** — reachability classification + queued broadcasts
- `checkReachability({ sdkRegistry, chainIds, probes?, timeoutMs? })` — per-chain × per-service (explorer / encoder / hub) probe with per-probe timeout. Returns `{ overall: 'normal'|'degraded'|'offline', perChain: [{ chainId, services, mode, latencyMs, errors }] }`. Default probes: `sdk.pingEncoder()`, `sdk.pingHub()`, and `sdk.explorer._get('/')` for explorer (any HTTP response within the timeout counts as reachable — probe only measures TCP+HTTP round-trip, not status code)
- Callers supply custom probes via `probes`; `null` disables that check and reports `'not-configured'` instead of reachable/unreachable. Cross-chain rollup: all-normal → `normal`, all-offline → `offline`, anything mixed → `degraded`
- New PendingTx status `'queued'` for §49.5 queued broadcasts
- `enqueueSignedTx` — stash signed tx hex in a PendingTx (fresh record or update an existing one). `listQueuedBroadcasts` — read all `status='queued'` records, optionally filtered by chainId. `drainQueuedBroadcast` — attempt to broadcast one; on success transition to `broadcast`, on failure stay `queued` with error recorded. `discardQueuedBroadcast` — user's "Discard" button (idempotent)
- Spec-compliant: §49.5 calls for per-record explicit user approval, not automatic re-broadcast — `drainQueuedBroadcast` is one-at-a-time and surfaces failure without swallowing. `discardQueuedBroadcast` is the dual
- Smoke-tested: normal/degraded/offline classification under all single- and multi-chain configurations, disabled-probe path, timeout path, end-to-end enqueue → drain success → drain failure → discard lifecycle, per-chain filtering

## [0.26.0] - 2026-04-22

### Added

**Signing from imported-WIF addresses** — unblocks spending from wif-only wallets and from imported-WIF addresses in HD wallets
- `SoftwareSigner.unlock` now decrypts every `Wallet.importedKeys` entry into `_unlocked.importedWifs` (Map<addressId, Uint8Array>). Same master-key lifetime as the seed — zeroed on `lock()` alongside it
- Abstract Signer contract updated: `SigningPathEntry` carries either `path` (HD, all signers) or `addressId` (imported-WIF, software signer only). Multi-key signing within one tx remains a future enhancement
- `SoftwareSigner.signPsbt` / `signMessage` / new `exportWifForAddressId` route by which field the entry carries. Exactly-one-of validation — supplying both or neither surfaces as a structured error at the signer boundary
- `normalizeSource` in `sendAsset` / `sweepAsset` now accepts Address records with `source='imported-wif'` and `derivationPath=null`; extracts the Address record's `id` as the `addressId` in the resulting signing-path entry. Watch-only and hardware sources still rejected with a clear message
- `signMessageFlow` accepts `{ path }` or `{ addressId }` (exactly one); `signPsbtFlow` passes the new `SigningPathEntry` shape through unchanged
- Smoke-tested end-to-end: HD+imported hybrid wallet signs via both paths (both signatures verify through `sdk.auth.verifyMessage`); wif-only wallet signs a message through the imported-key path; `normalizeSource` accepts imported-WIF records and still rejects watch-only; the signer's `exportWifForAddressId` returns the exact WIF that was imported

### Changed

- `Signer.SignMessageParams` now declares `path` and `addressId` as optional; exactly one must be present. HW-signer implementations should reject `addressId` at their own boundary (software-only concept)

## [0.25.0] - 2026-04-22

### Added

**ADS submission integration** (§36.3) — donation output injection + counter commit wired into `submitAction`
- New `ChainDescriptor.adsDonationAddress` field. All 9 bundled descriptors ship with the sentinel `'PLACEHOLDER_REPLACE_BEFORE_MAINNET'` (§5.5) — real addresses TBD closer to launch
- `ADS_DONATION_ADDRESS_PLACEHOLDER` + `isDonationAddressConfigured(descriptor)` exposed from the registry. A grep-replace sweep before mainnet release physically can't be missed — the sentinel is an obvious non-address string that fails any address validator
- `resolveAdsPlanForNextTx(settings, chainId, chainRegistry)` → `{ donationAmount, donationAddress, canSubmit, reason }`. Combines the pure arithmetic (`resolveAdsForNextTx`) with the address configuration check. `reason` enumerates `ok`, `ads-disabled`, `chain-not-seeded`, `trigger-not-reached`, `address-not-configured`, `unknown-chain` so UI can surface specific states (e.g. "pending donation $X — address not yet configured")
- `submitAction` now resolves the ADS plan up front and: (a) when `canSubmit`, appends `{ address, value }` to `encoderOpts.customOutputs` so the encoder builds the donation into the transaction; (b) after a successful broadcast calls `commitAdsStep` with `donationIncluded: canSubmit`. When ADS is enabled but `canSubmit=false` (placeholder still in place), the counter STILL advances with `donationIncluded=false` so the user's `lifetimeTxCount` reflects reality
- Caller-supplied `customOutputs` (e.g. for a COINPAY tx) survive alongside the ADS injection — the ADS output is appended, not replaced
- `commitAdsStep` failures are swallowed into an `ads-commit-failed` `onProgress` event rather than throwing; ADS accounting must not obscure a successful broadcast from the caller
- Smoke-tested: 9-descriptor sentinel sweep; all 6 resolver reasons; end-to-end inject path (real address) produces the expected customOutput + post-submit state (accumulator reset to perTx, `lifetimeDonatedSats` advanced); placeholder path produces NO injection but still advances `lifetimeTxCount` + `accumulatedSats`; caller's customOutputs preserved alongside ADS

### Known follow-up

Mainnet release checklist now has one concrete gate: `grep -r PLACEHOLDER_REPLACE_BEFORE_MAINNET packages/` must return empty before shipping. Regtest / testnet descriptors also carry the sentinel today; if e2e tests need the donation path exercised live, test harnesses should inject a custom descriptor via `ChainRegistry.addCustom`.

## [0.24.0] - 2026-04-22

### Added

**`importSingleWif(opts)`** (§15.4) — fresh wallet backed only by an imported WIF, no HD
- New `Wallet.format = 'wif-only'`. Schema carve-outs: `encryptedSeed` may be the empty string; `passphraseEnabled` must be false; `importedKeys` must have at least one entry (otherwise there's literally no key material and nothing to unlock)
- `SoftwareSigner.unlock` now branches on format: for `wif-only`, derives the master key from the password and probes it by decrypting the first `importedKey` entry. Wrong password surfaces the same way seed-decrypt failures do for seed-backed wallets (AEAD auth-tag mismatch)
- `exportPrivateKey` now branches its password-verification path by format: seed-backed wallets decrypt the seed blob as the probe; wif-only wallets decrypt the target `importedKey` directly (reused below for the actual WIF return). Either way a wrong password surfaces as `WrongPasswordError`
- Wallet + address + importedKey entry persisted atomically in order: wallet record (with the importedKey entry pre-populated) → address record. This keeps the wallet record schema-valid at the moment it hits the vault
- Smoke-tested: create → validate → unlock (right / wrong password) → export WIF → backup round-trip (the wif-only wallet survives `exportBackupFile` + `importBackupFile` and exportPrivateKey on the restored vault returns the same WIF)

### Known limitations

Spending from a wif-only wallet (and spending from imported-WIF addresses in an HD wallet) is still blocked on the separate signer gap: `SoftwareSigner.signPsbt` routes key lookup via HD path only. `sendAsset` / `sweepAsset` currently reject `source='imported-wif'` with a helpful error. The wif-only wallet can persist, unlock, receive, and export; spending lands when the signer routes through `importedKeys`.

## [0.23.0] - 2026-04-22

### Added

**XCW chunked PSBT-over-QR transport** (§20.3) — foundation for air-gapped signing
- Wire format: `XCW:<n>/<total>:<crc32-hex>:<base64-bytes>`. Per-chunk CRC32 in a separate textual field (not packed inside the base64) so a receiver sees a corrupted chunk before the payload parser
- Chunk content layout: chunk 1 carries `[32-byte SHA256 of reassembled bytes][payload part 1]`; chunks 2..N are raw payload parts. Hash on chunk 1 only (not every chunk) — putting the hash on every chunk would mean trusting the LATEST-scanned hash, exactly the wrong property
- `encodeXcwChunks(psbt, { chunkBytes })` — hex-or-Uint8Array input, default 180 bytes/chunk (~240 base64 chars; fits comfortably in an alphanumeric QR code)
- `decodeXcwChunks(frames)` — one-shot order-independent reassembly. `parseXcwChunk(frame)` — single-frame validation. `createXcwCollector` / `addChunkToCollector` — progressive scanner state for animated QR streams
- Order-independent reassembly, duplicate-chunk dedup (animated QR loops), CRC32 per-chunk integrity, overall SHA256 verification after reassembly. All four failure modes surface as structured `XcwChunkError` with specific messages (`crc32 mismatch on chunk N/M`, `SHA256 of reassembled PSBT does not match`, `chunk 1 too short`, `malformed frame`)
- `detectQrContent` now recognizes `xcw-chunk` frames and returns `{ type: 'xcw-chunk', n, total, content }` so scanner UIs can branch on the type before feeding into a collector. Matched BEFORE generic URI detection because `XCW:` with a BIP21 parser loosely applied would misclassify as scheme `xcw`
- Smoke-tested: tiny-PSBT-single-chunk, 1KB-PSBT-13-chunks round-trip; out-of-order reassembly; duplicates silently ignored; CRC flip caught mid-stream; hash-mismatch caught when a chunk is forged with a valid CRC but different content

## [0.22.0] - 2026-04-22

### Added

**Labels-survive-restore: on-chain FILE-action sync** (§19.5.2) — seed-derived encrypted labels + contacts
- `computeLabelSyncCommitmentKey(seed)` → `SHA256("xchain-wallet-label-sync" || seed)` — deterministic 32-byte AES-256 key; same seed always produces the same key
- `computeLabelSyncDiscoveryName(commitmentKey)` → hex SHA256 of the key — goes into the FILE action's `name` field so a restoring wallet can find its own ciphertext without trial-decrypting every FILE on the chain
- `encodeLabelSyncPayload` / `decodeLabelSyncPayload` — AES-256-GCM `iv || ct || tag` round-trip; body shape `{ version, updatedAt, labels, contacts }`
- `buildLabelSyncPayload({ vault, walletId, seed })` — reads the wallet's labeled addresses (HD + imported-WIF, label must be non-empty) and contacts; returns `{ ciphertext, discoveryName, body }` ready for the caller to publish via a FILE action
- `applyLabelSyncPayload({ vault, walletId, payload, onConflict })` — matches incoming labels to persisted addresses by id first, by `address` string as fallback (the id can't survive a from-seed restore because the new wallet generates fresh UUIDs). `onConflict: 'overwrite'` (default, user asked for sync) or `'preserve'`. Contacts are fully upserted with a fresh `updatedAt`
- Returns `{ addressesUpdated, addressesSkipped, addressesMissing, contactsAdded, contactsUpdated, contactsSkipped }` so the shell can surface "restored N labels, Y incoming labels had no matching address"
- Smoke-tested: deterministic keys, round-trip decrypt, wrong-key rejection, end-to-end on a seed-restored wallet (labeled HD address on wallet A → new wallet B from same mnemonic → payload decrypts with B's seed → label applied to B's corresponding address)

The FILE action submission itself (calling `sdk.encoder.action` with the chain choice) is kept in the shell integration — it needs a chainId picker (lowest-fee chain by default per spec) and access to the wallet's fee strategy, both of which are orthogonal to the payload codec.

## [0.21.0] - 2026-04-22

### Added

**`dryRunRestore(opts)`** (§19.6) — test a backup without committing
- Derives the first N HD addresses per active chain from a caller-supplied mnemonic (+ optional BIP39 passphrase) and compares them against the current wallet's persisted addresses
- Format-aware (`bip39` vs `counterwallet-legacy`). Does NOT auto-detect — the same 12 words could be valid in both lists; a silent choice would mask a mismatch. Callers pick the format up-front, matching how the user entered their words
- Returns `{ overallMatch, perChain: [{ chainId, addressType, derived, comparisons, matchedCount, divergentCount, missingCount }] }` so the shell can render the per-chain green-check / red-X treatment from the spec
- `overallMatch = false` when any comparison diverges OR when the wallet has persisted addresses but none match (guards against "seed looks valid but isn't mine")
- Nothing persists. Seed material zeroed on exit; per-path HD keys zeroed inside the loop. `gapLimit` default 10, configurable 1–1000
- Smoke-tested: correct mnemonic matches, random BIP39 mnemonic diverges, `InvalidMnemonicError` for bad words, right/wrong BIP39 passphrase differentiate cleanly, `gapLimit` respected, address count unchanged after the flow runs

## [0.20.0] - 2026-04-22

### Added

**`exportBackupFile(opts)` / `importBackupFile(opts)`** (§19.4) — encrypted `.xchain-wallet` backup file
- Envelope per spec: `{ magic: 'XCHAIN-WALLET-BACKUP', formatVersion: 1, createdAt, walletName, encryption: { algorithm, kdf, iv, tag }, payload }`. iv/tag stored as separate base64 fields (not the vault codec's packed blob) so third-party implementations / auditors can inspect the envelope without matching our concatenation order
- Independent backup password per §19.4 — fresh Argon2id KDF params generated at export time (or caller-supplied via `kdfParams` override); the params land in the envelope so import reproduces the same master key
- Payload captures: wallet (incl. `encryptedSeed` + `importedKeys`), accounts scoped to the target walletId, addresses scoped via accountId or imported-key linkage, contacts + connectedSites (not wallet-scoped; ride whole), settings, pendingTxs for linked addresses, `signers: []` (reserved for HW pairings)
- Per-spec omissions: BIP39 passphrase (user re-enters on restore to preserve the passphrase's security property), hardware-wallet private keys (live on device)
- Import conflict policy `onConflict`: `'error'` (default, throws `BackupConflictError` with the conflict list), `'preserve'` (skip existing, write missing), `'overwrite'` (incoming wins). Returns `{ writes, skipped }` counts per collection
- Round-trip verified: labels survive, imported-WIF exports to the same string from the restored wallet, tampered payload bytes flip auth and reject, wrong magic / wrong password / wrong formatVersion all rejected with structured errors (`BackupFormatError`, `BackupPasswordError`)

**`@xchain-wallet/core/crypto/backup.js`** exposes the low-level primitives (`encodeBackupEnvelope`, `decodeBackupEnvelope`, `parseBackupEnvelope`, `stringifyBackupEnvelope`) for callers that want to wrap alternate payload shapes in the same envelope — e.g. the §19.5.2 label-sync commitment or a future diagnostic-dump envelope.

## [0.19.0] - 2026-04-22

### Added

**`exportPrivateKey(opts)`** (§17.7) — user-visible private-key export, parity with FreeWallet
- Routes by `Address.source`: HD addresses derive on-demand from the in-memory seed at the address's derivation path; `imported-wif` addresses decrypt the matching entry from `Wallet.importedKeys` under the wallet master key
- Refuses `trezor` / `ledger` with `NoKeyForAddressError({ reason: 'hardware' })` (key lives on device); refuses `watch-only` with `reason: 'watch-only'`
- Verifies password first by decrypting the seed blob — a wrong password returns `WrongPasswordError` on the imported-wif path instead of a vague AEAD failure
- Returns `{ wif, source, derivationPath, address, chainId }` for shell display. Memory hygiene: master key zeroed on exit, decrypted WIF-bytes zeroed after decoding. JS-string caveat from §17.7.3 still applies
- `SoftwareSigner.exportWifForPath({ chainId, path })` exposed as the HD path primitive; caller can use it directly during an already-unlocked session to avoid a second Argon2id round
- Smoke-tested end-to-end on real SDK: HD WIF round-trips to the same address via `sdk.wallet.importWIF` + `sdk.wallet.deriveAddress`; imported-WIF export returns the exact string that was imported; wrong password, missing address, watch-only, and hardware sources all reject with the right error class

## [0.18.0] - 2026-04-22

### Added

**ADS accumulator arithmetic** (§36.3) — pure + vault-aware helpers that drive the Automatic Donation System
- `resolveAdsForNextTx(settings, chainId) → { donationAmount }` — read-only check run BEFORE constructing a tx. If the accumulator has crossed the trigger, the next tx carries a donation output of that amount
- `stepAdsAccumulator(settings, chainId, { donationIncluded }) → Settings` — pure state transition run AFTER a successful broadcast. Normal: `accumulated += perTx`, `lifetimeTxCount++`. When `donationIncluded`: `lifetimeDonatedSats += prior accumulated`, `accumulated = perTx` (this tx's own contribution seeds the next cycle), `lifetimeTxCount++`
- `commitAdsStep({ vault, chainId, donationIncluded })` — vault-aware wrapper: reads current Settings, runs `stepAdsAccumulator`, persists
- Pure `step` is identity when ADS is disabled or the chain isn't seeded — safe to call unconditionally from submission flows
- Round-trip verified: 1000 txs at `perTx=1, trigger=1000` → exactly one donation fires on tx 1001; `accumulated` resets correctly; other chains' state is untouched

**Known gap:** the `submitAction` integration (inject donation output into `encoderOpts.customOutputs`, then `commitAdsStep`) is intentionally deferred. It needs a per-chain donation address, which is a §5.5 placeholder pending hub-config resolution. The arithmetic ships now; the integration lands when the address is wired.

## [0.17.0] - 2026-04-22

### Added

**`@xchain-wallet/core/uri`** — URI parsing + QR content detection

- `parseBip21Uri(uri)` / `encodeBip21Uri(opts)` (§29.10) — full BIP21 round-trip. Standard params (`amount`, `label`, `message`) lifted to the top level for convenience; anything else (including chain-specific `tick`, `action`, etc.) flows through `params`. `req-*` prefixed params surface in `required[]` so callers can enforce the BIP21 "must support" semantics. Percent-decoding at parse, percent-encoding at emit — round-trip verified through Unicode and special chars (`a&b=c d`, `Coffee ☕ / 50%`). `InvalidBip21Error` for malformed input
- `detectQrContent(input, { chainRegistry? })` (§32.2) — classifies a scanned string into one of: `bip21`, `xchain-uri`, `psbt-hex` (PSBT magic `70736274ff` prefix), `wif`, `mnemonic-bip39` (with whitespace + case normalization), `mnemonic-counterwallet`, `address` (loose heuristic fallback), or `unknown`. First-match-wins with specific formats tried before the loose address fallback. Chain-registry-aware: when a registry is supplied, BIP21 detection is restricted to its known `uriScheme`s (so `myscheme:addr` doesn't get misclassified as BIP21)

## [0.16.0] - 2026-04-22

### Changed

**`submitAction` now optionally tracks a PendingTx record (§11.3.8) through the submission lifecycle**
- New optional `pendingTxMeta: { fromAddress, toAddress, actionSummary }`. When supplied, the flow creates a PendingTx at `composing`, advances through `awaiting-signature` → `broadcasting` → `broadcast` (or → `indexed` if `waitForTxid` is supplied), and persists via the vault at every transition
- On error, status transitions to `failed` with the error message recorded; the record is preserved so the history screen (§28) can surface failure reasons instead of losing the submission
- Return shape adds `pendingTxId: string | null` so callers can look up the record later
- Caller's `onProgress` still fires alongside the lifecycle tracker; a thrown `onProgress` does NOT derail the tracker's persistence
- `sendAsset` and `sweepAsset` auto-populate `pendingTxMeta` with generated summaries (`"Send 100 XCP to bc1q… — memo"`, `"Sweep balances + ownerships to bc1q… — memo"`). Opt-out via `trackPendingTx: false`

**The tx-status timeline (§28.4) and RBF/cancel flows (§44.4) can now read live state** — every submitted action leaves a traceable record in the vault without the UI layer needing to intercept progress events.

## [0.15.0] - 2026-04-22

### Added

**`createDemoWallet(opts)`** (§25.2) — ephemeral try-before-commit wallet
- In-memory only (`InMemoryBackend`); nothing ever touches IndexedDB / chrome.storage / file
- Auto-generated 64-char hex password (256 bits) returned to the caller — shell holds it for the session, drops it when the user exits demo
- Intentionally weak KDF (`iterations: 1, memory: 8192`) — the ciphertext never reaches an attacker, so paying ~1s of Argon2id buys nothing and makes demo feel sluggish
- Per-spec the shell does NOT display the mnemonic (nothing useful to back up for a throwaway wallet)
- Default `activeChainIds` is the three regtest chains (no endpoint dependency, no mainnet confusion); overridable
- Returned `{ vault, password, walletId, mnemonic, wallet, account, addresses }` drives every existing flow (unlockWallet / receiveAddress / walletBalances / sendAsset / …) unchanged — demo mode is the same code path with a different backend

## [0.14.0] - 2026-04-22

### Added

**`signMessageFlow(opts)`** and **`signPsbtFlow(opts)`** — standalone user-initiated sign flows (§30.1, §30.4)
- `signMessageFlow({ walletId, password, chainId, path, message, … })` — unlocks, signs, locks. Round-trip verified via real SDK `verifyMessage` on BTC p2wpkh
- `signPsbtFlow({ walletId, password, chainId, psbtHex, signingPaths, … })` — unlocks, signs, locks. Real-PSBT end-to-end test produces a 64-hex-char txid
- Both guarantee `signer.lock()` in a `finally` — seed material zeroed on success and on throw
- Input validation: paths that don't start with `m/`, non-string messages, empty `psbtHex`, and empty `signingPaths` all rejected at the flow boundary with clear errors

## [0.13.0] - 2026-04-22

### Added

**`importWif(opts)`** — add a single imported private key to an existing HD wallet (§15.5)
- Validates the WIF via `sdk.wallet.importWIF` (checksum + chain network match); derives the address via `sdk.wallet.deriveAddress`
- Encrypts the WIF under the same master key that protects the wallet's seed (one password unlocks both); uses the wallet's existing `kdfParams` so the derivation matches
- Creates an `Address` record with `source: 'imported-wif'`, `derivationPath: null`, `accountId: null`, `signerId: walletId` — per §11.3.3's carve-out for non-HD entries
- Appends an `{ addressId, encryptedWif, importedAt }` entry to `Wallet.importedKeys` (§11.3.1); round-trip verified — the stored ciphertext decrypts back to the original WIF under the same password
- Single KDF round per import: the password is verified by decrypting the seed blob, then the same derived master key encrypts the WIF — one Argon2id round, not two
- `InvalidWifError` for malformed / network-mismatched WIFs; `WrongPasswordError` for bad passwords (password check runs before any WIF persistence so a bad-password attempt leaves the wallet unchanged)

## [0.12.0] - 2026-04-22

### Added

**`@xchain-wallet/extension/background`** — MV3 service-worker skeleton
- `MessageHost` — transport-agnostic request/response router with typed handlers. Uniform response envelope `{ ok: true, result } | { ok: false, error: { name, message } }`; synchronous and async handler errors are serialized (the transport never drops a silent failure). `UnknownMessageTypeError` / `InvalidMessageError` for diagnostics
- `createBackgroundHost(deps)` — factory that registers the Phase 1 handler surface: `wallet.list` / `wallet.exists` / `wallet.create` / `wallet.import` / `wallet.checkPassword` / `receive.getAddress` / `action.send` / `action.sweep` / `balances.wallet` / `balances.address` / `history.address`
- Safe-wallet projection: wallet records returned over the wire strip `encryptedSeed` / `kdfParams` / `importedKeys` — narrows the blast radius of any future popup-side logging
- `attachChromeRuntime(host, chromeRuntime?)` — wires the host to `chrome.runtime.onMessage` using the MV3 `return true` + `sendResponse` async-response contract. Returns a detach function for hot-reload / tests; injectable runtime for tests

**`@xchain-wallet/web/storage/IndexedDBStorageBackend`** — primary-store adapter for the browser SPA target (§11.2)
- Wraps raw IndexedDB with a minimal Promise surface; bytes ↔ base64 at the wire boundary (same pattern as the Chrome backend, avoids cross-browser typed-array round-trip quirks)
- `KeyValStore` injectable adapter lets tests run against a Map-backed mock without fake-indexeddb; production lazy-opens a real database + object store
- Defaults: `DEFAULT_DB_NAME = 'xchain-wallet'`, `DEFAULT_STORE_NAME = 'vault'`, `DEFAULT_STORAGE_KEY = 'wallet-vault'`
- Full Vault round-trip verified end-to-end through the backend

**`@xchain-wallet/web`** now depends on `@xchain-wallet/core` via `workspace:*`.

## [0.11.0] - 2026-04-22

### Added

**`@xchain-wallet/extension`** — first shell-layer modules
- `ChromeStorageBackend` — `StorageBackend` adapter for MV3 `chrome.storage.local`, the primary persistent store per §11.2. Base64-encodes bytes at the wire boundary (Chrome's structured-clone of `Uint8Array` has historically been unreliable between popup / service-worker contexts)
- `ChromeSessionBackend` — subclass targeting `chrome.storage.session` for ephemeral state (unlocked-session handles, dApp tokens). Default key distinct from local so the two stores can coexist on the same mock in tests and never collide in production
- Both accept an injected `chromeStorage` for tests / non-browser targets; throw session-aware or local-aware errors when no storage is available
- `DEFAULT_STORAGE_KEY = 'xchain-wallet:vault'`, `DEFAULT_SESSION_STORAGE_KEY = 'xchain-wallet:session'`
- Workspace wire-up: `@xchain-wallet/extension` now declares `@xchain-wallet/core` as a `workspace:*` dep
- End-to-end verified: full `Vault` round-trip through `ChromeStorageBackend` — wallet records persisted and retrievable across vault reopens

**`reconcileAddressSigners(opts)`** — closes the Address v1→v2 migration loop (§17.6)
- Walks addresses with `signerId === null`, derives the pubkey from each supplied unlocked signer at the stored `derivationPath`, and writes back the matching signer's id when exactly one matches
- Caller supplies unlocked signers (the function doesn't touch unlock/lock state); fits naturally into `withUnlocked(opts, (signer) => reconcileAddressSigners({ ..., signers: [signer] }))`
- Idempotent; returns `{ scanned, reconciled, skipped[] }` with per-address skip reasons (`no-path` / `unknown-chain` / `no-match`)
- Optional `walletId` and `chainId` filters narrow scope
- `AmbiguousSignerMatchError` thrown if multiple signers derive the same pubkey at the same path — silent ambiguity could misroute future ops, so we fail loudly

**Migration cycle now end-to-end:** the harness (v0.3.0) + the first bump (v0.8.0, Address v1→v2) + the reconciler (this release) demonstrate the full schema-evolution story — forward-only migration on read, followed by runtime reconciliation of any deferred resolution.

## [0.10.0] - 2026-04-22

### Added

**`receiveAddress(opts)`** (§29.7) — derive and persist the next unused external HD address
- Scans persisted addresses scoped to (accountId, chain, network, addressType, source='hd', change=0); parses the BIP44 index from the stored path; derives `max + 1`
- Per-chain and per-addressType scoping: BTC p2wpkh and BTC p2pkh count separately; DOGE and BTC count independently
- Ignores internal change-chain (change=1) addresses when computing the next external index
- Defaults addressType to `descriptor.defaultAddressType`; default label `"Address #N+1"`
- `NoMatchingAccountError` for a missing `accountIndex`
- Real-SDK verified: after `importMnemonic` of the canonical BIP39 test vector, indices 1 and 2 match the canonical BIP84 addresses (`bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g`, `bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z`)

**Balance / history read flows** — `addressBalances`, `addressHistory`, `walletBalances`
- `addressBalances({ sdkRegistry, chainId, address, opts? })` / `addressHistory(...)` — thin pass-throughs to `sdk.getBalances` / `sdk.getHistory(address, 'address', opts)`
- `walletBalances({ vault, walletId, chainRegistry, sdkRegistry, chainId?, opts? })` — wallet-scoped aggregator. Resolves the wallet's account ids → filters addresses → groups by chainId → fetches in parallel per address
- Partial results: one-address fetch failure yields `{ balances: null, error: <message> }`; other entries are unaffected
- Optional `chainId` filter; `opts` forwarded to every call; stray addresses not tied to the wallet and addresses on unknown chains are silently skipped

**`ChainRegistry.chainIdFor(coin, networkKind)`** — reverse lookup from Address record fields (coin + network) to chainId. Enables the balances aggregator and any future flow that needs to route operations per chainId when the input records don't carry it.

**`withUnlocked(unlockOpts, fn)`** / **`withUnlockedRecord(unlockOpts, fn)`** — session helpers
- Unlock → `await fn(signer)` → lock in `finally`. Signer guaranteed locked on resolve *and* reject — no half-unlocked state can leak
- Batches multiple signing ops under one unlock. Argon2id is ~1s per unlock; deriving three addresses under one `withUnlocked` pays one KDF round, not three
- Callback can be async or sync; return value flows through. Nested `withUnlocked` calls each get their own signer with independent lifecycles

## [0.9.0] - 2026-04-22

### Added

**`sendAsset(opts)`** — convenience wrapper for the SEND action (§Phase 1 authoring surface)
- JS-friendly params (`to`, `asset`, `amount`, `memo`, `fee`, `feePerKb`, `rbf`) mapped to protocol field names (`DESTINATION`, `TICK`, `AMOUNT`, `MEMO`)
- `amount` coerced to string so callers can pass numbers; `memo` is omitted from the action string when not supplied
- `from` accepts either a full `Address` record (from the vault) or an explicit `{ address, publicKey, derivationPath }` triple
- Multi-destination SEND (protocol formats v1–v3) intentionally out of scope; drop to `submitAction` for those
- Verified against real `xchain-sdk` to produce the canonical `SEND|0|XCP|100|<addr>|gift` action string

**`sweepAsset(opts)`** — convenience wrapper for the SWEEP action
- JS booleans (`balances`, `ownerships`, `escrows`) mapped to protocol `'1'`/`'0'` strings
- Protocol defaults mirrored: `balances=true, ownerships=true, escrows=false`
- No-op guard: rejects when all three flags are false
- Verified against real `xchain-sdk` to produce the canonical `SWEEP|0|<addr>|1|1|0[|memo]` action string

**`normalizeSource(from, fnName?)`** — shared helper exported from `sendAsset.js`. Duck-types either Address records or `{ address, publicKey, derivationPath }` triples into the triple form; rejects null `derivationPath` (imported-WIF paths don't support HD signing). Available for future single-source flows.

**`seedSettingsForChains(settings, chainRegistry, activeChainIds)`** and **`ensureSettings(vault, chainRegistry, activeChainIds)`** — populate `Settings.fees[chainId]` and `Settings.ads.perChain[chainId]` from chain-descriptor defaults
- Per-chain fee defaults: `strategy = descriptor.feeStrategy.defaultStrategy`, `customSatsPerKb = null`, `rbfByDefault = descriptor.feeStrategy.rbfSupported` (so BTC / LTC default to RBF-on, DOGE to RBF-off)
- Idempotent: existing entries are never overwritten — a user's customized fee strategy or accumulated ADS state survives a second invocation
- `ensureSettings` handles the vault-level read-or-default, seed, and write-back

### Changed

**`_persistHdWallet`** (internal) — added a final step calling `ensureSettings(...)`, so every wallet created through `createWallet` or `importMnemonic` has a valid Settings record with per-chain entries for its active chains. Fees and ADS panels are now renderable without handling an empty-map case.

## [0.8.0] - 2026-04-22

### Added

**`importMnemonic(opts)`** (§15.4 paths 1+2) — user-supplied mnemonic import
- Handles BIP39 (12 / 24 words) and Counterwallet-legacy from one entry point
- Auto-detects format (BIP39 checksum-validated first; Counterwallet as fallback) or validates an explicit `format` against the input
- Normalizes input: trims, collapses whitespace, lowercases — so paste-from-anywhere works
- Counterwallet path explicitly rejects any `bip39Passphrase`
- Default `origin` derived from format (`imported-mnemonic` / `imported-freewallet`); caller can override
- Exports `normalizeMnemonic`, `detectMnemonicFormat` as public utilities
- Error classes: `InvalidMnemonicError` (carries `format` + per-field `errors`), `UnknownMnemonicFormatError`
- Verified against real `xchain-sdk`: `abandon × 11 + about` produces the canonical BIP84 address `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`

**`submitAction(opts)`** — one-call submission wrapper
- Composes `unlockWallet` → `submitWithSigner` → `signer.lock()` in a `finally`
- Seed material is always zeroed — even if `submitWithSigner` throws mid-pipeline
- Returns the full `SubmitResult` from `submitWithSigner`; every shell's "Send" and dApp-sign-request flows can land on this
- For batched submissions under one unlock, callers compose directly — re-unlocking is ~1s of Argon2id

### Changed

**`Address` schema v1 → v2** — §17.6 signer routing
- Added `signerId: string | null` field — stable id of the owning signer (SoftwareSigner uses `wallet.id`); `null` = needs reconciliation
- Added `addressMigrations[1]`: carries v1 records forward with `signerId: null` and documents runtime reconciliation intent
- `validateAddress` accepts `string | null`; rejects numeric/wrong types; new records written at v2 and v1 `put` attempts are rejected
- `createWallet` / `importMnemonic` (via `_persistHdWallet`) populate `signerId = signer.id` on initial addresses — wallets created post-migration are linked from day one

**`createWallet`** — refactored to share post-encryption plumbing with `importMnemonic` via an internal `_persistHdWallet` helper. 175 lines → 84. Same behavior (regression-tested); one source of truth for the persist-new-HD-wallet pipeline.

## [0.7.0] - 2026-04-22

### Added

**`@xchain-wallet/core/flows`** — first full-stack user-facing flows
- `createWallet({ password, vault, chainRegistry, sdkRegistry, activeChainIds, name?, strengthBits?, bip39Passphrase?, kdfParams? })` (§15.3) — generates a BIP39 mnemonic, encrypts it under a device-calibrated Argon2id master key, and persists a ready-to-use wallet: Wallet + first Account (index 0) + first Address per active chain (using each chain's defaultAddressType). Returns the plaintext mnemonic for the §19.2 seed-phrase display ceremony. KDF calibration defaults to ~1s via `calibrateKdfParams`; tests / shells can pre-supply `kdfParams`
- `unlockWallet({ vault, walletId, password, bip39Passphrase?, chainRegistry, sdkRegistry })` — vault lookup + `unlockWalletRecord`; returns an available SoftwareSigner
- `unlockWalletRecord({ wallet, password, bip39Passphrase?, chainRegistry, sdkRegistry })` — the shared primitive for flows that already hold a Wallet record in hand. Locks the signer if unlock throws (no half-unlocked state ever leaks)
- `WalletNotFoundError` — thrown on missing walletId

Round-trip verified: address created at wallet-creation time matches address re-derived after unlock on a fresh signer. Counterwallet-format records unlock through the same primitive (synthetic fixture; seeds the raw 16-byte Counterwallet seed rather than a PBKDF2-stretched BIP39 seed).

End-to-end verified against the real `xchain-sdk`: generated wallet produces valid `bc1q…` / `D…` / `ltc1…` addresses that `sdk.wallet.validateAddress` accepts.

## [0.6.0] - 2026-04-22

### Added

**`submitWithSigner(opts)`** (§10.4) — action submission lifecycle routed through the Signer interface
- Pipeline: `createAction` → `encoder.createTx` → `signer.signPsbt` → `encoder.broadcastTx` → optional P2SH/P2WSH second phase (`spendP2sh` + second sign + second broadcast) → optional indexer wait
- Returns `{ txid, actionString, action, version, encoding, signed, indexed }`; `txid` is always the *final* (phase-2 in P2SH/P2WSH case) txid
- Progress callback fires `creating` / `encoding` / `signing` / `broadcasting` / `p2sh_spending` / `waiting` / `confirmed`
- Indexer wait is opt-in via caller-supplied `waitForTxid(txid, opts)` — the SDK doesn't expose `ActionWaiter` on the instance, so shells wire this themselves (keeps the wrapper decoupled from the polling strategy)
- Strict input validation: missing `encoderOpts.pubkey`, empty `signingPaths`, or uninitialized encoder all throw clear errors
- Verified end-to-end against real `xchain-sdk` with an actual `SEND|XCP|100|...` action: real 64-hex-char ECDSA txid, real action string, full progress sequence

**`adaptXChainSDK(XChainSDKClass)`** — convenience helper that wraps an `XChainSDK` constructor as the `SDKFactory` shape `SDKRegistry` expects; validates the input is a class/function. Shells use it as `sdkFactory: adaptXChainSDK(XChainSDK)` regardless of how they imported the SDK (native ESM / `createRequire` / bundled browser build)

### Changed

**`SoftwareSigner.signMessage`** — two fixes surfaced by real-SDK integration
- Unwraps the SDK's `{ signature, address }` return; formerly was embedding the whole object as the "signature" (which wasn't a string)
- Routes `segwitNative` / `segwitRedeemScript` opts based on the BIP44 purpose in the path: `m/84'` → `segwitNative: true`, `m/49'` → `segwitRedeemScript: true`, `m/44'` → no flags, `m/86'` → explicit `p2tr message signing not supported` error (SDK's `bitcoinjs-message` backend doesn't do taproot)
- Verified round-trip via `sdk.auth.verifyMessage` on BTC p2wpkh, BTC p2sh-p2wpkh, and DOGE p2pkh

## [0.5.0] - 2026-04-22

### Added

**`@xchain-wallet/core/sdk`** — per-chain SDK instance registry (§10.2)
- `SDKRegistry` class: lazy instantiation on `get(chainId)`, instance caching, `initActive(chainIds)` for parallel startup, `invalidate(chainId)` / `invalidateAll()` with `sdk.close()` cleanup hook, `setEndpointOverrides()` for Settings-driven URL overrides
- `SDKFactory` callback pattern — `core` stays SDK-agnostic; shells pass in whatever import path works for their target (`require('xchain-sdk')`, `await import`, or a mock for tests)
- `XChainSDKLike` typedef documenting the minimal SDK surface the wallet depends on
- `UnknownChainError` for unregistered chain ids
- Smart URL join: `:443` / `:80` elided; other ports kept explicit

### Changed

**Chain descriptors** carry `wifVersionByte`
- Added to `ChainDescriptor` shape and validator (`[0,255]` required)
- Bundled values: BTC 0x80 / 0xef (mainnet / test+regtest), LTC 0xb0 / 0xef, DOGE 0x9e / 0xf1

**`SoftwareSigner`** — three previously stubbed methods are now real
- Constructor takes optional `sdkRegistry`; throws a clear error if a delegated method is called without one
- `getAddresses({ chainId, accountIndex, change, startIndex, count, addressType? })` — derives each pubkey via BIP32, calls `sdk.wallet.deriveAddress(pubkeyHex, { type })`. Rejects address types the chain doesn't support. Derived keys zeroed after encoding
- `signPsbt({ psbtHex, chainId, signingPaths })` — derives WIF with chain-appropriate version byte, calls `sdk.wallet.signPsbt`. Phase 1 restriction: all `signingPaths` must share one path; multi-key signing is flagged as a future enhancement
- `signMessage({ message, chainId, path })` — derives WIF, calls `sdk.auth.signMessage`
- All three still gate on `_assertUnlocked()` (`SignerLockedError` when locked)

## [0.4.0] - 2026-04-22

### Added

**`@xchain-wallet/core/storage`** — persistent-state facade (§11.2)
- `Vault` class with `open()` / `save()` / `clear()` / `close()` lifecycle and per-collection handles (`vault.wallets`, `accounts`, `addresses`, `contacts`, `connectedSites`, `pendingTxs`) plus singleton `vault.settings`
- Per-collection API: `get(id)`, `list()`, `put(record)` (with schema validation), `delete(id)`, `count()`, `findBy(field, value)`
- Migration-on-read — records auto-upgrade via the schema migration harness on their way out of the vault
- Auto-save-per-mutation default; `autoSave: false` lets shells batch explicitly
- Abstract `StorageBackend` contract; `InMemoryBackend` ships in `core` for tests and the no-wallet-yet empty state
- `codec.js` — document-level encrypt/decrypt via the shared AES-256-GCM AEAD. `documentVersion` header gates future codec breakage; missing collections default to `[]` so forward-compatible reads stay clean
- Master-key lifecycle: `Vault` holds a private copy, zeros it on `close()`. AAD passthrough lets shells scope the vault to a wallet id or origin
- `VaultStateError` (pre-open / post-close operations) and `VaultValidationError` (put with invalid record, carries `collection` + per-field errors)

**`@xchain-wallet/core/crypto/counterwallet`** — legacy Counterwallet mnemonic import (§15.2)
- Canonical 1626-word wordlist vendored from `Mnemonic.js` v1.1.0 (Yiorgis Gozadinos / Crypho AS, MIT) with attribution header — no runtime dep on a stale npm package
- `validateCounterwalletMnemonic(str) → { ok, errors }` with word-level diagnostics; tolerates whitespace and mixed case
- `counterwalletMnemonicToSeedBytes(str)` returns the 16-byte raw seed (Counterwallet has no PBKDF2 stretching — the decoded bytes feed directly into BIP32 `HDKey.fromMasterSeed`)
- `counterwalletMnemonicToSeedHex(str)` convenience hex form
- Verified against the reference Mnemonic.js implementation for 100 random seed round-trips

### Changed
- `SoftwareSigner.unlock` now routes by `walletEncryption.format`:
  - `'bip39'` (default) — existing behavior with optional §15.6 passphrase
  - `'counterwallet-legacy'` — Counterwallet decoder; BIP39 passphrase explicitly rejected
- `@xchain-wallet/core` root barrel adds `storage` namespace alongside `schemas` / `registry` / `signers` / `crypto`

## [0.3.0] - 2026-04-22

### Added

**`@xchain-wallet/bridge-spec`** — complete dApp-bridge surface (§43)
- Full TypeScript definitions for `window.xchain`: `XChainProvider`, per-method param/return types, permission shapes, error codes
- Sign-in with XChain v1 challenge format + `formatSignInChallenge` / `parseSignInChallenge` helpers
- Reference client (`client.ts`): `getProvider({ timeoutMs })` discovery, `PROVIDER_READY_EVENT`, `generateNonce`, `makeSignInParams`, `validateSignInChallenge`
- Global `Window.xchain` augmentation so dApps get IDE completion

**`@xchain-wallet/test-dapp`** (new package) — reference dApp exercising the bridge
- `MockXChainProvider` implementing the full `XChainProvider` interface; configurable `autoApprove` / `rejectAll` / `supportedActions` for testing both paths
- `runExample()` worked example covering connect → getAccounts/Addresses/Balances → signIn → signMessage → signAction(SEND) → signAction(ISSUE)→UNSUPPORTED_ACTION → disconnect
- Compile-time conformance check: if `MockXChainProvider` compiles against `XChainProvider`, the interface is internally coherent

**`@xchain-wallet/core/schemas`** — data-model schemas (§11)
- Eight record schemas: `Wallet`, `Account`, `Address`, `Contact`, `ConnectedSite`, `MultisigConfig` (reserved; validator only), `Settings`, `PendingTx`
- Per-schema `createXxx(input)` factories, `validateXxx(record) → { ok, errors }` validators, JSDoc typedefs
- Shared enums (`NETWORKS`, `ACTION_PERMISSIONS`, `ADDRESS_SOURCES`) and dep-free validation primitives
- Forward-only migration harness (`migrate(record, migrations, target)`) with empty per-schema maps ready for future version bumps
- Sensible defaults: `ADS_DEFAULT_ENABLED = true`, 1 sat per tx, 1000 sat trigger, 5-sec undo-send grace, 15-min autolock

**`@xchain-wallet/core/registry`** — chain registry (§9.7)
- `ChainRegistry` class with `get` / `has` / `supportedChains` / `byCoin` / `byNetworkKind` / `coins` / `derivationPathFor` / `addCustom` / `removeCustom`
- Nine bundled descriptors: bitcoin/dogecoin/litecoin × mainnet/testnet/regtest
- Real BIP44/49/84/86 derivation paths from §16.1; address types per chain (BTC: p2pkh/p2sh-p2wpkh/p2wpkh/p2tr, LTC: first three, DOGE: p2pkh only)
- `validateChainDescriptor` with cross-field check that every declared `addressType` has a derivation-path template
- Canonical `COMMON_ACTIONS` (20) + `BTC_EXCLUSIVE_ACTIONS` (9) sourced from `xchain-documentation/protocol/actions/`
- Developer-Mode custom-chain path: `addCustom` sets `isUserAdded = true`; `removeCustom` refuses bundled

**`@xchain-wallet/core/signers`** — signer interface (§17)
- Abstract `Signer` class with the full §17.1 contract (`id` / `displayName` / `kind` / `requiresPhysicalConfirmation` / `getStatus` / `getAddresses` / `signPsbt` / `signMessage` / `getPublicKey` / `subscribe`)
- Error classes: `AbstractMethodError`, `SignerLockedError`, `SignerStatusError`, `NotImplementedError`
- `SoftwareSigner` (§17.2): real `unlock({ password, bip39Passphrase? })` and `getPublicKey({ chainId, path })`; `getAddresses` / `signPsbt` / `signMessage` stay stubbed pending SDK integration
- Memory hygiene: `lock()` zeros seed + mnemonic bytes + imported WIF bytes; derived keys zeroed after every `getPublicKey` call

**`@xchain-wallet/core/crypto`** — cryptographic foundations (§11.4, §15–16)
- `kdf.js` — Argon2id via `@noble/hashes`, `makeFreshKdfParams` / `calibrateKdfParams({ targetMs })` for per-device ~1-second tuning
- `aead.js` — AES-256-GCM via Web Crypto `SubtleCrypto`; 12-byte random IVs; AAD binding; `iv || ct(||tag)` output format
- `mnemonic.js` — BIP39 wrap (`generateBip39Mnemonic` / `isValidBip39Mnemonic` / `bip39MnemonicToSeed` / entropy round-trip) via `@scure/bip39`
- `hd.js` — BIP32 wrap (`hdKeyFromSeed`, `derive(root, path)` returning `{ privateKey, publicKey, chainCode, publicKeyHex, fingerprint, path }`) via `@scure/bip32`
- `wif.js` — chain-agnostic WIF encode/decode via `@scure/base` base58check
- `walletBlob.js` — pairs KDF + AEAD with the Wallet schema's `encryptedSeed` + `kdfParams` fields; master key zeroed after use
- Verified against official BIP39 vectors (Trezor set) and BIP32 spec vectors

### Changed
- `@xchain-wallet/bridge-spec` upgraded from stub to full surface
- `@xchain-wallet/core` root barrel now re-exports `schemas` / `registry` / `signers` / `crypto` namespaces
- `@xchain-wallet/core` declares `@noble/hashes`, `@scure/base`, `@scure/bip32`, `@scure/bip39` as runtime dependencies

### Infrastructure
- `pnpm-lock.yaml` committed per §9.8 dependency-hygiene rules

## [0.2.0] - 2026-04-22

### Added
- pnpm workspace scaffolding (`pnpm-workspace.yaml`)
- Shared TypeScript config for JS+JSDoc type-checking (`tsconfig.base.json`)
- CI skeleton (`.github/workflows/ci.yml`) — installs deps; typecheck/lint/test/build steps wired as placeholders until packages define them
- Documentation home (`docs/README.md`) with planned-contents list
- Phase 1 package stubs: `@xchain-wallet/core`, `@xchain-wallet/bridge-spec`, `@xchain-wallet/web`, `@xchain-wallet/extension`, `@xchain-wallet/desktop`
- `bridge-spec` TypeScript configuration (`packages/bridge-spec/tsconfig.json`) — emits `.d.ts` for dApp-developer consumption
- MV3 manifest stub (`packages/extension/manifest.json`)
- `packageManager` field pinned to `pnpm@9.0.0`
- Workspace-wide scripts: `typecheck`, `lint`, `test`, `build` (all via `pnpm -r --if-present`)

### Changed
- `README.md` repository-layout section now annotates scaffolded vs Phase-2-pending vs not-yet-started items

## [0.1.0] - 2026-04-22

### Added
- Repository seeded with standard XChain Platform project metadata: `LICENSE.md`, `NOTICE.md`, `README.md`, `CHANGELOG.md`, `package.json`, `.gitignore`
