# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
