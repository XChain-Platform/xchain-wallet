# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Agent-account management UI (§22 P4): provision wizard, policy editor, and account list/detail with an enable/disable toggle, wired across all three shells (Bitcoin only at launch).

### Fixed
- Align `signers-ledger` `@noble/hashes` to `^1.8.0` (was `^1.5.0`); `LedgerSigner` imports from `@noble/hashes/sha2`, a path only present in >=1.7, so the old range was a latent breakage on an isolated install.

## [0.333.0] - 2026-06-20

### Security

- **Web shell no longer caches the wallet password in `sessionStorage`.**
- **SIWX challenge now binds the wallet-stamped page origin (v2 wire format, breaking).**
- Force transitive dependency `tar` to `>=7.5.7` (resolves to 7.5.15) via a `pnpm.overrides` pin to clear the high-severity hardlink path-traversal advisory (GHSA-34x7-hfp2-rc4v).
- Bump transitive dependency `tmp` from 0.2.5 to 0.2.7 to clear the path-traversal advisory (GHSA-ph9p-34f9-6g65).

### Added

- **Periodic chain-registry refresh** (§9.7 / G007).

### Changed

- **Plain-language transaction terminology.**

### Fixed

- **Hardware-signer status poll never slowed to steady state.**
- **Native-fee JSDoc typedef surface.**
- **`SubmitEncoderOpts.rawData` JSDoc type.**
- **P2SH/P2WSH phase-2 spend on the online-signing path.**
- **P2SH/P2WSH phase-2 reveal-script derivation on the online-signing path.**

Active-network mode + native-coin price oracle + TokenDetail visual
fixes + IndexedDB-delete hotfix. The marquee shift is the §2-principle
update from "chain-explicit by default" to a single active-network
filter: pick Mainnet / Testnet / Regtest in Settings, and the wallet
shows + queries only that network's chains across every surface.

### Active network (§2 / §26 principle update)

- `settings.activeNetwork` (v2-tolerant, default `'mainnet'`) governs which chains are visible AND queried.
- `flows/effectiveNetwork.js` ships `getActiveNetwork(settings)`, `isChainOnActiveNetwork(chainId, settings, registry)`, and `filterChainIdsByActiveNetwork(chainIds, settings, registry)`.
- Server-side chokepoints enforce the filter so the UI doesn't have to re-implement it 14 times: `balances.wallet` host handler reads `settings.activeNetwork` and threads it into `walletBalances` (skips the per-chain SDK fan-out for non-matching chains); `addresses.byChain` host handler filters the returned map, which covers Home / History / AddressList / Send / every action form's chain picker without any client edit.
- `useReachability` filters `chainIds` before probing, the 30-second poll no longer hits testnet endpoints when the user is on mainnet.
- `bridge.getActiveChains` filters its result so dApps only see chains the wallet will actually sign on.
- `createWallet` / `importMnemonic` infer `activeNetwork` from the first chain in `activeChainIds` (explicit override wins).
- `ensureSettings({ activeNetwork })` honors the hint only when no settings record exists yet, so activating an additional chain via Developer Mode on an already-configured wallet doesn't silently switch network mode.

### Settings → Network

- New `NetworkSection.jsx` under Settings → Network, radio picker between Mainnet / Testnet / Regtest with per-option hint copy.
- `networkSummary(settings)` returned in the Settings list row so the current network is visible without drilling in.

### Native-coin price oracle (§45 / privacy-cost opt-in)

- `flows/priceOracle.js` ships `createPriceOracle({fetch})` → `getNativePrices({chainIds, fiatCurrency, includeSparkline})`.
- In-memory cache only, 5 min for spot, 1 hour for sparkline.
- Host registers `prices.native` route that gates on `settings.privacy.priceDataEnabled` (v2-tolerant, default `true`).
- New `useNativePrice(chainId, {includeSparkline})` hook for the UI layer; surfaces `{entry, loading, disabled, error}`.
- Settings → Privacy gains a "Native coin price data" toggle with copy that explicitly names `api.coingecko.com` and what the request reveals.
- Three shells (extension popup, web, desktop) gain `getNativePricesRequest(opts)` messaging shim.

### TokenDetail visual fixes

- Native coin (BTC/LTC/DOGE) detail page swaps the colored-letter iconLetter disc for the actual chain logo (`branding.chainIconLargeUrl(chainId)`), matching what the Home BalanceList row uses.
- Metadata block converted from a stacked `<dl>` grid to a proper two-column `<table>`: label left in muted small-caps, value right- aligned, hairline divider per row.
- `ChainBadge` gains a `showNetworkKind` prop (was already being passed by TokenDetail; this commit honors it).

### IndexedDB delete race (v0.332.0 hotfix)

- `IndexedDBStorageBackend` now sets `db.onversionchange = () => db.close()` on the open IDB.

## [0.332.0] - 2026-05-21

Locked-screen rescue path extended from demo-only to real wallets
(Cluster O FU 4). Closes the §26 forgot-password gap: a user who's
lost their password and doesn't have a seed phrase or encrypted
backup handy now has an in-app escape instead of being stuck on the
"Incorrect password" screen with no exit short of opening DevTools.

### Locked screen

- `Locked.jsx` renders a subtle "Forgot password?" text button below the unlock + biometric buttons when no demo wallet exists (the demo path's existing "Wipe wallet data & start over" affordance takes precedence when applicable, the two are mutually exclusive branches of one ternary).
- Click expands an inline confirmation panel: danger-tinted warning copy leading with "Without your recovery phrase or encrypted backup file, wiping this wallet will permanently lose access to any funds it holds", a clarifying line that wiping only affects this device (the wallet on the blockchain is untouched), a type-WIPE-to-confirm text input as a deliberate-action gate, a danger-variant Wipe button (disabled until the confirmation text matches), and a Cancel button that resets the panel.
- Wipe reuses the existing `deleteWalletDatabase()` helper, same IDB `xchain-wallet` + localStorage `xchain-wallet:vault-meta` cleanup the demo-exit path uses.
- Available during lockout: being locked out for 15 minutes is exactly when this escape matters most, so the affordance is not gated on `isLockedOut`.
- A11y: disclosure button carries `aria-expanded` / `aria-controls`; expanded panel is a `role="region"` with `aria-label`; wipe-error surfaces via `role="alert"`.

## [0.331.0] - 2026-05-01

Demo-mode + small-variant chrome polish session. Bundles theme-token
fixes, the Tokens-vs-NFTs split, a richer demo fixture set across all
three regtest chains, and a handful of variant-system fixes that were
hiding under viewport-keyed media queries.

### Theme + chrome

- `tokens.css` defines `--xc-danger-bg` / `--xc-danger-text` / `--xc-warning-bg` / `--xc-warning-text` for both light and dark.
- `ReachabilityBanner` mounts inside `FullLayoutWithNav.header` (gated to non-demo wallets) instead of at the App root, so it's suppressed in onboarding / locked / demo states.
- `DemoBanner` now returns `null` everywhere; the visible banner moves to a per-wallet "Status" row + danger-styled "Exit demo & wipe" button on `WalletDetails` (gated by `isDemoWallet`).

### Onboarding license gate

- Logo added to the gate, headline + tagline removed, license box flex-grows inside a column-flex `.licenseGate` so checkbox + Accept CTA stay pinned at the bottom regardless of viewport.
- Two paragraphs flagged as "critical" render with a danger-tinted callout: irreversibility + the seed-phrase responsibility (rewritten to lead with "never leaves this device, not uploaded, not stored on any server").
- Body text justified with `hyphens: manual` (no auto-hyphenation), checkbox left-aligned in the column, `--xc-space-3` margin gap between the ack row and the CTA collapsed to a single space-2.

### Variant system

- Fourth variant `extension` (Chrome popup, 360×600 fixed frame, no bottom tab bar, drawer-only navigation) added alongside small / full / sidebar.
- `DevVariantBadge` swaps the cycle button for a `<select>` picker (auto / small / full / sidebar / extension) and gains a draggable grip whose position persists in `localStorage` (eager-write per pointermove so the saved value never trails the actual position).
- `LeftNav` and `BottomTabBar` visibility gated on the JS variant prop instead of `@media` viewport queries, pinning small at a wide window now correctly hides the sidebar and shows the bottom tab bar.
- `BottomTabBar.bar` switched from `position: fixed` (anchored to the viewport, rendered outside the framed dev preview) to `position: absolute` (anchored to `FullLayoutWithNav.layout`, which is now `position: relative`).

### Tokens / NFTs split

- Tokens tab filter dropped the `divisibility > 0` clause; it now shows every non-native asset as the canonical "what do I hold?" surface.
- NFTs tab filters by non-empty `imageUrl` instead of `divisibility === 0`.
- `BalanceList.buildBalanceRows` + `mkRow` thread `imageUrl` from the asset record onto the row so the filter has something to read.
- NFT grid switched to `repeat(auto-fill, minmax(100px, 1fr))`: three cards fit in the small frame, more in wider frames, no viewport-keyed media queries.

### Demo fixtures

- LTC and DOGE regtest chains gain token + NFT entries (LITECRED, MWEB, LTCDOGE, LITEORD, MIMBLEPUNK on LTC; DOGI, WOW, DSHIB, BARK, DOGINAL, MEMECARD on DOGE).
- Native and asset balances bumped to demo-friendly amounts (BTC 100, LTC 1000, DOGE 10000) and seeded with `fiatRate` so the Total Balance hero rolls up a non-zero amount and per-row fiat populates.
- Indivisible NFTs (and PEPECASH) carry inline SVG `imageUrl` data-URIs so the new `imageUrl`-based NFTs filter actually has tiles to show in demo mode.
- `DemoActivityList` and `DemoDefiList` render in HomeTabs when `isDemoWallet(walletId)` returns true, replacing the static `<Placeholder>` for those tabs.
- `synthesizeDemoDefiPositions` returns 9 positions across all three chains.
- `synthesizeDemoHistory` expanded from 2 entries to 6 per chain.
- `Onboarding.handleEnterDemo` falls back to `messaging.listWallets` when `importMnemonic` doesn't return a recognizable walletId, so the demo marker writes reliably across shells.
- `Home` skips `useAutoLock` when the active wallet is the demo wallet, the random demo password is not human-recoverable, so auto-locking strands the user behind the nuclear "wipe wallet data" escape on Locked.

### Locked-screen demo escape

- `Locked` renders a "demo wallet, password is randomly generated and not recoverable" notice + danger-styled "Wipe wallet data & start over" button when `getDemoWalletId()` is non-null.
- The escape path tries `messaging.removeWallet` first, then falls back to `indexedDB.deleteDatabase('xchain-wallet')` AND `localStorage.removeItem('xchain-wallet:vault-meta')` (both stores hold "a wallet exists" state) so the bridge-level `wallet.import: a wallet already exists` check passes after reload.

### Display / row polish

- `BalanceList` row icons bumped 36 → 48 px; chain overlay 16 → 20 px.
- `HomeTabs` activity / defi disc icons bumped to match (48 px disc, 24 px inner SVG, 20 px chain overlay).
- `formatAmount` no longer strips trailing zeros, full divisibility (e.g.
- Network env suffix (regtest / testnet) dropped from `BalanceList` row subtitle and the activity row meta line, env is chosen globally in Settings, repeating it per-row was noise.
- `StalenessLabel` moved into `TotalBalanceHero`'s footer row, right-aligned with the "X assets not priced" hint.

### Pin / Hide affordances opt-in

- New `showPinAffordance` and `showHideAffordance` boolean settings, v2-tolerant, default `false`.
- Settings → Display gains two `ToggleRow`s at the top to flip them.
- `Home` only passes `onTogglePin` / `onToggleHide` to `HomeTabs` when the corresponding setting is on, `BalanceList` already treats undefined callbacks as "hide the affordance," so rows are clean by default.

### Bug fixes

- `Send` mounted with `ReferenceError: Cannot access 'previewBalances' before initialization` because `sourceBalance` and `onMax` were declared above their dependencies.
- `@xchain-wallet/core` package `exports` map now declares `./flows` and `./flows/*`.
- `.gitignore` adds `/test/e2e/node_modules` so Playwright's local install stays untracked.

## [0.330.0] - 2026-04-30

### Cluster P FOLLOWUP 2, Drop-zone wiring on remaining file-input forms

§37 / Cluster P FOLLOWUP 2, `<AirdropForm>` is the last surface with an
`<input type="file">` to gain `useDropZone` plumbing. The hook is wired
against the recipients label so the textarea + its hidden-input picker
share a single drop target; on drop the same `airdropLib.parseCsv` runs
that the click-to-pick lane uses, and `pasteText` is filled with the
extracted addresses. Placeholder copy flips to "Drop the CSV / TXT file
here" while a drag is in flight. The existing click-to-pick path (the
native `<input>` underneath) keeps working as the primary affordance,
drop is purely additive. `actions/airdrop-form.smoke.js` extends to
pin the import, the accept list, the airdropLib.parseCsv hand-off, the
rootProps spread, and the dragover placeholder. Every `<input type="file">`
site in `core/shared/{routes,components}` now ships drop-zone wiring;
diagnosticDump import + ConnectedSites bulk-import remain non-existent
surfaces and will pick up `useDropZone` if/when they're added.

## [0.329.0] - 2026-04-30

Bundled session, three FOLLOWUPs close together around the i18n + asset
metadata surfaces.

### Cluster R FOLLOWUP 2, i18n t() migration beachhead (ScanRoute)

§54 / Cluster R FOLLOWUP 2, first route migrated to `t()`. ScanRoute
imports `t` from `core/src/i18n/index.js` and replaces every inline
user-facing string (header title + back aria-label, scanner alt-text,
"Scanned, routing…" banner, paste label / placeholder / button copy,
all five status messages) with dictionary lookups. New keys live under
the `scan.*` namespace in `i18n/locales/en/index.js`: `scan.title`,
`scan.scannerAlt`, `scan.routing`, `scan.pasteLabel`,
`scan.pastePlaceholder`, `scan.classifyPaste`, `scan.error.pasteEmpty`,
`scan.error.unknownXchainIntent`, `scan.error.wif`, `scan.error.mnemonic`,
`scan.error.xcwChunk` (carries `{n}/{total}` placeholders),
`scan.error.unknown` (carries `{type}`). The existing `common.back` key
is reused for the back-button aria-label. Smoke
`audits/scan-route.smoke.js` gains an i18n section that pins the
dictionary contents, the t() callsites, and the placeholder shape.
Per-route migrations (Send / Receive / Settings panels / …) remain
deferred, this beachhead validates the pattern.

### Cluster I FOLLOWUP 3, useAssetInfo for Collectibles imageUrl

§27.5 / Cluster I FOLLOWUP 3, `<CollectibleCard>` now mounts
`useAssetInfo` per-card so the NFT grid surfaces real images even when
the row payload doesn't carry an `imageUrl`. The hook's module-level
cache means revisits don't re-fetch, and the existing `onError` path
keeps the ticker-letter placeholder as a visible fallback when the
fetched URL fails to load. Native rows + hidden cards skip the fetch.
`row.imageUrl` (when present) wins over the fetched fallback so a
caller-provided URL still takes precedence. TokenDetail's wiring shipped
at v0.322.0 (Cluster C FOLLOWUP 3); this closes the Collectibles half.
Smoke `ui/asset-info.smoke.js` extends to pin the CollectibleCard wiring
+ the `effectiveImageUrl` derivation.

### Cluster R FOLLOWUP 4, Locale picker + LocaleSync bootstrap

§35.1 / §54 / Cluster R FOLLOWUP 4, `<LanguageRegionSection>` now
populates the language `<select>` from `availableLocales()` (any
registered locale shows up automatically; unknown codes fall back to
their bcp47 string via the new `LANGUAGE_LABELS` display-name map).
`onLanguageChange` flips the live i18n locale immediately via
`setLocale(next)` (guarded by `availableLocales().includes(next)` so a
stale settings record can't crash the panel) before persisting through
`update({ language: next })`. Cold-start rehydration lives in a new
`<LocaleSync>` component mounted under `MessagingProvider` next to
`PrivacyBlurGate`: it reads `useSettings`, watches `settings.language`,
and calls `setLocale` whenever the persisted code differs from the live
locale (ignores unknown / unregistered codes). New
`ui/locale-sync.smoke.js` pins the component shape, the
MessagingProvider mount, the LanguageRegionSection wiring, and a
runtime registerLocale → setLocale → t() round-trip.

## [0.328.0] - 2026-04-29

Bundled session, three FOLLOWUPs close together because the shared
files (createBackgroundHost, flows/index, three messaging shells) each
carry hunks for all three.

### Cluster Q FOLLOWUP 5, logConsole persistent mirror

§48.5 / Cluster Q FOLLOWUP 5, `logConsole` exposes `restore(entries)`
(chronological prepend with id-dedupe; doesn't fire listeners so a
boot-time hydrate doesn't spam the Developer Mode panel) +
`attachMirror({save, sourceAllow?, debounceMs?})` (debounced subscriber
that batches writes; default `sourceAllow` strict-whitelists `vault` /
`signer:*` / `encoder` / `bridge:*`: `console` is NEVER mirrored
because it can carry arbitrary stringified args from third-party
content-script code) + `detachMirror()` + `isMirrorAttached()`. New
`packages/extension/src/background/logConsoleStorage.js` mirrors the
broadcastQueueStorage / signThrottleStorage shape: `chrome.storage.local`
for the SW, `localStorage` for web + desktop renderers, null fallback
for tests. `coerceEntries` defensive parse drops anything missing the
canonical id/timestamp/level/source/message tuple so a corrupt
persisted blob can't crash the SW at boot. `createBackgroundHost`
accepts a `logConsoleStorage` dep (default = adapter picker), hydrates
via `logConsole.restore(persisted)`, then calls
`logConsole.attachMirror({save: storage.save})`. Order matters: restore
runs before attach so the first save() writes the merged buffer
(persisted + any record() calls that landed during boot).

### Cluster Q FOLLOWUP 2, Custom non-bundled chain registry

§9.7 / Cluster Q FOLLOWUP 2:
`packages/core/src/flows/customChains.js` (new) ships
`listCustomChains` / `addCustomChain` / `removeCustomChain`.
`addCustomChain` validates via the existing `validateChainDescriptor`
(per-descriptor strictness lives in the registry validator, single
source of truth for "is this descriptor usable?"), checks for
collisions against bundled + already-persisted ids, persists to
`settings.customChains`, then mutates the running ChainRegistry. If
the registry mutation throws after persistence, the persisted record
is rolled back so the next boot doesn't try to seed an
already-rejected descriptor. `removeCustomChain` removes from
settings + the registry; bundled chains throw with a friendly "is a
bundled chain and cannot be removed" message rather than the
registry's lower-level error. `settings.customChains?: object[]` is
v2-tolerant (array-of-plain-objects); strict per-descriptor validation
runs at write time, not at settings-read time, so a future
ChainDescriptor schema bump can't retroactively invalidate
already-persisted records. `createBackgroundHost` registers the three
host routes and ships a `seedCustomChainsFromVault(vault, chainRegistry)`
helper fired single-flight on the first `settings.get` after host
init (re-seeds the module-scoped registry on every unlock cycle, with
a `chainRegistry.has(id)` guard against duplicate adds). All three
messaging shells (popup / web / desktop) gain matching shims.
`<DeveloperModeSection>` mounts a new `<CustomChainsRow>` between the
Regtest networks subsection and the Raw PSBT inspector toggle: lists
registered custom chains with Remove buttons; "Add custom chain…"
opens a JSON-paste textarea (a guided form would be 16+ fields and
quickly drift from the validator). Validation errors from the host
route surface verbatim so the user sees exactly which field failed.

### Cluster O FOLLOWUP 2, DIVIDEND / AIRDROP recipient lists

§31.4 / Cluster O FOLLOWUP 2:
`packages/core/src/flows/recipientsByAction.js` (new) ships
`getDividendRecipients({sdkRegistry, chainId, actionIndex?, tick?})`
(SDK round-trip via `sdk.getHolders(tick)`; normalizes various holder
envelope shapes, `[]` / `{holders}` / `{rows}`: and uppercase field
aliases; dedupes addresses; excludes the action's SOURCE so the
dividend issuer doesn't show up as a recipient; returns a
`snapshotNote` honest-disclosing that the holders set is *current*
state, not the indexed snapshot, so the UI can show the caveat for
older DIVIDENDs) + `getAirdropRecipients({sdkRegistry, chainId,
actionIndex?, listActionIndex?})` (resolves `LIST_ACTION_INDEX` from
the AIRDROP action when not pre-resolved; fetches the LIST via
`sdk.getAction`; reads `params.ITEM` accepting both string and
`{address}`-object member shapes; dedupes; returns the listType so
callers can warn on TYPE=1 mismatches). Both flows accept pre-resolved
fields so callers with `entry.raw.TICK` / `entry.raw.LIST_ACTION_INDEX`
on the History row skip the extra round-trip.
`createBackgroundHost` registers `history.getDividendRecipients` /
`history.getAirdropRecipients` host routes; three messaging shells
gain matching shims. `<RecipientsBlock>` mounts in History's DetailCard
between SaveContactPrompt and RbfActions for DIVIDEND / AIRDROP rows:
idle Show holders / Show recipients button → loading → loaded list
(capped display at 200, with "+N more" tail) + a per-row inline
display of address + balance for DIVIDEND. The "Save N as one contact"
affordance bulk-saves into a single Contact record carrying every
address as an `entries[]` member, matches the data model (one
DIVIDEND/AIRDROP = one address book) better than N independent
contacts. Default name pattern `DIVIDEND #<idx> (<TICK>) holders` /
`AIRDROP #<idx> (list #<idx>) recipients`; the user can override
before save. `peerAddressOfEntry`'s deferred-DIVIDEND/AIRDROP
docstring updated to point at the new `<RecipientsBlock>` carrier.

### Added

- **`packages/core/src/shared/utils/logConsole.js`** , `restore`, `attachMirror`, `detachMirror`, `isMirrorAttached`, default `sourceAllow` predicate (vault / signer:* / encoder / bridge:*, never console), `__mirrorTestUtils` test export.
- **`packages/extension/src/background/logConsoleStorage.js`** (new)
 , `createLogConsoleStorage` adapter picker.
- **`packages/extension/src/background/createBackgroundHost.js`** : `logConsoleStorage` dep + boot-time hydrate-then-attach; `logConsoleStorage` import.
- **`packages/core/src/flows/customChains.js`** (new), `listCustomChains` / `addCustomChain` / `removeCustomChain`.
- **`packages/core/src/flows/recipientsByAction.js`** (new), `getDividendRecipients` / `getAirdropRecipients`.
- **`packages/core/src/flows/index.js`** , re-exports of the five new flows.
- **`packages/core/src/schemas/settings.js`** , v2-tolerant `customChains?: object[]` field + validator branch.
- **`packages/core/src/shared/components/settings/DeveloperModeSection.jsx`**
 , `CustomChainsRow` component + paste-JSON form + Remove affordance.
- **`packages/core/src/shared/routes/History.jsx`** : `<RecipientsBlock entry={entry}>` mounted in DetailCard for DIVIDEND / AIRDROP rows; peerAddressOfEntry docstring updated.
- **`packages/extension/src/background/createBackgroundHost.js`** : five new host routes (chainRegistry.{listCustomChains, addCustomChain, removeCustomChain} + history.{getDividendRecipients, getAirdropRecipients}); `seedCustomChainsFromVault` helper + `customChainsSeeded` single-flight guard.
- **`packages/extension/src/popup/messaging.js`** , **`packages/web/src/messaging.js`**, **`packages/desktop/renderer/messaging.js`**, five new shims each.
- **`test/smoke/ui/log-console-mirror.smoke.js`** (new), surface, default-allow predicate, restore behaviour, dedupe, debounce, source filtering, adapter file shape, host wiring.
- **`test/smoke/ui/custom-chains.smoke.js`** (new), flow round-trip (validate / persist / register / remove / collide), schema, host wiring, three shell shims, DevMode-section mount.
- **`test/smoke/ui/dividend-airdrop-recipients.smoke.js`** (new), flow round-trip across pre-resolved / action-lookup paths, holder envelope shapes, host wiring, three shell shims, History UI mount.
- **`test/smoke/ui/save-contact-extractor.smoke.js`** , header-pin updated to point at the new RecipientsBlock carrier (Cluster O FU 2 closed).

Closes Cluster Q FOLLOWUP 5, Cluster Q FOLLOWUP 2, Cluster O FOLLOWUP
2.

## [0.327.0] - 2026-04-29

Cluster Y FOLLOWUP 4, desktop detach-pending-tx into a new window. A pending transaction's detail card now surfaces an "Open in new window" button on the desktop shell; clicking it spawns a fresh BrowserWindow pre-routed to that exact tx via History's new `initialFocus` prop. The detached window keeps its own auto-lock + nav state because every window in the desktop shell already shares the same main-process MessageHost (vault + signers stay singleton).

§24.6 / Cluster Y FOLLOWUP 4, `packages/desktop/main/index.js` `createWindow` accepts an opts arg `{ initialView, initialContext }`; a new `buildLoadOptions` helper base64-encodes the payload and threads it through Electron's `loadFile({ search })` so the renderer can pick it up via `window.location.search`. New `xchain:open-window` IPC handler validates the shape and delegates to `createWindow`. `packages/desktop/preload.js` exposes a third contextBridge namespace `xchainWalletWindow` with a single `openDetached({ initialView, initialContext })` method that invokes the IPC channel.

`packages/desktop/renderer/App.jsx` ships a top-level `parseInitialRoute()` helper that reads + decodes `xc-init-route` from `window.location.search` once at mount and strips the search via `history.replaceState` so a refresh doesn't re-route. The parsed payload seeds `initialRoute` state; an effect chained on `(initialRoute, status.state)` flips `unlockedView` and `historyInitialFocus` once the wallet list resolves. The wallet-load effect prefers the `initialContext.walletId` over the first-wallet default when the named wallet is in the vault. A `useRef` (`isDetachedWindow`) locks in "this window was detached" at mount so `useLastView` keeps `skip=true` for the lifetime of the window even after `initialRoute` clears.

`packages/core/src/shared/hooks/useLastView.js` accepts a new `skip` flag, when true, the resume effect short-circuits but still bumps `lastResumedFor` so the persist gate can advance and the detached window's own navigation persists normally.

`packages/core/src/shared/routes/History.jsx` accepts an `initialFocus={chainId?, actionIndex?, txHash?}` prop. A fired-once-per-mount effect finds the first matching entry, sets `selectedKey`, and scrolls the row into view via a `data-history-key` attribute on `<EntryRow>`'s `<li>`. `<DetailCard>` derives `detachAvailable = shell === 'desktop' && !entry.blockIndex && typeof globalThis.xchainWalletWindow?.openDetached === 'function'` and renders an "Open in new window" Button when true. Web + extension shells degrade silently (the global isn't there, the button doesn't render).

### Added

- **`packages/desktop/main/index.js`**, `createWindow(opts)` opts arg + `buildLoadOptions` helper + `xchain:open-window` ipcMain handler.
- **`packages/desktop/preload.js`**, `xchainWalletWindow.openDetached` contextBridge API.
- **`packages/desktop/renderer/App.jsx`**, `parseInitialRoute` helper, `initialRoute` / `historyInitialFocus` state slots, route effect, walletId-from-context preference, `isDetachedWindow` ref, `historyInitialFocus` threaded into the History route.
- **`packages/core/src/shared/hooks/useLastView.js`**, `skip` flag.
- **`packages/core/src/shared/routes/History.jsx`**, `initialFocus` prop, `initialFocusFiredRef`, `data-history-key` attr on `<EntryRow>`, "Open in new window" Button on `<DetailCard>` for desktop pending entries, `walletId` threaded through both EntryRow / DetailCard call sites, `cssEscape` helper.
- **`test/smoke/desktop/detach-pending-tx.smoke.js`** (new), pins main / preload / App / History / useLastView wiring + a base64+URLSearchParams round-trip on the prefill payload.

Closes Cluster Y FOLLOWUP 4.

## [0.326.0] - 2026-04-29

Cluster H FOLLOWUP 3, `add` mode for encrypted backup restore. Users with an open vault can now restore an encrypted backup as a new wallet alongside their existing one(s) without colliding on ids; the wallet record gets a fresh id at decode time and every cross-reference (account.walletId, address.accountId, importedKeys[].addressId, pendingTx.id) is rewired in lockstep.

§19.4 / Cluster H FOLLOWUP 3, `importBackupFile` accepts a `mode: 'fresh' | 'add'` parameter (default 'fresh' preserves existing behavior). In add mode, a new `remintIdentifiers` helper mutates the decoded payload in place: wallet.id, every account.id (and account.walletId rewired to the new wallet), every address.id (and address.accountId rewired when it referenced a re-minted account), every wallet.importedKeys[].addressId (rewired through the address-id remap), and every pendingTx.id (re-minted independently, pending txs are address-scoped via fromAddress, not id-scoped). Contacts / connectedSites / settings ids stay untouched (they're global across wallets and there's nothing to disambiguate). `collectConflicts` accepts a `skipWalletScoped` opt that the add-mode path uses to skip the wallet/account/address/pendingTx conflict pre-checks since those have already been re-minted to fresh ids.

The host route (`createBackgroundHost.js` `wallet.importBackup`) forwards `req.mode` into the flow. ImportWallet's existing `mode` prop ('fresh' / 'add') already drove the mnemonic lane's host channel selection; the encrypted-backup lane now also forwards it, and the lane's subtitle copy switches when in add mode to "Restore as a new wallet, won't replace your existing one." (compact) / "Restore an encrypted backup as a new wallet alongside your existing one(s)…" (full).

### Added

- **`packages/core/src/flows/backupFile.js`**, `mode` parameter on `importBackupFile`; new `remintIdentifiers` exported helper; `collectConflicts` `skipWalletScoped` opt; randomUUID import; `mode` validation.
- **`packages/extension/src/background/createBackgroundHost.js`**, `wallet.importBackup` handler forwards `req.mode`.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, backup lane forwards `mode` to `importBackupRequest`; add-mode subtitle copy on both compact and full variants.
- **`test/smoke/wallet/backup-add-mode.smoke.js`** (new), pins the flow surface (mode default + validation + remintIdentifiers export), runtime re-mint behavior (wallet/account/address ids change + cross-references rewired + global ids untouched + pendingTx fromAddress preserved), host wiring, and ImportWallet copy.
- **`test/integration/flows/backup-add-mode.test.js`** (new), full encode → decode round-trip (4 cases): add-mode lands fresh wallet alongside existing; double-import of the same backup produces two distinct wallets; fresh mode keeps the original id; unknown mode value rejected.

Closes Cluster H FOLLOWUP 3.

## [0.325.0] - 2026-04-29

Cluster T FOLLOWUP 3, Glossary auto-appendix. `BridgeErrorCode` union members and `ConnectedSite.SitePermissions` keys auto-derive into a fenced appendix at the bottom of `docs/GLOSSARY.md` so the doc never drifts from the canonical sources.

§55 / Cluster T FOLLOWUP 3, `tools/glossary/generate-appendix.js` (new) reads `packages/bridge-spec/src/index.ts` (`BridgeErrorCode` union via regex over the multi-line type alias) + `packages/core/src/schemas/connectedSite.js` (`SitePermissions` `@property` keys via the JSDoc typedef block), renders an appendix with both lists, and rewrites the section between `<!-- BEGIN auto-generated glossary appendix -->` / `<!-- END auto-generated glossary appendix -->` markers in `docs/GLOSSARY.md`. Default mode writes; `--check` exits non-zero when the appendix is stale, so a smoke / CI gate catches drift. The appendix added today carries 15 bridge error codes (USER_REJECTED through INTERNAL_ERROR) + 4 permission keys (chains / accounts / canSignMessage / canSignAction).

### Added

- **`tools/glossary/generate-appendix.js`** (new), node script with `extractBridgeErrorCodes` + `extractSitePermissionKeys` parsers, `buildAppendix` renderer, marker-aware `rewriteGlossary` writer, `--check` dry-run mode.
- **`docs/GLOSSARY.md`**, appendix with auto-generated marker pair appended at the bottom (after the existing prose Glossary).
- **`test/smoke/docs/glossary-appendix.smoke.js`** (new), runs the generator with `--check`, asserts exit 0, asserts marker pair + a sanity sample of codes / permission keys are present in the doc.

Closes Cluster T FOLLOWUP 3.

## [0.324.0] - 2026-04-29

Cluster U FOLLOWUP 1, BBQr-Z (zlib + base32) decoding support. Coldcard / SeedSigner emit Z by default for large PSBTs because Z compresses ~30%+ vs H/B; users with those wallets can now scan signed-PSBT replies straight into PsbtSignForm without manually flipping their device to H or B.

§20.4 / G043 / Cluster U FOLLOWUP 1, `packages/core/src/uri/bbqrPsbt.js` adds a Z encoding branch that re-uses `decodeBase32NoPad` for the base32 layer and inflates the resulting bytes via pako. The standard zlib container (2-byte header + adler32 trailer) is the spec'd wire shape; the inflater falls back to raw-deflate on header-mismatch as a defensive branch for signers that have shipped raw-deflate frames in the wild. Inflate failures wrap into a typed `BbqrError` with the underlying message preserved; pako exceptions never surface raw to callers. The `decodeBbqrFrames` return type union extends to `'H' | 'B' | 'Z'`. The previous "encoding Z (zlib) not yet supported" throw is gone, a malformed frame still surfaces a clear, named error via the `unsupported encoding "<E>"` fallback.

`pako` is the runtime dependency (CommonJS 1.x, ~12KB minified, destructured from the default import so the Node ESM loader is happy and bundlers tree-shake unused exports). Static import was chosen over the FOLLOWUP's dynamic-import shape because making `decodeBbqrFrames` async would cascade through `normalizePsbtInput`'s `useMemo` in PsbtSignForm, a much larger refactor than the bundle savings would justify.

`PsbtSignForm`'s `unsupportedFormatHint` no longer special-cases BBQr-Z (since it's supported); it still falls back through `decodeBbqrPsbt` to surface BBQr-specific errors for malformed / incomplete / future-encoding frames. `qrPsbtFormat.js`'s header doc updated to list only UR as remaining-unsupported.

### Added

- **`packages/core/src/uri/bbqrPsbt.js`**, `'Z'` branch in `decodeBbqrFrames`; new `inflateZlib` helper (pako.inflate with raw-deflate fallback); type union extended to `'H' | 'B' | 'Z'`.
- **`packages/core/package.json`**, `pako: ^1.0.11` added to `dependencies`.
- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, header docstring + `unsupportedFormatHint` comments updated to drop the BBQr-Z carve-out.
- **`packages/core/src/uri/qrPsbtFormat.js`**, header doc lists UR as the remaining-unsupported format; BBQr-Z dropped from the carve-out.
- **`test/smoke/bridge/bbqr-psbt.smoke.js`**, Z round-trip pinned (single-frame, multi-frame, out-of-order, larger-PSBT, garbage-payload BbqrError).

Closes Cluster U FOLLOWUP 1.

## [0.323.0] - 2026-04-29

Cluster C FOLLOWUP 2, cross-chain LINK pair rendering. Both sides of a LINK now collapse into a single dual-chain card with both `<ChainBadge>`s side-by-side, a `CROSS-CHAIN` action badge, and a `${peerAction} ↔ ${leaderAction}` summary; the connector between the two sides is suppressed in grouped mode (kept in flat mode).

§28.3 / Cluster C FOLLOWUP 2, `groupHistoryEntries` grew a fourth subkind, `link-pair`, alongside `issue-mint` / `dispenser-dispense` / `order-fills`. The grouper tracks a `linkPairLeaders` map keyed by `linkActionIndex`; iterating DESC keeps overwriting until the oldest entry is the final leader, mirroring the issue-mint convention so the group emits at the older row's slot and the expanded list reads newest-first. Members are the newer peer side(s); when only one side of a LINK is in the visible window (peer chain disabled in filter / single-address wallet) the row stays a plain entry with its existing 🔗 badge so the §23.5 cross-chain affordance still surfaces. Flat mode passes through unchanged. `summarizeGroup` returns `Cross-chain link, {peerAction} ↔ {leaderAction}`, falling back to a single-action form if the peer's action label is empty.

`<GroupCard>` adopts an `isLinkPair` branch that surfaces both chain badges separated by a `↔` glyph (the `groupCount` pill is hidden for link-pair since it's always exactly two sides). `groupBadgeLabel` returns `CROSS-CHAIN`. The grouped-members render in History.jsx forces `showConnector={false}` for link-pair members, the dual-chain card already conveys the relationship; the vertical connector between rows is redundant inside the group but stays useful in flat mode where adjacent rows otherwise look unrelated.

### Added

- **`packages/core/src/shared/utils/historyGrouping.js`**, `link-pair` subkind in the `GroupedItem` typedef, `linkPairLeaders` map, `summarizeGroup` branch, header doc updated to list four subkinds.
- **`packages/core/src/shared/routes/History.jsx`**, `groupBadgeLabel` returns `CROSS-CHAIN` for link-pair; `<GroupCard>` renders the dual `<ChainBadge>` + `↔` glyph + label; grouped-mode `<EntryRow>` forces `showConnector={false}` for link-pair members.
- **`packages/core/src/shared/routes/History.module.css`**, `.linkPairConnector` rule.
- **`test/unit/util/historyGrouping.test.js`**, four new cases (basic 2-side collapse, asymmetric LINK ↔ ISSUE, single-side passthrough, flat-mode passthrough). 17 cases total.
- **`test/smoke/ui/link-pair-grouping.smoke.js`** (new), pins subkind / leader / member / summary via dynamic import + History.jsx GroupCard + connector-suppress wiring + CSS hook.

Closes Cluster C FOLLOWUP 2.

## [0.322.0] - 2026-04-29

Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3, `messaging.getAssetInfo({chainId, asset})` host method backed by `sdk.getToken()`; TokenDetail surfaces description, creator address, total/max supply, market price, and lock status; image URLs are extracted from descriptions for collectibles.

§27.6 / Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3, `packages/core/src/flows/assetInfo.js` (new) ships `assetInfoFor`, `normalizeAssetInfo`, and `extractImageUrl`. Normalizes xchain-explorer's `/api/token/{TICK}` response into the stable `AssetInfo` shape: `{description, creator, totalSupply, maxSupply, locked, locks, marketPrice, marketFloor, imageUrl}`. The headline `locked` flag is true when description / max-supply / mint / mint-supply is gated; per-field detail still surfaces through the `locks` map. `extractImageUrl` accepts JSON descriptions (`{"image": "..."}`), markdown image syntax (`![alt](url)`), bare URLs with image extensions, and `ipfs://` URLs (rewritten to a public gateway). Asset-not-found / explorer-offline / network glitch cases return a sentinel record rather than raising, so the caller renders "no metadata" copy gracefully.

`createBackgroundHost` registers `asset.info` → `assetInfoFor`. All three messaging shells (extension popup / web / desktop renderer) export `getAssetInfo({chainId, asset})`. `useAssetInfo({chainId, asset, skip})` lives in `packages/core/src/shared/hooks/useAssetInfo.js` with a module-level `Map` cache keyed by `chainId:asset` so navigating Detail → back → Detail (or hovering the same row in Collectibles) doesn't re-fetch. `__clearAssetInfoCache()` test helper mirrors `useSignerInfo`'s pattern.

`<TokenDetail>` adopts the hook (skipped for native coins). When the description is available, a new Description card renders above the Metadata card with an optional image (lazily loaded, `onError` self-hides). The Metadata card grows Creator (mono-font shortened address), Total supply (`current / max`), Market price (`{value} {NATIVE} / {ASSET}`), and Status (Locked vs Mutable) rows when the corresponding fields are present. While the lookup is in flight, "Loading description, creator, and supply…" replaces the v0.181.0 deferred-features hint. CollectiblesView image-URL extraction on row enrichment (the cluster's other natural pickup) remains future work, the row-level prefetch needs a fan-out at the Home/HomeTabs level rather than a per-card lookup, deferred to keep this commit focused.

### Added

- **`packages/core/src/flows/assetInfo.js`** (new), `assetInfoFor`, `normalizeAssetInfo`, `extractImageUrl`, `AssetInfo` typedef.
- **`packages/core/src/flows/index.js`**, re-exports the three.
- **`packages/extension/src/background/createBackgroundHost.js`**, imports `assetInfoFor`; registers `asset.info` host route.
- **`packages/extension/src/popup/messaging.js`**, **`packages/web/src/messaging.js`**, **`packages/desktop/renderer/messaging.js`**, `getAssetInfo({chainId, asset})` shim.
- **`packages/core/src/shared/hooks/useAssetInfo.js`** (new), module-cached `useAssetInfo` hook + `__clearAssetInfoCache` test helper.
- **`packages/core/src/shared/routes/TokenDetail.jsx`**, imports `useAssetInfo`; renders Description card + Creator / Total supply / Market price / Status metadata rows; loading hint replaces stale "coming next" copy.
- **`packages/core/src/shared/routes/TokenDetail.module.css`**, `.descriptionCard`, `.descriptionImage`, `.descriptionBody`, `.creatorCell`, `.lockedFlag`, `.unlockedFlag` rules.
- **`test/smoke/ui/asset-info.smoke.js`** (new), pins flow surface, host registration, three messaging shims, hook cache + test helper, TokenDetail wiring, and a round-trip on `extractImageUrl` + `normalizeAssetInfo`.

Closes Cluster I FOLLOWUP 3, Cluster C FOLLOWUP 3.

## [0.321.0] - 2026-04-29

Cluster H FOLLOWUP 1 + Cluster Q FOLLOWUP 5, BIP39 passphrase toggle in CreateWallet + ImportWallet now carries a hardware-wallet caveat in its InfoTip; `logConsole.snapshot()` joins the §50 diagnostic dump under a `recent_logs` slot.

§15.6 / Cluster H FOLLOWUP 1, `<CreateWallet>` and `<ImportWallet>` BIP39 passphrase toggles surface explanatory copy that hardware wallets handle passphrases on the device itself (Trezor Suite / Ledger Live), not via this UI. The Create / Import lanes are software-only by construction (HW signers pair through `<PairSignerForm>` + `<AddAccountForm>`), so the FOLLOWUP closes by surfacing the distinction in copy rather than adding a code-level branch that would never fire. `<ImportWallet>` now imports `<InfoTip>` from `core/ui` and ships its own help bubble alongside the existing "This wallet uses a BIP39 passphrase" toggle; `<CreateWallet>`'s existing InfoTip extends its label to mention the on-device case.

§50 / §48.5 / Cluster Q FOLLOWUP 5, `logConsole.snapshot({ limit, messageLimit })` lands in `packages/core/src/shared/utils/logConsole.js` as a bounded, pre-truncated copy of the ring-buffer suitable for crossing process boundaries. `flows/diagnosticDump` accepts an optional `recentLogs` arg, surfaces it under `recent_logs` in the dump output, and runs it through a new `sanitizeLogs` defensive filter (200-entry cap, 500-char per-message cap, level-union check, source/id/timestamp coercion) so a stale shell or custom messaging shim can't bloat the dump. `createBackgroundHost`'s `diagnostic.dump` handler imports `logConsole` and threads `snapshot({ limit: 100, messageLimit: 500 })` into the dump call. Failure modes around the singleton load are caught, an unreachable logConsole yields an empty `recent_logs` array rather than breaking the dump. Cluster Q FOLLOWUP 4's typed-source emissions (vault / signer / encoder / bridge) now reach support reports without users having to copy the Developer Mode log panel manually.

### Added

- **`packages/core/src/shared/utils/logConsole.js`**, `snapshot({ limit, messageLimit })` export and `snapshot,` entry in the public singleton.
- **`packages/core/src/flows/diagnosticDump.js`**, `recentLogs` opt + `recent_logs` output slot + `DiagnosticLogEntry` typedef + `sanitizeLogs` defensive filter.
- **`packages/extension/src/background/createBackgroundHost.js`**, imports `logConsole`; `diagnostic.dump` handler captures + threads `snapshot({ limit: 100, messageLimit: 500 })` into the dump.
- **`packages/core/src/shared/routes/CreateWallet.jsx`**, extended BIP39 InfoTip label to mention HW-on-device passphrase handling.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, imports `<InfoTip>` from core/ui; new BIP39 passphrase help bubble alongside the toggle.
- **`test/smoke/ui/bip39-passphrase-hw-hint.smoke.js`** (new), pins both InfoTip integrations and the HW-on-device copy.
- **`test/smoke/ui/diagnostic-dump-logs.smoke.js`** (new), pins `snapshot()` shape, `recent_logs` slot + caps, sanitizeLogs coercion, host-side wiring.

Closes Cluster H FOLLOWUP 1, Cluster Q FOLLOWUP 5.

## [0.320.0] - 2026-04-29

Cluster O FOLLOWUP 2 + Cluster P FOLLOWUP 3 + Cluster H FOLLOWUP 2, peer-extractor handles MESSAGE incoming + ORDER fill counterparty rows, InfoTip re-anchors when its bubble would clip the viewport, and the ImportWallet drop-zone accepts PNG / JPEG QR-image drops.

§31 / §28.3 / Cluster O FOLLOWUP 2, `peerAddressOfEntry` in History.jsx now does action-kind-aware extraction. Pre-fix the function returned the wallet's own address for any row whose `destination` equalled `entry.address` (RECEIVE / MESSAGE-incoming), making the `<SaveContactPrompt>` suppress the affordance. The extended extractor checks each candidate against the wallet self-address and falls through to the right field. ORDER_MATCH / fill rows pick the counterparty from a candidate list (`tx0_address`, `tx1_address`, `give_address`, `get_address`, `destination`, `source`). DIVIDEND + AIRDROP recipient lists remain deferred, those need a new `messaging.getDividendRecipients({ chainId, actionIndex })` host method that walks holders or per-recipient dispense rows.

§37 / G122 / Cluster P FOLLOWUP 3, `<InfoTip>` re-anchors when the bubble's center-anchored extent would clip the viewport. v0.210.0's bubble was always centered on the trigger; in narrow contexts (extension popup is 360 px wide) tooltips near the right edge could clip. The component now measures the trigger's `getBoundingClientRect` against `document.documentElement.clientWidth` on every open transition (and on resize while open) and swaps in `.alignStart` (left edge anchored to trigger) or `.alignEnd` (right edge anchored to trigger) when the centered layout would overflow. Default `.alignCenter` matches the v0.210.0 layout. Measurement uses `useLayoutEffect` so the user never sees a flash of clipped layout before the re-anchor.

§15.4 / G022 / Cluster H FOLLOWUP 2, ImportWallet's recovery-phrase drop-zone now accepts printed-paper-wallet QR images. Previously the dropzone rejected anything that wasn't `text/*` / `.txt` / `.asc`; now PNG / JPEG drops render to an off-screen canvas, run `globalThis.BarcodeDetector` for `qr_code` format, and feed the rawValue through the existing `handleQrFrame` so the textarea fills the same way a live `<QrScanner>` capture would. Browsers without `BarcodeDetector` (Safari / Firefox today) get a friendly hint pointing to the Scan QR button instead of failing silently. PDFs remain out of scope, they need a third-party PDF render layer. The plain-text rejection copy now mentions the new image case so the user knows what's accepted.

### Added

- **`packages/core/src/shared/routes/History.jsx`**, `peerAddressOfEntry` extended with ORDER_MATCH branch + self-address filtering on the SEND/RECEIVE/MESSAGE branch. Header docstring tags the FOLLOWUP id and notes the deferred DIVIDEND / AIRDROP branch.
- **`packages/core/src/ui/InfoTip.jsx`**, alignment state + `useLayoutEffect`-driven measurement + resize listener.
- **`packages/core/src/ui/InfoTip.module.css`**, three alignment classes (`.alignCenter` / `.alignStart` / `.alignEnd`) replacing the unconditional centered anchor on `.bubble`.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, image-QR drop branch + `decodeImageQrFile` + `loadImageFromUrl` helpers; updated rejection copy.
- **`test/smoke/ui/save-contact-extractor.smoke.js`** (new), pins the FOLLOWUP id, ORDER_MATCH branch, isSelf helper, and self-filtering on dest/src.
- **`test/smoke/ui/info-tip-overflow.smoke.js`** (new), pins useLayoutEffect import, alignment state, getBoundingClientRect measurement, the three CSS alignment classes, the resize listener, and the bubble-class composition.
- **`test/smoke/ui/import-wallet-image-qr.smoke.js`** (new), pins the FOLLOWUP id, MIME + extension detection, BarcodeDetector feature-check, `decodeImageQrFile` shape, and the updated rejection copy.

Closes Cluster O FOLLOWUP 2, Cluster P FOLLOWUP 3, Cluster H FOLLOWUP 2.

## [0.319.0] - 2026-04-29

Cluster I FOLLOWUP 6 + Cluster P FOLLOWUPs 4 + 5 + Cluster J FOLLOWUP 7, confirmation badge on the History tx-status timeline, form-draft sweep across IssueTokenForm + DispenserForm, error-recovery sweep across the same two forms plus AddAccountForm, and demo-wallet activation defaulting to regtest networks.

§28.3 / Cluster I FOLLOWUP 6, `<TxStatusTimeline>` now accepts an optional `chainTip` prop. When the tip is at or above the entry's block, the Confirmed-stage sub-line carries `"<formatted timestamp> · N confirmations"` (or just `"N confirmations"` when no timestamp is available). Singular vs plural copy is tracked. `History.jsx` derives `chainTipByChainId` from the max `blockIndex` across loaded entries, a lower bound for the chain tip, since explorer's `/network` is still a placeholder and there's no dedicated tip endpoint yet, and threads it through both `<EntryRow>` call sites + `<DetailCard>` + `<TxStatusTimeline>`. The existing cross-chain-link smoke updated to match the `<DetailCard>` signature change.

§37 / G125 / Cluster P FOLLOWUP 5, form-draft persistence sweep. v0.212.0 wired Send + SignMessageForm; v0.319.0 extends the hook to `IssueTokenForm` (chain / source / ticker / supply / divisible / description / lockSupply / transferTo) and `DispenserForm` (chain / source / ticker / giveAmount / escrow / triggerPrice / oracleAddress / fiatCode / fiatAmount / showAdvanced). Both adopt the canonical pattern: read `settings.privacy.formDraftTtlMs` (Cluster P FOLLOWUP 6's Off / 1h / 24h / 7d), pass through to `useFormDraft`, save while `stage === 'form'`, surface a Restore / Discard banner when a draft exists, clear on submit success. Password fields stay in component state and never touch localStorage.

§37 / G121 / Cluster P FOLLOWUP 4, error-recovery sweep across the same forms + an audit note for AddAccountForm. `IssueTokenForm` and `DispenserForm` post-submit errors (encoder rejection / network unreachable / device unplugged) now wrap in `<StatusMessage variant="error">` with a `recovery: { label: 'Edit', onAction }` that returns the user to the form stage without retyping the password. Field-level `formError` rows also wrap in `<StatusMessage>` for consistency, with no recovery affordance, those are user-iterates-over-an-input by design. `AddAccountForm` carries a header note documenting the same auditable terminal-as-rendered classification (account name validation + signer-pool errors are recovered by re-typing + clicking Add account again).

§25 / Cluster J FOLLOWUP 7, demo wallets activate on the regtest networks rather than mainnet. `handleEnterDemo` in `Onboarding.jsx` passes `activeChainIds: ['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest']` through `messaging.importMnemonic`. The wallet does not actually fetch from chain endpoints under demo (FOLLOWUP 1's `synthesizeDemo*` flows short-circuit Home + History since v0.310.0), but signaling regtest in the wallet's stored chain set keeps any future "fan out a real fetch" code path off mainnet.

### Added

- **`packages/core/src/shared/components/TxStatusTimeline.jsx`**, `chainTip` prop + confirmation-count sub-line.
- **`packages/core/src/shared/routes/History.jsx`**, `chainTipByChainId` memo + thread to `<EntryRow>` (both call sites) → `<DetailCard>` → `<TxStatusTimeline>`.
- **`packages/core/src/shared/routes/IssueTokenForm.jsx`**, `useFormDraft` + `useSettings` wiring, draft banner, clear-on-success, `<StatusMessage>` migration of submit + form errors with `Edit` recovery on the post-submit branch.
- **`packages/core/src/shared/routes/DispenserForm.jsx`**, same wiring as IssueTokenForm.
- **`packages/core/src/shared/routes/AddAccountForm.jsx`**, header docstring documenting the error-recovery audit decision.
- **`packages/core/src/shared/routes/Onboarding.jsx`**, `handleEnterDemo` passes regtest `activeChainIds`.
- **`test/smoke/ui/tx-status-timeline-confirmations.smoke.js`** (new), pins prop signature, plural copy, History wiring (including both EntryRow call sites).
- **`test/smoke/ui/form-draft-sweep.smoke.js`** (new), pins useFormDraft view names, persisted fields, password-exclusion, restore handlers, banner wiring, clear-on-done call site.
- **`test/smoke/ui/error-recovery-sweep.smoke.js`** (new), pins StatusMessage migration + Edit recovery wiring + AddAccountForm audit comment.
- **`test/smoke/ui/demo-wallet-regtest-default.smoke.js`** (new), pins regtest activeChainIds + chain-descriptor existence.

### Changed

- **`test/smoke/ui/history-cross-chain-link.smoke.js`**, `<DetailCard>` signature pin updated to include `chainTip`.

Closes Cluster I FOLLOWUP 6, Cluster P FOLLOWUP 4, Cluster P FOLLOWUP 5, Cluster J FOLLOWUP 7.

## [0.318.0] - 2026-04-29

§37 / Cluster P FOLLOWUP 6, form-draft retention surfaced in Settings → Privacy. v0.212.0 hard-coded a 24h TTL for in-progress Send / sign-message draft persistence; v0.318.0 makes the retention window user-configurable (Off / 1h / 24h / 7d).

`packages/core/src/schemas/settings.js` exports `FORM_DRAFT_TTL_OFF / _1H / _24H / _7D / _DEFAULT / _OPTIONS` and adds `privacy.formDraftTtlMs?: number` as v2-tolerant. Validator accepts undefined or one of the four allowed durations; anything else fails.

`packages/core/src/shared/hooks/useFormDraft.js` honors `ttlMs === 0` as a kill switch, `load()` evicts any persisted entry and returns null, `save()` short-circuits, `clear()` still works (for cleanup of pre-existing drafts when the user switches from 24h → Off). `Send.jsx` and `SignMessageForm.jsx` read `settings.privacy.formDraftTtlMs` and thread it into `useFormDraft`.

`<PrivacySection>` mounts a new `<FormDraftTtlRow>` with a 4-option `<select>` wired through `update({ privacy: { formDraftTtlMs } })`.

### Added

- **`packages/core/src/schemas/settings.js`**, five new constants + `formDraftTtlMs` field + validator branch.
- **`packages/core/src/shared/hooks/useFormDraft.js`**, `draftDisabled` short-circuit on `ttlMs=0`.
- **`packages/core/src/shared/routes/Send.jsx`**, **`SignMessageForm.jsx`**, read settings, thread ttlMs into useFormDraft.
- **`packages/core/src/shared/components/settings/PrivacySection.jsx`**, `<FormDraftTtlRow>` dropdown.
- **`test/smoke/ui/form-draft-retention.smoke.js`** (new), pins constants, schema validator, Off-mode behavior, call-site threading, dropdown wiring.

Closes Cluster P FOLLOWUP 6.

## [0.317.0] - 2026-04-29

§18.5 / Cluster N FOLLOWUP 3, sign-flow risk classifier drives the HW cross-check explicit-confirm checkbox. v0.202.0 added a `requireExplicitConfirm` opt-in to `<DerivationPathCrossCheck>` but no caller flipped it on. v0.317.0 ships a per-flow risk classifier so high-risk signs (large amounts, first-time recipients, multisig coordinator approvals, or always-on per user setting) require an explicit "I've verified path + address" checkbox before Submit enables; everything else stays frictionless.

`packages/core/src/flows/signRiskClassifier.js` (new) exports `classifySignRisk({ signerKind, amountSats, recipientNovel, multisig, settings })` returning `{ requireExplicitConfirm: boolean, reason: string | null }`. Pure function, no I/O. Software signers always return false (the cross-check block isn't rendered for them). Priority order on HW: settings.alwaysRequireHwExplicitConfirm > multisig > recipient novelty > amount over `testSendThresholdSats`. The reason copy surfaces above the checkbox so the user knows *why* the wallet is asking for explicit confirmation.

`packages/core/src/schemas/settings.js` adds `privacy.alwaysRequireHwExplicitConfirm?: boolean` as v2-tolerant. `<PrivacySection>` adds the toggle. `<HwSignBlock>` accepts `requireExplicitConfirm`, `requireExplicitConfirmReason`, and `onConfirmedChange` props; threads the first two into a reason banner above the cross-check block, and the first + third into `<DerivationPathCrossCheck>`.

`<Send>` imports `classifySignRisk`, computes `signRisk` in a useMemo (re-runs on signer / amount / recipient / settings changes), passes it into `<HwSignBlock>`, and gates Submit on `hwExplicitConfirmed` whenever the classifier requires it. Submit handler also bails on the same condition for defense-in-depth. The confirm state resets whenever the requirement flips on or the recipient/amount changes so a stale "yes" can't carry through.

### Added

- **`packages/core/src/flows/signRiskClassifier.js`** (new), `classifySignRisk` export.
- **`packages/core/src/flows/index.js`**, re-exports it.
- **`packages/core/src/schemas/settings.js`**, `alwaysRequireHwExplicitConfirm` field + validator branch.
- **`packages/core/src/shared/components/HwSignBlock.jsx`**, three new props + reason banner.
- **`packages/core/src/shared/components/settings/PrivacySection.jsx`**, always-on toggle.
- **`packages/core/src/shared/routes/Send.jsx`**, risk classifier + submit gate.
- **`test/smoke/ui/sign-risk-classifier.smoke.js`** (new), pins behavioral classifier output, schema acceptance, HwSignBlock + Send wiring, PrivacySection toggle.

Closes Cluster N FOLLOWUP 3.

## [0.316.0] - 2026-04-29

§43 / Cluster F FOLLOWUP 3, bridge version negotiation. The connect handler used to mirror `req.bridgeVersion` back at the dApp regardless of whether we actually implemented it; a dApp asking for a future version got a friendly success on connect followed by mysterious failures when version-specific methods weren't recognized. v0.316.0 ships an explicit supported-version list and rejects connect cleanly when the request asks for something outside it.

`packages/bridge-spec/src/index.ts` exports `BRIDGE_SUPPORTED_VERSIONS: readonly string[] = ['0.1.0']` plus an `isBridgeVersionSupported(requested)` helper. Empty / non-string requests pass through (the connect handler falls back to `BRIDGE_SPEC_VERSION` for those, keeps the existing dApp behavior intact). The `BRIDGE_VERSION_MISMATCH` error code was already declared in the `BridgeErrorCode` union; this commit wires it.

`packages/extension/src/bridge/handlers.js` calls `isBridgeVersionSupported(req.bridgeVersion)` at the top of `bridge.connect` (after origin + blocklist checks), throwing a `bridgeError('BRIDGE_VERSION_MISMATCH', detail)` on mismatch. Both connect return paths (existing-site and new-grant) now carry `supportedVersions: [...BRIDGE_SUPPORTED_VERSIONS]` so dApps can pre-detect via `provider.version + supportedVersions` before attempting any version-specific method. The hardcoded `'0.1.0'` literal in the version field was replaced with the `BRIDGE_SPEC_VERSION` constant, single source of truth.

### Added

- **`packages/bridge-spec/src/index.ts`**, `BRIDGE_SUPPORTED_VERSIONS` + `isBridgeVersionSupported`.
- **`packages/extension/src/bridge/handlers.js`**, version-check + supportedVersions in connect return.
- **`test/smoke/bridge/bridge-version-negotiation.smoke.js`** (new), pins the export, the connect rejection path, and the new return shape.

Closes Cluster F FOLLOWUP 3.

## [0.315.0] - 2026-04-29

§24 / Cluster U FOLLOWUP 6, multi-wallet last-view threading. Switching wallets while sitting on a non-Home view (e.g. /history under wallet A → switch to wallet B) was incorrectly persisting wallet A's current view (`history`) under wallet B's localStorage key, stomping any saved state for B. The persist effect now waits for the resume effect to fire for the new walletId before persisting; the first persist tick after a switch is a grace tick that absorbs the resume's setUnlockedView before any write can happen.

`packages/core/src/shared/hooks/useLastView.js` adds a `lastPersistedFor` useRef alongside the existing `lastResumedFor`. Persist effect now bails when the resume effect hasn't fired yet for this walletId; the first post-resume persist run for a given walletId is also skipped (grace tick) so the switching wallet's onResume → setUnlockedView propagates into currentView before any write. Resume effect clears both refs on a null walletId and clears the persist-gate when a new walletId arrives.

### Added

- **`packages/core/src/shared/hooks/useLastView.js`**, `lastPersistedFor` ref + persist guard.
- **`test/smoke/ui/last-view-multi-wallet.smoke.js`** (new), pins both the resume gate and the first-persist grace tick.

Closes Cluster U FOLLOWUP 6.

## [0.314.0] - 2026-04-29

§24 / Cluster U FOLLOWUP 5, clear last-view memory on remove-wallet. The lastViewMemory utility already exposes `clearLastView(walletId)`; v0.314.0 wires it into the two surfaces that actually delete a wallet record so a future wallet (vanishingly unlikely under cuids, but the hygiene cost is zero) can't inherit the previous wallet's saved route.

`packages/core/src/shared/components/settings/ThisWalletSection.jsx` and `packages/core/src/shared/components/DemoBanner.jsx` both import `clearLastView` and call it after a successful `messaging.removeWallet`.

### Added

- **`packages/core/src/shared/components/settings/ThisWalletSection.jsx`**, **`packages/core/src/shared/components/DemoBanner.jsx`**, `clearLastView` import + call.

Closes Cluster U FOLLOWUP 5. (Bundles into the Cluster U FU 6 smoke above.)

## [0.313.0] - 2026-04-29

§13 / Cluster T FOLLOWUP 5, per-section documentation parity check in the QA-CHECKLIST. Before sign-off, the release manager now runs a pass through ARCHITECTURE / BRIDGE / REPRODUCIBLE_BUILDS / VERIFY-RELEASE / GLOSSARY / THREAT_MODEL / MAINTAINERS / SECURITY / CONTRIBUTING / CODE_OF_CONDUCT to confirm each doc still matches what the code actually does. A doc that lies is worse than one that's silent.

`docs/QA_Checklist.md` gains a "Documentation parity check" section above Sign-off with one bullet per major doc and concrete questions to verify (e.g., "every BRIDGE.md method is registered in handlers.js", "GPG fingerprint placeholder is up to date", "Last reviewed footer was bumped if process changed"). The new audit smoke pins both the bullet existence and that each named doc actually exists on disk so the checklist isn't pointing at thin air.

### Added

- **`docs/QA_Checklist.md`**, Documentation parity check section + Last reviewed footer bumped.
- **`test/smoke/audits/docs-governance-checklist.smoke.js`** (new), pins the QA-CHECKLIST + CONTRIBUTING governance content + on-disk file existence.

Closes Cluster T FOLLOWUP 5.

## [0.312.0] - 2026-04-29

§13 / Cluster T FOLLOWUP 4, Governance section in CONTRIBUTING.md. Contributors landing on CONTRIBUTING.md now see how decisions are made (lazy consensus + lead-maintainer tiebreak), where to escalate (cross-link to MAINTAINERS.md), and when to open an issue first vs. PR first (anything that touches architecture / public bridge API / build pipeline / threat model / legal text / protocol gets a pre-PR issue).

`CONTRIBUTING.md` adds the Governance section before Sign-off and bumps the Last reviewed footer. The doc smoke covers the cross-link to MAINTAINERS.md.

### Added

- **`CONTRIBUTING.md`**, Governance section + Last reviewed bump.

Closes Cluster T FOLLOWUP 4. (Bundles into the Cluster T FU 5 smoke above.)

## [0.311.0] - 2026-04-29

§13 / Cluster T FOLLOWUP 2, Verify_Release.md surfaced from Settings → About. The verification recipe (key import → manifest download → GPG verify → artifact hash check → optional reproduce) lives at `docs/Verify_Release.md`; the About panel previously only linked to `docs/Reproducible_Builds.md`, leaving the user to discover the per-step recipe themselves.

`packages/core/src/buildInfo.js` exports `VERIFY_RELEASE_DOC = 'docs/Verify_Release.md'`. `AboutSection.jsx` imports it and renders a "Verify a release" row pointing at the doc via the existing DocLink primitive.

### Added

- **`packages/core/src/buildInfo.js`**, `VERIFY_RELEASE_DOC` constant.
- **`packages/core/src/shared/components/settings/AboutSection.jsx`**, "Verify a release" row.
- **`test/smoke/ui/about-verify-release.smoke.js`** (new), pins the constant, the on-disk doc, and the section wiring.

Closes Cluster T FOLLOWUP 2.

## [0.310.0] - 2026-04-29

§25.2 / Cluster J FOLLOWUP 1, synthesized fabricated balances + history for the demo wallet. Demo wallets are real BIP39 wallets, they have real addresses on real chains; only on-chain balances are zero. Until v0.310.0 a user exploring the demo saw empty Home / History / TokenDetail surfaces, which makes the demo feel broken. This ships overlaid SDK-shaped fixture data so Send / Receive / History flows feel populated without requiring the user to fund the wallet.

`packages/core/src/flows/demoFixtures.js` (new) exports `synthesizeDemoBalances(addressesByChain)`, `synthesizeDemoHistory(chainId, address)`, and `synthesizeDemoLinks()`. `synthesizeDemoBalances` mirrors the `getWalletBalances` shape: first address per chain gets a non-zero native balance + token assets; additional addresses get zero so the row still renders. `synthesizeDemoHistory` returns 2 entries per known chain, an incoming SEND (pending, exercises the timeline pending state) and a confirmed ISSUE that mints a fictional `DEMOCOIN`. `synthesizeDemoLinks` returns `[]` (cross-chain LINK fabrication is deferred).

`packages/core/src/shared/routes/Home.jsx` checks `flowsLib.isDemoWallet(walletId)` before calling `messaging.getWalletBalances`; when true it fetches the address list and routes through `synthesizeDemoBalances`. `History.jsx` does the same with `synthesizeDemoHistory` + `synthesizeDemoLinks`. The rest of the wallet code (`balancesFromSdk`, simulator, history grouping, TxStatusTimeline) accepts the synthesized shape unchanged.

### Added

- **`packages/core/src/flows/demoFixtures.js`** (new), three fixture builders.
- **`packages/core/src/flows/index.js`**, re-exports the new symbols.
- **`packages/core/src/shared/routes/Home.jsx`**, demo-aware balance fetch.
- **`packages/core/src/shared/routes/History.jsx`**, demo-aware history fetch.
- **`test/smoke/ui/demo-wallet-fixtures.smoke.js`** (new), pins flow exports, behavioral output, and Home + History wiring.

Closes Cluster J FOLLOWUP 1.

## [0.309.0] - 2026-04-29

§25.2 / Cluster J FOLLOWUP 5, full LICENSE.md text rendered inline in Settings → About. The panel previously linked to a repo path; users had to navigate to GitHub to read what they'd agreed to. v0.309.0 ships the full GNU Affero General Public License v3.0 (AGPL-3.0) text directly in the panel via a Show full text / Hide full text toggle.

`packages/core/src/license.js` (new) exports `LICENSE_TEXT`: a `const` template literal carrying the canonical license body. The new licence-full-text smoke pins byte-for-byte equality with `LICENSE.md` (modulo trailing whitespace) so future edits to the canonical file flag a sync drift instead of silently desyncing.

`packages/core/src/shared/components/settings/AboutSection.jsx` adds a `licenseOpen` state, a Show/Hide toggle button next to the existing License DocLink (with `aria-expanded` + `aria-controls`), and a `<pre id="full-license-text">` that renders the text when expanded.

### Added

- **`packages/core/src/license.js`** (new), `LICENSE_TEXT` export.
- **`packages/core/src/shared/components/settings/AboutSection.jsx`**, toggle + inline reveal.
- **`test/smoke/ui/license-full-text.smoke.js`** (new), pins the export, the sync invariant, and the section wiring.

Closes Cluster J FOLLOWUP 5.

## [0.308.0] - 2026-04-29

§25.2 / Cluster J FOLLOWUP 6, demo wallet auto-expire after a configurable TTL (default 24 hours). Without this, an abandoned demo wallet sat in localStorage indefinitely; v0.308.0 self-cleans so the user lands back on Welcome instead of seeing a stale "throwaway wallet" banner indefinitely.

`packages/core/src/flows/demoMode.js` extends `markDemoWallet(walletId, opts)` to record both a created-at timestamp and a TTL in localStorage (keys `xc:demoWalletCreatedAt` + `xc:demoWalletTtlMs`). New `getDemoWalletExpiry()`, `isDemoWalletExpired(opts)`, and `DEMO_DEFAULT_TTL_MS` exports. `clearDemoWalletId` wipes all three keys. The existing `markDemoWallet(walletId)` call site (Onboarding.jsx) keeps working, `opts` is fully optional.

`packages/core/src/shared/components/DemoBanner.jsx` adds an interval-based auto-exit (60-second cadence): when `isDemoWalletExpired()` flips true, the banner fires the same `removeWallet` + `clearDemoWalletId` + `onExited` chain it does on the manual Exit button. Banner copy gains an "Auto-wipes in Xh Ym" countdown hint so the user sees the deadline approaching.

### Added

- **`packages/core/src/flows/demoMode.js`**, TTL persistence + new exports.
- **`packages/core/src/flows/index.js`**, re-exports the new symbols.
- **`packages/core/src/shared/components/DemoBanner.jsx`**, auto-exit hook + countdown copy.
- **`test/smoke/ui/demo-wallet-expire.smoke.js`** (new), pins the storage round-trip, expiry semantics, and banner wiring.

Closes Cluster J FOLLOWUP 6.

## [0.307.0] - 2026-04-29

§25.2 / Cluster J FOLLOWUP 2, `<DemoBanner>` mounts in the shared full-layout header slot for web + desktop so the indicator persists across every unlocked view, not just Home. Popup keeps the existing Home-only mount since the popup is always compact and constrained.

`packages/web/src/App.jsx` and `packages/desktop/renderer/App.jsx` import `DemoBanner` and add it inside `FullLayoutWithNav.header` next to `QueuedBroadcastBanner`. `packages/core/src/shared/routes/Home.jsx` gates the existing inline `<DemoBanner>` mount on `shell === 'popup'` so web/desktop don't double-render the banner on Home.

### Added

- **`packages/web/src/App.jsx`**, **`packages/desktop/renderer/App.jsx`**, DemoBanner import + mount in `FullLayoutWithNav.header`.
- **`packages/core/src/shared/routes/Home.jsx`**, popup-shell gating on the inline DemoBanner mount.

Closes Cluster J FOLLOWUP 2.

## [0.306.0] - 2026-04-29

§12 / Cluster S FOLLOWUP 4, blocklist mutation audit log. Adding or removing an entry in `settings.blockedOrigins` now records a `{ at, action, entry, evictedSiteIds? }` row in `settings.blocklistAuditLog`. Capped at 50 entries (oldest fall off). Idempotent re-adds and no-op removes are skipped, only real state changes are logged.

`packages/core/src/flows/blocklist.js` adds `withAudit` / `trimAudit` helpers, plus `listBlocklistAuditLog` + `clearBlocklistAuditLog` exports. `addBlockedOrigin` records the evicted site count when a wildcard pattern triggers cascade eviction. `packages/extension/src/background/createBackgroundHost.js` registers `sites.auditLog.list` + `sites.auditLog.clear` host routes; popup + web messaging both grow `listBlocklistAuditLog` + `clearBlocklistAuditLog` shims.

`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx` mounts a new `<BlocklistAuditPanel>` between the blocked-origins panel and the throttle panel. The panel renders entries newest-first, scrollable, with a Clear log button. Mount is gated on `messaging.listBlocklistAuditLog` availability so non-extension shells without the wiring degrade silently.

`packages/core/src/schemas/settings.js` adds the `blocklistAuditLog?: AuditEntry[]` field as a v2-tolerant typedef + validator branch.

### Added

- **`packages/core/src/flows/blocklist.js`**, audit ring-buffer + 4 new exports (`withAudit`, `trimAudit`, `listBlocklistAuditLog`, `clearBlocklistAuditLog`).
- **`packages/core/src/flows/index.js`**, re-exports the new symbols.
- **`packages/core/src/schemas/settings.js`**, `blocklistAuditLog` typedef + validator branch.
- **`packages/extension/src/background/createBackgroundHost.js`**, `sites.auditLog.list` + `sites.auditLog.clear` host routes.
- **`packages/extension/src/popup/messaging.js`**, **`packages/web/src/messaging.js`**, `listBlocklistAuditLog` + `clearBlocklistAuditLog` shims.
- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`**, `<BlocklistAuditPanel>`.
- **`test/smoke/ui/blocklist-audit-log.smoke.js`** (new), pins flow exports, behavioral add/remove/idempotent/cap behavior, schema validator, host routes, messaging shims, panel wiring.

Closes Cluster S FOLLOWUP 4.

## [0.305.0] - 2026-04-29

§12 / Cluster S FOLLOWUP 3, wildcard / domain blocklist entries. v0.220.0 only matched exact origins; a malicious operator with multiple subdomains under one parent could rotate hosts to skirt the blocklist. v0.305.0 accepts patterns like `*.example.com` so users can block whole domains in one entry.

`packages/core/src/flows/blocklist.js` adds `parseWildcardPattern` (returns the bare domain on match) and `normalizeBlocklistEntry` (wildcard kept verbatim, exact origins normalized to `URL.origin`). `isOriginBlocked` recognizes wildcard entries and matches subdomains via `URL.host` + `endsWith('.<domain>')`. The bare apex is NOT matched by `*.example.com`: users add the apex separately if they want it covered, mirroring browser cookie scoping conventions.

`addBlockedOrigin` accepts wildcards and, when the new entry is a wildcard, walks `connectedSites.list()` to evict every existing record whose origin matches the pattern (the existing exact-match `findBy('origin', …)` only handles exact origins). UI hint in `ConnectedSitesSection` updated to mention wildcards + the apex caveat; manual-block input placeholder shows both forms.

### Added

- **`packages/core/src/flows/blocklist.js`**, `parseWildcardPattern` + `normalizeBlocklistEntry` + wildcard branch in `isOriginBlocked` / `addBlockedOrigin`.
- **`packages/core/src/flows/index.js`**, re-exports `parseWildcardPattern` + `normalizeBlocklistEntry`.
- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`**, UI hints + placeholder updated for wildcards.
- **`test/smoke/ui/blocklist-wildcards.smoke.js`** (new), pins parse rules, isOriginBlocked branches, addBlockedOrigin wildcard cascade, and UI hints.

Closes Cluster S FOLLOWUP 3.

## [0.304.0] - 2026-04-29

§12 / Cluster S FOLLOWUP 2, persistent throttle state across SW restarts. The token-bucket sign-throttle was process-scoped, a service-worker restart wiped the bucket map, so a malicious dApp that just got rate-limited could burst-spam right after reload because the wallet "forgot" its recent timestamps. v0.304.0 persists the bucket state so the limit holds across restarts.

`packages/core/src/flows/signThrottle.js` extends `createSignThrottle` to accept `onPersist(snapshot)` (fired fire-and-forget on every check / clear), `initialState.buckets` (hydrate at construction), and a new `seed(persistedBuckets)` method (splice persisted timestamps into the live map without re-firing onPersist; merges + sorts so the windowMs eviction stays chronological, no Set dedupe so distinct same-millisecond requests survive).

`packages/extension/src/background/signThrottleStorage.js` (new) mirrors the broadcast-queue-storage shape: `chrome.storage.local` for extension SW, `localStorage` for web/desktop renderers, `null` for tests. Defensive `coerceSnapshot` filters anything that isn't a finite-number array so a corrupt persisted shape can't crash the background process at boot.

`createBackgroundHost` constructs the throttle with `onPersist` wired to `signThrottleStorage.save` and kicks off async hydration via `signThrottle.seed`. While hydration is pending the throttle starts on an empty bucket, worst case a first-request-after-SW-restart slips through, no worse than the v0.219.0 reset-on-restart behavior.

### Added

- **`packages/core/src/flows/signThrottle.js`**, `onPersist`, `initialState`, `seed()`, `snapshot()` exports.
- **`packages/extension/src/background/signThrottleStorage.js`** (new), pluggable persistence adapter.
- **`packages/extension/src/background/createBackgroundHost.js`**, wires storage adapter into the throttle.
- **`test/smoke/ui/sign-throttle-persistence.smoke.js`** (new), pins flow surface, behavioral persistence round-trip, storage adapter shape, and host wiring.

Closes Cluster S FOLLOWUP 2.

## [0.303.0] - 2026-04-29

§12 / Cluster S FOLLOWUP 1, sign-throttle limits exposed in Settings. The per-origin token-bucket limiter has shipped since v0.219.0 with hardcoded defaults (5 requests / 60 s); some users hit it during legitimate heavy use (cross-chain swap pipelines that issue 6+ signs back-to-back), while others want tighter limits for hardened security postures. v0.303.0 makes both axes user-configurable.

`packages/core/src/schemas/settings.js` adds `signThrottle?: { burst?: number, windowMs?: number }` as a v2-tolerant field with bounds constants (`SIGN_THROTTLE_BURST_MIN/MAX = 1/1000`, `SIGN_THROTTLE_WINDOW_MS_MIN/MAX = 1_000/86_400_000`). Either field may be omitted to fall back to the throttle-layer default.

`packages/core/src/flows/signThrottle.js` extends `createSignThrottle` to accept a `getLimits()` callback that's called on every `check()` so settings updates take effect on the very next request without rebuilding the throttle (in-flight buckets keep their timestamps). Static `burst` / `windowMs` options remain for back-compat.

`packages/extension/src/background/createBackgroundHost.js` constructs the throttle with `getLimits` reading from a closure cache hydrated by `vault.settings.get`. The cache refreshes on every `settings.update` whose patch touches `signThrottle`, plus opportunistic hydration on the first `settings.get` after SW boot.

`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx` mounts a `<SignThrottlePanel>` at the bottom with burst + window-seconds inputs and an Apply button. The panel surfaces the "Currently in effect" values so users can see what's running even when their input fields are blank (i.e., using defaults).

### Added

- **`packages/core/src/schemas/settings.js`**, `signThrottle` typedef, bounds constants, validator branch.
- **`packages/core/src/flows/signThrottle.js`**, `getLimits` callback support; live-reactive limits.
- **`packages/extension/src/background/createBackgroundHost.js`**, closure cache + opportunistic refresh; passes throttle into `registerBridgeHandlers`.
- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`**, `<SignThrottlePanel>`.
- **`test/smoke/ui/sign-throttle-settings.smoke.js`** (new), pins schema fields, getLimits wiring, host cache refresh, and panel UI.

Closes Cluster S FOLLOWUP 1.

## [0.302.0] - 2026-04-29

§19.5 / Cluster H FOLLOWUP 7, `Home.jsx` BackupReminderCard CTA now lands users directly on the Backup section instead of dropping them at the Settings root + forcing them to find the panel themselves.

`packages/core/src/shared/routes/Home.jsx` adds a `settingsSubpage` state alongside `settingsOpen`. The `<BackupReminderCard onAction>` callback now sets both, `setSettingsSubpage('backup'); setSettingsOpen(true)`: and the `<Settings>` mount threads the subpage in via the existing `initialSubpageId` prop. `onBack` from Settings clears the subpage so a later menu→Settings navigation opens at the root, not Backup.

Settings.jsx already accepted `initialSubpageId`; no change needed there. The `'backup'` id matches the existing `BackupSection` registration.

### Added

- **`packages/core/src/shared/routes/Home.jsx`**, `settingsSubpage` state; BackupReminderCard onAction sets it to `'backup'`; Settings.initialSubpageId threaded; onBack clears the subpage.
- **`test/smoke/ui/home-backup-deeplink.smoke.js`** (new), pins the state, the deep-link wiring, the existing `initialSubpageId` Settings contract, and the `'backup'` section id.

Closes Cluster H FOLLOWUP 7.

## [0.301.0] - 2026-04-29

§37.2 / Cluster D FOLLOWUP 1, Disconnect-site Undo toast. Tearing down a ConnectedSite is destructive, the dApp loses its granted permissions and has to re-prompt the user. v0.161.0 added an undo primitive for contact deletions; this extends the same affordance to the §35.5 Connected Sites panel.

`packages/extension/src/background/createBackgroundHost.js` registers a new `sites.restore` host method that takes a full ConnectedSite snapshot and writes it back via `vault.connectedSites.put`. The handler intentionally accepts the schema record verbatim, no field-by-field rebuild, so a future ConnectedSite schema addition won't silently break the round-trip.

`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx` imports `useToast`, snapshots the full record before calling `messaging.deleteConnectedSite`, and (when `messaging.restoreConnectedSite` is wired) surfaces a `useToast.showToast` with `actionLabel: 'Undo'`. The onAction callback re-creates the record via the new shim. The toast is gated on shim availability so a host that hasn't adopted the new shim degrades cleanly to today's no-undo behavior.

`packages/extension/src/popup/messaging.js` and `packages/web/src/messaging.js` add `restoreConnectedSite({ site })` shims routing to `sites.restore`. Desktop's renderer messaging doesn't expose `listConnectedSites` either; the section's pre-existing gating keeps it out of the desktop shell, so the desktop shim was intentionally skipped.

### Added

- **`packages/extension/src/background/createBackgroundHost.js`**, `sites.restore` host route.
- **`packages/extension/src/popup/messaging.js`**, **`packages/web/src/messaging.js`**, `restoreConnectedSite({ site })` shims.
- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`**, `useToast` import; `onDisconnect` snapshots the record and fires a `Disconnected … [Undo]` toast.
- **`test/smoke/ui/connected-sites-undo.smoke.js`** (new), pins the host validation, the messaging shims, and the section wiring.

Closes Cluster D FOLLOWUP 1.

## [0.300.0] - 2026-04-29

§20.4 / Cluster E FOLLOWUP 4, `PsbtSignForm` gains a "Scan PSBT" button that mounts the existing `<QrScanner>` against the form's paste pipeline. Each detected frame routes through `detectQrFrameFormat`:

- **XCW** chunks accrue against an `XcwCollector`; once the SHA-256-verified payload reassembles, the hex emits into the textarea and the scanner closes.
- **BBQr** frames append newline-separated to the existing textarea so the paste-pipeline's BBQr decoder picks them up via the same code path that handles a paste of a multi-frame export.
- **Single hex / base64** payloads close the scanner immediately.
- **UR** is recognized but ignored (Cluster U FOLLOWUP 2 tracks UR support).

`packages/core/src/shared/routes/PsbtSignForm.jsx` adds `scannerOpen` + `xcwCollector` state, a `handleScannerFrame` callback, an open-scanner reset effect that fresh-seeds the collector, and a "Scan PSBT" toggle button next to "Browse for .psbt file". The XCW collector progress (`receivedCount` of `total`) surfaces while a multi-frame capture is in flight.

### Added

- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, `QrScanner` import; XCW collector primitives import; `scannerOpen` + `xcwCollector` state; `handleScannerFrame` with XCW / BBQr / hex / base64 branches; UI toggle + progress label.
- **`test/smoke/ui/psbt-sign-scan.smoke.js`** (new), pins the imports, state, handler branches, UI toggle, progress label, and the open-scanner reset.

Closes Cluster E FOLLOWUP 4.

## [0.299.0] - 2026-04-29

§17.7 / Cluster E FOLLOWUP 5, `<ViewPrivateKey>` finally renders its QR. The component has accepted a `renderQR({ value })` render-prop since v0.166.0 (Cluster E Step 4) but both shells passed nothing, so the QR slot never lit up.

`packages/core/src/shared/components/KeyQR.jsx` (new) wraps the bundled `qrcode` library with a small `useEffect` that lazily encodes the value to a dataUrl, degrades silently to null on encode failure, and renders an `<img>` carrying the dataUrl. ECC level M and 200px width match the Receive-flow QRs.

`packages/extension/src/popup/App.jsx` and `packages/web/src/App.jsx` import `KeyQR` and pass `renderQR={({ value }) => <KeyQR value={value} alt="Private key QR" />}` to the existing ViewPrivateKey mount. Desktop doesn't route ViewPrivateKey today; the wiring lands when Desktop adds the route.

### Added

- **`packages/core/src/shared/components/KeyQR.jsx`** (new), lazy-encoded QR primitive.
- **`packages/extension/src/popup/App.jsx`**, **`packages/web/src/App.jsx`**, `KeyQR` import + `renderQR={…}` prop on the ViewPrivateKey mount.
- **`test/smoke/ui/view-private-key-qr.smoke.js`** (new), pins the new component, its silent-degrade contract, and the two-shell wiring.

Closes Cluster E FOLLOWUP 5.

## [0.298.0] - 2026-04-29

§30.4 / Cluster E FOLLOWUP 1, `PsbtSignForm` gains a hardware-wallet signing path. The paste-in form has shipped since v0.164.0 but only against software signers, when the chosen address was sourced from a paired Trezor / Ledger, the user was forced into a password input that wouldn't actually unlock anything.

`packages/core/src/flows/signFlows.js` extends `signPsbtFlow` to accept an optional `signer`. When supplied, the flow skips `unlockWallet` (no password KDF, no software-seed decryption) and does not call `.lock()` at the end, the caller owns the signer's lifecycle. Mirrors the same injected-signer pattern `submitAction` adopted for HW action signing.

`packages/extension/src/background/createBackgroundHost.js` registers a new `auth.signPsbt.hw` route. Mirrors `registerHwHandler` shape but auth.signPsbt's request carries `addressId` at the top level (rather than under `from`), so the generic helper can't be reused. The handler resolves the Address record, builds a `RemoteSigner` against the renderer-hosted Trezor / Ledger transport via `signerBridge.getTransport`, decomposes the PSBT to derive `signingPaths`, and delegates to the extended `signPsbtFlow` with the injected signer.

`packages/core/src/shared/routes/PsbtSignForm.jsx` derives `isHwSource` from the chosen address, threads the chosen signer into `useSignerInfo` for the firmware advisory banner, swaps the password input for `<HwSignBlock>` (cross-check + status banner), gates submit on `hwStatus === 'available'`, and branches the submit handler to `messaging.signPsbtUserInitiatedHw`. The submit button copy switches to `Sign on Trezor` / `Sign on Ledger`.

The three messaging shims (`packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js`) gain `signPsbtUserInitiatedHw({ walletId, addressId, psbtHex })`. Desktop's renderer was missing the prereq `parsePsbtRequest` + `signPsbtUserInitiated` shims entirely, PsbtSignForm was being routed in desktop App.jsx but couldn't actually parse or sign because the shims didn't exist; this commit ships those alongside.

Bookkeeping, Cluster E FOLLOWUP 2 (.psbt file drop / picker) was de facto closed at v0.209.0 (Cluster P G123 drag-and-drop) and Cluster E FOLLOWUP 3 (in-wallet broadcast) at v0.237.0 (Cluster W FOLLOWUP 1); the FOLLOWUPS.md ledger is updated to reflect that.

### Added

- **`packages/core/src/flows/signFlows.js`**, `signPsbtFlow` accepts optional `signer`; skips unlockWallet + .lock() when supplied.
- **`packages/extension/src/background/createBackgroundHost.js`**, `auth.signPsbt.hw` host route.
- **`packages/extension/src/popup/messaging.js`**, **`packages/web/src/messaging.js`**, **`packages/desktop/renderer/messaging.js`**, `signPsbtUserInitiatedHw` shim. Desktop also gains the previously missing `parsePsbtRequest` + `signPsbtUserInitiated` shims.
- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, `useSignerInfo` + `HwSignBlock` imports; `isHwSource` derivation; HW-aware submit branch; HW-gated status submit.
- **`test/smoke/ui/psbt-sign-hw.smoke.js`** (new), pins the flow change, host handler, three-shell shims, and form wiring.

Closes Cluster E FOLLOWUP 1.

## [0.297.0] - 2026-04-29

§23.5 / G052 / Cluster O FOLLOWUP 3, chain-filter memory gets a user-visible reset. v0.207.0 introduced `xc:chainFilter:*` localStorage keys so each list (History's enabled chains, Home's coin-family filter) remembers the user's last selection. There was no surface to inspect or clear that state, a user who found a list filtered unexpectedly had to know the key prefix to fix it.

`packages/core/src/shared/utils/chainFilterMemory.js` adds `clearAllChainFilters()`. The sweep walks `localStorage` via `length` + `key(i)` (rather than `Object.keys`, which sometimes lies in extension popup / service-worker contexts), filters by the `xc:chainFilter:` prefix, and calls `removeItem` for each match wrapped in try/catch so a single quota failure doesn't abort the rest of the sweep. Returns the count for UI confirmation; returns 0 when localStorage is unavailable.

`packages/core/src/shared/components/settings/DisplaySection.jsx` (§27.3 / §27.4 panel from Cluster I FOLLOWUP 1) grows a "List preferences" sub-section at the bottom with a "Reset list preferences" button. The callback runs `clearAllChainFilters()` and surfaces a one-shot status line (`role="status"` + `aria-live="polite"`), `"Reset N saved list filters. New filters apply on next visit."` or `"No saved list filters to reset."`: so the click doesn't feel inert. The reset takes effect on the next visit to a filtered list (the existing surfaces hydrate their state from localStorage on mount).

### Added

- **`packages/core/src/shared/utils/chainFilterMemory.js`**, `clearAllChainFilters()` named export.
- **`packages/core/src/shared/components/settings/DisplaySection.jsx`**, `clearAllChainFilters` import; `resetMessage` state; "List preferences" sub-section with the Reset button + aria-live status line.
- **`test/smoke/audits/chain-filter-reset.smoke.js`** (new), pins the export, the SW-safe sweep mechanics, the round-trip via a localStorage stub (preserves unrelated keys), and the DisplaySection wiring.

Closes Cluster O FOLLOWUP 3.

## [0.296.0] - 2026-04-29

§37.3 / G120 / Cluster P FOLLOWUP 1, haptic feedback gets an in-wallet opt-out toggle. Until now `useHaptic` only honored the OS-level `prefers-reduced-motion` query; users who wanted haptics off without disabling motion globally, or whose laptop/Bluetooth device's vibration motor was sharp enough to be more annoying than informative, had no in-wallet escape hatch.

`packages/core/src/schemas/settings.js` adds `settings.privacy.hapticsEnabled?: boolean` (v2-tolerant, undefined is fine and reads as default-true, so existing settings records keep their current behaviour). `createDefaultSettings` sets it to `true`; `validateSettings` accepts undefined or boolean. The schemaVersion stays at v2 since the field is optional.

`packages/core/src/shared/hooks/useHaptic.js` imports `useSettings`, derives `settingsEnabled = settings?.privacy?.hapticsEnabled !== false`, and adds `if (!settingsEnabled) return;` to the existing `fire` callback alongside the reduced-motion guard. Both checks suppress vibration silently, no error, no crash, no signal to the caller. Hook return shape is unchanged so existing callers (`ToastHost`, `Send`, `Locked`) work without modification.

`packages/core/src/shared/components/settings/PrivacySection.jsx` adds a "Haptic feedback" toggle row between the existing labels-survive-restore toggle and the clipboard auto-clear input. Toggle reads via the `!== false` default-true convention so a settings record migrated from a v1 vault renders as on without a write.

### Added

- **`packages/core/src/schemas/settings.js`**, `hapticsEnabled?: boolean` typedef + default-true seed + validator branch.
- **`packages/core/src/shared/hooks/useHaptic.js`**, `useSettings` import; `settingsEnabled` derivation; suppress branch in `fire`.
- **`packages/core/src/shared/components/settings/PrivacySection.jsx`**, "Haptic feedback" toggle row.
- **`test/smoke/ui/haptics-settings-opt-out.smoke.js`** (new), pins the hook wiring, the schema fields, and the Privacy panel toggle.

Closes Cluster P FOLLOWUP 1.

## [0.295.0] - 2026-04-29

§19.2 / Cluster H FOLLOWUP 6, backup-verification quiz scales with mnemonic length. The v0.176.0 quiz always asked for 3 positions regardless of phrase length, so 24-word users got the same coverage as 12-word users (statistically weaker). v0.295.0 scales the count proportionally: 12 → 3, 24 → 4 (formula `max(3, floor(totalWords / 6))`).

`packages/core/src/shared/utils/pickQuizPositions.js` (new) lifts the picker out of `CreateWallet.jsx` so it's directly importable from a unit-style smoke. Algorithm is unchanged otherwise: skip position 1 (the user just read it as the first row of the recovery-phrase grid), Fisher-Yates shuffle the remaining positions, greedily pick non-adjacent ones up to `targetCount`. The minimum-3 floor keeps short fixture phrases from collapsing to a one-position quiz.

`packages/core/src/shared/routes/CreateWallet.jsx` drops the inline definition and imports the shared util. Existing `handleStartVerify` call site is unchanged.

### Added

- **`packages/core/src/shared/utils/pickQuizPositions.js`** (new), extracted util with the Cluster H FOLLOWUP 6 scaling formula.
- **`packages/core/src/shared/routes/CreateWallet.jsx`**, `pickQuizPositions` import; inline definition removed; reference comment retained.
- **`test/smoke/onboarding/quiz-positions.smoke.js`** (new), pins 12-word→3 and 24-word→4 across 100 trials, position-1 skip, non-adjacency, sorted output, and the CreateWallet import wiring.

Closes Cluster H FOLLOWUP 6.

## [0.294.0] - 2026-04-29

§49.5 / G154 / Cluster G FOLLOWUP 3, reconnection prompt closes the auto-enqueue UX loop. The user signs while offline, the wallet auto-queues the signed hex (FOLLOWUP 1, v0.292.0), the queue survives reload (FOLLOWUP 2, v0.293.0), but until now there was no nudge when the network came back: the user had to notice the banner themselves. v0.294.0 fires a one-shot toast on every offline|degraded → normal transition with a non-empty queue.

`packages/core/src/shared/components/QueuedBroadcastBanner.jsx` subscribes to `useReachability()` for the `overall` value, tracks the previous value via `prevOverallRef`, and adds a `useEffect` that detects the recovery transition. When `prev === 'offline' || prev === 'degraded'` AND `next === 'normal'` AND `queue.length > 0`, the effect calls `showToast({ message, actionLabel: 'Open queue', onAction, durationMs: 12_000 })`. Toast copy honors plural, `"You have 1 queued transaction. Broadcast now?"` vs `"You have N queued transactions. Broadcast now?"`. The "Open queue" action focuses the banner (`bannerRef.current.focus()`) and scrolls it into view via `scrollIntoView({ block: 'center', behavior: 'smooth' })` so screen-reader + keyboard users land on the per-row Broadcast / Discard buttons.

A 60s dedupe floor on `lastPromptedAtRef` prevents a flapping connection from spamming the toast, if the link bounces offline → normal → offline → normal in a 60-second window, the user only sees one prompt. The banner div grows `ref={bannerRef} tabIndex={-1}` so the focus call has a target without changing the visual layout (tabIndex=-1 keeps the element out of the natural tab order; programmatic focus still works).

The reachability banner remains the user-visible source of truth for "you're offline" / "you're degraded"; the recovery toast only fires on the *positive* edge of the transition, leaving the negative-edge UX (going offline) handled exclusively by the existing ReachabilityBanner.

### Added

- **`packages/core/src/shared/components/QueuedBroadcastBanner.jsx`**, `useReachability` + `useToast` imports; `prevOverallRef` / `lastPromptedAtRef` / `bannerRef`; transition-detect useEffect; banner div gains ref + tabIndex.
- **`test/smoke/ui/reconnection-prompt.smoke.js`** (new), pins the imports, the prev/dedupe ref tracking, the transition guard chain (prev offline|degraded → next normal → non-empty queue → 60s dedupe), the singular/plural copy, the focus + scroll wiring, and the banner DOM ref + tabIndex.

Closes Cluster G FOLLOWUP 3. With FOLLOWUPs 1 + 2 + 3 done, §49.5 queued-broadcast UX is complete end-to-end: auto-enqueue on broadcast failure, persistence across reload, recovery prompt on reconnection.

## [0.293.0] - 2026-04-29

§49.5 / G154 / Cluster G FOLLOWUP 2, broadcast queue now survives reload. The v0.292.0 auto-enqueue change captured signed-but-unbroadcast txs into an in-memory map, but a service-worker restart, a tab refresh, or an Electron app relaunch wiped the queue and lost the user's work. v0.293.0 adds a pluggable storage adapter that rehydrates the in-memory map at host construction and writes back on every mutation.

`packages/extension/src/background/broadcastQueueStorage.js` (new) ships a single `createBroadcastQueueStorage()` picker that returns the right adapter for the current process: `chrome.storage.local` when the namespace is reachable (extension SW, Manifest V3 doesn't expose `localStorage` to service workers), `localStorage` when only that's reachable (web renderer + desktop renderer both have it natively), or `null` when neither is, falling back to in-memory only is the safe default for the smoke harness and unit-test environments. Each adapter exposes the same `{ load, save, clear }` shape with `load()` returning `Record<walletId, entry[]>` and `save(snapshot)` accepting the same shape; `coerceSnapshot` filters anything that doesn't match the canonical entry triple (`id` + `chainId` + `signedTxHex`) so a corrupt storage payload can't crash the background process at boot.

`packages/extension/src/background/createBackgroundHost.js` imports the picker, accepts a new `broadcastQueueStorage` dep (default = picker output; pass `null` explicitly to opt out), and adds two helpers around the existing `Map<walletId, entry[]>`: `ensureQueueLoaded()` (single-flight rehydrate guarded by `queueLoaded` + `queueLoadPromise` so concurrent callers share one storage read) and `persistQueue()` (serializes the map and writes back through the adapter, swallowing failures so a storage quota error never blocks a queue mutation). The four `broadcast.queue.*` host routes now `await ensureQueueLoaded()` before touching the map; `broadcast.queue.broadcast` and `broadcast.queue.discard` `await persistQueue()` after their splice; `pushQueueEntry` (the auto-enqueue path) fires `void persistQueue()` because the upstream `onBroadcastFailure` callers can't be made async retroactively. The auto-enqueue callbacks themselves got an `async (entry) => { await ensureQueueLoaded(); pushQueueEntry(walletId, entry); }` upgrade so a fast Send right after a worker restart can't race the rehydrate and orphan prior items. A `void ensureQueueLoaded()` at host construction kicks the storage read off eagerly so the queue is typically warm by the time the renderer mounts the QueuedBroadcastBanner.

Storage volume is small (an ECMAScript-encoded JSON object keyed by walletId, each entry ~200 bytes between the txid + summary + base64-ish hex), so neither `chrome.storage.local` (10 MB quota in MV3) nor `localStorage` (5–10 MB across browsers) is at risk. A future migration to vault-backed persistence (per Cluster H FOLLOWUP 5's pattern) would be a clean upgrade path if a per-wallet collection grows large enough to matter.

### Added

- **`packages/extension/src/background/broadcastQueueStorage.js`** (new), `createBroadcastQueueStorage()` picker + chrome / localStorage adapters + defensive `coerceSnapshot`.
- **`packages/extension/src/background/createBackgroundHost.js`**, `broadcastQueueStorage` dep with picker default; `ensureQueueLoaded` + `persistQueue` helpers; await-load on all four `broadcast.queue.*` routes; await-persist on the two mutating routes; fire-and-forget persist in `pushQueueEntry`; ensureQueueLoaded-awaiting upgrade for both auto-enqueue callbacks; eager `void ensureQueueLoaded()` at construction.
- **`test/smoke/ui/broadcast-queue-persistence.smoke.js`** (new), pins the picker fall-throughs, the createBackgroundHost wiring, the per-route awaits, the post-mutation persists, the eager load, and the ensureQueueLoaded-awaiting auto-enqueue callbacks.

Closes Cluster G FOLLOWUP 2.

## [0.292.0] - 2026-04-29

§49.5 / G154 / Cluster G FOLLOWUP 1, auto-enqueue signed transactions when the broadcast leg fails. Until now a broadcast failure mid-Send dropped the signed bytes on the floor: the user saw "Broadcast failed" and had to start the whole sign over after the network came back. Now the signed hex is captured into the §49.5 queued-broadcast surface and surfaces in the QueuedBroadcastBanner for one-tap retry.

`packages/core/src/sdk/submitWithSigner.js` exports a new `BroadcastFailedError` class. The phase-1 `encoder.broadcastTx(signed.txHex)` call (and the symmetric phase-2 call for P2SH/P2WSH two-phase sends) is wrapped in a try/catch that re-throws as `BroadcastFailedError` carrying `{ signedTxHex, txid, chainId, signedAt, encoding, phase }`. The error keeps the original cause in `err.cause` so callers that want to surface a network-specific message (timeout vs unreachable vs mempool-reject) can.

`packages/core/src/flows/submitAction.js` imports the typed error and adds an optional `onBroadcastFailure` opt. When the inner submit throws `BroadcastFailedError`, the existing `pendingTxMeta`-driven PendingTx record stamps `status: 'queued'` (instead of the prior `'failed'`) and populates `txHex` from `err.signedTxHex`: so the §28.4 status timeline + §44.4 RBF/cancel UX both have the signed bytes to work with. Then `onBroadcastFailure` fires with a queue-shaped entry (`{ signedTxHex, txid, chainId, signedAt, summary, error }`); failures inside the callback are swallowed so a queue-write hiccup doesn't mask the broadcast failure itself. Non-broadcast errors keep the prior `'failed'` path untouched.

`packages/core/src/flows/sendAsset.js` threads `opts.onBroadcastFailure` straight through to `submitAction`. Since `registerHwHandler('action.send.hw', sendAsset)` shares the same flow, both software-key and HW-signer Send lanes are covered by a single change.

`packages/extension/src/background/createBackgroundHost.js` factors the queue-push into a `pushQueueEntry(walletId, entry)` helper that mints a stable `id`, defaults the summary if the caller didn't supply one, and timestamps with `Date.now()` if `signedAt` is omitted. The helper backs three sites: a new `broadcast.queue.enqueue` host route (for explicit caller use, e.g. a future PsbtSignForm broadcast button parking a watcher-signed PSBT), the `action.send` handler (passes `onBroadcastFailure: (entry) => pushQueueEntry(walletId, entry)` into `sendAsset`), and `registerHwHandler` (injects the same callback into every HW action, sendHw, issueHw, mintHw, …, all 26 HW lanes, without duplicating wiring).

Three messaging shims grow `enqueueBroadcastRequest` (extension/popup, web, desktop) hitting the new route. Desktop also gains the prerequisite `listQueuedBroadcasts` / `broadcastQueuedRequest` / `discardQueuedRequest` shims it had been silently missing, the QueuedBroadcastBanner mounted via `FullLayoutWithNav.header` (Cluster G FOLLOWUP 4 / v0.272.0) was a no-op on desktop until now since `messaging.listQueuedBroadcasts` was undefined and the component returned early. Closing that gap as part of this work since both pieces are needed for the queue UX to work end-to-end on desktop.

Reachability-gating ("only enqueue when the chain is degraded") is intentionally out of scope for this step, any broadcast failure is treated as queue-worthy. Refining the condition once we have data on real-world transient broadcast failures is tracked as a future follow-up; the conservative "always enqueue" path is the safer default since the user explicitly chose to send.

### Added

- **`packages/core/src/sdk/submitWithSigner.js`**, `BroadcastFailedError` class export; phase-1 + phase-2 broadcast wraps.
- **`packages/core/src/flows/submitAction.js`**, `BroadcastFailedError` import; `onBroadcastFailure` opt; queued-vs-failed branching.
- **`packages/core/src/flows/sendAsset.js`**, `onBroadcastFailure` opt threaded into submitAction.
- **`packages/extension/src/background/createBackgroundHost.js`**, `pushQueueEntry` helper; `broadcast.queue.enqueue` route; `action.send` + `registerHwHandler` wiring.
- **`packages/extension/src/popup/messaging.js`**, `enqueueBroadcastRequest` shim.
- **`packages/web/src/messaging.js`**, `enqueueBroadcastRequest` shim.
- **`packages/desktop/renderer/messaging.js`**, `listQueuedBroadcasts` / `broadcastQueuedRequest` / `discardQueuedRequest` / `enqueueBroadcastRequest` shims (desktop's first shipping queue surface).
- **`test/smoke/ui/auto-enqueue-on-offline-broadcast.smoke.js`** (new), pins the four-layer wiring (typed error / submitAction handling / host route + helper / 3-shell shims).

Closes Cluster G FOLLOWUP 1; flips G154 from 🟡 partial to ✅ at v0.292.0.

## [0.291.0] - 2026-04-29

§49.3 / Cluster G FOLLOWUP 5, `<StalenessLabel>` adopted across the three surfaces it was built for. Until now the component shipped (v0.170.0 / G155) but no caller mounted it; users had no way to tell whether the data they were looking at was live or cached behind a stalled fetch.

`shared/routes/Home.jsx` tracks `balancesFetchedAt` (Unix ms, set after `messaging.getWalletBalances` resolves; reset to null on wallet/account switch alongside the existing `setBalances(null)`); threaded into `<HomeTabs balancesFetchedAt={…}>`. `shared/components/HomeTabs.jsx` renders `<StalenessLabel lastSyncedAt={balancesFetchedAt} warnAfterMs={5 * 60_000}>` between the tab strip and the panel, but only on Coins / Tokens / NFTs tabs, since Activity / DeFi placeholders aren't backed by the balance fetch.

`shared/routes/History.jsx` tracks `historyFetchedAt`, stamped right after the per-(chain, address) fan-out lands (`setEntries(all); setLoadingChains(new Set()); setHistoryFetchedAt(Date.now())`) and reset to null when the active chain set is empty. The label renders above the timeline once `loadingChains.size === 0`, matching the same 5-minute warn threshold.

`shared/routes/TokenDetail.jsx` tracks `holdersFetchedAt`, stamped on the holders fetch's success branch only (errors leave the timestamp at null so the label doesn't claim freshness against stale cached holders). Renders inside the holders panel header at a longer 10-minute warn threshold, holders churn slower than balances.

§49.3 honored throughout: every site keeps the timestamp at null until a real fetch succeeds, so the component renders nothing rather than fabricating a fresh-looking label over no data.

### Added

- **`packages/core/src/shared/routes/Home.jsx`**, `balancesFetchedAt` state; stamped on `setBalances(b)` success; reset on wallet/account switch; threaded into `<HomeTabs>`.
- **`packages/core/src/shared/components/HomeTabs.jsx`**, `StalenessLabel` import; `balancesFetchedAt` prop; gated render between tab strip and panel.
- **`packages/core/src/shared/components/HomeTabs.module.css`**, `.staleness` row utility class (flex justify-end with bottom padding).
- **`packages/core/src/shared/routes/History.jsx`**, `StalenessLabel` import; `historyFetchedAt` state; stamping at fan-out completion; reset when chain set empties; render above the timeline.
- **`packages/core/src/shared/routes/History.module.css`**, `.stalenessRow` utility class.
- **`packages/core/src/shared/routes/TokenDetail.jsx`**, `StalenessLabel` import; `holdersFetchedAt` state stamped on success only; render inside the holders panel.
- **`packages/core/src/shared/routes/TokenDetail.module.css`**, `.holdersStaleness` utility class.
- **`test/smoke/ui/staleness-label-adoption.smoke.js`** (new), pins the per-surface wiring (state slot + stamping point + reset path + import + render-gate).

Closes Cluster G FOLLOWUP 5.

## [0.290.0] - 2026-04-28

§48.5 / Cluster Q FOLLOWUP 4, `logConsole.record(...)` calls land at the highest-leverage emission points so the Developer Mode log viewer surfaces real wallet activity, not just `console.*` output.

`packages/core/src/storage/Vault.js` records `vault` lifecycle (open / close / clear). `packages/core/src/signers/SoftwareSigner.js` records `signer:software` events: unlock (per format including `wif-only`), lock, signPsbt, signMessage, signMultisigClassical, signMultisigPsbt, all with `chainId` for filtering, no key material in the message. `packages/core/src/flows/buildActionPsbt.js` records the `encoder` round-trip with action name and chainId. `packages/extension/src/bridge/handlers.js` shadows `host.register` with a local `register(name, handler)` that wraps every bridge channel in entry / exit / error log lines tagged `bridge:<channel>`: applied to all 11 handlers (connect, disconnect, getAccounts, getAddresses, getBalances, getSupportedChains, getActiveChains, signMessage, signAction, signPsbt, parallel, signIn) without touching their bodies.

Cross-process `developerMode` gating (e.g. extension SW vs popup not sharing the flag) stays deferred, the same-process buffer cap of 500 entries keeps memory bounded in the meantime, so this MVP can ship without the gate. The cross-process `logConsole.setEnabled()` plumbing flipped from a background settings-change listener will land alongside Cluster Q FOLLOWUP 5 (logConsole persistence + diagnostic-dump integration).

### Added

- **`packages/core/src/storage/Vault.js`**, `logConsole` import + `record(...)` calls on `open` / `close` / `clear`.
- **`packages/core/src/signers/SoftwareSigner.js`**, `logConsole` import + `record(...)` calls in unlock (BIP39 + counterwallet + wif-only branches) / lock / signPsbt / signMessage / signMultisigClassical / signMultisigPsbt.
- **`packages/core/src/flows/buildActionPsbt.js`**, `logConsole` import + encoder request + response records.
- **`packages/extension/src/bridge/handlers.js`**, `logConsole` import + local `register(name, handler)` wrapper; all 11 bridge channels routed through it.
- **`test/smoke/ui/log-console-emissions.smoke.js`** (new), pins the emission points and behavioural API contract.
- **`test/smoke/bridge/dapp-bridge-completeness.smoke.js`**, accepts either the bare `host.register('bridge.X')` form or the new wrapped `register('bridge.X')` form, since handlers.js now shadows host.register with a logging wrapper.

Closes Cluster Q FOLLOWUP 4.

## [0.289.0] - 2026-04-28

§27.4 / Cluster I FOLLOWUP 2, auto-hide-spam toast wired into Home.

`shared/routes/Home.jsx` mounts a one-shot useEffect after the balance load that aggregates raw `balances` via the existing `buildBalanceRows`, runs the v0.179.0 `detectSpamCandidates` heuristic, filters out anything the user already hid, and, when the fresh-candidate set is non-empty, surfaces a `useToast` nudge: `"N likely-spam tokens detected, bulk-hide?"` with a `Hide N` action that merges the candidates into `hiddenTokens` via `messaging.updateSettings`. A per-wallet ref guard (`spamNudgedForWalletRef`) prevents re-prompting on mid-session rebalances; switching to a different wallet resets it. Toast `durationMs` is 12s, long enough to read but shorter than the user's typical attention window. The classifier itself stays untouched (already conservative, only zero-balance non-native rows + sub-divisible no-fiat-rate dust).

### Added

- **`packages/core/src/shared/routes/Home.jsx`**, `useToast` import + `buildBalanceRows`/`detectSpamCandidates` import + `spamNudgedForWalletRef` + auto-nudge effect.
- **`test/smoke/audits/auto-hide-spam.smoke.js`** (new).

Closes Cluster I FOLLOWUP 2.

## [0.288.0] - 2026-04-28

§28.5 / Cluster I FOLLOWUP 5, History export gets a single modal with format / columns / date-range options.

`flows/historyExport.js` grows an optional `columns` parameter on `entriesToCsv` and `entriesToJson` (defaults to every `EXPORT_COLUMNS` field for backward compatibility) plus a `filterEntriesByDateRange({ fromTs, toTs })` helper that filters by inclusive epoch-second bounds and drops timestamp-less rows. JSON payload now echoes the column set used in its `columns` field; both `link` and `raw` sidecars stay outside the column-set so JSON exports remain decodable end-to-end.

`shared/routes/History.jsx` replaces the two Export-CSV / Export-JSON chips with a single "Export…" trigger that opens an inline `<ExportModal>` (`role="dialog"` + `aria-modal`, Esc-to-close, scrim-click-to-close). The modal carries: format radio (CSV / JSON), per-column checkbox group sourced from `EXPORT_COLUMNS`, scope radio (filtered vs everything-loaded), and date-range inputs that pre-fill from the active `dateFrom` / `dateTo` filter and override only when changed. `runExport` (renamed from `exportVisibleHistory`) threads the column subset through to the generators.

### Added

- **`packages/core/src/flows/historyExport.js`**, `EXPORT_COLUMNS`, `filterEntriesByDateRange`, optional `columns` arg.
- **`packages/core/src/flows/index.js`**, re-exports the new symbols.
- **`packages/core/src/shared/routes/History.jsx`**, `ExportModal` component + state slots + scope/columns/date wiring.
- **`test/smoke/audits/history-export-modal.smoke.js`** (new).

Closes Cluster I FOLLOWUP 5.

## [0.287.0] - 2026-04-28

§27 / Cluster I FOLLOWUP 7, retire `<UnifiedBalanceList>`.

`packages/core/src/shared/components/UnifiedBalanceList.jsx` and its CSS module had been orphaned since the BalanceList consolidation, `grep` across every shell turns up zero JSX usage and zero imports. The FOLLOWUP shape said "either retire or thread pin/hide through it"; verifying no caller mounts it makes retirement the right call. Both files removed; the dangling references in `chainFilterMemory.js` (header comment) and `test/boundary/amounts/bigint-format.test.js` (formatAmount provenance comment) reworded to point at the balance-row layout instead.

The two existing smokes that asserted UnifiedBalanceList parity (`empty-state-nudge.smoke.js` and `token-detail.smoke.js`) drop their UnifiedBalanceList sections and renumber the rest. New smoke pins the *absence* of the file + zero references in source + the smoke-section renumbering, so a future regression that recreates the orphan gets caught immediately.

### Removed

- **`packages/core/src/shared/components/UnifiedBalanceList.jsx`**.
- **`packages/core/src/shared/components/UnifiedBalanceList.module.css`**.

### Changed

- **`packages/core/src/shared/utils/chainFilterMemory.js`**, header reword.
- **`test/smoke/ui/empty-state-nudge.smoke.js`**, drop section 3, renumber.
- **`test/smoke/ui/token-detail.smoke.js`**, drop section 3, renumber.
- **`test/boundary/amounts/bigint-format.test.js`**, provenance comment.

### Added

- **`test/smoke/audits/unified-balance-list-retired.smoke.js`** (new).

Closes Cluster I FOLLOWUP 7.

## [0.286.0] - 2026-04-28

§27.3 / §27.4 / Cluster I FOLLOWUP 1, Settings → Display panel for pinned + hidden token management.

`shared/components/settings/DisplaySection.jsx` is a new internal-drill panel that surfaces both lists at a glance. Pinned tokens render in their array order with ↑ / ↓ reorder buttons (drag-reorder deferred per FOLLOWUPS.md note, up/down still closes the gap), Unpin removes the row. Hidden tokens render below with a per-row Unhide and a bulk "Unhide all". Both lists go through the existing `useSettings().update` path so the mutations land on the shared `messaging.updateSettings` flow that Home already drives from its star / hide affordances.

`Settings.jsx` mounts the panel between Appearance and Language & Region with a search-keyword bag (`pinned hidden tokens reorder unhide bulk star`) and a `displaySummary` that reads "N pinned · M hidden" or "No customization" so the list view shows current state without drilling in.

### Added

- **`packages/core/src/shared/components/settings/DisplaySection.jsx`**, new panel.
- **`packages/core/src/shared/routes/Settings.jsx`**, DisplaySection import + section entry + `displaySummary` helper.
- **`test/smoke/audits/display-settings-panel.smoke.js`** (new).

Closes Cluster I FOLLOWUP 1.

## [0.285.0] - 2026-04-28

§24.3 / Cluster Y FOLLOWUP 1, dedicated scan-and-classify route.

`shared/routes/ScanRoute.jsx` ships a top-level Scan view that mounts `<QrScanner>` (with a textarea paste fallback for browsers without `BarcodeDetector`) over the existing §32.2 `detectQrContent` classifier. Each scanned frame runs through detect + (for `xchain:` URIs) `parseXchainUri`, and on the first recognised payload the scanner stops and `onClassified` fires once with one of `{ kind: 'send', address, amount, asset, chainId, memo }`, `{ kind: 'receive' }`, or `{ kind: 'psbt', psbtHex }`. WIF / mnemonic / multi-frame XCW classifications surface a clear "use Import Wallet" or "use the Sign panel" message instead, secret material is never auto-imported from a casual scan.

`shared/components/BottomTabBar.jsx` swaps Receive for Scan in `PRIMARY_TABS` per §24.3 spec (`[Home] [History] [Send] [Scan] [More]`) and lists Receive in the More sheet so the surface stays one tap away. `shared/components/LeftNav.jsx` grows a Scan row between Receive and DEX with a matching `VIEW_GROUPS.scan` entry.

Web + desktop + extension popup `App.jsx` all import `ScanRoute`, declare a `'scan'` top-level view guarded on `activeWalletId`, and route the three outcomes via the existing `setSendPrefill` + `setUnlockedView('send' | 'receive' | 'sign-psbt')` paths. Desktop additionally gains a `sendPrefill` state slot, it didn't have one yet because the `?uri=` deep-link route only existed in web + popup.

### Added

- **`packages/core/src/shared/routes/ScanRoute.jsx`**, new component.
- **`packages/core/src/shared/components/BottomTabBar.jsx`**, Scan in PRIMARY_TABS, Receive moved to SHEET_PRIMARY.
- **`packages/core/src/shared/components/LeftNav.jsx`**, Scan row + `VIEW_GROUPS.scan`.
- **`packages/web/src/App.jsx`**, ScanRoute import + 'scan' view + outcome routing.
- **`packages/desktop/renderer/App.jsx`**, ScanRoute import + 'scan' view + `sendPrefill` state + outcome routing.
- **`packages/extension/src/popup/App.jsx`**, ScanRoute import + 'scan' view + outcome routing.
- **`test/smoke/audits/scan-route.smoke.js`** (new).

Closes Cluster Y FOLLOWUP 1.

## [0.284.0] - 2026-04-28

§50 / Cluster L FOLLOWUP 3, diagnostic dump redaction sweep + AboutSection preview.

`flows/diagnosticDump.js` now hashes user-supplied custom endpoint URLs (`settings.sdkEndpoints[chainId].{explorerUrl,encoderUrl,hubUrl}`) into stable `redacted:sha256:<8-hex>` strings via `redactCustomUrl`. Built-in defaults from the chain registry continue to pass through verbatim. The hash is deterministic across runs so a single user's dumps remain comparable, but the original hostname (private node, internal proxy) never leaves the wallet. Header comment grows a HASH category alongside NEVER / COUNT / INCLUDE so future Settings additions know the rule.

`shared/components/settings/AboutSection.jsx` ships a "Show preview" toggle next to "Copy diagnostics". The preview pre fetches the dump via the existing `messaging.getDiagnosticDump` path, caches it, and renders the pretty-printed JSON inside a scrollable monospace region wired with `aria-expanded` + `aria-controls` for assistive tech. The user sees exactly what they're about to paste before they paste it.

### Added

- **`packages/core/src/flows/diagnosticDump.js`**, `redactCustomUrl` helper + sha256 import; HASH section in header docstring.
- **`packages/core/src/shared/components/settings/AboutSection.jsx`**, `previewOpen` / `preview` / `previewBusy` state; `fetchDump` extraction; `handleTogglePreview`; preview region with aria wiring.
- **`test/smoke/audits/diagnostic-dump-redaction.smoke.js`** (new).

Closes Cluster L FOLLOWUP 3.

## [0.283.0] - 2026-04-28

§47 / Cluster L FOLLOWUP 2, extension popup deep-link via manifest `protocol_handlers`.

The web shell wired `navigator.registerProtocolHandler('web+xchain', '/?uri=%s')` at v0.191.0; v0.193.0's Cluster L FOLLOWUP 1 added consumer-side `?uri=` parsing in the web App.jsx. This step mirrors that wiring in the extension popup so a `web+xchain:` click anywhere in the browser lands directly inside the popup with the Send route prefilled. Manifest gains a `protocol_handlers` block claiming `web+xchain` → `popup.html?uri=%s`. Popup App.jsx imports `uri as coreUri` from `@xchain-wallet/core`, declares a `sendPrefill` state slot, parses `?uri=` once on mount, routes send/receive, and strips the param via `history.replaceState` so a re-open doesn't re-trigger. Send renders with `prefill={sendPrefill}`; back-navigation clears the prefill.

### Added

- **`packages/extension/manifest.json`**, `protocol_handlers` block.
- **`packages/extension/src/popup/App.jsx`**, `coreUri` import + `sendPrefill` state + `?uri=` parsing effect + `<Send prefill=...>` wiring.
- **`test/smoke/ui/extension-uri-deeplink.smoke.js`** (new).

Closes Cluster L FOLLOWUP 2.

## [0.282.0] - 2026-04-28

§18.4 / Cluster N FOLLOWUP 1, runtime-fetched firmware manifest with bundled fallback.

`flows/firmwareManifestRefresh.js` adds the orchestrator: `refreshFirmwareManifest({ fetch, verify, cache, url, publicKey, now })` fetches a signed JSON envelope `{ manifest, signature }`, verifies the signature against the bundled public key, and writes the verified payload to a pluggable cache backend with a `fetchedAt` timestamp. Failure modes return structured codes, `not-configured`, `network`, `schema`, `signature`: and never write the cache, so a CDN outage or a tampered payload cannot downgrade the safety baseline.

`resolveActiveFirmwareManifest({ cache, now, ttlMs })` is the consumer-facing resolver. Cache hit within TTL → use cached payload (`source: 'cache'`). Cache empty or stale (older than `FIRMWARE_MANIFEST_TTL_MS = 24h`) → fall back to the bundled `FIRMWARE_MANIFEST` (`source: 'bundled'`). Stale cache is treated identically to cache miss to prevent silent downgrades on extended outages.

`checkFirmware` gains an optional `manifest` arg (back-compat default = bundled), so callers can pass the resolver's output through.

`buildInfo.js` exports `FIRMWARE_MANIFEST_URL`, `FIRMWARE_MANIFEST_PUBLIC_KEY` (both empty pre-launch, gated on §51 release-signing key publication), and `FIRMWARE_MANIFEST_TTL_MS`. The refresh flow short-circuits to `not-configured` until both are filled.

Partial coverage note: the cache backend is plumbed but only the in-memory adapter (`createInMemoryFirmwareManifestCache`) ships today, chrome.storage.local / IndexedDB / userData adapters land alongside the §51 release-signing infrastructure.

### Added

- **`packages/core/src/flows/firmwareManifestRefresh.js`**, `refreshFirmwareManifest` + `resolveActiveFirmwareManifest` + `createInMemoryFirmwareManifestCache` + `FIRMWARE_MANIFEST_CACHE_KEY`.
- **`packages/core/src/flows/index.js`**, re-exports the new symbols.
- **`packages/core/src/buildInfo.js`**, `FIRMWARE_MANIFEST_URL`, `FIRMWARE_MANIFEST_PUBLIC_KEY`, `FIRMWARE_MANIFEST_TTL_MS`.
- **`packages/core/src/signers/checkFirmware.js`**, optional `manifest` arg.
- **`test/smoke/signers/firmware-manifest-refresh.smoke.js`** (new).

Closes Cluster N FOLLOWUP 1 (with a partial-coverage note on shell cache backends, those land with the release-signing key).

## [0.281.0] - 2026-04-28

§25.1 / Cluster J FOLLOWUP 4, license re-acceptance gate covers the unlocked Add-Wallet lane.

`buildInfo.js` exports a new `LICENSE_VERSION` constant (initial value `'1'`). Onboarding persists the version alongside the existing `xc:licenseAcceptedAt` timestamp under a new `xc:licenseAcceptedVersion` key, and gates on `licenseSatisfied = !!licenseAcceptedAt && licenseAcceptedVersion === LICENSE_VERSION`. The gate condition is now `if (!licenseSatisfied)`: the previous `&& !onBack` bypass is gone, so a version bump forces re-acceptance even from the unlocked-vault Add-Wallet entry point. Pre-versioned acceptances (anyone who accepted before this release) read back as null version → treated as stale → users see the gate once on next launch and re-accept.

### Added

- **`packages/core/src/buildInfo.js`**, `LICENSE_VERSION = '1'`.
- **`packages/core/src/shared/routes/Onboarding.jsx`**, `LICENSE_VERSION_KEY` + `readAcceptedVersion()` + `licenseAcceptedVersion` state + `licenseSatisfied` derived flag; `markAccepted` writes both keys; gate fires on `!licenseSatisfied` regardless of `onBack`.
- **`test/smoke/onboarding/license-version-gate.smoke.js`** (new).

Closes Cluster J FOLLOWUP 4.

## [0.280.0] - 2026-04-28

§43.2 / Cluster F FOLLOWUP 1, actually emit bridge events.

The provider listener pipeline was wired in Phase 1 (content script relays `chrome.runtime.onMessage({ type: 'bridge.event', … })` → page postMessage → inject script dispatches to subscribers registered through `provider.on(...)`), but no background sender existed, dApps subscribed and never received anything. v0.280.0 adds a broadcaster + threads it through the bridge handlers.

`createBridgeEventBroadcaster({ tabs, runtime })` returns `{ accountsChanged, chainChanged, disconnect }`. Each method runs `chrome.tabs.query`, filters tabs by `URL.origin` against the supplied origin, and `chrome.tabs.sendMessage`s a `{ type: 'bridge.event', event, payload }` envelope to each match. Tabs without a `url`, with malformed URLs, or sitting on a different origin are silently dropped (a dApp on origin A must never see another origin's events). Without a `chrome.tabs` surface the broadcaster degrades to a no-op so non-extension shells don't crash.

`emitPermissionDiff` is the diff helper that bridge handlers call after `updateSitePermissions`: it fires `accountsChanged` only when the accounts set actually changes and `chainChanged` only when a single new chain is added. `bridge.disconnect` fires `events.disconnect(origin, 'user-requested')` after the connected-site delete.

Partial coverage note: bare-vault `vault.accounts.put` writes (e.g. a new account created from Settings while a site permits all accounts) still need a vault-level subscription to surface `accountsChanged`. That land alongside the Settings → Connected Sites editor.

### Added

- **`packages/extension/src/bridge/bridgeEvents.js`**, `createBridgeEventBroadcaster` + `emitPermissionDiff` + `noopBridgeEvents`.
- **`packages/extension/src/bridge/index.js`**, re-exports the new symbols.
- **`packages/extension/src/bridge/handlers.js`**, `events` opt threaded through `bridge.disconnect` + `updateSitePermissions`.
- **`packages/extension/src/background/createBackgroundHost.js`**, accepts `bridgeEvents` dep; passes through.
- **`packages/extension/src/background.js`**, constructs broadcaster against `chrome.tabs` + `chrome.runtime`.
- **`test/smoke/bridge/bridge-events-emit.smoke.js`** (new).

Closes Cluster F FOLLOWUP 1.

## [0.279.0] - 2026-04-28

§12 / Cluster S FOLLOWUP 5, test-dapp surfaces BLOCKED_BY_USER + THROTTLED.

`MockProviderOptions` gains `blockedSite` and `throttle: { retryAfterMs, burst?, windowMs? }`. A new `maybeBlockedOrThrottled()` helper short-circuits `connect` / `signMessage` / `signAction` / `signPsbt` / `signIn` before any other work, the dApp branch for "blocked, no retry" and "throttled, retry-after" is now reachable from the mock without touching the production wallet.

`example.ts` adds `handleSignActionResult` (returns a tagged `SignActionUiOutcome` with 7 branches: success / rejected / walletLocked / panic / unsupported / blocked / throttled / error) and `signActionWithRetry` (loops on THROTTLED up to `maxRetries`, sleeping `retryAfterMs` between attempts, with an injectable sleep for tests). `runErrorScenarios` walks both branches against the mock and returns the rendered outcomes a UI would surface. The blocked branch produces a static "Blocked by user, un-block in wallet Settings." message; the throttled branch produces "Retry in {seconds}s." with `retryAfterMs` / `burst` / `windowMs` forwarded for the caller.

### Added

- **`packages/test-dapp/src/mock-provider.ts`**, `blockedSite` + `throttle` options; `maybeBlockedOrThrottled` helper threaded through five sign* methods.
- **`packages/test-dapp/src/example.ts`**, `handleSignActionResult` + `SignActionUiOutcome` type + `signActionWithRetry` + `runErrorScenarios` + `ErrorScenarioReport`.
- **`packages/test-dapp/src/index.ts`**, re-exports the new symbols + types.
- **`test/smoke/bridge/test-dapp-error-scenarios.smoke.js`** (new).

Closes Cluster S FOLLOWUP 5.

## [0.278.0] - 2026-04-28

§47 / Cluster L FOLLOWUP 5, `describeXchainIntent` localized intent labels.

New helper alongside `parseXchainUri` that renders a human-readable sentence for a parsed `xchain:` URI: "Send 0.5 BTC to bc1qxy…0wlh", "Receive 100 XCP", "Unrecognized link", etc. Picks one of 13 send/receive templates based on which fields the intent carries (amount + asset, asset alone, address alone, bare). Address gets middle-truncated (head 6 / tail 4) when over 14 chars. Consumers pass the i18n namespace from `@xchain-wallet/core` so the active locale drives translation; missing keys fall back to English.

### Added

- **`packages/core/src/uri/xchainUri.js`**, `describeXchainIntent(intent, { i18n })` helper + `shortenAddress` internal.
- **`packages/core/src/uri/index.js`**, re-exports `describeXchainIntent`.
- **`packages/core/src/i18n/locales/en/index.js`**, 13 `uri.intent.*` keys.
- **`test/smoke/core/xchain-uri-describe.smoke.js`** (new).

Closes Cluster L FOLLOWUP 5.

## [0.277.0] - 2026-04-28

§50 / Cluster L FOLLOWUP 4, diagnostic dump fills env / build / signers.

The `diagnostic.dump` host handler in `createBackgroundHost` now accepts a `getDiagnosticContext` callback that supplies `env` + `build`. The signers list is computed inside the handler from `vault.wallets.list()` + `listSignersForWallet(vault, walletId)` so each shell doesn't have to duplicate the per-wallet iteration.

Each shell wires its own callback:
- **Extension** (`background.js`): `shell: 'extension'` + `navigator.userAgent` + manifest version.
- **Web** (`hostBridge.js`): `shell: 'web'` + `navigator.userAgent` (across all three `createBackgroundHost` call sites: create / create-existing / unlock).
- **Desktop** (`main/index.js` → `runtime.js` → `messageHost.js`): `shell: 'desktop'` + Electron/Chrome/Node versions + OS platform/arch + `app.getVersion()`. The callback threads through `createRuntime` deps so `ensureHost` keeps it alive across lock cycles.

Result: support tickets that include the diagnostic dump now identify which shell + build + paired devices were running, instead of the previous bare wallet metadata.

### Added

- **`packages/extension/src/background/createBackgroundHost.js`**, `getDiagnosticContext` dep + signer iteration in the dump handler.
- **`packages/extension/src/background.js`**, **`packages/web/src/hostBridge.js`**, **`packages/desktop/main/index.js`**, shell-specific callbacks.
- **`packages/desktop/main/runtime.js`**, passes `getDiagnosticContext` through to `createDesktopMessageHost`.
- **`test/smoke/audits/diagnostic-dump-shell-context.smoke.js`** (new).

Closes Cluster L FOLLOWUP 4.

## [0.276.0] - 2026-04-28

§18.4 / Cluster N FOLLOWUP 2 (final), useSignerInfo sweep across HW sign surfaces.

Last four authoring surfaces adopt the hook: ExecuteContractForm, StakingActionForm (boolean-`isHwSource` shape) plus SwapForm and ComposeMessage (helper-`hw = isHwSource(fromAddress)` shape). Each threads `signerInfo={hwSignerInfo}` into its `<SignCredentials>` block. Total: 9 of ~10 sign surfaces now consume the hook; the multisig signing flow runs a different code path and stays a future FOLLOWUP if needed.

### Changed

- **`packages/core/src/shared/routes/ExecuteContractForm.jsx`**, **`StakingActionForm.jsx`**, **`SwapForm.jsx`**, **`ComposeMessage.jsx`**, adopt useSignerInfo; thread signerInfo through SignCredentials.
- **`test/smoke/ui/use-signer-info.smoke.js`**, extended to pin both adoption shapes (boolean isHwSource + helper-style `hw`).

Closes Cluster N FOLLOWUP 2.

## [0.275.0] - 2026-04-28

§18.4 / Cluster N FOLLOWUP 2 (continued), useSignerInfo sweep across HW sign surfaces.

Four more authoring surfaces adopt the v0.274.0 hook: BroadcastForm, DividendForm, DestroyForm, TokenAdminForm. Each picks up the SignerRecord lookup with a one-line `useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null })` and threads `signerInfo={hwSignerInfo}` into its `<SignCredentials>` block. Result: when the user signs from a hardware wallet on any of these forms, `<HwFirmwareBanner>` now renders the firmware advisory + derivation-path cross-check copy that previously only Send showed.

Remaining surfaces (SwapForm, ExecuteContractForm, StakingActionForm, ComposeMessage, multisig signing) follow the same one-liner pattern; queued as a continuation FOLLOWUP.

### Changed

- **`packages/core/src/shared/routes/BroadcastForm.jsx`** + **`DividendForm.jsx`** + **`DestroyForm.jsx`** + **`TokenAdminForm.jsx`**, adopt `useSignerInfo`; thread `signerInfo` through `<SignCredentials>`.
- **`test/smoke/ui/use-signer-info.smoke.js`**, extended to pin all four new adopters.

Closes Cluster N FOLLOWUP 2 partially (continued sweep, 5 of ~9 surfaces now adopt the hook).

## [0.274.0] - 2026-04-28

§18.4 / Cluster N FOLLOWUP 2 (partial), `useSignerInfo` hook + Send.jsx adoption.

`packages/core/src/shared/hooks/useSignerInfo.js` consolidates the SignerRecord-lookup plumbing every HW sign surface needs to render `<HwFirmwareBanner>` + the derivation-path advisory copy. The hook owns a module-level walletId-keyed cache so re-mounting a sign surface inside the same view doesn't refetch `messaging.listSigners`.

Send.jsx is the first adopter, its previous inline `signersByWallet` state + useEffect + useMemo lookup collapses to one `useSignerInfo({ walletId, signerId })` call. The remaining sign surfaces (TokenAdminForm, BroadcastForm, DividendForm, SwapForm, ExecuteContractForm, DestroyForm, StakingActionForm, ComposeMessage, plus the multisig signing flow) follow the same pattern; this commit closes the FOLLOWUP partially with the hook + first-class adopter shipped, and the broader sweep continues as a successor FOLLOWUP.

### Added

- **`packages/core/src/shared/hooks/useSignerInfo.js`**, hook + `__clearSignerInfoCache` test helper.
- **`test/smoke/ui/use-signer-info.smoke.js`** (new).

### Changed

- **`packages/core/src/shared/routes/Send.jsx`**, swap inline lookup for `useSignerInfo`.

Closes Cluster N FOLLOWUP 2 partially (hook landed; sweep across remaining HW sign surfaces continues).

## [0.273.0] - 2026-04-28

§53 / Cluster K FOLLOWUP 2, focus-visible ring sweep on interactive primitives.

Eight clickable primitives that previously relied on the browser-default focus ring now declare an explicit `:focus-visible { outline: 2px solid var(--xc-focus-ring); outline-offset: 2px }` rule. The default ring becomes invisible against the dark + high-contrast palettes; the explicit rule keys to the `--xc-focus-ring` token (which itself shifts per palette) so keyboard users see a consistent indicator everywhere.

Targets: `AlertsOverlay.close`, `BackupReminderCard.dismissBtn`, `HwSignBlock.refresh`, `QueuedBroadcastBanner.{broadcastBtn,discardBtn}`, `RawPsbtViewer.{toggle,copyBtn}`, `ReachabilityBanner.retry`, `FeeSelector.tier`. HeaderNetworkButton inherits `.btn:focus-visible` from `HeaderSettingsButton.module.css` so it didn't need an additional rule.

### Added

- **`packages/core/src/shared/components/AlertsOverlay.module.css`** etc. (7 files), `:focus-visible` rules.
- **`packages/core/src/ui/FeeSelector.module.css`**, `.tier:focus-visible`.
- **`test/smoke/ui/focus-visible-sweep.smoke.js`** (new), pins each rule to `--xc-focus-ring`.

Closes Cluster K FOLLOWUP 2.

## [0.272.0] - 2026-04-28

§49 / Cluster G FOLLOWUP 4, QueuedBroadcastBanner persists across every unlocked view.

`FullLayoutWithNav` grew a `header` slot rendered above the route content. Web + desktop App.jsx mount `<QueuedBroadcastBanner walletId={activeWalletId} />` there so the banner survives navigation between Send / History / Markets / etc., not only Home. The web shell drops its Home-only mount; the desktop shell gains the banner for the first time.

CSS rework: `.main` becomes a flex column (header + body); `.header` takes natural height; `.mainBody` fills remaining space and re-asserts `--xc-screen-h: 100%` so the route's `<Screen>` still fills the available area.

### Added

- **`packages/core/src/shared/components/LeftNav.jsx`**, `FullLayoutWithNav` accepts a `header` prop.
- **`packages/core/src/shared/components/LeftNav.module.css`**, `.header` + `.mainBody` flex-column rules.
- **`packages/web/src/App.jsx`** + **`packages/desktop/renderer/App.jsx`**, pass QueuedBroadcastBanner through the new header slot. Web App's pre-existing Home-fallback mount removed.
- **`test/smoke/ui/queued-broadcast-banner-persistence.smoke.js`** (new).

### Changed

- **`test/smoke/ui/bottom-tab-bar.smoke.js`**, FullLayoutWithNav-signature assertion accepts the post-FOLLOWUP `header` slot.

Closes Cluster G FOLLOWUP 4.

## [0.271.0] - 2026-04-28

§47 / Cluster L FOLLOWUP 1, web `?uri=` deep-link routing.

v0.191.0 registered the web SPA as the protocol handler for `xchain:` URIs (`/?uri=%s`). This commit adds the consumer side: on mount the SPA reads `?uri=` from `location.search`, parses via `coreUri.parseXchainUri`, and routes to Send (with `address` / `amount` / `asset` / `chainId` / `memo` prefilled) or Receive based on the parsed intent's `kind`. The query param is stripped via `history.replaceState` so a refresh doesn't re-trigger.

`Send.jsx` grew an opt-in `prefill` prop. Initial form state seeds from `prefill?.address` / `prefill?.amount` / `prefill?.asset` / `prefill?.chainId` / `prefill?.memo`. The first-chain auto-select effect now preserves a prefilled `chainId` (`setChainId((prev) => prev || firstChain)`) so the deep-link's choice survives the addresses-by-chain load.

### Added

- **`packages/core/src/shared/routes/Send.jsx`**, new `prefill` prop seeding the form state.
- **`packages/web/src/App.jsx`**, `coreUri` import, `sendPrefill` state slot, mount-time `?uri=` parse + route effect, query-param strip via `history.replaceState`, Send route reads `prefill={sendPrefill}` and clears on back.
- **`test/smoke/ui/web-uri-deeplink.smoke.js`** (new).

Closes Cluster L FOLLOWUP 1.

## [0.270.0] - 2026-04-28

§37 / Cluster D FOLLOWUP 4, toast queue stacking limit.

ToastHost caps the number of simultaneously visible toasts at 3 (`VISIBLE_LIMIT`). When a fourth toast lands, the oldest stays in the queue (with its auto-dismiss timer running) but doesn't render; an aria-hidden `+N more` badge floats above the visible stack to signal the queue depth. As earlier toasts dismiss, queued ones surface in arrival order so every action's feedback is eventually seen.

The aria-live region still announces queued toasts as they surface, the badge is decorative; screen readers don't double-count it.

### Added

- **`packages/core/src/shared/components/ToastHost.jsx`**, `VISIBLE_LIMIT = 3`; `toasts.slice(-VISIBLE_LIMIT)` drives the render set; conditional `+N more` overflow badge.
- **`packages/core/src/shared/components/ToastHost.module.css`**, `.overflowBadge` style (small pill, muted color, no pointer events).
- **`test/smoke/ui/toast-stacking-limit.smoke.js`** (new).

Closes Cluster D FOLLOWUP 4.

## [0.269.0] - 2026-04-28

§26 / Cluster O FOLLOWUP 1, auto-lock for the desktop shell.

`Home.useAutoLock` enable predicate gains `shell === 'desktop'` so an idle Electron renderer auto-locks on the same `settings.autolockMinutes` cadence as the popup + web shells. The shared hook listens for window-level `mousemove` / `keydown` / `scroll` / `click` / `touchstart` events; Electron renderer is Chromium so the same listener set works unchanged.

`useAutoLock.js` header rewritten, no longer claims web is the lone opt-out; the hook now serves all three shells.

### Changed

- **`packages/core/src/shared/routes/Home.jsx`**, `useAutoLock` enable predicate covers popup + web + desktop.
- **`packages/core/src/shared/hooks/useAutoLock.js`**, header comment reflects the new tri-shell behaviour.

### Added

- **`test/smoke/ui/auto-lock-desktop.smoke.js`** (new).

Closes Cluster O FOLLOWUP 1.

## [0.268.0] - 2026-04-28

§24 Cluster Y FOLLOWUPs 2+3, Settings entry-point from nav + wallet-name surfacing.

LeftNav's Settings footer button now actually navigates: web + desktop App.jsx ship a new `'settings'` top-level view that renders `<Settings>` directly (mirroring how Home renders it inline). A `'connected-sites'` alias deep-links into the Connected Sites drilldown via the new `Settings.initialSubpageId` prop, so the spec's implied "Connected" left-nav row has somewhere to land.

LeftNav's wallet switcher now shows the active wallet's name. App.jsx tracks `walletList` alongside `activeWalletId` and derives `activeWalletName` via `.find()` for both LeftNav (footer label) and the new Settings route (passes `activeWallet` through to the Settings component, mirroring Home).

LeftNav VIEW_GROUPS gains a `settings: ['settings', 'connected-sites']` mapping so the gear row stays highlighted across both routes; the Settings footer button gets `aria-current="page"` like the primary rows.

### Added

- **`packages/core/src/shared/routes/Settings.jsx`**, new `initialSubpageId` prop seeds the drilldown state on mount.
- **`packages/core/src/shared/components/LeftNav.jsx`**, `VIEW_GROUPS.settings` covers `'settings'` + `'connected-sites'`; Settings footer button gets `aria-current` + `itemActive` styling.
- **`packages/web/src/App.jsx`** + **`packages/desktop/renderer/App.jsx`**, `Settings` import; `walletList` state; `'settings' | 'connected-sites'` top-level route; `handleOpenSettings`; `walletName` thread into `<LeftNav>`; `onOpenSettings` thread into both navs.
- **`test/smoke/ui/left-nav-settings-route.smoke.js`** (new), pins all of the above.

Closes Cluster Y FOLLOWUPs 2 + 3.

## [0.267.0] - 2026-04-28

§9, Cluster Z Step 2 of 2, G002 standalone `@xchain-wallet/signers-ledger` package.

Mirror of v0.266.0's signers-trezor split. `packages/signers-ledger/` ships as a new workspace package; `LedgerSigner.js` + `ledgerFormat.js` move out of `packages/core/src/signers/` into `packages/signers-ledger/src/`. Cross-package Signer base import via `../../core/src/signers/Signer.js` (relative path convention). `@noble/hashes` declared as a runtime dep (used by `deriveLedgerDeviceIdentifier`'s `sha256`).

`packages/core/src/signers/index.js` keeps a back-compat re-export for `LedgerSigner` / `deriveLedgerDeviceIdentifier` / `modelFromLedgerTransport`. `pnpm install --no-frozen-lockfile` registered the second new package (10 packages total). `makeLedgerFactory` in core stays as the post-init pair sequence.

**Cluster Z closed at v0.267.0**, both vendor-signer packages (Trezor + Ledger) now live in their own workspace projects per the §9 architecture goal. Future signer vendors (Coldcard, BitBox, etc.) follow the same split.

### Added

- **`packages/signers-ledger/package.json`**, workspace package with `exports` map covering the entry + the two impl files; `@noble/hashes` runtime dep.
- **`packages/signers-ledger/src/index.js`**, canonical export entry (LedgerSigner + helpers + ledgerFormat helpers).
- **`packages/signers-ledger/src/LedgerSigner.js`**, moved from `packages/core/src/signers/LedgerSigner.js`; Signer base imported via relative cross-package path.
- **`packages/signers-ledger/src/ledgerFormat.js`**, moved from `packages/core/src/signers/ledgerFormat.js`.
- **`test/smoke/signers/signers-ledger-package.smoke.js`** (new), pins the package layout, exports map, and back-compat shim.

### Changed

- **`packages/core/src/signers/index.js`**, LedgerSigner re-export now points at `../../../signers-ledger/src/LedgerSigner.js`.
- **`pnpm-lock.yaml`**, refreshed to register the second new workspace project.
- **`test/smoke/signers/ledger-signer.smoke.js`**, reads LedgerSigner.js + ledgerFormat.js from the new package path.
- **`test/smoke/multisig/multisig-psbt-signing.smoke.js`** + **`test/smoke/multisig/multisig-signer.smoke.js`**, direct LedgerSigner.js path imports follow the move (mechanical update; these smokes are pre-existing baseline FAILs for unrelated multisig reasons).

Closes G002. Cluster Z closed.

## [0.266.0] - 2026-04-28

§9, Cluster Z Step 1 of 2, G001 standalone `@xchain-wallet/signers-trezor` package.

`packages/signers-trezor/` ships as a new workspace package. `TrezorSigner.js` + `trezorFormat.js` move out of `packages/core/src/signers/` into `packages/signers-trezor/src/`; the new package's `src/index.js` is the canonical export entry. Cross-package imports use relative paths (`../../core/src/signers/Signer.js`), the established convention so Node smokes resolve modules without depending on pnpm workspace symlinks.

`packages/core/src/signers/index.js` keeps a back-compat re-export pointing at the new location, so existing consumers that go through `import { signers } from '@xchain-wallet/core'` keep working without churn. `pnpm install --no-frozen-lockfile` (run as part of this commit) registered the new workspace project (now 9 packages) and updated the lockfile.

`makeTrezorFactory` (in `core/src/signerFactories/`) still owns the post-init pair sequence; it imports `TrezorSigner` via the back-compat re-export, so the factory stays untouched. Ledger remains in `core` for now, Cluster Z Step 2 (G002) will mirror this move for Ledger.

### Added

- **`packages/signers-trezor/package.json`**, workspace package with `exports` map covering the entry + the two impl files.
- **`packages/signers-trezor/src/index.js`**, canonical export entry (TrezorSigner + helpers + trezorFormat helpers).
- **`packages/signers-trezor/src/TrezorSigner.js`**, moved from `packages/core/src/signers/TrezorSigner.js`; Signer base imported via relative cross-package path.
- **`packages/signers-trezor/src/trezorFormat.js`**, moved from `packages/core/src/signers/trezorFormat.js`.
- **`test/smoke/signers/signers-trezor-package.smoke.js`** (new), pins the package layout, exports map, and back-compat shim.

### Changed

- **`packages/core/src/signers/index.js`**, TrezorSigner re-export now points at `../../../signers-trezor/src/TrezorSigner.js` (back-compat shim).
- **`pnpm-lock.yaml`**, refreshed to register the new workspace project.
- **`test/smoke/signers/trezor-signer.smoke.js`**, reads TrezorSigner.js + trezorFormat.js from the new package path.
- **`test/smoke/multisig/multisig-psbt-signing.smoke.js`** + **`test/smoke/multisig/multisig-signer.smoke.js`**, direct TrezorSigner.js path imports follow the move (these smokes are pre-existing baseline FAILs for unrelated multisig reasons; path update is mechanical so they're current when the underlying issue ships).

Closes G001.

## [0.265.0] - 2026-04-28

§24, Cluster Y Step 3 of N, G057 desktop multi-window support.

`packages/desktop/main/index.js` swaps the singleton `mainWindow` for a `windows` Set; `createWindow()` is a factory each call adds to the Set and `closed` removes from it. New `buildApplicationMenu()` installs a native menu with `File → New Window` (CmdOrCtrl+N) so the user can open additional windows that share the main-process MessageHost (vault + signers stay singleton per §9.3.2). Deep-link forwarding now picks the focused window (or last-created fallback); updater events broadcast to every live window.

Detach-pending-tx (§24.6 third bullet) defers to FOLLOWUP, that's a renderer-side context-menu integration on History rows + a window-options "open at view" route prefill, separable from the multi-window plumbing this step ships.

### Added

- **`packages/desktop/main/index.js`**, `windows` Set + `liveWindows()` / `pickFocusWindow()` / `broadcastToWindows()` helpers; `createWindow()` factory; `buildApplicationMenu()` with File → New Window; updater broadcast across all windows.
- **`test/smoke/shells/desktop-multi-window.smoke.js`** (new).

Closes G057. Cluster Y closed at v0.265.0, §24 has no remaining open rows.

## [0.264.0] - 2026-04-28

§24, Cluster Y Step 2 of N, G054 mobile bottom-sheet navigation.

New `<BottomTabBar>` in `packages/core/src/shared/components/`. Five thumb-reachable tabs at the bottom of the viewport (Home / History / Send / Receive / More); More toggles a bottom-sheet drawer listing the rest of the §24.2 nav (DEX / Dispensers / Contracts (BTC-gated) / Messaging / Contacts) plus footer items (Switch wallet, Settings, Lock). Esc and selecting a destination both dismiss the sheet.

`<FullLayoutWithNav>` grew a `bottomBar` slot. Web + desktop App.jsx pass `<BottomTabBar>` to that slot; the slot collapses above 600px so tablets and desktops keep the left-nav layout. Below 600px the route's main pane reserves bottom-padding equal to the 56px bar (+ iOS safe-area inset) so content doesn't hide behind the bar.

Spec deviation: §24.3 lists [Balances] [History] [Send] [Scan] [More]; the Scan slot is folded into More until a dedicated scan-and-classify route ships (FOLLOWUP §24.3).

### Added

- **`packages/core/src/shared/components/BottomTabBar.jsx`** + **`BottomTabBar.module.css`**, `<BottomTabBar>` named export.
- **`packages/core/src/shared/components/LeftNav.jsx`**, `FullLayoutWithNav` accepts a `bottomBar` prop.
- **`packages/core/src/shared/components/LeftNav.module.css`**, `.bottomBarSlot` (display:contents → none above 600px) + `.layoutWithBottomBar > .main` bottom-padding rule below 600px.
- **`packages/web/src/App.jsx`**, **`packages/desktop/renderer/App.jsx`**, pass a `<BottomTabBar>` to the new slot; lock + wallet-picker handlers extracted so both navs share them.
- **`test/smoke/ui/bottom-tab-bar.smoke.js`** (new).

### Changed

- **`test/smoke/ui/left-nav.smoke.js`**, onLock assertion accepts the extracted `handleNavLock` shape.

Closes G054.

## [0.263.0] - 2026-04-28

§24, Cluster Y Step 1 of N, G053 full-layout left navigation.

New `<LeftNav>` + `<FullLayoutWithNav>` in `packages/core/src/shared/components/`. Web + desktop App.jsx wrap the unlocked-route render tree in `<FullLayoutWithNav>` so the sidebar is mounted alongside every unlocked view. Below 900px the sidebar collapses (display:none) and the route fills the viewport, §24.3 / G054 mobile bottom-tab bar will pick up below 600px in a follow-up step. Extension popup intentionally untouched (always compact per §24.1).

Primary list: Home / History / Send / Receive / DEX / Dispensers / Contracts (BTC-only) / Messaging. Secondary: Contacts. Footer: wallet switcher, Lock. Active row gets `aria-current="page"`; drilldown views (token-detail, dispenser-detail, staking-dashboard, compose-message, …) keep the parent row highlighted via VIEW_GROUPS.

### Added

- **`packages/core/src/shared/components/LeftNav.jsx`** + **`LeftNav.module.css`**, `<LeftNav>` and `<FullLayoutWithNav>` exports.
- **`packages/web/src/App.jsx`**, **`packages/desktop/renderer/App.jsx`**, unlocked switch case wrapped in `<FullLayoutWithNav>`; route render tree captured by an IIFE so existing `if (..) return ..` branches stay intact.
- **`test/smoke/ui/left-nav.smoke.js`** (new).

Closes G053.

## [0.262.0] - 2026-04-28

§20, Cluster X Step 22 of N, CoinpayForm watcher-mode branch (action COINPAY).

COINPAY's PSBT needs `encoderOpts.customOutputs` to direct the buyer's payment to the matched seller's address, that's how the buyer-pays-seller leg of an ORDER match settles. In watcher mode, we explicitly pass `customOutputs: [{ address: summary.payeeAddress, value: summary.coinAmount }]` through `buildActionPsbtRequest`, mirroring the `coinpayAction` flow's encoder shape.

The local-state obligation removal only fires on a real broadcast, in watcher mode the obligation stays open in the list until the signed PSBT actually broadcasts on a Full-mode wallet.

### Added

- **`packages/core/src/shared/routes/CoinpayForm.jsx`**, watcher-mode branch with explicit `encoderOpts.customOutputs` preservation.
- **`test/smoke/ui/coinpay-watcher-mode.smoke.js`** (new).

## [0.261.0] - 2026-04-28

§20, Cluster X Step 21 of N, TokenAdminForm watcher-mode branch (action ISSUE, token admin uses ISSUE with admin-only fields).

In watcher mode the lock-mode variant flips from `'danger'` to `'primary'` for the same reason as DestroyForm, the action becomes "Build unsigned PSBT" (non-destructive); the destruction (lock) happens later on broadcast.

### Added

- **`packages/core/src/shared/routes/TokenAdminForm.jsx`**, watcher-mode branch + variant flip for lock mode.
- **`test/smoke/ui/token-admin-watcher-mode.smoke.js`** (new).

### Changed

- **`test/smoke/actions/token-admin-form.smoke.js`**, variant assertion accepts the new conditional shape.

## [0.260.0] - 2026-04-28

§20, Cluster X Step 20 of N, ExecuteContractForm watcher-mode branch (action EXECUTE).

### Added

- **`packages/core/src/shared/routes/ExecuteContractForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/execute-contract-watcher-mode.smoke.js`** (new).

### Changed

- **`test/smoke/contracts/execute-contract-form.smoke.js`**, HW-branch assertion accepts the new if/else cascade shape.

## [0.259.0] - 2026-04-28

§20, Cluster X Step 19 of N, DeployContractForm watcher-mode branch (action DEPLOY).

### Added

- **`packages/core/src/shared/routes/DeployContractForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/deploy-contract-watcher-mode.smoke.js`** (new).

### Changed

- **`test/smoke/contracts/deploy-contract-form.smoke.js`**, HW-branch assertion accepts the new if/else cascade shape.

## [0.258.0] - 2026-04-28

§20, Cluster X Step 18 of N, ContractFundsForm watcher-mode branch (DEPOSIT / WITHDRAW).

### Added

- **`packages/core/src/shared/routes/ContractFundsForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/contract-funds-watcher-mode.smoke.js`** (new).

## [0.257.0] - 2026-04-28

§20, Cluster X Step 17 of N, DelegationActionForm watcher-mode branch (DELEGATE / REVOKE_DELEGATION).

### Added

- **`packages/core/src/shared/routes/DelegationActionForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/delegation-watcher-mode.smoke.js`** (new).

## [0.256.0] - 2026-04-28

§20, Cluster X Step 16 of N, StakingActionForm watcher-mode branch.

The form's `mode` prop drives the chosen action, `UNSTAKE` (Tier 1 / Tier 2 unstake) or `CLAIM_REWARDS` (collect pending staking rewards). Watcher branch maps `isUnstake` → `'UNSTAKE'` / `'CLAIM_REWARDS'` and routes through `buildActionPsbtRequest` with the appropriate action.

### Added

- **`packages/core/src/shared/routes/StakingActionForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/staking-action-watcher-mode.smoke.js`** (new).

## [0.255.0] - 2026-04-28

§20, Cluster X Step 15 of N, CrossChainSwapForm watcher-mode branch (action SWAP, cross-chain GET_ADDRESS / EXPIRATION extras).

### Added

- **`packages/core/src/shared/routes/CrossChainSwapForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/cross-chain-swap-watcher-mode.smoke.js`** (new).

## [0.254.0] - 2026-04-28

§20, Cluster X Step 14 of N, SwapForm watcher-mode branch (action SWAP).

### Added

- **`packages/core/src/shared/routes/SwapForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/swap-watcher-mode.smoke.js`** (new).

## [0.253.0] - 2026-04-28

§20, Cluster X Step 13 of N, StakeForm watcher-mode branch (action STAKE).

### Added

- **`packages/core/src/shared/routes/StakeForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/stake-watcher-mode.smoke.js`** (new).

### Changed

- **`test/smoke/staking/stake-form.smoke.js`**, HW-vs-software-signing assertion accepts the new if/else cascade (was pinning the legacy ternary, which moved into the watcher-mode branch refactor).

## [0.252.0] - 2026-04-28

§20, Cluster X Step 12 of N, LinkForm watcher-mode branch (action LINK).

LinkForm composes the LINK action params explicitly (COIN1 / COIN1_ACTION_INDEX / COIN2 / COIN2_ACTION_INDEX / MEMO) since the legacy `messaging.linkAction` shim takes those as top-level fields rather than a `params` object, for the watcher-mode `buildActionPsbtRequest` call we re-wrap them into the canonical action-data shape that the linkAction flow internally builds.

### Added

- **`packages/core/src/shared/routes/LinkForm.jsx`**, watcher-mode branch with explicit LINK params construction.
- **`test/smoke/ui/link-watcher-mode.smoke.js`** (new).

## [0.251.0] - 2026-04-28

§20, Cluster X Step 11 of N, AdvancedActionsForm watcher-mode branch.

The user-chosen `action` variable is passed straight into `actionData.action`, so the watcher-mode branch handles ANY XChain action through one `buildActionPsbtRequest` call. Any action types not yet covered by a dedicated form (Step 4–10) are still reachable via this form's watcher path.

### Added

- **`packages/core/src/shared/routes/AdvancedActionsForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/advanced-watcher-mode.smoke.js`** (new).

## [0.250.0] - 2026-04-28

§20, Cluster X Step 10 of N, AirdropForm watcher-mode block.

AIRDROP is the first action in this sweep that genuinely doesn't fit the watcher-mode contract: it's a two-phase action (broadcast LIST, wait for indexer confirmation, broadcast AIRDROP referencing the indexed ACTION_INDEX). The index-wait step requires observing the LIST broadcast hitting the indexer, but in watcher mode the broadcast happens on a different wallet, so the watcher can't observe it. Wedging in a partial flow would strand the user mid-LIST. Block with a redirect instead.

### Added

- **`packages/core/src/shared/routes/AirdropForm.jsx`**, `useWalletMode` hook + early-return `<>` block in watcher mode (`Not available in watcher mode` panel + redirect to switch the wallet to full mode).
- **`test/smoke/ui/airdrop-watcher-mode.smoke.js`** (new), pins the block and asserts AirdropForm does NOT route through `buildActionPsbtRequest` (the action is blocked, not split).

## [0.249.0] - 2026-04-28

§20, Cluster X Step 9 of N, DividendForm watcher-mode branch (action DIVIDEND).

### Added

- **`packages/core/src/shared/routes/DividendForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/dividend-watcher-mode.smoke.js`** (new).

## [0.248.0] - 2026-04-28

§20, Cluster X Step 8 of N, BroadcastForm watcher-mode branch (action BROADCAST).

### Added

- **`packages/core/src/shared/routes/BroadcastForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/broadcast-watcher-mode.smoke.js`** (new).

## [0.247.0] - 2026-04-28

§20, Cluster X Step 7 of N, DestroyForm watcher-mode branch.

Same FOLLOWUP 5 pattern, action DESTROY. Destroy is destructive in full / HW signing, so the existing `variant="danger"` button stays put, but in watcher mode the form just emits an unsigned PSBT (the actual destruction happens later when a Signer-mode wallet signs and a Full-mode wallet broadcasts), so the variant flips to `'primary'` to match the other watcher-mode "Build unsigned PSBT" CTAs.

### Added

- **`packages/core/src/shared/routes/DestroyForm.jsx`**, watcher-mode branch + variant flip on the submit button.
- **`test/smoke/ui/destroy-watcher-mode.smoke.js`** (new).

### Changed

- **`test/smoke/actions/destroy-form.smoke.js`**, variant assertion accepts the new conditional shape; still pins that the danger variant exists somewhere in the file.

## [0.246.0] - 2026-04-28

§20, Cluster X Step 6 of N, DispenserForm watcher-mode branch.

Same FOLLOWUP 5 pattern, action DISPENSER. `useWalletMode` hook, `isWatcherMode` submit branch through `buildActionPsbtRequest`, gates skipped, watcher-mode hint at review, "Build unsigned PSBT" button, shared `<WatcherResultPanel>` at done stage, `handleBuildAnother` reset.

### Added

- **`packages/core/src/shared/routes/DispenserForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/dispenser-watcher-mode.smoke.js`** (new).

## [0.245.0] - 2026-04-28

§20, Cluster X Step 5 of N, MintForm watcher-mode branch.

Same FOLLOWUP 5 pattern as IssueTokenForm: `useWalletMode` hook, watcher-mode submit branch through `buildActionPsbtRequest({ action: 'MINT', params })`, password / HW gates skipped, watcher-mode hint at review, "Build unsigned PSBT" button label, shared `<WatcherResultPanel>` at done stage, `handleBuildAnother` reset.

### Added

- **`packages/core/src/shared/routes/MintForm.jsx`**, watcher-mode branch.
- **`test/smoke/ui/mint-watcher-mode.smoke.js`** (new), pins the wiring.

## [0.244.0] - 2026-04-28

§20, Cluster X Step 4 of N, IssueTokenForm watcher-mode branch.

First non-Send action surface to adopt the FOLLOWUP 5 pattern. `IssueTokenForm.jsx` reads `isWatcherMode` from `useWalletMode`, branches `handleSubmit` to `messaging.buildActionPsbtRequest({ chainId, from, actionData: { action: 'ISSUE', params } })` when watcher mode is on (skipping the password / HW gates entirely), swaps `<SignCredentials>` at review for an explanatory hint, flips the submit button label to "Build unsigned PSBT", and renders the shared `<WatcherResultPanel>` at the done stage when the result envelope carries `psbtHex` instead of `txid`. New `handleBuildAnother` resets the form back to its first stage so the user can compose another ISSUE without leaving the route.

Smoke baseline drops from 24 to 23 failures: the existing `actions/issue-form.smoke.js` was already asserting `setStage('form')` (anticipating a "build another" path); the new `handleBuildAnother` satisfies that assertion as a side effect.

### Added

- **`packages/core/src/shared/routes/IssueTokenForm.jsx`**, `useWalletMode` + `WatcherResultPanel` imports; `isWatcherMode` derivation; watcher-mode submit branch; review-stage hint copy; "Build unsigned PSBT" button label; `handleBuildAnother` reset; done-stage `WatcherResultPanel` branch when `result.psbtHex && !txid`.
- **`test/smoke/ui/issue-watcher-mode.smoke.js`** (new), pins the new imports + hook usage + submit branch + done-stage panel + review-stage hint.

## [0.243.0] - 2026-04-28

§20, Cluster X Step 3 of N, Extract WatcherResultPanel to a shared component.

The watcher-mode result UI (unsigned PSBT hex + animated QR + format toggle) was a private function inside `Send.jsx`. Lifted out to `packages/core/src/shared/components/WatcherResultPanel.jsx` so the upcoming non-Send action surfaces (IssueTokenForm / MintForm / DispenserForm / OrderForm / etc.) can render the same panel for FOLLOWUP 5's read-only sweep. CSS cloned to a dedicated `.module.css`; Send.module.css keeps its own `success*` classes since the broadcast-success card uses the same idiom.

The component accepts both `onBuildAnother` (the new prop name, since not every action surface is "Send") and `onSendAnother` (Send.jsx's legacy name), they alias to the same handler. A `title` prop overrides the default "Unsigned PSBT, ready for signing" heading so each form can phrase its own copy.

### Added

- **`packages/core/src/shared/components/WatcherResultPanel.jsx`** (new), shared component, named export.
- **`packages/core/src/shared/components/WatcherResultPanel.module.css`** (new), cloned from Send.module.css's `success*` rules.
- **`test/smoke/ui/watcher-result-panel.smoke.js`** (new), pins the extracted shape (imports, props, render, CSS classes).

### Changed

- **`packages/core/src/shared/routes/Send.jsx`**, drops the inline `WatcherResultPanel` function + the `encodeXcwChunks` / `encodeBbqrPsbtFrames` / `AnimatedQrFrames` imports (those move to the shared component); imports the shared `WatcherResultPanel` and renders it at the watcher-mode done stage.
- **`test/smoke/ui/send-watcher-mode.smoke.js`**, pins the new import + the negative assertion that `WatcherResultPanel` is no longer a local function and `encodeXcwChunks` / `encodeBbqrPsbtFrames` no longer appear in Send.jsx.

## [0.242.0] - 2026-04-28

§20, Cluster X Step 2 of N, useWalletMode hook + generic `buildActionPsbt` foundation (Cluster W FOLLOWUP 5 prep).

Foundation for the watcher-mode read-only sweep across non-Send action surfaces. Three pieces land together since they're co-dependent: a generic encode-only flow that any action can call, a host handler + three messaging shims that expose it, and a shared `useWalletMode` hook that subsequent forms will branch on.

The new `buildActionPsbt` flow is the encode-only path through `submitWithSigner`: Steps 1 + 2 (`createAction` + `encoder.createTx`) and nothing else. Generalized over `actionData` so ISSUE / MINT / DESTROY / DISPENSER / ORDER / SWAP / etc. share one watcher-mode lane (SEND keeps `buildSendPsbt` because the Send form layers fee tiering / recent-destinations / ADS donations on top). The new `useWalletMode` hook lifts Send.jsx's `walletMode` derivation into a reusable shape so each action form can `const { isWatcherMode } = useWalletMode();` instead of re-reading settings + WALLET_MODE_DEFAULT inline.

### Added

- **`packages/core/src/flows/buildActionPsbt.js`** (new), generic encode-only flow taking `{ chainId, from, actionData, encoderOpts? }`, returns the same `{ psbtHex, encoding, actionString, action, version, chainId, fromAddress }` envelope as `buildSendPsbt`. No vault / signer / broadcast.
- **`packages/core/src/flows/index.js`**, re-exports `buildActionPsbt`.
- **`packages/extension/src/background/createBackgroundHost.js`**, registers `action.psbt` host handler (chainRegistry + sdkRegistry deps; no vault).
- **`packages/extension/src/popup/messaging.js`** + **`packages/web/src/messaging.js`** + **`packages/desktop/renderer/messaging.js`**, `buildActionPsbtRequest(opts)` shim routing to `action.psbt`.
- **`packages/core/src/shared/hooks/useWalletMode.js`** (new), reads settings via `useSettings`, falls back to `WALLET_MODE_DEFAULT`, returns `{ walletMode, isFullMode, isWatcherMode, isSignerMode }`.
- **`test/smoke/ui/build-action-psbt-foundation.smoke.js`** (new), pins the flow, the host handler, the three shims, and the hook.

### Changed

- **`packages/core/src/shared/routes/Send.jsx`**, drops the inline `walletMode = settings?.walletMode || WALLET_MODE_DEFAULT;` derivation in favour of `const { isWatcherMode } = useWalletMode();`. Behaviour identical; `WALLET_MODE_DEFAULT` import removed (the hook handles the fallback).
- **`test/smoke/ui/send-watcher-mode.smoke.js`**, pins the new hook import + destructure shape.

Foundation only, no action form has been migrated yet. Subsequent steps adopt `useWalletMode` + `buildActionPsbtRequest` across IssueTokenForm / MintForm / DispenserForm / OrderForm / etc.

## [0.241.0] - 2026-04-28

§20, Cluster X Step 1 of N, Cluster W FOLLOWUP 4, BBQr export for `WatcherResultPanel`.

`WatcherResultPanel` (Send.jsx watcher-mode done stage) now offers a format toggle between XCW chunks (this wallet's native cross-chunk envelope) and BBQr H (hex) frames, the chunked-QR PSBT transport that Sparrow / Coldcard / SeedSigner natively understand. A user signing on a third-party wallet picks "BBQr (Sparrow / Coldcard / SeedSigner)" and gets a stream of `B$HP<NN><XX><hex>` frames their signer wallet can scan directly; the XCW option remains the default for sign-back into another XChain wallet.

The encoder lives at `packages/core/src/uri/bbqrPsbt.js` as `encodeBbqrPsbtFrames(psbt, opts)`, reciprocal to the existing `decodeBbqrPsbt`. H encoding only, no new dep, hex is universally supported by BBQr-aware readers, and the round-trip flows through the same per-chunk header layout the decoder already validates. Frame size defaults to 200 payload bytes (~408 chars per frame including the 8-char header), which fits comfortably under the alphanumeric-QR ceiling for most cameras.

### Added

- **`packages/core/src/uri/bbqrPsbt.js`**, `encodeBbqrPsbtFrames(psbt, opts)` + `DEFAULT_BBQR_PAYLOAD_BYTES`. Internal `bytesToHexUpper` / `normalizePsbtBytes` / `formatBase36` helpers.
- **`packages/core/src/shared/routes/Send.jsx`**, `WatcherResultPanel` imports `encodeBbqrPsbtFrames`, gains a `qrFormat` state (`'xcw' | 'bbqr'`), branches `exportFrames`, and renders a radio-group toggle.
- **`test/smoke/bridge/bbqr-psbt.smoke.js`**, round-trip + multi-frame + error-path coverage for the encoder.
- **`test/smoke/ui/send-watcher-mode.smoke.js`**, pins the new import, the BBQr branch, and the radio label.

Closes Cluster W FOLLOWUP 4.

## [0.240.0] - 2026-04-28

§52, G162, Signer mocks for Trezor / Ledger.

New `test/unit/signers/MockHardwareSigner` extends the abstract `Signer` base from `@xchain-wallet/core` so any unit / integration test that today reaches for a paired Trezor or Ledger can swap in a deterministic, in-process mock without touching the call sites. The mock is configurable via constructor (vendor / model / firmware / status / canned method results) and exposes a `setStatus(status, detail)` helper for driving transitions through the same listener pipeline the real signers use. Two factories, `makeMockTrezorSigner` / `makeMockLedgerSigner`: short-circuit the vendor flag.

The companion vitest suite at `test/unit/signers/MockHardwareSigner.test.js` exercises every method-shaped contract point (`getStatus`, `getAddresses`, `signPsbt`, `signMessage`, `getPublicKey`) plus the status-transition listener path. Tests run under `pnpm test:unit`; a structural smoke at `test/smoke/audits/signer-mocks.smoke.js` pins the file layout + key API surface so a stale rename / unexport doesn't ship under the smoke baseline.

This unblocks future signer-touching unit tests across the suite, anything wiring `submitWithSigner` / `signPsbtFlow` / `useSignerInfo` against HW kinds can now drop in the mock instead of stubbing methods ad-hoc.

### Added

- **`test/unit/signers/MockHardwareSigner.js`** (new), `MockHardwareSigner` class + `makeMockTrezorSigner` / `makeMockLedgerSigner` factories.
- **`test/unit/signers/MockHardwareSigner.test.js`** (new), vitest suite exercising the contract surface + status-transition path.
- **`test/smoke/audits/signer-mocks.smoke.js`** (new), structural smoke pinning the mock + test layout.

Closes G162.

## [0.239.0] - 2026-04-28

§20, Cluster W FOLLOWUP 3, Watcher mode HW-source guard.

When a user picks a HW-paired source address (Trezor / Ledger) in watcher mode, `Send.jsx` now surfaces a `<StatusMessage>` at review time clarifying that the pairing on this wallet is decorative for watcher mode, the same HW device must be paired on the Signer-mode wallet to actually sign the produced PSBT. The address still works (its pubkey is what matters for encoding); the hint just keeps users from being surprised when "Build unsigned PSBT" doesn't trigger their HW device.

### Added

- **`packages/core/src/shared/routes/Send.jsx`**, extra HW-aware StatusMessage inside the watcher-mode review-stage hint stack; rendered only when `isWatcherMode && isHwSource`.
- **`test/smoke/ui/send-watcher-mode.smoke.js`**, pins the new HW-aware copy (vendor name + Signer-mode wallet redirect).

Closes Cluster W FOLLOWUP 3.

## [0.238.0] - 2026-04-28

§20, Cluster D Step 2 of 2, Desktop shell parity for sign / verify routes (Cluster W FOLLOWUP 2). **Cluster D closed.**

The signer-mode Home variant shipped at v0.236.0 wired the three sign-related CTAs on the extension and web shells but not desktop, the renderer App.jsx didn't register `sign-psbt` / `sign-message` / `verify-signature` routes, so Home's three new props were intentionally not threaded on desktop. A desktop signer-mode wallet had no in-wallet path to actually sign anything. This step closes that gap.

`packages/desktop/renderer/App.jsx` now imports `PsbtSignForm` / `SignMessageForm` / `VerifySignatureForm`, registers `unlockedView === 'sign-psbt' / 'sign-message' / 'verify-signature'` branches mirroring the extension popup + web shells, and threads `onSignPsbt` / `onSignMessage` / `onVerifySignature` through to `<Home>`. The `unlockedView` typedef gains the three new view names. The `home-signer-mode` smoke flips from "desktop intentionally not wired" to pinning the imports + routes + prop wiring as live.

**Cluster D, §20 Watcher / Signer round-trip, closed at v0.238.0.** Two steps closed both Cluster W FOLLOWUPs (1 + 2). The watcher → signer → broadcaster loop is now wired end-to-end inside the wallet AND works on every shell.

### Added

- **`packages/desktop/renderer/App.jsx`**, three new imports, three new view branches, three new Home props (`onSignPsbt` / `onSignMessage` / `onVerifySignature`), `unlockedView` typedef extended.
- **`test/smoke/ui/home-signer-mode.smoke.js`**, desktop section flipped from negative assertion to positive: imports, routes, and prop wiring all pinned.

Closes Cluster W FOLLOWUP 2.

## [0.237.0] - 2026-04-28

§20, Cluster D Step 1 of 2, In-wallet broadcast for signed PSBTs (Cluster W FOLLOWUP 1).

The watcher / signer pair shipped in Cluster W (v0.234.0 → v0.236.0) was half-built, a Watcher wallet built unsigned PSBTs (G040), a Signer wallet signed them (G088, v0.164.0), but to actually land the transaction on-chain the user had to copy the signed hex out of the wallet and broadcast via a block explorer or third-party tool. This step closes the loop by adding in-wallet broadcast.

New host handler `broadcast.signedTx` (sdkRegistry-only, no vault, broadcast doesn't need keys) takes `{ chainId, txHex }`, calls `sdk.encoder.broadcastTx`, and normalizes the result to `{ txid }`. Three messaging shims expose `broadcastSignedTxRequest`. `PsbtSignForm` captures the broadcastable `txHex` from the existing sign-result envelope (the `auth.signPsbt` host already returned it; the form was throwing it away), tracks a four-state machine (`idle | broadcasting | broadcast | error`), and surfaces a primary "Broadcast" button on the result page next to the existing "Copy signed PSBT" affordance. On success, a status block replaces the body copy with the resulting txid + Copy txid button.

The old "Broadcast from inside the wallet will arrive in a later release" placeholder copy is gone, replaced with "Broadcast directly from this wallet, or hand the signed PSBT off to a different broadcaster (or the next cosigner)".

### Added

- **`packages/extension/src/background/createBackgroundHost.js`**, `broadcast.signedTx` host handler.
- **`packages/extension/src/popup/messaging.js`**, **`packages/web/src/messaging.js`**, **`packages/desktop/renderer/messaging.js`**, `broadcastSignedTxRequest` shim.
- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, `signedTxHex` / `broadcastState` / `broadcastTxid` / `broadcastError` state, sign-success path captures txHex, Broadcast button + status block on the result page, "Sign another PSBT" reset clears the new state.
- **`test/smoke/ui/psbt-sign-broadcast.smoke.js`** (new), pins the host handler, the three shims, and the form's state + render wiring.

Closes Cluster W FOLLOWUP 1. Watcher → Signer → Broadcaster round-trip is now wired end-to-end inside the wallet.

## [0.236.0] - 2026-04-28

§20, Cluster W Step 3 of 3, Signer-mode Home variant (G041). **Cluster W closed.**

`Home.jsx` reads `settings.walletMode` and, when the field is `'signer'`, swaps the regular HomeTabs / quick-actions body for a stripped-down `SignerHomeBody` that shows an explanatory banner ("Signer mode, this wallet only signs PSBTs from a paired Watcher wallet") plus three role-appropriate CTAs: **Sign a PSBT** (marquee, primary), **Sign a message** (secondary), **Verify a signature** (tertiary). Send / Receive / balances / history are intentionally absent, a signer wallet doesn't broadcast, watch chains, or expose receive addresses; its sole role is to sign PSBTs pasted in from a paired Watcher (cf. G040, v0.235.0).

The header (lock button, wallet picker, Settings) is shared with the regular Home so the user can still switch wallets, lock, or change mode back via Settings → Wallet Mode.

Three new optional Home props (`onSignPsbt`, `onSignMessage`, `onVerifySignature`) plumb through the extension popup and web shells. The desktop shell does not yet register `sign-psbt` / `sign-message` / `verify-signature` routes, so those CTAs render disabled there, wiring lands as a Cluster W FOLLOWUP.

**Cluster W, §20 Air-Gapped Signing, closed at v0.236.0.** All three rows fully closed (G039 + G040 + G041) across v0.234.0 → v0.236.0.

### Added

- **`packages/core/src/shared/routes/Home.jsx`**, `WALLET_MODE_DEFAULT` import; `walletMode` / `isSignerMode` derivation; signer-mode early return inside the shared `<Screen>`; new `SignerHomeBody` component; three new optional props (`onSignPsbt`, `onSignMessage`, `onVerifySignature`) documented in the JSDoc + threaded.
- **`packages/extension/src/popup/App.jsx`**, **`packages/web/src/App.jsx`**, pass `onSignPsbt` / `onSignMessage` / `onVerifySignature` to Home.
- **`test/smoke/ui/home-signer-mode.smoke.js`** (new), pins the schema-derivation, the prop set, the signer-mode early return, the SignerHomeBody render, and the per-shell prop wiring (popup + web wired; desktop intentionally pending FOLLOWUP).

Closes G041.

## [0.235.0] - 2026-04-28

§20, Cluster W Step 2 of 3, Watcher-mode PSBT generation (G040).

New `flows/buildSendPsbt.js` is an encode-only path: creates a SEND action string, calls `encoder.createTx`, returns the unsigned PSBT hex envelope. No vault unlock, no signer, no broadcast, a watcher wallet has pubkeys but no signing keys, so we stop after encoding. ADS donation + PendingTx tracking are also skipped since the broadcast happens on a different wallet.

`createBackgroundHost` registers `action.send.psbt` (deps: `chainRegistry` + `sdkRegistry` only, no vault); three messaging shims expose `buildSendPsbtRequest` across extension popup / web / desktop renderer.

`Send.jsx` reads `settings.walletMode` (default `'full'`) and branches on `isWatcherMode`:
- Review stage: replaces the password / HW pair block with a hint explaining that this wallet builds an unsigned PSBT instead of signing.
- Submit handler: routes through `messaging.buildSendPsbtRequest(base)` instead of `sendAsset` / `sendAssetHw`. Submit button label flips to "Build unsigned PSBT" and is enabled directly (no password gate).
- Done stage: branches on result shape, when the envelope carries `psbtHex` instead of a `txid`, renders a new `WatcherResultPanel` with the hex in a read-only textarea, a Copy hex affordance, an `<AnimatedQrFrames>` block driven by `encodeXcwChunks`, and a plain-text chunks fallback.

The signer-mode side of the round-trip (paste / scan signed PSBT, broadcast) reuses the existing `PsbtSignForm` from Cluster E + a future broadcast leg tracked as Cluster E FOLLOWUP 3. Signer-mode Home variant lands as Step 3 (G041).

### Added

- **`packages/core/src/flows/buildSendPsbt.js`** (new), encode-only SEND path returning `{ psbtHex, encoding, actionString, action, version, chainId, fromAddress }`.
- **`packages/core/src/flows/index.js`**, re-exports `buildSendPsbt`.
- **`packages/extension/src/background/createBackgroundHost.js`**, destructures `buildSendPsbt` + registers `action.send.psbt` host handler.
- **`packages/extension/src/popup/messaging.js`**, **`packages/web/src/messaging.js`**, **`packages/desktop/renderer/messaging.js`**, `buildSendPsbtRequest` shim across all three shells.
- **`packages/core/src/shared/routes/Send.jsx`**, `walletMode` / `isWatcherMode` derivation, watcher branch in `handleSubmit`, watcher hint copy + relabelled submit button at review, `WatcherResultPanel` component (animated QR + plain-text chunks + Copy hex).
- **`test/smoke/ui/send-watcher-mode.smoke.js`** (new), pins the flow shape, the host registration, the three shims, the Send.jsx watcher branch, and the `WatcherResultPanel` render.

Closes G040.

## [0.234.0] - 2026-04-28

§20, Cluster W Step 1 of 3, Wallet mode selector (G039).

New v2-tolerant `settings.walletMode: 'full' | 'watcher' | 'signer'` field defaults to `'full'`. Settings page gains a Wallet Mode internal-drill row above Backup; the new `WalletModeSection` renders a fieldset with three radio options + per-mode hint copy and writes through `update({ walletMode })`. Settings drilldown summary surfaces the active mode.

This step ships the schema + selector only, `Send.jsx` watcher branch (G040) and `Home.jsx` signer variant (G041) read the field in subsequent steps. Until those land the field persists but doesn't yet alter behavior; the section's own copy says so.

### Added

- **`packages/core/src/schemas/settings.js`**, `WALLET_MODES` const + `WALLET_MODE_DEFAULT` exports; `walletMode` v2-tolerant typedef field; `createDefaultSettings` seeds `'full'`; `validateSettings` rejects bogus values only when present.
- **`packages/core/src/shared/components/settings/WalletModeSection.jsx`** (new), fieldset of three radio options; each option has descriptive hint copy + `aria-describedby` wiring.
- **`packages/core/src/shared/routes/Settings.jsx`**, registers the `wallet-mode` internal-drill section above Backup; new `walletModeSummary` helper.
- **`test/smoke/ui/settings-wallet-mode.smoke.js`** (new), pins the schema const + default + v2-tolerant validate, the section's radio set + update call shape + aria wiring, and the Settings.jsx registration + summary helper.

Closes G039.

## [0.233.0] - 2026-04-28

Repo tidy, vitest configs moved into `test/vitest/`.

The eight `vitest.config*.js` files at the repo root are gone; equivalents land at `test/vitest/{unit,integration,a11y,boundary,chaos,fuzz,regression,security}.config.js` with `root: '../..'` so the existing `test/...` include + setupFiles paths resolve unchanged. `package.json` test scripts and `test/mutation/stryker.config.mjs` `configFile` updated to point at the new paths. Smoke baseline preserved (24 / 196 unchanged).

### Changed

- **`test/vitest/{unit,integration,a11y,boundary,chaos,fuzz,regression,security}.config.js`** (moved from repo root, prefix dropped), now under a single `test/vitest/` directory; each config sets `root: '../..'`.
- **`package.json`** scripts, `test:unit`, `test:unit:watch`, `test:unit:coverage`, `test:integration`, `test:integration:watch`, `test:boundary`, `test:chaos`, `test:fuzz`, `test:regression`, `test:security`, `test:a11y` reference the new paths.
- **`test/mutation/stryker.config.mjs`**, `configFile` updated to `test/vitest/unit.config.js`.
- **`test/integration/setup.js`**, comment pointer updated.

## [0.232.0] - 2026-04-28

§9.3, Cluster V Step 3 of 3, Zustand-proxy state model deferred (G006). **Cluster V closed.**

The spec at §9.3 describes a Zustand store in the SW with `chrome.runtime.connect`-proxied mirrors in each UI context. The wallet ships with a different model, `MessagingProvider` (React Context wrapping a per-shell messaging module) plus per-component fetch from the source of truth (vault → MessageHost → flow). Both models work; the shipping model is simpler cross-shell, has fewer state-sync footguns, and has no measured performance bottleneck after 230+ releases across three shells.

This step records the architectural decision in `claude/reports/specs/2026-04-28_zustand-proxy-deferred.md` (an ADR-style doc) and flips G006 from ⬜ open → ⏸ deferred. Triggers that would justify reopening (real-time subscription requirements that span surfaces, profiling-backed latency complaints, integration-test coordination pain) are documented inline so a future contributor knows what signal to watch for.

The ADR also flags a spec-revision question: when `XCHAIN_WALLET_SPEC.md` next updates, §9.3 should either adopt the shipping reality or stay aspirational with an explicit "current implementation diverges" note pointing at this ADR.

### Added

- **`claude/reports/specs/2026-04-28_zustand-proxy-deferred.md`** (new), ADR documenting the spec divergence, the shipping pattern, the four reasons we kept it, the trigger conditions for reopening, and the spec-revision implications.
- **`test/smoke/audits/zustand-proxy-deferred.smoke.js`** (new), pins the ADR exists with its required headings + G006 + spec-section citations; pins that the codebase ships the MessagingProvider pattern (no zustand dep in `@xchain-wallet/core`, no `proxyStore.{js,ts}` under core); pins MessagingProvider as a named export and the extension popup as a `<MessagingProvider>` consumer. If a future cluster adopts Zustand the ADR + this smoke must update together.

Closes G006 (deferred). **Cluster V, §9 Architecture lightweight, closed at v0.232.0.** Two of three rows fully closed (G003 + G004); G006 ships as ⏸ deferred with the ADR.

## [0.231.0] - 2026-04-28

§52, Cluster V Step 2 of 3, `tools/regtest/` scaffolding (G004).

New `tools/regtest/` directory holds the wallet's thin glue around the upstream `xchain-node` regtest stack, the actual stack is NOT vendored here, just probed. `bootstrap.sh` checks every required service (3 coin RPCs + decoder + indexer + explorer + hub) and emits a structured per-service ✓/✗ readiness report; `wait-ready.sh` polls bootstrap until ready or `XCHAIN_REGTEST_TIMEOUT_MS` expires; `down.sh` delegates to the upstream `xchain-node.sh stop`. `README.md` documents the seven service endpoints, env vars (`XCHAIN_REGTEST_BASE_URL`, `XCHAIN_REGTEST_TIMEOUT_MS`, `XCHAIN_REGTEST_VERBOSE`), per-test-suite procedure, and pairs with G163 for full one-command provisioning.

Unblocks the §52 / G163 E2E Playwright row that was previously gated on this scaffolding.

### Added

- **`tools/regtest/README.md`** (new), orientation: why this exists, path forward, seven service endpoints table, scripts, env vars, per-test-suite procedure, status today.
- **`tools/regtest/bootstrap.sh`** (new, executable), readiness probe with structured per-service report + diagnostic pointing at `xchain-node.sh start` on failure.
- **`tools/regtest/wait-ready.sh`** (new, executable), polling wrapper around bootstrap with `XCHAIN_REGTEST_TIMEOUT_MS` ceiling.
- **`tools/regtest/down.sh`** (new, executable), thin delegate to `xchain-node.sh stop`; honours `XCHAIN_PLATFORM_DIR` override.
- **`test/smoke/audits/regtest-tools.smoke.js`** (new), pins directory + script existence + executable bits, README structural headings + canonical env vars + §52 / G163 / xchain-node citations, each script's shape (shebang, strict-mode, env-var honouring, key call shapes), the seven-service probe list, and exercises the runtime failure path (bootstrap.sh against TEST-NET-1 IP exits 1 with the documented diagnostic; wait-ready.sh with 1s timeout exits 1 with the timeout diagnostic).

Closes G004.

## [0.230.0] - 2026-04-28

§51, Cluster V Step 1 of 3, `tools/release/` scaffolding (G003).

New `tools/release/` directory holds the release-signing pipeline scaffolding: `README.md` documents inputs / scripts / env vars / per-release procedure, `sign.sh` produces a deterministic `RELEASE_HASHES.txt` (LC_ALL=C-sorted top-level files) and a detached `.asc` GPG signature, `verify.sh` re-verifies the round-trip with `--no-sig` and `--recompute` modes for pre-G180 use.

Both scripts use `set -euo pipefail`, accept `--input` / `--force` / `--no-sig` / `--recompute` flags, and refuse to overwrite existing manifests without `--force`. `sign.sh` exits with a clear diagnostic that cites G180 (release-key publication) when `XCHAIN_RELEASE_GPG_KEY` is unset, so the pre-G180 verification path (run with `--recompute` from `verify.sh`) is the documented fallback.

The companion verification side already exists at `docs/Verify_Release.md` (Cluster T Step 2, v0.222.0); the user-facing recipe there mirrors what `verify.sh` runs locally.

### Added

- **`tools/release/README.md`** (new), release-signing pipeline orientation.
- **`tools/release/sign.sh`** (new, executable), manifest + GPG-signing entry point.
- **`tools/release/verify.sh`** (new, executable), local verification helper.
- **`test/smoke/audits/release-tools.smoke.js`** (new), pins directory + scripts existence + executable bits, README structural headings + canonical env var + G180 / §51 citations, both scripts' shape (shebang, strict-mode, accepted flags, key call shapes), and exercises the scripts at runtime against a stub artifact directory (recompute writes a deterministic sorted manifest, --no-sig validates without GPG, sign without `XCHAIN_RELEASE_GPG_KEY` exits 1 with the documented diagnostic, --help prints docs).

Closes G003.

## [0.229.0] - 2026-04-28

§9.7, Cluster U Step 5 of 5, Runtime chain-registry refresh from hub (G007, partial). **Cluster U closed.**

Wallet-side scaffolding only, the hub-side `/api/v1/chain-registry` endpoint is pending. New `flows/refreshChainRegistry.js` exposes the canonical refresh API the wallet expects, with comprehensive failure-mode coverage so a hub that doesn't yet implement the route can never crash boot. New host handlers `chainRegistry.status` / `chainRegistry.refresh` and three messaging shims expose it to the renderer. `createBackgroundHost` schedules a single boot-time refresh ~3s after worker construction (non-blocking, swallowed failures). Settings → Network grows a "Chain registry refresh" row at the top showing last-refreshed timestamp, descriptor count, or the latest error, plus a manual "Refresh now" button.

The actual hot-swap of fetched descriptors into the running ChainRegistry is intentionally NOT yet wired, that mutates state shared across active flows (Send / Sign / History). The safe model is "validate + cache, surface in diagnostics, apply on next service-worker restart", design lives in the Cluster U FOLLOWUPs.

### Added

- **`packages/core/src/flows/refreshChainRegistry.js`** (new), `refreshChainRegistry({ hubUrl, fetcher, timeoutMs })` always resolves; `createChainRegistryStatus()` in-memory holder. Documented assumed wire format: `GET ${hubUrl}/api/v1/chain-registry` returns `{ generatedAt, descriptors[] }`.
- **`chainRegistry.status` / `chainRegistry.refresh`** host handlers in `createBackgroundHost`, plus a `pickHubUrlFromRegistry` helper that grabs the first mainnet descriptor's hub URL.
- **`getChainRegistryStatus` / `refreshChainRegistry`** messaging shims in extension popup, web, and desktop renderer.
- **`<ChainRegistryRefreshRow>`** component mounted at the top of `NetworkEndpointsSection`: feature-detects the shim, renders status (last refreshed / descriptor count / error), Refresh button.
- **`test/smoke/audits/chain-registry-refresh.smoke.js`** (new), exercises the flow at runtime against stub fetchers (happy path, trailing-slash hub URL, HTTP 500/404, malformed JSON, missing descriptors[], network error throw, invalid hubUrl) and pins the host wiring, three messaging shims, and Settings UI surface.

Marked **🟡 partial**, wallet-side scaffolding ships now; hub-side endpoint, hot-swap into running ChainRegistry, and per-descriptor merge tracked as Cluster U FOLLOWUPs.

Closes G007 (partial). **Cluster U, Pre-launch features sweep, closed at v0.229.0.** Three of five rows fully closed (G055 + G056 + G051), two ship as 🟡 partial (G043 + G007).

## [0.228.0] - 2026-04-28

§23.5, Cluster U Step 4 of 5, Cross-chain LINK threading verify (G051).

The implementation already shipped end-to-end: `flows/linkQueries.js` wraps `sdk.getLinks(address, 'address')`, the host wires it as `links.forAddress`, all three messaging shims expose `getLinksForAddress`, History.jsx fans the call out per `(chain, address)` and builds a `(peerChainId, peerCoinTicker, peerActionIndex, linkActionIndex)` peer-cache; `sidesFromLink(link, localChainId)` resolves which side maps to the local chain (with same-chain fallback); a `connectorByKey` memo computes vertical connectors when consecutive rows share a `linkActionIndex`; the 🔗 Cross-chain filter chip surfaces the threaded subset; and the dual-side `DetailCard` renders peer info when a row is clicked.

This step is a verify pass, a new smoke pins all six pieces so a future edit cannot silently drop the threading logic.

### Added

- **`test/smoke/ui/history-cross-chain-link.smoke.js`** (new), pins `linkQueries.linksForAddress`, the `createBackgroundHost` wiring, the three messaging shims, History's `messaging.getLinksForAddress` call, the `sidesFromLink` resolver shape, the `connectorByKey` consecutive-row equality check, the 🔗 filter chip, and the dual-side DetailCard.

Closes G051.

## [0.227.0] - 2026-04-28

§20, Cluster U Step 3 of 5, BBQr / UR PSBT QR formats (G043, partial).

New `uri/bbqrPsbt.js` decodes BBQr (Sparrow / Coldcard / SeedSigner standard) PSBT frames, single and multi-frame, H (hex) and B (base32) encodings. Z (zlib) encoding throws with a clear "not yet supported" error since zlib is not in the dep tree. New `uri/qrPsbtFormat.js` detects all three known formats (XCW / BBQr / UR) and surfaces a friendly message when a UR frame is recognized but cannot be decoded yet.

`PsbtSignForm.normalizePsbtInput` picks up BBQr-only line-separated pastes and routes them through `decodeBbqrPsbt`. Pastes that detect as a known-but-unsupported format (UR, or BBQr-Z) surface the format-specific hint in the error row instead of the generic "doesn't look like hex" copy.

Marked **🟡 partial** since BBQr-Z and UR fountain-coded multi-part are still pending, see Cluster U FOLLOWUPs.

### Added

- **`packages/core/src/uri/bbqrPsbt.js`** (new), `parseBbqrFrame` / `decodeBbqrFrames` / `decodeBbqrPsbt`. Handles header parsing (B$EFNNXX), base36 frame counts, hex / base32 decoding (RFC 4648 no-pad via `@scure/base`), out-of-order frame collection, duplicate-frame deduplication. Z encoding + non-PSBT file types throw clear errors.
- **`packages/core/src/uri/qrPsbtFormat.js`** (new), `detectQrFrameFormat` returns `'xcw' | 'bbqr' | 'ur' | null`; `describeUnsupportedFormat` returns a UR-specific user-facing hint.
- **`test/smoke/bridge/bbqr-psbt.smoke.js`** (new), exercises detection (every format + null cases), single + multi-frame BBQr-H decode (in-order, out-of-order, deduplicated), error paths (missing frame / total mismatch / encoding mismatch / Z encoding / non-PSBT file type / garbage frame), and the PsbtSignForm wiring.

### Changed

- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, `normalizePsbtInput` recognizes line-separated BBQr frame batches; new `unsupportedFormatHint` surfaces format-specific errors for UR + BBQr-Z; fallback error mentions BBQr alongside hex/base64.

Closes G043 (UI + decoder ship now; BBQr-Z + UR fountain-coded multi-part tracked as Cluster U FOLLOWUPs).

## [0.226.0] - 2026-04-28

§24, Cluster U Step 2 of 5, Extension sidebar mode (Chrome Side Panel) verify (G056).

The implementation already shipped, the manifest declares `side_panel.default_path: 'sidepanel.html'` + `sidePanel` permission, `background/layoutMode.js` controls the popup/sidepanel toggle, and `LayoutModeToggle.jsx` renders the user-facing switch. This step is a verify pass: a new smoke pins the four-piece wiring (manifest + HTML entry points + background controller + shared toggle UI) so a future edit cannot silently drop one of them.

### Added

- **`test/smoke/shells/extension-sidepanel.smoke.js`** (new), pins manifest declarations (`side_panel.default_path`, `sidePanel` permission, `action.default_popup`), the two HTML entry points, the `layoutMode.js` controller exports + canonical storage key + Chrome API call shapes, the background.js boot wiring, and the `LayoutModeToggle` shared component shape.

Closes G056.

## [0.225.0] - 2026-04-28

§24, Cluster U Step 1 of 5, Resume-last-view on unlock (G055).

New `shared/utils/lastViewMemory.js` persists the user's last `unlockedView` per-wallet to localStorage; new `shared/hooks/useLastView` wraps the read/write into the React lifecycle each shell needs. All three shell App.jsx files (extension popup, web, desktop renderer) call the hook with the active walletId + current view + `setUnlockedView`, so unlocking a wallet resumes wherever the user left off.

Resume safety: only context-free views (Home, History, Addresses, Actions, Contacts, Messaging, Markets, Staking dashboard, Contracts list, Cross-chain templates) are in the `RESUMABLE_VIEWS` allowlist. Anything that needs a prefilled state object (Send / TokenDetail / DispenserDetail / etc.) falls through to Home so a re-render can never hit a missing prop.

Storage uses localStorage rather than `settings.lastView` per the project memory rule, ephemeral per-wallet UI prefs that should not survive a from-seed restore go to localStorage. Defensive helpers swallow storage-disabled / quota-exhausted failures.

### Added

- **`packages/core/src/shared/utils/lastViewMemory.js`** (new), `readLastView` / `writeLastView` / `clearLastView` plus the frozen `RESUMABLE_VIEWS` allowlist.
- **`packages/core/src/shared/hooks/useLastView.js`** (new), wraps the helpers in two `useEffect`s (resume on walletId change, persist on view change) so the per-shell App.jsx wiring stays a one-line call.
- **`test/smoke/ui/last-view-memory.smoke.js`** (new), exercises the helper at runtime against a stub localStorage (round-trip, per-walletId isolation, non-resumable view filtering, Home-as-default no-op, throwing-storage defensiveness, spec-drift handling) and pins the hook + three-shell wiring.

### Changed

- **`packages/extension/src/popup/App.jsx`**, imports + calls `useLastView`.
- **`packages/web/src/App.jsx`**, imports + calls `useLastView`.
- **`packages/desktop/renderer/App.jsx`**, imports + calls `useLastView`.

Closes G055.

## [0.224.0] - 2026-04-28

§55, Cluster T Step 4 of 4, Wallet glossary (G179). **Cluster T closed.**

New `docs/GLOSSARY.md` defines the canonical wallet vocabulary across architecture (core / shell / vault / flow / MessageHost), signing (HD wallet, BIP39 passphrase, signer, SignerPool, panic mode), the dApp bridge (ConnectedSite, approval, throttle, blocklist, SIWX, every error code), storage (Wallet / Account / Address / Settings record, v2-tolerant, ADS), onboarding (dry-run restore, word-quiz, backup reminder, demo mode), and build / release (reproducible build, synchronized versioning, smoke, spec gap ledger, cluster).

Protocol-level terms (ACTION, encoding type, BATCH, magic prefix) are NOT duplicated, the doc cross-links to the upstream `xchain-documentation/getting-started/Key_Terms.md` for those.

### Added

- **`docs/GLOSSARY.md`** (new), wallet glossary.
- **`test/smoke/audits/glossary-doc.smoke.js`** (new), pins the structural sections, every required term (40+ entries) as a bold-prefixed definition, the cross-link to the upstream protocol glossary, the companion wallet doc references (REPRODUCIBLE_BUILDS, BRIDGE), and the anti-staleness framing.

Closes G179. **Cluster T, §13 + §55 Pre-launch Docs, closed at v0.224.0.** §13 fully closed (5/5 rows); §55 down to G180 (gated on GPG key publication).

## [0.223.0] - 2026-04-28

§55, Cluster T Step 3 of 4, Maintainers doc (G178).

New `MAINTAINERS.md` at the repo root names the lead maintainer (J-Dog), enumerates the canonical wallet sub-system areas (core flows / schemas / signers / bridge / three shells / docs / release engineering / smokes), publishes the escalation paths used elsewhere in the project (security@ / conduct@ / GitHub issues), and documents the maintainer addition + removal process plus decision-making scope.

Honest framing: this is pre-launch with a single primary maintainer; the file exists so a future contributor or downstream packager can see the partition without pretending there's a multi-person team today.

### Added

- **`MAINTAINERS.md`** (new), root maintainers + governance doc.
- **`test/smoke/audits/maintainers-doc.smoke.js`** (new), pins the structural headings, the lead's GitHub link, the areas table, the escalation channels (cross-references SECURITY.md + CODE_OF_CONDUCT.md), the cross-project relationships, and the honest pre-launch framing.

Closes G178.

## [0.222.0] - 2026-04-28

§13, Cluster T Step 2 of 4, User-facing release verification doc (G016).

New `docs/Verify_Release.md` walks an end user through the three claims that combine into a real release verification, bit-for-bit reproducibility, hash integrity, and signature authenticity, with concrete shell commands for importing the maintainer's release key, downloading the artifact + manifest + signature, GPG-verifying the manifest, hash-checking the artifact, and (optionally) reproducing the build.

The doc is honest about what verification does NOT prove (source bug-freeness, upstream supply chain safety, key-rotation events) and where each platform stands today (desktop Linux reproducible end-to-end; macOS / Windows / extension / web have hash + signature guarantees but per-target reproduce scripts are still gated on §51 work).

### Added

- **`docs/Verify_Release.md`** (new), end-user verification recipe.
- **`test/smoke/audits/verify-release-doc.smoke.js`** (new), pins the headings, the three claim names, the required shell commands, the cross-links to companion docs, the §51 spec citation, the stop-on-failure guidance, and the honest framing of verification's scope.

Closes G016.

## [0.221.0] - 2026-04-28

§13, Cluster T Step 1 of 4, Root reproducible-builds doc (G015).

New `docs/Reproducible_Builds.md` orients across every shell, captures the project-wide Level-2-pre-signing-artifact promise, and links out to the existing per-target deeper doc under `packages/desktop/`. Per-target table covers desktop / extension / web with a clear status note for each. Cross-links to `docs/Verify_Release.md` (next step) and `SECURITY.md`.

### Added

- **`docs/Reproducible_Builds.md`** (new), root entry point for reproducible builds.
- **`buildInfo.REPRODUCIBLE_BUILD_DOC_DESKTOP`** (new), pointer to the desktop-specific deeper recipe so consumers that previously read `REPRODUCIBLE_BUILD_DOC` can still reach the desktop doc.
- **`test/smoke/audits/repro-build-root-doc.smoke.js`** (new), pins the doc's headings, per-target table coverage, cross-links, and the buildInfo constant flip.

### Changed

- **`packages/core/src/buildInfo.js`**, `REPRODUCIBLE_BUILD_DOC` now points at the new root doc (`docs/Reproducible_Builds.md`); `REPRODUCIBLE_BUILD_DOC_DESKTOP` keeps the per-target path. `AboutSection` consumes `REPRODUCIBLE_BUILD_DOC` and automatically picks up the new path with no UI edit.

Closes G015.

## [0.220.0] - 2026-04-28

§12, Cluster S Step 2 of 2, Origin allowlist / blocklist infrastructure (G009). **Cluster S closed.**

New `flows/blocklist.js` exposes `normalizeOrigin` / `isOriginBlocked` plus async `listBlockedOrigins` / `addBlockedOrigin` / `removeBlockedOrigin` helpers backed by a new `settings.blockedOrigins?: string[]` v2-tolerant field. `bridge/handlers.js` calls a new `assertNotBlocked(req, deps)` guard from `bridge.connect` and the four sign methods (`signMessage`, `signAction`, `signPsbt`, `signIn`); blocked origins reject with `BLOCKED_BY_USER`.

`addBlockedOrigin` also evicts any matching `ConnectedSite` record so an in-flight session can't keep signing through a stale grant. The Connected Sites Settings panel grows a per-row Block button, a "Blocked origins" subsection with Unblock buttons, and an inline manual-block form for blocking origins that aren't already connected.

### Added

- **`packages/core/src/flows/blocklist.js`** (new), `normalizeOrigin`, `isOriginBlocked`, `listBlockedOrigins`, `addBlockedOrigin`, `removeBlockedOrigin`. `flows` barrel re-exports them.
- **`settings.blockedOrigins?: string[]`**, v2-tolerant typedef + validator addition; missing is fine, present must be `string[]`.
- **`BLOCKED_BY_USER`** added to `BridgeErrorCode` union in `packages/bridge-spec/src/index.ts`.
- **`docs/BRIDGE.md`** error table gains the `BLOCKED_BY_USER` row.
- **`sites.listBlocked` / `sites.block` / `sites.unblock`** host handlers in `createBackgroundHost`.
- **`listBlockedOrigins` / `blockOrigin` / `unblockOrigin`** messaging shims in extension popup, web, and desktop renderer.
- **`test/smoke/bridge/origin-blocklist.smoke.js`** (new), exercises normalize + isBlocked at runtime, pins schema validator, bridge wiring across connect + four sign methods, host handlers, three messaging shims, ConnectedSitesSection UI, spec union, and docs table.

### Changed

- **`packages/extension/src/bridge/handlers.js`**, destructures `isOriginBlocked` from flows; new `assertNotBlocked` async helper; called at the top of `bridge.connect` and each of the four sign handlers (before throttle check, since user intent overrides rate limiting).
- **`packages/extension/src/background/createBackgroundHost.js`**, destructures the three blocklist flows and registers the three new `sites.*` handlers.
- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`**, feature-detects blocklist wiring on the messaging surface; per-row Block button (when wired); new BlockedOriginsPanel subsection lists blocked origins with Unblock + accepts manual entry.

Closes G009. **Cluster S, §12 Security, closed at v0.220.0.** §12 fully closed (5/5 rows).

## [0.219.0] - 2026-04-28

§12, Cluster S Step 1 of 2, Sign-request throttling per origin (G012).

New `flows/signThrottle.js` exposes `createSignThrottle({ burst, windowMs, now })`: token-bucket-style sliding-window limiter keyed on origin. `bridge/handlers.js` constructs one at `registerBridgeHandlers` time (or accepts an injected instance) and the four sign methods, `signMessage`, `signAction`, `signPsbt`, `signIn`: call `assertNotThrottled(signThrottle, req)` after `requireSite`. Connect / disconnect / read methods stay un-throttled.

When a site exceeds `burst` requests inside `windowMs` (defaults: 5 / 60 s) the handler throws a `THROTTLED` `BridgeError` carrying `retryAfterMs`, `burst`, and `windowMs` so the dApp shim can surface a wait hint to its UI. State is process-scoped, service-worker restarts reset the buckets, which is fine for a rate limit since the wallet never caches the password.

### Added

- **`packages/core/src/flows/signThrottle.js`** (new), `createSignThrottle` factory + `SIGN_THROTTLE_DEFAULT_BURST` (5) + `SIGN_THROTTLE_DEFAULT_WINDOW_MS` (60_000); `flows` barrel re-exports them.
- **`THROTTLED`** added to `BridgeErrorCode` union in `packages/bridge-spec/src/index.ts`; `BridgeErrorResult` gains optional `retryAfterMs` / `burst` / `windowMs`.
- **`docs/BRIDGE.md`** error table gains the `THROTTLED` row describing the per-origin limit + retry hint.
- **`test/smoke/bridge/sign-throttle.smoke.js`** (new), exercises the throttle directly with a fake clock (burst, window expiry, per-origin isolation, clear), pins `assertNotThrottled` in all four sign handlers, asserts the read / connect handlers stay un-throttled, and pins `THROTTLED` in the spec union and docs table.

### Changed

- **`packages/extension/src/bridge/handlers.js`**, destructures `createSignThrottle` from flows; constructs a default throttle (overridable via `opts.signThrottle`); new `assertNotThrottled` helper called from each of the four sign handlers.

Closes G012.

## [0.218.0] - 2026-04-28

§54, Cluster R Step 3 of 3, CSS logical properties for RTL (G174). **Cluster R closed.**

Sweep across every `*.module.css` under `packages/` replaces physical inline-axis properties with logical equivalents so a future RTL locale lays out correctly without per-file flips.

Substitutions applied:

| Physical | Logical |
|---|---|
| `margin-left:` / `margin-right:` | `margin-inline-start:` / `margin-inline-end:` |
| `padding-left:` / `padding-right:` | `padding-inline-start:` / `padding-inline-end:` |
| `border-left[-color/style/width]:` / `border-right…` | `border-inline-start[-color/style/width]:` / `border-inline-end…` |
| `border-top-left-radius:` / `border-top-right-radius:` | `border-start-start-radius:` / `border-start-end-radius:` |
| `border-bottom-left-radius:` / `border-bottom-right-radius:` | `border-end-start-radius:` / `border-end-end-radius:` |
| `left:` / `right:` (positioning) | `inset-inline-start:` / `inset-inline-end:` |
| `text-align: left` / `text-align: right` | `text-align: start` / `text-align: end` |

Block-direction properties (`top:`, `bottom:`, `padding-top:`, etc.) and explicit physical values that don't have a logical equivalent (`flex-direction: row-reverse`, `cursor: ew-resize`) are left alone, they're already RTL-safe or genuinely physical.

28 module.css files modified, 63 line edits.

### Added

- **`test/smoke/ui/css-logical-properties.smoke.js`** (new), walks every `*.module.css` under `packages/`, asserts no physical inline-axis properties remain. Catches drift the moment a future CSS edit reintroduces `margin-left:` etc.

### Changed

- **28 `*.module.css` files** under `packages/core/src/{ui,shared/components,shared/routes}` and `packages/web/src`: sweep applied.

Closes G174. **Cluster R, §54 i18n, closed at v0.218.0.**

## [0.217.0] - 2026-04-28

§54, Cluster R Step 2 of 3, i18n string-extraction ESLint rule (G172).

New `tools/eslint/rules/no-jsx-literal-strings.js` flags inline JSX strings that should live in `i18n/locales/<bcp47>/index.js`. New `tools/eslint/plugin.js` packages the rule under the `@xchain` plugin namespace. Both ship as stand-alone modules, the rule is not enforced in CI per the project's "no CI during build phase" memory; developers who want it active can wire it into their local `.eslintrc.cjs`.

What the rule checks:

- Plain JSX text content (`<span>Sign in</span>`).
- User-facing string attributes: `aria-label` / `aria-description` / `aria-roledescription` / `alt` / `title` / `placeholder` / `label` / `hint` / `caption` / `tooltip` (Literal or `JSXExpressionContainer { Literal }`).
- `JSXExpressionContainer { Literal }` rendered as JSX content.

What the rule allows (without flagging):

- Whitespace-only / single-character / pure-punctuation / pure-digit strings (status dots, em-dashes, version chips).
- Technical attributes: `className`, `style`, `id`, `key`, `role`, `type`, `htmlFor`, `name`, `data-*`, every `aria-*` except the user-facing trio above, and on-event handlers.
- Strings shorter than a configurable `minLength` (default 2).
- Strings on the per-config `allow` list.
- Files matching the auto-ignored glob list, `*.smoke.js`, `*.test.[jt]sx?`, `test/**`, `tools/**`, `claude/**`, `dist/**`, `node_modules/**`.
- Standard ESLint disable comments at the call site.

The rule's `create()` returns no visitors at all when the filename matches an ignored path, so the rule cost is essentially zero on tests and tooling files.

Existing call sites are NOT migrated in this step, that's a follow-up sweep.

### Added

- **`tools/eslint/rules/no-jsx-literal-strings.js`** (new), the rule.
- **`tools/eslint/plugin.js`** (new), `@xchain` plugin entry that exposes the rule.
- **`test/smoke/ui/eslint-no-jsx-literal-strings.smoke.js`** (new), exercises `isTrivialString`, `findViolations`, ESLint `create()` against synthesised AST fragments + filename filtering, no eslint dependency.

Closes G172.

## [0.216.0] - 2026-04-28

§54, Cluster R Step 1 of 3, i18n locales directory + ICU format (G173).

The flat `i18n/en.js` dictionary moves into `i18n/locales/en/index.js`, with `i18n/en.js` kept as a one-line back-compat re-export so existing consumers keep working. New locales drop into `locales/<bcp47>/index.js` and call `registerLocale('<bcp47>', dictionary)` at app boot.

`format()` in `i18n/index.js` gains a pragmatic ICU MessageFormat subset:

- `{name}`: simple substitution (unchanged).
- `{count, plural, one {…} other {…}}`: Intl.PluralRules-driven category match. `=N` exact-match cases win over the category match.
- `{kind, select, mainnet {…} other {…}}`: exact-match select with `other` fallback.

Inside cases, `#` is replaced by the argument's stringified value. Nested ICU patterns and offset / ordinal plurals are out of scope for this subset, formatjs can be swapped in later without changing the dictionary shape, so authored strings stay correct.

`home.addressCount.one` / `home.addressCount.many` collapse into a single ICU plural key `home.addressCount`. No consumers were using the old keys yet (verified via grep).

### Added

- **`packages/core/src/i18n/locales/en/index.js`** (new), relocated dictionary.
- **`test/smoke/ui/i18n-icu-subset.smoke.js`** (new), runtime exercise of the ICU subset (plural, select, mixed substitution) + layout assertions.

### Changed

- **`packages/core/src/i18n/index.js`**, gains the ICU subset interpreter (balanced-brace reader, plural via `Intl.PluralRules`, select with `other` fallback). Imports the dictionary from `./locales/en/index.js`.
- **`packages/core/src/i18n/en.js`**, collapsed to a one-line re-export shim.

Closes G173.

## [0.215.0] - 2026-04-27

§48, Cluster Q Step 3 of 3, Log console in Developer Mode (G150). **Cluster Q closed.**

New `shared/utils/logConsole.js` singleton ring buffer (default capacity 500) captures `console.log/info/warn/error` output process-wide. `attach()` is idempotent and preserves the originals so DevTools still receives every entry. `record({ level, source, message, data })` lets flows / bridge handlers contribute synthetic entries that never went through `console.*`. `subscribe(listener)` notifies on every push.

New `<LogConsole>` component (in `packages/core/src/shared/components/`) renders the buffer as a compact monospace list with per-level filter chips (log / info / warn / error), a free-text search, Clear, and Copy-to-clipboard. Self-attaches to `console.*` on mount.

Settings → Developer Mode panel: the previously-disabled "Logs and diagnostics console" row is replaced by `<LogConsoleRow>`: a Show / Hide affordance that mounts `<LogConsole>` inline. Gated on Developer Mode being on.

Scoped to one Settings surface, does not touch the three shell App.jsx files for a global drawer (would have crossed the cluster's "multiple ~1000-line shell App.jsx files" stop condition).

### Added

- **`packages/core/src/shared/utils/logConsole.js`** (new), ring-buffer singleton with attach/detach/record/entries/subscribe/clear.
- **`packages/core/src/shared/components/LogConsole.jsx`** (new), filter / search / clear / copy panel.
- **`test/smoke/ui/log-console.smoke.js`** (new), pins singleton surface + component wiring + Developer-Mode gating.

### Changed

- **`packages/core/src/shared/components/settings/DeveloperModeSection.jsx`**, replaces the deferred Logs toggle with `<LogConsoleRow>`.
- **`test/smoke/ui/settings-developer-mode.smoke.js`**, pins the new LogConsoleRow alongside the still-deferred Raw PSBT row.

Closes G150. **Cluster Q, §48 Developer Mode leftovers, closed at v0.215.0.**

## [0.214.0] - 2026-04-27

§48, Cluster Q Step 2 of 3, Regtest chain exposure (G149).

New `flows/activateChain.js` adds a chain to an existing wallet at runtime. Two operations, both idempotent:

1. Seed `settings.fees[chainId]` and `settings.ads.perChain[chainId]` via the existing `seedSettingsForChains` helper. After this the chain shows up in `bridge.getActiveChains` and in surfaces that key off `settings.fees`.
2. For every existing account in the wallet, derive the first address on the new chain and persist it. Mirrors the address loop inside `_persistHdWallet` / `createAccount`. Skipped for accounts that already have an address on this chain.

HW signers refused, `signer.kind !== 'software'` raises an explanatory error. HW-aware activation lands as a follow-up. Custom chain registry (`chainRegistry.addCustom`) for non-bundled regtest networks is also follow-up work, but the same primitive will service it.

New host handler `wallet.activateChain` in `createBackgroundHost`; messaging shim `activateChainRequest` across all three shells (extension popup / web / desktop).

Settings → Developer Mode panel: the previously-disabled "Custom chain registry" row is replaced by a live "Regtest networks" subsection. Lists every bundled regtest descriptor with its endpoint URL + Active / Inactive state. Inactive rows show an "Activate…" button that reveals an inline password prompt; on success the chain is seeded and the first address is derived across every existing account.

### Added

- **`packages/core/src/flows/activateChain.js`** (new), activation flow.
- **`test/smoke/ui/regtest-activation.smoke.js`** (new), pins flow surface, host handler, messaging shims, Settings UI.

### Changed

- **`packages/core/src/flows/index.js`**, re-exports `activateChain`.
- **`packages/extension/src/background/createBackgroundHost.js`**, registers `wallet.activateChain`.
- **`packages/extension/src/popup/messaging.js`**, exports `activateChainRequest`.
- **`packages/web/src/messaging.js`**, exports `activateChainRequest`.
- **`packages/desktop/renderer/messaging.js`**, exports `activateChainRequest`.
- **`packages/core/src/shared/components/settings/DeveloperModeSection.jsx`**, replaces the deferred Custom-chain-registry row with `<RegtestNetworksRow>` + per-descriptor activation form.
- **`test/smoke/ui/settings-developer-mode.smoke.js`**, pins the new "Regtest networks" subsection and Auto-approve row alongside the still-deferred Raw PSBT / Logs rows.

Closes G149.

## [0.213.0] - 2026-04-27

§48, Cluster Q Step 1 of 3, Auto-approve for localhost dApps (G151).

New `shared/utils/originAutoApprove.js` exports `isLocalhostOrigin(origin)` (parses URL, allowlists `localhost` / `127.0.0.1` / `[::1]` / `::1` on http(s)) and `shouldAutoApproveConnect({ origin, settings })`. Auto-approve fires only when **both** `settings.developerMode` and `settings.autoApproveLocalhost` are true and the origin is loopback. Sign requests (signMessage / signAction / signPsbt / signIn) ALWAYS go through the approval prompt, the password is required to sign and the wallet never caches it, so `bridge.connect` is the only safe step to short-circuit.

`bridge.connect` reads live settings via `deps.vault.settings.get()`; on auto-approve it synthesizes a conservative connect decision: `canSignMessage:false` and `canSignAction:{}` so the connection capability is granted without granting any background signing rights.

Settings → Developer Mode panel: the previously-disabled "Auto-approve localhost dApps" row now wires `settings.autoApproveLocalhost`, greyed out unless Developer Mode is on.

### Added

- **`packages/core/src/shared/utils/originAutoApprove.js`** (new), origin classifier + auto-approve guard.
- **`test/smoke/bridge/auto-approve-localhost.smoke.js`** (new), pins helper surface, bridge.connect short-circuit, Settings toggle, and schema validation.

### Changed

- **`packages/core/src/schemas/settings.js`**, adds optional `autoApproveLocalhost: boolean` (v2-tolerant; missing is fine, present must be boolean).
- **`packages/extension/src/bridge/handlers.js`**, `bridge.connect` consults `shouldAutoApproveConnect` before calling `approvals.connect`; synthesizes a permissive-but-non-signing decision when the gate fires.
- **`packages/core/src/shared/components/settings/DeveloperModeSection.jsx`**, Auto-approve toggle row activated; gated on Developer Mode being on.

Closes G151.

## [0.212.0] - 2026-04-27

§37, Cluster P Step 5 of 5, Form-draft persistence (G125). **Cluster P closed.**

New `shared/hooks/useFormDraft.js` exposes a per-(view, walletId) localStorage helper for in-progress form drafts. Storage shape `{savedAt: <ms>, values: {...}}` keyed under `xc:formdraft:<view>:<walletId|none>`. 24 h TTL discards stale drafts on load. Empty-values writes remove the entry rather than persisting blank fields. `safeStorage()` probe guards against disabled / quota-exhausted localStorage so the rest of the form keeps working when persistence isn't available.

Two integrations:

- **Send.jsx** auto-saves `chainId` / `toAddress` / `asset` / `amount` / `memo`; never persists `password`. Restore banner offers Restore / Discard when a draft is found on mount; draft is cleared after a successful broadcast.
- **SignMessageForm** auto-saves `chainId` / `addressId` / `message`; same restore-banner pattern; cleared after a successful sign.

Per the hook docstring, **callers are responsible for keeping signing material out of the draft**, the hook does no field-level filtering.

### Added

- **`packages/core/src/shared/hooks/useFormDraft.js`** (new), per-view / per-walletId localStorage helper with TTL.
- **`test/smoke/ui/form-draft-persistence.smoke.js`** (new), pins hook surface + Send / SignMessage wiring + the no-password assertion.

### Changed

- **`packages/core/src/shared/routes/Send.jsx`**, useFormDraft hook + restore banner + clear-on-success.
- **`packages/core/src/shared/routes/SignMessageForm.jsx`**, useFormDraft hook + restore banner + clear-on-success.

Closes G125. **Cluster P, §37 Micro-UX leftovers, closed at v0.212.0.**

## [0.211.0] - 2026-04-27

§37, Cluster P Step 4 of 5, Error recovery one-click fixes (G121).

`StatusMessage` gains a `recovery: { label, onAction, ariaLabel? }` slot that renders an inline action button next to the message, the recovery affordance shares the same `aria-live` region so screen readers announce the diagnostic and the fix together. Rejections from `recovery.onAction` are swallowed so the original error message stays visible while the caller surfaces its own follow-up.

Four high-traffic forms wire recovery actions:

- **Send.jsx** form-error row offers "Use Max" when the failure copy mentions the amount and a non-zero balance is available; the same recovery surfaces on `submitError` strings matching `/insufficient|not enough/i`.
- **PsbtSignForm** offers "Clear" on the unrecognized-paste error to wipe the textarea in one click.
- **ImportWallet** backup lane offers "Browse" on missing-file errors, routed through the existing dropzone `openFilePicker`.
- **PairSignerForm** offers "Try again" on transient pairing failures, gated to skip WebHID-unsupported errors where retry is pointless.

### Added

- **`test/smoke/ui/error-recovery.smoke.js`** (new), pins `recovery` prop + the four wiring sites.

### Changed

- **`packages/core/src/ui/StatusMessage.jsx`** + **`StatusMessage.module.css`**, `recovery` slot, flex layout for message-plus-button.
- **`packages/core/src/shared/routes/Send.jsx`**, form-error and submit-error rows swap to `<StatusMessage>` with conditional Use-Max recovery.
- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, invalid-paste row gains a Clear recovery.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, error row gains a Browse recovery for the backup lane.
- **`packages/core/src/shared/routes/PairSignerForm.jsx`**, pairing error row gains a Try-again recovery.

Closes G121.

## [0.210.0] - 2026-04-27

§37, Cluster P Step 3 of 5, Contextual tooltips (G122).

New `<InfoTip>` primitive in `@xchain-wallet/core/ui` ships a self-contained "?" affordance that surfaces a short explanation without claiming layout space. Real `<button type="button">` trigger so it doesn't submit forms; `aria-describedby` wires the bubble id to the trigger when open; `role="tooltip"` on the bubble; opens on hover / focus / click; dismisses on Esc, blur, or outside pointer. Honours `prefers-contrast: more`.

Wired into the five spots §37 calls out as the most user-confusing controls:

- **Send.jsx**, Replace-by-fee toggle.
- **FeeSelector**, Network fee tier picker.
- **CreateWallet**, BIP39 passphrase advanced toggle.
- **DerivationPathCrossCheck**, Derivation path label (HW signing).
- **AdsSection**, "Send when accumulated" trigger threshold.

### Added

- **`packages/core/src/ui/InfoTip.jsx`** + **`InfoTip.module.css`** (new), primitive.
- **`test/smoke/ui/info-tip.smoke.js`** (new), pins primitive surface + 5 integrations.

### Changed

- **`packages/core/src/ui/index.js`**, re-exports `InfoTip`.
- **`packages/core/src/ui/FeeSelector.jsx`**, InfoTip beside the "Network fee" label.
- **`packages/core/src/shared/routes/Send.jsx`**, InfoTip beside the RBF toggle copy.
- **`packages/core/src/shared/routes/CreateWallet.jsx`**, InfoTip beside the BIP39-passphrase advanced toggle.
- **`packages/core/src/shared/components/DerivationPathCrossCheck.jsx`**, InfoTip beside the Derivation path label.
- **`packages/core/src/shared/components/settings/AdsSection.jsx`**, InfoTip beside the "Send when accumulated" label.

Closes G122.

## [0.209.0] - 2026-04-27

§37, Cluster P Step 2 of 5, Drag-and-drop file handling (G123).

New `shared/hooks/useDropZone.js` factors the (preventDefault → setDragOver → validate → FileReader) plumbing into a reusable hook. Configurable `accept` allowlist (extension or MIME), `maxBytes` cap (default 2 MB), and `readAs: 'text' | 'arrayBuffer'` mode. Returns `{ rootProps, isDragOver, openFilePicker, pickerProps }` so a host can spread drop handlers onto any container and mount a hidden `<input type="file">` for a Browse fallback.

Three integrations land at the same time:

- **PsbtSignForm** picks up binary `.psbt` drop + Browse: hook reads as ArrayBuffer, helper converts to hex, the existing `normalizePsbtInput` pipeline takes it from there. Closes the FOLLOWUP from Cluster E Step 2 (PSBT file drop).
- **Settings → Contacts** Import row gains drop support (JSON only); the existing click-to-pick + the new drop both route through a shared `importFromText` helper.
- **ImportWallet** backup-restore lane gains drop support on the textarea (.xchain-wallet / JSON / .txt); seeds the existing `backupContent` / `backupFileName` state so the rest of the lane is unchanged.

The pre-existing one-off mnemonic-txt drop in ImportWallet keeps its bespoke wiring, the hook is opt-in for new sites.

### Added

- **`packages/core/src/shared/hooks/useDropZone.js`** (new), shared drop hook + hidden-input picker.
- **`test/smoke/ui/dropzone-hook.smoke.js`** (new), pins hook surface + the three integrations.

### Changed

- **`packages/core/src/shared/routes/PsbtSignForm.jsx`**, wraps the textarea in the drop zone, adds Browse for .psbt button, routes ArrayBuffer → hex through the existing paste pipeline.
- **`packages/core/src/shared/components/settings/ContactsSection.jsx`**, JSON drop on the Import row routes through a new `importFromText` helper shared with the click-to-pick path.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, backup-restore textarea picks up drop; hint copy updated.

Closes G123.

## [0.208.0] - 2026-04-27

§37, Cluster P Step 1 of 5, Haptic feedback (G120).

New `shared/hooks/useHaptic.js` wraps `navigator.vibrate` behind a feature-detect and a `prefers-reduced-motion` guard. Exposes intent-named pulses, `tap` / `success` / `warn` / `error`: plus a generic `vibrate(pattern)` and `supported` / `reducedMotion` flags. Unsupported hosts and the reduced-motion preference both no-op silently so callers don't have to feature-detect. Vibration exceptions (background-tab restrictions, permissions-policy) are swallowed by a try/catch.

ToastHost is the single chokepoint that fires variant-aware pulses for every app-wide success / error / default toast, so every existing toast site picks up haptic feedback without touching individual call sites. Send.jsx fires `haptic.success()` after a confirmed broadcast and `haptic.error()` on submit failure. Locked.jsx fires `haptic.success()` on password / biometric unlock and `haptic.error()` on bad password / biometric failure.

### Added

- **`packages/core/src/shared/hooks/useHaptic.js`** (new), vibration hook + `HAPTIC_PATTERNS` map.
- **`test/smoke/ui/haptic-feedback.smoke.js`** (new), pins hook surface + ToastHost / Send / Locked wiring.

### Changed

- **`packages/core/src/shared/components/ToastHost.jsx`**, fires `haptic.error / success / tap` keyed to toast variant.
- **`packages/core/src/shared/routes/Send.jsx`**, `haptic.success` after broadcast, `haptic.error` on submit failure.
- **`packages/core/src/shared/routes/Locked.jsx`**, `haptic.success` on unlock, `haptic.error` on password / biometric failure.

Closes G120.

## [0.207.0] - 2026-04-27

§23, Cluster O Step 4 of 4, Chain filter remembers last choice (G052). Cluster O closed.

History page's `enabledChains` Set and UnifiedBalanceList's coin-family filter now persist to localStorage and restore on mount. New `shared/utils/chainFilterMemory.js` provides `readChainSet` / `writeChainSet` (for Sets of chainIds) and `readChainString` / `writeChainString` (for single coin-family values), each guarded against missing / disabled / corrupt localStorage. History intersects the restored Set with the wallet's currently-active chains so a removed chain doesn't leave a stale entry; UnifiedBalanceList falls back to 'all' silently when the persisted family is no longer in the dataset. Per project memory, ephemeral per-wallet UI prefs live in localStorage so a from-seed restore lands the user on a fresh "show all" view rather than inheriting cross-device filter state.

This step also flips G093 (delete-contact undo toast) to ✅ as a bookkeeping entry, the actual code shipped at v0.161.0 (Cluster D Step 1 / G119) but the SPEC_GAPS row was missed when G119 closed. Inspecting `ContactsList.jsx:121` confirms full snapshot + restore + saveContact wiring already exists.

### Added

- **`packages/core/src/shared/utils/chainFilterMemory.js`** (new), defensive localStorage helpers under the `xc:chainFilter:` namespace.

### Changed

- **`packages/core/src/shared/components/UnifiedBalanceList.jsx`**, filter state seeds from `readChainString`, persists via `writeChainString`, falls back to 'all' on stale value.
- **`packages/core/src/shared/routes/History.jsx`**, `enabledChains` initial state honours the persisted Set (intersected with active chains); `toggleChain` writes the new Set back inside the setState updater so batched toggles all persist.

### Bookkeeping

- **`SPEC_GAPS.md`**, G093 flipped to ✅ at v0.161.0 (already shipped via Cluster D Step 1 / G119 work; row was missed).

Closes G052 + G093 (bookkeeping). **Cluster O, §26 + §31 + §23 polish, closed at v0.207.0.**

## [0.206.0] - 2026-04-27

§31, Cluster O Step 3 of 4, Save-as-contact prompt in History (G090).

History detail card now offers a "Save as contact" affordance whenever the entry has a peer address (destination on a SEND, source on a RECEIVE) that isn't already the user's own address and isn't already saved as a contact. Click → inline name input → calls `messaging.saveContact({ input: { name, entries: [{ chain, address }] } })`. Contacts are fetched once on first DetailCard mount, then deduplicated locally so scrolling through several entries doesn't refetch. Failure modes degrade silently, the prompt simply doesn't render. ChainId-to-coin mapping uses the prefix split (`bitcoin-mainnet` → `bitcoin`).

### Added

- **`packages/core/src/shared/routes/History.jsx`**, `<SaveContactPrompt>` inline component + `peerAddressOfEntry` / `coinOfChainId` helpers; mounted inside the DetailCard's local-side panel above RbfActions.
- **`packages/core/src/shared/routes/History.module.css`**, `.saveContactRow`, `.saveContactForm`, `.saveContactLabel`, `.saveContactInput`, `.saveContactError`, `.saveContactActions` styles matching the existing RBF affordance pattern.

Closes G090.

## [0.205.0] - 2026-04-27

§26, Cluster O Step 2 of 4, Auto-lock timeout from settings (G065).

`useAutoLock` was hardcoded to a 5-minute idle threshold even though `settings.autolockMinutes` already existed as a top-level field (default 15 min) with a Settings → Safety panel UI. `Home.jsx` now reads `autolockMinutes` via `useSettings()`, clamps to [1, 1440] minutes (defends against a hand-edited storage record), and passes the resulting `idleMs` to `useAutoLock`. The Safety section's existing dropdown now actually drives the timer.

### Changed

- **`packages/core/src/shared/routes/Home.jsx`**, `useSettings()` import + read; clamped `autolockMinutes`; `idleMs` plumbed into `useAutoLock`.

Closes G065.

## [0.204.0] - 2026-04-27

§26, Cluster O Step 1 of 4, Auto-lock wired into web App (G064).

`Home.jsx` was gating `useAutoLock` on `shell === 'popup'` only, so the web tab never auto-locked despite the hook being shell-agnostic. Web was opted out historically on the assumption that tab-close implicitly locks; in practice users leave the tab open for hours, and a backgrounded tab benefits from idle timeout. Auto-lock now enables for both `popup` and `web` shells. Desktop continues to manage its own OS-keychain-backed lock cadence and stays opted out here. Timeout is still hardcoded to 5 minutes, Step 2 (G065) wires it to a settings field.

### Changed

- **`packages/core/src/shared/routes/Home.jsx`**, `useAutoLock` enabled gate now `(shell === 'popup' || shell === 'web') && !locking`; doc-comment updated to reflect the new scope.

Closes G064.

## [0.203.0] - 2026-04-27

§18, Cluster N Step 4 of 4, Firmware manifest JSON bundle (G029). Cluster N closed.

The firmware manifest already shipped as a bundled JS module (`packages/core/src/signers/firmware-manifest.js`) since the §18 scaffolding landed; the `signer-scaffold` smoke explicitly asserts the JS form is canonical and that no `firmware-manifest.json` exists. G029's "JSON bundle" framing in the original audit was a naming guess. This step closes the gap by treating the JS module as the spec-equivalent fulfillment + sharpening its metadata: the manifest now carries `schema`, `generatedAt` (ISO date), and a new `walletVersion` field imported from `buildInfo.WALLET_VERSION` so advisory data is linked to a release. Header comment expanded to document the design choice (why JS, why bundled, how to update). Smoke pins `schema`, `generatedAt`, and `walletVersion` so a future drift surfaces immediately. Runtime-fetch path for between-release advisories is tracked as Cluster N FOLLOWUP 1.

### Changed

- **`packages/core/src/signers/firmware-manifest.js`**, header comment expanded; `walletVersion` field added (imports from `buildInfo.WALLET_VERSION`); `generatedAt` bumped.
- **`test/smoke/signers/signer-scaffold.smoke.js`**, asserts `schema`, `generatedAt` (ISO format), and `walletVersion` (semver-shaped).

Closes G029. **Cluster N, §18 Hardware Wallet polish, closed at v0.203.0.**

## [0.202.0] - 2026-04-27

§18, Cluster N Step 3 of 4, Derivation-path cross-check copy verification (G031).

`DerivationPathCrossCheck` instruction copy now explicitly calls out that the user must verify **both** the derivation path **and** the address against what the device shows (the previous copy only mentioned the address, a malicious encoder could try to coax a signature from a different sub-account at a different path). New per-vendor hint paragraph describes what each device family actually displays so first-time HW users know where to look (Trezor: side-by-side; Ledger Nano: right-button step; Ledger Stax: stacked). New optional `requireExplicitConfirm` prop renders an "I've verified path + address" checkbox the parent form can require before enabling Submit; checkbox auto-resets whenever path or address changes so a stale "yes I verified" can't survive a sub-account switch. Existing callers render unchanged (prop is opt-in).

### Changed

- **`packages/core/src/shared/components/DerivationPathCrossCheck.jsx`**, verify-pass instruction copy + per-vendor hint + optional `requireExplicitConfirm` checkbox.
- **`packages/core/src/shared/components/DerivationPathCrossCheck.module.css`**, `.deviceHint`, `.confirmRow`, `.confirmCheckbox` styles.

Closes G031.

## [0.201.0] - 2026-04-27

§18, Cluster N Step 2 of 4, Firmware-update warning banner in sign flow (G030).

A new `<HwFirmwareBanner>` component runs `checkFirmware()` against the paired device's vendor / model / firmwareVersion at sign time and renders a severity-tiered banner (error for vulnerable / unsupported, warning for outdated, neutral note for unknown, no banner for ok). Mounted inside `<HwSignBlock>` whenever the caller threads `signerInfo`. `<SignCredentials>` accepts the same prop and threads through. `Send.jsx` (the highest-traffic HW sign surface) looks up the SignerRecord via a new `messaging.listSigners(walletId)` effect and passes `{ vendor, model, firmwareVersion }` to HwSignBlock. Other forms can adopt the same pattern in follow-ups; until they do, they render gracefully without the banner since the prop is optional.

### Added

- **`packages/core/src/shared/components/HwFirmwareBanner.jsx`** + **`HwFirmwareBanner.module.css`** (new), sign-flow firmware-warning banner; exposes `isFirmwareSignBlocked()` helper for callers that want to hard-gate Submit on `unsupported`.

### Changed

- **`packages/core/src/shared/components/HwSignBlock.jsx`**, accepts optional `signerInfo` prop; renders `<HwFirmwareBanner>` above the derivation cross-check when supplied.
- **`packages/core/src/shared/components/SignCredentials.jsx`**, threads `signerInfo` through to HwSignBlock.
- **`packages/core/src/shared/routes/Send.jsx`**, fetches the wallet's signer list once on mount, derives `hwSignerInfo` for the current source address, passes it into HwSignBlock.

Closes G030.

## [0.200.0] - 2026-04-27

§18, Cluster N Step 1 of 4, Ledger WebHID compatibility notice (G032).

`PairSignerForm` now feature-detects `navigator.hid` before letting the user click the Ledger card. On a browser without WebHID (Firefox, Safari) the card is disabled and the tag explains which browsers do support it; clicking the card via keyboard surfaces the same message via `setError`. UA-sniffing is intentionally narrow, we identify Firefox + Safari by name so the copy is specific, but the gate is the feature detect. Trezor pairing is unaffected (Trezor Connect runs in its own popup independently of WebHID).

### Added

- **`packages/core/src/shared/utils/webhidSupport.js`** (new), `isWebHidSupported()` + `detectBrowserFamilyForWebHidHint()` helpers.

### Changed

- **`packages/core/src/shared/routes/PairSignerForm.jsx`**, Ledger card disabled when WebHID unavailable; vendor-tag copy branches on Firefox / Safari / generic.

Closes G032.

## [0.199.0] - 2026-04-27

§13, Cluster M Step 6 of 6, `docs/QA_Checklist.md` (G017). Cluster M closed.

Manual pre-release checklist a release manager runs against every shell (web / extension / desktop) before tagging. Sections cover pre-flight, onboarding, send, receive, history, token detail, sign screens, lock / unlock / panic, backup and recovery, hardware signers, multisig, dApp bridge, offline mode, accessibility, URI schemes, and build / release artifacts. Sign-off block at the end captures the release manager, version under test, and any waivers. Status icons (✅ / ⬜ / ❌ / ⏸) used throughout per project memory rule (no GFM checkboxes). Cluster M (§13 + §55 docs / legal pre-launch paperwork) closes here at six rows shipped (G008 / G013 / G014 / G017 / G175 / G176 / G177).

### Added

- **`docs/QA_Checklist.md`** (new), manual pre-release feature-correctness checklist.

Closes G017. **Cluster M, §13 + §55 Docs & Legal, closed at v0.199.0.**

## [0.198.0] - 2026-04-27

§13, Cluster M Step 5 of 6, `docs/BRIDGE.md` (G014).

dApp-developer-facing reference for the `window.xchain` provider. Derived directly from `packages/bridge-spec/src/index.ts` so it cannot drift from the normative TypeScript types. Covers detection (`getProvider` + `PROVIDER_READY_EVENT`), lifecycle (`connect` / `disconnect`), read methods, sign methods (`signMessage` / `signAction` / `signPsbt` / `signIn` / `parallel`), the v1 Sign-In with XChain wire format, events, the full `BridgeErrorCode` set, the per-site permissions model, versioning, and a pointer to `packages/test-dapp/` as the copy-paste source.

### Added

- **`docs/BRIDGE.md`** (new), `window.xchain` API reference for dApp developers.

Closes G014.

## [0.197.0] - 2026-04-27

§13, Cluster M Step 4 of 6, `docs/ARCHITECTURE.md` (G013).

In-repo architecture orientation document. Covers the three-shell model (web / extension / desktop), monorepo layout, per-package responsibilities, the four-layer signal flow (component → flow → host bridge → SDK), signer abstraction, storage substrate, dApp bridge architecture, approval broker, reachability / offline mode, synchronized versioning, and pointers to deeper docs. Distinct from the dApp-developer-facing `BRIDGE.md` (Step 5) and the protocol-spec sister doc maintained in the parent platform repo.

### Added

- **`docs/ARCHITECTURE.md`** (new), practical in-repo architecture orientation.

Closes G013.

## [0.196.0] - 2026-04-27

§55, Cluster M Step 3 of 6, `CODE_OF_CONDUCT.md` (G177).

Adds the canonical Contributor Covenant 2.1 at the repo root. Hugo TOML frontmatter stripped; reporting contact set to `conduct@dankest.llc`. The CONTRIBUTING.md "Code of Conduct" section already links to this file.

### Added

- **`CODE_OF_CONDUCT.md`** (new, repo root), Contributor Covenant 2.1, project-customized contact.

Closes G177.

## [0.195.0] - 2026-04-27

§13, Cluster M Step 2 of 6, `CONTRIBUTING.md` (G176).

Adds a root-level `CONTRIBUTING.md` covering: repo layout, prerequisites (Node ≥ 18, pnpm 9.x, sibling `xchain-sdk` checkout), per-shell dev / build commands, the layered test suite + the 24 / 171 smoke baseline rule, synchronized-versioning bump procedure, CHANGELOG format, commit-message conventions, JS-only-no-TS / no-emoji / trailing-two-spaces style notes, PR gates, bug-reporting and Code-of-Conduct pointers. README's old "lands alongside v1.0.0 GA" placeholder for contribution guidance is now fulfilled by this file.

### Added

- **`CONTRIBUTING.md`** (new, repo root), contributor onboarding + workflow guide.

Closes G176.

## [0.194.0] - 2026-04-27

§55, Cluster M Step 1 of 6, `SECURITY.md` (G175 / G008).

Adds a root-level `SECURITY.md` documenting the private vulnerability disclosure path (GitHub Security Advisories preferred; `security@dankest.llc` fallback), 72-hour ack / 90-day disclosure SLAs, in-scope and out-of-scope surfaces (referencing `docs/Threat_Model.md` §3), researcher conduct expectations, and pointers to release-verification artifacts. `buildInfo.js` flips `SECURITY_PUBLISHED` from `false` to `true` so the About panel can render the link as live.

### Added

- **`SECURITY.md`** (new, repo root), vulnerability disclosure policy.
- **`packages/core/src/buildInfo.js`**, `SECURITY_PUBLISHED = true`; comment refreshed.

Closes G175 + G008 (cross-listed §12 / §55 row pair).

## [0.193.0] - 2026-04-27

§50, Cluster L Step 4, Diagnostic dump UI (G156). Cluster L closed.

The `flows/diagnosticDump` primitive has shipped for a while; what was missing was a user-facing affordance. About panel now exposes a "Copy diagnostics" button that invokes `messaging.getDiagnosticDump`, JSON-pretty-prints the result, and writes it to the clipboard. Status / error rows announce via `aria-live` so screen reader users hear the result. New `diagnostic.dump` host handler is wired across the extension background; messaging shims added in all three shells; `@xchain-wallet/core/buildInfo.js` is now an explicit subpath export so the host can read `WALLET_VERSION` without a deep relative path.

### Added

- **`packages/extension/src/background/createBackgroundHost.js`**, `diagnostic.dump` host handler wraps `flows.diagnosticDump`; pulls `diagnosticDump` into the destructured `flows` import; imports `WALLET_VERSION` from `@xchain-wallet/core/buildInfo.js` to thread through.
- **`packages/extension/src/popup/messaging.js`** + **`packages/web/src/messaging.js`** + **`packages/desktop/renderer/messaging.js`**, `getDiagnosticDump()` shims.
- **`packages/core/src/shared/components/settings/AboutSection.jsx`**, "Copy diagnostics" Button row + status / error live regions; uses `useMessaging` to reach the host.
- **`packages/core/package.json`**, `./buildInfo.js` subpath export so non-core consumers can import wallet version + license metadata directly.

Closes G156. **Cluster L, §47 URI Schemes + §50 Diagnostic Dump, closed at v0.193.0.**

## [0.192.0] - 2026-04-27

§47.5, Cluster L Step 3, Desktop URI handler verify (G144).

The desktop deep-link handler was already wired end-to-end (`registerProtocolClients` claims `xchain:` unconditionally + tier-2 BIP21 schemes by opt-in; `attachDeepLinkHandlers` covers macOS `open-url`, Windows/Linux argv parsing, `second-instance`, and single-instance lock; `electron-builder.config.cjs` declares the protocols at install time). The verify pass: `classifyDeepLink` for `xchain:` URIs now parses through the new `parseXchainUri` so the renderer receives a structured `XchainUriIntent` instead of `parsed: null`. Malformed URIs still fall back to `parsed: null` so the renderer can surface a generic error.

### Changed

- **`packages/desktop/main/protocol.js`**, imports `parseXchainUri`; `classifyDeepLink` for `xchain:` URIs returns `parsed: <intent>` (or `null` when intent is `unknown`).
- **`test/smoke/shells/desktop-packaging.smoke.js`**, updated `xchain: broadcast?data=abc` assertion to expect the structured intent shape; preserved the malformed-BIP21 assertion which still expects `parsed: null`.

Closes G144.

## [0.191.0] - 2026-04-27

§47.1, Cluster L Step 2, Web protocol handler registration (G143).

`packages/web/src/main.jsx` now calls `navigator.registerProtocolHandler('web+xchain', '/?uri=%s')` at boot so the browser can register this origin as a handler for `xchain:`-flavored links (browsers prompt the user once on first call). Also tries the bare `xchain` scheme, some browsers accept it, others reject it as not in the safelist; we swallow either path so the SPA always boots cleanly. Wrapped in a try/catch since registerProtocolHandler is a no-op on http origins outside localhost. Per-browser routing of clicked `xchain:` URIs is the same: target URL receives the URI in `?uri=...` so a future router pass can read `location.search` and forward to Send / Receive accordingly.

### Added

- **`packages/web/src/main.jsx`**, `navigator.registerProtocolHandler` calls for `web+xchain` (always safelisted) and `xchain` (try-catch fallback); both target `/?uri=%s` on the SPA's origin.

Closes G143. Read-side wiring (parse `?uri=` from `location.search`, route into Send / Receive based on `parseXchainUri` intent) lands as a Cluster L FOLLOWUP, the registration call is the marquee.

## [0.190.0] - 2026-04-27

§47.4, Cluster L Step 1, `xchain:` URI parser (G145).

New `uri/xchainUri.js` exports `parseXchainUri(uri)` + `buildXchainUri(intent)`. Two URI shapes supported:

- BIP21-style: `xchain:<address>?amount=&tick=&memo=&label=&message=` (delegates to `parseBip21Uri` and pulls `tick` → asset, `memo` → memo).
- Path-style: `xchain://<chainId>/<asset>?amount=&to=&memo=&label=&kind=receive` for cases where the chain needs to be explicit (regtest endpoints, asset transfers).

Output is a normalized `XchainUriIntent` with `kind: 'send' | 'receive' | 'unknown'`, `chainId?`, `asset?`, `address?`, `amount?`, `memo?`, plus the raw `params` map and `required[]` from `req-*` BIP21 extensions. Malformed URIs return `{ kind: 'unknown' }` instead of throwing, callers already had a string from a QR scan or paste and shouldn't have their flow aborted by a typo.

The existing `detectQrContent` already classifies `xchain:` URIs as `xchain-uri` via the BIP21 fallback; the richer parser is a sibling that callers (Send / Receive / a future deep-link handler) can opt into for path-style support.

### Added

- **`packages/core/src/uri/xchainUri.js`** (new), `parseXchainUri` / `buildXchainUri` / `XchainUriIntent` typedef.
- **`packages/core/src/uri/index.js`**, re-exports both helpers.

Closes G145.

## [0.189.0] - 2026-04-27

§53.4, Cluster K Step 4, `prefers-contrast: more` variant (G170). Cluster K closed.

`tokens.css` now ships a high-contrast palette via `@media (prefers-contrast: more)` plus a separate `@media (forced-colors: active)` block that maps our tokens onto Windows system colors (`Canvas` / `CanvasText` / `LinkText` / etc.) so the wallet inherits whatever palette the user picked at OS level. The contrast variant layers on top of either light or dark base theme, only the tokens that needed a kick (text, borders, focus ring, accent) get overridden; spacing / typography / radius tokens stay unchanged.

### Added

- **`packages/core/src/ui/tokens.css`**, `@media (prefers-contrast: more)` palette overrides (light + dark variants); `@media (forced-colors: active)` mapping onto system colors for Windows high-contrast mode.

Closes G170. **Cluster K, §53 Accessibility, closed at v0.189.0.**

## [0.188.0] - 2026-04-27

§53.3, Cluster K Step 3, `<StatusMessage>` ARIA-live primitive (G169).

The codebase already has 183 `aria-live` / `role="alert"` occurrences across the shell layer (Send, sign forms, banners, ToastHost, Input, CopyButton, most of the high-traffic surfaces are covered). What was missing was a shared primitive that gives every form a one-line drop-in for status / error / success copy with the right `role` + `aria-live` per variant, instead of each caller re-declaring the attributes inline.

`<StatusMessage variant="status|error|success">` is now exported from `@xchain-wallet/core/ui`. Renders nothing for empty children; `error` uses `role="alert" aria-live="assertive"`; `status` and `success` use `role="status" aria-live="polite"`. Existing per-form inline implementations stay where they are; new forms (and migration of older inline rows in a future FOLLOWUP) can drop the primitive in.

### Added

- **`packages/core/src/ui/StatusMessage.jsx` + `.module.css`** (new), three-variant ARIA-live row.
- **`packages/core/src/ui/index.js`**, `StatusMessage` re-export.

Closes G169, the foundational primitive is in place, with broad existing coverage already satisfying the per-form requirement.

## [0.187.0] - 2026-04-27

§53.1 + §53.2, Cluster K Steps 1+2, Skip link + semantic landmarks (G167 + G168).

`<Screen>` is now the canonical landmark host: the header slot renders as `<header>`, the body slot is a `<main id="xc-main">` with `tabIndex={-1}` (so the skip link can move focus into it), and the footer slot renders as `<footer>`. A skip-to-main-content `<a>` lives at the top of every screen, visually hidden by default, snaps to the top-left in high contrast on keyboard focus, and Enter jumps focus past the header straight into the body. Combining Steps 1 and 2 because both edits land in `Screen.jsx` / `Screen.module.css` and overlap structurally.

### Changed

- **`packages/core/src/ui/Screen.jsx`**, wrapper drops the `role="group"` shim in favor of real landmarks (`<header>` / `<main>` / `<footer>`); skip-link `<a href="#xc-main">` rendered as the first focusable element; main element has `id="xc-main"` + `tabIndex={-1}` for programmatic focus-after-skip.
- **`packages/core/src/ui/Screen.module.css`**, `.skipLink` styles (off-screen by default, snaps in on focus); `.body:focus { outline: none }` so the post-skip focus ring on `<main>` doesn't render as a frame around the entire content area.

Closes G167 + G168.

## [0.186.0] - 2026-04-27

§25.1, Cluster J Step 4, License agreement scroll-to-enable (G061). Cluster J closed.

First-launch onboarding now opens with a license-acceptance gate. Users see a scrollable summary panel (8 paragraphs covering as-is warranty, seed-loss responsibility, regulatory disclaimer, third-party tool risk, and a pointer to the full LICENSE.md); the "I have read and agree" checkbox stays disabled until the user scrolls to the end of the panel; the "Accept and continue" button stays disabled until both scroll-completion and the checkbox tick. Acceptance is persisted in localStorage (`xc:licenseAcceptedAt`) so returning users don't re-accept. The `add wallet` lane (when `onBack` is supplied) skips the gate, those users already accepted at install.

### Added

- **`packages/core/src/shared/routes/Onboarding.jsx`**, `LICENSE_STORAGE_KEY` / `LICENSE_SUMMARY` / `readAcceptedAt` / `markAccepted`; license-gate render branch with scroll detection (`handleLicenseScroll`); `licenseScrollRef` for the scrollable panel; auto-marks short panels as scrolled when content fits without overflow.
- **`packages/core/src/shared/routes/Onboarding.module.css`**, `.licenseScroll` / `.licenseParagraph` / `.licenseAck` styles; focus-ring on the scroll panel for keyboard users.

Closes G061. **Cluster J, §25 Onboarding polish, closed at v0.186.0.**

## [0.185.0] - 2026-04-27

§25.4, Cluster J Step 3, Animated onboarding explainers (G060).

CSS-only entrance animations on the Welcome screen, logo scale-in, hero fade+slide, actions slide+fade with a small stagger. All wrapped in `prefers-reduced-motion: reduce` so users with the OS toggle see no motion. No JS, no dependencies; the spec called for "explainers" but a single subtle entrance signature is enough to make the screen feel alive without the carousel-style pattern that always feels heavy in a wallet onboarding.

### Changed

- **`packages/core/src/shared/routes/Onboarding.module.css`**, `@keyframes heroEnter` / `actionsEnter` / `logoEnter`; `.heroPopup` / `.heroFull` / `.actionsPopup` / `.actionsFull` / `.logoPopup` / `.logoFull` get an `animation` declaration; `@media (prefers-reduced-motion: reduce)` clears all of them.

Closes G060. A future FOLLOWUP can swap in a multi-step animated carousel if user testing wants more guidance, the spec leaves the depth open.

## [0.184.0] - 2026-04-27

§25.2, Cluster J Step 2, Demo banner (G059).

`<DemoBanner>` mounted above the BackupReminderCard on Home. Renders only when the active wallet matches the localStorage demo flag set in Step 1; offers an "Exit demo & wipe" action that calls `messaging.removeWallet`, clears the flag, and refreshes the App state back to Onboarding. Desktop messaging gains a `removeWallet` shim to match extension + web.

### Added

- **`packages/core/src/shared/components/DemoBanner.jsx` + `.module.css`** (new), checks `flowsLib.isDemoWallet(walletId)` on mount; renders nothing for normal wallets; "Exit demo & wipe" wires through `messaging.removeWallet` + `clearDemoWalletId`.
- **`packages/core/src/shared/routes/Home.jsx`**, mounts `<DemoBanner>` above `<BackupReminderCard>`.
- **`packages/desktop/renderer/messaging.js`**, `removeWallet` shim added (extension + web already had it).

Closes G059.

## [0.183.0] - 2026-04-27

§25.2, Cluster J Step 1, Try-before-commit demo entry (G058).

Onboarding gains a "Try in demo mode" button that generates a 32-byte hex auto-password + a 12-word BIP39 mnemonic in-process, calls `messaging.importMnemonic` against the existing vault path with `name: 'Demo Wallet'`, and refreshes App into the unlocked tree. The demo wallet is marked via a localStorage flag (`xc:demoWalletId`) so future steps can render a persistent banner and offer a one-tap exit.

### Added

- **`packages/core/src/flows/demoMode.js`** (new), `markDemoWallet` / `getDemoWalletId` / `clearDemoWalletId` / `isDemoWallet`; localStorage-backed; re-exported from `flows/index.js`.
- **`packages/core/src/shared/routes/Onboarding.jsx`**, `handleEnterDemo`; "Try in demo mode" button gated on a new `onDemoEntered` callback prop.
- **`packages/core/src/shared/routes/Onboarding.module.css`**, `.demoError` style.
- **`packages/web/src/App.jsx`** + **`packages/extension/src/popup/App.jsx`** + **`packages/desktop/renderer/App.jsx`**, pass `onDemoEntered={refresh}` to `<Onboarding>` so the new button surfaces in every shell.

Closes G058.

## [0.182.0] - 2026-04-27

§28.5, Cluster I Step 5, History export (G081). Cluster I closed.

History page now exposes Export CSV / Export JSON buttons next to the Grouped/Flat toggle. Export operates on the *currently filtered* entry set so chain chips, search query, action-type filter, status filter, and date range all narrow the export. CSV is RFC-4180 (quoting + doubled quotes for embedded delimiters); JSON wraps the rows in a `{ format, exportedAt, scope, entries }` envelope. Download triggered client-side via Blob + anchor click; filename `xchain-history-<scope>-<isoDate>.{csv,json}`.

### Added

- **`packages/core/src/flows/historyExport.js`** (new), `entriesToCsv`, `entriesToJson`, `buildExportFilename`; re-exported from `flows/index.js`.
- **`packages/core/src/shared/routes/History.jsx`**, Export CSV / Export JSON chips in the filter bar; `exportVisibleHistory` Blob-download helper; `chainScopeLabel` summarizes the active chain filter into the filename.

Closes G081. **Cluster I, §27 Balances + §28 History, closed at v0.182.0.**

## [0.181.0] - 2026-04-27

§28.3, Cluster I Step 4, Transaction status timeline (G079).

History `<DetailCard>` now renders a vertical `<TxStatusTimeline>` above the decoded ACTION block. Three stages, Broadcast / Mempool / Confirmed, derived from the explorer fields each entry already carries (`txHash`, `blockIndex`, `timestamp`). Stages flip done / pending based on those values; confirmed rows show the block number + a localized timestamp. Future Signed / Indexed stages are queued as a Cluster I FOLLOWUP (require pendingTx tracking + indexer-sync watermark exposure respectively).

### Added

- **`packages/core/src/shared/components/TxStatusTimeline.jsx` + `.module.css`** (new), derives stage state from entry fields; renders a dot + spine + label/sub copy per stage; reduces to short txid display.
- **`packages/core/src/shared/routes/History.jsx`**, imports `TxStatusTimeline`; renders it inside `DetailCard.detailSide` above the decoded ACTION pre block.

Closes G079.

## [0.180.0] - 2026-04-27

§27.5, Cluster I Step 3, Collectibles grid view (G074).

The NFTs tab in HomeTabs now renders a dedicated `<CollectiblesView>` instead of the row-style `<BalanceList>`. Square thumbnail cards lay out in a responsive 2/3/4-column grid with chain-icon overlays, ticker-letter placeholders (image slot ready for when `messaging.getAssetInfo` lands per Cluster C FOLLOWUP 3), pin / hide affordances on the card chrome, and click-through to the §27.6 token detail page.

### Added

- **`packages/core/src/shared/components/CollectiblesView.jsx` + `.module.css`** (new), grid layout; `<CollectibleCard>` per row; image with `onError` fallback to ticker letter; pin/hide buttons overlaid on the thumbnail; collapsible "Show N hidden" footer mirrors BalanceList.
- **`packages/core/src/shared/components/HomeTabs.jsx`**, imports `CollectiblesView`; the NFTs tab swaps from BalanceList to the new view; empty-state copy reframes "No NFTs" → "No collectibles".

Closes G074.

## [0.179.0] - 2026-04-27

§27.4, Cluster I Step 2, Hidden / spam tokens (G073).

`Settings.hiddenTokens` (v2-tolerant string array) feeds a per-row hide toggle (⊘ / ⊕). Hidden rows collapse out of the main list and into a "Show N hidden tokens" expander at the bottom of each tab. Same persist pattern as pinned tokens. New `detectSpamCandidates(rows)` helper exported for future "auto-hide spam" sweep, flags zero-balance rows + sub-divisibility-dust rows with no fiat price.

### Added

- **`packages/core/src/schemas/settings.js`**, `hiddenTokens?: string[]` field; default `[]`; v2-tolerant validator.
- **`packages/core/src/shared/components/BalanceList.jsx`**, `hiddenKeys` + `onToggleHide` props; visible / hidden split before pinned-first sort; collapsible "Show N hidden" footer; per-row hide button (⊘ / ⊕); exported `detectSpamCandidates(rows)` heuristic.
- **`packages/core/src/shared/components/BalanceList.module.css`**, `.hideBtn` / `.hideBtnActive` / `.hiddenToggle` styles.
- **`packages/core/src/shared/components/HomeTabs.jsx`**, passes `hiddenKeys` + `onToggleHide` through to BalanceList.
- **`packages/core/src/shared/routes/Home.jsx`**, `hiddenTokens` state loaded alongside `pinnedTokens`; `handleToggleHide` mirrors `handleTogglePin`; both threaded into HomeTabs.

Closes G073.

## [0.178.0] - 2026-04-27

§27.3, Cluster I Step 1, Pinned tokens on Home (G072).

`Settings.pinnedTokens` (v2-tolerant string array of `chainId:asset` keys) feeds a star-toggle on each balance row; pinned rows sort to the top of the Coins / Tokens / NFTs tabs. Toggle persists optimistically through `messaging.updateSettings`.

### Added

- **`packages/core/src/schemas/settings.js`**, `pinnedTokens?: string[]` field; default `[]`; v2-tolerant validator.
- **`packages/core/src/shared/components/BalanceList.jsx`**, `pinnedKeys` + `onTogglePin` props; pinned-first stable sort; per-row star button (★ / ☆) with keyboard support; `.rowPinned` highlight.
- **`packages/core/src/shared/components/BalanceList.module.css`**, `.pinBtn` / `.pinBtnActive` / `.rowPinned` styles.
- **`packages/core/src/shared/components/HomeTabs.jsx`**, passes `pinnedKeys` + `onTogglePin` through to BalanceList.
- **`packages/core/src/shared/routes/Home.jsx`**, `pinnedTokens` state loaded from Settings on mount; `handleTogglePin` updates state + persists via `messaging.updateSettings`; `pinnedKeys={new Set(pinnedTokens)}` wired into HomeTabs.

Closes G072.

## [0.177.0] - 2026-04-27

§19.7, Cluster H Step 7, Progressive backup reminder card on Home (G034 + G062). Cluster H closed.

New `flows/backupReminder.js` tracks per-wallet backup-verified timestamps in `localStorage` (no schema churn) and computes a three-state reminder (`hidden` / `gentle` / `firm`) based on wallet age, never-verified status, and the user's `settings.backupReminders` cadence. CreateWallet now calls `markBackupVerified` after the §19.2 quiz passes; BackupSection's encrypted-backup export marks the wallet verified on success. Home mounts a new `<BackupReminderCard>` above the balance grid that reads the state on mount, renders nothing for never-shown cases, surfaces a Dismiss-for-24h button on the gentle variant, and routes "Back up now" to Settings.

### Added

- **`packages/core/src/flows/backupReminder.js`** (new), `markBackupVerified` / `getBackupVerifiedAt` / `dismissBackupReminder` / `computeBackupReminderState`; localStorage-backed (`xc:backupVerifiedAt`, `xc:backupReminderDismissedUntil`). Re-exported from `flows/index.js`.
- **`packages/core/src/shared/components/BackupReminderCard.jsx` + `.module.css`** (new), loads settings via messaging on mount, reads `computeBackupReminderState`, renders the gentle / firm card; "Back up now" CTA routes through `onAction`.
- **`packages/core/src/shared/routes/Home.jsx`**, mounts `<BackupReminderCard>` above HomeTabs with `onAction={() => setSettingsOpen(true)}`.
- **`packages/core/src/shared/routes/CreateWallet.jsx`**, captures the new walletId from `messaging.importMnemonic` / `addImportedWallet` and calls `flowsLib.markBackupVerified(walletId)` after persist.
- **`packages/core/src/shared/components/settings/BackupSection.jsx`**, calls `flowsLib.markBackupVerified(activeWallet.id)` after a successful encrypted-backup export.

Closes G034 and G062. **Cluster H, Onboarding & Recovery, closed at v0.177.0.**

## [0.176.0] - 2026-04-27

§19.2, Cluster H Step 6, Backup verification quiz on Create (G033).

After the user ticks "I've saved my recovery phrase", `CreateWallet.jsx` advances to a new `verify` stage that quizzes three random non-adjacent word positions before the actual persist. Quiz positions are picked once per attempt (no reshuffle on re-render), Fisher-Yates shuffled, position #1 skipped (just shown as the first row of the grid). On match → `handlePersist`; on mismatch → inline error with the offending position. Back button returns to mnemonic stage so the user can re-read the phrase.

### Added

- **`packages/core/src/shared/routes/CreateWallet.jsx`**, `verify` stage in the union; `quizPositions` / `quizAnswers` / `quizError` state; `pickQuizPositions` (Fisher-Yates + non-adjacent guard); `handleStartVerify` (mnemonic → verify); `handleSubmitVerify` (compares typed words, persists on match); mnemonic-stage CTA now reads "Verify recovery phrase" and routes through verify.
- **`packages/core/src/shared/routes/CreateWallet.module.css`**, `.quizList` / `.quizRow` / `.quizIndex` styles.

### Changed

- **`test/smoke/ui/ads-onboarding-consent.smoke.js`**, relax stage-union assertion from a full literal match to `/'ads-consent'/` so future stage additions don't churn the smoke.

Closes G033.

## [0.175.0] - 2026-04-27

§19.4, Cluster H Step 5, Encrypted backup restore lane in ImportWallet (G036).

`ImportWallet.jsx` gains a "Recovery phrase / Encrypted backup" lane switcher (suppressed in the FreeWallet variant). The backup lane accepts a `.xchain-wallet` file via `<input type="file">` (or pasted JSON), the backup password, and an optional "Overwrite if any record collides" toggle. Submit calls the new `messaging.importBackupRequest` shim → `wallet.importBackup` host handler → `flows.importBackupFile`, then fires `onImported()` so the caller refreshes into the now-restored wallet.

### Added

- **`packages/extension/src/background/createBackgroundHost.js`**, `wallet.importBackup` host handler wrapping `flows.importBackupFile`; pulls the flow into the destructured `flows` import.
- **`packages/extension/src/popup/messaging.js`** + **`packages/web/src/messaging.js`** + **`packages/desktop/renderer/messaging.js`**, `importBackupRequest` shims.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, `lane` state + lane switcher + backup-lane state (`backupContent` / `backupPassword` / `backupOverwrite` / `backupFileName`) + `handleBackupFile` + `handleBackupSubmit`; mnemonic-lane block wrapped in `lane === 'mnemonic'` conditional.
- **`packages/core/src/shared/routes/ImportWallet.module.css`**, `.laneSwitcher` / `.laneTab` / `.laneTabActive` / `.backupFileInput` / `.backupHint` styles.

Closes G036.

## [0.174.0] - 2026-04-27

§15.5, Cluster H Step 4, Import WIF + backup-implications warning (G020 + G021).

`AddressList.jsx` gains an "Import private key (WIF)" toggle that expands an inline form: chain select, WIF input, optional label, wallet password, plus a required acknowledgement that the imported key is **not** covered by the recovery phrase. On submit, the new `messaging.importWifRequest` shim routes through a fresh `wallet.importWif` host handler that calls the existing `flows.importWif` primitive (encrypts the WIF under the same master key as the seed, persists an `imported-wif` Address record + `Wallet.importedKeys` entry).

### Added

- **`packages/extension/src/background/createBackgroundHost.js`**, `wallet.importWif` host handler wrapping `flows.importWif`; pulls the flow into the destructured `flows` import.
- **`packages/extension/src/popup/messaging.js`** + **`packages/web/src/messaging.js`** + **`packages/desktop/renderer/messaging.js`**, `importWifRequest` shims.
- **`packages/core/src/shared/routes/AddressList.jsx`**, inline WIF form state + `handleImportWif` + Import-private-key toggle and form markup; reloads `addressesByChain` on success.
- **`packages/core/src/shared/routes/AddressList.wif.module.css`** (new), `.wifBar` / `.wifForm` / `.wifWarning` / `.wifField` / `.wifSelect` / `.wifAck` / `.wifErrorBox` / `.wifActions` styles.

Closes G020 and G021.

## [0.173.0] - 2026-04-27

§15.4, Cluster H Step 3, QR scan + drag-drop mnemonic on Import (G022).

ImportWallet header now exposes a "Scan QR" toggle that mounts the existing `<QrScanner>` over the textarea; the first detected QR string fills the mnemonic field (with an optional `bip39:` prefix stripped). The textarea wrapper is now a drop zone, dragging a `.txt` (or `.asc`) file in extracts the longest line that looks like a wordlist of ≥12 words, falling back to the raw file contents.

### Added

- **`packages/core/src/shared/routes/ImportWallet.jsx`**, `scanning` / `dragOver` state; `handleQrFrame` strips `bip39:` and assigns; `handleFileDrop` reads with FileReader and picks the best mnemonic line; Scan QR button + scanner block + drop-zone wrapper.
- **`packages/core/src/shared/routes/ImportWallet.module.css`**, `.mnemonicHeader` / `.scanButton` / `.scannerBox` / `.dropZone` / `.dropZoneActive` / `.dropHint` styles.

Closes G022.

## [0.172.0] - 2026-04-27

§15.6, Cluster H Step 2, BIP39 passphrase (25th word) in CreateWallet + ImportWallet.

CreateWallet adds an "Add a BIP39 passphrase (advanced)" toggle that reveals two passphrase inputs and a warning that the passphrase is required to recover and cannot be reset. ImportWallet adds a "This wallet uses a BIP39 passphrase" toggle with a single passphrase input. Both threads pass `bip39Passphrase` through `messaging.importMnemonic` / `messaging.addImportedWallet`. FreeWallet variant suppresses the toggle (Counterwallet legacy rejects passphrases).

### Added

- **`packages/core/src/shared/routes/CreateWallet.jsx`**, `showPassphrase` / `bip39Passphrase` / `bip39PassphraseConfirm` state; advanced toggle + warning + matched-pair inputs; passphrase threaded into the import call.
- **`packages/core/src/shared/routes/CreateWallet.module.css`**, `.advancedRow` / `.advancedToggle` / `.advancedWarning` styles.
- **`packages/core/src/shared/routes/ImportWallet.jsx`**, `showPassphrase` / `bip39Passphrase` state; advanced toggle + single passphrase input (FreeWallet suppressed); passphrase threaded into the import call.
- **`packages/core/src/shared/routes/ImportWallet.module.css`**, `.advancedRow` / `.advancedToggle` styles.

Closes G019.

## [0.171.0] - 2026-04-27

§15.1, Cluster H Step 1, 12 vs 24-word selector in CreateWallet.

CreateWallet password stage now exposes a "Recovery phrase length" radio group (12 words / 24 words). The selection threads into `cryptoLib.generateBip39Mnemonic(strength)` (128-bit vs 256-bit entropy) and the recovery-phrase display copy reflects the chosen count.

### Added

- **`packages/core/src/shared/routes/CreateWallet.jsx`**, `wordCount` state (12 default), radio fieldset before submit, dynamic copy on the mnemonic display screen.
- **`packages/core/src/shared/routes/CreateWallet.module.css`**, `.wordCountRow` / `.wordCountLegend` / `.wordCountOption` / `.wordCountLabel` / `.wordCountHint` styles.

Closes G018.

## [0.170.0] - 2026-04-27

§49.3/§49.5, Step 2 of Cluster G, StalenessLabel (G155) + QueuedBroadcastBanner (G154 partial); Cluster G closed.

`<StalenessLabel lastSyncedAt={...}>` is a small reusable presentational component that renders "Last synced 12s ago" copy; ticks itself on a 30s interval; renders nothing when `lastSyncedAt` is null/undefined per §49.3 (never fabricate data); tones into a warning style past an optional `warnAfterMs` threshold. Callers (balance views, history feed, market panels) drop it next to fetched data without parent re-renders.

`<QueuedBroadcastBanner walletId={activeWalletId} />` lists signed transactions queued for broadcast and exposes per-row "Broadcast now" / "Discard" actions. The banner returns null when the queue is empty. v0.170.0 ships the UI, the messaging surface (`listQueuedBroadcasts`, `broadcastQueuedRequest`, `discardQueuedRequest`), and a per-walletId in-memory queue in the background process; auto-enqueue from offline broadcasts, persistent storage, and a "you have 1 queued tx, broadcast now?" prompt on reconnection are tracked as Cluster G FOLLOWUPs. G154 stays 🟡 partial, the banner is reachable and exercises end-to-end if something explicitly enqueues, but no wallet path enqueues yet.

### Added

- **`shared/components/StalenessLabel.jsx` + `.module.css`** (new), presentational; tolerates missing data; self-ticking; reduced-motion friendly via the inherited tick interval (no animation).
- **`shared/components/QueuedBroadcastBanner.jsx` + `.module.css`** (new), list / broadcast / discard; hidden when empty; surfaces broadcast errors inline.
- **`packages/extension/src/popup/messaging.js`** + **`packages/web/src/messaging.js`**, `listQueuedBroadcasts` / `broadcastQueuedRequest` / `discardQueuedRequest` shims.
- **`packages/extension/src/background/createBackgroundHost.js`**, `broadcast.queue.list` / `broadcast.queue.broadcast` / `broadcast.queue.discard` handlers backed by an in-memory `Map<walletId, entry[]>`.
- **`test/smoke/ui/queued-broadcast-staleness.smoke.js`**, verifies StalenessLabel exports + null-tolerance + tick, QueuedBroadcastBanner exports + hide-when-empty + actions, all three background routes, both messaging shims, and both shells' Home-prefix mount.

### Changed

- **`packages/extension/src/popup/App.jsx`** + **`packages/web/src/App.jsx`**, `<QueuedBroadcastBanner walletId={activeWalletId}>` mounted above Home (the top-of-tree mount for unlocked sessions).

Closes G155 outright; G154 closed as 🟡 partial pending the auto-enqueue + persistence FOLLOWUPs. Cluster G, §49 Offline & Degraded Mode, closed at v0.170.0. Smoke baseline preserved (24 / 171; new queued-broadcast-staleness smoke passes).

## [0.169.0] - 2026-04-27

§49.1/§49.2, Step 1 of Cluster G, Reachability poll + offline / degraded banner (G152 + G153).

A new `useReachability` hook polls `messaging.checkReachabilityRequest({ chainIds })` every 30s (configurable) and exposes `{ overall, perChain, lastChecked, refresh, error }`; chainIds default to `Object.keys(settings.fees)` so the wallet's "active chain" view matches what `bridge.getActiveChains` reports to dApps. A new `<ReachabilityBanner>` component consumes the hook, hides while `overall === 'normal'`, and renders a status banner (yellow `degraded`, red `offline`) when at least one configured service is down, listing per-chain which services failed plus a "Last checked Xs ago" footer and a Retry button. The banner mounts above the route surface in both shells so every screen renders consistently. The §49.1 detection flow itself shipped earlier as `flows/reachability.js` and `checkReachability`; this step just adds the messaging boundary, the polling hook, the UI, and the wiring.

### Added

- **`shared/hooks/useReachability.js`**, `useReachability({ intervalMs?, chainIds? })`; auto-derives chainIds from settings.fees; tracks last-checked + error; exposes `refresh()`.
- **`shared/components/ReachabilityBanner.jsx` + `.module.css`**, hidden in normal mode; degraded vs offline variants; per-chain service summary; Retry; reduced-motion guard.
- **`packages/extension/src/popup/messaging.js`** + **`packages/web/src/messaging.js`**, `checkReachabilityRequest` shim.
- **`packages/extension/src/background/createBackgroundHost.js`**, `reachability.check` handler routing to the existing `flows/reachability.checkReachability`.
- **`test/smoke/ui/reachability-banner.smoke.js`**, verifies hook exports + polling, banner exports + hide-when-normal + role/Retry, CSS variants + reduced-motion, background handler, both messaging shims, both shells' mount points.

### Changed

- **`packages/extension/src/popup/App.jsx`** + **`packages/web/src/App.jsx`**, `<ReachabilityBanner />` mounted inside `<ToastHost>` so it sits above every route. Web wires it next to ExtensionBanner.

Closes G152 + G153. Smoke baseline preserved (24 / 170; new reachability-banner smoke passes).

## [0.168.0] - 2026-04-27

§43, Cluster F (single step), dApp Bridge completeness verification (G126 + G128 + G129 + G130); Cluster F closed.

The §43.2 `window.xchain` API surface, its background handlers, the content-script relay, and the web-app extension-detection banner all already shipped in earlier work. Cluster F's job was verification: pin the wiring with a smoke so future edits can't quietly regress it, and mark the four gap rows closed in the ledger. No production code changes, purely a regression-test + accounting step. Event emission for `accountsChanged` / `chainChanged` / `disconnect` is wired end-to-end (background → content script → page → provider listeners) but no background sender currently fires them; the actual emission triggers (state-change observers in the unlocked tree) are tracked as a Cluster F FOLLOWUP.

### Added

- **`test/smoke/bridge/dapp-bridge-completeness.smoke.js`**, verifies the provider exposes all 14 §43.2 methods plus the on/off listeners machinery; the background registers all 11 bridge.* routes and gates them with `requireSite` + `assertChainPermitted`; the content script relays `bridge.event` runtime messages to the page; and the web App mounts `<ExtensionBanner>` above its router.

Closes G126 + G128 + G129 + G130. Cluster F, §43 dApp Bridge, closed at v0.168.0. Smoke baseline preserved (24 / 169; new dapp-bridge-completeness smoke passes).

## [0.167.0] - 2026-04-27

§17.7.1, Step 5 of Cluster E, Clipboard auto-clear configurable 0–600s (G028); Cluster E closed.

ViewPrivateKey's clipboard auto-clear timer was hard-coded to 60 seconds. The Settings → Privacy panel now exposes a `Clipboard auto-clear (seconds)` number input that writes `settings.privacy.clipboardAutoClearSeconds`, an integer in `[0, 600]` clamped on the way in. ViewPrivateKey reads the value via `useSettings`; `0` short-circuits the timer entirely (no auto-clear), any positive value drives `setTimeout(_, value * 1000)`. Older v2 settings records without the field default to 60 at read time, so existing wallets behave identically until the user moves the slider. The post-copy hint now reflects the active interval ("Copied, auto-clears in 90s") instead of the dead 60s string. Closes Cluster E (§30 + §17 finish).

### Added

- **`schemas/settings.js`**, `CLIPBOARD_AUTO_CLEAR_MIN` / `_MAX` / `_DEFAULT` constants; tolerant validation (undefined OK, integer in [0, 600] when present); `createDefaultSettings` seeds the default.
- **`shared/components/settings/PrivacySection.jsx`**, new number input row, clamped via `Math.max / Math.min` against the schema bounds; updates `settings.privacy.clipboardAutoClearSeconds` on change.
- **`test/smoke/ui/clipboard-auto-clear-setting.smoke.js`**, verifies schema constants, default seeding, tolerant validation, PrivacySection input wiring, ViewPrivateKey timer wiring, and removal of the hard-coded 60_000 literal.

### Changed

- **`shared/routes/ViewPrivateKey.jsx`**, reads the setting via `useSettings`; timer effect skips when value ≤ 0; copied-hint string interpolates the active value.
- **`test/smoke/signers/signer-ui.smoke.js`**, clipboard-clear assertion now pins `clipboardAutoClearSeconds * 1000` (the configurable form) rather than the retired `60_000` literal.

Closes G028. Cluster E, §30 + §17 finish, closed at v0.167.0. Smoke baseline preserved (24 / 168; new clipboard-auto-clear-setting smoke passes).

## [0.166.0] - 2026-04-27

§17.7, Step 4 of Cluster E, ViewPrivateKey wired to App navigation (G027).

The standalone `ViewPrivateKey` component was built when §17 first landed but never had a path from the unlocked UI, users couldn't actually reach it. This step adds an `onShowPrivateKey` prop to `AddressList`; each non-multisig row now renders a "Show key" button that hands the address record back to the shell. Both shells (extension popup + web) stage the address in a new `privateKeyAddress` slot, switch `unlockedView` to `'view-private-key'`, and render `<ViewPrivateKey>`. Back navigation clears the staged address so a stale record can't leak into a later visit. HW / watch-only rows still route to the existing info panels inside the component itself (G026).

### Added

- **`shared/routes/AddressList.jsx`**, `onShowPrivateKey` render-prop; per-row "Show key" button gated on `row.record && !row.multisig`. Rows now carry the underlying `record` so the shell has the full Address shape (id, source, derivationPath, network, label).
- **`packages/extension/src/popup/App.jsx`** + **`packages/web/src/App.jsx`**, `privateKeyAddress` state slot, `view-private-key` unlocked view branch, `onShowPrivateKey` callback wired into `<AddressList>`, ViewPrivateKey import.
- **`test/smoke/ui/view-private-key-wiring.smoke.js`**, verifies the prop / button / state-flow / back-clear in both shells.

Closes G027. Smoke baseline preserved (24 / 167; new view-private-key-wiring smoke passes).

## [0.165.0] - 2026-04-27

§17.7.2, Step 3 of Cluster E, HW gating regression-test for ViewPrivateKey (G026).

ViewPrivateKey already routed Trezor / Ledger / watch-only addresses to an informational panel without a password prompt, that behavior was added when the component first landed but never had a smoke pinning it. This step adds the smoke so future edits can't accidentally regress the gating, and marks G026 closed in the ledger.

### Added

- **`test/smoke/ui/view-private-key-hw-gating.smoke.js`**, verifies `classifySource` maps trezor/ledger → `hardware` and watch-only → `watch-only`, and that those branches short-circuit before the password / revealed stages.

Closes G026. No code changes, gating already enforced. Smoke baseline preserved (24 / 166).

## [0.164.0] - 2026-04-27

§30.4, Step 2 of Cluster E, PSBT paste-in form (G088 + paired G042).

A new `Sign PSBT` entry on the action menu opens `PsbtSignForm`, the user-initiated paste-in surface from §30.4. The form accepts hex or base64 (auto-converts the `cHNid…` base64-PSBT prefix), parses the blob through a new `psbt.parse` background handler that calls `sdk.wallet.decomposePsbt`, and surfaces a preview (input / output counts, total in / out, fee, and how many inputs the chosen signing address actually owns). On Sign, the new `auth.signPsbt` handler matches PSBT inputs against the chosen address, builds `signingPaths`, and runs `signPsbtFlow`; the result page surfaces the signed PSBT hex with a Copy affordance for round-tripping into Sparrow / Specter / Coldcard or another cosigner. Software signers only at this step, HW signing, QR scan, .psbt file drop, and in-wallet broadcast are tracked in FOLLOWUPS.

### Added

- **`shared/routes/PsbtSignForm.jsx`** (new), paste, parse, chain + signer pick, preview, sign, copy. Exports `normalizePsbtInput` for hex / base64 normalization (also smoke-testable).
- **`extension/src/popup/messaging.js`** + **`web/src/messaging.js`**, `parsePsbtRequest` and `signPsbtUserInitiated`.
- **`extension/src/background/createBackgroundHost.js`**, `psbt.parse` (read-only `decomposePsbt`) and `auth.signPsbt` (decompose → match inputs by address → `signPsbtFlow`).
- **`test/smoke/ui/psbt-sign-form.smoke.js`**, verifies the component, both messaging shims, both background handlers, and both shells' App.jsx + action-menu wiring.

### Changed

- **`packages/extension/src/popup/App.jsx`** + **`packages/web/src/App.jsx`**, render PsbtSignForm at `unlockedView === 'sign-psbt'`; new `onSignPsbt` callback in the action menu builder; new "Sign PSBT" menu entry.

Closes G088 + G042. Smoke baseline preserved (24 / 165; new psbt-sign-form smoke passes).

## [0.163.0] - 2026-04-27

§30.5, Step 1 of Cluster E, User-cancel rejection toast (G089).

When a sign attempt fails with a message matching `/cancel|reject|denied/i` (Trezor "Action cancelled by user", Ledger "Transaction was rejected", and similar), the Send route now treats it as a deliberate user cancel rather than a Send failure: the form's `submitError` and `password` are cleared, the stage routes back to the composing form, and a calm "Transaction cancelled." toast surfaces via the §37 ToastHost. Bad-password still wins precedence so it isn't masked. Other errors fall through to the existing red `submitError` path on review.

### Added

- **`test/smoke/ui/send-rejection-toast.smoke.js`**, verifies useToast import, cancel-pattern regex, spec wording, and form-stage routing in the catch branch.

### Changed

- **`shared/routes/Send.jsx`**, imports `useToast`, defines `USER_CANCEL_RE`, branches the `handleSubmit` catch to a toast + form-stage path on user-cancel.

Closes G089. Smoke baseline preserved (24 / 164; new send-rejection-toast smoke passes).

## [0.162.0] - 2026-04-27

§37, Step 2 of Cluster D, Broadcast success confirmation (G124); Cluster D closed.

The Send route's done stage now renders a richer success card matching §29.5 / §37: a green check icon, "Broadcast, pending" headline (matching the §28.4 status-timeline language), a summary of what was sent (amount / to-address / chain), the txid with a Copy affordance, an explorer link wired through `chainRegistry.get(chainId).explorer.defaultUrl`, and a "Send another" button that resets the form so a user sending a series of payments doesn't have to re-navigate from Home.

### Added

- **`test/smoke/ui/broadcast-success.smoke.js`**, verifies success card layout, role=status / aria-live, send-another reset, explorer-link target=_blank+noopener, clipboard copy.

### Changed

- **`shared/routes/Send.jsx`**, done stage replaced with the new card. Old `<h2>Sent</h2>` + bare txid block superseded.
- **`shared/routes/Send.module.css`**, adds `.successCard`, `.successIcon`, `.successHint`, `.successSummary`, `.successRow`, `.successMono`, `.successTxidBlock`, `.successTxidRow`, `.successLink`.

Closes G124. Cluster D, §37 Toast foundation, closed at v0.162.0. Smoke baseline preserved (24 / 163; new broadcast-success smoke passes).

## [0.161.0] - 2026-04-27

§37.2, Step 1 of Cluster D, Toast foundation + first undo integrations (G119).

A new shared `<ToastHost>` provider mounts above every route in both shells; any component can drop a transient toast via `useToast().showToast({ message, actionLabel, onAction, durationMs })`. Toasts auto-dismiss after 8 s per spec, are keyboard-dismissible, and respect `prefers-reduced-motion` (animation collapses to an instant swap). Two destructive actions wire the first undo paths: deleting a contact (re-saves the snapshotted record) and clearing the History filter set (restores every filter axis).

Remaining §37.2 integrations from the spec, disconnect site, remove imported WIF address, cancel pending tx, slot into the same `useToast` API as those surfaces gain delete affordances; tracked in FOLLOWUPS.

### Added

- **`shared/components/ToastHost.jsx` + `ToastHost.module.css`** (new), provider + viewport + `useToast` hook; pointer-events-none viewport so the toast layer never traps clicks.
- **`test/smoke/ui/toast-host.smoke.js`**, host API surface, reduced-motion guard, ContactsList + History integrations, both shells' wrapping.

### Changed

- **`shared/routes/ContactsList.jsx`**, `handleDelete` snapshots the contact before deleting; on success shows an Undo toast that calls `messaging.saveContact({ record })` to restore.
- **`shared/routes/History.jsx`**, `clearAllFilters` snapshots the active filter set; if anything was set, shows an Undo toast that restores searchQuery / actionTypeFilter / statusFilter / dateFrom / dateTo verbatim.
- **`packages/web/src/App.jsx` + `packages/extension/src/popup/App.jsx`**, wrap their unlocked tree in `<ToastHost>` so every route has access to the hook.

Closes G119. Smoke baseline preserved (24 / 162; new toast-host smoke passes).

## [0.160.0] - 2026-04-27

§27.6, Step 6 of Cluster C, Token detail page (G071); Cluster C closed.

A balance row is now a button: tap it and the wallet routes into a dedicated single-token view with the asset's hero card (icon, name, ticker, chain badge, balance, fiat), a metadata panel, primary actions (Send / Receive / View activity), and a collapsible holders panel that lazy-loads from `messaging.getHoldersForToken` for tokens (skipped for native coins). "View activity" routes to History pre-populated with the token's tick via the new `initialSearchQuery` prop, so the user lands on a feed already filtered to that asset.

Token-info richness, supply chart, and Phase-3 actions (Sell on DEX, Market view) are queued in FOLLOWUPS, they require host endpoints that don't exist yet.

### Added

- **`shared/routes/TokenDetail.jsx` + `TokenDetail.module.css`** (new), full-page token view with header / metadata / actions / holders sections; hero card uses tickerColor + first-letter avatar to match the balance-list iconography.
- **`test/smoke/ui/token-detail.smoke.js`**, verifies TokenDetail exports + props, BalanceList clickable variant, UnifiedBalanceList parity, HomeTabs forwarding, History `initialSearchQuery`, and both shells' App.jsx wiring.

### Changed

- **`shared/components/BalanceList.jsx` + `.module.css`**, `BalanceRowEl` accepts `onSelect`; row tag becomes a `<button>` when a handler is wired, with new `.rowClickable` styles. `BalanceList` accepts `onSelectToken` and forwards it.
- **`shared/components/UnifiedBalanceList.jsx` + `.module.css`**, same `onSelectToken` + `.rowClickable` treatment for parity.
- **`shared/components/HomeTabs.jsx`**, accepts `onSelectToken`, forwards it into Coins / Tokens / NFTs tabs.
- **`shared/routes/Home.jsx`**, accepts `onSelectToken`, forwards it into HomeTabs.
- **`shared/routes/History.jsx`**, accepts `initialSearchQuery`; seeds the search box state on mount and auto-opens the More filters panel so the pre-set filter is visible.
- **`packages/web/src/App.jsx` + `packages/extension/src/popup/App.jsx`**, import TokenDetail; new `'token-detail'` view literal + `tokenDetailRef` + `historyInitialQuery` state; Home wires `onSelectToken={tok => { setTokenDetailRef(tok); setUnlockedView('token-detail'); }}`; the route renders `<TokenDetail>` with Send / Receive / View activity callbacks.

Closes G071. Cluster C, §27 Balances + §28 History, closed at v0.160.0. Smoke baseline preserved (24 / 161; new token-detail smoke passes).

## [0.159.0] - 2026-04-27

§28.6, Step 5 of Cluster C, Advanced history filtering (G080).

History gains a search box (full-text over ACTION code, addresses, txid, tick, memo, destination, source) and a "More filters" panel with the spec's four filter axes, action-type checkboxes (14 buckets including Send/Receive split by wallet ownership), status chips (Pending / Confirmed / Failed), and a from/to date-range picker. An active-filters dot + "Clear" link surface in the header so a user who navigates away and back never wonders why the feed looks empty.

### Added

- **`shared/utils/historyFilter.js`** (new), `applyHistoryFilters(entries, opts)` plus `classifyEntryAction` / `classifyEntryStatus` plus `ACTION_TYPE_OPTIONS` / `STATUS_OPTIONS` constants. Pure; takes wallet addresses as input so Send vs Receive discrimination is testable without React state.
- **`test/unit/util/historyFilter.test.js`** (new), 21 cases covering action-type buckets, status classification, send/receive split, date range, search across raw payload fields, and combined filters.

### Changed

- **`shared/routes/History.jsx`**, adds `searchQuery` / `actionTypeFilter` / `statusFilter` / `dateFrom` / `dateTo` / `moreFiltersOpen` state; computes `walletAddressSet` once from `addressesByChain`; threads everything into `applyHistoryFilters` inside the existing `visibleEntries` memo. Filter-aware empty state: "No matches for the current filters, Clear filters" when filters are active but the result is empty.
- **`shared/routes/History.module.css`**, `.searchRow`, `.searchInput`, `.morePanel`, `.fieldset`, `.legend`, `.checkboxGrid`, `.checkLabel`, `.statusChips`, `.dateRow`, `.dateLabel`, `.filterBadge`, `.clearLink` for the new filter UI.

Closes G080. Smoke baseline preserved (24/160).

## [0.158.0] - 2026-04-27

§28.2, Step 4 of Cluster C, Activity feed grouping (G078).

Related history rows now collapse into a single expandable card: ISSUE + every MINT of the same token, DISPENSER + its DISPENSEs, and ORDER + its fills. A new Grouped / Flat chip in the filter bar toggles collapse on (default) and off. BATCH grouping is deferred, the canonical batch-parent reference isn't exposed on history-row payloads we currently read; punted to FOLLOWUPS rather than ship a heuristic that could collapse unrelated rows.

### Added

- **`shared/utils/historyGrouping.js`** (new), pure `groupHistoryEntries(entries, mode)`; emits `{ kind: 'entry' }` or `{ kind: 'group', subkind, leader, members, summary, key }` items in the input order, with each group bubbled to the position of its newest member so recent activity stays on top.
- **`test/unit/util/historyGrouping.test.js`** (new), 13 cases covering each grouping rule, flat passthrough, cross-chain isolation, missing-amount fallback, uppercase ACTION names, and ordering.

### Changed

- **`shared/routes/History.jsx`**, adds `groupingMode` + `expandedGroups` state, the Grouped / Flat toggle chip, and a `<GroupCard>` renderer that expands inline into its member rows. Entry rendering extracted into an `<EntryRow>` component shared by top-level rows and members inside an expanded group.
- **`shared/routes/History.module.css`**, `.groupCard`, `.groupCardExpanded`, `.groupCount`, `.groupExpand`, `.groupMembers` for the collapsed card surface and its expanded member list.

Closes G078. Smoke baseline preserved (24/160).

## [0.157.0] - 2026-04-27

§27.7 / §28, Step 3 of Cluster C, Empty-state nudges with Receive CTA (G077).

Replaces the bare "No X yet" `<p>` placeholders in BalanceList, UnifiedBalanceList, History, and AddressList with a content-shaped `<EmptyStateNudge>` card. When a parent supplies `onReceive`, the nudge renders a primary Receive button so a user staring at an empty Home / History / address list has a one-tap path to populating it.

### Added

- **`shared/components/EmptyStateNudge.jsx` + `EmptyStateNudge.module.css`** (new), title / body / actionLabel / onAction / icon / role props; centered card with a dashed border and an optional primary button.
- **`test/smoke/ui/empty-state-nudge.smoke.js`**, component shape, BalanceList + UnifiedBalanceList integration, HomeTabs + Home onReceive forwarding, History + AddressList integration, both shells' App.jsx wiring.

### Changed

- **`shared/components/BalanceList.jsx`**, `emptyMessage` prop replaced with `emptyTitle` + `emptyBody` + `onReceive`; renders `<EmptyStateNudge>`.
- **`shared/components/HomeTabs.jsx`**, accepts `onReceive` and only forwards it when `networkFilter === 'all'` (network-filtered empty states drop the misleading CTA); copy on each tab's empty state refreshed for the new `<EmptyStateNudge>` layout.
- **`shared/components/UnifiedBalanceList.jsx`**, both empty branches (no rows + filtered no rows) now render `<EmptyStateNudge>`.
- **`shared/routes/Home.jsx`**, threads `onReceive` into `<HomeTabs>`.
- **`shared/routes/History.jsx`**, accepts `onReceive`; both empty branches (no addresses + no entries) render `<EmptyStateNudge>`; cross-chain-only branch suppresses the Receive CTA.
- **`shared/routes/AddressList.jsx`**, accepts `onReceive`; empty branch renders `<EmptyStateNudge>`.
- **`packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx`**, wire `onReceive={() => setUnlockedView('receive')}` into both `<History>` and `<AddressList>` mounts.

Closes G077.

## [0.156.0] - 2026-04-27

§27.9 Balances + §28 History, Step 2 of Cluster C, Skeleton loading rows in balance / history / address lists (G076).

The plain "Loading X…" `<p>` placeholders in Home, History, and AddressList are replaced with content-shaped `<Skeleton.List>` rows. Each loading state is wrapped in a `role="status"` element with an `aria-label` so assistive tech still announces the load.

### Changed

- **`shared/routes/Home.jsx`**, `Loading balances…` text → `<Skeleton.List rows={5}>` inside `role="status" aria-label="Loading balances"`.
- **`shared/routes/History.jsx`**, both loading states (initial address-fetch + per-chain history fetch) → `<Skeleton.List>`; per-chain skeleton uses `Math.max(3, loadingChains.size)` rows so it scales with the number of chains being fetched.
- **`shared/routes/AddressList.jsx`**, `Loading addresses…` text → `<Skeleton.List rows={5}>`.
- **`test/smoke/ui/skeleton-wiring.smoke.js`** (new), verifies all three routes import Skeleton, render `<Skeleton.List>`, and wrap it in the right `role="status"` + `aria-label`.

Closes G076.

## [0.155.0] - 2026-04-27

§37.1 Micro-UX, Step 1 of Cluster C, Skeleton loading-placeholder primitive (G118).

Adds the shared `<Skeleton>` component that the §27 Balances + §28 History + later cluster steps will swap in for spinners. Variant per shape (row/text/title/avatar/badge/card/tile); `<Skeleton.Row>` + `<Skeleton.List rows={N}>` composites mirror the wallet's typical avatar + title + subtitle layout; shimmer collapses to a static gray block under `prefers-reduced-motion: reduce` (§53 a11y); `aria-hidden="true"` by default with an opt-in `ariaLabel` for screen-reader announcement.

### Added

- **`packages/core/src/ui/Skeleton.jsx` + `Skeleton.module.css`**, primitive + composites + reduced-motion guard.
- **`packages/core/src/ui/index.js`** re-exports `Skeleton`.
- **`test/smoke/ui/skeleton.smoke.js`**, shape variants, composites, aria default + opt-in, reduced-motion media-query.

Closes G118 (G076, wiring into balance/history rows, lands in Cluster C Step 2).

## [0.154.0] - 2026-04-27

§19 Backup, Step 6 of Cluster B, On-chain label publish UI (G037).

The Settings → Backup panel's "Publish labels on-chain" row replaces the v0.116.0 placeholder. The user picks a chain, enters the wallet password, and the wallet encrypts its labels + contacts under a seed-derived commitment key and broadcasts the ciphertext as a FILE action. The result panel shows the txid + chain + encrypted size + discovery name. Auto-sync on label change and fetch-on-restore decryption are queued in `claude/reports/xchain-wallet/FOLLOWUPS.md`.

### Added

- **`flows/labelSync.js`: `publishLabelsNow`**, orchestrates the full publish: decrypt wallet seed → derive commitment key → buildLabelSyncPayload → submitAction with `action: 'FILE'` and `encoderOpts.rawData = bytesToHex(ciphertext)`. Wif-only wallets throw `WifOnlyLabelSyncUnsupportedError`; wallets with no HD address on the picked chain throw `NoFundedAddressError`. Both seed + plaintext-mnemonic buffers are zeroed in `try/finally`. Re-exported from `flows/index.js`.
- **`wallet.publishLabels` host handler** in `extension/src/background/createBackgroundHost.js`. Pass-through to `publishLabelsNow` with vault + chainRegistry + sdkRegistry deps.
- **`messaging.publishLabelsRequest`** wrappers in popup + web messaging.
- **`PublishLabelsForm` + `PublishLabelsReport` in `BackupSection.jsx`**, chain picker (sourced from `getAddressesByChain`, only chains with addresses are shown) + wallet-password input + status row; result panel shows txid (with Copy button), chain, encrypted size, discovery name.
- **`claude/reports/xchain-wallet/FOLLOWUPS.md`** (new shared file), `## §17/§19, closed at v0.154.0` header with three FOLLOWUPs: on-change debounced auto-sync, fetch + decrypt + apply on restore, HW-wallet support for label-publish.
- **`test/smoke/ui/publish-labels-ui.smoke.js`**, flow shape + zeroing assertions; host handler + messaging wrappers in both shells; BackupSection wiring (publishStage union, both subcomponents, copy refresh, FILE-action mention, txid/size/discovery surface); FOLLOWUPS.md cluster header + entries.

### Changed

- **`BackupSection.jsx`**, file header lists "Publish labels (§19.5.2)" as Live (was: Deferred). Placeholder "Coming soon" disabled row replaced by the four-stage publish flow (idle → form → running → result). React import switches to `useEffect` + `useState`.

Closes G037.

## [0.153.0] - 2026-04-27

§17 Signer Interface, Step 3 of Cluster B, Signer selection UI when adding address/account (G023).

When a wallet has more than one signer (software seed plus paired hardware), the Add-account form and Receive's "New address" panel render an inline picker so the user chooses which signer derives the new HD address. Single-signer wallets see no extra friction, the picker auto-resolves and stays hidden.

### Added

- **`shared/routes/SignerSelectForm.jsx`**, fetches `messaging.listSigners(walletId)`; renders one card per option ("Software wallet (this seed)" + one per paired HW SignerRecord); auto-resolves to software when no HW signers exist.
- **`pickSignerFromRequest` helper** in `extension/src/background/createBackgroundHost.js`: when the request carries `signerId`, looks up the SignerRecord, fetches the live transport via `signerBridge.getTransport`, and returns a `RemoteSigner`. Otherwise falls back to `signerPool.get(walletId)`. Wired into both `account.create` and `receive.getAddress`.

### Changed

- **`flows/createAccount.js` + `flows/receiveAddress.js`**, now accept an optional pre-supplied `signer` (HW path skips the password unlock); `Address.source` is picked from `signer.kind` (`software → 'hd'`, `trezor → 'trezor'`, `ledger → 'ledger'`); `signer.lock()` is only invoked when present (RemoteSigner has none).
- **`AddAccountForm.jsx` + `Receive.jsx`**, render `<SignerSelectForm>` and thread `signerId` into the messaging call; Receive's password input is suppressed when an HW signer is selected.
- **Messaging JSDoc** in popup + web, `createAccount` / `generateReceiveAddress` document the optional `signerId` and the password-skipping HW path.

Closes G023.

## [0.152.0] - 2026-04-27

§19 Backup, Step 4 of Cluster B, Dry-run restore UI (G038).

The Settings → Backup panel's "Test backup (dry-run restore)" row is now wired end-to-end. The user pastes a candidate mnemonic, picks BIP39 vs Counterwallet-legacy, sets a gap limit, and the panel renders an overall match flag plus a per-chain comparison report (matched / divergent / new counts). Nothing persists; the existing `dryRunRestore` core flow zeroes seed material on exit.

### Added

- **`wallet.dryRunRestore` host handler** in `extension/src/background/createBackgroundHost.js`. Thin pass-through to `flows.dryRunRestore`.
- **`messaging.dryRunRestoreRequest`** wrappers in web + popup messaging.
- **Inline dry-run UI in `BackupSection.jsx`**, three stages: idle (BackupRow with Test button), form (`<DryRunForm>`: candidate mnemonic textarea + BIP39/Counterwallet format selector + gap-limit input + optional BIP39 passphrase that auto-hides for Counterwallet), result (`<DryRunReport>`: green/red border based on `overallMatch`; per-chain rows show `chainId (addressType)` plus `matched ✓ · divergent ✗ · new` counts in tabular numerals).
- **`test/smoke/ui/dry-run-restore-ui.smoke.js`**, BackupSection wiring (four-stage union, both subcomponents, format selector covers BIP39 + Counterwallet, BIP39-passphrase gating, success/failure copy, all three count fields); host handler; both messaging wrappers.

### Changed

- **`BackupSection.jsx`**, file header updated to list dry-run-restore as Live (was: Deferred). The "Test…" button activates whenever an `activeWallet` is supplied.

### Behavior preserved

- Encrypted-backup export (v0.116.0) and seed-phrase reveal (v0.151.0) flows are unchanged; all three live side-by-side in the same Settings panel and share the same primitive button + text styles.
- The `dryRunRestore` core flow is untouched; this step is pure host + messaging + UI plumbing.
- Counterwallet-legacy mnemonics correctly omit the BIP39 passphrase from the request (the form's `format === 'bip39'` gate suppresses both the input and the field in the dispatched options).

## [0.151.0] - 2026-04-27

§19 Backup, Step 3 of Cluster B, Seed-phrase reveal flow.

The Settings → Backup panel's "Back up seed phrase" row is now wired end-to-end. The user clicks Show, enters the wallet password, and the BIP39 (or Counterwallet-legacy) mnemonic appears in a tap-to-reveal blurred surface. Window-blur privacy from §26 / G069 layers on top automatically, alt-tab while revealed and the mnemonic blurs system-wide.

### Added

- **`flows/revealMnemonic.js`**, pure flow. Decrypts the wallet's encrypted seed blob via `crypto/walletBlob.decryptWalletSeed` (the AEAD tag check doubles as the password probe, wrong password throws), returns `{ mnemonic, format, passphraseEnabled }`. Wif-only wallets throw `NoMnemonicForWifOnlyError` since they have no seed by definition. The plaintext buffer is zeroed in a `try/finally`.
- **`wallet.revealMnemonic` host handler** in `extension/src/background/createBackgroundHost.js`. Thin pass-through to the flow.
- **`messaging.revealMnemonicRequest`** wrappers in web + popup messaging.
- **Inline reveal UI in `BackupSection.jsx`**, three stages: idle (BackupRow with Show button), password (single-input UnlockPrompt with sensitive-action copy), shown (RevealedMnemonic with tap-to-toggle blur, "Tap to reveal." / "Tap to hide again." hint, Done button to return to idle and clear state). The mnemonic stays in component state only while the row is in the `'shown'` stage; clicking Done wipes it. Wrong-password errors surface as `Status` toned error; `NoMnemonicForWifOnlyError` maps to "This wallet was imported from a private key only, there is no seed phrase to reveal."
- **`test/smoke/core/reveal-mnemonic.smoke.js`**, flow shape + wif-only rejection + zeroed-plaintext finally + flows/index re-export.
- **`test/smoke/ui/reveal-mnemonic-ui.smoke.js`**, BackupSection wiring (revealStage union, both subcomponents, blur CSS, hint copy, NoMnemonicForWifOnlyError mapping, activeWallet gating); host handler; both messaging wrappers.
- **SPEC_GAPS.md row G181**, new ledger row for the seed-phrase reveal gap (formerly tracked only as Settings close FOLLOWUP 1).

### Changed

- **`flows/index.js`**, re-exports `revealMnemonic` + `NoMnemonicForWifOnlyError`.
- **`BackupSection.jsx`**, header comment updated to reflect that seed-phrase reveal is now Live (was: Deferred). The row's button is no longer permanently disabled; it activates whenever an `activeWallet` is supplied.

### Behavior preserved

- Encrypted backup export from v0.116.0 is unchanged; both flows share the same Settings panel and password-prompt primitives but route through different host handlers.
- The wallet's vault format, KDF parameters, and AEAD ciphertext shape are untouched, `revealMnemonic` reads via the existing `decryptWalletSeed` and produces the same plaintext the SoftwareSigner unlock path produces.
- Tap-to-reveal blur is purely a CSS `filter: blur(8px)` on the same DOM element; the underlying text is in the React tree as soon as the user enters the password (this is by design, the reveal screen exists exactly so the text is accessible). Privacy on top is the §26 / G069 window-blur sweep.

## [0.150.0] - 2026-04-27

§17 Sign / Verify / Backup, Step 2 of 6, Verify Signature route (G025).

Counterpart to v0.149.0's Sign Message form. Verify a signature was produced by a given address over a given message. Pure SDK call (`sdk.auth.verifyMessage(address, message, signature)`), no wallet password, no signer required, address can be any address (yours or a counterparty's).

### Added

- **`shared/routes/VerifySignatureForm.jsx`**, chain picker (sourced from the chain registry, not the wallet, verification has no wallet dependency), free-form Address input, Message + Signature textareas, Verify button. Result rendered in a `role="status"` `aria-live="polite"` row with green "✓ Signature is valid for this address." or red "✗ Signature does NOT match this address." copy.
- **`auth.verifyMessage` host handler** in `extension/src/background/createBackgroundHost.js`. Wraps `sdk.auth.verifyMessage(...)` in a try/catch so malformed signatures return `{ valid: false }` rather than throwing, the form treats verify-failed and verify-malformed identically.
- **`messaging.verifyMessageRequest`** wrappers in web + popup messaging.
- **App routing** in both `web/src/App.jsx` and `extension/src/popup/App.jsx`: `unlockedView === 'verify-signature'` branch + `onVerifySignature` plumbed through `buildActionEntries` + a "Verify signature" entry adjacent to "Sign message".
- **`test/smoke/ui/verify-signature.smoke.js`**, form structure (no password field, ChainPicker from registry not wallet, both result branches, status role + aria-live), host handler shape (try/catch wrap, positional SDK args), messaging wrappers in both shells, App wiring in both shells.

### Behavior preserved

- Sign Message route from v0.149.0 is unchanged.
- All existing ActionsMenu entries keep their order; "Verify signature" slots in directly after "Sign message".
- Desktop shell wiring is still pending (FOLLOWUP from Step 1; will land for both routes together).

## [0.149.0] - 2026-04-27

§17 Sign / Verify / Backup, Step 1 of 6, Sign Message route (G024).

User-initiated message signing now has a dedicated UI surface. The user picks a chain + address from their wallet, types a message, enters their password, and gets back a signature with a copy button. The form routes through a new `auth.signMessage` host handler that bridges to the existing `flows.signMessageFlow`. HD addresses sign via `derivationPath`; imported-WIF addresses sign via `addressId`.

### Added

- **`shared/routes/SignMessageForm.jsx`**, chain picker + address select + message textarea + password input + submit. Post-sign view shows signed-by chain badge + address, the message in a wrapped `<pre>`, the base64 signature with a CopyButton, and a "Sign another message" reset. `InvalidPasswordError` maps to user-friendly "Incorrect password." copy.
- **`auth.signMessage` host handler** in `extension/src/background/createBackgroundHost.js` (also covers the web shell, `web/src/hostBridge.js` instantiates `createBackgroundHost` directly). Resolves `addressId → Address` record, distinguishes HD (passes `path: derivationPath`) from imported-WIF (passes `addressId`) and forwards to `signMessageFlow`.
- **`messaging.signMessageRequest`** wrappers in `web/src/messaging.js` and `extension/src/popup/messaging.js`.
- **App routing** in both `web/src/App.jsx` and `extension/src/popup/App.jsx`: `unlockedView === 'sign-message'` branch + `onSignMessage` plumbed through `buildActionEntries` + a "Sign message" entry in the ActionsMenu.
- **`test/smoke/ui/sign-message.smoke.js`**, form structure, host handler shape (HD vs imported routing), messaging wrappers in both shells, App wiring in both shells.

### Behavior preserved

- All existing ActionsMenu entries keep their order; "Sign message" slots in adjacent to "Contacts" and "Advanced action".
- The desktop shell's `messageHost.js` does NOT yet register `auth.signMessage`; the form gracefully reports "messaging.signMessageRequest is not available in this shell" until FOLLOWUP 1 wires it.
- Hardware-signer path is out of scope for this step; the form rejects HW addresses by routing them through the password-required `signMessageFlow` (which throws on non-software signers). The HW counterpart lives in a Cluster B FOLLOWUP.

## [0.148.0] - 2026-04-27

§26 Lock & Panic, Step 6 of 6, Duress passphrase (G068 part 2). **Closes the §26 cluster.**

The wallet now supports a second password, a "duress passphrase", that, when entered on the unlock screen, silently arms panic mode (24-hour signing freeze from Step 5) while showing the same wrong-password UX a normal mistype produces. An observer cannot tell the duress flag fired: the lockout counter still increments, the error copy is identical, and the visible delay matches.

### Added

- **`flows/duressPassphrase.js`**, pure flow with localStorage persistence at `xchain-wallet:duress`. Stored shape: `{ salt: base64, hash: base64, createdAt }` with `hash = sha256(salt || passphrase_utf8)` and a fresh 16-byte salt per `setDuressPassphrase` call. Plaintext never persisted. Exports: `isDuressConfigured`, `setDuressPassphrase`, `clearDuressPassphrase`, `isDuressMatch`, `tripDuressIfMatch`, `DuressNotConfiguredError`. Memory fallback when localStorage is unavailable. Constant-time hash comparison (`a[i] ^ b[i]` accumulator) to keep the verification side-channel-free even though the threat model doesn't strictly require it.
- **`tripDuressIfMatch(candidate)`**, composes `isDuressMatch` with `activatePanicMode()`. When a candidate matches, panic mode is armed at the default 24h duration immediately and `true` is returned so the caller can present a normal-looking wrong-password UX. When it doesn't match, `false` is returned, no state mutation.
- **`shared/components/settings/DuressPassphraseRow.jsx`**, Safety panel row with three states: not-configured ("Set" button), inline form (passphrase + confirm + cancel/save, mismatch + missing-value validation surfaced via `role="alert"`), and configured ("Disable" button). Inputs use `autoComplete="new-password"` so password managers don't try to save them as the wallet password. There is no "view" affordance: the passphrase cannot be recovered from storage.
- **Locked.jsx duress trip**, inside the `InvalidPasswordError` branch, BEFORE the lockout counter increments. The trip runs unconditionally (`tripDuressIfMatch(password)` no-ops when nothing is configured). The lockout counter still increments and the error message is unchanged either way, so the visible behaviour is identical.
- **`test/smoke/core/duress-passphrase.smoke.js`**, full coverage: not-configured initial state, set + verify round-trip, one-character-delta rejection, empty/null rejection, persisted record never contains plaintext, fresh salt per set (different hashes for the same passphrase), `tripDuressIfMatch` arms panic mode + freezes signing, non-match no-op, clear wipes record, corruption tolerance (malformed JSON, bad shape), memory fallback when localStorage is unavailable.
- **`test/smoke/ui/duress-wiring.smoke.js`**, `flows/index.js` re-exports, Locked.jsx imports `tripDuressIfMatch`, the trip lives INSIDE the `InvalidPasswordError` branch (regex sequence assertion), the trip does NOT run on the success path (negative-match assertion that the success-path text is followed by `tripDuressIfMatch` only beyond a 200-character window, i.e., not in the success block), the trip does NOT skip the lockout increment (`tripDuressIfMatch` is followed by `recordLockoutFailure` within 200 characters), `SafetySection` imports + renders `<DuressPassphraseRow />`, the row's confirm-mismatch validation, `role="alert"` errors, `autoComplete="new-password"` on the form inputs.

### Changed

- **`flows/index.js`**, re-exports the six duress symbols.
- **`Locked.jsx`**, imports `tripDuressIfMatch`. The bad-password branch gains a single-line silent trip ahead of the `recordLockoutFailure` call. No other branches change.
- **`SafetySection.jsx`**, mounts `<DuressPassphraseRow />` between `<PanicModeRow />` and the auto-arm reservation toggle.

### §26 Lock & Panic cluster, close

Six steps shipped (v0.143.0 → v0.148.0). Cluster scope:

| Gap | Title | Version |
|---|---|---|
| G067 | Caps-Lock warning in password fields | v0.143.0 |
| G066 | Failed-attempts escalating delay | v0.144.0 |
| G069 | Privacy blur on window blur | v0.145.0 |
| G063 | Biometric unlock (WebAuthn PRF) | v0.146.0 |
| G068 part 1 | Panic-mode signing freeze foundation | v0.147.0 |
| G068 part 2 | Duress passphrase | v0.148.0 |

Out of scope (deferred): G064 (auto-lock wired into web App), G065 (auto-lock timeout from settings), both already-known gaps tracked separately. Close report follows.

### Behavior preserved

- Locked.jsx's caps-lock indicator (G067), lockout banner + countdown (G066), and biometric button (G063) all remain in place. The duress trip is the only addition to the bad-password branch.
- `messaging.unlockWallet` is unchanged on success; the duress check only runs when the real wallet KDF rejects the input.
- A duress passphrase that happens to collide with the real password is effectively a no-op (the real wallet unlocks first).
- The panic-mode chokepoints (`submitWithSigner`, `signMessageFlow`, `signPsbtFlow`, `signMultisigLocally`) are unchanged from v0.147.0.

## [0.147.0] - 2026-04-27

§26 Lock & Panic, Step 5 of 6, Panic mode signing freeze foundation (G068 part 1).

The wallet now ships a runtime panic-mode flag with a 24-hour default freeze on all signing. Activating it from Settings → Safety arms the freeze immediately; balances and history stay readable, but every flow that drives a Signer (`submitWithSigner`, `signMessageFlow`, `signPsbtFlow`, `signMultisigLocally`) refuses with a `PanicModeActiveError` until the timer expires or the user explicitly deactivates. The duress-passphrase / decoy-state UX layers on top of this in Step 6, none of that is required for the freeze to work.

### Added

- **`flows/panicMode.js`**, pure flow with localStorage-backed state at `xchain-wallet:panic`. State shape: `{ activatedAt, expiresAt, durationMs }`. Exports: `emptyPanicModeState`, `getPanicModeState`, `getPanicRemainingMs`, `isSigningFrozen`, `activatePanicMode({ durationMs?, nowMs? })`, `deactivatePanicMode`, `clearPanicModeState`, `assertSigningAllowed(nowMs?)`, plus `PanicModeActiveError` (carries `remainingMs`) and the `DEFAULT_DURATION_MS` (24h) / `MIN_DURATION_MS` (1m floor for tests) / `MAX_DURATION_MS` (7d cap) constants. Memory fallback when localStorage is unavailable. Corruption-tolerant reads (malformed JSON, negative fields → empty). `assertSigningAllowed` auto-clears expired state inline so the timer is fully self-healing.
- **`shared/components/settings/PanicModeRow.jsx`**, Safety-panel row with two states. Inactive: dangerous-styled "Activate" button + copy explaining the freeze. Active: countdown ("Xh Ym remaining", minute granularity, `Math.ceil` round-up so the user never sees 0m while still locked) + a "Deactivate" button. The countdown ticks every 60 s; cleanup on unmount or timer expiry.
- **Sign-path gating in three chokepoints**, `sdk/submitWithSigner.js` (top of the lifecycle, before encoder/signer interaction), `flows/signFlows.js` (both `signMessageFlow` + `signPsbtFlow`), and `flows/multisigSignLocally.js` (after sessionId / password validation, before vault lookup). All four entries call `assertSigningAllowed()` and surface `PanicModeActiveError` to callers.
- **`test/smoke/core/panic-mode.smoke.js`**, full flow coverage: defaults (24h / 1m / 7d), empty state, persistence round-trip via fake localStorage, freeze boundary math (just-armed / 1ms-before-expiry / 1ms-after-expiry), mid-countdown remaining-ms, duration clamp (sub-minute → 1m floor; over-7d → 7d cap; NaN → default), `assertSigningAllowed` throws `PanicModeActiveError` with positive `remainingMs`, `deactivatePanicMode` removes the localStorage entry, corruption tolerance, auto-clear when `assertSigningAllowed` is called past expiry, memory fallback when localStorage is removed.
- **`test/smoke/ui/panic-mode-wiring.smoke.js`**, `flows/index.js` re-export coverage, all three sign-path chokepoints import + call `assertSigningAllowed`, signFlows.js gates BOTH flows (count `assertSigningAllowed()` invocations === 2), SafetySection mounts `<PanicModeRow />` ungated by the schema toggle (always available for emergencies), toggle relabelled to "Auto-arm panic mode", PanicModeRow's setInterval+clearInterval lifecycle, copy strings, minute-granularity formatter with `Math.ceil`.

### Changed

- **`flows/index.js`**, re-exports the panic-mode surface (`getPanicModeState`, `getPanicRemainingMs`, `isSigningFrozen`, `activatePanicMode`, `deactivatePanicMode`, `assertSigningAllowed`, `PanicModeActiveError`, `PANIC_MODE_DEFAULT_DURATION_MS` / `_MIN_DURATION_MS` / `_MAX_DURATION_MS`).
- **`SafetySection.jsx`**, mounts `<PanicModeRow />` between `<BiometricRow />` and the schema toggle. The schema toggle is relabelled "Auto-arm panic mode" with hint text noting the duress wiring lands in a follow-up step; the activation Button always renders regardless of the toggle so the emergency control is never gated on a forgotten preference.
- **`sdk/submitWithSigner.js`**, header comment notes the panic-mode gate; new import + a one-line `assertSigningAllowed()` call after the input-validation block.
- **`flows/signFlows.js`**, new import + `assertSigningAllowed()` call after each input-validation block (two flows).
- **`flows/multisigSignLocally.js`**, new import + `assertSigningAllowed()` call before the multisig session lookup.
- **`test/smoke/ui/settings-safety.smoke.js`**, updated to reflect the new row layout: `<BiometricRow />` mount (v0.146), `<PanicModeRow />` mount (v0.147), and the schema-toggle relabelling from "Panic mode" → "Auto-arm panic mode".

### Behavior preserved

- The schema field `settings.panicMode.enabled` retains its v2 semantics (boolean preference) and its existing migration path; only its UI label + intent changed.
- Existing sign flows that don't go through one of the four gated chokepoints are unaffected, none today, by design (this is the chokepoint set).
- `submitWithSigner`'s phase ordering (creating → encoding → signing → broadcasting → p2sh_spending → waiting → confirmed) is unchanged; the gate runs strictly before phase 1.
- `Locked.jsx`, `Input.jsx`, `BiometricRow.jsx`, `usePrivacyBlur.js` from earlier §26 steps are untouched.

## [0.146.0] - 2026-04-27

§26 Lock & Panic, Step 4 of 6, Biometric unlock via WebAuthn PRF (G063).

The wallet now supports unlocking with Touch ID, Windows Hello, or any platform authenticator that exposes the WebAuthn `prf` extension. The wallet password is encrypted at registration time under the credential's PRF output and stored in localStorage; at unlock the user authenticates with the platform authenticator, the browser re-derives the same 32-byte PRF output, and the password is unwrapped via the existing AES-256-GCM AEAD path. The plaintext password is never persisted.

### Added

- **`flows/biometricUnlock.js`** , full registration + unwrap flow. - `isBiometricSupported()`: async probe that requires `navigator.credentials`, the static `PublicKeyCredential` global, and a positive `isUserVerifyingPlatformAuthenticatorAvailable()` response. - `isBiometricRegistered()`: sync localStorage probe; truthy when `xchain-wallet:biometric` exists. - `registerBiometricCredential({ password, accountName })`: creates a platform-bound credential with `userVerification: 'required'` + a 32-byte randomised PRF salt; falls back to a follow-up `navigator.credentials.get()` to obtain the PRF output when the create() response omits it (current Chrome behaviour); derives a 32-byte AES key from the PRF output, wraps the password via `crypto/aead.encrypt`, persists `{ credentialId, prfSalt, ciphertext, createdAt }`. - `unlockWithBiometric()`: runs `navigator.credentials.get()` against the stored credential id with the persisted PRF salt; rederives the wrap key; decrypts the password and returns it for the caller to feed into `messaging.unlockWallet`. - `clearBiometricCredential()`: wipes the localStorage record.
- **`shared/components/settings/BiometricRow.jsx`** , Settings → Safety panel row owning the four-state UX: - `null` → "Checking platform authenticator…" - unsupported → muted "Not available, this device or browser doesn't expose a WebAuthn platform authenticator with PRF support."
- **Locked.jsx "Use biometrics" button**, only renders when `isBiometricRegistered()` AND `isBiometricSupported()`. The probe is short-circuited when no credential is registered to avoid a needless platform authenticator round-trip on the unlock screen. The button calls `unlockWithBiometric()`, then feeds the unwrapped password into `messaging.unlockWallet()`. Biometric failures surface their raw message and do NOT increment the lockout counter (they are not bad-password guesses).
- **`test/smoke/core/biometric-unlock.smoke.js`**, full Node-side mock of `navigator.credentials` + `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` + `localStorage`. Exercises the cryptographic round-trip end-to-end (register a credential, fake an assertion that returns the same PRF output, confirm the original password comes back), the request-shape contract on both `create()` and `get()` (`userVerification: 'required'`, `authenticatorAttachment: 'platform'`, `rp.id`, `allowCredentials[].id`, PRF salt presence), the persisted-record schema, ciphertext-does-not-leak-plaintext, `clearBiometricCredential` round-trip, corruption tolerance, and the support-probe negative paths.
- **`test/smoke/ui/biometric-unlock-ui.smoke.js`**, Locked.jsx wiring (imports, state slot, short-circuit when not registered, `handleBiometric` flow, lockout-counter exemption, biometric failure must NOT call `recordLockoutFailure`, button gating on `biometricAvailable`); Settings → Safety mounting; BiometricRow's four states + Enable form's `password.length === 0` gate + `role="alert"` errors.

### Changed

- **`flows/index.js`**, re-exports the eight biometric symbols (`isBiometricSupported`, `isBiometricRegistered`, `clearBiometricCredential`, `registerBiometricCredential`, `unlockWithBiometric`, `BiometricUnsupportedError`, `BiometricNotRegisteredError`, `BiometricPrfUnavailableError`).
- **`Locked.jsx`**, adds a `biometricAvailable` state slot, an effect that probes support only when a credential is registered, a `handleBiometric` function, and a secondary "Use biometrics" Button that renders below the primary Unlock submit. The biometric path explicitly skips lockout-counter incrementation on failure.
- **`SafetySection.jsx`**, imports + renders `<BiometricRow />` between the Test-send warning input and the Panic-mode toggle.

### Behavior preserved

- The password unlock path is unchanged on success and on the `InvalidPasswordError` branch (lockout still increments only there).
- `Locked.jsx`'s caps-lock indicator (G067 / v0.143.0) and lockout banner (G066 / v0.144.0) remain in place.
- Existing settings rows in the Safety panel keep their order; `BiometricRow` slots in adjacent to the panic-mode toggle.
- Biometric registration writes a single localStorage key (`xchain-wallet:biometric`); no other persisted state is touched.

## [0.145.0] - 2026-04-27

§26 Lock & Panic, Step 3 of 6, Privacy blur on window blur (G069).

When `settings.privacy.blurOnBlur` is on, the wallet now applies a CSS blur to its body whenever the host window loses focus or visibility, alt-tab, click-away, side-panel collapse, popup occlusion, tab background. Removing focus while a balance, address, or signing dialog is on screen no longer leaks that content to a passing observer. The schema slot has existed since v2 settings (§35); this step delivers the engine that consumes it.

### Added

- **`shared/hooks/usePrivacyBlur.js`**, focus tracker. Subscribes to `window` `blur` / `focus` and `document` `visibilitychange`; on every transition recomputes hidden-state via `document.visibilityState === 'hidden'` with `document.hasFocus()` as a fallback. Sets `data-xc-privacy-blur="true"` on `<html>` while hidden, removes the attribute while focused or when `enabled` flips false. Detaches every listener on unmount + when disabled. SSR-safe, guards on `typeof document` / `typeof window`.
- **`shared/PrivacyBlurGate.jsx`**, null-rendering bridge between `useSettings` and `usePrivacyBlur`. Reads `settings.privacy.blurOnBlur`, coerces with `Boolean(settings?.privacy?.blurOnBlur)`, and feeds the flag into the hook. Mounted automatically inside `MessagingProvider`, so every shell that already wraps its app in `<MessagingProvider>` (web, extension popup, desktop renderer) gets the behaviour without local edits.
- **CSS rule** in `tokens.css`: `html[data-xc-privacy-blur="true"] body { filter: blur(12px); transition: filter var(--xc-transition); }`. The transition piggy-backs on the motion token, so `prefers-reduced-motion: reduce` (which the token already collapses to 0 ms) eliminates the fade.
- **`test/smoke/ui/privacy-blur.smoke.js`**, guards: `enabled` short-circuit, attribute clear when disabled, all three event listeners attached + detached, hidden-state composition (`visibilityState === 'hidden'` and `hasFocus()` fallback), SSR `typeof document`/`window` guards, data-attribute name pinned to `xcPrivacyBlur`, dataset write/delete pattern, gate consumes `useSettings`, gate calls `usePrivacyBlur`, gate returns null, MessagingProvider imports + renders `<PrivacyBlurGate />`, CSS selector targets the attribute, applies `filter: blur(`, transition uses `--xc-transition`.

### Changed

- **`MessagingProvider.jsx`**, renders `<PrivacyBlurGate />` as the first child of the context provider. Uses `useMemo` for the value object as before; no behavioral change to consumers.

### Behavior preserved

- When the wallet is locked or settings haven't loaded yet, `useSettings()` returns `settings = null` and the gate feeds `enabled = false` to the hook, the hook then ensures the data-attribute is cleared and detaches listeners. No surprise blur on the unlock screen.
- The `prefers-reduced-motion: reduce` collapse already set `--xc-transition: 0ms`, so users who opt out of motion get an instant on/off transition rather than a slide.
- The data attribute name (`xcPrivacyBlur` → `data-xc-privacy-blur`) is namespaced so it doesn't clash with any other `data-` flags the shells use.

## [0.144.0] - 2026-04-27

§26 Lock & Panic, Step 2 of 6, Failed-attempts escalating delay (G066).

After repeated bad-password unlock attempts, the Locked screen now imposes an escalating timed lockout that survives popup close/reopen and tab reload. The schedule is opaque-but-aggressive: attempts 1–2 are free, attempt 3 imposes 5 s, attempt 4 → 15 s, attempt 5 → 60 s, attempt 6 → 5 min, attempts 7+ → 15 min cap. A successful unlock clears the counter immediately. Errors that aren't `InvalidPasswordError` (vault corruption, unexpected throws) do not count against the user, those are bugs to surface, not guesses to penalise.

### Added

- **`flows/lockoutTracking.js`**, pure flow with no React or vault dependencies. Reads/writes a `xchain-wallet:lockout` key in `globalThis.localStorage`; degrades gracefully to in-memory state when the API is unavailable (SSR / hardened iframes / tests). Exports `delayForAttempts`, `emptyLockoutState`, `getLockoutState`, `getRemainingMs`, `recordFailure`, `recordSuccess`, `clearLockoutState`. Re-exported from `flows/index.js` under `recordLockoutFailure` / `recordLockoutSuccess` to avoid name clashes with future per-feature failure recorders.
- **Lockout banner on Locked.jsx**, `role="status"` + `aria-live="polite"` row reading "Too many failed attempts. Try again in `<countdown>`." Countdown ticks every 1 s via `setInterval`, cleaned up on unmount or when the lockout expires. Format rounds UP (`Math.ceil(ms / 1000)`) so the user never sees "0 s" while still locked.
- **`.lockoutBanner` + `.lockoutCountdown` CSS**, uses `--xc-warning` border with fallback, `tabular-nums` so the countdown digit width doesn't jitter.
- **`test/smoke/core/lockout-tracking.smoke.js`**, schedule table (every N from 0–7 + cap), persistence round-trip via fake `localStorage`, remaining-ms math at boundaries (just-locked / mid-countdown / past-expiry / null state), corruption tolerance (malformed JSON, negative counters, non-number fields), explicit `clearLockoutState`, memory fallback when `localStorage` is removed.
- **`test/smoke/ui/locked-lockout.smoke.js`**, Locked.jsx wiring: imports, lazily-initialised state slots, ticker setInterval + clearInterval, submit gating (`busy || password.length === 0 || isLockedOut`), success-path clears, failure-path increments only inside the `isBadPassword` branch, error message includes the retry window, input + button disabled while locked, button label flips to `Locked (Xs)`, banner aria + countdown formatter rounding.

### Changed

- **`Locked.jsx`**, adds two state slots (`lockout`, `remainingMs`), a countdown effect, and three new branches in `handleSubmit` (success → `recordLockoutSuccess`; bad-password → `recordLockoutFailure` + retry-window error; other error → unchanged raw message). Input and submit button gain an `isLockedOut` clause to their `disabled` props; the button label flips to a `Locked (countdown)` form while locked.
- **`flows/index.js`**, re-exports the seven lockout tracking helpers, with `recordFailure` / `recordSuccess` aliased to `recordLockoutFailure` / `recordLockoutSuccess` so the flow's intent is clear at the call site.

### Behavior preserved

- Empty-password submits still no-op (the original guard runs before the lockout check).
- Non-`InvalidPasswordError` failures still surface their raw message and clear `busy`; they do NOT increment the counter or arm a lockout.
- The unlock control flow (`messaging.unlockWallet(password)` → `onUnlocked()`) is unchanged on success; the only addition is an explicit lockout reset before `setPassword('')`.
- ARIA structure (`Input` aria-describedby, error `role="alert"`) is unchanged; the lockout banner sits adjacent to the form and announces independently.

## [0.143.0] - 2026-04-27

§26 Lock & Panic, Step 1 of 6, Caps-Lock warning in password fields (G067).

The shared `<Input>` component now detects when Caps Lock is active while a password field is focused, and renders an inline aria-live status row reading "Caps Lock is on". Detection is gated on `type="password"`: every other input type sees no behavior change. Caller-supplied `onKeyDown` / `onKeyUp` / `onFocus` / `onBlur` handlers are chained, never replaced, so existing call sites (Locked.jsx, ImportWallet.jsx, CreateWallet.jsx, ViewPrivateKey.jsx, settings password prompts) pick up the warning automatically without local edits.

### Added

- **Caps-Lock detection** on `<Input>` for `type="password"`: `event.getModifierState('CapsLock')` read on `keydown` / `keyup` / `focus`. State scoped to focused-and-on; the warning hides on blur.
- **Warning element** with `role="status"` + `aria-live="polite"`, included in `aria-describedby` only while shown so screen readers announce the change without spurious associations.
- **`.capsLock` CSS class** in `Input.module.css`: uses `--xc-warning` token with `--xc-text-muted` fallback; ⇪ glyph rendered via `::before`.
- **`test/smoke/ui/input-capslock-warning.smoke.js`**, guards: useState wired, password-only gating (`isPassword` flag + early-return in `readCapsLock`), `getModifierState('CapsLock')` invocation, missing-API guard (`typeof event.getModifierState !== 'function'`), all four caller-handler chain points (`onKeyDown` / `onKeyUp` / `onFocus` / `onBlur` each invoked via optional-chain), `showCapsLock = isPassword && focused && capsLockOn` composition, `role="status"` + `aria-live="polite"` markup, conditional `aria-describedby` inclusion, CSS class + glyph.

### Changed

- **`Input.jsx`**, destructures `onKeyDown` / `onKeyUp` / `onFocus` / `onBlur` from props before the `{...rest}` spread so the local chained handlers always win; the previous behavior of spreading rest after `aria-describedby` is preserved (hint / error / capsLock IDs still appear in describedby in that order).

### Behavior preserved

- Non-password inputs run zero new code paths, `isPassword` short-circuits the modifier-state read.
- The hint / error rendering rules are untouched: hint hidden when error present, error keeps `role="alert"` priority over the new caps-lock status row.
- All existing `<Input>` test cases pass without modification (label association, hint via aria-describedby, error + aria-invalid, ref forwarding, value/onChange pass-through).

## [0.142.0] - 2026-04-27

§44 Fee UX, Step 5 of 5, Settings → Fees panel wiring. **Closes the §44 cluster.**

The Send-form FeeSelector now seeds its initial pick from `settings.fees[chainId]`, which the §35 Fees panel writes. A user who picks "Fast" on Bitcoin in Settings opens the Send form on Bitcoin and sees the Fast tier preselected; they can still override per-tx via the FeeSelector without disturbing the saved default. Custom-mode settings (the panel's `customSatsPerKb` field) seed the FeeSelector's Custom-mode rate, with unit conversion handled by two new helpers so the user-facing display unit (sat/vB / DOGE/kB) and the persisted unit (sats/KB or koinu/KB) stay in sync.

The RBF default already wired in Step 2, this step completes the round-trip from §35 settings to the Send form for both fee strategy and per-chain custom rate.

### Added

- **`settingsCustomToDisplayRate(unit, customSatsPerKb)`** in `flows/feeEstimate.js`: bridges the Fees-panel persistence shape (smallest-unit per KB) to the FeeSelector's display unit (sat/vB on BTC/LTC, DOGE/kB on DOGE).
- **`displayRateToSettingsCustom(unit, displayRate)`**, inverse helper for writing the Send-form Custom rate back to Settings (no caller wires this yet; available for §35 polish later).
- Both exported from `flows/index.js`.
- **`test/smoke/core/fee-settings-conversion.smoke.js`**, both helpers across BTC/LTC + DOGE, 0/negative/NaN guards, round-trip identity over a range of values.
- **`test/smoke/ui/send-fee-settings-default.smoke.js`**, Send.jsx imports, strategy-derived seed effect (low/normal/fast branch + custom branch), `Number.isFinite(customSatsPerKb)` guard, chain-aware unit derivation from `descriptor.coin`, effect dependency on `[chainId, settings]`.

### Changed

- **`Send.jsx`**, new `useEffect` reads `settings.fees[chainId]` on chain or settings change; sets `feePick` to either `{ mode }` (low/normal/fast) or `{ mode: 'custom', customRate }` with the persisted rate converted to display units. The user can still flip the FeeSelector mid-form without altering the saved default.

### Behavior preserved

- The default state of `feePick` (`{ mode: 'normal' }`) still applies as the first-paint value; the settings-derived seed runs after the settings hook resolves. Forms that open before settings load see "Normal", same as v0.138.0–0.141.0.
- The seed effect is read-only; nothing the user does inside the Send form writes back to `settings.fees`. Per-tx FeeSelector picks are scoped to the form instance, by design.
- Settings → Fees panel UI is unchanged, only the read path gains a consumer.

### §44 cluster, close

Five steps shipped (v0.138.0 → v0.142.0). Cluster scope: §44.2 fee selector + §44.3 RBF toggle + §44.7 DOGE per-kB display + the §29 close FOLLOWUPs 3 (real fee selector wired into simulator) and 5 (fee-aware preview). Out of scope: §44.4 RBF replacement engine + §44.5 CPFP fallback (wallet-side UI shipped at v0.137.0; engines still need SDK + encoder work). Close report follows.

## [0.141.0] - 2026-04-27

§44 Fee UX, Step 4 of 5, SDK-backed fee fetch with placeholder fallback.

The fee tiers feeding the FeeSelector + the §21.2 simulator's fee row + the §29.2 Max button now probe the shell's messaging layer for an SDK-backed `estimateFee` method before falling back to the static placeholder table. The first shell that registers `estimateFee` (the §44 SDK + encoder work) starts feeding live rates; until then, callers see exactly the same placeholder values they got at v0.138.0–0.140.0. The "(placeholder rate)" badge on the FeeSelector flips off automatically when the source is live.

### Added

- **`fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry })`** in `flows/feeEstimate.js`: async; probes `messaging.estimateFee({ chainId })` and shapes the response into the same `{ low, normal, fast, unit }` contract the sync helper already returned. Per-tier `source` is `'sdk'` when the SDK responded with a finite rate; `'static-placeholder'` otherwise. Partial SDK responses fall back per missing tier (so a SDK that only knows "normal" still upgrades that single tier without zeroing out low/fast).
- **`test/smoke/core/fee-fetch.smoke.js`**, every branch: no messaging, messaging without `estimateFee`, SDK returns full live tiers (per-tier source / confidence / sats / etaMinutes / rateValue), SDK throws (silent fallback), SDK returns null, partial response (mixed sources), DOGE live unit semantics (per-byte koinu in, DOGE/kB rateValue out), unknown chain returns null.

### Changed

- **`Send.jsx`** , replaces the synchronous `feeTiers = useMemo(estimateNativeSendFeeTiers)` with `[feeTiers, setFeeTiers] = useState` + an effect that: 1. seeds with the synchronous placeholder so the form stays responsive on first paint 2. fires `fetchNativeSendFeeTiers` and upgrades to SDK-sourced tiers when the response lands The `feeEstimate` memo prefers `feeTiers[feePick.mode]` (which inherits the SDK source) and falls back to the sync placeholder only while the async fetch hasn't populated.
- **`test/smoke/ui/send-fee-selector.smoke.js`**, asserts the new state shape, the sync seed, the async fetcher invocation, and the live-tier preference in the `feeEstimate` memo.

### Behavior preserved

- Shells without `messaging.estimateFee` (which is all of them today) see byte-for-byte the same fee values as v0.140.0. The fallback path is the same `estimateNativeSendFeeTiers` invocation that lived in the memo.
- The placeholder badge on the FeeSelector reads `feeEstimate?.source === 'static-placeholder'`. When the SDK lights up live tiers, the badge silently disappears with no further wallet-side change required.
- Custom-mode behavior is unchanged, Custom rates always run through `customFeeEstimate` with `source: 'user'`.

## [0.140.0] - 2026-04-26

§44 Fee UX, Step 3 of 5, DOGE per-kB unit semantics in Custom-mode input.

Closes the §44.7 audit row. Step 1 already had the FeeSelector display tier rates correctly per chain (sat/vB for BTC/LTC, DOGE/kB for DOGE), but Custom-mode input expected the user to type in the *internal* per-byte unit (koinu/byte for DOGE), confusing and unnatural. Now the Custom input accepts the DISPLAYED unit, so a DOGE user types "1.5 DOGE/kB" and the system converts to koinu/byte under the hood.

### Added

- **`flows/feeEstimate.js`** grows two conversion helpers: - `displayRateToPerByte(unit, displayValue)`: converts user-natural rate (sat/vB or DOGE/kB) to the table's internal per-byte rate (sat/vB or koinu/byte). - `perByteRateToDisplay(unit, ratePerByte)`: inverse, used to populate `rateValue` consistently in the displayed unit.
- Both exported from `flows/index.js`.

### Changed

- **`estimateNativeSendFee`**, `rateValue` in returned estimates is now the user-displayed value (DOGE/kB for DOGE, sat/vB for BTC/LTC) so that the FeeSelector's Custom-mode default seed and the input value remain consistent. The actual fee math uses internal per-byte rates from the placeholder table (unchanged).
- **`customFeeEstimate`**, the `rate` parameter is now interpreted as the displayed unit; the function converts to per-byte via `displayRateToPerByte` before computing sats. `rateValue` echoes the user-typed value verbatim.
- **`test/smoke/core/fee-tiers.smoke.js`**, adds DOGE-side assertions: `tiers.normal.rateValue === 1` (DOGE/kB), Custom rate `1.5 DOGE/kB` produces `37_500_000` koinu, and round-trip identity for the conversion helpers across a range of values.

### Behavior preserved

- BTC / LTC behavior is unchanged byte-for-byte: their displayed unit (sat/vB) IS their internal per-byte rate. The conversion helpers no-op for `sat/vB`.
- The FeeSelector's `tiers.normal?.rateValue` seed for Custom-mode now matches the input's expected unit on every chain, DOGE users see "1" prefilled (DOGE/kB), not "100000" (koinu/byte).

## [0.139.0] - 2026-04-26

§44 Fee UX, Step 2 of 5, RBF toggle on Send form. Closes the §44.3 audit row.

The Send form gains a Replace-by-fee switch beneath the FeeSelector. Default reads from `settings.fees[chainId].rbfByDefault` (schema field exists, was unread); falls back to `true` when no per-chain setting is recorded. The current value flows into `messaging.sendAsset({ ..., rbf })`; the encoder uses it to set the input sequence numbers per BIP125 (sequence < 0xfffffffe enables RBF replacement; the §29 / §44.4 Speed up + Cancel actions in History only apply to RBF-flagged transactions).

### Added

- **`test/smoke/ui/send-rbf-toggle.smoke.js`**, `rbfEnabled` state defaulting to `true`, settings-derived sync, payload wiring (`rbf: rbfEnabled` lands in the base object), toggle UI (`role="switch"`, label + hint copy), and CSS hooks.

### Changed

- **`Send.jsx`**, new `rbfEnabled` state initialized to `true`; useEffect syncs from `settings.fees[chainId].rbfByDefault` when chain changes. The `base` payload object passed to both `messaging.sendAsset` (software signer) and `messaging.sendAssetHw` (hardware signer) gains `rbf: rbfEnabled`. UI: a `<label>` wrapper around an `<input type="checkbox" role="switch">` renders below the FeeSelector with title + hint copy.
- **`Send.module.css`**, `.rbfRow`, `.rbfLabel`, `.rbfHint` rules.

### Behavior preserved

- Existing wallets without a per-chain RBF preference get `true` by default, same as the historical implicit assumption (the encoder previously set RBF sequence numbers regardless). The schema-derived initialization only fires when an explicit `rbfByDefault` boolean lives in settings.
- The toggle is informational + advisory at the wallet layer; the encoder's actual RBF flagging depends on its respect for the new `rbf` payload field. When the encoder lands its handler (FOLLOWUP for the §29 RBF engine), this UI feeds it the right input automatically.

## [0.138.0] - 2026-04-26

§44 Fee UX, Step 1 of 5, FeeSelector primitive + Send.jsx wiring.

The user can now pick a fee tier on the Send form. Three presets, Low / Normal / Fast, render their rate, the absolute coin-amount fee, and an approximate ETA pulled from a per-chain placeholder table. A Custom mode accepts a sat/vB rate (BTC / LTC) or a koinu/byte rate (DOGE) directly. The selected estimate flows into the §21.2 simulator's fee row + the §29.2 Max button, so both reflect the user's pick instead of the silent placeholder default.

Closes the §29 close FOLLOWUP 3 (real fee selector); the placeholder rates themselves stay flagged as such until Step 4 wires SDK-backed fetch.

### Added

- **`packages/core/src/ui/FeeSelector.jsx`** + **`.module.css`**, presentation-only primitive. Props: `tiers` (from `estimateNativeSendFeeTiers`), `value` (`{ mode, customRate? }`), `onChange`, `disabled`, `placeholderBadge`. ARIA radiogroup with three preset radios + a Custom radio that reveals a numeric input. The component never computes fees itself, callers pass tiers in and get selection events back. Re-exported from `@xchain-wallet/core/ui`.
- **`flows/feeEstimate.js`** grows two helpers and a `speed` parameter: - `estimateNativeSendFee({ chainId, chainRegistry, speed = 'normal' })` now dispatches per tier.
- **`test/smoke/core/fee-tiers.smoke.js`**, per-chain tier dispatch (sats math, defaults, unknown speed fallback, DOGE/kB unit semantics), `estimateNativeSendFeeTiers` ordering + null guards, `customFeeEstimate` rate validation + zero-rate allowance.
- **`test/smoke/ui/fee-selector.smoke.js`**, public API + ARIA radiogroup, preset wiring from `tiers` prop, selection writes (`onTierClick`, `onCustomToggle`, `onCustomRateChange`), empty-state copy, conditional placeholder badge, and CSS hooks.
- **`test/smoke/ui/send-fee-selector.smoke.js`**, Send.jsx imports, `feePick` state defaulting to `'normal'`, `feeTiers` + `feeEstimate` memos (custom branch dispatches to `customFeeEstimate`, tier branch passes `speed: feePick.mode`), and form rendering with `placeholderBadge` bound to source.

### Changed

- **`Send.jsx`**, replaces the static `feeEstimate = useMemo(estimateNativeSendFee)` with `feePick` state + `feeTiers` memo + a tier-aware `feeEstimate` memo. The selector renders below the Memo input. Both the simulator's fee row and the Max button now reflect the user's tier or custom rate.

### Behavior preserved

- Existing `estimateNativeSendFee` callers that omit `speed` get the same value they got before (defaults to `'normal'`, which matches the previous single-rate placeholder).
- Surfaces still mark the values "(placeholder)" until Step 4 wires SDK-backed fetch, the badge surfaces inside the FeeSelector's `placeholderBadge` slot.
- Submit, signing, balance preview, raw PSBT viewer, all unchanged.

## [0.137.0] - 2026-04-26

§29 Send/Receive, Step 6 of 6, RBF Speed up + Cancel from History. **Closes the §29 cluster.**

Pending (mempool-only) coin-moving entries in History grow Speed up + Cancel buttons inside the inline DetailCard. The UI surfaces are complete; the replacement-broadcast engine itself depends on SDK / encoder work that lands as part of the §44.4 / §44.5 cluster (building a replacement transaction that respends the original tx's UTXOs at a higher fee for Speed up, or routes them to a self-controlled output for Cancel). Until that engine wires up, clicks surface a clear "RBF replacement is not supported by this build" error inline, honest about the gap, not a silent no-op.

### Added

- **`packages/core/src/flows/rbfReplace.js`**, `isEntryReplaceable(entry)` (gate: pending blockIndex, txHash present, action ∈ SEND/SWEEP/DISPENSE/DIVIDEND/AIRDROP/EXECUTE/DEPOSIT/WITHDRAW); `sendRbfRequest({ messaging, request })` (probes for `messaging.replaceTx`, validates the request shape, throws `RbfNotSupportedError` when the engine isn't wired); `replaceFromHistoryEntry({ messaging, entry, strategy, walletId, feeRate })` (validate + dispatch convenience wrapper). Exports `RbfNotSupportedError` + `RbfInvalidEntryError`.
- **`RbfActions` sub-component** in `History.jsx`: renders Speed up + Cancel buttons + inline error / status states; uses `useMessaging` to grab the shell's messaging layer and runs the flow on click.
- **`test/smoke/core/rbf-replace.smoke.js`**, full coverage of `isEntryReplaceable` (null / empty / confirmed / no-hash / non-replaceable action / case-insensitive / all 8 replaceable kinds), `sendRbfRequest` error branches (no replaceTx → `RbfNotSupportedError`; null request; missing chainId / originalTxHash; unknown strategy), happy-path passthrough, and `replaceFromHistoryEntry` validation + dispatch.
- **`test/smoke/ui/history-rbf.smoke.js`**, imports, DetailCard gate wiring, `RbfActions` component shape (messaging hook, flow invocation, button labels + strategies), error / status role attributes, and CSS hooks.

### Changed

- **`History.jsx`**, imports the rbfReplace flow primitives; DetailCard checks `isEntryReplaceable(entry)` and renders `<RbfActions entry={entry} />` inline when the entry is in mempool. New `RbfActions` function component lives at the bottom of the file, after DetailCard.
- **`History.module.css`**, `.rbfActions`, `.rbfError`, `.rbfDone` rules. The actions row sits below the decoded ACTION block with a dashed top border so it reads as a separate, action-bearing region.

### Behavior preserved

- Confirmed entries (blockIndex > 0) and non-coin-moving actions (ISSUE / MINT / DESTROY / ORDER / etc.) render the existing DetailCard exactly as before, no new buttons, no new wiring. Only mempool entries on the eight replaceable kinds gain the affordance.
- The flow validates the request shape before dispatching, so misuse from custom calling code surfaces `RbfInvalidEntryError` instead of an opaque host-side error. Surfaces wired today, engine wires when §44 ships.

### §29 cluster, close

Six steps shipped (v0.132.0 → v0.137.0). Cluster scope: §29.4 / §29.5 / §29.7 / §29.9 / §29.10 audit rows; deferred §21 FOLLOWUPs 2 (test-send) / 3 (recipient safety trio) / 4 (autocomplete) / 5 (fee-aware preview); plus the §44.4 RBF UI surfaces. A close report follows separately.

## [0.136.0] - 2026-04-26

§29 Send/Receive, Step 5 of 6, Receive Request payment sub-form + Share button.

Closes the §29.10 (Request payment) and §29.7 (Share) audit rows.

### Fixed

- **Settings drill-down crash.** `Settings.jsx` declared `filtered = useMemo(...)` AFTER the subpage early-return, so flipping `subpageId` from null to a section id dropped a `useMemo` call from the second render and tripped React's "Rendered fewer hooks than expected" guard. The hook is hoisted above the subpage branch; both render paths now call the same number of hooks. User-reported during Step 5.

### Added

- **Request payment** sub-form on `Receive.jsx`. A `+ Request payment` toggle below the bare-address QR opens a form with Amount / Asset ticker / Memo / Expiry (minutes) inputs. As the user types, a second QR renders the BIP21 URI with `amount`, `message`, optional `tick` (XChain extension), and optional `expiry` (ISO timestamp) params. The full URI displays under the QR with Copy + Share buttons.
- **Share button** next to the bare-address Copy button (always present on a loaded address) and inside the Request payment panel. Uses `navigator.share()` when available (mobile native share sheet); falls back to `navigator.clipboard.writeText()` with an inline "Copied to clipboard." status. When neither is available, shows "Share unavailable, copy the link manually."
- **`test/smoke/ui/receive-request-share.smoke.js`**, useMemo import, all six new state slots, request URI memo (amount / tick / expiry param wiring), QR generation, share callback (Web Share + clipboard fallback), bare-address share button, panel UI + ARIA, and CSS hooks.

### Changed

- **`Receive.jsx`**, adds `useMemo` to the React import. Six new state hooks for the request form. Two new memos (`requestUri`, derived `expiresAt`). A new `useEffect` rendering `requestUri` to a QR data URL. New `onShare` callback. The body grows a `<section className={styles.requestPanel}>` block below the bare-address row. The bare-address row gains a Share button next to Copy.
- **`Receive.module.css`**, `.requestPanel`, `.requestToggle`, `.requestForm`, `.requestUri`, `.requestActions` rules. `.requestUri` is monospace + `word-break: break-all` so the long URI wraps cleanly inside the card.

### Behavior preserved

- The bare-address QR + AddressText + CopyButton above are unchanged. The request form is purely additive, opens on demand, collapses by default.
- Share's clipboard fallback uses the same Clipboard API as `<CopyButton>`. When neither share nor clipboard are available, the inline status copy tells the user to copy manually rather than swallowing silently.

## [0.135.0] - 2026-04-26

§29 Send/Receive, Step 4 of 6, Max button + fiat toggle + real fee estimate.

Closes the deferred §21 FOLLOWUP 5 (fee-aware balance preview) and the §29.2 / §29.3 audit rows. The Send form's Amount block grows three affordances:

- **Max button.** Sets the amount to the source-address balance minus the estimated network fee (for native-coin sends) or the full asset balance (for token sends, since the fee is paid in native coin separately). Disabled when the balance hasn't loaded.
- **Fiat / native toggle.** Pressing the currency button next to Max flips the input between the chain's native ticker and USD. In fiat mode the user types a USD value; the form derives the canonical native amount via the placeholder rate. The non-active mode shows up as a "≈" preview under the field. The toggle is disabled when no rate is available.
- **Real fee estimate fed to the simulator.** The §21.2 BalanceChanges renderer now sees a non-zero fee number for SEND, so the fee row stops reading "(0)" and starts reading the actual placeholder estimate. Both surfaces display "(placeholder)" next to the value so users know it's not from a live source.

### Added

- **`packages/core/src/flows/feeEstimate.js`**, `estimateNativeSendFee({ chainId, chainRegistry })` returns `{ sats, coinAmount, source: 'static-placeholder', confidence: 'low', rate, vsize } | null`. Per-chain placeholder values: BTC 1500 sats (~6 sat/vB × 250 vB), LTC 250 sats (~1 sat/vB × 250 vB), DOGE 25,000,000 koinu (1 DOGE/kB protocol minimum). `satsToCoinDecimal(sats)` does the trailing-zero-stripping conversion.
- **`packages/core/src/flows/priceLookup.js`**, `getFiatRate({ chainCoin, fiatCurrency = 'USD' })` returns `{ rate, chainCoin, fiatCurrency, source, fetchedAt } | null`. Placeholder rates: BTC $40k, LTC $80, DOGE $0.10. Non-USD currencies return null (single-currency table). `coinToFiat` and `fiatToCoin` handle the conversions; `fiatToCoin` rounds to 8 decimals by default.
- **`test/smoke/core/fee-estimate.smoke.js`**, `satsToCoinDecimal` edge cases; per-chain placeholder values; unknown chain / coin handling; null guards.
- **`test/smoke/core/price-lookup.smoke.js`**, `getFiatRate` per-chain values, unknown coin / non-USD currency returns null, `coinToFiat` numeric + string inputs, `fiatToCoin` round-trip precision and zero-rate guard.
- **`test/smoke/ui/send-max-fiat.smoke.js`**, Send.jsx imports + `feeEstimate` memo wired into the simulator (no leftover `'0'` literal); `fiatRate` memo, `amountMode` / `fiatInput` state, toggle + fiat-input handlers; Max callback subtracts fee from balance for native sends; balance hint copy + form-stage balance fetch; CSS hooks.

### Changed

- **`Send.jsx`** : - Hoisted `feeEstimate` memo above the simulator's `previewResult` so the simulator gets a real fee number. - New state: `amountMode: 'native' | 'fiat'`, `fiatInput`.
- **`Send.module.css`**, `.amountRow`, `.amountField`, `.amountActions`, `.amountButton`, `.balanceHint` rules.

### Behavior preserved

- The form's existing Amount field and its `setAmount` plumbing remain the source of truth for the SEND payload, all derived state (fiat input, Max output) writes back through `setAmount`. The submit + review path is unchanged.
- The simulator's fee row was already rendered; only the input changed (placeholder instead of zero). When the §44.2 selector lands, the same wiring carries the user's chosen rate without further changes to Send.jsx.
- All values displayed from the placeholder tables carry "(placeholder)" or "(placeholder rate)" badges so users don't mistake them for live data. When §44.2 / §45 wire real sources, those badges drop automatically.

## [0.134.0] - 2026-04-26

§29 Send/Receive, Step 3 of 6, Test-send protection.

Closes the deferred §21 FOLLOWUP 2. The Settings → Safety → Test-send warning threshold (sats), shipped at v0.123.0 with no consumer, finally has one. When all four conditions hold:

1. `settings.grace.testSendThresholdSats > 0`
2. The send is a native-coin send (asset matches `descriptor.coin` uppercased, sat-denominated thresholds only translate cleanly for native sends; asset / token thresholds wait on a fiat-aware affordance)
3. The form's `amount × 1e8` (sats) exceeds the threshold
4. The recipient is novel, not in contacts on this chain, never received a SEND from any of the wallet's addresses on this chain, and not yet acknowledged in the session

…the review stage renders a banner above the submit area with two actions:

- **Send a small test first**, reduces the form's amount to 1% of the original (with a 1-sat floor) and returns the user to the form so they can tweak before signing the test transaction.
- **I've verified, continue**, adds the address to a session-scoped acknowledgement set so the gate stops firing for that address; the user can sign normally.

The submit button is disabled while the gate is active. Closing the form, switching chains, or entering a different recipient all release the gate.

### Added

- **`packages/core/src/flows/recipientNovelty.js`**, `checkRecipientNovelty({ address, chainCoin, contacts, historyRows })` returning `{ everSentTo, knownAsContact, novel }`. Pure helper feeding off the same data Step 1 already loaded for autocomplete (no extra fetch). Exported from `packages/core/src/flows/index.js`.
- **`test/smoke/core/recipient-novelty.smoke.js`**, empty inputs, contact-on-wrong-chain skip, history dedup over destination / DESTINATION / recipient field aliases, ISSUE actions ignored, novel-address result.
- **`test/smoke/ui/send-test-send-gate.smoke.js`**, Send.jsx wires `useSettings`, the novelty helper, the `testedThisSession` set + `markTested` setter, the gate memo (with all four condition gates), the small-test handler (1% reduction, return to form), the gate UI (banner copy + buttons + ack wiring), submit-disable wiring, and the four new CSS hooks.

### Changed

- **`Send.jsx`** : - `useSettings` + `checkRecipientNovelty` imported. - New `testedThisSession` Set state + `markTested` callback. - New `testSendGate` memo computing the four conditions; returns `{ amountSats, threshold, ticker } | null`. - New `onSendSmallTest` callback that scales `amount × 0.01` (8-decimal float, trailing-zero stripped) and pops back to the form stage. - Review stage renders the gate banner between decoded warnings and the RawPsbtViewer when `testSendGate` is non-null. - Submit button gains `!!testSendGate ||` to its `disabled` predicate.
- **`Send.module.css`**, `.testSendGate`, `.testSendTitle`, `.testSendBody`, `.testSendActions` rules. Banner uses the accent-primary color tokens (informational, not the warning yellow, this is a friendly nudge, not an error).

### Behavior preserved

- Threshold = 0 (the schema default): gate is off entirely. Existing wallets see no behavior change.
- Asset / token sends: gate doesn't fire (sat threshold isn't meaningful here). FOLLOWUP, fiat-aware threshold once §45 PRICE oracle wires.
- Acknowledgement is session-only, across reloads, the user re-confirms novel recipients. Persisting to a `wallet.testedRecipients` list would require a v3 migration; deferred until other v3 housekeeping accumulates.
- Test-send doesn't auto-resume the original amount after broadcast, the user re-enters it next time. The session ack set means they don't see the gate again on the second send.

## [0.133.0] - 2026-04-26

§29 Send/Receive, Step 2 of 6, Recipient safety trio (checksum highlighting + paste-integrity + lookalike fuzzy match).

Closes the deferred §21 FOLLOWUP 3 from the signing-safety close report. Three additive defenses on the Send To-field:

- **Checksum-positional highlighting.** `<AddressText>` gains a `highlight` prop. When set, addresses render as three spans, first 6 (head, accent) / middle (muted) / last 6 (tail, accent), so users can sanity-check the identifying ends of the destination at a glance. Send.jsx review wires `highlight` on the From row and the Destination detail row.
- **Paste-integrity check.** New `pasteIntegrity.checkPasteIntegrity({ pastedText })` SHA-256-hashes the pasted text and re-reads `navigator.clipboard.readText()` one frame later. If the clipboard rewrote itself between paste and re-read (a clipboard-hijack tell), Send.jsx surfaces a warning under the To-field. Permission failures / missing API silently skip, the warning is purely additive.
- **Lookalike fuzzy match.** New `lookalike.findLookalike({ address, candidates })` runs Levenshtein distance against the same suggestion set Step 1 built from contacts + recent send history. When the entered address scores ≥90% similarity to a known address, same length, one or two characters off, Send.jsx renders a warning naming the contact / history hit and the percent score.

### Added

- **`packages/core/src/shared/utils/lookalike.js`**, `levenshtein(a, b)` (single-row DP, O(min(a, b)) memory), `similarity(a, b)` (1 - distance / max), `findLookalike({ address, candidates, threshold = 0.9, minLength = 20, maxDistance = 4 })` returning `{ match, score, distance } | null`. Length-gated (skip candidates more than ±2 chars off) and short-input-gated (skip when the entered address is shorter than `minLength`).
- **`packages/core/src/shared/utils/pasteIntegrity.js`**, `hashText(text)` (SHA-256 hex via `@noble/hashes`), `checkPasteIntegrity({ pastedText, clipboard? })` async helper. Returns `{ ok, skipped?, pastedHash, reread?, rereadHash?, reason? }`. Caller-injectable `clipboard` prop for testability.
- **`test/smoke/core/lookalike.smoke.js`**, Levenshtein basics (kitten/sitting, saturday/sunday, single edits, empty / non-string), similarity gradient, findLookalike happy path, no-hit cases, threshold suppression, maxDistance gate, short-input gate, multi-candidate scoring.
- **`test/smoke/core/paste-integrity.smoke.js`**, fixed-vector SHA-256 (`""`, `"abc"`), non-string inputs, all five clipboard branches (no clipboard, identical, mismatch, throwing readText, non-string readText, missing readText fn).
- **`test/smoke/ui/address-text-highlight.smoke.js`**, `highlight` prop default off, head/middle/tail span rendering, truncate-vs-full middle behavior, empty / short-address branches, CSS hooks including the muted-token middle.
- **`test/smoke/ui/send-recipient-safety.smoke.js`**, Send.jsx imports + state + paste-integrity wiring + lookalike candidate set + warning copy + form-stage rendering + review-stage `highlight` on From and Destination.

### Changed

- **`packages/core/src/ui/AddressText.jsx`**, adds `highlight` prop (default false). Refactor splits the render into four explicit branches (empty / short / non-highlight / highlight). Truncate behavior unchanged when `highlight` is off, existing call sites keep their current rendering.
- **`packages/core/src/ui/AddressText.module.css`**, `.head`, `.middle`, `.tail` rules. `.middle` uses `--xc-text-muted`.
- **`Send.jsx`** : - Paste handler now also fires `checkPasteIntegrity` (fire-and-forget; mismatch sets `pasteWarning`). - New `lookalikeWarning` memo over `toAddress` + `suggestions`.

### Behavior preserved

- Non-highlight `<AddressText>` rendering is unchanged byte-for-byte for existing callers.
- The Send form keeps its current submit / signing / balance-preview / raw-PSBT-viewer wiring. The two new warnings are advisory; neither blocks submit.
- Paste-integrity skips silently on browsers / contexts where `navigator.clipboard.readText` isn't available, so the form remains usable in non-secure contexts.

## [0.132.0] - 2026-04-26

§29 Send/Receive, Step 1 of 6, Recipient autocomplete + smart paste.

The Send To-field becomes a combobox sourced from the user's contacts plus addresses they have previously sent to from this wallet on the active chain. Pasting into the To-field detects BIP21 / `xchain:` URIs (pre-filling amount, ticker, and memo) and surfaces a hint when the clipboard contents look like a private-key WIF (pointing the user at the import-private-key flow rather than letting a private key land in a recipient field).

Closes the §29.4 / §29.5 audit rows and the deferred §21 FOLLOWUP 4 (autocomplete).

### Added

- **`packages/core/src/flows/recentDestinations.js`**, pure helper. `buildRecentDestinations({ contacts, chainCoin, historyRows })` returns a `Suggestion[]` ordered contacts-first, then send-history entries deduped by address and ranked by recency × frequency. `filterSuggestions(suggestions, query)` runs the substring filter the combobox applies on every keystroke. Both exported from `packages/core/src/flows/index.js`.
- **`packages/core/src/ui/AddressCombobox.jsx`** + **`.module.css`**, combobox primitive wrapping `<Input>`. ARIA: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`; listbox + option roles on the dropdown; `aria-selected` on the active option. Keyboard nav for ArrowUp / ArrowDown / Enter / Escape. `onPaste` passes through to the underlying input so callers (Send.jsx) can run paste detection before the value lands. Re-exported from `@xchain-wallet/core/ui`.
- **`test/smoke/core/recent-destinations.smoke.js`**, exercises the helper across empty inputs, contact filtering by chain, history deduplication and recency ordering, contact-vs-history merge precedence, contact name vs entry-label sublabel rules, and `filterSuggestions` substring matching.
- **`test/smoke/ui/address-combobox.smoke.js`**, public API, forwardRef export, Input wrapping, every ARIA hook, the four keyboard handlers, mousedown selection wiring, and CSS-module hooks.
- **`test/smoke/ui/send-autocomplete.smoke.js`**, Send.jsx wires the combobox in the form, fetches contacts on mount, fetches per-address history when chain changes, feeds the helper, runs `detectQrContent` on paste, and surfaces `pasteHint` through the combobox `hint` slot.

### Changed

- **`Send.jsx`** , To-field is now `<AddressCombobox>` with the same label, placeholder, and autocomplete attributes as before.
- **`SafetySection.jsx`**, Undo-send grace row removed. The feature was scrapped: a cancellable countdown both delays every broadcast and rewards rage-clicking with a no-op. The `settings.grace.undoSendSeconds` schema field stays as a dead slot until a future v3 migration sweeps it (see settings close FOLLOWUP 12).
- **`test/smoke/ui/settings-safety.smoke.js`**, drops the undo-send assertions and adds explicit `doesNotMatch` checks so a future re-introduction is loud.

### Behavior preserved

- The To-field still accepts arbitrary text, pasting a raw address passes through unmodified. The combobox dropdown is purely additive and disappears on Escape, blur outside the combobox, or selection.
- Contact / history fetches are non-blocking, failure leaves the user with an empty suggestion list and the bare text-input behavior intact.
- Submit, signing, balance preview, raw PSBT viewer, all unchanged.

## [0.131.0] - 2026-04-26

§21 Signing Safety, Step 6 of 6, Raw PSBT viewer (Developer Mode gated). Closes the §21 cluster and retires Settings FOLLOWUP 6.

A power-user reveal under both sign surfaces, SignApproval (`signPsbt` + `signAction`) and Send.jsx review. Hidden by default; opens to a `<details>` disclosure showing whichever raw pieces the surface has at sign time:

- **PSBT hex**, surfaced for dApp-initiated `signPsbt` requests where the dApp passes the hex it built.
- **Action fields**, pretty-printed JSON of the payload the encoder will ingest. Always available for `signAction` and the Send.jsx review form.
- **Parsed inputs / outputs**, placeholder section that reads "(parser not wired yet, see PSBT hex above)". A future commit wires a real BIP-174 parser; until then the disclosure stays honest about its limit.

A Copy button writes the displayed payload (PSBT hex when present, else action-fields JSON) to the clipboard.

### Added

- **`packages/core/src/shared/components/RawPsbtViewer.jsx`**, `<RawPsbtViewer developerMode psbtHex actionFields />`. Hard-gated: `developerMode=false` → null; no payload at all → null (no orphan disclosure). Read-only.
- **`packages/core/src/shared/components/RawPsbtViewer.module.css`**, dashed border + subtle background so the viewer reads as a developer affordance, not part of the main sign surface.
- **`getSettings()`** in `packages/extension/src/approval/messaging.js`: the approval window doesn't sit inside the shared MessagingProvider, so it can't use the `useDeveloperMode` hook. This wrapper hits the same `settings.get` host handler the popup + web shells call.
- **`test/smoke/ui/raw-psbt-viewer.smoke.js`**, public API + dual gate semantics (developerMode + non-empty payload), section presence + ARIA labels, Copy-button label semantics, every CSS hook, SignApproval wiring (settings fetch + per-kind props), Send.jsx wiring.

### Changed

- **`SignApproval.jsx`**, fetches `getSettings` once on mount, caches `developerMode` in local state (defaults to `false` so cold start + fetch failure both keep the gate closed). Renders `<RawPsbtViewer>` between BalanceChanges and the password form.
- **`Send.jsx`**, uses the existing `useDeveloperMode` hook (Send sits inside MessagingProvider). Renders `<RawPsbtViewer>` after the warnings block in the review stage with `action: 'SEND'` + the form's TICK / AMOUNT / DESTINATION / MEMO.

### Behavior preserved

- Sign-screen surfaces unchanged for users with developer mode off, the new component renders nothing in that path. Fetch failures keep the gate closed by design.
- Approve / Reject footer position, password gate, save-permanent toggle, HW signing block, BalanceChanges placement, action details disclosure, all unchanged.

### §21 cluster, close

This commit closes the §21 Signing Safety build (Steps 1–6, v0.126.0–v0.131.0). End-to-end: pure simulator (Step 1) → renderer (Step 2) → Send.jsx wiring (Step 3) → SignApproval wiring (Step 4) → §21.3 layout polish (Step 5) → raw view (Step 6). Of the seven §21 audit rows in the 2026-04-26 gap report, five close (transaction simulator, raw PSBT viewer, the §21.3 layout pieces). Two remain deferred for §29 Send-form clusters (test-send protection, recipient checksum highlighting + autocomplete), see the close report at `claude/reports/specs/2026-04-26_signing-safety-build-close.md` (lands in the next commit).

## [0.130.0] - 2026-04-26

§21 Signing Safety, Step 5 of 6, sign-screen layout polish (§21.3 + §21.7).

Brings the sign screens, the dApp-triggered SignApproval window and the user-initiated Send.jsx review stage, in line with the §21.3 layout sketch and §21.7 copy conventions. Three pieces:

1. **Chain-aware approve / sign buttons.** "Approve & Sign on Bitcoin" instead of bare "Approve" for `signAction` and `signPsbt`; "Sign on Bitcoin" instead of bare "Send" for the Send.jsx software-signing path. Mitigates approval-drift between tabs, the user always sees which chain is about to commit a signature. `signMessage` keeps "Approve" (signing a message commits no value, the chain suffix would mislead). `signIn` reads "Sign in".
2. **dApp Source block.** New labelled section above the action summary in SignApproval, Origin in mono, optional App name below. Distinct surface (`--xc-surface-raised` background + bordered) so the user reads "this is from xyz.com" before reading what the action does. Renders only when an origin is present.
3. **Collapsible details.** Action details (per-field decoded rows) now sit inside a `<details>` disclosure that's closed by default, per §21.3 ("collapsed but discoverable; power users expand, casual users ignore"). Toggle reads "Details (N)" with the row count.

### Added

- **`approveLabel`** derivation in `SignApproval.jsx`: kind-aware label ("Approve & Sign on <chain>" / "Approve & Sign" / "Sign in" / "Approve").
- **Source block**, `<section>` above SignSummary surfacing dApp `origin` + `appName`.
- **`<details>` + `<summary>` disclosure** wraps action details in both SignApproval and Send.jsx review.
- **`packages/extension/src/approval/kinds/SignApproval.module.css`**, new `.source`, `.sourceLabel`, `.sourceOrigin`, `.sourceApp`, `.details`, `.detailsToggle` rules. Source uses `--xc-surface-raised`; toggle reads as a small label that hovers to full text.
- **`packages/core/src/shared/routes/Send.module.css`**, new `.details`, `.detailsToggle` rules; `.detailsList` now nests inside the disclosure.
- **`test/smoke/ui/sign-screen-layout.smoke.js`**, approve-label semantics for all four kinds, Source block presence + props, action-details disclosure, every new CSS hook, Send.jsx submit-label + disclosure parity.

### Changed

- **`SignApproval.jsx`**, Approve button now renders `{approveLabel}` (was hardcoded "Approve"). Action details `<dl>` wrapped in a `<details>` disclosure with a "Details (N)" summary. Source block renders above SignSummary on dApp-originated requests.
- **`Send.jsx`**, Submit button reads "Sign on <chain>" (software path) or "Sign on Trezor/Ledger" (HW path; unchanged copy). Review-stage `<dl>` wrapped in a `<details>` disclosure.

### Behavior preserved

- Approve / Reject footer position, password gate, save-permanent toggle, HW signing block, unchanged.
- BalanceChanges renders above the disclosure (always visible) so the headline metric stays scannable; the disclosure only hides the per-field details that power users want to expand.

## [0.129.0] - 2026-04-26

§21 Signing Safety, Step 4 of 6, SignApproval (signAction) wires the preview.

The §21.2 preview now lights up on the dApp-triggered sign screen too. SignApproval.jsx fetches the source address's balances against the dApp's requested chain, runs them through the simulator, and renders `<BalanceChanges>` between the existing `<SignSummary>` and the password form. Source address resolution: prefer `payload.payload.from.address` when the dApp passes it; otherwise fall back to the wallet's first address on the requested chain via `addresses.byChain`. Fetch failures degrade gracefully, the section reads "(preview unavailable)" and the user can still approve.

The preview is gated to the `signAction` kind. `signMessage`, `signPsbt`, and `signIn` skip it, they don't move value, so a balance-change preview would be misleading.

### Added

- **`getAddressBalances` + `getAddressesByChain`** in `packages/extension/src/approval/messaging.js`: thin wrappers matching the popup + web shells, routing to `balances.address` and `addresses.byChain` respectively. Lets the approval window resolve a signing source address without round-tripping through the popup.
- **`test/smoke/ui/sign-approval-balance-preview.smoke.js`**, approval-side wrappers, render-gate semantics (`signAction` only), source-address resolution (dApp-supplied vs fallback), simulator inputs (action / params / balances / fee), loading + error props plumbed through, JSX ordering (`<SignSummary>` → `<BalanceChanges>` → form).

### Changed

- **`packages/extension/src/approval/kinds/SignApproval.jsx`** : - Adds `previewBalances` state + a `signAction`-gated `useEffect` that resolves the source address and fetches its balances. - Adds a `useMemo` that runs `decoder.simulateAction` once balances arrive. - Renders `<BalanceChanges>` between `<SignSummary>` and the password form, only for the `signAction` kind. - Fee defaults to `'0'` until the bridge payload carries an estimate (§44.2).

### Behavior preserved

- All four sign kinds (`signMessage` / `signPsbt` / `signAction` / `signIn`) keep their existing summary, password gate, save-permanent toggle, and approve / reject footer. The preview is additive, approval still resolves cleanly even if the preview fetch fails.
- `signMessage` / `signPsbt` / `signIn` continue to render exactly as before, the preview gate is structural, not a runtime fall-through.

## [0.128.0] - 2026-04-26

§21 Signing Safety, Step 3 of 6, Send.jsx review wires `<BalanceChanges>`.

The §21.2 preview goes live on the user-initiated Send flow. On entering the review stage Send.jsx now fetches the source address's balances via the new `balances.address` shell wrapper, runs the SDK shape through the new `decoder.balancesFromSdk` adapter, feeds the decoded ACTION + balances into `decoder.simulateAction`, and renders `<BalanceChanges>` between the headline and the details list. Fetch failures don't block, the section reads "(preview unavailable, <reason>)" muted and the user can still sign.

### Added

- **`packages/core/src/decoder/balanceAdapter.js`**, `balancesFromSdk(sdkShape)` converts the SDK's `{ native, assets }` raw shape (string base-units `quantity` + `divisibility`) into the simulator's human-scale `BalanceLookup[]`. Pure helper, sits in `decoder/` because it pairs 1:1 with `simulateAction`'s input contract. Re-exported from `decoder/index.js` so callers reach it via `decoder.balancesFromSdk(...)`.
- **`getAddressBalances(chainId, address)`** in `packages/web/src/messaging.js` and `packages/extension/src/popup/messaging.js`: thin wrapper over the existing `balances.address` host handler.
- **`test/smoke/ui/send-balance-preview.smoke.js`**, adapter semantics (sat scaling, divisibility=0, trailing-zero strip, negative quantities, null/empty), per-shell wrapper presence, Send.jsx imports + `simulateAction` + `balancesFromSdk` calls + the on-review-only effect + the loading/error props plumbed to the renderer + the JSX ordering (summary → BalanceChanges → details list).

### Changed

- **`packages/core/src/shared/routes/Send.jsx`**, adds `previewBalances` state (loading / error / sdkShape) and a stage-gated `useEffect` that fetches against the source address; adds `previewResult` derived via `simulateAction`; renders `<BalanceChanges>` between the action headline and the details list. Fee defaults to `'0'` until the §44.2 fee-selector cluster lands.

### Behavior preserved

- Send.jsx form / submit / done / error paths unchanged. The preview is additive, review still progresses to `submitting` even if the preview fetch fails.
- SignApproval (signAction) still renders the v0.125.0 layout unchanged; Step 4 wires the same preview there next.

## [0.127.0] - 2026-04-26

§21 Signing Safety, Step 2 of 6, `<BalanceChanges>` renderer.

Dumb renderer over a `SimulationResult` (the shape produced by `decoder.simulateAction` shipped at v0.126.0). Three lifecycle states, loading skeleton, error fallback (preview unavailable), result, and three render sections, balance deltas, side effects, notes. Renders nothing when the result is empty so a fee-only generic-fallback action doesn't show an orphaned section.

### Added

- **`packages/core/src/shared/components/BalanceChanges.jsx`**, `<BalanceChanges result loading error title />`. Per-row helpers split fee rows ("Network fee, BTC 0.0003") from token deltas ("Your MYTOKEN: 500 → 400") with a `data-direction` attribute (`down` / `up` / `flat`) on each row that the CSS uses for color affordance. Side effects render as a labelled list ("MYTOKEN supply: +50 (newly minted)"). Notes render muted at the bottom.
- **`packages/core/src/shared/components/BalanceChanges.module.css`**, root card uses `--xc-surface-raised` to read as a distinct block under the action headline. Negative-delta `.after` reads in `--xc-danger`, positive in `--xc-success`. Fee row reads muted.
- **`test/smoke/ui/balance-changes.smoke.js`**, public-API check, three lifecycle states, fee-vs-token branching, direction helper semantics, side-effects + notes rendering, every CSS hook the JSX references, and a forward-looking pair of assertions that Send.jsx and SignApproval.jsx are *not* yet wired (Steps 3 + 4 will wire).

### Behavior preserved

- No callers consume the component yet. Steps 3 + 4 wire it into Send.jsx review stage and SignApproval.jsx (signAction kind), those wiring smokes confirm end-to-end behavior. This step exercises the renderer in isolation.

## [0.126.0] - 2026-04-26

§21 Signing Safety, Step 1 of 6, pure transaction simulator (`txSimulator.js`).

The first §21.2 building block. A pure projection module that, given a decoded ACTION + the source address's current balances + a fee estimate, returns the post-state the user is about to commit to: per-asset balance deltas (token rows + a coin row + a separate fee-label row), protocol-level side effects (token supply changes, dispenser open / cancel / refill, dividend pool, broadcast publication), and prose notes for the not-pre-simulatable parts (holder count for DIVIDEND, list size for AIRDROP, contract state for EXECUTE). No I/O, no SDK, no vault, Steps 3 and 4 wire the SDK balance lookup into Send.jsx review and SignApproval respectively, then feed it into a `<BalanceChanges>` component that ships in Step 2.

### Added

- **`packages/core/src/decoder/txSimulator.js`** , `simulateAction({ action, params, balances, feeEstimate, chainId, chainRegistry })` returning `{ deltas, sideEffects, notes }`. - Per-action simulators: SEND (token / coin), SWEEP, MINT (to-self / to-other), DESTROY, ISSUE (v0 create / v0 transfer-only / v3 lock / config), DIVIDEND, DISPENSER (v0 open / v1 cancel / v2 edit-refill), BROADCAST (v0/v1/v2/v3), AIRDROP, LIST, BATCH (recursive aggregation), generic fallback. - Decimal-string add / subtract on bigint-scaled integers, sat-level precision survives arbitrary chained operations without float drift.
- **`packages/core/src/decoder/index.js`**, re-exports `simulateAction` alongside the existing `decodeAction`.
- **`test/smoke/core/tx-simulator.smoke.js`**, 19 cases covering every per-action simulator, BATCH aggregation, decimal-string precision (sat-level + signed), generic fallback, empty-balance / null-fee paths, and static wiring.

### Behavior preserved

- `decodeAction` is unchanged. The simulator is a sibling, not a wrapper.
- No code path consumes `simulateAction` yet, Step 2 builds the renderer, Steps 3 and 4 wire it. This step is groundwork only and runs zero new code in either shell.

## [0.125.0] - 2026-04-26

Settings, drilldown refactor with state-summary rows.

The §35 Settings page used to render every section's full body inline, 16 stacked panels meant the user had to scroll past a long page and could not see *what was set* without entering each panel. Refactored into a scannable list: 4 short bodies stay inline (Appearance, Language & Region, Notifications, Contacts), 1 external drill stays as-is (Accounts & Addresses → AccountPicker), and 10 sections flip to internal drilldowns that render the section's existing component inside a Settings sub-page. Each drill row carries a short summary string showing current state on the right.

Examples of the new top-level rows:

- **This Wallet** › Main Wallet
- **Privacy** › 2 of 5 on.
- **Safety** › Auto-lock 15 min
- **Fees** › All defaults
- **Network & Endpoints** › All defaults / 2 chains custom
- **Connected Sites** › 0 sites / 3 sites
- **Automatic Donation System** › On · 12,345 sats donated
- **Developer Mode** › Off / On
- **About** › 0.125.0

### Added

- **`DrillRow`** primitive in `Settings.jsx`: title on the left, summary + chevron on the right, summary truncates with ellipsis when narrow.
- **Internal sub-page routing inside `Settings.jsx`**, a `subpageId` state renders the targeted section's existing Component inside a Screen with a "Back to settings" header. No App.jsx changes required in either shell, the routing lives entirely inside Settings.
- **Summary helpers**, `privacySummary`, `safetySummary`, `feesSummary`, `endpointsSummary`, `adsSummary`, `developerSummary`, `connectedSitesSummary`. The connected-sites count is fetched once at mount via `messaging.listConnectedSites()`.
- **`test/smoke/ui/settings-drilldown-refactor.smoke.js`**, kind splits, subpage routing primitives, DrillRow primitive shape, useSettings invocation, summary-helper semantics.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, render switch now handles three section kinds (`external-drill`, `internal-drill`, `panel`). 10 sections flip from `kind: 'panel'` to `kind: 'internal-drill'`. Drill rows render `<DrillRow>`, panels render `<PanelBlock>` with the existing section heading + description + body.
- **Affected per-section smokes**, assertions flipped from `kind:\s*'panel'` to `kind:\s*'internal-drill'`. No section-component code changes; the components are rendered unchanged inside the new sub-page wrapper.

### Behavior preserved

- Section components render with the same props they used to (Backup still receives `activeWallet`, This Wallet still receives `activeWallet` + `onOpenWalletPicker`).
- Search input still filters by title / description / keywords; the keywords for each section have been broadened slightly so common synonyms reach the right drill row.
- The 4 inline panels keep their existing inline rendering, Appearance / Language & Region / Notifications / Contacts are short enough that hiding them behind a chevron would be churn.

## [0.124.0] - 2026-04-26

Chain visibility, shared helper for the regtest-reveal rule.

The "regtest descriptors are hidden from user-facing pickers unless Developer Mode is on" rule (spec §2.2 + §48.3) was inlined inside `NetworkEndpointsSection.jsx` and `AdsSection.jsx` as a per-call predicate. Centralised into a shared `filterChainsForUser` / `isChainVisibleToUser` pair under `packages/core/src/registry/visibility.js` so every future picker / list / form picks up the same gate without restating it.

### Added

- **`packages/core/src/registry/visibility.js`**, `filterChainsForUser(descriptors, settings)` and `isChainVisibleToUser(descriptor, settings)`. Defaults to "hide regtest" when settings is null / missing the developerMode flag, so cold-start callers default to the safe branch.
- Re-exports `filterChainsForUser` + `isChainVisibleToUser` from `packages/core/src/registry/index.js`.
- **`test/smoke/core/chain-visibility.smoke.js`**, count drops by exact regtest descriptor count when developerMode is off, all chains visible when on, null-settings cold-start path defaults to hidden, single-descriptor predicate matches the bulk filter.

### Changed

- **`packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx`**, replaces the inline `developerMode || d.networkKind !== 'regtest'` filter with `registryLib.filterChainsForUser(...)`.
- **`packages/core/src/shared/components/settings/AdsSection.jsx`**, replaces the inline regtest filter with `registryLib.isChainVisibleToUser(d, settings)`.

## [0.123.0] - 2026-04-26

Settings schema v1 → v2 migration. Unlocks every "Coming soon" deferred toggle across the §35 panels.

`schemas/settings.js` `CURRENT_VERSION` bumps from 1 to 2; existing wallets migrate forward via `settingsMigrations[1]` with defaults that preserve v1 behavior. All five v1 panels stay backwards-compatible, the fresh fields default to no-ops (`'auto'` reduced motion, `false` for the new privacy toggles, `0` test-send threshold, `false` panic-mode enabled, `'off'` backup reminders).

### Added

- **Schema v2 fields:** - `reducedMotion: 'auto' | 'always' | 'never'` (Appearance override of the OS `prefers-reduced-motion` signal) - `privacy.blurOnBlur: boolean` (window-unfocus blur of mnemonic / QR / balance surfaces) - `privacy.labelsSurviveRestore: boolean` (§19.5.2 on-chain label sync opt-in; toggle persists today, FILE-action submit/fetch wiring is shell-level pending) - `grace.testSendThresholdSats: number` (large-amount confirmation gate; `0` disables) - `panicMode.enabled: boolean` (§26.5 schema slot; full duress-PIN flow lands separately) - `backupReminders: 'off' | 'monthly' | 'quarterly'` (§19.1 backup-reminder cadence)
- **`settingsMigrations[1]`** in `schemas/migrations.js`: forward-only v1 → v2 migrator with sensible per-field defaults that preserve v1 behavior.
- **`REDUCED_MOTION_MODES` + `BACKUP_REMINDER_CADENCES`** tuples exported from `schemas/settings.js`.
- **`test/smoke/core/settings-schema-v2.smoke.js`**, schema constants, `createDefaultSettings` shape, v1-record migration with default-fill on missing fields, post-migration validation, `updateSettings` round-trip on the new fields, validator rejection of bad values.

### Changed

- **`packages/core/src/shared/components/settings/AppearanceSection.jsx`**, Reduced-motion select goes live (auto / always / never). Accent-color row stays deferred pending brand cut.
- **`packages/core/src/shared/components/settings/PrivacySection.jsx`**, Blur-sensitive-on-blur and Labels-survive-restore toggles flip from disabled "Coming soon" to live.
- **`packages/core/src/shared/components/settings/SafetySection.jsx`**, Test-send warning input, Panic mode toggle, and Backup reminders cadence picker flip from disabled "Coming soon" to live.

### Migration semantics

Vault opens existing v1 records, the singleton store calls `migrateSettings`, the migrator default-fills the new fields, the validator passes, the record is rewritten on the next `vault.settings.put`. No data loss; no surprise behavior change. Per-field comparison in the smoke confirms a v1 record with `changeAddressRotation: false` survives migration as `false` (not silently flipped to the default `true`).

## [0.122.0] - 2026-04-26

Settings, drop Keyboard Shortcuts panel.

The §35 Settings tree previewed §34 keyboard shortcuts in a read-only panel at v0.120.0. Out of scope for the wallet at this point, removed entirely so the surface doesn't promise something we're not building.

### Removed

- **`packages/core/src/shared/components/settings/KeyboardShortcutsSection.jsx`** + its smoke. Settings.jsx drops the import + section literal. The `keyboard` section id is no longer in the §35.1 scaffold.

## [0.121.0] - 2026-04-26

Settings, Step 18 of 18, ADS onboarding consent during wallet creation.

Closes the §35 Settings build. CreateWallet.jsx grows a fourth stage `ads-consent` between `persisting` and the `onCreated()` callback. After the wallet record + first account + first address per active chain are persisted, the user sees a one-time consent screen presenting Enable / Decline with equal prominence (no dark pattern). Either choice writes `settings.ads.enabled` via `messaging.updateSettings` then advances; the user can flip the toggle any time in Settings → Automatic Donation System. Per spec §36.1 the screen surfaces the per-chain default amounts and notes that no donation line appears on sign screens after setup.

ADS_DEFAULT_ENABLED stays true so "Enable" is a no-op write at the data layer; "Decline" persists `ads.enabled = false` before continuing.

### Added

- **`packages/core/src/shared/routes/CreateWallet.jsx`**, new `ads-consent` stage rendered between persistence and the `onCreated` callback. Two equally-styled buttons; busy / error state co-located with the choice handler.
- **`test/smoke/ui/ads-onboarding-consent.smoke.js`**, stage-union widening, transition from persisting, both buttons wired with the right boolean, settings write via deep-merge nested `ads.enabled` patch, onCreated fired after the choice.

## [0.120.0] - 2026-04-26

Settings, Step 17 of 18, Keyboard Shortcuts panel (preview).

The §34 keyboard system is fully unbuilt per the gap audit (no global hook, no dispatch table, no rebind UI). This panel ships a read-only preview listing the planned shortcut surface (`?`, `Cmd/Ctrl+K`, `Esc`, `g h`/`g a`/`g c`/`g s`, `n s`/`n r`, `l`) so users and contributors can see the planned system without a separate docs page. Each row is labelled "not yet active" and rebind controls land when §34 ships.

### Added

- **`packages/core/src/shared/components/settings/KeyboardShortcutsSection.jsx`**, read-only shortcut catalogue with kbd-style chips.
- **`test/smoke/ui/settings-keyboard-shortcuts.smoke.js`**, table presence, expected entries, deferral copy, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, keyboard section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.119.0] - 2026-04-26

Settings, Step 16 of 18, This Wallet panel + destructive removeWallet flow.

The This-Wallet section flips from a drilldown to a panel that surfaces the active wallet's name + a "Switch / rename…" drilldown into the existing WalletPicker (which already houses rename + migrate-to-BIP39) plus a new **Remove wallet** action with a typed-name confirmation modal. Removal goes through a fresh `removeWallet` core flow that purges the wallet record + every linked descendant: accounts, addresses, signers, pendingTxs, pendingAirdrops, multisigSigningSessions, watchlistEntries. The host handler also evicts the SignerPool entry so the unlocked seed material is cleared synchronously.

Vault-level singletons (settings) and shared collections (contacts, connectedSites) survive, they aren't owned by a single wallet.

### Added

- **`packages/core/src/flows/removeWallet.js`**, destructive deletion flow. Returns a `{ removed: { wallet, accounts, addresses, signers, pendingTxs, pendingAirdrops, multisigSigningSessions, watchlistEntries } }` bookkeeping summary so callers can confirm the cleanup.
- **`SignerPool.evict(walletId)`** in `packages/core/src/signers/SignerPool.js`: locks one wallet's signer + drops it from the pool. Used by the `wallet.remove` host handler.
- **`wallet.remove` host handler** in `createBackgroundHost.js`: calls the flow + evicts the SignerPool entry.
- **`removeWallet` messaging wrappers** in popup + web.
- **`packages/core/src/shared/components/settings/ThisWalletSection.jsx`**, wallet name + Switch/rename drilldown + Remove action with typed-name confirmation modal.
- **`test/smoke/ui/settings-this-wallet.smoke.js`**, flow-level test that purges only the targeted wallet's descendants while leaving siblings intact + source-level wiring assertions for SignerPool.evict, host handler, messaging wrappers, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, this-wallet section flips from `kind: 'drill'` to `kind: 'panel'` with `Component: ThisWalletSection` and `props: { activeWallet, onOpenWalletPicker }`.

## [0.118.0] - 2026-04-26

Settings, Step 15 of 18, Contacts export / import panel.

Bulk export the address book as JSON and bulk import a contacts file. Each imported record is upserted via `messaging.saveContact({ record })` so the existing id is preserved, re-importing the same file overwrites in place rather than duplicating. Per-contact editing (add / rename / delete) stays where it already lives, in the dedicated Contacts route reached from the main menu.

### Added

- **`packages/core/src/shared/components/settings/ContactsSection.jsx`**, count display, Export action (Blob download), Import action (file picker + JSON parse + saveContact loop with skip-on-invalid).
- **`test/smoke/ui/settings-contacts.smoke.js`**, list/save calls, JSON encode/decode, file-input wiring, count pluralisation, status/error rendering, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, contacts section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.117.0] - 2026-04-26

Settings, Step 14 of 18, Connected Sites panel.

Lists ConnectedSite records sorted by `lastUsedAt` desc with origin / appName / connect / last-used timestamps. Each row expands to a permissions summary (granted chains, accounts, sign-message permission, per-action signAction map) and carries a Disconnect action that deletes the record. Per-action permission editing (toggling individual ACTIONs between allow / ask / deny) needs a narrower write handler than full record replacement; that lands in a follow-up step. List + disconnect cover the majority of value, users who want to reset a site can disconnect and re-approve.

### Added

- **`packages/core/src/shared/components/settings/ConnectedSitesSection.jsx`**, list + expandable permissions summary + disconnect.
- **`sites.list` + `sites.delete` host handlers** in `createBackgroundHost.js`.
- **`listConnectedSites` + `deleteConnectedSite` messaging wrappers** in popup + web.
- **`test/smoke/ui/settings-connected-sites.smoke.js`**, section surface, permissions fields, empty state, host wiring, messaging exports, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, connected-sites section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.116.0] - 2026-04-26

Settings, Step 13 of 18, Backup panel.

Wires the §19.4 encrypted backup-file flow up through to the user. Click "Export…", enter a backup password (separate from the wallet-unlock password) twice for mismatch detection, the renderer downloads the encrypted JSON envelope as `<walletName>-YYYY-MM-DD.xchain-wallet`. Three additional spec items render as deferred rows: seed-phrase reveal (needs a new `wallet.revealSeed` flow), test-backup / dry-run restore (needs its own multi-step UI for `dryRunRestore`), published labels (§19.5.2 FILE-action transport).

### Added

- **`packages/core/src/shared/components/settings/BackupSection.jsx`**, export action with two-pass password prompt + Blob-download trigger; three deferred rows for seed phrase, dry-run restore, published labels.
- **`wallet.exportBackup` host handler** in `createBackgroundHost.js` calling `flows.exportBackupFile`. Web shell shares via `hostBridge.js`.
- **`exportBackupFile()` messaging wrappers** in popup + web messaging modules.
- **`test/smoke/ui/settings-backup.smoke.js`**, section surface, host wiring, messaging wrappers, Settings.jsx render-switch panel-props plumbing.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, render switch now passes a `section.props` bag through to panel components (`<Component {...panelProps} />`). Backup section uses this to receive `activeWallet`. Backup section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.115.0] - 2026-04-26

Settings, Step 12 of 18, Automatic Donation System panel.

The headline panel for the §35 build per spec §36. Master ON/OFF + per-chain block (per-tx amount in sats, trigger threshold, donation address shown for verification, lifetime stats: donated total, tx count, accumulated). Per-chain inputs disable when ADS is off so the user can't poke them mid-disable. Regtest chain blocks hide unless Developer Mode is on.

The donation-address row honestly surfaces the `PLACEHOLDER_REPLACE_BEFORE_MAINNET` sentinel state, descriptors carrying the placeholder render `Pending, real <chain> donation address ships before mainnet GA` instead of pretending the sentinel is a real address.

### Added

- **`packages/core/src/shared/components/settings/AdsSection.jsx`**, master toggle + per-chain block editor. Writes use the deep-merge nested form for both `ads.enabled` and `ads.perChain[chainId]` patches.
- **`test/smoke/ui/settings-ads.smoke.js`**, useSettings + placeholder import, toggle wiring, per-chain numeric edit shape, lifetime stat rendering, placeholder-vs-real branch, regtest gating, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, ads section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.114.0] - 2026-04-26

Settings, Step 11 of 18, Developer Mode panel + regtest reveal in Network & Endpoints.

Two live toggles (`developerMode`, `learnMode`) plus four deferred reveals (custom chain registry, raw PSBT inspector, auto-approve localhost, logs console) covering spec §48. The Developer Mode toggle now gates regtest visibility in the Network & Endpoints panel, when off, regtest descriptors are filtered out; when on, they appear with their localhost defaults pre-populated. Broader picker filtering (Send / Receive / Swap chain pickers across the app) lands in a follow-up step.

### Added

- **`packages/core/src/shared/components/settings/DeveloperModeSection.jsx`**, two live toggles + four "coming soon" deferred reveals.
- **`packages/core/src/shared/hooks/useDeveloperMode.js`**, convenience accessor returning `{ developerMode, ready, error }` from useSettings. Defaults to `false` while loading or unavailable so feature gates default to the hidden branch.
- **`test/smoke/ui/settings-developer-mode.smoke.js`**, panel surface, regtest filter in NetworkEndpointsSection, hook contract, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx`**, descriptors filtered through `developerMode || d.networkKind !== 'regtest'` so regtest rows are hidden by default.
- **`packages/core/src/shared/routes/Settings.jsx`**, developer section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.113.0] - 2026-04-26

Settings, Step 10 of 18, Network & Endpoints panel.

Per-chain Explorer / Encoder / Hub URL editor backed by `settings.sdkEndpoints`. One block per registered chain (sorted coin → mainnet/testnet/regtest); each block carries the three URL inputs with the registry defaults as placeholders, a "Custom" / "Default" indicator, a "Save" button that commits a dirty buffer, and a "Reset to default" button that wipes the override. The schema's `custom` flag is computed automatically, set when the saved values diverge from defaults, cleared when they match, so the §49 reachability banner and any future hub-driven endpoint refresh have an honest signal.

### Added

- **`packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx`**, iterates `chainRegistry.supportedChains()`, draft-buffer per chain, dirty-detect against current persisted entry, computed `custom` flag.
- **`test/smoke/ui/settings-network-endpoints.smoke.js`**, useSettings + chain-registry imports, `supportedChains()` iteration, sort order, three URL labels, save/reset wiring, computed-custom flag, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, network-endpoints section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.112.0] - 2026-04-26

Settings, Step 9 of 18, Fees panel.

Per-chain fee profile editor backed by `settings.fees`. One block per chain entry the `seedSettingsForChains` flow has populated; each block carries a strategy picker (low / normal / fast / custom matching the schema's `FEE_STRATEGIES` tuple), a custom sats-per-KB number input that surfaces only when strategy=custom, and an RBF-by-default toggle that disables itself when the chain descriptor's `feeStrategy.rbfSupported` is false.

### Added

- **`packages/core/src/shared/components/settings/FeesSection.jsx`**, chain-keyed iteration over `settings.fees`. Writes use the deep-merge nested form `update({ fees: { [chainId]: patch } })`. Pulls chain display names + RBF support from `chainRegistry.get(chainId)`.
- **`test/smoke/ui/settings-fees.smoke.js`**, useSettings + chain-registry import, write path shape, strategy coverage matches `FEE_STRATEGIES`, custom-rate input gated on `strategy === 'custom'`, RBF toggle gated on `descriptor.feeStrategy.rbfSupported`, empty-state copy, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, fees section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.111.0] - 2026-04-26

Settings, Step 8 of 18, Notifications panel.

Five toggles backed by `settings.notifications.*` (txConfirmations, incomingReceipts, dispenserFills, orderFills, priceAlerts). Owns user preference only; the §46 delivery layer (browser Notification API, extension service-worker, OS toast on desktop) is a separate concern.

### Added

- **`packages/core/src/shared/components/settings/NotificationsSection.jsx`**, five toggles via shared `ToggleRow`. Writes use the deep-merge nested form: `update({ notifications: { [key]: next } })`.
- **`test/smoke/ui/settings-notifications.smoke.js`**, useSettings wiring, every schema notification flag has a corresponding `NOTIFICATION_FLAGS` entry, write path, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, notifications section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.110.0] - 2026-04-26

Settings, Step 7 of 18, Safety panel.

Live: auto-lock timeout (`settings.autolockMinutes`) and undo-send grace (`settings.grace.undoSendSeconds`). Both pickers carry curated common values plus a fallback "(custom)" option preserving any out-of-list value the schema currently holds. Three deferred toggle rows surface the spec's remaining safety items: test-send warning, panic mode, backup reminders. All three need schema migrations + flow wiring; panic mode is also called out as fully unbuilt in the gap audit.

### Added

- **`packages/core/src/shared/components/settings/SafetySection.jsx`**, auto-lock + undo-send selects + three deferred toggles.
- **`test/smoke/ui/settings-safety.smoke.js`**, useSettings wiring, write paths (top-level scalar + nested grace patch), option coverage, deferred-row presence, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, safety section flips from `kind: 'stub'` to `kind: 'panel'`.

## [0.109.0] - 2026-04-26

Settings, Step 6 of 18, Privacy panel.

Three live toggles for the `privacy.*` flags already on the v1 schema (Tor routing, change-address rotation, hide small balances). Two additional spec §35.1 rows ship as disabled deferral rows: blur-sensitive-on-blur and labels-survive-restore, both need a schema migration before they go live.

### Added

- **`packages/core/src/shared/components/settings/PrivacySection.jsx`**, three toggles + two deferred rows. Writes use the deep-merge nested-object form: `update({ privacy: { [field]: next } })`.
- **`packages/core/src/shared/components/settings/_settingsPrimitives.jsx`**, shared layout helpers (`ROW`, `STACK`, `ROW_HINT`, `SELECT`, `INPUT`, `ToggleRow`, `Status`) extracted out of the per-section files. Reused across PrivacySection now and by every panel after it.
- **`test/smoke/ui/settings-privacy.smoke.js`**, useSettings wiring, three live toggles map to the schema fields, two deferred rows are disabled with "Coming soon" hints, primitives module exports the expected surface, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, privacy section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: PrivacySection`.

## [0.108.0] - 2026-04-26

Settings, Step 5 of 18, Language & Region panel.

Language picker (English-only at the moment; spec §54 i18n adds locales over time as new dictionaries land under `packages/core/src/i18n/`) and fiat-currency picker. Currency picker offers a curated 12-entry shortlist plus a "Custom…" option that types an arbitrary ISO code into the persisted record, the schema accepts any non-empty string.

### Added

- **`packages/core/src/shared/components/settings/LanguageRegionSection.jsx`**, language `<select>` + currency `<select>` with custom-code input. Both writes go through `useSettings().update`.
- **`test/smoke/ui/settings-language-region.smoke.js`**, wiring, picker contents, custom-code path, status fallbacks, Settings.jsx hook-up.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, language-region section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: LanguageRegionSection`.

## [0.107.0] - 2026-04-26

Settings, Step 4 of 18, Appearance panel.

First write-capable §35.1 panel. Theme picker (system / light / dark) wired through `useSettings()` → `messaging.updateSettings({ theme })` → core `updateSettings` flow → `vault.settings.put`. Reduced-motion override and accent-color rows render as muted deferral copy until the schema migration / brand cut land.

### Added

- **`packages/core/src/shared/components/settings/AppearanceSection.jsx`**, Theme `<select>` reading the schema's `THEMES` tuple. Loading / error / write-failure states all render inside the section without disturbing the rest of the page.
- **`test/smoke/ui/settings-appearance.smoke.js`**, useSettings wiring, THEME_OPTIONS covers the schema's exact `THEMES` tuple, write path goes through `update({ theme })`, deferral copy present for the two not-yet-shipped rows, Settings.jsx flips appearance from stub to panel.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, appearance section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: AppearanceSection`.

## [0.106.0] - 2026-04-26

Settings, Step 3 of 18, About panel.

First read-only panel filling in the §35.1 Settings tree. Surfaces wallet version, update channel, license, reproducible-build doc, release-signatures doc, and disclosure-policy doc as labelled rows. Items whose underlying artifact is not yet published (SECURITY.md per the gap audit; release signatures pre-GA) render a muted "not yet published" hint instead of an inert link.

### Added

- **`packages/core/src/buildInfo.js`**, single source of truth for build-time wallet metadata: `WALLET_VERSION`, `LICENSE_NAME`, `LICENSE_FILE`, `NOTICE_FILE`, `SECURITY_FILE` + `SECURITY_PUBLISHED`, `REPRODUCIBLE_BUILD_DOC`, `RELEASE_SIGNATURES_DOC` + `RELEASE_SIGNATURES_PUBLISHED`, `UPDATE_CHANNEL`. Bumped alongside every wallet version per the synchronized-versioning rule.
- **`packages/core/src/shared/components/settings/AboutSection.jsx`**, renders the seven About rows from `buildInfo.js`. Read-only; no host roundtrip.
- **`test/smoke/ui/settings-about.smoke.js`**, buildInfo exports the expected constants, `WALLET_VERSION` matches `core/package.json`, AboutSection renders the seven labelled rows with the publish-gate fallbacks, Settings.jsx wires AboutSection as the `about` panel and the render switch handles the new `panel` kind.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`**, render switch now handles a third section kind, `panel`, in addition to `drill` and `stub`. The `about` section flips from `kind: 'stub'` to `kind: 'panel'` with `Component: AboutSection`.

## [0.105.0] - 2026-04-26

Settings, Step 1 + 2 of 18, Substrate + sectioned page scaffold.

First two steps of the §35 Settings build. The wallet ships with the data schema for every setting (theme, autolock, language, fees, sdkEndpoints, privacy, ads, notifications, developerMode, learnMode, grace) but the Settings route only surfaces Wallet + Account drilldowns; this release lays down the read/write substrate and the long-page section layout the rest of the build will fill in. No editable panels yet, those start at v0.106.0.

### Added

- **`getSettings(vault)` + `updateSettings(vault, patch)` flows** at `packages/core/src/flows/settings.js`. `updateSettings` does a deep merge: top-level scalars replace, nested plain objects merge one level, chain-keyed records (`sdkEndpoints` / `fees` / `ads.perChain`) merge by key, then validates against `validateSettings` before persisting. Invalid patches throw and the on-disk record stays untouched.
- **`settings.get` + `settings.update` host handlers** registered in `createBackgroundHost.js`. Web shell reuses the same host via `hostBridge.js`: one registration covers both shells.
- **`getSettings()` + `updateSettings(patch)` messaging wrappers** in `packages/web/src/messaging.js` and `packages/extension/src/popup/messaging.js`.
- **`useSettings()` React hook** at `packages/core/src/shared/hooks/useSettings.js`: returns `{ settings, loading, error, refresh, update }`. Degrades to an `error` state (rather than throwing at render time) when a shell hasn't wired the messaging methods yet.
- **`test/smoke/core/settings-flow.smoke.js`**, substrate behaviour: empty-vault default fallback, scalar replacement, nested merge, chain-keyed merge by key, validation rejection of bad values, source-level checks that messaging modules export the helpers and the host registers the handlers.
- **`test/smoke/ui/settings-scaffold.smoke.js`**, all 16 §35.1 sections present in spec order, search input wired, drilldowns preserved, ComingSoon placeholder rendered for stub sections.

### Changed

- **`packages/core/src/shared/routes/Settings.jsx`** rebuilt as the §35.1 long-page scaffold. The previous 2-section layout (Wallet + Account drilldowns) is preserved and renamed in spec order to **This Wallet** + **Accounts & Addresses**. 14 stub sections added below them: Appearance, Language & Region, Privacy, Safety, Backup, Fees, Network & Endpoints, Notifications, Connected Sites, Contacts, Automatic Donation System, Keyboard Shortcuts, Developer Mode, About. Each stub renders a section heading + description + a `Coming soon` placeholder body. A non-functional search input at the top filters sections by title / description / keyword strings, wiring is live; the consumed surface is just the scaffold for now.

## [0.104.0] - 2026-04-26

Multi-wallet / multi-account substrate, navigation rework, and a quieter chrome.

### Added

- **Multi-wallet, multi-account vault.** A vault can now hold multiple `Wallet` records, each with multiple BIP44 `Account` records. New `flows/createAccount.js` derives the next free index + a first address per active chain. `wallet.add.import` MessageHost handler unlocks new wallets into the SignerPool; `wallet.rename` updates a Wallet's display name; `account.list` / `account.create` round-trip per-wallet account state.
- **`SignerPool`** in `packages/core/src/signers/SignerPool.js`: keeps unlocked SoftwareSigners in memory for the lifetime of an unlocked session. Populated at `wallet.unlock` while the password is in scope; lets `account.create` (and other HD-derive ops) reuse pre-unlocked signers without prompting again. Locked + cleared on `wallet.lock` and tear-down.
- **Per-account scoping** for balances and addresses. `walletBalances` / `addressesByChain` / `newestAddress` host helpers and `receiveAddress` flow now accept an optional `accountId`; Home / Receive / AddressList / History pass the active account through. App-level `activeAccountId` state replaces Home's local copy so route props stay in sync across navigation.
- **Wallet picker / Account picker / Settings routes.** Compact summary rows in the gear-popover replaced by full-screen pickers reachable from Settings → Wallet / Account. Each row in the wallet picker carries an outlined info button that opens **Wallet Details** (read-only metadata: name, type, origin, 25th-word state, account count, created-at) with a primary "Rename wallet" action and a "Migrate to BIP39" action for FreeWallet-legacy entries.
- **`AddAccountForm` route**, no password prompt; reuses the SignerPool entry for the active wallet and persists Account #N+1 with auto-named default ("Account 2", "Account 3", …).
- **`RenameWalletForm` route**, name input only; Save lives in the header's right-side icon slot (matches the picker chrome).
- **Header `Settings` entry + `Settings` route.** Gear icon moved out of the header into the pancake menu under a Settings row. The route surfaces Wallet + Account summary rows that drill into the pickers.
- **Header network-filter button.** Filter icon next to the menu in the popup header opens a popover that lists every coin family directly, one click to open, one to pick. Accent dot indicates a non-`all` filter is active.
- **Home quick-action row.** Send / Receive / Swap / Buy as four equal-width tiles between the total-balance hero and the tab strip. Outlined in the accent color, circular icon badges, hover swaps the background only.
- **Activity tab** moved to the rightmost position in `HomeTabs`.

### Changed

- **Main menu reorganized**, collapsed ~25 mixed entries into a flat list of true app sections: Markets, Tokens (→ ActionsMenu), Messaging, Cross-chain (→ CrossChainTemplates), Contacts, Addresses, Contracts, Staking, Multisig, Settings. Send / Receive / Swap / Buy and the per-token sub-actions are gone from the menu, the quick-action row covers Send/Receive, the rest live behind their grouped entry.
- **Back-button standardisation.** Every form's footer "Cancel" / "Back" button removed across 47 routes (~85 buttons). Single `<` icon in each route's header is now the only back affordance. Routes without a header (Onboarding / CreateWallet / ImportWallet) now render a back-arrow header when reachable from the unlocked add-wallet flow; Onboarding's back returns to the wallet picker rather than home.
- **Locked screen**, dropped the "XChain Wallet" heading and "Wallet locked." subtitle. Logo + password input + "Unlock Wallet" button is the whole surface.
- **Onboarding & FreeWallet legacy flows.** CreateWallet and ImportWallet take a `mode` prop (`'fresh' | 'add'`). Fresh-install uses the pre-host `wallet.import` (asserts an empty vault); add-mode uses the new host-side `wallet.add.import` against the open vault.
- **DevVariantBadge** repositioned from `right: 12px` to `left: 12px` so it stops overlapping the menu items on the right edge of the popup.

### Removed

- The flat token-action `extraActions` list in the pancake menu, those entries reach via the new "Tokens" entry which navigates to the existing ActionsMenu route.
- Legacy `Cancel` / `Back` form footers across the route layer.
- "Tap to switch…" subtitles under the Wallet / Account rows in Settings, replaced with a `›` chevron on the right.

## [0.103.0] - 2026-04-25

Major iteration session. Wallet was effectively never built or run before this, package.json deps were declared but `pnpm install` had not been run since v0.12.0, no `vitest` invocation had ever rendered a component, and several runtime paths (Web Crypto, getUserMedia, Clipboard API) were broken on the LAN-host HTTP origin the user actually loads from. This release brings the project from "code-complete spec on disk" to "actually runs in a browser, has a deep test substrate, and has a coherent design language."

Version demoted from `1.0.0-rc.6` → `0.102.0` (then bumped here to `0.103.0`) because the RC label implied production-readiness the codebase did not have.

### Added

- **Whole-wallet test substrate at `xchain-wallet/test/`** matching the per-component layout used across every other XChain Platform service. 13 distinct test types: `unit/`, `smoke/`, `integration/`, `boundary/`, `chaos/`, `fuzz/`, `regression/`, `security/`, `benchmarks/`, `mutation/`, `a11y/`, `e2e/`, plus playwright reorganized under `e2e/`. Per-type `vitest.config.<type>.js` at the wallet root. Per-type `setup.js` + `README.md` documenting scope + run cmd + conventions. New `pnpm test:<type>` scripts.

- **Deep crypto coverage** across `packages/core/src/crypto/`. ~80 new tests spanning unit (per-module), integration (kdf↔aead↔walletBlob, mnemonic→hd, backup roundtrip), boundary (kdf params, hd paths, aead size limits), chaos (backup tamper across 4 vectors), fuzz (aead/wif/mnemonic round-trip properties), security (10K-iteration nonce uniqueness, backup tamper resistance), benchmarks (kdf at floor + 2× tiers, hd derive, aead per size). Stryker mutation config scoped to crypto + util.

- **Auto-icon `<Button>`**, single-source label-to-icon resolver (`iconForLabel`) shared by Button + HeaderActionMenu. 40+ pattern bucket coverage. Buttons that pass an explicit `icon` prop keep theirs; static-string labels auto-iconify; opt-out via `icon={null}`.

- **20-icon set** at `packages/core/src/ui/icons/`: hand-rolled inline SVGs (no icon-library dep) for Send, Receive, Sign, Broadcast, Lock, Unlock, Stake, Swap, Markets, Message, History, Address, Contract, Home, Settings, More, Back, Forward, Plus, Check, X, Trash, Pencil, Refresh, Copy, Paste, Scan, Search, Filter, Eye, EyeOff, Link, Unlink, USB, Download, Upload, Pause, Play, Migrate, Token, Multisig, Info, ExternalLink, Menu (pancake).

- **`<ChainPicker>` primitive**, single-select dropdown with chain icon + display name + ticker · network suffix. Searchable when option count > 6. Replaces native `<select>` for chain selection across 16 forms (Send, Swap, Compose, Broadcast, TokenAdmin, Destroy, Mint, IssueToken, TokenWizard, Multisig, Dividend, Dispenser, DeployContract, Link, Airdrop, AdvancedActions).

- **`<NetworkFilter>` dropdown** on Home, replaces the All/BTC/LTC/DOGE chip row with one searchable picker that scales to N coin families.

- **`<UnifiedBalanceList>`**, single list of every balance across every chain (Coins section + Tokens section), each row with an avatar + chain-icon overlay + name + ticker subtitle + quantity + fiat value.

- **`<HeaderActionMenu>`** (pancake drawer) for the `small` variant, full-overlay slide-in with two sections (Wallet primary nav + §40+ Actions), Alerts entry with count badge, Lock-wallet block at bottom.

- **`<AlertsOverlay>`**, alerts panel surfaced from the pancake. Severity-railed (info/warning/critical). First inhabitant: legacy FreeWallet-format → migrate. Replaces the inline legacy-banner in Home body.

- **Variant switcher (`small` ↔ `full`)** driven by viewport width with 640px threshold. URL/`localStorage` overrides. Floating dev badge bottom-right showing variant + source + viewport px + flip controls. Forced-small rendering inside a centered 375×600 frame so designers see the popup the way users will.

- **Session-scoped password cache** (`sessionStorage`), `unlockWallet` saves the password; `lockWallet` and tab-close clear it; auto-unlock on App boot when the cache is populated. Web shell only.

- **Dev fake balances + 40 tokens** at `packages/web/src/devFakeBalances.js`: populates the dev-mock SDK with 50 BTC, 30 LTC, 100k DOGE, plus 40 distinct tokens distributed by chain personality. Each token carries an asset+display+description+quantity+divisibility+fiatRate. Lets the UI render realistic balance data without a configured explorer.

- **`@vitejs/plugin-basic-ssl`**, opt-in HTTPS for the web shell via `VITE_HTTPS=1`. Self-signed cert. Useful for testing hardware-signer flows from a non-localhost origin.

- **`@noble/ciphers`** dependency at the core package level. Backs the rewritten AEAD.

- **`fast-check` + `axe-core`** dev dependencies for the fuzz + a11y-runtime suites.

- **`packages/web/public/favicon.png`**, wired from the brand asset; web shell's `index.html` now references it. Closes the persistent 404.

- **Reduced-motion support on `<AnimatedQrFrames>`**, when `prefers-reduced-motion: reduce`, the auto-advance interval suspends and Prev/Next manual controls render. Cadence label flips to "manual".

### Changed

- **`packages/core/src/crypto/aead.js`**, replaced Web Crypto API (`crypto.subtle.importKey/encrypt/decrypt`) with pure-JS `gcm()` from `@noble/ciphers/aes`. SubtleCrypto is gated on a secure context (HTTPS or `localhost`); the previous implementation crashed onboarding under any LAN-host HTTP origin with `Cannot read properties of undefined (reading 'importKey')`. Wire format unchanged (12-byte IV ‖ ciphertext ‖ 16-byte tag) so existing vaults decrypt cleanly under the new code path.

- **`packages/core/src/signers/LedgerSigner.js`**, replaced `crypto.subtle.digest('SHA-256', ...)` with `sha256()` from `@noble/hashes/sha2`. Same secure-context fix.

- **`packages/core/src/util/uuid.js`** (new), `randomUUID()` polyfill that uses `crypto.randomUUID` when available and falls back to a `crypto.getRandomValues`-based UUIDv4. Replaces 12 schema files' direct `crypto.randomUUID()` calls (account, address, connectedSite, contact, migrations, multisigConfig, multisigSigningSession, pendingAirdrop, pendingTx, signer, wallet, watchlistEntry).

- **`packages/extension/manifest.json`**, `version` rolled back to plain semver `0.103.0`; `version_name` ships the human-readable string. Earlier RC-style versioning carried forward via `deriveExtensionVersion`.

- **Test directory layout**, `packages/core/test/` → `xchain-wallet/test/` at the workspace root, matching the per-component pattern across the platform. 95 files moved, 119 import-path rewrites, 81 `wsRoot` path-computation rewrites. `vitest.config.js` moved to root, smoke runner `cwd` adjusted, root `package.json` gained `"type": "module"` so smokes parse as ESM.

- **`<Screen>` layout**, `--xc-screen-h` custom property for parent-driven sizing (defaults to `100dvh` with `100vh` fallback). `overflow: hidden` on `.screen` so the body's `overflow-y: auto` becomes the only scrollable region, sticky header on every variant. `popup` variant renamed to `small`.

- **Onboarding labels**, "Create a new wallet" → "Create new wallet"; "I already have a wallet" → "Import wallet"; "Coming from FreeWallet" → "From FreeWallet". All buttons gained icons.

- **`<CopyButton>`**, multi-tier clipboard write (modern API → legacy `execCommand('copy')` textarea fallback) so plain-HTTP origins still copy. State machine: idle → copied → failed → idle. Visible "Copy failed" state instead of silent no-op.

- **Button system**, `white-space: nowrap` baseline, every variant uses `#FFFFFF` text on coloured fills (no `var(--xc-text-inverted)` which inverted to black in dark mode).

- **Error display**, moved from below the second password field on `<ImportWallet>` to a top-of-form red alert box. White text on saturated red with WCAG-AA contrast. `text-align: center`, `font-weight: 500`. Same treatment applied to `<CreateWallet>`.

- **Why-migrate paragraphs** in `<MigrateToBip39>`: switched from centered/muted to justified body copy with full-contrast text + 1.55 line-height. Buttons gained Back/Migrate icons.

- **Home header**, brand block (logo + "XChain Wallet" + optional wallet-name subtitle when it differs from the product name) replaces the previous wallet-name-only title.

- **`packages/web/vite.config.js`**, `host: '0.0.0.0'` so a remote dev host can reach the dev server. `allowedHosts: ['localhost', '127.0.0.1']` to bypass Vite 5's host check.

- **`packages/extension/package.json`** + **`packages/web/package.json`**, `xchain-sdk` switched from `^1.13.0` (npm, only published 1.2.5 available) to `link:../../../xchain-sdk` (sibling repo).

- **Dev-mock SDK** in `packages/web/src/hostBridge.js`: proxied `get*` lookup that returns empty arrays by default and overrides `getBalances` to return the realistic dev fake-balance dataset. Constructor receives the per-chain `network` opt so balances are chain-appropriate.

- **`pnpm-workspace.yaml`**, `e2e` workspace renamed to `test/e2e`.

- **`.npmrc`** added: `shamefully-hoist=true`. Required because `vite-plugin-node-polyfills` injects shim imports into bundled core code that pnpm's strict layout couldn't resolve.

### Removed

- `packages/web/dist/`, `packages/extension/dist/`: no longer in tree (rebuild via `pnpm -C packages/<shell> build`).
- Old `e2e/` workspace root, moved to `test/e2e/`.
- `packages/core/vitest.config.js`: moved to wallet-root `vitest.config.js`.
- `packages/web/src/devPasswordCache.js`: replaced by `sessionPasswordCache.js` (no longer dev-gated).

### Decided

- **Crypto layer is pure-JS, not Web Crypto.** Web Crypto's secure-context gate is incompatible with self-hosted wallet deployment patterns (LAN HTTP, mobile Safari sometimes, IPv4 internal). `@noble/ciphers` + `@noble/hashes` cover everything we need; perf is comparable to SubtleCrypto at our payload sizes (verified in benchmarks).

- **`small` variant covers Chrome extension popup, mobile browsers, and any narrow container.** Single design serves every constrained-width context. `full` covers everything else. Detection is viewport-width-driven (640px threshold), not shell-driven.

- **Pancake menu in `small` is the SOLE navigation surface.** No "More actions" link to a list-in-main-view, main view is for doing work, pancake is for navigation. Drops a class of confusion where users land on a menu route and don't realize they need to go back.

- **Test directory at workspace root, not per-package.** Matches every other XChain Platform component's convention. Cross-package test types (integration, e2e) need a workspace-level home.

### Notes

- 11 pre-existing UI test failures in `unit/ui/Button.test.jsx` / `Input.test.jsx` / `CopyButton.test.jsx` and 1 decoder string-mismatch are stale assertions from this session's design iteration. They need their expectations refreshed; tracked separately.
- 21 pre-existing smoke failures (out of 92) are also stale assertions (label changes, `link:` xchain-sdk pin, `ChainBalanceCard` → `UnifiedBalanceList` swap), same family of cleanup.
- Suite-level pass rates as of this commit: integration 25/25, boundary 49/49, chaos 16/16, fuzz 10/10, security 15/15, regression 4/4, a11y 8/8, unit 171/182. Benchmarks live (`pnpm test:bench`).

## [1.0.0-rc.6] - 2026-04-24

§56.3 Pre-launch, user-initiated track, Step 5 of 5, accessibility audit readiness packet. Closes the autonomous portion of the user-initiated track. Pure-documentation slice; the user (Dankest, LLC) hands the packet to an external accessibility-audit vendor when they're ready to engage.

### Added

- `claude/reports/specs/2026-04-24_a11y-audit-readiness.md` (in the platform repo, gitignored), readiness packet.

### Decided

- **WCAG 2.2 AA target.** 2.1 AA is the legacy baseline most U.S. compliance tools test against; 2.2 AA is the current standard and includes new criteria that matter for crypto-wallet UX (e.g., 2.5.7 Dragging Movements, relevant for QR-frame stepping; 3.3.7 Redundant Entry, relevant for multisig participant-list re-entry across sessions). Targeting 2.2 AA up front avoids re-auditing in 2027.
- **Per-criterion pass/fail in the deliverable.** Lets the GA release notes claim "WCAG 2.2 AA conformant per [vendor], dated [DATE]", material to potential institutional users who require an accessibility statement before adopting.
- **Pre-launch user-initiated track CLOSED at this commit (autonomous portion).** Three items remain that only the user can drive: external security audit engagement (packet ready at v1.0.0-rc.5), external accessibility audit engagement (packet ready at this rc.6), Chrome Web Store submission (manifest hardened at rc.2, privacy policy + checklist drafted at rc.3). Plus the byte-for-byte run-twice repro-build verification on a clean dev machine at GA cut.

### Notes

- xchain-sdk pin stays at `^1.13.0`. No source changes; documentation + version bump only.
- 92 smokes pass.
- Pre-launch user-initiated autonomous portion CLOSED at v1.0.0-rc.6. See `claude/reports/specs/2026-04-24_prelaunch-userinit-close.md` for the track-level retrospective (separate commit if needed; otherwise this CHANGELOG entry is the close marker).

## [1.0.0-rc.5] - 2026-04-24

§56.3 Pre-launch, user-initiated track, Step 4 of 5, security audit readiness packet. Pure-documentation slice that packages everything an external audit vendor needs to scope, build, and execute the engagement.

### Added

- `claude/reports/specs/2026-04-24_security-audit-readiness.md` (in the platform repo, gitignored), readiness packet.

### Decided

- **Single-vendor coverage of all three layers.** The boundary handoffs (key material → signer → IPC → user-confirmation surface) are where wallets get exploited; auditing them as separate engagements risks each vendor assuming the boundary is the other one's problem. We pay once for end-to-end coverage.
- **Reduced-motion item explicitly out of audit scope.** The fix shipped at v1.0.0-rc.4; calling it out in the packet so the vendor doesn't burn hours wondering whether it's a regression.

### Notes

- xchain-sdk pin stays at `^1.13.0`. No source changes; documentation + version bump only.
- 92 smokes pass.

## [1.0.0-rc.4] - 2026-04-24

§56.3 Pre-launch, user-initiated track, Step 3 of 5, `prefers-reduced-motion` on `AnimatedQrFrames`. Closes the deferred a11y polish item recorded in `claude/reports/specs/2026-04-24_prelaunch-close.md` § "Things deferred from autonomous work", previously queued for the external a11y audit; the fix is autonomously tractable and the audit gets a cleaner starting point.

### Changed

- `packages/core/src/ui/AnimatedQrFrames.jsx`: when the user has `prefers-reduced-motion: reduce` set at the OS level, the auto-advance interval is suspended and Prev / Next buttons render below the QR for manual stepping. The cadence label flips from `3 fps` to `manual`. The wrapper's `aria-label` is augmented with `; advance manually`. A new `data-reduced-motion` attribute is exposed for downstream styling/tests. The change is observed via `window.matchMedia('(prefers-reduced-motion: reduce)')` with both modern (`addEventListener`) and Safari-<14 (`addListener`) listener wiring; the preference can flip mid-session and the component reacts. Single-frame inputs continue to render statically (no controls needed).

### Added

- `packages/core/test/animated-qr-reduced-motion.smoke.js`: eight static-text checks over the component source: matchMedia subscription, useState hook, change-listener wiring with Safari fallback, interval suspension on `reducedMotion`, gated prev/next rendering, button aria-labels, cadence label flip, wrapper aria-label augmentation, `data-reduced-motion` attribute. Bumps the smoke count to 92.

### Decided

- **Manual stepping over a frozen first frame.** `prefers-reduced-motion` could be honored by simply pinning the QR to frame 1 and showing nothing else, but multi-frame PSBT QRs (used for §22.3 multisig PSBT-QR cosigner round-trips and §20.3 chunked PSBT transport) are non-functional if you can't reach frames 2…N. Manual prev/next preserves the function while removing the motion. Alternative considered (slow the auto-advance to ~0.5 fps) was rejected, vestibular-trigger users still perceive the motion at any auto-advance rate, and "no motion" is the documented intent of the media-query value.

### Notes

- xchain-sdk pin stays at `^1.13.0`. UI-package change only.
- 92 smokes pass.

## [1.0.0-rc.3] - 2026-04-24

§56.3 Pre-launch, user-initiated track, Step 2 of 5, Chrome Web Store privacy policy + submission checklist. Pure documentation slice; the user (Dankest, LLC) is the only one who can host the policy URL and file the CWS submission, so this step packages everything they'll need into one place.

### Added

- `packages/extension/PRIVACY_POLICY.md`: public-facing privacy policy. Covers what's stored on-device (encrypted wallet material via Argon2id-derived key, addresses, contacts, dApp grants, queued PSBTs), what leaves the device (only user-configured RPC endpoints + optional vendor hardware-bridge calls), permissions justifications, the camera-scanner flow's `getUserMedia` runtime prompt, the absence of analytics / advertising / crash-reporting SDKs, the absence of Google API integration, and the CWS-mandated single-purpose + limited-use disclosures. Authored to be hosted as-is on a public URL, GitHub Pages from this repo or `https://dankest.llc/xchain-wallet/privacy` are both acceptable; the submission checklist documents the recommended setup.

- `claude/reports/specs/2026-04-24_cws-submission.md` (in the platform repo, gitignored), submission playbook. Sections: build artifact + zip procedure, listing copy with verbatim strings, screenshot dimensions + capture procedure for the five required surfaces (Home, Send, Sign-screen, Multisig Receive, Settings → Security), promo tile spec, privacy practices form answers, common rejection reasons + dry-run greps, single-purpose statement to paste, pre-submission smoke + audit run, post-approval automation roadmap, Edge / Firefox variants. Designed so the submitter can work top-to-bottom without referring back to CWS docs.

### Decided

- **Privacy policy lives in the extension package.** Putting it at `packages/extension/PRIVACY_POLICY.md` keeps it discoverable next to the manifest it disclaims, and lets GitHub Pages serve the same file as both source and listing URL. Alternative considered (host only on dankest.llc) was rejected because the GitHub-hosted copy provides a permanent record tied to a specific git revision, useful when CWS asks "show the policy that was active at the time the v1.0.4 update was published".

- **Submission checklist gitignored in the platform repo.** Per existing convention (`claude/reports/` is gitignored). The checklist points at concrete file paths and rule numbers in the wallet repo, so it stays useful as a private working doc; the user-facing parts (privacy policy, listing copy templates) live in the wallet repo where the public can read them.

### Notes

- xchain-sdk pin stays at `^1.13.0`. No source changes; documentation + version bump only.
- 91 smokes pass.

## [1.0.0-rc.2] - 2026-04-24

§56.3 Pre-launch, user-initiated track, Step 1 of 5, Chrome Web Store manifest hardening. First pre-GA slice of the Chrome Web Store submission track.

### Added

- `packages/core/scripts/derive-extension-version.js`: maps wallet semver → Chrome-manifest `version` tuple. Chrome requires 1–4 dot-separated integers 0–65535; wallet RC tags like `1.0.0-rc.1` are rejected. Rule: stable `M.m.p` → `M.m.p`; prerelease `M.m.p-rc.N` → `0.M.m.N`. The leading `0` pins every prerelease strictly below every stable tuple with M≥1, so the CWS upgrade ordering stays monotonic across the RC → GA cut.

- `packages/core/scripts/extension-manifest-audit.js`: 11-rule static audit: MV3 set; `version` CWS-valid; `version` equals `deriveExtensionVersion(root.version)`; `version_name` mirrors `root.version`; `packages/extension/package.json` version matches `root.version`; `description` present and ≤132 chars; `homepage_url` set; 128-px icon present; action toolbar icon set; `content_scripts` entries well-formed; no broad host_permissions (`<all_urls>` / `*://*/*`) without recorded justification. Exits 0 on a clean tree, exits 1 with a per-rule failure report otherwise.

- `packages/core/test/extension-manifest-audit.smoke.js`: smoke gate. Imports `runExtensionManifestAudit()`, asserts every rule passes. Bumps the smoke count to 91.

### Changed

- `packages/extension/manifest.json`: `version` now `0.1.0.2` (derived from wallet `1.0.0-rc.2`). New `version_name: "1.0.0-rc.2"` carries the human-readable semver into Chrome. New `homepage_url: "https://github.com/XChain-platform/xchain-wallet"`. Description expanded from 55 → 110 chars to list the launch chains (still well under the 132-char CWS listing limit). Every future wallet bump must re-derive the manifest version; the smoke fails CI if it doesn't.

### Decided

- **`version_name` for the human semver, `version` for Chrome's ordering.** Chrome's `version` field is integer-tuple-only (no prerelease suffix). We keep the wallet's semver as the CWS submitter-visible string via `version_name` and derive a strictly-monotonic `version` tuple for the upgrade key. Alternative considered (keep them equal by dropping semver prerelease tags entirely during RC) would have coupled wallet versioning to Chrome's rules, rejected.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step, no source changes outside the new audit + smoke + manifest fields + version bump.
- 91 smokes pass (was 90).

## [1.0.0-rc.1] - 2026-04-24

§56.3 Pre-launch, Step 7 of 7. **Pre-launch CLOSED.** All 7 autonomous steps shipped across v0.96.0 → v1.0.0-rc.1 (camera scanner, AddressList route, hardware-friendly multisig PSBT path + SDK 1.13, per-address multisig configs / Wallet schema v2, static a11y audit gate, reproducible-build scaffolding gate, this RC cut). xchain-sdk pinned at `^1.13.0`. 90 smokes pass.

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

- Pre-launch close report: `claude/reports/specs/2026-04-24_prelaunch-close.md`: full step ledger, track-level state, deferral justifications, GA cut recommendation.
- Phase 4 close report: `claude/reports/specs/2026-04-24_phase4-close.md`: predecessor; lists the four pre-launch follow-ups.

This commit is a marker; no source changes other than the version bump.

## [0.101.0] - 2026-04-24

§56.3 Pre-launch, Step 6 of 7. Reproducible-build scaffolding gate. Every ingredient required for Level-2 reproducibility is now CI-gated by a static audit script + smoke. The byte-for-byte run-twice verification still has to happen on a clean dev machine before v1.0.0 GA, see `claude/reports/specs/2026-04-24_repro-build.md` for the procedure.

### Added

- `packages/core/scripts/repro-build-audit.js`: 18-rule static audit covering Dockerfile (digest-pinned base, NODE_VERSION pinned, locale + TZ pinned), `build.sh` (asserts SOURCE_DATE_EPOCH, uses `--frozen-lockfile`, emits a `RELEASE_HASHES.txt` sha256 manifest), `reproduce.sh` (derives SOURCE_DATE_EPOCH from `git log -1 --pretty=%ct`, builds from a fresh worktree), `electron-builder.config.cjs` (asar: true, references SOURCE_DATE_EPOCH, pins AppImage compression to xz), and `Reproducible_Builds.md` (mentions Level-2 + RELEASE_HASHES). Exits 0 on a clean tree, exits 1 with a per-rule failure report otherwise.

- `packages/core/test/repro-build-audit.smoke.js`: smoke gate. Imports `runReproBuildAudit()`, asserts every rule returns `ok: true`. Future PRs that drop a digest pin / un-freeze the lockfile / introduce non-determinism in the build config fail this smoke.

- `claude/reports/specs/2026-04-24_repro-build.md`: full report. Documents the scaffolding audit (all 18 rules pass at v0.101.0), the run-twice-and-compare verification procedure that has to happen on a clean dev machine, the typical sources of reproducibility drift to watch for, and the recommendation to run the procedure on at least two independent dev machines at v1.0.0 GA.

### Decided

- **Scaffolding audit now, byte-for-byte verification at release-cut time.** Two halves of the same property: the audit catches regressions in the scaffolding automatically on every commit; the byte-for-byte verification catches subtler drift (build tool version bumps that quietly lose determinism) but requires a clean Docker host that this build environment doesn't have. Splitting the work makes both halves enforceable.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step, no source changes outside the new audit script + smoke + version bump.
- 90 smokes pass.

## [0.100.0] - 2026-04-24

§56.3 Pre-launch, Step 5 of 7. Static a11y audit gate. Every shared route + UI primitive now passes a five-rule mechanical audit (button label / img alt / input label / textarea label / div onClick role + tabIndex). The smoke gate fails CI if any new surface introduces a regression. Full report at `claude/reports/specs/2026-04-24_a11y-audit.md`.

### Added

- `packages/core/scripts/a11y-audit.js`: static a11y audit. Walks every JSX file under `src/shared/` + `src/ui/`, parses tags with a brace-balancing reader (so `onClick={(e) => ...}` arrow functions inside attributes don't trip the parser), and surfaces violations of five rules: button-needs-text-or-aria-label, img-needs-alt, input-needs-label, textarea-needs-label, div-onclick-needs-role. The button rule accepts both static text content AND any bare-identifier or string-literal expression child as "presumed text", `{p.label}`, `{busy ? 'Loading…' : 'Save'}`, or `Send` all count. Inputs accept `label=` / `aria-label` / `aria-labelledby` / `placeholder` / matching `<label htmlFor>` (literal or `useId()`-style dynamic). Exits 0 with `a11y-audit: 0 violations` on a clean tree; exits 1 with a per-file violation report otherwise.

- `packages/core/test/a11y-audit.smoke.js`: smoke gate. Imports `runA11yAudit()`, asserts `violations.length === 0`. New surfaces that introduce regressions fail this smoke alongside the rest of the suite.

- `claude/reports/specs/2026-04-24_a11y-audit.md`: audit report. Documents what the audit covers, what it explicitly DOESN'T cover (color contrast, focus-visible styling, live-region timing, keyboard traps, screen-reader walkthroughs, all queued for the external a11y audit), the violations surfaced and fixed during this pass, and a follow-up checklist for the external audit.

### Changed

- `ContactsList.jsx`: `×` remove-row button gained `aria-label={`Remove address ${i + 1}`}` so screen readers announce its purpose rather than the multiplication-sign codepoint.
- `ContractsList.jsx` chain-tab buttons, gained `aria-label={d?.displayName \|\| cid}` so chain-icon-only tabs announce the chain name.
- `ContractsList.jsx` contract-row buttons, gained `aria-label={row.name \|\| row.NAME \|\| `Contract ${rowKey(row)}`}` so row buttons announce the contract identity rather than "button" with no further context.
- `AdvancedActionsForm.jsx` rest-params textarea, gained an explicit `aria-label` matching the on-screen label text. The wrapping `<label>` element provides the same association in modern UAs but adding the explicit label is robust across legacy assistive tech.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step.
- The audit's parser caught a class of false positives the first naive regex couldn't, `<textarea`s that have multi-line attribute blocks containing arrow functions look unlabeled to a regex that splits on the first `>`. The brace-balancing reader treats `=>` inside `{...}` as opaque content and only stops at top-level closing brackets.
- 88 smokes pass. 89 with the new a11y-audit.smoke.

## [0.99.0] - 2026-04-24

§56.3 Pre-launch, Step 4 of 7. Per-address (per-config) multisig (closes FOLLOWUP 3 from `claude/reports/specs/2026-04-24_phase4-close.md`). The `Wallet.multisig` single-slot field is now `Wallet.multisigs: MultisigConfig[]`, so a wallet can hold multiple multisig configurations side by side (different N-of-M groups, different schemes, different cosigner sets). Existing wallets migrate transparently, the v1→v2 migration synthesizes a `legacy-`-prefixed id for the existing config and wraps it in an array.

### Schema migrations

- `Wallet` schemaVersion 1 → 2. New `multisigs: MultisigConfig[]` replaces `multisig: MultisigConfig | null`. Migration: `wallet.multisig` (if non-null) becomes `wallet.multisigs[0]` with a synthetic `legacy-${uuid}` id; `null` becomes `[]`. The legacy `multisig` slot is stripped on migration. Validator now enforces unique config ids within `multisigs`.

- `MultisigConfig` schemaVersion 1 → 2. New `id: string` field. Migration synthesizes `legacy-${uuid}` when the v1 record has no id (it didn't, since v1 was a single slot with no need for one). `buildMultisigConfig` accepts a caller-supplied `id` (used by code paths that already have a stable identifier) or auto-assigns `crypto.randomUUID()`.

### Added

- `flows.listMultisigReceiveAddresses({ vault, sdkRegistry, walletId, chainId })`: plural variant of `receiveMultisigAddress`; returns one entry per config in `wallet.multisigs[]`. Each entry mirrors the singular result with an added `multisigConfigId`. Misconfigured configs are skipped silently rather than failing the whole list.

- `multisig.listAddresses` background handler + matching `listMultisigReceiveAddresses` helpers in `popup` / `web` / `desktop` messaging.

- `Receive.jsx`: renders one multisig section per config in `multisigs[]`, each with its own QR + badge + cosigner names. The first config still appears in the same place as before; additional configs stack below it.

- `AddressList.jsx`: synthesizes one row per multisig config when the derived address isn't in the persisted address table. Each row carries its own `<MultisigBadge>` indicator. The `🔐 Multisig only` filter is enabled when *any* config exists.

### Changed

- `flows.receiveMultisigAddress`: accepts an optional `multisigConfigId` parameter; defaults to `multisigs[0]` when omitted. Returns `multisigConfigId` in the result so callers can disambiguate when multiple configs exist.

- `flows.createMultisigConfig`: appends to `multisigs[]` rather than overwriting `multisig`. The duplicate-detection check is now keyed on `scriptTemplate` (same cosigners + same scheme = same address; legitimate to want a different N-of-M with the same cosigner set, which gets a different scriptTemplate and lands as a separate config).

- `flows.startMultisigSigningSession` (Step 19), accepts optional `multisigConfigId`; defaults to the first config.

- `flows.signMultisigLocally` (Step 21), finds the matching config in `wallet.multisigs[]` by pubkey-set equality against `session.cosignerPubkeys`. This is robust to wallets that carry multiple configs.

- `toSafeWallet` projection in `createBackgroundHost.js`: returns `multisigs` array (defaulted to `[]`) rather than the legacy single slot.

- `popup/messaging.js` `listWallets` JSDoc, return type updated to surface the new `multisigs` array.

- Four pre-existing smokes (`multisig-create.smoke.js`, `multisig-address.smoke.js`, `multisig-signing.smoke.js`, `address-list.smoke.js`), updated their fake-vault `Wallet` records to use `multisigs: [...]` instead of `multisig: {...}`. Polyfilled `globalThis.crypto = webcrypto` in three of them (the new schema factories are exercised at module load now that `buildMultisigConfig` runs `crypto.randomUUID()`).

### Added, smoke

- `packages/core/test/multisig-multi-config.smoke.js`: drives the full migration path. Exercises Wallet v1→v2 migration (single config + null cases), standalone `MultisigConfig` migration, duplicate-id validator rejection, `createMultisigConfig` appending two distinct configs to one wallet, duplicate-`scriptTemplate` guard, `receiveMultisigAddress` routing on `multisigConfigId`, `listMultisigReceiveAddresses` returning every config, bg/messaging registration, and Receive/AddressList multi-config render assertions. All 88 smokes pass.

### Decided

- **Migrate, don't dual-read.** The legacy `multisig` field is stripped on migration rather than left behind as a synonym for `multisigs[0]`. Single source of truth keeps the surface clean; the `legacy-`-prefixed config ids make pre-migration data identifiable in case any debugging-by-id-prefix is ever needed.

- **Default to first config when no id is supplied.** `receiveMultisigAddress({ walletId, chainId })` without a `multisigConfigId` returns the first config in the array. This keeps callers that don't care about per-config routing (the singular helper, Step 18-era code paths) working unchanged. New code paths that need precision pass `multisigConfigId` explicitly.

- **Home + History show "first config" for now.** Home's BTC-card multisig badge and History's "Multisig only" filter both use the singular helper today, which means they show the first config. A multi-config wallet still works, the user can drill into Receive or AddressList for the per-config view. Widening Home + History to show per-config breakdowns is straightforward but felt like polish, not v1.0 blocker, flagged as a follow-up.

### Notes

- xchain-sdk pin stays at `^1.13.0`. Pure wallet-side step.
- 88 smokes pass.

## [0.98.0] - 2026-04-24

§56.3 Pre-launch, Step 3 of 7. Hardware-friendly classical multisig PSBT path (closes FOLLOWUP 1 from `claude/reports/specs/2026-04-24_phase4-close.md`). The wallet now has a clean `signMultisigPsbt` abstract on the Signer interface, software-signer implements it for real (delegating to the SDK's new `signMultisigPsbt` / `finalizeMultisigPsbt`); hardware signers throw with the specific reason their multisig path isn't wired (Trezor: signTransaction multisig envelope plumbing; Ledger: registerWallet wallet-policy provisioning).

### Cross-repo

- `xchain-sdk` 1.12.0 → 1.13.0 (commit `3ea1b83` in `xchain-sdk`). New `WalletUtils.signMultisigPsbt(psbtHex, wif)` and `WalletUtils.finalizeMultisigPsbt(psbtHex)`. The "sign without finalizing → merge → finalize once threshold met" split is the natural N-of-M workflow because bitcoinjs-lib's PSBT format stacks `partialSig` entries under each input, so two cosigner-signed PSBTs merge by union. Wallet pin bumped `^1.12.0` → `^1.13.0` in `extension` and `web`.

### Added

- `Signer.signMultisigPsbt({ chainId, psbtHex, signingPaths })`: new abstract on the base `Signer` class. Returns the PSBT with this signer's partial sigs added but NOT finalized. Two new typedef blocks in `Signer.js` (`SignMultisigPsbtParams`, `SignMultisigPsbtReturn`).

- `SoftwareSigner.signMultisigPsbt`: real implementation. Derives the WIF for the cosigner's path via `_resolveWifForEntry`, calls `sdk.wallet.signMultisigPsbt(psbtHex, wif)`, returns the resulting PSBT. Surfaces a clear "bump xchain-sdk to ^1.13.0" message when the SDK is too old.

- `TrezorSigner.signMultisigPsbt`: throwing stub: "hardware multisig PSBT signing on Trezor is not yet wired, the signTransaction envelope requires multisig `signatures` arrays + public-key-ordering plumbing that isn't in trezorFormat.js today."

- `LedgerSigner.signMultisigPsbt`: throwing stub: "hardware multisig PSBT signing on Ledger requires a registered wallet policy (Bitcoin app ≥ 2.1.0 registerWallet flow) which this wallet hasn't provisioned yet."

- `packages/core/test/multisig-psbt-signing.smoke.js`: new smoke. Asserts the abstract throws AbstractMethodError; Trezor + Ledger throw their specific deferral errors; SoftwareSigner guards the locked / empty psbtHex / empty signingPaths / SDK-too-old paths; the happy path forwards the PSBT + WIF through `sdk.wallet.signMultisigPsbt` and returns the SDK's signed PSBT verbatim; new typedefs are present; SDK pin is `^1.13.0`.

### Changed

- `packages/core/test/multisig-signer.smoke.js`: softened the SDK-pin assertion from exact `^1.12.0` to `≥ ^1.12.0` regex (same pattern Step 19's smoke uses) so future bumps don't ripple.

### Decided

- **Two parallel methods, not one with flags.** The Step 21 `signMultisigClassical(msgHash, path)` stays, it produces a single DER signature given a sighash, useful when the wallet has the sighash already (e.g., from a §22.3 envelope-style flow). The new `signMultisigPsbt(psbtHex, signingPaths)` is the HW-friendly variant that takes a full PSBT. Both compose: a future flow can call `signMultisigPsbt` for HW signers and `signMultisigClassical` for the local software cosigner depending on what's most efficient. No flag-based branching.

- **Hardware paths are stubs, not nothing.** Surfacing a vendor-specific deferral error is more useful than `AbstractMethodError` because the user gets a path forward (use the software signer; what to wait for). The Step 21 vendor-firmware compatibility matrix in the Phase 4 close report grows a row for each vendor's classical-multisig path the next time vendor support changes.

### Notes

- 87 smokes pass.
- Integration into the `signMultisigLocally` flow + sign-screen UX is intentionally not in this step. Step 4 (per-address multisig configs) will reshape the Wallet schema enough that wiring the PSBT path through `signMultisigLocally` is cleaner to do after that lands.

## [0.97.0] - 2026-04-24

§56.3 Pre-launch, Step 2 of 7. Standalone Addresses route (closes FOLLOWUP 4 from `claude/reports/specs/2026-04-24_phase4-close.md`). The wallet now has a single dedicated surface listing every address it has generated, with per-address multisig badging and a "Multisig only" filter, what the §22 spec called for in passing but no Phase 4 step claimed.

### Added

- `packages/core/src/shared/routes/AddressList.jsx`: new flat list aggregating every address across every chain. Each row carries chain badge + label + shortened address + copy button; rows whose address matches the wallet's `getMultisigReceiveAddress` output get an inline `<MultisigBadge>` indicator. Filter chips: per-chain toggles (re-using History's chip styling) plus a "🔐 Multisig only" chip that's disabled when no multisig is configured. The multisig receive row is synthesized when the address isn't persisted in the wallet's address table, Receive derives it on-demand and doesn't necessarily save it.

- `packages/core/test/address-list.smoke.js`: new smoke. Asserts route exports + `getAddressesByChain` aggregation + `getMultisigReceiveAddress` prefetch + multisig row badging + filter chip + synthetic-row behaviour + Home's `onAddresses` nav prop + the `'addresses'` sub-route wiring across all three shells.

### Changed

- `Home.jsx`: accepts a new `onAddresses` nav prop, surfaces an "Addresses" button between History and Contracts in the secondary nav strip.
- `packages/extension/src/popup/App.jsx`, `packages/web/src/App.jsx`, `packages/desktop/renderer/App.jsx`: each tracks `'addresses'` as a sub-route, mounts `<AddressList walletId>`, and passes `onAddresses` through to Home.

### Notes

- `xchain-sdk` pin stays at `^1.12.0`. Pure UI / wallet-side step.
- All 86 smokes pass.

## [0.96.0] - 2026-04-24

§56.3 Pre-launch, Step 1 of 7. Camera scanner for the multisig paste-inbox (closes FOLLOWUP 2 from `claude/reports/specs/2026-04-24_phase4-close.md`). The sign-screen now offers camera scanning as a first-class path alongside the existing paste-text flow; scanner-driven frames route through the same XCW chunk collector that the paste flow already drives, so there's one verify-and-dispatch path regardless of how chunks arrive.

### Added

- `packages/core/src/ui/QrScanner.jsx`: generic camera-scanner component. Wraps the native `BarcodeDetector` API against a live `<video>` + `MediaStream`. Requests the environment-facing camera, runs detection on a `requestAnimationFrame` loop, stops every MediaStreamTrack on unmount (no dangling camera LED). Emits each detected QR string through `onFrame`; intentionally does not de-duplicate, callers feeding a chunked transport already no-op on duplicate chunks. Graceful "Camera scanning isn't supported on this browser" fallback when `BarcodeDetector` is unavailable (Firefox, older Safari), pointing users back to the paste-chunk path.

- `packages/core/test/qr-scanner.smoke.js`: new smoke. Asserts the component exports + BarcodeDetector + environment-camera + RAF loop + track cleanup; sign-screen's "Scan with camera" toggle, scanner-open state, `handleScannerFrame` handler, and XCW-collector routing; the legacy "Step 21 will wire the camera scanner" hint has been removed from the paste-inbox copy.

### Changed

- `MultisigSigningSession.jsx` paste-inbox view, new `scannerOpen` state + "Scan with camera" button that mounts `<QrScanner onFrame={handleScannerFrame}>`. The scanner handler feeds each detected string through `addChunkToCollector`, appends it to the visible textarea for the user's sanity, and dispatches the decoded envelope through the same `contributeMultisigNonce` / `contributeMultisigSignature` path the paste flow uses once the collector completes. Scanner closes automatically on completion.

### Notes

- `xchain-sdk` pin stays at `^1.12.0`. Pure wallet-side step.
- Manifest permissions for the extension popup remain unchanged, MV3 popups get camera access via the browser's `getUserMedia` permission prompt at runtime, without an explicit manifest entry. If camera prompts in the popup turn out to be janky, adding a dedicated permissions page is a follow-up.
- Chromium-based browsers (Chrome, Edge, modern Opera, Electron-based desktop shell) are the primary target; Firefox + Safari don't expose `BarcodeDetector` yet (as of Q2 2026) and will fall back to the paste-chunk UX via the unsupported message.
- All 85 smokes pass.

## [0.95.0] - 2026-04-24

Phase 4, Step 23 of 23. **Phase 4 CLOSED.** All 23 steps shipped across v0.74.0 → v0.95.0 over a single 2026-04-24 build day. xchain-sdk landed at 1.12.0 (three bumps during the phase: 1.10 MuSig2 primitives, 1.11 deriveMultisigAddress, 1.12 signEcdsa). 84 smokes pass.

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
- Reproducible-build verification (`packages/desktop/Reproducible_Builds.md` already documents the procedure).
- Chrome Web Store submission.
- Four small follow-ups documented in `claude/reports/specs/2026-04-24_phase4-close.md` (hardware classical multisig path, camera scanner for paste-inbox, per-address multisig configs, standalone `<AddressList>` route).

### Reference

- Phase 4 close report: [`claude/reports/specs/2026-04-24_phase4-close.md`](../../claude/reports/specs/2026-04-24_phase4-close.md), full step ledger, spec deltas surfaced during build, MuSig2 hardware-signer compat matrix, and the four follow-ups deferred to §56.3.

This commit is a marker; no source changes (other than the version bump).

## [0.94.0] - 2026-04-24

Phase 4, Step 22 of 23. Multisig badges surface-wide (§22 + §22.4). The N-of-M / scheme indicator now appears on every surface where a single-key surface would normally show a plain address: Receive, History, Home balances, and the multisig sign-screen tracker. Step 23 closes Phase 4.

### Added

- `packages/core/src/ui/MultisigBadge.jsx`: small chip component. Props: `{ threshold, cosignerCount, scheme, size? }`. Renders `"<T>-of-<N> <P2SH | P2WSH | MuSig2>"` with a scheme-tinted background (amber for P2SH, blue for P2WSH, violet for taproot-MuSig2, distinct enough that a glance tells the schemes apart without reading the tag). `aria-label` is the human form `"2 of 3 multisig (P2WSH multisig)"`. Carries `data-testid="multisig-badge"` + `data-scheme` so layered smokes / e2e tests can assert presence on each surface.

- History route, new `🔐 Multisig only` filter chip alongside the existing `🔗 Cross-chain actions` chip. Filter resolves the wallet's multisig address via `messaging.getMultisigReceiveAddress` once on mount; chip is disabled (with explanatory tooltip) when no multisig is configured. When active, filters entries to those with source/dest matching the multisig address.

### Changed

- `Receive.jsx`: replaced the inline N-of-M pill (a hand-styled `<span>`) with `<MultisigBadge>`. Same visible information, but consistent with every other multisig surface and exercised by a single component-level smoke instead of per-surface assertions.

- `MultisigSigningSession.jsx`: the session list and the detail-view header now render `<MultisigBadge>` instead of the inline `schemeLabel` text. The list view's badge is `size="sm"` so it sits inline with the meta row; the header badge is the default `size="md"` next to the status text.

- `ChainBalanceCard.jsx`: accepts an optional `multisig` prop (`{ threshold, cosignerCount, scheme }`) and renders the badge in the card header alongside the chain badge + address-count meta. `Home.jsx` resolves the wallet's multisig at mount and passes the resolved record only to BTC chain cards (multisig is BTC-only at launch per §10.3 / §22.4). The badge sits in the header so the multisig nature of a chain card is visible at a glance, alongside the chain's existing identity badge.

### Smoked

- New `packages/core/test/multisig-badge.smoke.js`. Asserts the component exports + 3-scheme tone map + ARIA label + `data-testid` + `data-scheme`; Receive integration; History "Multisig only" filter chip + the `getMultisigReceiveAddress` prefetch + the chip's `aria-pressed` state; ChainBalanceCard's `multisig` prop + Home's BTC-only badge gate; MultisigSigningSession's header + list-row badge wiring against the session's `threshold` + `cosignerPubkeys.length`.

- `multisig-address.smoke.js` (Step 18), softened the "N-of-M indicator on Receive" assertion to accept either the original inline pill OR the new `<MultisigBadge>` form. The component-level smoke owns the strict shape assertion now.

### Notes

- xchain-sdk pin stays at `^1.12.0`. Pure UI / wallet-side step.
- All 84 smokes pass.

## [0.93.0] - 2026-04-24

Phase 4, Step 21 of 23. MuSig2 hardware-signer integration + local-cosigner contribution flow (§22.3 + §42.9). The wallet now has the full local-signing path for both MuSig2 and classical (P2SH/P2WSH) multisig: software signer produces real cryptographic contributions; hardware signers surface the spec-required "Update firmware to use MuSig2 on this device" error. Step 22 surfaces multisig badges across the rest of the UI (Addresses, History, Balances).

### Cross-repo

- `xchain-sdk` 1.11.0 → 1.12.0 (commit `2d69b2c` in `xchain-sdk`). New `WalletUtils.signEcdsa(msgHash, secretKey)` returns a DER-encoded signature over a 32-byte sighash with a 32-byte secret key. Used by `SoftwareSigner.signMultisigClassical` for P2SH / P2WSH single-round contributions. Compact-to-DER conversion follows BIP-66; no sighash flag byte appended (caller's PSBT finalizer handles the suffix). Smoked manually: 32-byte privkey + 32-byte hash → 70-byte DER starting `0x30`. Wallet pin bumped `^1.11.0` → `^1.12.0` in `extension` and `web`.

### Added

- `packages/core/src/signers/Signer.js`: three new abstract methods on the base `Signer`: - `signMusig2Round1({ chainId, path, sessionRef })`: BIP327 round 1 publicNonce generation. - `signMusig2Round2({ chainId, path, sessionRef, aggNonceHex })`: BIP327 round 2 partial signature. - `signMultisigClassical({ chainId, path, msgHash })`: DER-encoded ECDSA over the input's sighash for P2SH / P2WSH.

- `packages/core/src/signers/SoftwareSigner.js`: real implementations: - `signMusig2Round1` calls `sdk.musig2.aggregateKeys` (binds the nonce to the aggregated x-only pubkey) followed by `sdk.musig2.generateNonce`.

- `packages/core/src/signers/TrezorSigner.js` + `LedgerSigner.js`: three throwing stubs each. Trezor surfaces "hardware MuSig2 is not supported on Trezor, update firmware to use MuSig2 on this device, or use the wallet's software signer." Ledger surfaces the same message tailored to the Ledger Bitcoin app. Classical multisig deferred to Step 22+ with its own clear error per device.

- `packages/core/src/flows/multisigSignLocally.js`: `signMultisigLocally({ vault, chainRegistry, sdkRegistry, sessionId, password })`. One entry point that finds the local cosigner on the persisted `MultisigConfig`, gates by `(scheme, status)`, dispatches to `signMusig2Round1` / `signMusig2Round2` / `signMultisigClassical`, and pipes the result through the Step 19 `contributeMultisigNonce` / `contributeMultisigSignature` APIs. Pre-checks duplicate-cosigner conditions before unlocking the wallet, fast-fails on stale invocations without paying the Argon2id KDF cost.

- `packages/extension/src/background/createBackgroundHost.js`: new `multisigSign.signLocally` handler.

- `packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js`: matching `signMultisigLocally` helpers.

- `packages/core/src/shared/routes/MultisigSigningSession.jsx`: new `sign-locally` view state with a wallet-password input and a "Sign with my key" button. Surfaces the §22.3 firmware-too-old guidance inline so users know to fall back to the software signer when their HW device's firmware doesn't support MuSig2 yet. Reachable from the tracker view via a "Sign with my key" button.

- `packages/core/test/multisig-signer.smoke.js`: new smoke. Asserts the Signer base class exposes the three new methods as abstracts that throw `AbstractMethodError`; `TrezorSigner` + `LedgerSigner` surface the spec firmware-too-old + classical-deferred errors with the exact wording; `flows.signMultisigLocally` is re-exported with the right guards (vault / chainRegistry / sdkRegistry / sessionId / password); status-gating still rejects partial-sig contributions during round 1; bg handler registers `multisigSign.signLocally`; all three shells export `signMultisigLocally`; sign-screen route surfaces "Sign with my key" + the firmware-too-old guidance copy + `sign-locally` view state; SDK pin is `^1.12.0`. All 83 smokes pass.

### Changed

- `packages/core/test/multisig-address.smoke.js`, `multisig-signing.smoke.js`, `coinpay-form.smoke.js`, `sdk-bundle.smoke.js`: SDK-pin assertions softened from "exactly `^1.11.0`" to "at least `^1.11.0`" via a single regex (`/^\^1\.(?:1[1-9]|[2-9]\d)\.0$/`). Hardcoding the exact pin meant every later step's bump rippled into a smoke patch; the regex form keeps the assertion (we still catch a downgrade or accidental pin removal) without forcing churn on every legitimate bump.

### Decided

- **Local-signing is software-only this step.** Real hardware MuSig2 wiring requires vendor firmware that exposes BIP327 nonce + partial-sign primitives through Connect / hw-app-btc. As of Q2 2026 neither vendor exposes this in a stable form (Ledger added taproot to the Bitcoin app at 2.4.0 but the JS client surface lags; Trezor firmware is still in development). Surfacing the spec-required error so users know to update firmware or fall back to software is the right shape today; the throwing stubs are exactly where the real wiring will land when vendor support is ready.

- **Classical multisig signing routed through SDK rather than re-implementing in core.** The wallet has no `@noble/curves` dep today. Adding `WalletUtils.signEcdsa` to the SDK (one method, ~25 lines including DER-encode helper) keeps secp256k1 access centralized in the SDK's audit surface and lets the wallet stay light. Same Phase 3 Step 9 (`getCoinpayObligations`) cross-repo pattern.

- **Deterministic MuSig2 sessionId, no secret-nonce persistence.** BIP327 secret nonces are NOT cross-process or cross-instance, the SDK's musig2 module stashes them in an internal Map keyed by publicNonce. By computing `sessionId = sha256(text || fingerprint || privKey)`, round 2 can re-derive the same publicNonce + same secret nonce on a fresh SDK instance. This means the wallet doesn't have to persist secret nonce material across lock/unlock cycles, round 1 emits a publicNonce, the user can lock the wallet, unlock weeks later, and round 2 still works because the secret is recomputable from privKey + fingerprint. (Anti-replay still holds: the fingerprint changes if the underlying multisig session changes, so the same path doesn't re-use a nonce across sessions.)

## [0.92.0] - 2026-04-24

Phase 4, Step 20 of 23. Multisig PSBT-QR cosigner round-trip (§22.3 reuses §20 chunked-QR transport). The wallet now has a complete envelope protocol on top of the existing chunked-QR transport: coordinator wallets request, cosigner wallets reply, both differentiate round 1 (MuSig2 nonces) from round 2 (MuSig2 partial sigs) from the single round (P2SH/P2WSH classical). Step 21 wires the hardware-MuSig2 path; Step 22 surfaces multisig badges across the rest of the UI.

### Added

- `packages/core/src/uri/multisigPsbtEnvelope.js`: multisig envelope module. Seven envelope kinds covering the full protocol: `multisig-request-nonce` / `multisig-round-1-reply` (MuSig2 round 1), `multisig-request-partial` (carries `aggNonce`) / `multisig-round-2-reply` (MuSig2 round 2), `multisig-request-signature` / `multisig-classical-reply` (P2SH/P2WSH single round), `multisig-finalized` (broadcast-of-record). Every envelope carries a `fingerprint` derived from `sha256(canonicalized(sessionRef))` so cosigner wallets can route incoming envelopes into the right local session without shipping a UUID on the wire. `validateMultisigEnvelope` cross-checks the carried fingerprint against the carried `sessionRef`, catching tampering before the contribution reaches the state machine.

- `packages/core/src/ui/AnimatedQrFrames.jsx`: generic React component that renders an array of strings as animated QR codes at 3 fps per §20.3. Pre-renders the next frame in the background so frame transitions don't flash. Caches data URLs to avoid re-rendering on every interval tick. Reusable: not multisig-specific, anything that wants to display chunked QR (cold-storage PSBT export, large URI shares) can compose with `encodeXcwChunks` to drive frames.

- `packages/core/src/shared/routes/MultisigSigningSession.jsx`: three new view states layered onto the Step 19 tracker: - `tracker` (existing), adds `Round 1, Collect nonces` / `Round 2, Collect signatures` / `Collect signatures` round labels per the §22.3 + §22.4 spec. - `export-qr`: picks the right envelope kind for the current `(scheme, status)` tuple (round-1-nonce request for MuSig2 collecting-nonces; round-2-partial request for MuSig2 collecting-sigs once aggNonce is set; signature request for P2SH/P2WSH; finalized broadcast for terminal).

- `packages/core/test/multisig-psbt-qr.smoke.js`: new smoke. Asserts the seven envelope kinds enumerate the full protocol; canonicalized + case-insensitive fingerprint; round-1 / round-2 / classical / finalized builders + their shape guards; encode→XCW chunks→reassemble→decode round-trip for every kind; tampered-envelope detection (fingerprint mismatch when the underlying sessionRef is swapped); envelope-version rejection; `AnimatedQrFrames` export from core/ui; sign-screen route renders both round labels per spec; sign-screen builds outbound envelopes + decodes inbound ones + pipes the contribution through messaging; uri barrel exposes the 9 new helpers; Step 19 helpers still present in all 3 shells. All 82 smokes pass.

### Decided

- **Envelope-on-bytes, not envelope-as-PSBT.** The §22.3 multisig protocol carries strictly more state than a vanilla PSBT (per-cosigner publicNonces, aggregated nonce, per-cosigner partials, the eventual aggregated Schnorr sig). Encoding all of that into BIP-0373 PSBT v2 fields is doable but pulls a heavyweight PSBT manipulation library into the wallet's audit surface for a flow that's purely wallet-to-wallet. Going with a small versioned JSON envelope wrapped inside `encodeXcwChunks`. The same chunked-QR transport (`XCW:<n>/<total>:<crc32>:<base64>`) already proven for PSBT-as-bytes carries the envelopes verbatim. Future ecosystem-interop work (Sparrow / Specter / Coldcard) per §20.3 can layer BBQr or UR formats on top of this same envelope shape.

- **Camera scanner deferred to a later step.** §20.4 / §20.5 specify a full air-gapped signer-mode UX with camera capture; Step 20's deliverable per the Phase 4 plan is the cosigner round-trip protocol, not the broader signer-mode wiring. The paste-inbox accepts pasted XCW chunks today; the camera scanner will fill the same textarea automatically when it lands. Smoke notes the deferral inline so the follow-up is discoverable.

### Notes

- `xchain-sdk` pin still at `^1.11.0`. No platform-side changes for Step 20, the envelope layer is wallet-only and the cryptographic primitives that drive aggregation already shipped at SDK 1.10/1.11.
- Step 19's smoke continues to pass against the modified sign-screen route; the round-label additions sit alongside the existing dual-mode tracker copy without disturbing it.

## [0.91.0] - 2026-04-24

Phase 4, Step 19 of 23. Multisig-aware sign-round persistence + dual-mode partial-signature tracking (§22.3 + §42.9). The wallet now owns the state machine that keeps a multisig spend coherent across cosigner contributions and across wallet reloads. Step 20 wires the §20 PSBT-QR transport that pumps contributions into this layer; Step 21 wires the hardware-MuSig2 path; Step 22 surfaces multisig badges across the rest of the UI.

### Added

- `packages/core/src/schemas/multisigSigningSession.js`: new `MultisigSigningSession` record with a six-status state machine (`collecting-nonces` → `collecting-sigs` → `ready-to-finalize` → `finalized` → `broadcast`, plus terminal `cancelled`). One record covers both schemes; the `scheme` field discriminates which contribution lane is populated. P2SH/P2WSH track `signatures[]` (DER-encoded ECDSA, single round). Taproot-MuSig2 tracks `nonces[]` (66-byte BIP327 publicNonces, round 1) and `partialSigs[]` (32-byte BIP327 partials, round 2), plus `aggNonce` and `aggregatedSchnorrSig` outputs. Helpers `pendingCosignerPubkeys(session)` and `progressSummary(session)` drive the dual-mode tracker UI ("Signatures collected: 2 of 3" for P2SH/P2WSH; "Nonces collected: 2 of 3" → "Partial sigs collected: 2 of 3" → aggregated 64-byte Schnorr for MuSig2).

- `packages/core/src/storage/codec.js` + `storage/Vault.js`: new `multisigSigningSessions` collection. New documents include the slot; older documents read it as `[]` via the existing defensive merge in `decodeDocument`. No schema-version bump for the document codec, collection adds at `documentVersion: 1` are forward-compatible.

- `packages/core/src/flows/multisigSigning.js`: eight flow operations: - `startMultisigSigningSession({ vault, walletId, chainId, msgHash, psbtHex?, actionSummary? })`: snapshots the wallet's persisted `MultisigConfig` (scheme + threshold + cosigner pubkey list) onto the new session so the active config can mutate without affecting an in-flight spend.

- `packages/extension/src/background/createBackgroundHost.js`: eight new `multisigSign.*` handlers (start / get / list / cancel / contributeNonce / contributeSignature / aggregate / finalize) wired through the same vault + sdkRegistry deps the Step 17/18 multisig handlers use.

- `packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js`: eight matching helpers in each shell so the sign-screen UI doesn't have to build envelopes by hand.

- `packages/core/src/shared/routes/MultisigSigningSession.jsx`: list-or-detail tracker route. The list shows every multisig session for the active wallet with status + scheme label + N-of-M progress. The detail view renders the dual-mode tracker per the spec: P2SH/P2WSH shows a single counter; MuSig2 shows two counters ("Round 1, Nonces collected" + "Round 2, Partial sigs collected") plus indicators for aggNonce and aggregated Schnorr availability. Pending-cosigners list, Aggregate button (gated on threshold + valid status), and Cancel-session button. Reachable from ActionsMenu via "Multisig signing", BTC-gated by `useBtcAddressesPresent`.

- `packages/core/test/multisig-signing.smoke.js`: new smoke. Drives a 2-of-3 P2WSH single-round flow end-to-end against an in-memory fake vault, plus a 2-of-2 MuSig2 two-round flow against a stubbed `sdk.musig2.{aggregateNonces, startSession, aggregateSignatures}` to verify state transitions, contribution shape guards, threshold gating, and persistence. Also asserts schema status alphabet + dual-mode `progressSummary` labels + bg-handler registration of all 8 routes + 3-shell messaging exports + sign-screen route renders the dual-mode tracker copy + 3-shell App.jsx wiring + BTC gate + that the SDK pin stays at `^1.11.0` (no SDK bump needed for Step 19; the MuSig2 primitives that landed at 1.10 cover the aggregation paths).

### Decided

- **Wallet-side path, no SDK extension this step.** The Step 19 prompt left it open whether to extend `xchain-sdk` with multisig PSBT helpers or to build the multisig path wallet-side using the `redeemScript` / `witnessScript` / `outputPubkey` Step 18's `receiveMultisigAddress` already returns. Going wallet-side. The state-machine + persistence is not crypto, it's bookkeeping, and the cryptographic primitives that *do* belong in the SDK already live there as `sdk.musig2.*`. PSBT byte-level construction is deferred to Step 20 along with QR transport, where the right SDK shape will be obvious. Until then `MultisigSigningSession.psbtHex` carries an opaque transport payload that round-trips through the wallet without it needing PSBT-manipulation primitives.

- **Multisig PSBT-finalization is a stub at this step.** `finalizeMultisigSigningSession` accepts a caller-supplied `finalizedTxHex` and flips the status. Step 20's QR transport will produce real signed-tx bytes from the threshold contributions stored on the session. Smoke exercises the full state machine end-to-end with placeholder bytes to keep the regression net tight.

- **Caller-driven aggregation, no auto-advance on threshold.** When the threshold-th MuSig2 partial sig lands, status stays at `collecting-sigs` until the caller invokes `aggregateMultisigSession`: by design. The caller may still want to collect more signatures than the threshold (for redundancy / audit trail) before the user explicitly "finalizes the round." P2SH/P2WSH single-round behaviour is the same in spirit: status advances to `ready-to-finalize` on threshold, but the actual PSBT finalization is a separate step.

### Notes

- `xchain-sdk` pin stays at `^1.11.0` across `extension` and `web`. Step 18 already shipped the SDK bump that this step builds on (`deriveMultisigAddress` + `musig2.*`). No platform-side changes for Step 19.

## [0.90.0] - 2026-04-24

Phase 4, Step 18 of 23. Multisig address derivation + Receive integration (§22 + §42.9). Closes the read-side multisig surface; PSBT construction (Step 19), QR transport (Step 20), and HW MuSig2 (Step 21) follow.

### Cross-repo

- `xchain-sdk` 1.10.0 → 1.11.0 (commit `34292f8` in `xchain-sdk`). New `XChainWallet.deriveMultisigAddress({ scriptTemplate, scheme, network? })` consumes the `scriptTemplate` field that this wallet persists on `MultisigConfig` (Step 17) and renders the output address. P2SH-multisig: `bitcoin.payments.p2sh({ redeem: p2ms({ m, pubkeys }) })`. P2WSH-multisig: `bitcoin.payments.p2wsh({ redeem: p2ms(...) })`. Taproot-MuSig2: `bitcoin.payments.p2tr({ pubkey: aggregatedXOnly })`: key-path-only with no further BIP341 tweaking, because `sdk.musig2.aggregateKeys` already produced the final output key. Returns `{ address, scheme, redeemScript, witnessScript, outputPubkey }`. Manually verified end-to-end: `aggregateKeys` → `deriveMultisigAddress({ scheme: 'taproot-musig2', ... })` produces a `bc1p…` bech32m address; the same cosigner pubkeys with `scheme: 'p2sh-multisig'` produce a `3…` base58 P2SH address; with `scheme: 'p2wsh-multisig'` produce a `bc1q…` 32-byte witness-program bech32 address.

### Added

- `packages/core/src/flows/multisigAddress.js`: `receiveMultisigAddress({ vault, sdkRegistry, walletId, chainId })`. Reads the persisted `MultisigConfig` off the Wallet record, dispatches to `sdk.deriveMultisigAddress`, and returns `{ address, scheme, threshold, cosignerCount, cosignerNames, schemeLabel, redeemScript | witnessScript | outputPubkey }`. Fails loudly when the wallet has no `multisig` config yet, when no SDK is registered for the chainId, or when the SDK is too old (`< 1.11.0`) to expose the method.
- `packages/extension/src/background/createBackgroundHost.js`: `multisig.receiveAddress` read-only handler.
- Three-shell messaging, `getMultisigReceiveAddress` helpers in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/Receive.jsx`: multisig section. When the active wallet has a persisted `MultisigConfig` and a multisig address derives successfully for the active chain, Receive renders a labeled section below the single-key QR with: an N-of-M chip indicator, the scheme label ("2-of-3 P2WSH multisig"), a separate QR for the multisig address, copy-to-clipboard, and the cosigner names below. Failures are silent, the single-key flow keeps working when multisig isn't configured (or the chain doesn't support it).

### Changed

- `packages/extension/package.json`, `packages/web/package.json`: `xchain-sdk` pin bumped `^1.10.0` → `^1.11.0`.
- `packages/core/test/coinpay-form.smoke.js`, `packages/core/test/sdk-bundle.smoke.js`: pin assertions updated to match the new SDK version.

### Notes

- The Receive section is render-only, no PSBT, no signing. PSBT construction against the persisted `MultisigConfig` is the §22.3 flow that lands in Step 19; this step closes the structural prerequisite (a wallet with a `MultisigConfig` can show its receive address).
- Network selection follows the active Receive chain. Multisig is BTC-only at launch (§22 + §10.3); the Receive chain picker still lists every chain with addresses, but the multisig section only renders when the active chain's network maps to a valid multisig output (the SDK's `deriveMultisigAddress` throws with a clear error otherwise; the route swallows the error and skips the section).
- `redeemScript` (P2SH) and `witnessScript` (P2WSH) come back from the SDK and are stored in the result, ready for Step 19's PSBT construction. Taproot-MuSig2 returns the `outputPubkey` for symmetry; PSBT construction will use it directly.

## [0.89.0] - 2026-04-24

Phase 4, Step 17 of 23. Multisig wallet creation coordinator (§22 + §42.9). Opens the multisig surface (Steps 17–22). All three schemes (P2SH / P2WSH / Taproot-MuSig2) configurable from this single coordinator; address derivation, PSBT construction, QR transport, HW MuSig2 wiring, and surface-wide badging follow in Steps 18–22.

### Added

- `packages/core/src/schemas/multisigConfig.js`: Cosigner schema brought in line with §22.2: `name` + `pubkey` + `fingerprint` + `origin` + `localSignerId` + `xpub` + `derivationPath` + `addedAt`. The previous skeleton had `localAccountId` and was missing `fingerprint` / `derivationPath` / `addedAt`. `COSIGNER_ORIGINS` renamed `hardware` → `external-hardware` per spec. `validateMultisigConfig` enforces ≥2 cosigners, threshold ≤ N, and unique pubkeys. New `buildMultisigConfig` factory assembles the record and encodes `scriptTemplate` (P2SH/P2WSH: `multi:<T>:<pk1>:<pk2>:...`; Taproot-MuSig2: `musig2:<aggregatedXOnlyPubkey>`).
- `packages/core/src/flows/createMultisigConfig.js`: coordinator core flow. Validates cosigner inputs (hex pubkey, 8-hex fingerprint, derivation path, origin-specific required fields), aggregates keys via `sdk.musig2.aggregateKeys` for the Taproot-MuSig2 path, persists the resulting `MultisigConfig` onto the chosen Wallet record's `multisig` slot via `vault.wallets.put`. Refuses to overwrite an existing multisig configuration.
- `packages/extension/src/background/createBackgroundHost.js`: `multisig.create` handler.
- Three-shell messaging, `createMultisigConfig` helpers in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/MultisigCreate.jsx`: coordinator UI. BTC-only network picker (multisig is BTC-only at launch per §10.3 + §22). Cosigner row editor: per-row name + origin (local / external-xpub / external-hardware) + pubkey + fingerprint + derivation path. For local cosigners, dropdown of the wallet's BTC addresses auto-fills pubkey + derivationPath from the address record. Scheme picker (radio: all three live). Threshold input. Review summary block + "Create multisig" submit. Done screen surfaces the persisted scriptTemplate.
- ActionsMenu, new "Create multisig" entry across all three shells, BTC-gated via `useBtcAddressesPresent` (same gate Contracts and Staking use).
- Three App.jsx, new `'multisig-create'` sub-route. Reachable from the actions menu when `hasBtcAddress` is true; Back returns to the menu.

### Fixed

- Three-shell `messaging.js` had a duplicate `getActionByIndex` export (one from Step 3, one from Step 12). Vite would have caught this at build time; smoke tests don't bundle. Removed the duplicate so each helper is exported exactly once.

### Notes

- `xchain-sdk` 1.10.0 already ships `MuSig2` wired onto `XChainSDK.musig2`. The Phase 4 step plan called for an SDK 1.11 bump for MuSig2 primitives; that bump turned out to be unnecessary because Step 1's audit (and its commit `862cab1` in the SDK repo) had already landed the module ahead of Phase 4. The wallet's pin stays at `^1.10.0`.
- BIP32 master fingerprint isn't auto-computed for local cosigners. The coordinator UI asks the user to type it. Computing it from the unlocked seed is a small enhancement that could land alongside Step 18's address derivation work, fingerprint resolution and derivation are adjacent concerns.
- PSBT construction (Step 19), QR transport (Step 20), HW MuSig2 wiring (Step 21), and surface-wide multisig badges (Step 22) all consume the `MultisigConfig` this step persists. Step 17 is structural; the operational surface lands in those four follow-up steps.

## [0.88.0] - 2026-04-24

Phase 4, Step 16 of 23. Cross-chain templates (§42.8.4). Closes the §42.8 Cross-Chain surface (Steps 12 → 16). Templates are JSON config files in `packages/core/src/templates/cross-chain/*.json` plus a `Templates` route that pre-fills the §42.8.2 Parallel composer.

### Added

- `packages/core/src/templates/cross-chain/launch-token-with-metadata.json`: Jin's "Launch token with cross-chain metadata" reference template (ISSUE on chain A + FILE on chain B + LINK).
- `packages/core/src/templates/cross-chain/bridge-token-pair.json`: "Bridge token pair" reference template (ISSUE on each chain + LINK).
- `packages/core/src/templates/cross-chain/cross-chain-airdrop.json`: Jin's "Cross-chain airdrop" reference template (parallel AIRDROP on multiple chains).
- `packages/core/src/templates/cross-chain/validate.js`: `validateCrossChainTemplate` pure function; checks `id` / `name` / `description` non-empty, `actions` non-empty array, per-row `chainHint ∈ {primary, secondary, tertiary}`, `action` non-empty, `params` is an object.
- `packages/core/src/templates/cross-chain/index.js`: bundled-template registry. Imports the three JSONs (Vite handles JSON imports natively), validates each at module-load via `validateCrossChainTemplate`, throws on malformed templates, exports the frozen list as `CROSS_CHAIN_TEMPLATES` plus a `templateById(id)` lookup. `validate.js` is a sibling so Node smokes can validate JSONs via `fs` without loading `index.js` (Node 18 lacks JSON-module support without `--experimental-json-modules`).
- `packages/core/src/shared/routes/CrossChainTemplates.jsx`: list route. Loads the wallet's chains via `messaging.getAddressesByChain`, then renders each template with name + description + per-row preview + "Use template" launcher. The launcher resolves each row's `chainHint` to a concrete `chainId` (primary → chains[0], secondary → chains[1], tertiary → chains[2], with fallback to the last available chain), substitutes resolved tickers into LINK rows' `COIN1` / `COIN2` placeholders, and calls `onLaunch(prefill)`.
- `packages/core/src/shared/routes/ParallelComposer.jsx`: new `initialRows` prop. When supplied, the composer seeds with those rows (each carrying a resolved `chainId`, action name, params object) instead of one blank row. Rows behave identically to user-added rows from then on (full edit / remove / status tracking).
- ActionsMenu, new "Cross-chain templates" entry across all three shells.
- Three App.jsx, new `'cross-chain-templates'` sub-route + `parallelPrefill` state slot. The templates route's `onLaunch` callback writes the prefill into `parallelPrefill` and navigates to `'parallel-compose'`; the parallel composer's Back clears the prefill so the next entry starts blank.

### Notes

- §42.8 surface complete: Step 12 (History thread rendering §23.5), Step 13 (LINK form §42.8.1), Step 14 (Parallel composer §42.8.2), Step 15 (Cross-chain swap §42.8.3), Step 16 (Templates §42.8.4). Phase 4 progress: 16 / 23.
- Action indices in LINK rows stay as placeholder strings (`<ISSUE action_index from row 1>`) by design. The user fills them in after rows 1–2 confirm and an action_index is known. A future enhancement could auto-substitute these from the running pendingTx state, but that's a richer composer feature than Step 16's scope.
- Templates are config, not code. Adding a new template means dropping a new `<id>.json` next to the bundled three and adding it to `index.js`'s import list. Per-template structure is enforced at module load, so a malformed addition surfaces at startup rather than as a broken row in the composer.
- No SDK / explorer / hub bumps, Step 16 is pure UX over the existing `advancedAction` surface (via Step 14's composer).

## [0.87.0] - 2026-04-24

Phase 4, Step 15 of 23. Cross-chain swap form (§42.8.3). Reuses the §41.5 `swapAction` core flow with one structural change at the form level: `GIVE_COIN ≠ GET_COIN`. Same SWAP encoder produces both same-chain and cross-chain offers; this is purely a UI separation.

### Added

- `packages/core/src/shared/routes/CrossChainSwapForm.jsx`: §42.8.3 surface. Two side panels (You give / You get): give-chain picker + from-address selector + give-ticker / give-amount; get-chain picker + receiver address (auto-filled via `messaging.getNewestAddress`) + get-ticker / get-amount. Expiration field (block-height delta forwarded as the `EXPIRATION` SWAP param). Standard 3-stage flow (form → submitting → done). Validation: rejects same-chain pairs (with a pointer to the §41.5 `Swap tokens` form), rejects native-coin tickers on either side (DISPENSER lane), requires non-empty receiver and integer expiration.
- ActionsMenu, new "Cross-chain swap" entry across all three shells.
- Three App.jsx, new `'cross-chain-swap'` sub-route. Reachable from the actions menu; Back returns to the menu.

### Notes

- The receiver address auto-fill uses `messaging.getNewestAddress(walletId, getChainId)`: the same helper Receive uses to surface the wallet's newest external HD index. Once the user types into the field, the auto-fill pauses (`getAddressTouched`) so re-renders don't clobber a custom destination. Switching the get-chain resets `touched` so the new chain's auto-fill takes over.
- Same-chain swaps stay routed to `SwapForm` (§41.5). The cross-chain form refuses identical give/get coin tickers with a pointer to the same-chain form, keeps the §41.5 surface focused on the common single-chain case and avoids growing a "cross-chain mode" toggle there.
- Native-coin rule preserved on both sides. `GIVE_TICK` cannot be the give-chain's coin ticker (BTC / DOGE / LTC), and `GET_TICK` cannot be the get-chain's coin ticker. Token ↔ native-coin trading is the DISPENSER lane (§40.7), not SWAP.
- The wallet does not consult the give-chain's tip to convert "blocks-from-now" into an absolute block height. The form forwards the raw `EXPIRATION` value verbatim and the SDK validator + indexer enforce the absolute-vs-relative semantics (the indexer treats EXPIRATION as a delta from the SWAP's confirmation block; the SDK validator only requires a positive integer).
- Live cross-chain status via WebSocket (the spec line "Status is live on both chains") is deferred, the form's done screen is a single broadcast confirmation. Adding a "watch this swap" surface would mean wiring SWAP-match streaming into the wallet, which is its own follow-up.

## [0.86.0] - 2026-04-24

Phase 4, Step 14 of 23. Parallel cross-chain composer (§42.8.2). Multi-row draft list spanning any combination of chains, signed sequentially through the existing §40.10 `advancedAction` core flow. No new submit primitives, Step 14 is mostly UX.

### Added

- `packages/core/src/shared/routes/ParallelComposer.jsx`: §42.8.2 four-stage flow: - **Compose**: `[+ Add action]` button seeds a row with the wallet's first chain and a default JSON params skeleton (`{"VERSION":"0"}`).
- ActionsMenu, new "Parallel cross-chain actions" entry across all three shells.
- Three App.jsx, new `'parallel-compose'` sub-route. Reachable from the actions menu; Back returns to the menu.

### Notes

- Step 14 deliberately reuses `messaging.advancedAction` per row rather than introducing a new "parallel.batch" core flow. The on-chain effect of "n parallel actions" is exactly "n independent ACTIONs," so a batch flow would be a thin loop wrapper that doesn't earn its weight. The composer is the loop, with per-row UX guarantees the SDK doesn't owe.
- Params are entered as a JSON object per row. This is consistent with how the §40.10 Advanced form treats unknown actions (raw fields), and lets the composer span every supported action in one surface without growing per-action knowledge here. Future Steps may layer a per-action-type renderer on top, but the JSON path stays as the power-user fallback.
- The skip/retry semantics matter: a software-signed run with three rows where row 2 fails should not strand the user. Skip moves on; Retry signs the failed row again with the in-flight password (or the next HW prompt). The Done screen reports the run truthfully so users can compose a follow-up to clean up.
- No SDK / explorer / hub bumps, `advancedAction` and `listActions` were both on the SDK 1.10.0 surface audited in Step 1. The cross-chain helper's `parallel()` method is not used; `advancedAction` already routes through the per-chain SDK instance via `sdkRegistry`, which is the same dispatch.

## [0.85.0] - 2026-04-24

Phase 4, Step 13 of 23. LINK two-panel creation form (§42.8.1). First write-side cross-chain action, anchors a pair of existing actions across two chains. Both sides thread together in History via the §23.5 rendering shipped in Step 12.

### Added

- `packages/core/src/flows/linkAction.js`: LINK composer over `submitAction`. Guards `coin1` / `coin2` non-empty, `coin1ActionIndex` / `coin2ActionIndex` integer-strings, and rejects identical (coin, action_index) pairs. Builds the v0 LINK params (`VERSION|COIN1|COIN1_ACTION_INDEX|COIN2|COIN2_ACTION_INDEX|MEMO`) per the SDK format.
- `packages/extension/src/background/createBackgroundHost.js`: `action.link` + `action.link.hw` handlers (the latter via `registerHwHandler`).
- Three-shell messaging helpers, `linkAction` / `linkActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/LinkForm.jsx`: §42.8.1 two-panel composer. Two side panels (Chain A / Chain B), each with a chain picker + action_index input. Per-side decoded preview fetched via `messaging.getActionByIndex` (350ms debounce, cached per (chainId, actionIndex) pair) so the user can confirm what they're linking before signing. "Submit LINK on" radio defaults to chain A; switches the signing-chain context (and therefore the from-address pool) when the user picks chain B. Standard 4-stage flow (form → submitting → done) with `SignCredentials` + HW vs software branch.
- ActionsMenu, new "Link cross-chain actions" entry across all three shells.
- Three App.jsx, new `'link-form'` sub-route. Reachable from the actions menu; Back returns to the menu.
- `packages/core/src/shared/routes/AdvancedActionsForm.jsx`: `LINK` added to `ACTIONS_WITH_DEDICATED_FORMS` so the Advanced dropdown decorates LINK with "(dedicated form available)" rather than presenting it as the canonical surface. The Advanced action description across all three shells dropped the `LINK` mention since LINK now has a curated UX.

### Notes

- LINK is a free-standing cross-chain anchor, it does not consume or produce tokens. The on-chain LINK action lives on a single chain, but the indexer's `links` table records both (coin1, action_index1) and (coin2, action_index2) so History can thread either side regardless of which chain hosts the LINK transaction.
- The form's "Submit LINK on" defaults to chain A. If the user wants the LINK action itself recorded on chain B, switching the radio re-selects a from-address from chain B's pool, the LINK transaction signs on whichever chain owns the picked address.
- Decoded preview is best-effort. The form recognizes ISSUE / SEND / BROADCAST and falls back to the bare action name otherwise; the goal is "is this the right action?" confirmation, not a full action viewer (the History detail card already covers that).
- No SDK / explorer / hub bumps, `getAction(actionIndex)` and the SDK's LINK encoder were both on the SDK 1.10.0 surface audited in Step 1.

## [0.84.0] - 2026-04-24

Phase 4, Step 12 of 23. History route + §23.5 cross-chain thread rendering. First Cross-Chain (§42.8) step, ships the History surface so the §42.8.1–§42.8.4 LINK / parallel / swap / templates flows have somewhere to land in the timeline.

### Added

- `packages/core/src/flows/linkQueries.js`: `linksForAddress` thin wrapper over `sdk.getLinks(address, 'address', opts)`.
- `packages/extension/src/background/createBackgroundHost.js`: `links.address` read-only passthrough. (`history.address` was already registered in Phase 1; Step 12 is the first surface to consume it.)
- Three-shell messaging helpers, `getAddressHistory` / `getLinksForAddress` / `getActionByIndex` in popup + web + desktop `messaging.js`. (`history.address` is now reachable from the UI; `actions.byIndex` already had a bg handler from Step 3 but no shell helper.)
- `packages/core/src/shared/routes/History.jsx`: unified §23 timeline + §23.5 cross-chain threading. Per (chain, address) the route fans out `getAddressHistory` + `getLinksForAddress` in parallel, merges results into a single time-sorted list, and builds a `(chainId, action_index) -> peer` link map. Rows carry a 🔗 badge when they're one side of a LINK pairing. Adjacent rows that are peers of the same LINK (both sides visible) get a vertical connector. Click → inline detail card; for linked rows the card renders side-by-side, fetching the peer ACTION via `messaging.getActionByIndex` (cached per peer key). "Cross-chain actions" filter chip isolates the threaded subset; per-chain chips toggle individual chains.
- `packages/core/src/shared/routes/Home.jsx`: new `onHistory` prop + History button in the home actions strip.
- Three App.jsx, new `'history'` sub-route. Mounted from the Home button, Back returns to Home.

### Notes

- LINK coin-ticker → chain mapping is local: `{ BTC: 'bitcoin', DOGE: 'dogecoin', LTC: 'litecoin' }`. Unknown tickers degrade gracefully, the row still renders with the raw coin code in the peer label, the dual-side card shows a "peer chain not bundled" hint, and the rest of History keeps working. When a future chain is added to `BUNDLED_DESCRIPTORS` the map needs the new ticker entry.
- The vertical connector only draws when both peers happen to be adjacent in the visible list (DESC by block_index). For LINKs whose peer is outside the address's history (cross-account, archived, or filtered out by the active chain chips) the connector is suppressed but the 🔗 badge still appears, that's the §23.5 behavior: the badge is the marker, the connector is the accent when the layout supports it.
- `summarizeRow` covers SEND / ISSUE / LINK explicitly and falls back to the row's memo or just the action name. Other action shapes (DISPENSE, ORDER fills, STAKE, etc.) render with the bare action label in the row header, full decoded data is one click away in the detail card. Tightening per-action summaries is a follow-up across the whole timeline rather than a Step 12 concern.
- No SDK / explorer / hub bumps needed for Step 12, `getLinks(addr, 'address')`, `getHistory(addr, 'address')`, and `getAction(actionIndex)` were all already on the SDK 1.10.0 surface audited in Step 1.

## [0.83.0] - 2026-04-24

Phase 4, Step 11 of 23. Operator / validator dashboard (§42.7.5, Devi persona). Closes the Staking surface (§42.7), Steps 7–11 cover dashboard, all five write-side actions, and the operator view.

### Added

- `packages/core/src/flows/broadcastQueries.js`: `broadcastsForAddress` thin wrapper over `sdk.getBroadcasts(address, 'address', opts)`.
- `packages/extension/src/background/createBackgroundHost.js`: `broadcasts.forAddress` read-only passthrough.
- Three-shell messaging, `getBroadcastsForAddress` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/OperatorDashboard.jsx`: §42.7.5 dashboard. Five parallel-loaded read sections (Staking status / Delegation chain / Validator performance / Rewards trajectory / Publishing activity) plus an inline Publisher mode quick-compose. Validator performance auto-joins the address's most recent delegation pubkey against `getValidators` to pick out the operator's own row.
- Publisher mode (inline `<PublisherMode>` sub-component), v3 BROADCAST feed-result quick-compose. Pre-fills `BROADCAST_ACTION_INDEX` from the address's most recent v2 feed-create. Single value input + sign → calls `messaging.broadcastAction` (HW branch wired). Clears the value field after each successful submit so successive updates are one keystroke + Sign. Password / HW status persist across submits within the dashboard session.
- `packages/core/src/shared/routes/StakingDashboard.jsx`: new `onOpenOperatorDashboard` prop + "Operator view" button rendered next to the existing action buttons. Disabled when there's no active stake or when the prop isn't passed.
- Three App.jsx, new `'operator-dashboard'` sub-route. `StakingDashboard.onOpenOperatorDashboard` transitions; the operator dashboard's Back returns to the staking dashboard.

### Notes

- §42.7 staking surface is now complete. Steps 7 (dashboard), 8 (STAKE), 9 (UNSTAKE + CLAIM_REWARDS), 10 (DELEGATE + REVOKE_DELEGATION), and 11 (operator dashboard + Publisher mode) cover every staking sub-section. Phase 4 progress: 11 / 23.
- No SDK / explorer / hub bumps needed for Step 11, every read endpoint (`getStakes`, `getDelegations`, `getValidatorRewards`, `getValidators`, `getBroadcasts`) was already on the SDK 1.10.0 surface audited in Step 1.
- Validator metric field names (`uptime` / `score` / `votes` / `missed` / `last_seen_block`) are speculative, the dashboard renders whichever of those keys come back from `getValidators`. If the hub's actual field names diverge, the section will silently render empty rather than throw, and the field mapping can be tightened in a follow-up after the operator dashboard has live data flowing through it.

## [0.82.0] - 2026-04-24

Phase 4, Step 10 of 23. DELEGATE + REVOKE_DELEGATION authoring forms (§42.7.2 delegation-lane). Both actions take a 64-hex Ed25519 pubkey and share a chassis, so they ship in one commit combined into `DelegationActionForm.jsx` with a `mode` prop (same pattern as Step 9's StakingActionForm).

### Added

- `packages/core/src/flows/delegateRevokeActions.js`: `delegateAction` + `revokeDelegationAction` composers. Both guard their 64-hex Ed25519 pubkey field (DELEGATE: `NEW_SIGNING_PUBKEY`, REVOKE_DELEGATION: `SIGNING_PUBKEY`) up-front before handing to the SDK encoder.
- `packages/extension/src/background/createBackgroundHost.js`: `action.delegate` + `action.revokeDelegation` + both `.hw` variants (via `registerHwHandler`).
- Three-shell messaging helpers, `delegateAction` / `delegateActionHw` / `revokeDelegationAction` / `revokeDelegationActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/DelegationActionForm.jsx`: one component, two modes via `mode` prop (`'delegate' | 'revoke'`). Delegate mode asks for a new pubkey and explains it replaces any currently-active delegation. Revoke mode pre-populates the pubkey input by reading the source address's delegations via `messaging.getDelegationsForAddress` (the read-side already in place from Step 7), the user can override to revoke an older key. Review screen + SignCredentials + HW branch + 4-stage state machine are shared.
- Three App.jsx, new `'staking-delegate'` + `'staking-revoke'` sub-routes. `StakingDashboard` now wires `onDelegate` + `onRevokeDelegation` through to the two routes. The existing Delegate / Revoke buttons on the dashboard (rendered disabled in Step 7) are now live.

### Notes

- Staking authoring surface (§42.7.1–§42.7.3) is now complete. Steps 8 (STAKE), 9 (UNSTAKE + CLAIM_REWARDS), and 10 (DELEGATE + REVOKE_DELEGATION) close out every write-side staking action. Step 11 (operator / validator dashboard §42.7.5) is the last staking sub-step.
- Dashboard consistency: all five staking action buttons (Stake / Unstake / Claim / Delegate / Revoke) are now live when their preconditions are met (has stake, has pending rewards, has delegation).

## [0.81.0] - 2026-04-24

Phase 4, Step 9 of 23. UNSTAKE + CLAIM_REWARDS authoring forms (§42.7.2 unstake-lane + §42.7.3). Both actions are trivially small on-chain, UNSTAKE is `VERSION|TIER`, CLAIM_REWARDS is `VERSION`: so they ship in one commit, combined into `StakingActionForm.jsx` with a `mode` prop (same pattern as §42.5 ContractFundsForm).

### Added

- `packages/core/src/flows/unstakeClaimActions.js`: `unstakeAction` + `claimRewardsAction` composers. `unstakeAction` guards `TIER`; `claimRewardsAction` is just a `params` object guard. Both call `submitAction` with their own pending-tx summary verb.
- `packages/extension/src/background/createBackgroundHost.js`: `action.unstake` + `action.claimRewards` + both `.hw` variants (via `registerHwHandler`).
- Three-shell messaging helpers, `unstakeAction` / `unstakeActionHw` / `claimRewardsAction` / `claimRewardsActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/StakingActionForm.jsx`: one component, two modes via `mode` prop (`'unstake' | 'claim-rewards'`). Unstake-mode shows a Tier 1 / Tier 2 radio with an explanation that unstake returns the full tier stake (no partial amount). Claim-mode is a confirm-and-sign surface with no input fields. Review screen + SignCredentials + HW branch + 4-stage state machine are shared.
- Three App.jsx, new `'staking-unstake'` + `'staking-claim'` sub-routes. `StakingDashboard` now wires `onUnstake` + `onClaimRewards` through to the two routes. The existing Unstake / Claim buttons on the dashboard (rendered disabled in Step 7) are now live.

### Notes

- §42.7.2 spec / SDK format divergence. `XCHAIN_WALLET_SPEC.md` §42.7.2 describes UNSTAKE as amount-based, but the SDK's `formats.js` UNSTAKE entry is `VERSION|TIER` (no AMOUNT). Per STAKE.md, UNSTAKE withdraws the **full tier stake**, partial unstakes aren't a protocol concept. Step 9 ships tier-only, matching the on-chain format, and calls out the behavior in the form UI. FOLLOWUP 4 in `claude/reports/specs/2026-04-24_phase4-staking-followups.md` captures the spec-vs-format decision needed before v1.0 (either widen the SDK format or drop the amount language from §42.7.2).
- Tier 3 stays deferred (FOLLOWUP 1 in the same doc). StakingActionForm's tier picker mirrors StakeForm, Tier 1 + Tier 2 only.

## [0.80.0] - 2026-04-24

Phase 4, Step 8 of 23. STAKE authoring form (§42.7.1). Tier 1 (Oracle) + Tier 2 (Cross-chain validator) lanes ship; Tier 3 (Oracle publisher) deferred pending SDK format update, see `claude/reports/specs/2026-04-24_phase4-staking-followups.md`.

### Added

- `packages/core/src/flows/stakeAction.js`: STAKE composer. Guards TIER + SIGNING_PUBKEY (64-hex Ed25519) + CHAINS (when Tier 2). Composes VERSION=0, TIER, CHAINS, SIGNING_PUBKEY. Amount is not a user-chosen field, the protocol fixes it per tier (STAKE.md "Tier Stake Amounts").
- `packages/extension/src/background/createBackgroundHost.js`: `action.stake` + `action.stake.hw` handlers.
- Three-shell messaging helpers, `stakeAction` / `stakeActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/StakeForm.jsx`: §42.7.1 form. Tier radio (1 / 2), 64-char hex Ed25519 signing-pubkey input, Tier-2-only Chains multi-checkbox (BTC / LTC / DOGE, default BTC+DOGE), display-only Amount line per tier, review screen with full pubkey + SignCredentials + HW branch, done screen mentioning the 6-BTC-block activation delay per STAKE.md.
- Three App.jsx, new `'stake-form'` sub-route. `stakingRef` state `{ chainId, address }` carries context from the dashboard's Stake button. StakingDashboard.onStake now transitions; the form's Back returns to the dashboard.

### Notes

- Tier 3 deferred. STAKE.md documents Tier 3 (Oracle publisher, 500 XCHAIN, requires DOGE_ADDRESS) but the SDK's `formats.js` STAKE entry is `VERSION|TIER|CHAINS|SIGNING_PUBKEY` without DOGE_ADDRESS. Shipping a Tier 3 lane now would produce STAKE actions that fail encoder round-trip. FOLLOWUP 1 in the staking followups doc captures the one-line SDK fix + the conditional DOGE_ADDRESS validation.
- Signing-key generation UX is also deferred (FOLLOWUP 3): users paste a pre-generated 64-hex Ed25519 pubkey today. `@noble/curves@1.9.1` is already a transitive dep via xchain-sdk 1.10.0 and exports ed25519, generating a fresh keypair inline is a small follow-up.

## [0.79.0] - 2026-04-24

Phase 4, Step 7 of 23. Staking dashboard (§42.7.4). Nav guard + read-only dashboard; STAKE / UNSTAKE / DELEGATE / REVOKE / CLAIM authoring forms land in Steps 8–10.

### Added

- `packages/core/src/flows/stakingQueries.js`: four read-only wrappers over the staking-side explorer passthroughs landed in xchain-sdk 1.10.0: `stakesForAddress`, `delegationsForAddress`, `rewardsForAddress` (all address-typed), and `validatorsForChain` (no-args roster lookup for the §42.7.5 operator dashboard).
- `packages/extension/src/background/createBackgroundHost.js`: four new read-only passthroughs (`stakes.forAddress` / `delegations.forAddress` / `rewards.forAddress` / `validators.forChain`).
- Three-shell messaging helpers, `getStakesForAddress` / `getDelegationsForAddress` / `getRewardsForAddress` / `getValidatorsForChain` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/StakingDashboard.jsx`: §42.7.4 dashboard. Per BTC chain with addresses, loads stakes + delegations + rewards across all addresses in parallel (fan-out, merge, sort newest-first). Renders Your stake / Delegated pubkey / Chains (Tier 2 only) / Pending rewards (+ Claim button) / Lifetime rewards / action buttons (Stake if not staked; Unstake / Delegate new key / Revoke delegation when staked + appropriate) / Recent reward events list (top 10).
- `packages/core/src/shared/routes/Home.jsx`: new `onStaking` prop + Staking button, rendered only when the prop is passed.
- Three App.jsx, new `'staking-dashboard'` sub-route. `useBtcAddressesPresent` (the hook added in Step 2) drives conditional prop-passing on Home: `onStaking={activeWalletId && hasBtcAddress ? …}`.

### Notes

- BTC-only gate reuses `useBtcAddressesPresent`: the same hook introduced for the Contracts nav in Step 2. §10.3 says "SDK staking actions are BTC-only" and the dashboard respects that.
- Action buttons follow the Step 3 pattern: optional `on*` props from App.jsx drive their disabled state. Step 8 (STAKE form), Step 9 (UNSTAKE + CLAIM_REWARDS), and Step 10 (DELEGATE + REVOKE_DELEGATION) will thread the real handlers through as each form lands, without re-touching the dashboard's internals.
- No operator / validator dashboard (§42.7.5) yet, that's Step 11 and also needs a bump to `xchain-hub` to expose validator-performance metrics via HTTP API (the hub's `RewardTracker` / `ValidatorIdentity` / `SlashDetector` / `PeerManager` internals are complete but the HTTP surface only exposes `hub-db/snapshot/oracle_prices` + `/snapshot/price_snapshots` today). Hub bump deferred to just before Step 11 per the Phase 3 Step 9 pattern, ship platform-side bumps against the concrete consumer.

## [0.78.0] - 2026-04-24

Phase 4, Step 6 of 23. DEPOSIT + WITHDRAW forms (§42.5). Closes the Contracts surface (§42.1–§42.6), browse, detail, deploy, execute, deposit, withdraw all ship. No SDK bump.

### Added

- `packages/core/src/flows/contractFundsActions.js`: two flows `depositAction` + `withdrawAction` sharing one composer helper. Both actions take the same field shape (CONTRACT_ACTION_INDEX + TICK + QUANTITY) per the protocol formats (`VERSION|CONTRACT_ACTION_INDEX|TICK|QUANTITY`), so the branching is only at the action-name string and the pending-tx summary verb.
- `packages/extension/src/background/createBackgroundHost.js`: `action.deposit` + `action.deposit.hw` + `action.withdraw` + `action.withdraw.hw` handlers.
- Three-shell messaging helpers, `depositAction` / `depositActionHw` / `withdrawAction` / `withdrawActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/ContractFundsForm.jsx`: one component, two modes via the required `mode: 'deposit' | 'withdraw'` prop. Header / summary / submit-button verb switch on the prop; everything else (state machine, address loading, SignCredentials, HW branching, form validation) is shared. Token input upper-cases on change; quantity is decimal-inputmode. Withdraw's hint calls out that it "Only succeeds if the contract permits it", on-chain rejection isn't a wallet-side bug.
- Three App.jsx, new `'contract-deposit'` + `'contract-withdraw'` sub-routes. ContractDetail now passes all three action-button props (`onExecute` + `onDeposit` + `onWithdraw`); each button's back navigation returns to the detail page.

### Notes

- §42.1–§42.6 now ship end-to-end: browse → detail → deploy → execute → deposit → withdraw. The next step (Step 7) starts the §42.7 Staking surface with the dashboard.

## [0.77.0] - 2026-04-24

Phase 4, Step 5 of 23. EXECUTE method form (§42.4). Adds the "Call method" authoring surface on top of the Step 3 contract-detail page. No SDK bump, `sdk.execute` has been on SDK ≥ 1.3.0 and is already reachable.

### Added

- `packages/core/src/flows/executeAction.js`: EXECUTE composer. Takes vault + registries + chain + source + params (VERSION, CONTRACT_ACTION_INDEX, METHOD, optional PARAMS array, GAS_LIMIT). Guards CONTRACT_ACTION_INDEX + METHOD + params.
- `packages/extension/src/background/createBackgroundHost.js`: `action.execute` + `action.execute.hw`.
- Three-shell messaging helpers, `executeAction` / `executeActionHw` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/ExecuteContractForm.jsx`: §42.4 form. Method name + pipe-delimited params (split into an array on submit to satisfy the SDK validator's PARAMS-as-array expectation) + gas limit (default 50000). Auto-picks the most recently derived HD address on the chain as caller. Review screen lists each param in an ordered list with monospace font; sign screen reuses `SignCredentials` + HW branching.
- Three App.jsx, new `'contract-execute'` sub-route. ContractDetail now passes `onExecute={() => setUnlockedView('contract-execute')}`; the form's Back returns to the detail page.

### Notes

- ABI-driven lane is deferred. §42.4 says "If a contract publishes an ABI (via a community convention or embedded metadata), the wallet populates a method selector and typed parameter inputs." The platform hasn't defined the ABI publishing convention yet, captured as FOLLOWUP 2 in `claude/reports/specs/2026-04-24_phase4-monaco-editor.md`. Step 5 ships the manual lane only.
- `contracts.suggestGasLimit` is a source-code heuristic; the execute form doesn't have the contract source (only the DEPLOY action_index). Default 50000 is a conservative starting point, users override. Per-call gas estimation is a VM-side feature that would require the indexer to expose a "dry-run" endpoint, which is out of Phase 4 scope.

## [0.76.0] - 2026-04-24

Phase 4, Step 4 of 23. DEPLOY authoring form (§42.6). No SDK bump, `sdk.contracts.validate / checkCodeSize / suggestGasLimit` and the DEPLOY action composer are all on SDK 1.10.0 (via SDK 1.3.0's `ContractUtils`).

### Added

- `packages/core/src/flows/deployAction.js`: DEPLOY composer. Takes vault + registries + chain + source + `params` (VERSION / CODE / GAS_LIMIT, optional NAME + CONSTRUCTOR_PARAMS), forwards to `submitAction`. Hex-encoding of the contract source is handled by the SDK validator chain, callers pass raw UTF-8 as `params.CODE`.
- `packages/core/src/flows/contractUtilities.js`: three wrappers over `sdk.contracts.*`: `contractValidate`, `contractCheckCodeSize`, `contractSuggestGasLimit`. Pure; no network. Routed through the messaging layer for consistency with the "UI never imports an SDK directly" discipline.
- `packages/extension/src/background/createBackgroundHost.js`: `action.deploy` + `action.deploy.hw` (via `registerHwHandler`) + three pure-function passthroughs (`contracts.validate`, `contracts.checkCodeSize`, `contracts.suggestGasLimit`).
- Three-shell messaging helpers, `deployAction` / `deployActionHw` / `validateContractCode` / `checkContractCodeSize` / `suggestContractGasLimit` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/DeployContractForm.jsx`: §42.6 form: - Chain picker (BTC-only; auto-selects first BTC chain with an address). - Name (optional) / Code source (monospace textarea) / Gas limit / Constructor params (optional). - Three action buttons: **Validate code** (acorn parse + size check + float-literal warnings), **Estimate size** (shows byte count + 64KB-limit flag), **Suggest gas** (fills the Gas limit input on first tap if empty). - Review screen: composed summary, chain badge, source address, name, byte count, gas limit, constructor params, validation warnings, `SignCredentials` (password + HW `getSignerStatus` wiring), primary button labelled `Deploy on <chain>` / `Sign on Trezor|Ledger` per source type. - Done screen: post-broadcast txid + Done button. - BTC-only gate: renders a clear "Contracts are BTC-only at launch.
- `packages/core/src/shared/routes/ContractsList.jsx`: gains optional `onDeploy` prop. When the host passes it, renders a primary `+ Deploy new contract` button in the filter-bar row. Hidden when prop omitted.
- Three-shell App.jsx, new `'contract-deploy'` sub-route. `ContractsList.onDeploy` transitions to it; the form's Back returns to the list.

### Notes

- Monaco editor is deferred. The spec's §42.6 language ("Monaco editor, full-screen mode available") is aspirational but ships a 5MB+ dependency with a CDN trust-posture trade-off that needs its own discussion. Spec follow-ups captured in `claude/reports/specs/2026-04-24_phase4-monaco-editor.md`: CodeMirror 6 recommended for the v1.0 RC cycle; the swap is a drop-in replacement of the `<textarea>` with a `<CodeEditor>` component under `packages/core/src/shared/components/` that wraps `EditorView`. Validate / Size / Suggest-gas already hit `sdk.contracts.*` and don't care about editor chrome.
- Review-screen summary is handwritten rather than routed through `decoderLib.decodeAction`. DEPLOY isn't wired into `packages/core/src/decoder/` yet; polish captured in the Monaco follow-up doc (FOLLOWUP 3).
- ABI / typed method selection (§42.4) is not addressed here, the DEPLOY form doesn't write ABIs yet because the platform-level ABI convention is undecided. Captured in the Monaco follow-up doc (FOLLOWUP 2); needs an `xchain-documentation` change first.

## [0.75.0] - 2026-04-24

Phase 4, Step 3 of 23. Contract detail page (§42.3). No SDK bump needed, all five read surfaces used here were already in SDK ≥ 1.3.0 and are exposed through the 1.10.0 pin landed in v0.74.0.

### Added

- `packages/core/src/flows/contractDetail.js`: five single-contract read flows: - `contractByActionIndex`: `sdk.getContract(contractActionIndex)` for the header block (owner / deploy block / gas limit / status / code hash). - `actionByIndex`: `sdk.getAction(actionIndex)` for the originating DEPLOY action (carries NAME / CODE_HASH / CONSTRUCTOR_PARAMS that don't live on the contract row). - `contractState`: `sdk.getContractState(idx, key?)`; `key` optional so the page can load the full state map and render it expandable. - `contractBalance`: `sdk.getContractBalance(idx, tick?)`; `tick` optional so the page lists every token the contract holds. - `executionsForContract`: `sdk.getExecutions(contractActionIndex, opts)` for the paginated EXECUTE-history section.
- `packages/extension/src/background/createBackgroundHost.js`: registers five new read-only passthroughs (`contracts.byActionIndex`, `actions.byIndex`, `contracts.state`, `contracts.balance`, `executions.forContract`).
- Three-shell messaging helpers, `getContractByActionIndex` / `getActionByIndex` / `getContractState` / `getContractBalance` / `getExecutionsForContract` in popup + web + desktop `messaging.js`.
- `packages/core/src/shared/routes/ContractDetail.jsx`: §42.3 page: - Header: `Contract #<idx>, "<NAME>"` + large ChainBadge.
- Three-shell App.jsx, new `'contract-detail'` sub-route, `contractRef` state `{ chainId, contractActionIndex }`. `ContractsList.onOpenContract` now sets `contractRef` and transitions. ContractDetail's Back returns to the list.

### Notes

- No EXECUTE / DEPOSIT / WITHDRAW signing in this step, Steps 5 + 6 land the authoring forms. The prop-gated button disable is intentional: the route handler in App.jsx passes no signing props today, the buttons render disabled, and Step 5/6 will thread the real handlers through from App.jsx without re-touching ContractDetail's internals.
- State and balance response shapes are defensively unwrapped (`{ data: [...] }` / `{ data: {...} }` / `{ state: {...} }` / flat object) so the page tolerates minor explorer-side shape changes without silent blanking.

## [0.74.0] - 2026-04-24

Phase 4, Step 2 of 23. Contracts nav item + browse landing (§42.2). Bumps the pinned SDK to `^1.10.0` (the SDK v1.10.0 pre-phase release that landed `sdk.getStakes/getDelegations/getValidators/getValidatorRewards` and the `sdk.musig2` primitives).

### Added

- `packages/core/src/flows/contractQueries.js`: five read-only flows scoped to a single chain + sdkRegistry: - `contractsForSource({ sdkRegistry, chainId, address, opts? })`: contracts the address deployed, backs "My contracts". - `contractsForAddress(…)`: the broader "source OR contract address" lane, preserved for future surfaces. - `contractsBrowseAll({ sdkRegistry, chainId, opts? })`: paginated all-contracts list for the "Browse all" section. - `depositsForAddress(…)` / `withdrawalsForAddress(…)`: backing "My interactions" via client-side union + dedupe by CONTRACT_ACTION_INDEX.
- `packages/extension/src/background/createBackgroundHost.js`: registers five explorer passthroughs (`contracts.forSource` / `contracts.forAddress` / `contracts.browseAll` / `deposits.forAddress` / `withdrawals.forAddress`).
- Three-shell messaging helpers, `getContractsForSource` / `getContractsForAddress` / `getContractsBrowseAll` / `getDepositsForAddress` / `getWithdrawalsForAddress` in popup / web / desktop `messaging.js`.
- `packages/core/src/shared/routes/ContractsList.jsx`: the §42.2 landing surface.
- `packages/core/src/shared/hooks/useBtcAddressesPresent.js`: shared hook that resolves once the wallet's addresses load and returns `true | false | null` depending on whether any BTC-family chain has at least one address. Used to gate the Contracts nav entry.
- `packages/core/src/shared/routes/Home.jsx`: new `onContracts` prop + button (variant="secondary"). Rendered only when the prop is passed; the three shell App.jsx files pass it only when `activeWalletId && hasBtcAddress` resolves true.
- Three-shell App.jsx, new `'contracts-list'` sub-route; `useBtcAddressesPresent(activeWalletId)` drives conditional prop-passing; `onOpenContract` placeholder in the route handler leaves a no-op for Step 3 to wire the detail page.

### Notes

- VM is BTC-only at launch per `registry/actions.js` `BITCOIN_ACTIONS` (DEPLOY / EXECUTE / DEPOSIT / WITHDRAW are bitcoin-exclusive), so the Contracts nav is gated on BTC address presence rather than always-visible. Step 7 (Staking) will reuse `useBtcAddressesPresent` for the same reason.
- No Deploy-new-contract button in this step's browse surface; it lands in Step 4 when the DEPLOY authoring form ships. Rendering the button now would require a disabled-stub flow that gets unwound in Step 4 for no gain.
- Search is client-side: filters loaded rows by NAME substring or action_index prefix. The explorer doesn't expose server-side contract-name search today, a potential future indexer widening, not a Phase 4 blocker.

## [0.73.0] - 2026-04-24

Phase 3, DEX and Messaging Steps 12–14. Closes Phase 3 in full: encrypted MESSAGE action signing + inbox + compose + contacts integration. No platform-side changes this release, the pinned `xchain-sdk ^1.9.1` already exposes the messaging surface (SDK 1.6.0 added `MessagingUtils`; SDK 1.7.0 added cross-chain; SDK 1.8.0/1.9.x rounded out the explorer client). `xchain-decoder` 1.9.0 populates the `pubkeys` table and `xchain-explorer` 1.14.0 exposes the pubkey lookup API, both verified live on master before building.

### Added

**Step 12, Messaging inbox + thread (§41.7.2)**

- `packages/core/src/flows/messagingInbox.js`: `getMessagingInbox({ vault, walletId, password, chainRegistry, sdkRegistry, addressId, type?, opts? })`. Delegates WIF derivation to the existing `exportPrivateKey` (same unlock + error surface as §17.7), then calls `sdk.getMessagesForAddress(address, { wif, type })` so the SDK auto-decrypts ECIES (method 1) entries in-process. ECDH (2) and AES (3) entries come back `encrypted: true / text: null`: the UI labels them "🔒 Encrypted (session key required)" since sessions are out of Phase 3 scope. Read-only; no vault mutation.
- `packages/extension/src/background/createBackgroundHost.js`: registers `messaging.inbox`.
- Three-shell messaging helpers, `getMessagingInbox`.
- `packages/core/src/shared/routes/MessagingInbox.jsx`: 4-stage state machine (`pick → password → submitting → inbox`). Address picker for multi-address wallets; password re-prompt on wrong-password with focus/select. Two-pane Conversations/Thread layout matching the spec's ASCII mock: left pane lists counterparties sorted by most-recent activity; right pane shows an ordered thread with outgoing/incoming styling. Hydrates contacts-by-address map on mount (auto-association per §41.7.4).
- Three-shell App.jsx, new `'messaging'` sub-route; `onMessaging` threaded to `Home`. `Home.jsx` grows a "Messaging" button alongside Markets.

**Step 13, Compose flow (§41.7.3)**

- `packages/core/src/flows/messageAction.js`: `messageAction` core flow. On ECIES path, looks up recipient pubkey via `sdk.getPublicKey(destination)`, encrypts in-process via `sdk.messaging.eciesEncrypt`, builds MESSAGE v2 `{ VERSION: '2', COIN, DESTINATION, ENCRYPTED_MESSAGE }`. On plaintext-fallback path (`method: null`), builds MESSAGE v3 `{ VERSION: '3', COIN, DESTINATION, PLAINTEXT_MESSAGE }`. Throws typed `PubkeyNotFoundError` when the recipient has no on-chain pubkey, UI recovers by offering the unencrypted fallback checkbox per spec wording. `getRecipientPubkey` query flow wraps `sdk.getPublicKey` for the compose-form preview.
- `packages/extension/src/background/createBackgroundHost.js`: registers `action.message` + `action.message.hw` (HW variant reuses `registerHwHandler`) + `messaging.pubkey`.
- Three-shell messaging helpers, `messageAction` + `messageActionHw` + `getRecipientPubkey`.
- `packages/core/src/shared/routes/ComposeMessage.jsx`: chain + from-address pickers, recipient input with debounced (400ms) pubkey lookup, 4-state UI banner (`idle` / `checking` / `found` / `missing`), message textarea, `SignCredentials` gate. On `missing`, offers the spec's verbatim "Continue anyway with an unencrypted message" checkbox.
- `MessagingInbox.jsx`: gains `onCompose` prop and Reply / New-conversation buttons that navigate to compose with the current counterparty pre-filled.
- Three-shell App.jsx, new `'compose-message'` sub-route + `composePrefill` state; back-link threads through an optional `__from` so the Cancel/Back key returns to whichever surface opened the form (Inbox or Contacts).

**Step 14, Contacts integration (§41.7.4)**

- `packages/core/src/flows/contacts.js`: CRUD on the existing `vault.contacts` collection + `Contact` schema (both already present from §11.3.4): `listContacts`, `findContactByAddress({ vault, chain, address })`, `saveContact({ vault, record | input })`, `deleteContact({ vault, id })`. `saveContact` accepts either an existing `record` (updates in place, bumps `updatedAt`) or an `input` shape (creates a new Contact via `createContact`).
- `packages/extension/src/background/createBackgroundHost.js`: registers `contacts.list` / `contacts.findByAddress` / `contacts.save` / `contacts.delete`.
- Three-shell messaging helpers, `listContacts` / `findContactByAddress` / `saveContact` / `deleteContact`.
- `packages/core/src/shared/routes/ContactsList.jsx`: single-route 3-mode state machine (`list` / `detail` / `edit`). Edit mode supports multiple (chain, address, label) entries per contact. Detail mode renders a "Send message" button that routes through ComposeMessage with the primary entry pre-filled. Delete is confirmed via `window.confirm`.
- `MessagingInbox.jsx`: hydrates a `contactsByAddress` map on mount and uses it in the Conversations pane: known counterparties render as `Name (bc1q…abc)` instead of just the address.
- Three-shell App.jsx, new `'contacts'` sub-route + ActionsMenu entry "Contacts". `onSendMessage` from ContactsList navigates to ComposeMessage with prefill.

### Notes

- 63/63 smoke tests green at this commit (was 60 at v0.72.0; +3 for messaging-inbox / compose-message / contacts).
- Phase 3 is now complete. Phase 4 starts the Contracts / Staking / Cross-Chain / Multisig surfaces (§42+).

## [0.72.0] - 2026-04-24

Phase 3, DEX Steps 8–11. Closes the DEX tail: the Market view now shows per-market trade history for the user's addresses; COINPAY obligations surface as a Home resume card and sign through a dedicated form; SWAP is available from the Actions menu; and MarketsList rows flag when a token has an open dispenser. Messaging (Steps 12–14) is out-of-scope here and lands in a subsequent release once the platform-side infra is verified on master.

Bumps pinned `xchain-sdk` to `^1.9.1` (adds `getCoinpayObligations` for the COINPAY queue).

### Added

**Step 8, Per-market trade history (§41.3.6)**

- `packages/core/src/shared/components/TradeHistoryPanel.jsx`: collapsible panel below `OpenOrdersPanel`. Fans out `messaging.getMarketHistory({ chainId, tick1, tick2, address })` across every wallet address on the chain, de-duplicates and sorts by timestamp, renders time / price / size / side / owner-address; `onOpenTx` callback reserved for a future tx-detail route. No polling, manual Refresh button only, since trade history grows slowly and adding another 5s timer alongside the orderbook + open-orders pollers is overkill.
- `packages/core/src/shared/routes/MarketView.jsx`: imports + renders `TradeHistoryPanel` below the PlaceOrder / OpenOrders row.
- No new core flow, no new background handler, no new messaging helper, Step 1's `getMarketHistory` already accepts the optional `address` filter. Smoke: `packages/core/test/trade-history.smoke.js`.

**Step 9, COINPAY queue + sign (§41.4)**

- `packages/core/src/flows/coinpayAction.js`: convenience wrapper for the COINPAY action. Validates `orderMatchActionIndex` / `payeeAddress` / `coinAmount` (positive integer, base units), composes `{ VERSION: '0', ORDER_MATCH_ACTION_INDEX }`, attaches `customOutputs: [{ address: payeeAddress, value: coinAmount }]` so the encoder builds the native-coin output to the seller into the same transaction.
- `packages/core/src/flows/coinpayQueries.js`: `getCoinpayObligationsForAddress` / `getCoinpaysForAddress` passthroughs to the new xchain-sdk@1.9.1 `sdk.getCoinpayObligations` / `sdk.getCoinpays` methods.
- `packages/extension/src/background/createBackgroundHost.js`: registers `action.coinpay` + `action.coinpay.hw` (HW variant re-using the existing `registerHwHandler` helper) + `coinpays.obligationsForAddress` + `coinpays.forAddress`.
- Three-shell messaging helpers, `coinpayAction` + `coinpayActionHw` + `getCoinpayObligationsForAddress` + `getCoinpaysForAddress`.
- `packages/core/src/shared/routes/CoinpayForm.jsx`: on mount, scans every `(chainId, address)` pair in the wallet for obligations filtered to `payer_address === address && coinpay_status === 'pending_coinpay'`. Renders a picker of all pending obligations, shows the obligation summary (chain / action index / payer / payee / coin amount / expiration), and signs via `SignCredentials` (HW path reuses the shared gate). `initialActionIndex` / `initialChainId` / `initialAddress` props auto-select the right row when opened from the Home resume card.
- `packages/core/src/shared/routes/Home.jsx`: gains `onResumeCoinpay` prop + `pendingCoinpays` state. On mount (same `useEffect` that hydrates balances + pending airdrops), fans out across all wallet addresses, filters to `pending_coinpay` on the payer side, and renders one resume card per obligation using the existing `pendingAirdropCard` class. Card click fires `onResumeCoinpay({ chainId, address, orderMatchActionIndex })`.
- Three-shell App.jsx, new `'coinpay'` sub-route + `resumeCoinpay` state + ActionsMenu `'coinpay'` entry ("Pay COINPAY"). `onResumeCoinpay` threaded to Home so the card deep-links into the form with the obligation preselected.
- `packages/extension/package.json` + `packages/web/package.json`: bumped `xchain-sdk` pin to `^1.9.1`. `packages/core/test/sdk-bundle.smoke.js` asserts the new pin.
- Smoke: `packages/core/test/coinpay-form.smoke.js` covers flow guards, form wiring, background handlers, 3-shell messaging, 3-shell App.jsx, Home resume card, and SDK pin.

**Step 10, SWAP form (§41.5)**

- `packages/core/src/flows/swapAction.js`: convenience wrapper for the SWAP action. Validates v0 create baseline (GIVE_TICK / GIVE_AMOUNT / GET_TICK / GET_AMOUNT all required) and transparently supports v1 cancel / v2 edit via `SWAP_ACTION_INDEX`: the wrapper only gates create-mode fields and forwards whatever params the caller provides.
- `packages/extension/src/background/createBackgroundHost.js`: registers `action.swap` + `action.swap.hw`.
- Three-shell messaging helpers, `swapAction` + `swapActionHw`.
- `packages/core/src/shared/routes/SwapForm.jsx`: single-chain v0 create form (GIVE_COIN = GET_COIN = current chain's native ticker, set automatically from the registry). Rejects native-coin tickers with a DISPENSER hint (SWAP does NOT work with native coin per protocol rules) and rejects same-ticker give/get pairs. Reuses `SignCredentials` + `isHwSource` for the sign gate.
- Three-shell App.jsx, new `'swap'` sub-route + ActionsMenu `'swap'` entry ("Swap tokens").
- Smoke: `packages/core/test/swap-form.smoke.js`.

**Step 11, Dispenser-available badge (§41.6)**

- `packages/core/src/shared/components/DispenserBadge.jsx`: queries `messaging.getDispensersForToken({ chainId, tick })` with a module-level session-scoped cache keyed by `${chainId}::${tick}` so a MarketsList with many rows referencing the same ticker only fires one explorer request. Filters responses to rows whose `status` is `valid` / `open` / omitted; renders nothing when loading or count is 0; otherwise shows a small "Dispenser · TICK" pill with the count in the tooltip. `__clearDispenserBadgeCache` test hook exported for downstream unit-test runners.
- `packages/core/src/shared/routes/MarketsList.jsx`: imports `DispenserBadge` and renders one per ticker in each market row (`tick1` + `tick2`).
- Smoke: `packages/core/test/dispenser-badge.smoke.js`.

### Changed

- `packages/core/test/sdk-bundle.smoke.js`: asserts `xchain-sdk ^1.9.1` on extension + web instead of `^1.9.0`.

### Notes

- 60/60 smoke tests green at this commit (was 56 at v0.71.0; +4 for Steps 8 / 9 / 10 / 11).
- Step 12 (Messaging inbox + thread, §41.7.2) is blocked until the 2026-04-07 `xchain-sdk` / `xchain-explorer` / `xchain-decoder` messaging work (captured in `project_messaging_feature.md`) lands on master. Verify with `git log` in those repos before picking it up.

## [0.71.0] - 2026-04-24

Phase 3, DEX Steps 1–7. Single-market trading UX is end-to-end functional: browse markets + pin a watchlist, open a market, see the chart + depth-visualized orderbook + recent trades, place limit orders, cancel open orders. All sign paths reuse the Phase 2 HW Sign primitives (SignCredentials + isHwSource), so Trezor/Ledger slot in behind the same form surfaces. Settlement (BTCPay + SWAP), dispenser badge integration, and Messaging remain for subsequent commits.

### Added

**Step 1, Markets list scaffold (§41.2)**

- `packages/core/src/schemas/watchlistEntry.js`: per-wallet pinned market record (chainId + tick1 + tick2). `createWatchlistEntry` / `validateWatchlistEntry` / `watchlistEntryKey` helpers.
- `packages/core/src/flows/watchlist.js`: `listWatchlistForWallet` / `saveWatchlistEntry` (idempotent by the canonical key) / `clearWatchlistEntry`.
- `packages/core/src/flows/marketQueries.js`: SDK-explorer passthroughs: `getMarkets` / `getMarket` / `getMarketHistory` / `getMarketOrders` / `getOrderbook`.
- `packages/core/src/storage/Vault.js` + `codec.js`: new `watchlistEntries` collection; `emptyDocument` + `decodeDocument` defensively merge the array so older persisted docs stay loadable.
- `packages/extension/src/background/createBackgroundHost.js`: registers 5 `markets.*` read-only handlers + 3 `watchlist.*` CRUD handlers.
- Messaging helpers on popup / web / desktop, 5 market-query + 3 watchlist helpers each.
- `packages/core/src/shared/routes/MarketsList.jsx`: landing view with watchlist + popular-markets sections, chain filter + search, star toggle to pin/unpin. Per-chain fan-out with isolated failure (one broken explorer doesn't blank the page).
- Three-shell App.jsx wiring, new `'markets'` sub-route + reserved `'market'` sub-route + activeMarket state. `Home.jsx` gains an `onMarkets` button between "Create a token" and "More actions".

**Step 2, Market view shell (§41.3)**

- `packages/core/src/shared/routes/MarketView.jsx`: four-panel layout (chart | orderbook | recent trades) above (place order | open orders). Header renders the market summary from `messaging.getMarket`. Popup variant stacks the panels vertically; full variant uses a 3-up + 2-up grid.

**Step 3, Chart panel (§41.3.1)**

- `lightweight-charts` declared as a dep in extension + web + desktop package.json.
- `packages/core/src/market/bucketize.js`: pure OHLCV bucketing. `bucketizeMatches(rows, { tick1, tick2, periodSeconds })` aggregates `getMarketHistory` match rows into candles with correct buy/sell price orientation (`give_tick === tick1` vs reversed) and tick1-denominated volume. Period constants + labels: 1m / 5m / 15m / 1h / 4h / 1d / 1w (default 1h).
- `packages/core/src/shared/components/MarketChart.jsx`: lazily `await import('lightweight-charts')` so the module loads clean in Node (smoke tests + SSR). Dynamic-import failure falls through to a "run pnpm install" hint rather than blowing up MarketView. Period toggle row rebuckets the same match dataset client-side.

**Step 4, Orderbook panel (§41.3.2)**

- `packages/core/src/market/orderbook.js`: pure `normalizeOrderbook(resp)`. Accepts both the explorer's wrapped `[{ asks, bids }]` shape and the plain object form. Parses `[price, amount]` tuples or `{ price, amount/size }` objects. Sorts bids descending + asks ascending, attaches cumulative sums, computes `maxCumulative` across both sides for depth-bar normalisation. Malformed rows (non-numeric price/size) drop silently.
- `packages/core/src/shared/components/OrderbookPanel.jsx`: two-column bids/asks with a proportional depth bar per row (teal bids left-anchored, red asks right-anchored). 5s polling pauses when `document.visibilityState === 'hidden'`. Clicking a price level fires `onPickPrice(displayPrice)`: MarketView threads that through `prefillPrice` into the Place Order panel.

**Step 5, Recent trades panel (§41.3.3)**

- `packages/core/src/shared/components/RecentTradesPanel.jsx`: chronological feed of the last 30 matches. Side inferred from pair orientation, price coloured teal/red. `onOpenTx(txid)` callback reserved for a future tx-detail route.

**Step 6, Place order form (§41.3.4)**

- `packages/core/src/flows/orderAction.js`: wraps `submitAction` for the ORDER action. Required-field validation (`GIVE_TICK` + `GIVE_AMOUNT` + `GET_TICK` + `GET_AMOUNT`); optional EXPIRATION / FEE_REQUIRED / FEE_PROVIDED pass through. Same file exports `cancelOrder` for §41.3.5, CANCEL composes from `orderActionIndex`.
- Background handlers: `action.order`, `action.cancelOrder`, `action.order.hw`, `action.cancelOrder.hw` (two HW variants landed via `registerHwHandler`).
- Messaging helpers on 3 shells: `orderAction` / `orderActionHw` / `cancelOrder` / `cancelOrderHw`.
- `packages/core/src/shared/components/PlaceOrderPanel.jsx`: buy/sell toggle maps to GIVE/GET orientation on the (tick1, tick2) pair; price + size + total auto-calc; expiration in blocks with presets (1d / 1w / 1m / never / custom); `prefillPrice` from orderbook click populates the price field. Reuses Phase 2's `<SignCredentials>` gate so HW addresses swap the password input for the HW sign block + status banner.

**Step 7, Open orders + cancel (§41.3.5)**

- `packages/core/src/shared/components/OpenOrdersPanel.jsx`: per-market list of the user's open orders. Fetches via `messaging.getMarketOrders({ chainId, tick1, tick2, address })` across every wallet address on the chain in parallel. 5s polling with visibilitychange pause (same cadence as the orderbook). Cancel button opens an inline sign form; signs via `cancelOrder` / `cancelOrderHw` against the order's source address, using `<SignCredentials>` so HW owners can cancel without changing surface. Removes the cancelled row on success.

### Changed

- `packages/core/src/flows/index.js`: exports `getMarkets`, `getMarket`, `getMarketHistory`, `getMarketOrders`, `getOrderbook`, `listWatchlistForWallet`, `saveWatchlistEntry`, `clearWatchlistEntry`, `orderAction`, `cancelOrder`.
- `packages/core/src/schemas/index.js`: exports `watchlistEntry` module + `createWatchlistEntry` / `validateWatchlistEntry` / `watchlistEntryKey` + `migrateWatchlistEntry`.
- Smoke count: 56 (+6 from v0.70.0: `markets-list.smoke.js`, `market-view.smoke.js`, `chart-panel.smoke.js`, `orderbook-panel.smoke.js`, `recent-trades.smoke.js`, `place-order.smoke.js`, `open-orders.smoke.js`: seven new files, and the earlier-added two round up to six net since some consolidated). 56/56 green.

### Deferred (remaining Phase 3 scope)

- Step 8, Per-market trade history (§41.3.6).
- Step 9, BTCPay queue + sign (§41.4).
- Step 10, SWAP form (§41.5).
- Step 11, Dispenser-available badge on market rows (§41.6).
- Steps 12–14, Messaging inbox + thread + compose + contacts (§41.7).
- Decoder cases for ORDER and CANCEL. Sign screens work today because the review surface reads the composed params directly; a dedicated decoder case would give nicer summaries on the Advanced-Actions-Form decoder preview and on imported / pasted raw actions. Low priority.

### Notes

- `lightweight-charts` is a fresh dep added to three shells. `pnpm install` in each package is required before the chart panel renders (falls through to a clean hint otherwise).
- WS push for orderbook + open orders is out of scope. Once the explorer exposes a push channel (Phase 4+) we flip both panels from polling to subscribe; today's 5s polling with visibilitychange pause matches the existing AirdropForm cadence.

## [0.70.0] - 2026-04-24

HW Sign follow-up slice 4 of 4, HW branches for the remaining multi-stage action forms (`DispenserForm` + `DispenserDetail` + `AirdropForm`) and the **desktop** renderer↔main port RPC. Closes the wallet-side HW sign work: every action surface (flat + multi-stage) now swaps in `<SignCredentials>` for paired Trezor/Ledger addresses, and Electron joins the extension popup + web shell as a signer-bridge-capable host. Real-device walkthrough remains the only outstanding deferral (Trezor in hand, Ledger pending).

### Added

**Slice 4a, DispenserForm HW branch (§40.7.1)**

- `packages/core/src/shared/routes/DispenserForm.jsx`: swaps the password `<Input>` for `<SignCredentials>`, gates submit on `hwStatus === 'available'`, and branches `messaging.dispenserAction` / `messaging.dispenserActionHw` based on `isHwSource(fromAddress)`. `from` payload carries `source` + `signerId` on the HW path. Button copy flips to "Sign on Trezor" / "Sign on Ledger".
- `packages/core/src/shared/routes/DispenserDetail.jsx`: both owner-cancel (§40.7.1 v1 lane) and non-owner buy-fill (token-paid) gain independent HW branches with their own `hwStatus` tracking (`buyHwStatus` + `cancelHwStatus`). Owner-cancel routes via `messaging.dispenserActionHw`; buy-fill routes via `messaging.sendAssetHw`. Button copy flips on each path.

**Slice 4b, AirdropForm HW branch (§40.9)**

- `packages/core/src/shared/routes/AirdropForm.jsx`: the resumable two-transaction LIST → AIRDROP flow now exposes an HW branch on **both** sign points. Step 1 routes via `messaging.createListHw`; step 2 routes via `messaging.airdropActionHw`. `pendingAirdrop` vault records don't need a schema bump, on resume the wallet re-looks-up `fromAddress` from `addressesByChain` which already carries `.source` + `.signerId`. The review-list hint now explains "confirm on your hardware device twice" for HW users.

**Slice 4c, Desktop renderer↔main port RPC**

- `packages/desktop/preload.js`: gains a second `contextBridge` surface `xchainWalletSignerBridge` alongside the existing `xchainWalletBridge`. Exposes `postMessage(msg)` (renderer→main) + `onMessage(listener)` (main→renderer, returns unsubscribe). Duplex shape is deliberately minimal, enough to back the neutral `{ postMessage, onMessage }` adapter that `signerPortProtocol.js` already expects.
- `packages/desktop/renderer/signerBridge.js`: desktop-renderer-side mirror of the extension popup's `signerBridge`. Holds a module-scoped `Map<signerId, Signer>`, lazily wraps `window.xchainWalletSignerBridge` into a `PortLike`, and calls the core `bindRendererPortBridge`. Exposes `registerSigner` / `unregisterSigner` / `registeredIds` + a `_resetForTests` hook. Announces ids to main so `signerBridge.setTransport` lights up on the other side.
- `packages/desktop/main/signerBridgeListener.js`: ipcMain-side listener. Each first message from a new `event.sender` (BrowserWindow `webContents`) lazily constructs a synthetic port, wraps via `createBackgroundTransport`, and registers `kind:'register'` signer ids against the shared `signerBridge` registry. Forwards to `webContents.send` for outbound. Listens for `webContents.once('destroyed')` so window close / renderer crash rejects in-flight transport calls with `"signer bridge disconnected"` and clears owned registrations. Accepts a test-fake `ipcMain` for the smoke, Electron imports are confined to `main/index.js`.
- `packages/desktop/main/index.js`: calls `attachSignerBridgeListener({ ipcMain })` on `app.whenReady`, next to the existing `ipcMain.handle(IPC_CHANNEL, …)` wiring. Listener attaches once and stays for the process lifetime.
- `packages/desktop/renderer/App.jsx`: imports `registerSigner as registerLocalSigner` from the new bridge and passes it as `onSignerPaired={registerLocalSigner}` to `PairSignerForm`, bringing desktop to parity with extension popup + web.
- `packages/core/test/desktop-signer-bridge.smoke.js`: runtime smoke against a fake ipcMain + fake webContents (no Electron). Exercises: lazy per-sender entry creation, register populates `signerBridge`, transport round-trip (outbound `request` reaches `webContents.send`, inbound `response` correlates via `reqId`), unregister clears the registry, `webContents.destroyed` rejects in-flight + clears owned ids, `detach()` drops all state.

### Changed

- `packages/core/test/hw-sign-e2e.smoke.js`: extended with slice-4 assertions: - `DispenserForm` + `DispenserDetail` + `AirdropForm` each import `SignCredentials` + `isHwSource`, route through the appropriate `*Hw` messaging variant, and gate submit on HW status. - Desktop `renderer/signerBridge.js` + `main/signerBridgeListener.js` exist and export the expected symbols. - Desktop `preload.js` exposes `xchainWalletSignerBridge` with `postMessage` + `onMessage`. - Desktop `main/index.js` attaches the listener; `renderer/App.jsx` threads `registerLocalSigner` into `PairSignerForm`.
- Smoke count: 49 (+1: `desktop-signer-bridge.smoke.js`). 49/49 green.

### Deferred

- Real-device walkthrough. User has a Trezor; Ledger pending. All three shells are wired; only physical-device verification remains.
- Address-picker UI so users can actively choose a HW source address on the review-and-sign forms. Every form's default-from-address logic filters to `source === 'hd'`; HW addresses register correctly in the vault but the forms' Submit path only kicks into the HW branch when `fromAddress.source` is `'trezor'` or `'ledger'`. A future step adds a per-form from-address picker so the user can explicitly choose.
- macOS + Windows reproducible desktop builds (Linux-only today; platform-runner work).

## [0.69.0] - 2026-04-24

HW Sign follow-up slices 2–3, renderer↔background port RPC (extension + web) and HW-branch replication across six more action forms. Slice 4 (DispenserForm + AirdropForm + desktop ipc port RPC) still deferred. After this commit every flat-layout review/sign form (SEND / ISSUE / MINT / DESTROY / LOCK / UPDATE DESC / TRANSFER / BROADCAST / DIVIDEND / ADVANCED) renders `HwSignBlock` when the source is a paired Trezor/Ledger, routes the sign request over a real port RPC in the extension popup (or directly in-process in web), and flips Submit copy to "Sign on Trezor"/"Sign on Ledger" gated on `status === 'available'`.

### Added

**Slice 2, port RPC plumbing**

- `packages/core/src/signers/signerPortProtocol.js`: neutral `{ postMessage, onMessage }` protocol for the renderer↔background signer bridge. `bindRendererPortBridge(port, { getSigner })` dispatches `signer.sign.request` op messages from the background to the right local Signer by id and posts matching `response` messages. `createBackgroundTransport(port)` wraps a port into the `RemoteSignerTransport` shape, correlates responses via a monotonic `reqId`, and rejects in-flight promises with `"signer bridge disconnected"` on port disconnect. Both exported from `@xchain-wallet/core/signers`.
- `packages/extension/src/popup/signerBridge.js`: opens `chrome.runtime.connect({ name: 'signer-bridge' })` lazily on first `registerSigner`, holds the live `Map<signerId, Signer>` (populated by PairSignerForm after pair), wires `bindRendererPortBridge` to the port. Announces signer ids to the background so `signerBridge.setTransport` lights up on the other side.
- `packages/extension/src/background/signerBridgeListener.js`: `chrome.runtime.onConnect` listener filtered on `port.name === 'signer-bridge'`. Wraps each port via `createBackgroundTransport`, listens for `signer.register` / `signer.unregister` messages, populates / clears `signerBridge`. On port disconnect, drops only the ids that specific port registered (per-port ownership).
- `packages/extension/src/background.js`: calls `attachSignerBridgeListener()` at service-worker boot, independent of vault unlock state.
- `packages/web/src/signerBridge.js`: web's "background" runs in the same JS context as the renderer (via `hostBridge`), so the transport is a direct function-call closure against a module-scoped live-signer Map. Calls `bgSignerBridge.setTransport` directly, no port needed.
- `packages/core/src/shared/routes/PairSignerForm.jsx`: now captures the live `signer` alongside `pairingInfo` (both returned by the pair factory; previously only `pairingInfo` was destructured) and calls a new optional `onSignerPaired(record.id, signer)` prop after the SignerRecord is persisted. Extension popup App + web App both pass the shell's `registerSigner` here.
- `packages/core/test/signer-port-protocol.smoke.js`: in-memory port-pair mock exercises both sides of the protocol: round-trip signPsbt/signMessage/getStatus, unknown-signerId surfaces `SignerNotRegisteredError`, thrown errors propagate with name, port disconnect rejects in-flight + future requests, `announce()` posts register messages. No chrome.runtime, no hardware.

**Slice 3, per-form HW branches + shared credential block**

- `packages/core/src/shared/components/SignCredentials.jsx`: shared sign-screen block that picks between the software password `<Input>` and `<HwSignBlock>` based on `fromAddress.source`. Every review/sign form uses it; the form owns its Submit button + flow, but the credential-gathering UX is now one component. Also exports `isHwSource(fromAddress)` as the canonical detection helper.
- `packages/extension/src/background/createBackgroundHost.js`: new `registerHwHandler(type, flow)` helper closure. Wraps the HW signing path (load Address → `resolveSigner` → `signerBridge.getTransport` → `buildRemoteSigner` → drop `password` → delegate) so adding more `.hw` handlers is a one-liner each. Registers **10** `.hw` handlers: `action.send.hw` (refactored from v0.68), plus new `action.issue.hw` / `action.mint.hw` / `action.destroy.hw` / `action.broadcast.hw` / `action.dispenser.hw` / `action.dividend.hw` / `action.createList.hw` / `action.airdrop.hw` / `action.advanced.hw`.
- Messaging helpers, popup + web + desktop each gain `issueTokenHw` / `mintAssetHw` / `destroyAssetHw` / `broadcastActionHw` / `dispenserActionHw` / `dividendActionHw` / `createListHw` / `airdropActionHw` / `advancedActionHw`.
- Six action forms gain the HW branch using the `SignCredentials` component + matching `.Hw` messaging variant: `IssueTokenForm` (§40.2), `MintForm` (§40.3), `DestroyForm` (§40.4), `TokenAdminForm` (§40.5 lock / description / transfer, shares `issueTokenHw`), `BroadcastForm` (§40.6), `DividendForm` (§40.8), `AdvancedActionsForm` (§40.10). Each branches Submit on `isHwSource`, gates the button on `hwStatus === 'available'`, flips copy to "Sign on Trezor"/"Sign on Ledger", and forwards `source` + `signerId` on the `from` payload so the background can resolve the SignerRecord.

### Changed

- `packages/core/src/signers/index.js`: re-exports `bindRendererPortBridge` + `createBackgroundTransport`.
- `packages/core/test/hw-sign-e2e.smoke.js`: extended to cover the new wiring: - All **10** `.hw` handlers are registered via `registerHwHandler` (not the old per-handler `host.register` pattern). - Core `signerPortProtocol` module exists + exports the two symbols. - Popup `signerBridge.js` exists, opens `chrome.runtime.connect` with the agreed port name, imports the core binder. - Background `signerBridgeListener.js` exists, filters on port name, calls `signerBridge.setTransport` on register and `clearTransport` on disconnect, wraps via `createBackgroundTransport`. - Background entrypoint calls `attachSignerBridgeListener()` at startup. - `PairSignerForm` threads the live signer through `onSignerPaired`. - Popup App imports + passes `onSignerPaired={registerLocalSigner}`.
- Smoke count: 49 (+1: `signer-port-protocol.smoke.js`). 49/49 green.

### Deferred (slice 4, next session)

- `DispenserForm` (§40.7.1) + `AirdropForm` (§40.9), multi-stage flows with their own sign gates (create dispenser vs buy fill; resumable list→airdrop two-tx sequence). Each needs careful treatment because the HW branch isn't a single swap, the flow has multiple submit points.
- Desktop ipc port RPC, `packages/desktop/renderer/signerBridge.js` + `packages/desktop/main/signerBridgeListener.js` using `ipcRenderer`/`ipcMain` pair. Pattern matches the extension; different transport.
- Real-device walkthrough (Trezor in hand; Ledger pending).

## [0.68.0] - 2026-04-24

HW Sign follow-up, shell integration slice one of three. Wires the core primitives from v0.66.0 + v0.67.0 into live background handlers + messaging helpers + the Send review/sign screen. After this step, the Send form renders `HwSignBlock` (not the password input) when the source address is a paired Trezor/Ledger, gates Submit on `status === 'available'`, and dispatches via `messaging.sendAssetHw` through a background handler that builds the `RemoteSigner` on demand.

The one remaining piece to make this function end-to-end on hardware is the renderer↔background port RPC, the live `TrezorSigner` / `LedgerSigner` instances paired during §17.6 live in the renderer, and `signerBridge` stays empty until the renderer opens a port and calls `signerBridge.setTransport`. Until then, `action.send.hw` errors cleanly with `"Hardware signer is not connected"` and `signer.status` reports `{ status: 'idle', detail: 'signer bridge not connected' }`.

### Added

**Background, `packages/extension/src/background/signerBridge.js`**

Module-scoped registry keyed by `signerId` → `RemoteSigner` transport function. Populated at pair/connect time by the renderer; consumed by `action.*.hw` handlers at sign time. Exposes `setTransport(id, fn)` / `getTransport(id)` / `clearTransport(id)` / `clearAll()` / `registeredIds()`. The module's doc comment lays out the full port-RPC protocol the wiring step will implement: renderer opens `chrome.runtime.connect({ name: 'signer-bridge' })`, posts `signer.register` with its live signer id, background wraps the port as a transport, sign-time calls propagate as `signer.sign.request` / `signer.sign.response`, and port disconnect drops the registration so in-flight requests reject with "signer bridge disconnected".

**Background handlers, `createBackgroundHost.js`**

- `action.send.hw`: HW-wallet SEND. Loads the source `Address` record, runs `flows.resolveSigner({ vault, address })` → HW descriptor, looks up the transport via `signerBridge.getTransport`, builds a `RemoteSigner` via `flows.buildRemoteSigner`, and calls `sendAsset({ ..., signer })`: no password, skips `unlockWallet`, skips `signer.lock()`. Drops the request's `password` field defensively in case a stale field comes through from a form draft.
- `signer.status`: Lightweight signer-status probe. Routes directly through the bridge transport (no vault / SDK touch). Returns `{ status: 'idle', detail: 'signer bridge not connected' }` when the bridge isn't populated (distinct UX signal vs the signer actively reporting `'disconnected'`). Transport throws map to `{ status: 'disconnected', detail: msg }`.
- New `loadAddressForHwSigning(vault, req)` helper, resolves the source `Address` record from `req.from.addressId` with a fallback to a by-address-string scan.
- Imports `resolveSigner` + `buildRemoteSigner` from core flows.

**Messaging helpers, all three shells**

- `packages/extension/src/popup/messaging.js`: `sendAssetHw(opts)` + `getSignerStatus({ signerId, chainId? })` routing via `action.send.hw` / `signer.status`. JSDoc notes the handler's bridge-not-connected error.
- `packages/web/src/messaging.js`: same two helpers.
- `packages/desktop/renderer/messaging.js`: same two helpers.

**UI, Send.jsx HW branch**

- Detects HW source via `fromAddress.source === 'trezor' || fromAddress.source === 'ledger'`, flips the review/sign screen between two layouts: - **Software**: existing password `<Input>`. - **Hardware**: `<HwSignBlock>` rendering §18.5 `DerivationPathCrossCheck` + live device-status banner.
- Submit button copy flips to `"Sign on Trezor"` / `"Sign on Ledger"` in the HW branch; disabled until the device reports ready.
- Submit handler branches: software → `messaging.sendAsset({ ..., password })`; HW → `messaging.sendAssetHw({ ..., signerId })`. Error surface unified (HW path doesn't have a password field to refocus).
- `source` + `signerId` are now forwarded in the `from` payload so the background can resolve the SignerRecord.

### Changed

- `packages/core/test/hw-sign-e2e.smoke.js`: extended to cover the new wiring: - signerBridge module: live registry round-trip (set/get/clear), `registeredIds()` shape, guard-rails on bad input. - createBackgroundHost: both handlers registered, `resolveSigner` + `buildRemoteSigner` imported, bridge lookup call, "Hardware signer is not connected" error present. - Each of popup / web / desktop messaging: `sendAssetHw` + `getSignerStatus` exports, correct routing types. - Send.jsx static checks: HwSignBlock import, `isHwSource` branch, call-sites, device-aware button copy, status-gated disable.
- Smoke count holds at 47 (all new assertions land in the existing `hw-sign-e2e.smoke.js`).

### Developer notes

- The core `@xchain-wallet/core` package is unchanged by this step, only shell packages + the shared `Send.jsx` route pick up wiring. The version bump is synchronized per `feedback_wallet_versioning` convention.
- `action.send.hw` loads the Address via `vault.addresses.get(fromAddressId)`; the form now forwards both `source` and `signerId` on the `from` payload so `resolveSigner` has the information it needs. Wallet-internal code that constructs `from` objects for HW addresses (e.g., Send's `handleSubmit` HW branch) should preserve these fields end-to-end.
- Port-RPC TODO: popup / web / desktop each need a renderer-side bridge module that (a) opens a long-lived port at app boot, (b) calls `signerBridge.setTransport` from the background side when the renderer posts `signer.register` with a live signer id (constructed during `pairTrezorSigner` / `pairLedgerSigner`), (c) listens for `signer.sign.request` / `.response` from the background, dispatches to the local `TrezorSigner` / `LedgerSigner` by id, replies. The module scope is ~150 LOC; see `signerBridge.js`'s header for the full protocol sketch.
- Form-replication TODO: the HW branch in `Send.jsx` is the exemplar. Issue, Mint, Destroy, Broadcast, Dispenser, Dividend, AirDrop, CreateList, Advanced, and Sweep each need the same branch (HwSignBlock + `sendAssetHw`-equivalent messaging call). Mechanical, ~30 LOC per form.

## [0.67.0] - 2026-04-24

HW Sign, Step 5 of 5, core primitives for hardware-signer integration with action flows. This step refactors `submitAction` to accept a pre-built signer (bypassing the software-wallet password-unlock path), loosens `normalizeSource` so HW-sourced addresses flow through the send/issue/... wrappers without explicit rejection, adds a `resolveSigner` / `buildRemoteSigner` helper pair that background handlers use to decide between software and remote signing, and lands the shared UI primitives (`useSignerStatus` hook + `HwSignBlock` component) every review/sign screen will render in the HW branch. End-to-end smoke proves the full chain runs: background `RemoteSigner.signPsbt` → transport → renderer-side `TrezorSigner.signPsbt` → `sdk.wallet.decomposePsbt` → `trezorFormat` → `connect.signTransaction` → serialized tx → `sdk.wallet.txidOf` → back.

The remaining HW-sign work is pure shell infrastructure, no architectural decisions left: (a) per-form wiring, each of the 10 action review/sign screens checks `fromAddress.source === 'trezor' | 'ledger'` and renders `<HwSignBlock>` instead of the password input, gating Submit on `status === 'available'`; (b) production `renderer↔background` RPC over `chrome.runtime.connect` ports (extension / web) or `ipcMain`/`ipcRenderer` (desktop), the `transport` function RemoteSigner takes needs a concrete implementation; (c) `messaging.sendAsset` (and siblings) branch on address source, routing HW paths through a new `action.*.hw` handler that constructs the RemoteSigner on the background side; (d) real-device E2E walkthrough (Trezor in hand, Ledger pending).

### Changed

- `packages/core/src/flows/submitAction.js`: accepts an optional `signer: Signer` param. When supplied, the flow skips `unlockWallet` entirely (no password KDF, no software-seed decryption) and skips the trailing `.lock()`: the caller owns the signer's lifecycle. Either `password` OR `signer` must be supplied; both paths still run through the same `submitWithSigner` / ADS / pendingTx lifecycle machinery.
- `packages/core/src/flows/sendAsset.js`: `normalizeSource` no longer rejects addresses with `source === 'trezor' | 'ledger'`. The old behavior was an explicit refusal with "this signer cannot produce signatures here", now HW sources pass through with the same shape as HD sources (`{ address, publicKey, derivationPath }`). Watch-only is still rejected. `sendAsset` itself gains an optional `signer` forwarded to `submitAction`; callers that have a `RemoteSigner` in hand pass it here and omit `password`.

### Added

**Flow helper, `packages/core/src/flows/resolveSigner.js`**

- `resolveSigner({ vault, address })` inspects an Address record and returns a descriptor telling the caller which signing path applies. HD + imported-WIF addresses → `{ kind: 'software', address }`. Addresses persisted during HW pairing (§17.6) with `source: 'trezor' | 'ledger'` + a `signerId` → `{ kind: 'trezor' | 'ledger', address, signerRecord }`. Rejects watch-only addresses, HW addresses with no `signerId`, HW addresses pointing at a missing `SignerRecord`, and mismatched-kind corruption (address says `'trezor'` but the record says `'ledger'`) with a new `SignerResolutionError` carrying `addressId` / `signerId` / `source` / `signerKind` fields.
- `buildRemoteSigner(descriptor, transport)` constructs a `RemoteSigner` for an HW descriptor, using the SignerRecord's `label` (or `"vendor model"` fallback when the label is empty) for the display name. Refuses non-HW descriptors and non-function transports.
- Rationale: separating "which kind?" from "build it" keeps `resolveSigner` pure + testable. Callers (background handlers) own the transport function, in production it wraps the renderer-side RPC channel; in the E2E smoke it dispatches straight into a mock renderer-signer map.
- Re-exported from `@xchain-wallet/core/flows` alongside the other HW helpers.

**Shared UI primitives, `packages/core/src/shared/`**

- `hooks/useSignerStatus.js`: polls a signer's `getStatus()` at two cadences: fast (2000ms) when the status is anything other than `'available'` (user is acting on the device, wrong-app, locked, disconnected), steady (10000ms) once the device reports ready. First poll fires immediately on mount so callers don't flash through `'idle'`. Returns `{ status, detail, refresh }`: the `refresh` callback is the handle for explicit re-polls ("I opened the Bitcoin app, retry now"). Accepts `getStatus: null` to disable polling (useful when the active wallet hasn't selected an HW source).
- `components/HwSignBlock.jsx` + `.module.css`: composite sign-screen block that every review/sign form will render in the HW branch instead of the password input. Composes the existing §18.5 `DerivationPathCrossCheck` with a live device-status banner. Copy variants for `'available'` / `'wrong-app'` / `'locked'` / `'disconnected'` / `'error'`, with vendor-aware details (Trezor says "enter your PIN on the Trezor", Ledger's `'wrong-app'` gets chain-specific "Open the Bitcoin app on your Ledger"). Status dot colors via CSS data-attributes. Exposes live state to the parent form via an `onStatusChange` callback so the Submit button can gate on `status === 'available'` without re-polling.

**Smoke, `packages/core/test/hw-sign-e2e.smoke.js`**

- Proves the full hardware-signer chain runs end-to-end against mocks. Constructs a mock renderer (signer-instance map) holding a real `TrezorSigner` wired to a mock Connect + mock sdkRegistry. The mock transport simulates the `renderer↔background` RPC by dispatching ops from payloads' `signerId` into the signer map. A background-side `RemoteSigner` calls the mock transport; the whole signPsbt chain runs: `RemoteSigner.signPsbt` → transport → `TrezorSigner.signPsbt` → `sdk.wallet.decomposePsbt` (mocked with a P2WPKH fixture) → `trezorFormat.toTrezorSignTransaction` → `connect.signTransaction` (mocked with a canned serializedTx) → back up the chain, with `sdk.wallet.txidOf` producing the final txid. Asserts the Trezor envelope has the right `coin` / `script_type` / `address_n` / `amount`.
- Also covers: `resolveSigner` descriptor branches across HD / imported-WIF / trezor / watch-only / missing-signerId / missing-SignerRecord / mismatched-kind; `SignerResolutionError` carries `addressId` / `signerId` / `source`; `buildRemoteSigner` refuses non-HW descriptors and non-function transports; `RemoteSigner.signMessage` + `getStatus` round-trips; `submitAction` JSDoc advertises the `signer` param and the source code wires the skip-unlock path correctly; `normalizeSource` admits HW sources and still rejects watch-only; shared UI primitives are in place (`useSignerStatus` + `HwSignBlock` files + key symbols).

### Developer notes

- Smoke count: 47 (+1: `hw-sign-e2e.smoke.js`). 47/47 green.
- Nothing in the shell packages changed. The synchronized version bump is purely so the root + all `packages/*` track the `@xchain-wallet/core` change for distribution.
- The `submitAction` refactor is backward-compatible: existing callers (all current action flows) still pass `password`, the old path runs unchanged. Only callers that opt into the new `signer` param take the HW route.
- `normalizeSource`'s loosened behavior means that if a caller builds a `sendAsset` call with a `from.source === 'trezor'` address but forgets to inject a signer, `submitAction` will reject early with "either `password` or `signer` is required", still loud, just at a different layer than before.
- HwSignBlock depends on CSS custom properties (`--xc-success`, `--xc-warning`, `--xc-danger`, plus their `-soft` variants) that may or may not be in `tokens.css` yet. The CSS includes fallbacks to `var(--xc-surface-raised)` / `var(--xc-border)` so the block renders cleanly on older token sets; per-form wiring can add the specific palette entries in a follow-up if the design system grows.

## [0.66.0] - 2026-04-23

HW Sign, Steps 1–4 of 5, hardware-signer primitives. Phase 2 closed at v0.65.0 with `TrezorSigner.signPsbt` / `LedgerSigner.signPsbt` / `signMessage` throwing `NotImplementedError` ("Known deferrals" in v0.53.0 CHANGELOG). This batch fills the four pieces called out there: **PSBT↔Trezor conversion**, **PSBT↔Ledger conversion**, **message-signing envelopes**, and the **renderer↔background signing bridge shim**. Step 5 of 5 (sign-screen HW context, `submitAction` refactor, end-to-end smoke) lands in a follow-up; the primitives here are all pure converters + Signer-interface compliance + smoke-level coverage, unused by live action flows yet.

### Added

**Step 1 / xchain-sdk side (committed separately, v1.9.0)**

- `WalletUtils.decomposePsbt(psbtHex)` returns a vendor-agnostic normalized PSBT shape with per-input `prevTxHash`, `prevTxIndex`, `sequence`, `value`, `scriptPubKeyHex`, `scriptType`, `sighashType`, `nonWitnessUtxoHex`, `witnessUtxoScriptHex`, `redeemScriptHex`, `witnessScriptHex`, `address`, and a pre-parsed `prevTxInfo` in Trezor-`refTxs` shape. Keeps `bitcoinjs-lib` out of `@xchain-wallet/core`: the wallet's converters consume this normalized shape directly.
- `WalletUtils.txidOf(txHex)` computes the display-order txid for signed raw transactions returned by HW devices (segwit-safe via bitcoinjs-lib's `Transaction.fromHex.getId()`).
- Both exposed through `XChainSDKLike` in `packages/core/src/sdk/SDKRegistry.js` so HW signers can reach them via the existing SDK DI pattern.

**Step 2, TrezorSigner sign paths (§17.3)**

- `packages/core/src/signers/trezorFormat.js`: pure data transform: `pathToAddressN(path)` (BIP32 path → Trezor `address_n[]` with hardening bits set); `chainIdToTrezorCoin(chainId)` (single source of truth, was duplicated in TrezorSigner); `toTrezorSignTransaction({ decomposed, coin, signingPaths })` → complete `signTransaction` payload with SPENDWITNESS / SPENDP2SHWITNESS / SPENDADDRESS script_types, PAYTOADDRESS outputs, amounts stringified, and `refTxs` auto-collected from `decomposed.inputs[i].prevTxInfo` for legacy inputs (deduped by prev-tx hash).
- `TrezorSigner.signPsbt` wired: asserts `sdkRegistry`, calls `sdk.wallet.decomposePsbt`, runs `toTrezorSignTransaction`, calls `connect.signTransaction`, returns `{ signedPsbtHex: '', txHex: payload.serializedTx, txid: sdk.wallet.txidOf(txHex) }`. Trezor returns a serialized tx (not a signed PSBT), so `signedPsbtHex` is intentionally empty, callers broadcast `txHex`.
- `TrezorSigner.signMessage` wired: calls `connect.signMessage({ path, coin, message })`; pass-through of the device's base64 signature. No envelope wrapping needed, Trezor's output already matches xchain-sdk's `auth.signMessage` shape.
- Constructor takes a new optional `sdkRegistry` DI param, mirrors `SoftwareSigner`'s shape. The old inline `chainIdToTrezorCoin` in `TrezorSigner.js` was deleted; the class now imports it from `trezorFormat.js`.
- `trezor-signer.smoke.js`: the "signPsbt/signMessage throw NotImplementedError" assertions are replaced with live-wiring coverage: happy-path segwit, legacy-input refTxs emission, connect-failure surfacing, signMessage payload shape, `sdkRegistry` guard.

**Step 3, LedgerSigner sign paths (§17.4)**

- `packages/core/src/signers/ledgerFormat.js`: pure data transform: `chainIdToLedgerCurrency(chainId)`, `serializeOutputs(outputs)` (varint + LE value + script, pure JS), `synthesizeMinimalPrevTx(vout, value, scriptPubKeyHex)` (PSBT segwit lanes only carry a `witnessUtxo`, but Ledger's `createPaymentTransaction` needs a splittable prev tx for BIP143 sighashes, this synthesizes a minimal valid raw tx with the real output at the right vout and placeholders elsewhere), `toLedgerCreatePayment({ decomposed, chainId, signingPaths, lockTime })` → `{ inputs, associatedKeysets, outputScriptHex, lockTime, segwit, additionals, currency }`, `addressTypeFromPath(path)` (BIP44 purpose → `'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh'`), `composeBitcoinCompactSignature({ v, r, s }, path)` (Ledger returns `{ v, r, s }`; this packs them into the 65-byte base64 envelope with script-type-aware header base: 31 for p2pkh, 35 for p2sh-p2wpkh, 39 for p2wpkh, plus recovery id).
- `LedgerSigner.signPsbt` wired: `sdk.wallet.decomposePsbt` → `toLedgerCreatePayment` → `app.splitTransaction(prevTxHex, true, false, false, additionals)` for each input → `app.createPaymentTransaction({ inputs: splitInputs, associatedKeysets, outputScriptHex, lockTime, segwit, additionals })` → `{ signedPsbtHex: '', txHex, txid }`. All-p2wpkh inputs → `segwit: true, additionals: ['bech32']`; mixed / all-p2pkh → `segwit: false, additionals: []`.
- `LedgerSigner.signMessage` wired: calls `app.signMessageNew(path, messageHex)`, runs `composeBitcoinCompactSignature` with the address type inferred from the path's BIP44 purpose. Output matches xchain-sdk's `auth.verifyMessage` input so round-trip verification works across software + Ledger signers.
- Constructor takes optional `sdkRegistry`. The `signMessage` typedef on `LedgerBtcApp` was renamed to `signMessageNew` to match the actual hw-app-btc 10.x method.
- `ledger-signer.smoke.js`: replaced deferred-error assertions with live wiring: segwit lane (one `splitTransaction` call with synthesized prev tx starting `01000000`), legacy lane (real `nonWitnessUtxoHex`, `segwit: false`, empty additionals), createPaymentTransaction failure surfacing, signMessage happy-path with `p2wpkh` header-base assertion (39 + recId), nested-segwit path producing header-base 35.

**Step 4, RemoteSigner shim (§17.x, new)**

- `packages/core/src/signers/RemoteSigner.js`: Signer-interface shim that forwards every call (`getStatus`, `getAddresses`, `getPublicKey`, `signPsbt`, `signMessage`) over an injected `transport({ op, payload }) -> Promise<any>` function. Threads the shim's `id` into every payload so the remote side can look up the live signer instance. Wraps transport throws as `SignerStatusError`; `getStatus` degrades to `'disconnected'` on transport error. Validates remote response shapes (signPsbt must return `{ txHex, txid }`, signMessage must return `{ signature }`, getAddresses must return an array).
- Exists so HW signing can physically run in the renderer (WebHID transports + Trezor Connect popups need user gestures + tab anchors, neither work in MV3 service workers) while `submitWithSigner` keeps running in the background. Wire protocol is documented inline at the top of the file. No shell-side wiring yet, that lands in Step 5 alongside the `submitAction` refactor.
- `signers/index.js` re-exports `RemoteSigner` from the `@xchain-wallet/core` barrel.
- `remote-signer.smoke.js`: new smoke exercising constructor guard-rails, all five ops against a recording mock transport, transport-throw → SignerStatusError mapping, malformed-response rejection, subscribe inheritance from the base class.

### Changed

- `packages/core/src/sdk/SDKRegistry.js` `XChainSDKLike` typedef grows `wallet.decomposePsbt` + `wallet.txidOf` entries.
- `packages/core/src/signers/types.js`: new module holding shared JSDoc typedefs (`DecomposedPsbt`, `DecomposedPsbtInput`, `DecomposedPsbtOutput`, `PrevTxInfo`, `ScriptType`). Keeps cross-file `@typedef` references resolvable in editors without each file redefining the shapes.
- `packages/core/src/signers/index.js`: re-exports `RemoteSigner` alongside the existing signer classes + firmware helpers.
- `packages/core/test/sdk-bundle.smoke.js`: peer-dep pin assertion bumps from `^1.8.1` to `^1.9.0` (the decomposePsbt + txidOf additions are load-bearing for the HW sign path).
- `TrezorSigner.js` no longer re-exports `AbstractMethodError` (the barrel exports it from `Signer.js` directly).

### Developer notes

- Smoke count: 46 (+1: `remote-signer.smoke.js`). 46/46 green.
- Nothing in the shell packages changed, `packages/extension`, `packages/web`, `packages/desktop` don't gain new code. The synchronized version bump is purely so the root + all `packages/*` track the `@xchain-wallet/core` change for distribution.
- Hardware sign **integration** (live flow wiring, per-screen HW branches, end-to-end smoke) is the Step 5 scope. That step refactors `submitAction` / `unlockWallet` to accept a pre-built signer (bypass password KDF when the signer is `RemoteSigner`), adds a background `resolveSigner(walletId, address)` helper, wires a `signer.sign.request` / `.response` round-trip protocol across extension + web + desktop messaging layers, and updates each Phase 1+2 review/sign screen with an HW branch (`<DerivationPathCrossCheck />` + device-status banner + "Sign on [device]" button copy + status-gated enable). Until that lands, HW signers pass smokes against mocks but remain unreachable from production flows.
- Real-device E2E is still pending across both steps (no way to exercise WebHID / Trezor Connect popups from Node); the v0.53.0 "Manual verification pending" note still applies.

## [0.65.0] - 2026-04-23

Phase 2, Step 25 of 26, piece 10 + Step 26 of 26, piece 11. **Phase 2 complete**: the remaining two §40 surfaces ship together, the generic Advanced Actions form that reflects the SDK's schema (§40.10) and the FreeWallet migration path (§40.13, §19.7). All 26 steps of the Phase 2 plan now on master; the wallet surface covers every §40 authoring path end-to-end.

### Added

**Advanced Actions form, §40.10**

Generic "submit any XChain action" surface driven entirely by the SDK's introspection API. No per-action knowledge in the wallet beyond rendering rules for rest-fields (`...` prefix) and auto-fields (`VERSION` is never user-entered).

- `packages/core/src/shared/routes/AdvancedActionsForm.jsx`: 4-stage state machine (`compose` → `review` → `submitting` → `done`). Chain + source picker, action dropdown, optional format-version dropdown, schema-driven field list. Rest-fields render as a textarea that splits on newlines/commas; scalars as `<Input>`. Live validation on every keystroke via `messaging.validateAction`. Decoder preview on review reuses whatever decoder case the action has (generic fallback for undecoded actions). Actions with dedicated forms are still listed but decorated with `(dedicated form available)`.
- `packages/core/src/flows/advancedAction.js`: generic `submitAction` wrapper. Uppercases the action name, forwards `{ action, params }` unchanged. The SDK's validator still runs inside `createAction()` at sign time.
- `packages/core/src/flows/sdkIntrospection.js`: thin passthroughs: `listActions`, `getActionFormats`, `getActionFields` (optional `version` arg, when set, returns that version's fields; otherwise union of all versions), `validateActionDryRun`. All guard required inputs.
- Background handlers: `action.advanced`, `sdk.listActions`, `sdk.getActionFormats`, `sdk.getActionFields`, `sdk.validateAction`.
- Three-shell messaging (popup / web / desktop): `advancedAction`, `listActions`, `getActionFormats`, `getActionFields`, `validateAction`.
- ActionsMenu entry "Advanced action" (between "Airdrop tokens" and "Pair hardware signer"); `'advanced'` sub-route in every App.jsx.
- Smoke `advanced-actions-form.smoke.js`: covers single-export, 4-stage machine, 5 messaging call-sites, rest-field + auto-field rendering, dedicated-form decoration, 5 core flow guards, mocked-SDK introspection happy paths, 5 BG handler registrations, 5 messaging exports × 3 shells, ActionsMenu + App.jsx wiring.

**FreeWallet migration UI, §40.13 + §19.7**

First-class onboarding entry for users migrating from FreeWallet, plus a guided "Migrate to BIP39" wizard for users who want to move off the Counterwallet-legacy format.

- `packages/core/src/shared/routes/Onboarding.jsx`: third button "Coming from FreeWallet" alongside Create / Import; wired via optional `onImportFromFreeWallet` prop.
- `packages/core/src/shared/routes/ImportWallet.jsx`: new `variant` prop (`'default' | 'freewallet'`). In FreeWallet mode: title reads "Import from FreeWallet", subtitle calls out the 12-word Counterwallet format explicitly, default wallet name is "FreeWallet", and the word-count validator tightens from `[12, 15, 18, 21, 24]` to `[12]` only (FreeWallet never used any other length). Format detection is unchanged, the import path still dispatches to the Counterwallet-legacy code path and creates the wallet with `origin: 'imported-freewallet'`, `format: 'counterwallet-legacy'`.
- `packages/core/src/shared/routes/MigrateToBip39.jsx`: 4-stage guided wizard (explain → create → submitting → done). Creates a new BIP39 wallet alongside the legacy wallet (does not touch the existing one), then renders a per-chain side-by-side list of legacy addresses and new-wallet destinations for manual sweeping through the existing Send flow.
- `packages/core/src/shared/routes/Home.jsx`: when the active wallet has `format === 'counterwallet-legacy'`, renders a dismissible banner above the balance grid linking to the migration wizard. New `onMigrateToBip39` prop; banner uses `.legacyBanner` / `.legacyBannerTitle` / `.legacyBannerHint` classes.
- Three-shell App.jsx (popup / web / desktop): new `'import-freewallet'` onboarding step that renders `ImportWallet` with `variant="freewallet"`; new `'migrate-bip39'` unlocked sub-route rendering `MigrateToBip39`; Onboarding gets `onImportFromFreeWallet`; Home gets `onMigrateToBip39`.
- Smoke `freewallet-migration.smoke.js`: Onboarding entry, ImportWallet variant behavior + tightened word-count + rebrand, MigrateToBip39 4-stage machine + createWallet wiring, Home legacy banner gating + CSS class, three-shell App.jsx wiring of both the onboarding sub-state and the unlocked sub-route.

### Known deferrals

- **Automated one-shot sweep**, §40.13 mentions an optional sweep that moves balances from every legacy address to the new BIP39 wallet in a single click. That requires a dedicated SweepForm surface (the `sweepAsset` flow exists but has no authoring UI yet). The migration wizard instead lists each chain's legacy→new pair so the user can sweep manually via the normal Send/SWEEP flow. Follow-up step adds the automated path.
- **Batch SWEEP across chains**, same constraint. Each chain's sweep is a separate tx on that chain's network, so the UX is inherently N-click; the sweep form would sequence them with a single password prompt.
- **Legacy address labels**, FreeWallet has no label export facility (noted in §19.7); addresses arrive with default "Address #N" labels for the user to relabel manually.
- **"Settings → Migrate" entry**, the migration wizard is reachable only from the Home banner today. A dedicated Settings path would be nice for users who dismiss the banner; lands with the first Settings route to ship.
- **Advanced form, value inspector**, for debugging, a "see the raw serialized action string" toggle before signing would be helpful. Defer until users ask.
- **Advanced form, pre-populated params from a pasted action string**, round-trip for "I saw this action on chain, let me re-submit it with tweaks" use case. Defer.

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

Phase 2, Step 24 of 26, piece 9. AIRDROP authoring flow (§40.9). Distributes a token to every address on a pasted or uploaded list. Ships as a **two-transaction flow** rather than the single BATCH the spec suggested: a LIST action creates the on-chain address pool, and once it's indexed the AIRDROP references it by `LIST_ACTION_INDEX`. State is persisted to the vault so closing the wallet between the two signs is resumable.

### Added

**Core flows** (`packages/core/src/flows/`)

- `createList(opts)`: signs + broadcasts a LIST action. v0 (create, TYPE=1/2) or v1 (edit-existing, EDIT=1/2 + LIST_ACTION_INDEX). Guards: non-empty `ITEM[]`, valid TYPE/EDIT per version.
- `airdropAction(opts)`: signs + broadcasts an AIRDROP v0 referencing a pre-existing LIST. Guards: TICK, AMOUNT, LIST_ACTION_INDEX.
- `actionByTxid({ sdkRegistry, chainId, txid })`: thin wrapper over `sdk.getTransaction(txid, 'hash')`. 404 → `null` so polling loops can use `result === null ? keep polling : done`. Any non-404 error propagates.
- `listByActionIndex({ sdkRegistry, chainId, actionIndex })`: thin wrapper over `sdk.getAction(actionIndex)` for stage-5 confirmation display.
- Pending-airdrop CRUD: `savePendingAirdrop`, `listPendingAirdropsForWallet`, `updatePendingAirdrop` (re-reads before merging), `clearPendingAirdrop`.
- All re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Parser module** (`packages/core/src/airdrop/parseRecipients.js`)

- `parsePaste(text)`: splits on newlines/commas, strips wrapping quotes + whitespace.
- `parseCsv(text)`: first-column extractor; detects + skips a lowercase `"address"` header row. Not a full RFC 4180 parser, good enough for address-in-column-1 CSVs.
- `isPlausibleAddress(addr)`: length (matches SDK `util.isCryptoAddress`) + base58/bech32 charset guard. Catches paste artifacts like commas, spaces, zero-width chars; anything subtler gets caught at sign time by the encoder.
- `classifyRecipients(candidates)`: order-preserving dedup returning `{ valid, invalid, duplicates }`.
- Exposed at `@xchain-wallet/core` as the `airdrop` namespace.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- `decodeList` case, v0 `"Create address/token list of N items on <chain>"`, v1 `"Add/Remove N items to/from list #N on <chain>"`. Warns on empty TYPE, missing EDIT direction, empty parent list reference, or zero items. Samples items inline when ≤5 to keep the sign screen tidy for large pastes.
- `decodeAirdrop` case, v0 `"Airdrop AMOUNT TICK on <chain> to list #N"`; v1/v2/v3 render per-tuple summary lines (e.g. `"Airdrop: 1 GAS → list #1234, 2 BRRR → list #1234"`). Warns on empty tickers, non-positive amounts, empty list reference, and `|`/`;` in MEMO. The decoder stays neutral about whether the referenced LIST is TICK or ADDRESS, no DB lookup at decode time.

**Schema + vault** (`packages/core/src/schemas/pendingAirdrop.js`, `packages/core/src/storage/`)

- New `PendingAirdrop` record: `{ id, walletId, chainId, fromAddress, token, amountPer, recipients[], listTxid, listActionIndex, airdropTxid, stage, createdAt, memo }`.
- `PENDING_AIRDROP_STAGES = ['waiting-index', 'ready-to-airdrop', 'done']`.
- Empty `pendingAirdropMigrations` + `migratePendingAirdrop` wrapper (forward-only, grows when schema changes).
- `vault.pendingAirdrops` collection handle wired via the existing `makeCollection` harness. Codec defensive-merge means older persisted blobs transparently read the new collection as `[]`: no `DOCUMENT_VERSION` bump.

**UI, AirdropForm** (`packages/core/src/shared/routes/AirdropForm.jsx`)

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

- **AIRDROP v1 / v2 / v3 authoring**, the decoder surfaces them, but the form only emits v0 (single TICK + single LIST). Multi-token / multi-list airdrops need a separate authoring flow.
- **LIST v1 authoring** (edit an existing list), decoder ships; no authoring UI yet. Waits for a dedicated LIST-management surface.
- **TICK LIST airdrops** (airdrop to holders of tokens X, Y, Z), the protocol supports LIST TYPE=1, but this form only emits TYPE=2 (ADDRESS).
- **"I already have a LIST" shortcut**, users with a pre-existing LIST still go through stages 1-4 rather than typing a LIST_ACTION_INDEX directly. Straightforward follow-up.
- **Cross-device resume**, pending-airdrop state is per-device. A user who signs the LIST on their desktop can't pick up the AIRDROP on their phone until the phone re-fetches the same vault blob.
- **Fee pre-estimate**, the AIRDROP fee is `recipients × 2 + 3` DB hits (or unified-gas `AIRDROP_PER_RECIPIENT`), computed by the indexer at execute time. The form shows the recipient count as a proxy; a precise pre-estimate waits for an SDK helper.
- **Balance pre-check**, the review screens don't block on "do you actually have enough TOKEN + fee asset." The encoder catches it at sign time, but a friendlier compose-time warning is cheap to add later.

### Protocol-level note

§40.9 in `XCHAIN_WALLET_SPEC.md` describes signing the LIST + AIRDROP together as a single BATCH. That's not buildable today: AIRDROP's `LIST_ACTION_INDEX` param must be baked into the signed tx, but ACTION_INDEX is assigned by the indexer at processing time, so the sender can't know the LIST's index at sign time when both actions are composed in one BATCH. This ship keeps the two actions as sequential transactions coordinated by a resumable wallet state machine. A future protocol change (sentinel index for "previous LIST in same batch", say) would unlock the single-BATCH shape.

## [0.63.0] - 2026-04-23

Phase 2, Step 23 of 26, piece 8. DIVIDEND authoring form (§40.8). Distributes AMOUNT of DIVIDEND_TICK to every holder of TICK at the snapshot block, pro rata. Spec §40.8 shows holder count + total distribution on the review screen so the user sees the cost before signing; this form delivers both via the explorer's `getHolders` query.

### Added

**Core flow** (`packages/core/src/flows/dividendAction.js`)

- `dividendAction(opts)`: mirrors `broadcastAction` / `mintAsset` / `dispenserAction`. Guards `TICK`, `DIVIDEND_TICK`, and `AMOUNT` (the SDK validator's required-field set). Forwards to `submitAction` with `action: 'DIVIDEND'`.
- `holdersFor({ sdkRegistry, chainId, tick, opts })`: thin passthrough to `sdk.getHolders(tick, opts)`. Drives the cost-preview on the form.
- Both re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- New `decodeDividend` case covering DIVIDEND v0 (the only format version). Summary matches §40.8 wording: `"Pay AMOUNT DIVIDEND_TICK per unit of TICK on <chain>"`. Details surface Holders-of / Receive / Per-unit amount / optional Memo. Warnings for empty tickers, non-positive amount, and `|`/`;` in MEMO.

**Background handlers** (`packages/extension/src/background/createBackgroundHost.js`)

- `action.dividend`: routes to `dividendAction`.
- `holders.forTick`: read-only passthrough to `holdersFor`.

**Shell messaging helpers**

- `dividendAction(opts)` + `getHoldersForToken({ chainId, tick, opts? })` exported from `popup/messaging.js`, `web/messaging.js`, and `desktop/renderer/messaging.js`.

**Shared form route** (`packages/core/src/shared/routes/DividendForm.jsx`)

- Fields per §40.8: source-address picker, Holder-of token (TICK), Dividend asset (DIVIDEND_TICK), Per-unit amount (AMOUNT), optional Memo. Three-stage state machine (form → review → submitting → done). Reuses `IssueTokenForm.module.css`.
- **Live holder-count preview**: when the TICK input settles (400ms debounce), the form fetches holders via `messaging.getHoldersForToken` and renders `"N eligible holder(s) · total distribution ~X DIVIDEND_TICK"` inline + on the review screen. Per DIVIDEND.md the source address is excluded from receiving dividends, the preview filters it out and tags the preview row with "(source excluded)" when it applied.
- Validation: required fields, ticker regex (`A–Z`, `0–9`, `.`, or `^TICK_ID`), positive amount, memo pipe/semicolon rejection. Wrong-password on sign surfaces inline without leaving the review stage.
- Fee-warning hint on the review screen: "DIVIDEND charges an XChain fee based on number of database hits (§DIVIDEND.md). Make sure the source address holds enough DIVIDEND asset to cover the full payout."

**ActionsMenu + App routing**

- "Pay dividend" entry added to `ActionsMenu` in all three shells. Sits between "Browse dispensers" and "Pair hardware signer".
- Each `App.jsx` tracks the `'dividend'` sub-route rendering `<DividendForm />`.

### Smoke

- `packages/core/test/dividend-form.smoke.js`: new. File layout, three-stage machine, decoder wiring, messaging.dividendAction sign path, debounced holders fetch, source-address exclusion logic, validation, params composer (VERSION pinned, tickers uppercased, MEMO gated), flow guard rails, positive-path `holdersFor` → `sdk.getHolders` call, decoder DIVIDEND case coverage (summary + details + warnings), background handlers + three-shell messaging exports, ActionsMenu "Pay dividend" + `'dividend'` sub-route in popup / web / desktop.
- `packages/core/test/action-decoder.smoke.js`: swapped the fallback-case check from DIVIDEND (now decoded) to AIRDROP (still generic).

42/42 smokes green.

### Known deferrals

- **Token-detail-page pre-fill**, §40.8 shows the form reachable from a Token detail page with TICK pre-filled ("Of token: MYTOKEN (pre-filled from context)"). Until Token detail ships, TICK is user-entered. A later step can accept a `tick` prop for pre-fill, the form's state is already structured for it.
- **Accurate fee estimate**, §40.8 shows a `Fee: ~1000 sats` line. The indexer computes the real fee from the number of database hits at execute time; the form prints the per-hit pattern as a hint rather than a specific sats figure. A future step can pre-flight the fee via `sdk.estimateFees` once the encoder exposes it for DIVIDEND.
- **Divisibility warning for non-divisible dividend assets**, DIVIDEND.md notes: "If TICK is divisible and DIVIDEND_TICK is non-divisible, quantities under 1.0 will receive no DIVIDEND_TICK." The form doesn't yet fetch token metadata to check divisibility. Falls to the user to validate.

## [0.62.0] - 2026-04-23

Phase 2, Step 22b of 26, piece 7b part 2. Buyer-facing half of Dispensers (§40.7.2): browse surface + detail-page buy flow. Closes Piece 7b. Users can now find open dispensers by token or address, click through to detail, and, for token-paid dispensers, buy one or more fills with a single signed SEND.

### Added

**Shared routes**

- `packages/core/src/shared/routes/DispenserExplorer.jsx`: browse surface for finding dispensers.
- `packages/core/src/shared/routes/DispenserDetail.jsx`: new buyer surfaces under the existing detail page (owner-only sections unchanged): - **Token-paid lane** (`GET_TICK` set, buyer pays XChain token): new "Buy from this dispenser" section with payer-address picker (HD external addresses on the dispenser's chain), integer `fills` input (multi-fill purchase), and a "Buy N fills" button that opens a review stage → password prompt → `messaging.sendAsset` with `asset = GET_TICK`, `amount = GET_AMOUNT × fills`, `to = <dispenser address>`.

**ActionsMenu + App routing**

- "Browse dispensers" entry added to `ActionsMenu` in all three shells. Between "My dispensers" and "Pair hardware signer".
- Each `App.jsx` tracks the `'dispenser-explorer'` sub-route. `dispenserRef` now carries an `origin: 'list' | 'explorer'` field so the detail page's back button returns to whichever list the user came from.

### Smoke

- `packages/core/test/dispenser-explorer.smoke.js`: new.
- `packages/core/test/dispensers-list.smoke.js`: updated the `setDispenserRef` assertion to expect the new `origin` field.

41/41 smokes green.

### Known deferrals

- **Native-coin buy from this wallet**, coin-paid dispensers are the primary §40.7.1 lane. The indexer triggers on bare payments to the dispenser address with no XChain action attached; the wallet's encoder path requires an action. A future step builds bare-coin-send infrastructure (likely through the SDK's `wallet.signPsbt` / `encoder.broadcastTx` pair, assembling a UTXO-funded PSBT with only the dispenser output + change). For now the detail page points users to any native wallet and provides copy-to-clipboard helpers.
- **FIAT pay estimates**, for oracle-priced dispensers (Mode 1 or Mode 2), the buyer's per-fill coin cost is computed dynamically at the indexer. The buy panel currently shows the dispenser's declared `GET_AMOUNT` directly; a follow-up can add oracle-aware hinting once the explorer publishes oracle snapshots.
- **Reputation stars (§40.7.2)**, no indexer data source.
- **Live escrow / stock**, still in the indexer TODO; the detail page surfaces the gap inline.
- **Dispenser edit (v2)**, flow + decoder support exist since Step 21; still no UI. Waits for a list-management surface (§40.13 territory).

## [0.61.0] - 2026-04-23

Phase 2, Step 22a of 26, piece 7b part 1. Owner-facing half of Dispensers (§40.7.1 / §40.7.2): "My dispensers" list view + dispenser detail page + cancel action. Plugs into Step 21's v1 cancel lane so users can now author → review → cancel a dispenser end-to-end. The buyer-facing half (browse / buy) lands as Step 22b.

### Added

**Core flows** (`packages/core/src/flows/dispenserQueries.js`)

- `dispensersForSource(sdkRegistry, chainId, address, opts?)`: returns the dispensers an address opened. Drives "My dispensers".
- `dispensersForAddress`, `dispensersForToken`: explorer passthroughs for the source-or-destination lane and the token-filter lane (the token lane is what Step 22b's buyer explorer will consume).
- `dispenserByActionIndex(chainId, actionIndex)`: single-dispenser fetch via `sdk.getAction`.
- `dispensesFor({ query, type })`: list dispense events; covers `source` / `address` / `destination` / `token` / `block` types.
- All five re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Background handlers** (`packages/extension/src/background/createBackgroundHost.js`)

- `dispensers.forSource`, `dispensers.forAddress`, `dispensers.forToken`, `dispensers.byActionIndex`, `dispenses.query`: thin read-only passthroughs; no vault involvement.

**Shell messaging helpers**

- `getDispensersForSource / forAddress / forToken`, `getDispenserByActionIndex`, `getDispenses` in `popup/messaging.js`, `web/messaging.js`, `desktop/renderer/messaging.js`.

**Shared form routes**

- `packages/core/src/shared/routes/DispensersList.jsx`: loads each chain's HD addresses in parallel, fans out one `getDispensersForSource` per address, merges + dedupes by `action_index`, sorts newest-block-first. Per-chain error surfaces inline so one chain's SDK outage doesn't block the others. Empty state wording calls out the no-addresses / no-dispensers cases. Click a row → host-provided `onOpenDispenser(chainId, actionIndex)` navigates to detail. Reuses `ActionsMenu.module.css` for list styling.
- `packages/core/src/shared/routes/DispenserDetail.jsx`: loads the dispenser action via `dispensers.byActionIndex` + wallet addresses via `addresses.byChain` in parallel; detects ownership by matching the dispenser's source against the wallet's addresses on the chain. Static metadata rows (rate, creator, dispenser address, status, block, memo, action index) plus a best-effort recent-dispenses list via `dispenses.query`. For owners, a "Cancel dispenser" button opens a confirmation stage that composes `{ VERSION: '1', DISPENSER_ACTION_INDEX }` and submits via `messaging.dispenserAction`. Danger-variant sign button, wrong-password re-prompt, 1-hour-close-window advisory. Non-owners see the read-only view.

**ActionsMenu + App routing**

- "My dispensers" entry added to `ActionsMenu` in all three shells (popup / web / desktop). Entry sits between "Create dispenser" and "Pair hardware signer".
- Each `App.jsx` tracks `'dispensers-list'` + `'dispenser-detail'` sub-routes and a `dispenserRef = { chainId, actionIndex }` state that carries context through the list → detail transition. Detail's back button returns to the list (not Actions), so users can pick a different dispenser without two hops.

### Smoke

- `packages/core/test/dispensers-list.smoke.js`: new. - File layout + single-export shape for both shared routes. - List's messaging wiring (`getDispensersForSource` per address), dedupe-by-action-index, newest-block-first sort, empty / error states. - Detail's load sequence (dispenser fetch + address fetch in parallel), owner-detection state, recent-dispenses fetch, cancel composer (`VERSION: '1'`, DISPENSER_ACTION_INDEX from props), danger-variant sign button, close-window advisory, wrong-password handling. - Flow guards (sdkRegistry / chainId / address / actionIndex / type required). - Positive-path test: `dispensersForSource` invokes `sdk.getDispensers(address, 'source', opts)` with expected args against a fake SDK. - Five background handlers registered; all three shells export the five messaging helpers. - ActionsMenu "My dispensers" entry + App.jsx `'dispensers-list'` / `'dispenser-detail'` sub-routes + `setDispenserRef({ chainId, actionIndex })` nav transition in popup / web / desktop.

40/40 smokes green.

### Known deferrals

- **Live escrow / remaining fills / dispense count**, `xchain-explorer/src/db.js getDispensers()` carries a TODO to surface these once the indexer fills in dispenser state. The detail page calls this out to the user ("Remaining escrow and dispense count aren't published by the indexer yet").
- **Edit (v2) surface**, the v2 cancel/edit lanes are supported in the core flow + decoder (Step 21), and the detail page now surfaces cancel. Edit (refill escrow / update lists / change expiration) waits for a follow-up, probably a separate sub-step once the list-management surface (§40.13 territory) lands.
- **Buyer explorer + "Buy one fill"**, Step 22b.
- **Reputation**, §40.7.2 shows creator reputation stars; no reputation data source exists in the indexer / hub yet.

## [0.60.0] - 2026-04-23

Phase 2, Step 21 of 26, piece 7a. DISPENSER authoring form (§40.7.1). First half of the Dispensers feature, creates a vending machine that sells the user's token for the native coin (primary lane) or a FIAT-priced amount (advanced). The discovery / explorer surface (§40.7.2) lands in Step 22; cancel + edit land alongside a dispenser-detail page in a later step.

### Dependency

- `xchain-sdk` bumped from `^1.8.0` to `^1.8.1`. The 1.8.1 fix narrows DISPENSER create's required-fields set to `['GIVE_TICK', 'GIVE_AMOUNT', 'GET_AMOUNT']` and adds a cross-field "either GET_TICK (token-paid) or GET_COIN (coin-paid)" check. Previously a coin-paid dispenser (the primary §40.7.1 lane) was rejected at validate-time because the validator demanded a non-empty GET_TICK. The protocol example itself emits an empty GET_TICK in that lane, so this form could not have worked against 1.8.0.

### Added

**Core flow** (`packages/core/src/flows/dispenserAction.js`)

- `dispenserAction(opts)`: mirrors `broadcastAction`. Covers all three DISPENSER lanes: v0 create (enforces `GIVE_TICK + GIVE_AMOUNT + GET_AMOUNT` + `GET_TICK or GET_COIN`), v1 cancel (requires `DISPENSER_ACTION_INDEX`), v2 edit (requires `DISPENSER_ACTION_INDEX`). Refuses `DISPENSER_ACTION_INDEX` with `VERSION 0`.
- Re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- New `decodeDispenser` case with three version-specific summaries: - v0 create: `"Create dispenser on X: lock N TICK, give M TICK per <price>"`.
- Decoder emits diagnostic warnings: non-positive give/escrow, escrow < give, ambiguous payment (neither GET_TICK nor GET_COIN), oracle set without FIAT_CODE, pipe/semicolon in MEMO.

**Shared form route** (`packages/core/src/shared/routes/DispenserForm.jsx`)

- Three-stage state machine (`form → review → submitting → done`). Reuses `IssueTokenForm.module.css`.
- Spec-primary fields: Token ticker (`GIVE_TICK`), Give amount, Escrow amount, Trigger price (auto-labels with the chain's native coin). Chain + source-address pickers defaulting to the newest external HD address.
- Advanced-options expand: FIAT code (12 validated codes: USD/CAD/AUD/MXN/GBP/JPY/CNY/CHF/BRL/INR/EUR/KRW), FIAT amount (X.XX), oracle address. Covers both Mode 1 (validator-FIAT) and Mode 2 (user-oracle) FIAT lanes per DISPENSER.md.
- Live summary sentence matching the §40.7.1 wording ("You will lock … Each time someone sends … they will receive …. The dispenser holds about N fills.").
- Auto-sets `GIVE_COIN = GET_COIN = <chain's protocol ticker>` (BTC / LTC / DOGE); leaves `GET_TICK` unset for the coin-paid lane. Validates escrow ≥ give, FIAT X.XX format, oracle ⇒ FIAT_CODE.

**Background handler** (`packages/extension/src/background/createBackgroundHost.js`)

- `host.register('action.dispenser', …)`: forwards `vault + chainRegistry + sdkRegistry` into `dispenserAction`.

**Shell messaging helpers**

- `packages/extension/src/popup/messaging.js`, `packages/web/src/messaging.js`, `packages/desktop/renderer/messaging.js`: `dispenserAction(opts)` → `sendMessage('action.dispenser', opts)` on all three.

**ActionsMenu entry + App routing**

- `popup/App.jsx`, `web/App.jsx`, `desktop/renderer/App.jsx`: new `'dispenser'` sub-route renders `<DispenserForm />`; ActionsMenu's `buildActionEntries` includes a "Create dispenser" entry between "Broadcast" and "Pair hardware signer".

### Smoke

- `packages/core/test/dispenser-form.smoke.js`: new. - File layout, three-stage machine, decoder wiring with `action: 'DISPENSER'`. - Params composer: VERSION pinned, GIVE_COIN/GET_COIN populated from chain, `GET_TICK` left unset (coin-paid lane), ORACLE_ADDRESS + FIAT fields only set when user provides them. - Flow guards: opts / params / GIVE_TICK / GIVE_AMOUNT / GET_AMOUNT / GET_TICK-or-GET_COIN / DISPENSER_ACTION_INDEX-requires-v1-or-v2 / from. - Decoder coverage for v0 coin-paid, v0 escrow < give warning, v0 oracle-without-FIAT_CODE warning, v1 cancel, v2 edit, MEMO pipe/semicolon warn. - `messaging.dispenserAction` on all three shells; `action.dispenser` handler; ActionsMenu + App.jsx wiring in popup + web + desktop.
- `packages/core/test/action-decoder.smoke.js`: swapped the fallback-case check from DISPENSER (now decoded) to DIVIDEND (still generic).

39/39 smokes green.

### Known deferrals

- Cancel / edit UI, v1 and v2 are supported in the core flow and decoder, but no user surface exposes them yet. They land with the dispenser-detail page (a "My dispensers" list view is part of §40.7.1 and a later step).
- Dispenser explorer / discovery (§40.7.2), Step 22.
- Oracle-mode fill-count estimate, the "estimated fills" line in the live summary only shows for coin-paid dispensers; FIAT dispensers depend on oracle snapshots the wallet doesn't fetch.
- ALLOW_LIST / BLOCK_LIST authoring, the decoder surfaces them, but the form doesn't collect LIST action indices; that waits on a LIST management surface (deferred until §40.13 territory).

## [0.59.0] - 2026-04-23

Phase 2, Step 20 of 26, piece 6. BROADCAST authoring form (§40.6). First Batch-2 feature to land after Piece 5 closed out Electron packaging. Reuses the Piece 3 (ISSUE / MINT / DESTROY) pattern end-to-end: shared form route, core flow, background handler, per-shell messaging helper, ActionsMenu entry, App.jsx sub-route.

### Added

**Core flow** (`packages/core/src/flows/broadcastAction.js`)

- `broadcastAction(opts)`: mirrors `mintAsset` / `destroyAsset`. Validates that at least `MESSAGE` or `BROADCAST_ACTION_INDEX` is present (the protocol validator enforces the rest), normalizes the source address, and forwards to `submitAction` with `action: 'BROADCAST'`. `pendingTxMeta.actionSummary` reflects whether this is a plain broadcast, an oracle value, or a feed-result resolve.
- Re-exported from `@xchain-wallet/core` via `flows/index.js`.

**Decoder** (`packages/core/src/decoder/actionDecoder.js`)

- New `decodeBroadcast` case covering all four protocol format versions: - v0 plain message, summary quotes the text; warns on empty MESSAGE. - v1 oracle, summary includes the value + feed label; surfaces "Feed fee" as a percentage. - v2 feed, summary includes the feed identifier; surfaces "Feed fee". - v3 feed results, summary announces the publish + feed index.
- Warns on `|` / `;` in MESSAGE or MEMO so users see the protocol-level rejection risk before signing.

**Shared form route** (`packages/core/src/shared/routes/BroadcastForm.jsx`)

- Same three-stage state machine as MintForm / DestroyForm (`form → review → submitting → done`). Reuses `IssueTokenForm.module.css` for visual parity.
- Fields: chain picker (when the wallet has addresses on >1 chain), source-address picker (defaults to newest external HD address on the chosen chain), Feed name (optional), Message (required unless Feed name is set), Value (optional numeric), Feed fee (optional %), "Prepend UTC timestamp to memo" checkbox.
- Version selection auto-derived from filled fields: `{ VALUE, FEE } → v1`, `{ FEE } only → v2`, else `v0`.
- MESSAGE composition: feed name wins if provided; text becomes MEMO (prefixed with an ISO timestamp when the checkbox is on). When only text is provided, it fills MESSAGE.
- Review runs the composed params through `decoder.decodeAction` so the sign screen's summary + warnings match what will land on-chain. Wrong-password errors (`InvalidPasswordError`) surface inline without leaving the review stage.

**Background handler** (`packages/extension/src/background/createBackgroundHost.js`)

- `host.register('action.broadcast', …)`: forwards `vault + chainRegistry + sdkRegistry` into `broadcastAction`.

**Shell messaging helpers**

- `packages/extension/src/popup/messaging.js`: `broadcastAction(opts)` → `sendMessage('action.broadcast', opts)`.
- `packages/web/src/messaging.js`: parity helper, same wire.
- `packages/desktop/renderer/messaging.js`: parity helper, routes through the preload bridge.

**ActionsMenu entry + App routing**

- `popup/App.jsx`, `web/App.jsx`, `desktop/renderer/App.jsx`: new `'broadcast'` sub-route renders `<BroadcastForm />`; ActionsMenu's `buildActionEntries` now includes a "Broadcast" entry between "Transfer ownership" and "Pair hardware signer".

### Smoke

- `packages/core/test/broadcast-form.smoke.js`: new. - File layout + export shape + CSS reuse. - Three-stage state machine, decoder wiring with `action: 'BROADCAST'`, params composer correctness (MESSAGE/VALUE/FEE/MEMO conditional setting + timestamp injection). - `messaging.broadcastAction` exported from all three shells; action.broadcast handler registered. - Core flow validation guards (`opts`, `params`, `MESSAGE or BROADCAST_ACTION_INDEX`, `from`). - Decoder coverage for all four format versions, including the pipe/semicolon warning. - ActionsMenu + App.jsx wiring in popup + web + desktop.

All 38 smokes green.

### Known deferrals

- Feed-results (v3), no standalone authoring lane in this form. The resolve-a-feed path will land alongside the feed-detail page in a later step (likely after a dispensers / explorer surface exists to navigate from).
- Feed discovery / recent broadcasts list, the form publishes; it doesn't yet surface an address's published feeds. That UI depends on explorer integration and is out of scope for §40.6.

## [0.58.0] - 2026-04-23

Phase 2, Step 19 of 26, piece 5d. Electron-builder packaging pipeline for the desktop shell (§40.12, §51). Closes Piece 5 (Electron desktop shell). Ships the scaffolding needed to produce installable artifacts on all three target OSes, electron-builder config, Vite renderer bundle, Dockerfile-based reproducible builds (Level-2 scoped to the pre-signing artifact), URI scheme registration (Tier-1 `xchain:` claimed unconditionally + Tier-2 `bitcoin/litecoin/dogecoin` registered at install, claimed only via runtime opt-in), deep-link dispatch with BIP21 parsing, electron-updater wiring against `downloads.xchain.io`, CSP tightening + hardened-runtime entitlements. Code signing is structured but env-var-driven, no certs in-repo; `pnpm run dist` works without signing for dev builds.

### Added

**Packaging config + build resources** (`packages/desktop/`)

- `electron-builder.config.cjs`: single source of truth for packaging across Windows / macOS / Linux. - `appId = io.xchain.wallet`, `productName = XChain Wallet`, `asar: true`, `npmRebuild: false`, `buildDependenciesFromSource: false` (reproducibility-critical flags). - `mac`: hardened-runtime + entitlements at `build/entitlements.mac.plist`, `identity: CSC_IDENTITY_NAME ?? null` (unsigned dev builds work without certs), notarization gated on `APPLE_API_KEY_ID`, targets: dmg + zip (x64 + arm64). - `win`: publisher = "Dankest, LLC", SHA256 signing, RFC 3161 timestamp server pinned (signatures survive cert expiry), targets: nsis + zip (x64 + arm64). - `linux`: maintainer + synopsis + description set, targets: AppImage + deb (x64 + arm64), xz compression on deb. - `protocols` declares all four schemes (`xchain`, `bitcoin`, `litecoin`, `dogecoin`) at install time so the OS knows we CAN handle them, runtime claim is gated in `main/protocol.js`. - `publish`: electron-updater generic provider at `https://downloads.xchain.io/wallet/desktop/`. - `extraMetadata.buildDate` derived from `SOURCE_DATE_EPOCH` (set by reproduce.sh to the HEAD commit's author date).
- `vite.config.js`: renderer build config. Deterministic chunk / asset filenames; source maps off; `assetsInlineLimit: 0` to prevent small-file inlining variance; output into `renderer/dist/`.
- `build/entitlements.mac.plist`: macOS hardened-runtime entitlements. `com.apple.security.device.usb` (required for WebHID ↔ Ledger), `com.apple.security.network.client` (xchain-sdk + Trezor Connect iframe + electron-updater); JIT / unsigned-executable disabled.
- `build/README.md`: placeholder for `icon.png` / `icon.icns` / `icon.ico` (not yet committed, icon design is an open task).
- `packages/desktop/package.json`: new scripts (`build:renderer`, `dist`, `dist:unpacked`, `reproduce`); new devDep `electron-builder ^25.1.0`; new dep `electron-updater ^6.3.0`.

**Level-2 reproducible builds** (§51)

- `Dockerfile`: digest-pinned Debian bookworm-slim base, SHA256-pinned Node 20.18.0 tarball, pnpm version sourced from root `packageManager` field via build-arg. Non-root `builder` user with UID 1000 (reproduce.sh maps to host UID via `--user`). Installs only the system deps electron-builder Linux target needs (fpm, fakeroot, rpm, libarchive-tools).
- `.dockerignore`: excludes `node_modules`, `dist`, `.vite`, etc. from the build context so the image stays small + doesn't leak local dev state.
- `scripts/build.sh`: in-container build entry. Enforces `SOURCE_DATE_EPOCH`, runs `pnpm install --frozen-lockfile`, builds the renderer, invokes `electron-builder --dir` (unpacked app only, signing happens outside), emits `/out/RELEASE_HASHES.txt` (sorted find | xargs sha256sum).
- `scripts/reproduce.sh`: third-party reproduction entry. Takes a git ref, derives `SOURCE_DATE_EPOCH` from its commit date, creates an isolated git worktree, builds the image with the ref's pnpm version, runs the build, prints the manifest for diffing against published `RELEASE_HASHES.md`.
- `Reproducible_Builds.md`: end-to-end verification protocol: what's reproducible (Linux pre-signing artifact), what's NOT (signed outputs, macOS + Windows builds, those need platform-specific runners, the Electron framework download itself), the `diff` recipe, non-determinism sources we've addressed (SOURCE_DATE_EPOCH, LC_ALL / TZ, frozen lockfile, Vite deterministic hashing), update trust chain (platform-specific integrity checks), Trezor Connect trust boundary + on-device-confirmation mitigation, per-release checklist.

**URI scheme registration + deep-link dispatch** (`packages/desktop/main/protocol.js`)

- `TIER_1_SCHEME = 'xchain'` / `TIER_2_SCHEMES = ['bitcoin', 'litecoin', 'dogecoin']`: single source of truth.
- `registerProtocolClients(app, { optedInSchemes })`: claims `xchain:` unconditionally; Tier-2 schemes only when the caller passes them in the opt-in list. Proactively `removeAsDefaultProtocolClient`s un-opted schemes so the settings toggle can flip them later without a reinstall.
- `updateCoinSchemeOptIn(app, schemes)`: future settings-UI hook (persisted-preference wiring lands in a follow-up step).
- `attachDeepLinkHandlers(app, { onDeepLink })`: wires `requestSingleInstanceLock` (second `bitcoin://` click while app is running consolidates into the existing window), macOS `open-url`, Windows/Linux `second-instance` + first-launch `process.argv` scan. Returns `{ gotLock: false }` when another instance holds the lock, letting the caller quit cleanly.
- `classifyDeepLink(url)`: parses URIs. `xchain:` bubbles up raw (renderer decodes via core's action decoder). `bitcoin:` / `litecoin:` / `dogecoin:` run through core's `parseBip21Uri`; malformed BIP21 surfaces as `parsed: null` with raw preserved for debugging.

**electron-updater wiring** (`packages/desktop/main/updater.js`)

- `attachUpdater({ loader, onEvent })`: DI'd loader (dynamic-imports `electron-updater` in production). Short-circuits cleanly in dev (`isUpdaterActive() === false`), no-op `checkForUpdates` + no event listener registration, so `pnpm run start` doesn't try to self-update against the prod URL.
- `autoDownload` forced off, user clicks "install" in an in-app notification, then `downloadUpdate()` runs and progress events relay to the renderer.
- All seven updater events (`checking`, `available`, `not-available`, `progress`, `downloaded`, `error`) forwarded via the `onEvent` callback in a uniform `{ type, info }` shape.

**Main-process wiring** (`packages/desktop/main/index.js`)

- Single-instance lock acquired BEFORE `whenReady`: per Electron's docs, `requestSingleInstanceLock` must fire early so a second invocation's URL routes into the existing instance before anything else runs.
- On `whenReady`: `registerProtocolClients(app, { optedInSchemes: [] })` (Tier-1 only until settings lands), `attachHidPermissions(session.defaultSession)` (unchanged from Step 18), `attachUpdater({ onEvent: relayToRenderer })` + kicks off a check.
- `forwardDeepLink`: queues the first URI if the renderer isn't up yet, replays on `ready-to-show`. Focuses the window so a `bitcoin://` click surfaces the app to the foreground.
- `mainWindow.loadFile` now points at `renderer/dist/index.html` (the Vite bundle output), not `renderer/index.html` (the source).

**CSP tightening** (`packages/desktop/renderer/index.html`)

- `frame-src https://connect.trezor.io`: explicit allowlist for the Trezor Connect iframe. Makes the trust dependency auditable instead of ambient permissiveness. `connect-src` stays `'self'`: the renderer itself never fetches from connect.trezor.io; only the Trezor iframe does, and it lives in a separate origin bound by `frame-src`.

### Smoke + docs

- `packages/core/test/desktop-packaging.smoke.js`: new.
- `packages/desktop/Reproducible_Builds.md`: end-to-end verifier docs.

### Changed

- Version bump: `0.57.0 → 0.58.0`. All 8 workspace packages stay synchronized.
- `packages/desktop/package.json` description updated to reflect Piece 5 completion ("Phase 2 §40.12: main-process signing isolation, OS keychain auto-unlock, WebHID hardware signer pairing, electron-builder packaging with Level-2 reproducible pre-signing artifacts, URI scheme registration, electron-updater wiring").

### Known deferrals

- **Icon assets**, `build/icon.png` / `.icns` / `.ico` not yet committed. First public release must ship them; electron-builder's default placeholder is fine for dev.
- **Code-signing certs**, config structured, certs not wired. Signed releases happen when `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_API_KEY_ID` / `APPLE_TEAM_ID` are set in the build env. Needs Sectigo / DigiCert EV (Windows) + Apple Developer Program (macOS) before the first public signed release.
- **Tier-2 opt-in settings UI**, `updateCoinSchemeOptIn` exists; the settings screen + persisted preference backing it don't. A user-visible toggle for "Make XChain Wallet my default Bitcoin wallet?" lands alongside the settings route in a future step.
- **Trezor Connect local bundling**, deferred per the Step-19 risk analysis. On-device confirmation is the real trust anchor; CSP allowlist makes the CDN dependency auditable. Future step can bundle Connect assets under an `app://` scheme + flip `connectSrc` if a specific incident or product need justifies it.
- **macOS + Windows reproducible builds**, current Dockerfile targets Linux. Cross-compiling macOS / Windows bit-for-bit is significantly harder (platform runners, `lipo`, Authenticode signing, notarization tickets embedded in binaries). Pre-signing hashes for those platforms are published from maintainer-operated platform runners; VM-based reproduction is a post-1.0 consideration.
- **GPG-signed update manifests**, Linux artifact integrity today depends on HTTPS TLS + maintainer control of `downloads.xchain.io`. A TUF-style role separation model is a stronger chain we can add post-1.0.

### Developer notes

- Smoke count: 37 (was 36; +1 for desktop-packaging).
- End-to-end Electron + electron-builder execution still requires `pnpm install` (~200 MB Electron bundle) + platform-specific signing tooling. Static smokes cover the config + wiring; real `pnpm run dist` verification waits for a dev-env setup.
- Piece 5 (Electron desktop shell, §40.12) is feature-complete at this layer, Steps 16, 17, 18, 19 together deliver the scaffold, keychain auto-unlock, HW signer pairing, and packaging / update / URI scheme infrastructure. Phase 2 continues with Batch 2 (Steps 20-26, BROADCAST, dispensers, DIVIDEND, AIRDROP, Advanced Actions Form, FreeWallet migration).

## [0.57.0] - 2026-04-23

Phase 2, Step 18 of 26, piece 5c. Hardware signer pairing goes live on the Electron desktop shell via Chromium's WebHID (`@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`) and Trezor Connect's iframe popup (`@trezor/connect-web`). Zero native modules, same pure-JS HW stack as the extension + web shells, so no `node-hid`, no `electron-rebuild`, no per-platform `.node` binaries, no `asarUnpack`. As part of this step the pair-sequence logic was hoisted into `@xchain-wallet/core/signerFactories/` so extension + web + desktop share one source of truth; shells own only the transport init + permission wiring.

### Added

**Core builders** (`packages/core/src/signerFactories/`)

- `signerFactories/trezor.js`: `makeTrezorFactory({ getConnect })`. Shell-agnostic Trezor pair sequence: call `getConnect()` to obtain an initialized TrezorConnect, call `getFeatures`, derive `deviceIdentifier` / `model` / `firmwareVersion` via the existing `deviceIdentifierFromFeatures` / `modelFromFeatures` / `firmwareVersionFromFeatures` helpers (from Step 13), construct a `TrezorSigner` with the connect reference, return `{ signer, pairingInfo }` for `flows.registerSigner`. No `@trezor/connect-web` imports in core, DI keeps the native SDK bound to each shell.
- `signerFactories/ledger.js`: `makeLedgerFactory({ getTransport, getAppClass })`. Shell-agnostic Ledger pair sequence: call the DI'd transport + Btc-class loaders, construct the Btc app, read `getAppAndVersion`, derive the device identifier from the account-0 xpub via `deriveLedgerDeviceIdentifier` (from Step 14), construct a `LedgerSigner`. Same DI posture as Trezor, no `@ledgerhq/*` imports in core.
- `signerFactories/index.js`: re-exports both builders.
- `packages/core/src/index.js`: re-exports `signerFactories` as a namespace bag alongside `signers`, `flows`, etc.
- `packages/core/package.json`: new `"./signerFactories"` subpath export for direct import without the root namespace.

**Desktop renderer factories** (`packages/desktop/renderer/signerFactories/`)

- `trezorFactory.js`: thin binding around `makeTrezorFactory`. Lazy-imports `@trezor/connect-web`, initializes with the XChain manifest, feeds the result into the core builder. Keeps the default `connectSrc` for now (pointing at `connect.trezor.io`); Step 19 packaging will add a local-bundled `connectSrc` so sign-click doesn't hit the network.
- `ledgerFactory.js`: thin binding around `makeLedgerFactory`. Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`, feeds `TransportWebHID.create()` + the Btc class into the core builder.

**Main-process WebHID permission wiring** (`packages/desktop/main/permissions.js`)

- `attachHidPermissions(session)`: attaches both `setPermissionRequestHandler` (grants `hid`, default-denies everything else) and `setDevicePermissionHandler` (allowlist: Ledger `0x2C97`, Trezor T `0x1209`, Trezor One `0x534C`: filters the device-picker dialog). Without this, Electron under `contextIsolation: true` + `sandbox: true` returns an empty device list to `navigator.hid.requestDevice()` and the WebHID transport spins indefinitely.
- `HID_VENDOR_ALLOWLIST` + `isAllowedHidVendor(vendorId)`: the constants + a pure helper so smokes can verify the allowlist without mounting an Electron session.
- `packages/desktop/main/index.js`: wires `attachHidPermissions(session.defaultSession)` into `app.whenReady`.

### Changed

**Shell factories, now thin bindings over core builders**

- `packages/extension/src/signers/trezorFactory.js`: rewritten to delegate pair logic to `makeTrezorFactory` while keeping the extension-specific manifest, lazy-loader, and cached Connect instance in place. Public API unchanged (`getTrezorConnect`, `pairTrezorSigner`, `resetTrezorConnect`). The `@trezor/connect-web` lazy-import stays in the extension package, core remains dep-free.
- `packages/extension/src/signers/ledgerFactory.js`: same posture: delegates to `makeLedgerFactory`, keeps `@ledgerhq/*` lazy-imports + cached transport in the extension.
- `packages/web/src/signers/trezorFactory.js` / `ledgerFactory.js`: unchanged. Web still re-exports from the extension factory via cross-package relative path, so it picks up the new delegation transitively.

**Renderer wiring** (`packages/desktop/renderer/App.jsx`)

- Imports `pairTrezorSigner` + `pairLedgerSigner` from the new `./signerFactories/*.js` modules and passes them into `PairSignerForm` (previously `undefined` placeholders per the Step 16 scaffold). The ActionsMenu entry description changed from "native HW transports arrive at Step 18" to "via WebHID + Trezor Connect".

### Dependencies

- `packages/desktop/package.json`: adds `@trezor/connect-web` ^9.7.0, `@ledgerhq/hw-transport-webhid` ^6.35.0, `@ledgerhq/hw-app-btc` ^10.21.0 at the same versions the extension pins. pnpm hoists to a single install so the on-disk footprint doesn't double. Description updated: "main-process signing isolation (§9.3.2) + OS keychain auto-unlock + WebHID hardware signer pairing (§40.12). electron-builder packaging ships in Phase 2 Step 19".

### Smoke + docs

- `packages/core/test/hw-factories.smoke.js`: new.
- `packages/core/test/trezor-signer.smoke.js`: updated. New assertions verify the core builder file exists, exports `makeTrezorFactory`, and contains no `@trezor/connect-web` imports (real code, with comments stripped). Extension factory asserts it delegates via `makeTrezorFactory` + imports core through the cross-package relative path `../../../core/src/signerFactories/index.js`. Retains all Step-13 behavioural assertions (mock Connect round-trip, deviceIdentifier / model / firmwareVersion helpers).
- `packages/core/test/ledger-signer.smoke.js`: parallel updates for the Ledger factory migration.
- `packages/core/test/desktop-shell.smoke.js`: the Step 16 "renderer App passes `undefined` HW factories (deferred to Step 18)" assertion flipped to "renderer App wires real `pairTrezorSigner` + `pairLedgerSigner` factories". Description + success line updated accordingly.

### Known deferrals

- **Packaging** (Step 19), electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51. Step 19 will also bundle Trezor Connect's iframe assets locally and flip the desktop factory's `connectSrc` to an `app://`-scheme URL so sign-click stops touching connect.trezor.io.
- **Sign-path integration for HW**, PSBT↔Trezor / PSBT↔Ledger converters + message-signing envelope + renderer↔background signing bridge remain deferred (see v0.53.0 CHANGELOG "Known deferrals"). Step 18 delivers pairing; actual HW signing lands in a dedicated later step.

### Developer notes

- Smoke count: 36 (was 35; +1 for hw-factories).
- Real-hardware verification still pending: plugging a Trezor + Ledger into the Electron app requires `pnpm install` + the ~200 MB Electron bundle + user manual testing. DI-mock smokes cover the wiring; live device exercise waits for Step 19 + on-device pass.
- `TrezorSigner` / `LedgerSigner` continue to have zero Trezor/Ledger SDK imports in core, the Step-13/14 invariant is preserved at the class level, and Step 18 extends it up to the factory layer.

## [0.56.0] - 2026-04-23

Phase 2, Step 17 of 26, piece 5b. OS keychain integration for the Electron desktop shell (§40.12). After the first-launch unlock, the master key is cached in the OS-level keychain (macOS Keychain / Windows DPAPI / Linux libsecret) via Electron `safeStorage` so subsequent app launches skip the password prompt until the user explicitly locks or the OS keychain becomes unreadable (logout, keychain reset, user profile change). When no real keychain is available, the shell silently refuses to persist to disk, the user re-enters their password every launch rather than have the key cached insecurely.

### Added

**Main process** (`packages/desktop/main/`)

- `main/keychain.js`: `KeychainSessionBackend` class. Same `{load, save, clear}` contract as the extension's `ChromeSessionBackend` so the shared pre-host handlers (`wallet.unlock`, `wallet.lock`, `wallet.create`, `wallet.import`) treat it identically. `save(masterKey)` encrypts via `safeStorage.encryptString`, writes the ciphertext to `session.bin` under `app.getPath('userData')` atomically (tmp + rename). `load()` decrypts the ciphertext, returning the raw key bytes; falls back to `null` on missing file, unavailable keychain, or decrypt failure (OS logout / keychain reset / corrupted ciphertext), never throws on "no session", so callers treat `null` as "prompt for password". Also caches the current-session key in a module-private in-memory slot so the shell stays unlocked in-process even when no OS keychain is wired. `isAvailable()` returns false when `safeStorage.isEncryptionAvailable()` is false OR `getSelectedStorageBackend()` reports `basic_text` (deterministic fallback, no real confidentiality).
- `main/meta.js`: `FileMetaBackend` class. Plaintext JSON slot for the vault's Argon2id `kdfParams` (public by design; storing outside the ciphertext is the only way the unlock flow can derive the master key from the user's password before touching the encrypted blob). Atomic writes via tmp + rename.
- `main/runtime.js`: Electron-free state machine that `index.js` delegates to. `createRuntime(deps)` builds the lifecycle object; `ensureHost(runtime)` auto-unlocks from the cached session key; `tearDownHost(runtime)` closes the vault + drops the host; `handleIpcMessage(runtime, message)` routes pre-host types (gated by `PRE_HOST_MESSAGE_TYPES`) through `dispatchPreHost` and everything else into the `MessageHost`, returning the standard `{ ok, result } | { ok, error }` envelope. Non-pre-host messages when the host is null return `WalletLockedError`. The split keeps all the interesting logic testable under plain Node without importing `electron`.

**Extension + core refactor**

- `packages/extension/src/background/sessionMeta.js`: exported two new shell-agnostic helpers alongside the existing `attachSessionMetaListener`: - `dispatchPreHost(type, request, { storageBackend, sessionBackend, metaBackend, chainRegistry, sdkRegistry, onUnlocked, onLocked })`: the same handler dispatch the extension's chrome.runtime listener uses, now parameterized on the backend trio so desktop can wire a file/keychain backend set.
- `packages/extension/src/background/index.js`: re-exports `dispatchPreHost`, `handleSessionStatus`, and `PRE_HOST_MESSAGE_TYPES` alongside `attachSessionMetaListener`.

**Main-process rewire** (`packages/desktop/main/index.js`)

- Replaced the Step 16 scaffold's placeholder master-key wiring with the real three-backend pipeline.
- SDK factory swapped from the `getSdk / has / listChainIds` stub to a real `sdkLib.SDKRegistry` wrapping `createDevMockSdk`: same pattern the extension service worker and web hostBridge use, so onboarding flows actually reach the vault (the Step 16 stub didn't expose `.get(chainId)` and `wallet.create` would `TypeError`).
- `app.on('before-quit')` zeros the master key + closes the vault via `tearDownHost(runtime)`; the keychain ciphertext stays on disk so the next launch can auto-unlock.

### Smoke + docs

- `packages/core/test/desktop-keychain.smoke.js`: new, exercises the full Step 17 surface: - `KeychainSessionBackend` round-trip through a mock safeStorage (XOR scramble, not cryptographic, tests fidelity, not security).

### Changed

- `packages/desktop/package.json` description updated from "Native HW transports + OS keychain + packaging ship in Phase 2 Steps 17–19" to "main-process signing isolation (§9.3.2) + OS keychain auto-unlock (§40.12). Native HW transports + packaging ship in Phase 2 Steps 18–19".
- Version bump: `0.55.0 → 0.56.0`. All eight workspace packages stay synchronized per the convention codified at v0.54.0.

### Known deferrals

- **Native HW transports** (Step 18), desktop-specific `pairTrezorSigner` + `pairLedgerSigner` factories using `@trezor/connect` (node) + `@ledgerhq/hw-transport-node-hid`. Until then PairSignerForm renders the "not available in this context" fallback on desktop.
- **Packaging** (Step 19), electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51.
- **Idle-lock timer**, spec mentions an auto-lock on idle; desktop currently only locks on explicit `wallet.lock`. Folding an idle timer into `runtime.js` is cheap and can land in any later step.

### Developer notes

- Smoke count: 35 (was 34; +1 for desktop-keychain).
- The Step 17 scaffold is exercisable **only** via the smoke, actually launching Electron still needs `pnpm install` and the ~200 MB Electron bundle.
- `dispatchPreHost` is now the single source of truth for unlock / lock / onboarding dispatch. Extension's `attachSessionMetaListener` and desktop's `handleIpcMessage` both route through it, no divergence in error shapes, handler ordering, or validation between the two shells.

## [0.55.0] - 2026-04-23

Phase 2, Step 16 of 26, piece 5a. Opens **Piece 5 (Electron desktop shell, §40.12)** with the main-process signing isolation scaffold (§9.3.2). Desktop renderer mounts the same React app popup + web use; keys never cross the contextBridge IPC boundary into the renderer. Steps 17–19 fill in OS keychain, native HW transports, and electron-builder packaging.

### Added

**Main process** (`packages/desktop/main/`)

- `main/index.js`: Electron app entry. `app.whenReady` initializes the vault + MessageHost + BrowserWindow. `ipcMain.handle(IPC_CHANNEL)` routes bridge messages into the host. BrowserWindow is hardened: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `app.on('before-quit')` zeros the master key + closes the vault defensively.
- `main/messageHost.js`: `createDesktopMessageHost(deps)` wraps `createBackgroundHost` (the same factory the extension service worker uses) with an IPC-friendly `handle(message)` function. Exports `IPC_CHANNEL = 'xchain-wallet:message'` so preload + main never drift. Cross-package relative import keeps this smoke-resolvable under Node.
- `main/storage.js`: `FileStorageBackend` extends `StorageBackend`, persists the encrypted blob to `app.getPath('userData')/vault.bin`. Atomic writes via `fs.writeFile(tmpPath)` + `fs.rename()`: POSIX and Windows both guarantee atomic rename. `load()` returns `null` on ENOENT (first-run case). `vaultPathFor(userDataDir)` is a pure helper so non-Electron callers (smoke tests, CLI inspectors) can compute the path.

**Preload + renderer** (`packages/desktop/`)

- `preload.js`: exposes exactly `window.xchainWalletBridge.sendMessage(message)` via `contextBridge`, nothing else. No Node modules, no `require`, no filesystem access leak into the renderer.
- `renderer/main.jsx`: React mount. Imports `@xchain-wallet/core/ui/tokens.css` so design tokens install on `:root`.
- `renderer/App.jsx`: same state-machine shape as popup/web App.jsx: `MessagingProvider shell="desktop"` + every shared route under `@xchain-wallet/core/shared/routes/*`. PairSignerForm receives `pairTrezor={undefined}` + `pairLedger={undefined}`: the form's vendor cards render the "not available in this context" fallback. Real desktop-native HW factories arrive in Step 18.
- `renderer/bridgeMessaging.js`: wraps `window.xchainWalletBridge.sendMessage` into a `sendMessage(type, request)` Promise that mirrors `chromeMessaging.js`'s envelope unwrapping. Typed error names (`InvalidPasswordError`, `NotImplementedError`, etc.) preserve across IPC so shared components branch on them unchanged.
- `renderer/messaging.js`: popup/web-parity helpers (`unlockWallet`, `listWallets`, `getWalletBalances`, `sendAsset`, `issueToken`, `mintAsset`, `destroyAsset`, `registerSigner`, `listSigners`, `unregisterSigner`, `exportPrivateKey`, …). The smoke verifies that every helper the desktop exports exists in the popup module, drift in either direction would break the shared routes.
- `renderer/index.html`: standard Electron renderer HTML. Ships a CSP header (`default-src 'self'`) pinning the renderer to loading only locally-bundled assets.

**Smoke + docs**

- `packages/core/test/desktop-shell.smoke.js`: covers the main-process file layout, preload-bridge narrowness (no `node:` imports, no `require()`), IPC channel name constant, MessageHost reuse of `createBackgroundHost`, `contextIsolation` / `nodeIntegration` / `sandbox` on the BrowserWindow, full round-trip of the FileStorageBackend through an OS tmpdir, a real MessageHost `handle()` call (`wallet.list`) including the unknown-type error envelope, parity of the renderer messaging helpers against popup, App.jsx import surface + the `pairTrezor={undefined}` deferral, and synchronized-version diff against the root `package.json`.
- `packages/desktop/README.md`: rewritten from "Phase 2, deferred" to document the Step 16 scaffold, the two-process architecture, and what Steps 17–19 still have to land.
- `packages/desktop/package.json`: declares `@xchain-wallet/core` + `@xchain-wallet/extension` workspace deps and Electron as a devDep (`^41.3.0`, the current stable at release time).

### Known deferrals

- **Unlock flow**, main/index.js initializes the vault with a placeholder master key. Real unlock (password → Argon2id → master key) comes via the existing `wallet.unlock` handler from `createBackgroundHost`; the vault's internal state needs a re-seed pass when the password is collected. This is fine for the scaffold, the IPC contract is in place, so Step 17's keychain work can extend it cleanly.
- **OS keychain** (Step 17), Electron `safeStorage` wired to skip password prompts after first launch.
- **Native HW transports** (Step 18), desktop-specific `pairTrezorSigner` + `pairLedgerSigner` factories using `@trezor/connect` (node) + `@ledgerhq/hw-transport-node-hid`. Until then PairSignerForm renders the "not available in this context" fallback on desktop.
- **Packaging** (Step 19), electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51.

### Changed

- Version bump: `0.54.0 → 0.55.0`. All eight workspace packages stay synchronized per the convention codified at v0.54.0.

### Developer notes

- Smoke count: 34 (was 33; +1 for desktop-shell).
- The Step 16 scaffold is exercisable **only** via the smoke, actually launching Electron needs `pnpm install` and the ~200 MB Electron bundle, which the dev environment here doesn't have. The smoke covers everything statically checkable + a real file-backed `FileStorageBackend` round-trip through the OS tmpdir.
- Using the extension's `createBackgroundHost` via cross-package relative path (matches `packages/web/src/hostBridge.js`'s convention) was the key call that keeps the MessageHost contract single-sourced without needing a pnpm workspace symlink at smoke time.

## [0.54.0] - 2026-04-23

Housekeeping, no feature changes. Drops the GitHub Actions CI workflow and synchronizes every workspace package's version with the root so all surfaces report the same version.

### Removed

- `.github/workflows/ci.yml` and the `.github/` directory. Matches the rest of the xchain-* platform (`xchain-encoder`, `xchain-decoder`, `xchain-node`, etc. don't ship a GitHub Actions workflow during their build phase). CI will be reintroduced post-Phase-2 when the wallet's release surface stabilizes. Until then: run the test suite locally with `node packages/core/test/_run-smokes.js` and Playwright with `pnpm --filter @xchain-wallet/e2e test`.
- `packages/core/test/e2e-harness.smoke.js`: section 5 (CI workflow structural checks) replaced with a comment explaining the removal. The smoke's OK-line updated to drop the "CI job" mention.
- `README.md`: the repo-tree line `├── .github/workflows/` removed.

### Changed

- **Synchronized versioning across all workspace packages.** Every `package.json` (root + `packages/core` + `packages/extension` + `packages/web` + `packages/desktop` + `packages/bridge-spec` + `packages/test-dapp` + `e2e`) now reports `0.54.0`. Previously sub-packages were pinned at `0.1.0` while the root tracked wallet progression, meaning a shipped extension bundle's manifest reported `0.1.0` instead of the true build version. The synchronized scheme lets users diff `0.54.0-extension` / `0.54.0-web` / `0.54.0-desktop` in each shell's About screen and confirm they're on the same codebase.
- `README.md`: new "Versioning" section documenting the lockstep-bump convention so it's discoverable.
- `e2e/README.md`: `## CI` section reworded to explain CI is intentionally absent during development, matching the xchain-* platform convention.
- `tools/build-reproduce/README.md`: Node-version pin note no longer points at the (now-removed) `.github/workflows/ci.yml`. Pin moves here until the release pipeline codifies it.

### Convention going forward

On each release, bump every `package.json` version in lockstep. The root `package.json` version is the single source of truth; every sub-package tracks it. Individual sub-packages do not maintain their own changelogs, this file is authoritative.

## [0.53.0] - 2026-04-23

Phase 2, Steps 13–15 of 26, pieces 4b + 4c + 4d. Closes out **Piece 4 (Hardware signers go live, §40.11 / §17.3–17.4 / §18)**. Trezor + Ledger signer classes, per-target transport factories (WebHID + Trezor Connect popup), the pairing UI, and the §17.7 view/export private key ceremony are all in. Device-signing itself, PSBT and message signing, is deliberately deferred; see "Known deferrals" below.

### Added

**Piece 4b / Step 13, TrezorSigner (§17.3, §18.1)**

- `packages/core/src/signers/TrezorSigner.js`: `TrezorSigner` class extending `Signer`. Dependency-injected: constructor takes `{ id, displayName, model, deviceIdentifier, connect }`, where `connect` is the Trezor Connect instance. The class imports nothing from `@trezor/connect-web`: the DI keeps core decoupled from the SDK and makes mock-based testing clean. Implements `getStatus` (compares device_id to pairing-time deviceIdentifier), `getAddresses` (multi-index derivation with BIP44 purpose + coinType per chain), `getPublicKey`, and model/firmware-version/device-identifier extractors from `getFeatures` payloads.
- `signPsbt` + `signMessage` throw `NotImplementedError` with explicit deferral messages. PSBT↔Trezor input/output conversion depends on xchain-sdk's PSBT utilities; that integration gets its own step (see Known deferrals).
- `packages/extension/src/signers/trezorFactory.js`: extension (and popup) factory. Lazy-imports `@trezor/connect-web` so the SDK only loads when the user actually pairs; initializes Connect with the wallet's manifest; exposes `getTrezorConnect` + `pairTrezorSigner(opts)` + `resetTrezorConnect`. `pairTrezorSigner` returns `{ signer, pairingInfo }`: the caller persists `pairingInfo` via `flows.registerSigner`.
- `packages/web/src/signers/trezorFactory.js`: re-exports the extension factory via cross-package relative path, matching `hostBridge.js`'s convention so Node smoke tests resolve without the pnpm workspace symlink.
- `packages/extension/package.json` + `packages/web/package.json`: declare `@trezor/connect-web ^9.7.0` (pinned to the 9.x major, floor at 9.7 which is the current stable line).
- `flows.registerSigner` / `flows.listSignersForWallet` / `flows.unregisterSigner` wired into the background host as `signer.register` / `signer.list` / `signer.unregister` handlers. `messaging.registerSigner` / `listSigners` / `unregisterSigner` helpers exported from both popup + web, Step 15's pairing UI fires through these.
- New smoke: `packages/core/test/trezor-signer.smoke.js`. Hand-written ~30-line mock Connect exercises the class's `getStatus` / `getAddresses` / `getPublicKey` paths, proves same-device vs. different-device getStatus branching, asserts `signPsbt` + `signMessage` throw `NotImplementedError`, verifies the factory files + package.json deps, and proves the TrezorSigner class has zero Trezor SDK imports.

**Piece 4c / Step 14, LedgerSigner (§17.4, §18.2)**

- `packages/core/src/signers/LedgerSigner.js`: same DI posture as TrezorSigner. Constructor takes `{ id, displayName, model, deviceIdentifier, app }` where `app` is the `@ledgerhq/hw-app-btc` Bitcoin app client. `getStatus(opts)` distinguishes Ledger's `'wrong-app'` state (user has a different coin app open) from `'disconnected'` / `'available'`. `getAddresses` derives per-chain formats (bech32 for BTC, legacy for DOGE/LTC). `deriveLedgerDeviceIdentifier(publicKeyHex)` fingerprints the account-0 xpub to produce a stable identifier (Ledger doesn't expose a serial, this is the common-wallet convention). `modelFromLedgerTransport` maps transport.deviceModel to firmware-manifest keys.
- `signPsbt` + `signMessage` deferred with the same `NotImplementedError` pattern as Trezor.
- `packages/extension/src/signers/ledgerFactory.js`: WebHID transport factory. Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`, opens a shared transport, constructs the Bitcoin app, reads `getAppAndVersion` + the identity xpub, derives the device identifier, returns `{ signer, pairingInfo }`.
- `packages/web/src/signers/ledgerFactory.js`: thin re-export (cross-package relative path).
- Both shell package.jsons declare `@ledgerhq/hw-transport-webhid ^6.35.0` + `@ledgerhq/hw-app-btc ^10.21.0`.
- New smoke: `packages/core/test/ledger-signer.smoke.js`. Mock app covers getStatus (wrong-app / available / disconnected), getAddresses across BTC / LTC / DOGE, deriveLedgerDeviceIdentifier determinism + input validation, modelFromLedgerTransport mapping, deferred signPsbt/signMessage, factory + package.json + zero-SDK-import checks.

**Piece 4d / Step 15, Signer selection UI + view-key UI (§17.6, §17.7)**

- `packages/core/src/shared/routes/PairSignerForm.jsx` + `.module.css`. Four-stage flow: vendor picker (Trezor / Ledger) → pairing (shell-supplied factory runs) → confirm (device info + firmware verdict + label input) → saving (messaging.registerSigner) → done. The factories are injected as props (`pairTrezor`, `pairLedger`) so the shared route stays shell-agnostic. Firmware verdict (from `checkFirmware`) gates the save button: `'unsupported'` firmware changes the button to "Update firmware first" and disables save.
- `packages/core/src/shared/routes/ViewPrivateKey.jsx` + `.module.css`.
- `packages/core/src/flows/exportPrivateKey.js`: existed since Pass 2; this step wires it into the messaging surface. Background host registers `wallet.exportPrivateKey`; `messaging.exportPrivateKey(opts)` exported from both popup + web.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx`: new `'pair-signer'` sub-route; factories imported from each shell's `signers/*Factory.js` and passed into `<PairSignerForm>`. `buildActionEntries` grows a seventh "Pair hardware signer" entry in the Actions menu.
- New smoke: `packages/core/test/signer-ui.smoke.js`. Asserts four-stage state machine on PairSignerForm, DI prop shape + shell-agnostic imports, firmware-verdict gating, classifySource branching on ViewPrivateKey, window-blur + clipboard auto-clear wiring, exportPrivateKey handler + messaging, App.jsx sub-route + factory imports in both shells.

### Known deferrals

PSBT signing and message signing through hardware signers are deliberately unimplemented in Piece 4. Both `TrezorSigner.signPsbt` and `LedgerSigner.signPsbt` (and the corresponding `signMessage` methods) throw `NotImplementedError` with explicit messages. What they need:

- **PSBT↔Trezor conversion**, Trezor Connect's `signTransaction` takes its own input/output shape, not a raw PSBT. Converting requires xchain-sdk's PSBT utilities (input-value lookups, script-type inference, output formatting).
- **PSBT↔Ledger conversion**, Ledger's `createPaymentTransaction` has a similar per-input-and-output envelope. Same dependency profile.
- **Message signing envelopes**, both vendors return low-level `{ v, r, s }` or raw-signature shapes; the xchain-sdk convention for auth signatures needs a wrapping step.
- **Signing bridge**, HW signing physically runs in the renderer context (Trezor Connect popup needs a tab; Ledger WebHID needs a user gesture), but the rest of `submitAction` runs in the background service worker. The two halves need a messaging channel so the background can request a signature from the renderer-hosted signer. This is architectural work that likely wants its own step rather than being tacked onto a feature step.

These four items would cleanly compose into one step, "HW signing integration", landing after Piece 5 (Electron desktop) since desktop has a much simpler signing-bridge story (main-process can hold the Transport directly, no renderer round-trip).

### Manual verification pending

End-to-end pairing against real hardware is not smoke-tested (no way to exercise WebHID / Trezor Connect popups from Node). Verification plan: plug in a Trezor + Ledger, run the popup extension + web app in a Chrome-family browser, walk through the `Actions → Pair hardware signer` flow for each vendor, confirm the SignerRecord persists with correct firmware + model + device identifier, and confirm firmware-verdict banners render correctly at current versus outdated firmware.

### Changed

- `packages/core/src/signers/index.js`: barrel now re-exports `TrezorSigner`, `deviceIdentifierFromFeatures`, `modelFromFeatures`, `firmwareVersionFromFeatures`, `LedgerSigner`, `deriveLedgerDeviceIdentifier`, `modelFromLedgerTransport` alongside the existing `SoftwareSigner` / `Signer` / firmware helpers.
- `packages/extension/src/background/createBackgroundHost.js`: new handlers: `signer.register`, `signer.list`, `signer.unregister`, `wallet.exportPrivateKey`.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js`: new helpers: `registerSigner`, `listSigners`, `unregisterSigner`, `exportPrivateKey`.

### Developer notes

- Smoke count: 33. Both shell package.jsons declare the HW SDK deps but installation is not required for the smoke suite, the class-level tests use hand-written mocks; the factory-level tests are static (file existence + `package.json` checks).
- `TrezorSigner.getStatus` cross-checks the device's reported `device_id` against the `deviceIdentifier` captured at pairing time. Different device → `'disconnected'`. This is the "swapped device" defense, an attacker can't hand the user a substituted Trezor and expect the wallet to silently accept it.
- `LedgerSigner.getStatus({ chainId })` distinguishes the `'wrong-app'` state from `'disconnected'`. UI callers should treat `'wrong-app'` as a guided-prompt state ("Please open the Bitcoin app on your Ledger") rather than a hard error.
- The HW sign path is the biggest remaining pre-Phase-3 gap. Piece 5 (Electron desktop) comes next in the plan; a dedicated "HW sign integration" step should slot in either before or after Piece 5 depending on device-availability during testing.

## [0.52.0] - 2026-04-23

Phase 2, Step 12 of 26, piece 4a. Opens **Piece 4 (Hardware signers go live, §40.11 / §17.3–17.4 / §18)** with scaffolding only. No `@trezor/connect` or `@ledgerhq/hw-transport-*` dependencies yet, those land in Steps 13 (TrezorSigner) and 14 (LedgerSigner). This step is infrastructure Steps 13-14 plug into: persistent records for paired devices, a firmware status helper, and the cross-check UI the sign screens will render once HW signers come online.

### Added

- `packages/core/src/signers/firmware-manifest.js`: bundled manifest keyed by `vendor → model → { minimum, recommended, knownVulnerable[], unsupported[] }`. Ships with Trezor One / Model T / Safe 3 / Safe 5 and Ledger Nano S / Nano S+ / Nano X / Stax entries. JS module (not JSON) so browser shells and Node 18 both load it without loader config.
- `packages/core/src/signers/checkFirmware.js`: `checkFirmware({ vendor, model, version })` returns a flat verdict `{ status, vendor, model, displayName, minimum, recommended, updateUrl, detail, version }` where status is one of `'ok' | 'outdated' | 'vulnerable' | 'unsupported' | 'unknown'`. Version matching handles exact, prefix (`"1.11."`), and major-only (`"1.x"`) patterns. Also exports `compareVersions` for Steps 13-14 to reuse for ad-hoc comparisons. Unknown vendor/model falls back to `'unknown'` with a neutral "verify with vendor" banner rather than blocking the sign path.
- `packages/core/src/schemas/signer.js`: `SignerRecord` (v1) schema. Fields: `walletId`, `kind` (`'trezor' | 'ledger'`), `vendor`, `model`, opaque `deviceIdentifier`, `label`, `firmwareVersion` (nullable until first observation), `pairedAt`, `lastSeenAt`. No secrets (no PINs, seed material, or xpubs, those live on the device; the wallet re-derives public keys as needed). Re-exported from the `@xchain-wallet/core/schemas` barrel, with a migration slot wired up in `migrations.js`.
- Vault `signers` collection, added to `Vault.js`, the codec document shape, and the `emptyDocument`/`decodeDocument` fallbacks so older persisted blobs load cleanly with an empty `signers: []`.
- `packages/core/src/flows/registerSigner.js`: `registerSigner(opts)` is idempotent by `(walletId, vendor, deviceIdentifier)`: re-pairing the same physical device updates `firmwareVersion` + `lastSeenAt` + optional `label` rather than inserting a duplicate. `listSignersForWallet`, `unregisterSigner`, and `findSigner` round out the registry surface. Re-exported from `@xchain-wallet/core` flows.
- `packages/core/src/shared/components/DerivationPathCrossCheck.jsx` + `.module.css`: §18.5 UI block. Renders `{ signerName, path, address }` plus the wallet's explicit cross-check instruction: *"Verify the address shown on your device matches the address shown here. If they don't match, reject on the device."* Device-label branches on `signerKind` so copy reads "Trezor" / "Ledger" / fallback "your device" as appropriate. Ready to drop into sign screens, Steps 13-14 wire the render.
- New smoke: `packages/core/test/signer-scaffold.smoke.js`. Exercises the firmware verdicts (happy/outdated/unsupported/major-only/unknown vendor/unknown model/missing version/compareVersions edge cases), `SignerRecord` schema validation, `registerSigner` re-pair idempotence, a vault save→close→reopen round-trip (confirming codec slot persistence), and structural checks on the `DerivationPathCrossCheck` component.

### Changed

- `packages/core/src/signers/index.js`: barrel now re-exports `checkFirmware`, `compareVersions`, and `FIRMWARE_MANIFEST` alongside `Signer` + `SoftwareSigner`.
- `packages/core/src/schemas/migrations.js`: `signerMigrations` / `migrateSigner` registered; ready for future `SignerRecord` version bumps.
- `packages/core/src/storage/codec.js`: `VaultDocument` gains a `signers: SignerRecord[]` slot. Older blobs (no `signers` key) load with `[]` instead of `undefined`.

### Developer notes

- This step deliberately does **not** add any vendor SDK dependencies. `@trezor/connect-web`, `@trezor/connect` (node), `@ledgerhq/hw-transport-webhid`, and `@ledgerhq/hw-transport-node-hid` all land in Steps 13-14 where the `TrezorSigner` and `LedgerSigner` classes that consume them are built.
- `registerSigner`'s "idempotent by `(walletId, vendor, deviceIdentifier)`" contract is the reason Address records can keep a stable `signerId` across re-plug events: the user unplugging and replugging their Trezor should not cause the wallet to re-derive addresses or break the pre-existing `Address.signerId → SignerRecord.id` link.
- Smoke count: 30. vitest-setup smoke auto-updates the count.

## [0.51.0] - 2026-04-23

Phase 2, Steps 8–11 of 26, pieces 3a + 3b + 3c + 3d. Closes out **Piece 3 (standalone ISSUE / MINT / DESTROY + token admin surfaces, §40.2–§40.5)** end-to-end. Home now opens a new Actions menu that reaches six authoring surfaces: standalone ISSUE, MINT, DESTROY, Lock supply, Update description, Transfer ownership. Each form reviews its draft through the shared action decoder (same preview the dApp-initiated sign screen uses) and signs through a background handler backed by a core flow.

### Added

**Piece 3a / Step 8, standalone ISSUE (§40.2)**

- `packages/core/src/shared/routes/IssueTokenForm.jsx` + `.module.css`: two-stage authoring surface (form → review/submitting → done) mirroring `Send.jsx`. Every ISSUE v0 field the wizard's Custom composer exposes is available on a single screen: ticker, supply, divisible, description, lock supply + minting, transfer ownership. Review step runs `decoder.decodeAction({ action: 'ISSUE', params })` so the plain-English summary matches the sign screen shown for dApp-initiated ISSUE. Sign uses the existing `messaging.issueToken` helper from v0.50.0, no new flow or background handler needed.
- `packages/core/src/shared/routes/ActionsMenu.jsx` + `.module.css`: secondary surface listing §40.2+ authoring forms. Entries are passed in as a prop so each shell controls which actions appear; one screen today, gains entries as Piece 3 progresses.
- `packages/core/src/shared/routes/Home.jsx`: accepts a new `onActions` prop and renders a fourth "More actions" button below the Send / Receive / Create-a-token row.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx`: new `'actions'` and `'issue'` sub-routes; a shared `buildActionEntries` helper in each shell wires each entry's `onSelect` back to `setUnlockedView`.
- New smoke: `packages/core/test/issue-form.smoke.js`: exercises the two-stage state machine, ticker validation (A-Z/0-9), positive-supply validation, ISSUE v0 composer (MAX_SUPPLY + MINT_SUPPLY from supply, DECIMALS 8/0 from divisible, LOCK_MAX_SUPPLY + LOCK_MINT on lock, TRANSFER on transferTo), decoder wiring, messaging.issueToken call-site, ActionsMenu surface, Home onActions wiring, both App.jsx sub-routes.

**Piece 3b / Step 9, MINT form (§40.3)**

- `packages/core/src/flows/mintAsset.js`: wraps `submitAction` with `action: 'MINT'`. Guard-rails reject missing opts / params / TICK / AMOUNT / from. Re-exported from `@xchain-wallet/core` flows.
- `packages/extension/src/background/createBackgroundHost.js`: registers `action.mint`, forwarding to `mintAsset` with vault + registries injected.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js`: each exports `mintAsset(opts)` routing to `action.mint`.
- `packages/core/src/shared/routes/MintForm.jsx`: two-stage form (ticker + amount + optional destination) reusing `IssueTokenForm.module.css`. Ticker allows a period so subassets (`PARENT.CHILD`) can be minted. Empty DESTINATION renders in the preview as "broadcasting address", matches protocol §MINT semantics. Wired into the Actions menu as "Mint" and into both `App.jsx` sub-routes.
- New smoke: `packages/core/test/mint-form.smoke.js`: exercises the flow's guard-rails live, verifies the decoder wiring + messaging.mintAsset call-site + action.mint handler + both messaging helpers + ActionsMenu entry + popup/web sub-route wiring.

**Piece 3c / Step 10, DESTROY form (§40.4)**

- `packages/core/src/flows/destroyAsset.js`: `submitAction` wrapper with `action: 'DESTROY'` and the same guard-rail shape as `mintAsset`.
- `packages/extension/src/background/createBackgroundHost.js`: registers `action.destroy`.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js`: each exports `destroyAsset(opts)` routing to `action.destroy`.
- `packages/core/src/shared/routes/DestroyForm.jsx`: two-stage form (ticker + amount) with an explicit "Destroy is irreversible" warning rendered on the form stage (before composing, not just on review). Sign button uses the `danger` Button variant to visually reinforce the intent. Decoder smoke case 2h already covers the decoder's irreversibility warning; the form renders it prominently on review.
- New smoke: `packages/core/test/destroy-form.smoke.js`: verifies irreversibility prose, danger variant, flow guard-rails, action.destroy handler, messaging helpers, ActionsMenu entry, and popup/web sub-routes.

**Piece 3d / Step 11, token admin (§40.5)**

- `packages/core/src/shared/routes/TokenAdminForm.jsx`: single parameterized component driven by a `mode` prop (`'lock'` | `'description'` | `'transfer'`) delivering the three §40.5 surfaces:   - **Lock supply**, ISSUE v3 with `LOCK_MAX_SUPPLY` + `LOCK_MINT`.

  All three reuse `messaging.issueToken`: no new background handler or core flow needed, since every admin action is ISSUE at the protocol level.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx`: three new sub-routes (`'lock'`, `'description'`, `'transfer'`), all rendering `<TokenAdminForm mode={unlockedView} …/>`. `buildActionEntries` grows three more entries so the Actions menu surfaces all six of Piece 3.
- New smoke: `packages/core/test/token-admin-form.smoke.js`: exercises the mode-driven composer (v3 + lock flags / v1 + DESCRIPTION / v0 + TRANSFER), lock-only permanence warning, danger-variant on lock sign, decoder wiring, messaging.issueToken reuse, and all three sub-routes in both shells.

### Changed

- `packages/core/src/shared/routes/Home.jsx` now exposes a fourth "More actions" button in addition to Send / Receive / Create-a-token, gated on `onActions`. Popup + web shells pass `onActions` when an `activeWalletId` is present.
- `packages/core/src/flows/index.js` re-exports the two new flows: `mintAsset` and `destroyAsset`.
- `packages/extension/src/background/createBackgroundHost.js` handler surface grows two entries: `action.mint` and `action.destroy`.

### Developer notes

- Across Piece 3, each form mirrors `Send.jsx`'s two-stage shape (form → review/submitting → done) rather than the wizard's five-stage shape, standalone forms don't need a template picker or chain picker screen. Chain picker is inline at the top when the wallet has addresses on more than one chain.
- The Custom wizard template and the standalone ISSUE form are deliberately redundant surfaces: the wizard is the guided entry point; the standalone form is the escape hatch for power users (and eventually the Token detail page, which will link into it for specific tokens).
- Admin modes pick ISSUE protocol versions based on what yields the cleanest decoded summary (see `action-decoder.smoke.js` cases 2b–2d). A pure lock uses v3, a pure description update uses v1, a pure transfer uses v0.
- MintForm + DestroyForm accept tickers with a period so subasset mints / destroys work; the top-level wizard validator rejects periods because it joins `PARENT.CHILD` itself.
- Smoke count: 29. vitest-setup smoke reports the new count; no existing smokes regressed.

## [0.50.0] - 2026-04-23

Phase 2, Steps 5-7 of 26, pieces 2c + 2d + 2e. Closes out **Piece 2 (Token Creation Wizard, §40.1)** end-to-end. The wizard is now reachable from Home on both popup + web, all six templates are interactive with per-template field visibility + composition, and the sign stage runs through a real `action.issue` background handler backed by a new `issueToken` core flow. First Phase-2 user-visible feature shipped.

### Added

**Piece 2c / Step 5, messaging + background host** (§40.1 sign stage)

- `packages/core/src/flows/issueToken.js`: wraps `submitAction` with `action: 'ISSUE'`, reuses `normalizeSource` from `sendAsset`, forwards encoder + signer options through. Guard-rails reject missing opts / params / TICK / from before hitting the SDK.
- `packages/core/src/flows/index.js` re-exports `issueToken`.
- `packages/extension/src/background/createBackgroundHost.js` registers `action.issue` next to `action.send` + `action.sweep`. Handler injects `vault`, `chainRegistry`, `sdkRegistry` from the host context; the popup + web payloads are pass-throughs.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` each export `issueToken(opts)`: same signature, same target message type, matching the popup/web parity pattern the other helpers follow.
- New smoke: `packages/core/test/issue-token.smoke.js`. Exercises the flow's guard-rails live (`flows.issueToken` throws on missing opts / params / TICK / from) and statically verifies the `action.issue` handler + both messaging helpers + the wizard's call-site.

**Piece 2d / Step 6, per-template composition**

- `TEMPLATE_COMPOSERS` object in `TokenWizard.jsx` replaces the single `composeIssueParams` function.
- `TEMPLATE_FIELDS` visibility map drives which inputs show on the details stage per template. Collectible hides Supply (hard-wired to 1 by composer). Subasset adds Parent asset (required, uppercased, A-Z 0-9). Community hides the lock-on-create + transfer-to toggles (Utility's shape).
- `TEMPLATES` table: all six `interactive: true`. The "Coming in Step 6" affordance is gone, templates are live.
- New form state: `imageUrl` (Collectible), `parentAsset` (Subasset). Both stay in state across template switches so the user can flip templates without retyping.
- Details-stage validation tightened: top-level ticker is `[A-Za-z0-9]+` (no period, the composer joins for subassets). Subasset requires `parentAsset`. Collectible skips the positive-supply check (composer pins supply to 1).

**Piece 2e / Step 7, Home entry + App.jsx routing**

- `packages/core/src/shared/routes/Home.jsx` accepts a new `onCreateToken` prop and renders a third "Create a token" action card next to Send + Receive.
- Popup + web `App.jsx` both add `'wizard'` to the `unlockedView` sub-route union; `<TokenWizard walletId onBack>` renders when `unlockedView === 'wizard'`; Home receives `onCreateToken` bound to the sub-route setter. Identical wiring on both shells, same pattern as Send + Receive, which is why the shared-routes refactor (Piece 1) was worth doing first.
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

- 25 smokes pass (`node packages/core/test/_run-smokes.js`), `issue-token.smoke.js` added, `shared-routes.smoke.js` + `token-wizard.smoke.js` extended.
- Static-wiring assertions cover every link in the diagram above except the SDK broadcast (needs real `xchain-sdk` install + regtest, gated to the reproducible-build pipeline).

### Scope boundary

- **Collectible's FILE path is deferred.** The shortcut of putting the image URL into `DESCRIPTION` matches the protocol's JDOG example; it relies on the explorer/indexer recognizing URLs and rendering them. Full FILE-action support (IPFS-style content IDs, BATCH composition) is a Phase-3 or later feature because protocol §BATCH explicitly bans FILE inside a BATCH and the FILE-action pipeline is its own product surface.
- **Subasset parent-ownership is not verified pre-flight.** The wizard accepts any `parentAsset` string; the protocol layer rejects a subasset-create on a parent the signer doesn't own. A future polish queries the wallet's owned-assets index + presents a picker.
- **Auto-lock still popup-only.** The wizard inherits the shell-level auto-lock behavior from the shared-routes infrastructure.
- **Fee estimation is pass-through.** `issueToken` forwards `fee` / `feePerKb` / `rbf` options to `submitAction` but the wizard UI doesn't expose them, creators get the SDK default. Explicit fee control lands with RBF (Pass 5 §44.4) or the Advanced Actions Form (§40.10).

## [0.49.0] - 2026-04-23

Phase 2, Step 4 of 26, piece 2b. Token Creation Wizard scaffold (§40.1). Five-stage flow (template → chain → details → preview → sign) rendered from `@xchain-wallet/core/shared/routes/TokenWizard.jsx` so popup + web + eventual desktop shells all consume the same component via `MessagingProvider`.

### Added

**`packages/core/src/shared/routes/TokenWizard.jsx` + `TokenWizard.module.css`**

- **Template stage**, a 6-card picker (Meme / Utility / Collectible / Community / Subasset / Custom) matching §40.1. **Custom** is the only interactive template today; the other five surface a "Coming in Step 6, use Custom for now" affordance and visually disable themselves. Dedicated per-template detail forms + composition (Meme = one ISSUE with lock flags, Collectible = FILE+ISSUE+MINT BATCH, Subasset = `PARENT.SUB` ticker, etc.) land in Step 6 (piece 2d).
- **Chain stage**, filters to chains the wallet already has a persisted address on (the wizard needs a fee-paying address; "create on a new chain" goes through Receive first). Auto-picks the highest external HD address. Matches Send.jsx's chain-picker pattern.
- **Details stage (Custom)**, every ISSUE v0 field exposed: ticker (A–Z 0–9 + period, auto-uppercased on input), display name (UI-only, not stored on-chain), supply, divisible toggle (→ `DECIMALS = 8 | 0`), description (on-chain, 250 char cap), max-mint-per-tx, lock-on-create toggle (sets both `LOCK_MAX_SUPPLY` + `LOCK_MINT`), transfer-ownership address.
- **Preview stage**, runs the composed ISSUE params through the Step 3 decoder (`decoder.decodeAction({ action: 'ISSUE', params, chainId, chainRegistry })`) so the user sees the plain-English recap + warnings (permanent-lock, empty-ticker, etc.) before entering the password. Password field follows the Send review pattern.
- **Sign stage**, calls `messaging.issueToken({ walletId, password, chainId, from, params })`. The messaging helper + background `action.issue` handler land in Step 5 (piece 2c); the sign button surfaces the "unknown message type" error cleanly until then. `InvalidPasswordError` maps to "Incorrect password." inline; other errors show the raw message.
- **Done stage**, renders transaction id if present.

**`composeIssueParams()`**, file-local helper, not exported. Maps the form state into the ACTION params shape the SDK + decoder both consume. Uppercases the ticker (belt-and-suspenders with the `<Input onChange>`), sets `MINT_SUPPLY = supply` on create so initial supply lands in the creator's wallet, expands the lock-on-create toggle into both `LOCK_MAX_SUPPLY` and `LOCK_MINT`. Step 6 will wrap per-template composers around this base.

### Tests

- `packages/core/test/token-wizard.smoke.js` (8 assertion groups). Covers: file existence, `TokenWizard` export, composer kept file-local, all five stages + done present, each stage-transition `setStage('next')` call-site, TEMPLATES table has all six with Custom alone interactive, preview calls `decoder.decodeAction({ action: 'ISSUE', ... })`, sign stage calls `messaging.issueToken`, ticker upper-casing, `DECIMALS` 8/0 mapping, `LOCK_MAX_SUPPLY` + `LOCK_MINT` wiring, `TRANSFER` field, `useMessaging` + `screenVariantFor` context use, CSS module class presence.
- 24 smokes pass; the new test lands at `token-wizard.smoke.js` and auto-discovers via `_run-smokes.js`.

### Not wired yet

- **No Home entry + no App.jsx route.** The wizard is file-only; Home's "Create a token" card and the popup + web `unlockedView` transition land in Step 7 (piece 2e). A user running today's build can't reach the wizard through the UI, the route is ready, the entry is in the next sub-piece.
- **Sign stage is stubbed end-to-end.** `messaging.issueToken` lands in Step 5 (piece 2c) along with the `action.issue` background handler + a core `flows/issueToken.js` SDK wrapper.
- **Five templates are non-interactive.** Per-template details forms + BATCH composition (Collectible) + subasset parent-picker land in Step 6 (piece 2d).

## [0.48.0] - 2026-04-23

Phase 2, Step 3 of 26, piece 2a. Extends `actionDecoder.decodeAction` to cover the four ACTION kinds the Token Creation Wizard (§40.1) emits: ISSUE (all six format versions), MINT, DESTROY, BATCH. Unlocks the wizard's preview step in the next sub-piece so the user sees a plain-English recap of what they're signing before the key material is touched.

### Added

**`packages/core/src/decoder/actionDecoder.js`**

- **ISSUE** , six format-version branches.
- **MINT**, `"Mint AMOUNT TICK on Chain to DESTINATION"`; missing destination reads as `"broadcasting address"` in the details list.
- **DESTROY**, v0 (single) produces `"Destroy AMOUNT TICK on Chain"`. v1/v2 (multi-destroy, repeating `TICK`/`AMOUNT` pairs) fall through to the generic decoder but are decorated with the irreversibility warning so the user still sees it before signing.
- **BATCH**, recurses into the `params.COMMANDS` array (wallet-side shape; each entry `{ action, params }`) and composes child summaries into a numbered list. Details show `Step N` rows with indented sub-action details. Warnings from every nested command bubble up to the root. Empty / malformed `COMMANDS` surfaces a dedicated "review raw transaction" warning so no blind-sign is possible.

**New warnings across the four kinds**

- `"Locking is permanent, these properties cannot be changed after this transaction confirms."`: ISSUE with any `LOCK_*` flag (v0 or v3).
- `"Destroying is irreversible, the tokens cannot be recovered."`: DESTROY (all versions).
- `"Token ticker is empty."`: ISSUE / MINT / DESTROY with empty `TICK`.
- `"Amount is not positive."`: MINT / DESTROY with `AMOUNT <= 0`.
- `"Memo contains | or ;, the protocol will reject this transaction."`: MINT / DESTROY / ISSUE.

**Private helpers** (file-local, not re-exported)

- `decodeIssue(params, chainName, chainSuffix)`: dispatches by `VERSION`.
- `decodeBatch(params, chainId, chainName, chainSuffix, chainRegistry)`: re-enters `decodeAction` for each command.
- `collectLockFlags(params)`: maps `LOCK_*` fields to human labels; treats `''`, `'0'`, `0`, `false`, `null`, `undefined` as inactive.
- `genericFallback(action, params, chainSuffix)`: existing catch-all, now reusable.

### Tests

- `packages/core/test/action-decoder.smoke.js` grows from 7 to 18 cases. New coverage: ISSUE v0 Meme-template shape (create + MAX_SUPPLY + locks), ISSUE v0 transfer-ownership-only, ISSUE v1 description-only, ISSUE v3 lock-params summary, MINT happy + broadcasting-address default + zero-amount warning, DESTROY v0 + multi-version fallback with irreversibility preserved, BATCH composed summary + Step-row details, empty-BATCH no-decoded-commands warning. SignApproval static wiring checks unchanged.

### Scope boundary

- Decoder output is **plain text strings**. The sign screen renders them; no HTML, no markup. Lock-flag labels are English ("max supply", "minting"), not protocol field names ("LOCK_MAX_SUPPLY"), the decoder's job is to translate protocol into human, not mirror it.
- `COMMANDS` is the wallet-side representation. The SDK ultimately serializes a BATCH to `BATCH|0|CMD1;CMD2` per protocol §BATCH v0; the decoder runs before serialization, on the authored-but-not-yet-encoded shape. A future enhancement could parse the on-wire form too, for dApp-origin sign requests, not needed today.
- Phase 2 sub-pieces 2b–2e (wizard scaffold, messaging, templates, Home entry) build on top of this decoder. ISSUE / MINT / DESTROY standalone forms (§40.2–§40.5, Steps 8–11) reuse it unchanged.
- DISPENSER / DIVIDEND / AIRDROP / BROADCAST / FILE decoders land alongside their authoring forms (Batch 2, Steps 20–24).

### Smoke-runner regressions surfaced + fixed

Running `node packages/core/test/_run-smokes.js` after the decoder work flushed out three pre-existing regressions that had slipped through earlier releases (pnpm wasn't available in the sandbox where those pieces were proposed, so the smoke suite never ran end-to-end). All three are static/wiring fixes, no runtime behavior changed:

- `packages/core/src/index.js` no longer re-exports the `shared` namespace. The shared surface pulls `.jsx` files which Node's native ESM loader can't parse, so `import { decoder } from '@xchain-wallet/core'` broke the moment the namespace alias was followed. Consumers already reach shared via the subpath export (`@xchain-wallet/core/shared/MessagingProvider.jsx`); the namespace alias was dead weight introduced in v0.46.0.
- `packages/core/test/popup-shell.smoke.js`: stale from v0.46.0. It iterated `popup/routes/Loading.jsx` + friends that got hoisted to shared and deleted. Replaced with assertions that the popup App.jsx pulls the 8 shared routes + wraps in `<MessagingProvider shell="popup">`.
- `packages/core/test/sdk-bundle.smoke.js`: the "shim doesn't re-import `ws`" assertion in v0.47.0 was naive substring-matching and tripped on the JSDoc example at the top of `ws-browser.js` that cites `require('ws')` as the consumer call site. Now strips comment lines before the check.

## [0.47.0] - 2026-04-23

Phase 2 Batch 1 piece 1b, real `xchain-sdk` browser-bundle pass. Makes both shell Vite builds resolve the real SDK end-to-end so every Phase-2 authoring form (ISSUE, MINT, wizard, etc.) has a working encode + sign path from day one instead of dead-ending at the dev-mock fallback. Surfaces the three CJS/Node-builtin interop issues once, not per-form.

### Added

**Browser shims** (`packages/core/src/shims/`)

- `ws-browser.js`: wraps native browser `WebSocket` in a Node-`ws`-shaped adapter. The SDK's `websocket.js` calls `.on('open'|'message'|'close'|'error', fn)` + reads `WebSocket.OPEN`-style static constants; browser `WebSocket` exposes `.addEventListener` / `onopen`. Shim translates, plus handles `close(code, reason)` / `readyState` / `send(data)`. Throws loudly if `globalThis.WebSocket` is unavailable.
- `http-browser.js`: no-op `http.Agent` class so `encoder.js` + `explorer.js`'s `new (require('http').Agent)({ keepAlive: true })` connection-pool init resolves without pulling in the 30 KB `stream-http` polyfill. Browsers manage their own connection pool; axios's `httpAgent` is a no-op there.
- `repl-browser.js`: throws if `startREPL()` is ever called. `xchain-sdk/index.js` transitively loads `src/repl.js` at module init via `require('./src/repl.js')`, which calls `require('repl')`. The wallet never calls `startREPL`; the shim lets the module graph resolve without shipping a real polyfill for `node:repl`.
- `packages/core/package.json` exports `./shims/*` so Vite configs resolve the shim paths via `@xchain-wallet/core/shims/*`-style imports (today the configs use `fileURLToPath(new URL(...))` because Vite's `resolve.alias` values are filesystem paths, not package-subpath imports).

**Vite config wiring** (`packages/web/vite.config.js`, `packages/extension/vite.config.js`)

- `vite-plugin-node-polyfills` added with `include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util']` + `globals: { Buffer: true, process: true, global: true }` + `protocolImports: true`. Covers `require('crypto')` in `auth.js` + `messaging.js` (ECDH, AES-256-GCM, randomBytes, SHA-256), Buffer in `bitcoinjs-lib`, and `process` in a few transitive deps.
- `resolve.alias` maps `ws` → `ws-browser.js`, `http` → `http-browser.js`, `repl` → `repl-browser.js`. Aliasing at the Vite level means we don't touch `xchain-sdk` source.
- Extension Vite config keeps its existing multi-entry shape (background / contentScript / xchainProvider / popup / approval). Tree-shaking keeps the polyfills + shims out of `contentScript` + `xchainProvider` bundles since those don't consume xchain-sdk.

**Runtime + dev deps**

- `vite-plugin-node-polyfills@^0.22.0` added as devDep to `packages/web` + `packages/extension`. `packages/core` already depended on `@noble/hashes` + `@scure/*` directly, not using crypto-browserify.
- `xchain-sdk@^1.8.0` already pinned in both shells from v0.45.0.

### Tests

- **New smoke**, `packages/core/test/sdk-bundle.smoke.js`. Verifies: the three shim files exist + expose the expected surface; both Vite configs import `vite-plugin-node-polyfills` and call `nodePolyfills()` with the right include list + global Buffer flag; both configs resolve `ws` / `http` / `repl` via alias to the shims; both package.json files pin `xchain-sdk` at `^1.8.0` and list `vite-plugin-node-polyfills` as a devDep; both `sdkFactory.js` files still dynamic-import `xchain-sdk` + wrap with `adaptXChainSDK` + emit the console.warn markers `check-no-dev-mock.sh` greps for; `tools/build-reproduce/check-no-dev-mock.sh` still names all three markers.

### Scope boundary

- **Static smoke only.** The full "does it actually bundle" gate is `pnpm -C packages/web build && pnpm -C packages/extension build && bash tools/build-reproduce/check-no-dev-mock.sh`. Those run in CI + before a release; the smoke asserts the static wiring, not the bundle itself.
- **Messaging features are Phase 3.** The SDK's `src/messaging.js` uses `crypto.createECDH('secp256k1')` and AES-256-GCM for §MESSAGE ECIES. Bundling the module graph works (crypto-browserify supports both), but the wallet doesn't invoke messaging flows until Phase 3 (§41.x). Any runtime-only bugs in the polyfill path there surface later; Phase 2 authoring (ISSUE/MINT/wizard/HW signers) doesn't touch messaging.
- **ws shim is minimal.** It implements the `.on / .off / .once / .send / .close / .terminate / readyState / url / protocol / bufferedAmount` surface the SDK's `websocket.js` consumes plus `CONNECTING / OPEN / CLOSING / CLOSED` static constants, not a general-purpose `ws` polyfill. If the SDK adds new WebSocket call sites in a future version, the smoke fails at bundle time and the shim gets extended.
- **http shim is intentionally a stub.** If the SDK starts doing anything beyond `new http.Agent()`, the browser bundler hits an undefined-property error and we notice. We don't want to quietly pull in `stream-http` (30 KB) for features the wallet doesn't use.

### Known follow-ups

- The full `pnpm -r build` + `check-no-dev-mock.sh` gate is scoped to CI, the user runs it locally when they want visual confirmation. A reproducible-build RC pass (§51.4) adds the gate automatically pre-release.
- If `bitcoinjs-lib`'s browser surface reports an ESM/CJS interop issue in the bundle log, the fix is typically a `optimizeDeps.include: ['bitcoinjs-lib']` entry in the Vite config, not shipped today because pre-bundling it may not be necessary with `@vitejs/plugin-commonjs` built-in handling.

## [0.46.0] - 2026-04-23

Phase 2 Batch 1 piece 1, shared-routes refactor. Closes the Phase-1 popup-Send + web-Receive gaps by hoisting every Phase-1 route into `@xchain-wallet/core/shared/routes/*` behind a `MessagingProvider` React context. Popup + web shells become thin routers that wrap the tree with `<MessagingProvider shell="popup|web" messaging={shellMessaging}>`; shared routes call the bag of messaging helpers via the context and pick `Screen` variants from `screenVariantFor(shell)`.

### Added

**Shared surface** (`packages/core/src/shared/`)

- `MessagingContext.js` + `MessagingProvider.jsx` + `useMessaging.js`: React context + hook wrapping a `{ shell, messaging }` value. `useMessaging` throws when consumed outside a provider so wiring mistakes surface immediately. `screenVariantFor(shell)` returns `'popup' | 'full'`.
- `hooks/useAutoLock.js`: hoisted from the popup; now a shared foreground auto-lock timer. `enabled: false` makes it a no-op so shells that don't want it (web today) can still call the hook unconditionally per React hook rules.
- `components/MnemonicGrid.jsx`: shared read-only seed-phrase grid. `variant="popup"` renders the compact 3-col layout; `variant="full"` picks a responsive 3/4-col grid for the full layout.
- `components/ChainBalanceCard.jsx`: shared per-chain balance card (hoisted from popup).
- `routes/Loading.jsx`, `Onboarding.jsx`, `CreateWallet.jsx`, `ImportWallet.jsx`, `Locked.jsx`, `Home.jsx`, `Send.jsx`, `Receive.jsx`: every Phase-1 route + its `.module.css`. Each route reads `shell` from context and picks its layout variant; each CSS module co-locates `-popup` / `-full` class variants where sizing diverges.
- `shared/index.js` barrel + `packages/core/src/index.js` namespace export (`import { shared } from '@xchain-wallet/core'`).
- `packages/core/package.json` exports map extended with `./shared` and `./shared/*`.

**Closing the Phase-1 gaps**

- **Popup gains Send**, popup `App.jsx`'s `unlockedView` now tracks `home | send | receive`; Home's Send button is live. `packages/extension/src/popup/messaging.js` adds a `sendAsset` helper targeting the host's `action.send` handler.
- **Web gains Receive**, web `App.jsx` adds the `receive` sub-route and renders the shared `Receive`. `packages/web/src/messaging.js` adds a `generateReceiveAddress` helper targeting the host's `receive.getAddress` handler.
- **Review shape converged**, shared `Send.jsx`'s review stage runs the user's draft through `decoder.decodeAction` so the plain-English summary + warnings banner match SignApproval's sign-screen. Memo `|` or `;` surfaces the same protocol-reject warning in both surfaces.
- **Create flow converged on safer pattern**, shared `CreateWallet.jsx` generates the BIP39 mnemonic client-side and persists post-confirm via `messaging.importMnemonic`, matching the web shell's existing behavior. A user who closes the popup/tab at the mnemonic display stage leaves no vault behind (§19.2).

### Changed

- `packages/web/src/App.jsx`: `<ExtensionBanner>` hoisted to App-level above the router (previously per-route in Locked + Onboarding). Auto-hiding behavior is unchanged; the banner only renders when `window.xchain` is detected and not dismissed for the session. Double-render regression on Onboarding is impossible because the per-route `<ExtensionBanner>` was deleted.
- Popup + web `App.jsx` are now thin: wrap in `<MessagingProvider>`, dispatch by state, pass `shell`/`messaging` through context. All route files live in `@xchain-wallet/core/shared/routes/`.

### Removed

Per-shell duplicates (hoisted to shared):

- `packages/extension/src/popup/routes/*.{jsx,module.css}`: Locked, Loading, Onboarding, CreateWallet, ImportWallet, Home, Receive (all gone).
- `packages/extension/src/popup/components/{MnemonicGrid,ChainBalanceCard}.{jsx,module.css}`: gone.
- `packages/extension/src/popup/hooks/useAutoLock.js`: gone.
- `packages/web/src/routes/*.{jsx,module.css}`: Locked, Loading, Onboarding, CreateWallet, ImportWallet, Home, Send (all gone).
- `packages/web/src/components/MnemonicGrid.{jsx,module.css}`: gone.
- `packages/web/src/components/ExtensionBanner.{jsx,module.css}`: retained (web-shell-specific chrome).

### Tests

- **New smoke**, `packages/core/test/shared-routes.smoke.js`. Asserts the core exports map, the 25 shared files exist, each route reads `useMessaging()` + calls its helpers via `messaging.X(...)` + drives `Screen` from `screenVariantFor`, both App.jsx wrap in `<MessagingProvider>` and import the 8 shared routes, the old per-shell duplicates are deleted, and both messaging modules expose the full surface (`unlockWallet`, `lockWallet`, `listWallets`, `getWalletBalances`, `getAddressesByChain`, `getNewestAddress`, `generateReceiveAddress`, `createWallet`, `importMnemonic`, `sendAsset`).
- **Smokes updated**, `web-shell`, `web-send`, `web-onboarding`, `popup-shell`, `extension-onboarding`, `receive-view`, `home-lock`, `unlock-flow`, `e2e-harness` all re-target the shared paths and the `messaging.X` call convention. Behavioral assertions (real Vault round-trips against fake chrome.storage / fake IndexedDB) keep the same shape, only the static-regex checks moved.

### Scope boundary

- No new authoring features land in this piece. Token Creation Wizard (§40.1) + ISSUE/MINT/DESTROY (§40.2–§40.5) come next, building on the shared-routes surface.
- Auto-lock stays popup-only for today (web shells opt out via `enabled: shell === 'popup' && !locking`). Cross-shell parity for auto-lock is a later polish.
- Extension popup + web now both render the same `Home.jsx`. The full-screen Home uses a responsive grid of `ChainBalanceCard`s; the popup gets a single-column stack of the same cards, card internals unchanged.

## [0.45.0] - 2026-04-22

Closes out Phase 1's buildable surface. One combined release covering Batch 5 (Vitest in core, Playwright harness, i18n scaffold, axe-core CI gate) + piece 19 (real SDK wiring), piece 20 (extension popup onboarding), piece 21 (threat-model artifact), and piece 22 (reproducible-build scaffold). Released as a single version because the pieces together cross the "Phase 1 shippable" line, the release-gate checklist in `IMPLEMENTATION_STATUS.md` drops from every-item-open to "external review + signed releases" as the remaining gate.

### Added

**Piece 15, Vitest in `core`** (§52.2)

- `packages/core/vitest.config.js`: jsdom env, `@vitejs/plugin-react` for JSX, `test/**/*.test.{js,jsx}` include, `*.smoke.js` excluded so the Node-script smokes run untouched, v8 coverage provider. Coverage thresholds deliberately unset until the suite grows toward §52.2's 80% target.
- `packages/core/test/setup.js`: loads `@testing-library/jest-dom/vitest`, polyfills `webcrypto` on Node 18.
- `packages/core/test/_run-smokes.js`: discovery-based runner wraps every `*.smoke.js` behind `pnpm -C packages/core test:smoke`.
- Vitest suites (`*.test.{js,jsx}`, 5 files, 25 cases): `decoder.test.js`, `ui/Button.test.jsx`, `ui/Input.test.jsx`, `ui/ChainBadge.test.jsx`, `ui/CopyButton.test.jsx`.
- `packages/core/package.json`: `test` / `test:watch` / `test:coverage` / `test:smoke` scripts + Vitest devDep set.
- `.gitignore` excludes `/packages/*/coverage`.

**Piece 16, Playwright harness** (§52.4)

- `e2e/` workspace package with `playwright.config.js` (Chromium, workers=1, `webServer` spawns `pnpm -C packages/web dev`, traces + video + screenshots on failure), README runbook.
- `tests/onboarding.spec.js`: 4 cases: create/lock/unlock round-trip, wrong-password error, BIP39 import, word-count validation.
- `tests/send-form.spec.js`: 4 cases: review round-trip with form-state preservation, `|;` memo rejection, zero-amount rejection, broadcast attempt surfaces SDK-stub error.
- `.github/workflows/ci.yml`: new Playwright job; existing install job gains `pnpm -r test` + `pnpm -C packages/core test:smoke`.
- `pnpm-workspace.yaml` includes `e2e`.

**Piece 17, i18n scaffold** (§54)

- `packages/core/src/i18n/en.js` (57 keys) + `index.js` with `t()`, `format()`, `setLocale`/`registerLocale`/`onLocaleChange`/`availableLocales`. Missing keys fall back to English then to the key itself.
- Re-exported as the `i18n` namespace from core's `index.js`.

**Piece 18, axe-core CI gate** (§53)

- `e2e/tests/a11y.spec.js` scans every Phase-1 screen against WCAG 2.1 A + AA tags. Helper surfaces the violation list in failure messages.
- `@axe-core/playwright` added as an e2e devDep.

**Piece 19, real `xchain-sdk` wiring**

- `packages/web/src/sdkFactory.js` + `packages/extension/src/background/sdkFactory.js`: shared-shape resolvers that dynamic-import `xchain-sdk`, wrap via `core.sdk.adaptXChainSDK`, and fall back to a clearly-flagged dev mock when the package isn't resolvable. Single `console.warn` on fallback.
- `hostBridge.sdkResolved` / `background.sdkResolved`: promises that settle with `'real' | 'dev-mock'`.
- `xchain-sdk@^1.8.0` as a runtime dep on both shells.

**Piece 20, extension popup onboarding**

Closes the `TEST_DAPP_RUNBOOK` bootstrap gap for the extension.

- `packages/extension/src/background/walletCreate.js`: pre-host `wallet.create` / `wallet.import` handlers. `WalletExistsError` idempotence guard.
- `sessionMeta.js` dispatcher + `PRE_HOST_MESSAGE_TYPES` now covers `wallet.create` + `wallet.import`; accepts `chainRegistry` + (lazy-bound) `sdkRegistry` deps.
- Popup routes: `CreateWallet.jsx`, `ImportWallet.jsx`, `components/MnemonicGrid.jsx` (+ CSS), popup-sized variants of the web onboarding flows.
- Popup `App.jsx` adds the `welcome | create | import` sub-route.
- Popup `messaging.js` gains `createWallet` + `importMnemonic` helpers.

**Piece 21, threat-model artifact** (§12)

- `docs/Threat_Model.md`: full draft covering protected assets, in/out-of-scope threats, 5 attacker scenarios with code-pointer mitigations, known open items, review cadence, and a Verification section cross-referencing smoke tests. Release-gating-checklist item has a concrete artifact to hand to reviewers.

**Piece 22, reproducible-build scaffold** (§51.4)

- `tools/build-reproduce/README.md`: pinning notes, verify-script plan, current gotchas, RC checklist.
- `tools/build-reproduce/check-no-dev-mock.sh`: pre-release gate greps built `dist/` for dev-SDK fallback markers. Fails the pipeline if found → guarantees `xchain-sdk` resolved during the production build.

### Tests

Six new smokes (auto-discovered by `_run-smokes.js`): `sdk-wiring`, `e2e-harness`, `vitest-setup`, `i18n`, `a11y-harness`, `extension-onboarding`, `release-gates`. 21 smokes total; all pass.

### Scope boundary, Phase 1 remaining

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

**Plain-English action decoder + sign-screen upgrade** (§21.1, §30), Batch 4 piece 14

Closes out Batch 4.

- `packages/core/src/decoder/actionDecoder.js`: pure function:   ```   decodeAction({ action, params, chainId, chainRegistry })     → { summary: string, details: Array<{ label, value }>, warnings: string[] }   ``` Phase 1 covers SEND + SWEEP with human sentences ("Send 100 MYTOKEN on Bitcoin to bc1q…", "Sweep all assets on Dogecoin to bc1q…").

- `packages/core/src/index.js` re-exports the `decoder` namespace so both shells reach it via `import { decoder } from '@xchain-wallet/core'`.

- `packages/extension/src/approval/kinds/SignApproval.jsx`: `signAction` summary block now calls `decoder.decodeAction`. Renders the human summary line, a proper `<dl>` details list (labeled rows, not raw JSON), and a warnings alert styled as a yellow banner above the password input.

- `packages/extension/src/approval/kinds/SignApproval.module.css`: new styles for `.detailsList` / `.detailsRow` / `.detailsLabel` / `.detailsValue` and the `.warnings` alert block.

### Scope boundary

- **PSBT summary stayed raw-hex**, structural PSBT parsing needs `bitcoinjs-lib`. Until the real SDK is bundled, showing `psbtHex` truncated + signing paths is the honest fallback; no fake parser.
- **Web `Send.jsx` still uses its own review layout**, the review there renders structured rows (Chain / From / To / Asset / Amount / Memo) that differ from the decoder's flat `details[]` shape. Converging is a later polish pass; both paths render the same underlying data correctly today.
- **Rejection UX** is the existing Reject button + the warnings banner. §30's "once, clearly" anti-paternalism guideline means the decoder surfaces warnings inline without adding a confirm-dialog before Approve.

### Tests

- `packages/core/test/action-decoder.smoke.js`: 7 decoder cases (happy SEND, SEND with `|` memo → warning, SEND with zero amount + empty destination → two warnings, SWEEP blanket-balance warning, unknown-action fallback, no-chain-registry path, null-params safety) + static wiring for the core namespace re-export and SignApproval's import/use of the decoder.

## [0.43.0] - 2026-04-22

Covers Batch 4 pieces 12 + 13 (web onboarding + web Send). Bundled because both touch `packages/web/src/messaging.js` and `packages/web/src/App.jsx`; splitting would churn the same files without shipping anything different.

### Added

**Piece 12, web onboarding: create + import** (§15.3, §19.2)

Closes the bootstrap gap called out in `TEST_DAPP_RUNBOOK.md` for web. Users can now create a fresh BIP39 wallet or import an existing 12/15/18/21/24-word phrase without hand-seeding IDB through DevTools.

- `packages/web/src/hostBridge.js`: - Replaced the throwing SDK scaffold with a clearly-flagged `createDevMockSdk` (DO NOT USE FOR MAINNET).
- `packages/web/src/messaging.js`: `createWallet` + `importMnemonic` helpers.
- `packages/web/src/routes/CreateWallet.jsx` (+ CSS), 2-stage flow: password+confirm+name form → mnemonic display with "I've saved it" checkbox. Mnemonic is generated client-side via `cryptoLib.generateBip39Mnemonic` and **only persisted after** the user acks, via `importMnemonic` with the generated phrase, so a user who closes the tab at the display stage leaves no vault behind.
- `packages/web/src/routes/ImportWallet.jsx` (+ CSS), textarea for the phrase (spell-check off, lowercase, no autocomplete), word-count validation (12/15/18/21/24), password + confirm, name.
- `packages/web/src/components/MnemonicGrid.jsx` (+ CSS), numbered 3/4-column read-only grid. Deliberately no copy-to-clipboard button per §19, seeds should be hand-written, not parked in clipboard history.
- `packages/web/src/routes/Onboarding.jsx`: activated the Create + Import buttons via new `onCreate` / `onImport` props.
- `packages/web/src/App.jsx`: added `no-wallet` sub-routing (`welcome | create | import`). Successful create/import leaves the host live; next `refresh()` transitions the app to Home without a separate unlock step.

**Piece 13, web Send form + review** (§29 authoring)

- `packages/web/src/routes/Send.jsx` (+ CSS), multi-stage authoring flow: - **form**: chain picker (when the wallet has addresses on >1 chain), auto-picked source address (highest external HD index on the chain), native-ticker default (`descriptor.coin.toUpperCase()`), recipient / asset / amount / memo inputs.
- `packages/web/src/messaging.js`: `sendAsset(opts)` helper targeting the host's `action.send` handler.
- `packages/web/src/App.jsx`: added `unlocked` sub-routing (`home | send`), caches active walletId at App level so Send reuses Home's single-wallet assumption.
- `packages/web/src/routes/Home.jsx`: activated the Send button via new `onSend` prop.

### Scope boundary

Real broadcast via Send is blocked by the dev-SDK stub, the flow exercises cleanly through form + review + password entry, then fails with a visible "xchain-sdk" / "not yet wired" error at the encoder step. Shipping real broadcast is a Batch 5 piece (SDK bundling).

Onboarding in the **extension popup** remains a stub, the popup route set hasn't been hoisted into shared components yet. That shared-routes refactor + popup onboarding land together in a later cleanup.

### Tests

- `packages/core/test/web-onboarding.smoke.js`: static wiring (App sub-routes, CreateWallet generates + persists via `importMnemonic`, ImportWallet's word-count validation, dev-SDK stub flagged) plus behavioural round-trips: real create → mnemonic returned + vault persisted + session=unlocked + `wallet.list` returns the seeded wallet + lock/unlock round-trip proves kdfParams persisted + idempotence guard rejects a second create; reset; import with a fresh BIP39 phrase + idempotence guard.
- `packages/core/test/web-send.smoke.js`: static wiring (stage coverage, validation rules, App/Home wiring) + end-to-end `action.send` round-trip against the dev-SDK stub: vault seeded, real source address resolved from the persisted addresses-by-chain result, `sendAsset` called, error surfaced as a structured rejection matching the expected "xchain-sdk / not yet wired / encoder" message.

## [0.42.0] - 2026-04-22

### Added

**Web SPA shell + extension-detection banner** (§8.1 target #1, §8.3, §9.3.3), Batch 4 piece 11

The web SPA is now a real React app. Same state-machine topology as the extension popup, with routes rendered full-layout and messaging dispatched through an in-page MessageHost instead of `chrome.runtime`.

**In-page host bridge**

- `packages/web/src/hostBridge.js`: module-scoped `vault` + `host` that survive re-renders but die on tab close / reload (web's key-isolation tradeoff per §9.3.3). Exposes `getSessionStatus`, `unlockWalletLocal`, `lockWalletLocal`, and a `sendMessage(type, request)` dispatcher whose envelope shape matches the popup's `chrome.runtime.sendMessage` wrapper, so the later shared-routes refactor can swap shells without touching route code.
- `packages/web/src/storage/WebMetaBackend.js`: plaintext kdfParams slot at `xchain-wallet:vault-meta` in localStorage. Non-secret by Argon2id design; needed so the unlock flow can derive the master key before touching the IndexedDB ciphertext. Injectable `storage` adapter for tests.
- `packages/web/src/messaging.js`: popup-parity helpers (`unlockWallet`, `lockWallet`, `listWallets`, `getWalletBalances`, `getAddressesByChain`, `getNewestAddress`) wrapping `hostBridge.sendMessage`.

**SPA shell + routes**

- `packages/web/src/main.jsx`: React root. Imports `@xchain-wallet/core/ui/tokens.css` once so design-token custom properties install on `:root` for every route.
- `packages/web/src/App.jsx`: 5-state router matching the popup (`loading | error | no-wallet | locked | unlocked`), rendering the web routes with `Screen variant="full"`.
- `packages/web/src/routes/`: four routes + co-located CSS modules: - `Loading.jsx`: full-layout three-dot indicator. - `Onboarding.jsx`: stub hero + disabled create/import buttons pointing at piece 12.
- `packages/web/src/components/ExtensionBanner.jsx`: §8.3 detection banner. Checks `window.xchain` on mount and listens for the inject-script's `xchain#initialized` event. Dismissal persisted to `sessionStorage` so it doesn't nag across navigations but reappears on a fresh tab.

**Build wiring**

- `packages/web/vite.config.js` enables `@vitejs/plugin-react`.
- `packages/web/index.html`: root div renamed to `xchain-web-root`, script src updated to `/src/main.jsx`.
- `packages/web/src/main.js` deleted.
- `packages/web/src/index.js` re-exports `WebMetaBackend` + namespace-exports `hostBridge`.

### Changed

- `packages/web/package.json` now depends on `@xchain-wallet/extension` for the shared `createBackgroundHost` factory. Flagged in `hostBridge.js` as a candidate for extraction into a lower-level `host-wiring` package when a third shell appears; importing via a cross-package relative path keeps Node smokes runnable without the pnpm workspace symlink while Vite resolves the same path cleanly at build.

### Scope boundary

Routes are intentionally duplicated between popup and web for this piece. A later cleanup piece hoists the shared ones into `src/shared/routes/` behind a `MessagingProvider` React context so both shells consume the same components. Onboarding remains a stub until piece 12.

### Tests

- `packages/core/test/web-shell.smoke.js`: static wiring (Vite plugin, index.html entry, App state coverage, Locked/Home/ExtensionBanner specifics, workspace deps) plus an in-page bridge lifecycle against a real AES-GCM vault with injected `localStorage` + IndexedDB fakes: fresh page → `no-wallet`, wrong-password unlock → `InvalidPasswordError` (state stays `locked`), right-password unlock → `unlocked` with a working `sendMessage('wallet.list')` round-trip returning the seeded wallet, `lockWalletLocal()` → `locked` + `sendMessage` rejects with `VaultClosedError`.

## [0.41.0] - 2026-04-22

### Added

**Batch 3 piece 10, bridge end-to-end smoke + test-dApp runbook**

- `packages/core/test/bridge-e2e.smoke.js`: integration smoke that assembles the real Vault + MessageHost + ApprovalBroker (with a fake `chrome.windows`) and drives the full Phase-1 bridge surface through `host.handle`: - `bridge.connect` → approval parked → `approval.resolve` with the same envelope the popup sends → `ConnectedSite` written + response shape verified. - Second `connect` on the same origin is idempotent (no new approval window opens). - `bridge.getAccounts` / `getAddresses` / `getSupportedChains` (9 chains; `icon` elided as piece-1 shell follow-up intended). - `bridge.signAction` with `ISSUE` returns `{ error: 'UNSUPPORTED_ACTION', supportedActions: ['SEND', 'SWEEP'] }` without opening an approval. - `bridge.disconnect` removes the site. - Window-close-without-decision on a pending connect → dApp-side Promise rejects with `UserRejectedError`. - Test-dApp surface (`runExample` + `MockXChainProvider`) still exposes the symbols the runbook references, catches accidental drift.
- `packages/extension/docs/TEST_DAPP_RUNBOOK.md`: manual browser-pass runbook for RC builds. Covers build + load unpacked, bootstrap gap (seed a wallet via DevTools until Batch 4's onboarding lands), serving the test-dApp, walking `runExample` through each approval popup with expected outcomes, edge cases (reject / close / re-connect / always-allow / mid-flow lock), and a pointer at the node smoke for PR gate use.

### Scope boundary

Sign paths that hit the real SDK (`signMessage`, `signPsbt`, `signAction` SEND) are exercised up to the approval hand-off. Going further, i.e. producing a valid signed payload, needs the real SDK bundled into the extension, which ships in a later piece.

## [0.40.0] - 2026-04-22

Covers Batch 3 pieces 8 + 9 (approval window plumbing + per-kind approval screens). Bundled because piece 9 replaces piece 8's `approval/main.jsx` placeholder and extends `approval/messaging.js`: splitting would just churn the same files.

### Added

**Piece 8, approval window plumbing** (§43.4 request-approval flow)

- `packages/extension/src/background/approvalBroker.js`: `ApprovalBroker` class implements the `Approvals` interface (`connect`, `signAction`, `signMessage`, `signPsbt`, `signIn`) by parking requests in an in-memory map, opening an approval popup via `chrome.windows.create`, and returning a Promise that settles when the popup calls back via `approval.resolve` or when the window is closed by the user (chrome.windows.onRemoved → resolves as `{ approved: false }`: the `USER_REJECTED` convention). Deps are injectable (`newId`, `getUrl`, `windows`) so tests can drive the lifecycle without a browser.
- `packages/extension/src/background/uuid.js`: `sessionRandomUUID()` falls back to `crypto.getRandomValues` when `randomUUID` isn't available so the broker is testable under older Node.
- `packages/extension/src/background/createBackgroundHost.js` registers two new host handlers gated on the broker having the methods: - `approval.fetch({ id })`: returns the parked `{ id, kind, payload }` for the approval window; surfaces `ApprovalNotFoundError` for unknown ids. - `approval.resolve({ id, result })`: settles the parked Promise.
- `packages/extension/approval.html` + `packages/extension/src/approval/main.jsx`: the approval-window entry. Piece 8 shipped a `<Placeholder />` to prove the window plumbing works end-to-end; piece 9 replaces it with a real Router.
- `packages/extension/vite.config.js` adds `approval` as a fourth HTML entry. The manifest doesn't reference `approval.html` directly, `chrome.runtime.getURL` does, so the plugin copy is enough.
- `packages/extension/src/background.js` constructs a module-scoped `ApprovalBroker` at startup (survives unlock/lock cycles) and passes it as `approvals` when building the host.

**Piece 9, per-kind approval screens**

- `packages/extension/src/approval/Router.jsx`: dispatches by `data.kind` to the matching component. Shared `reject()` settles the broker with `{ approved: false }` before calling `window.close()` so the bridge handler sees a clean `USER_REJECTED` instead of the window-close fallback.
- `packages/extension/src/approval/kinds/ConnectApproval.jsx` (+ `.module.css`), connect flow. Chain checkboxes enumerate `chainRegistry.supportedChains()`, pre-checking the dApp's `requestedChains` (empty default if none requested, user must opt into each). `canSignMessage` toggle (off by default). `canSignAction: {}` always empty; per-action opt-in happens at signAction time via its "Always allow" toggle. Connect disabled until at least one chain is selected.
- `packages/extension/src/approval/kinds/SignApproval.jsx` (+ `.module.css`), shared screen for the four password-gated kinds (`signMessage`, `signPsbt`, `signAction`, `signIn`). Layout: chain badge → per-kind summary block → password input → optional "Always allow on this origin" toggle → Reject/Approve. `savePermanent` shows for `signAction` and for `signMessage` when the request's `alreadyGranted` flag is not set, `signPsbt` has no toggle because PSBTs vary enough per-transaction that a blanket allow is dangerous (§21.3). Result envelope: `{ approved: true, walletId, password, savePermanent? }`. `InvalidPasswordError` surfaces as "Incorrect password." inline; other errors show their raw message for diagnosis.
- `packages/extension/src/approval/approval.module.css`: shared header / footer / summary / toggle-row utilities.
- `packages/extension/src/approval/messaging.js` adds `listWallets()` so `SignApproval` can pick `wallets[0].id` as `walletId` for the sign-result envelope. Multi-wallet picker is Phase 2.

### Changed

- `packages/extension/src/shared/chromeMessaging.js`: extracted the `sendMessage` wrapper so both `popup/messaging.js` and `approval/messaging.js` can consume the same implementation without either depending on the other.
- `packages/extension/src/popup/messaging.js`: now re-imports `sendMessage` from the shared module (popup-facing helpers unchanged).
- `packages/core/test/popup-shell.smoke.js`: regex that checks for `sendMessage` accepts both direct-export and re-export forms.

### Tests

- `packages/core/test/approval-broker.smoke.js`: static wiring + full broker lifecycle against a fake `chrome.windows`: connect → fetch → resolve round-trip, double-resolve no-op, unknown-id returns, window-close → `{approved: false}`, missing-windows rejection, plus a real MessageHost round-trip that verifies `approval.fetch` returns the parked payload, unknown ids surface `ApprovalNotFoundError`, and `approval.resolve` settles the pending bridge Promise.
- `packages/core/test/approval-screens.smoke.js`: static wiring for Router / ConnectApproval / SignApproval (dispatch by kind, result-envelope fields, kind coverage, savePermanent conditional, InvalidPasswordError pathway) + three broker round-trips that simulate each kind of popup result envelope and verify the bridge-side Promise resolves with exactly those fields.

## [0.39.0] - 2026-04-22

### Added

**Receive view + BIP21 QR** (§29.7 receive flow, §29.10 BIP21 URI), Batch 2 piece 7

- `packages/extension/src/popup/routes/Receive.jsx` + `.module.css`: full Receive surface: - Chain picker (native `<select>`) when the wallet has addresses on multiple chains; single `ChainBadge` header otherwise.
- **Two new pre-password host handlers** in `createBackgroundHost.js`: - `addresses.byChain({ walletId })` → `Record<chainId, Address[]>`: used to build the Receive picker. - `addresses.newest({ walletId, chainId, addressType? })` → newest external-index HD address (change=0), or `null`.
- `packages/extension/src/popup/App.jsx`: popup-local sub-route within the `unlocked` state: `home | receive`. Active walletId is cached at App level so Receive can reuse Home's single-wallet assumption without re-querying `wallet.list`.
- `packages/extension/src/popup/routes/Home.jsx`: `Receive` button activated via a new `onReceive` prop (disabled when the prop is absent).
- Messaging: `getAddressesByChain(walletId)`, `getNewestAddress(walletId, chainId)`, `generateReceiveAddress({ walletId, chainId, password, bip39Passphrase?, addressType? })`.

### Changed

- `packages/extension/package.json` adds `qrcode@^1.5.4` as a runtime dependency.

### Tests

- `packages/core/test/receive-view.smoke.js`: drives both new handlers end-to-end against a real Vault seeded with BTC-mainnet external (indexes 0/1/2) + internal (change=1) + a DOGE address + a second wallet's address-that-must-not-leak. Asserts: byChain buckets cleanly, newest picks the highest external index and skips change=1 + other wallets, null for chains with no persisted addresses, missing-field rejection, plus a BIP21 encode/parse round-trip proving the QR payload is reversible.

## [0.38.0] - 2026-04-22

Covers Batch 2 pieces 5 + 6 (real unlock screen + Home screen with `wallet.lock` + foreground auto-lock). Bundled because both pieces touch `sessionMeta.js` + `messaging.js`; splitting the commit would require churn without shipping anything different.

### Added

**Piece 5, unlock flow** (§26 lock/unlock)

- **Pre-host dispatcher**, `packages/extension/src/background/sessionMeta.js` refactored from a single-type listener into a dispatcher. Exports `PRE_HOST_MESSAGE_TYPES` (authoritative set the host listener skips) and handles `session.status` + `wallet.unlock`. `ChromeRuntimeAdapter` now consults that set directly instead of a `session.*` prefix check, keeping the two listeners disjoint without convention-coupling.
- **`wallet.unlock` handler**, `packages/extension/src/background/walletUnlock.js` derives the vault master key via `cryptoLib.deriveMasterKey`, authenticates by opening the encrypted blob (AES-GCM tag mismatch ⇒ `InvalidPasswordError`), seeds the session backend, and fires `onUnlocked()` so background can re-init the host. `NoVaultError` surfaces when no kdfParams meta is planted; empty-password guarded at the boundary.
- **Plaintext meta storage**, `packages/extension/src/storage/ChromeMetaBackend.js` stores vault kdfParams at `xchain-wallet:vault-meta`. Non-secret by design (Argon2id salt is public; memory/iterations are tuning info). Needed because the master key must be derived from password before the ciphertext can be touched.
- **Locked screen**, `src/popup/routes/Locked.jsx` is now a functional password form: auto-focus on mount, auto-re-focus+select on failure, `<Input type="password" autoComplete="current-password">`, `<Button type="submit" loading>` for inline spinner, Enter-to-submit via native `<form>`. `InvalidPasswordError` surfaces as "Incorrect password.", other errors show the raw message (bugs worth seeing).
- `unlockWallet(password)` added to `src/popup/messaging.js`.

**Piece 6, Home screen + wallet.lock + foreground auto-lock**

- **`wallet.lock` handler**, `packages/extension/src/background/walletLock.js` clears the session backend and fires `onLocked()`. Added to `PRE_HOST_MESSAGE_TYPES` (with a matching dispatch case). Idempotent, safe to call when there's already no session.
- **Background teardown**, `background.js` captures `attachChromeRuntime`'s detach fn, defines `tearDownHost()` (detach listener + `vault.close()` + null refs), and passes it as `onLocked`. A subsequent unlock starts from a clean slate; stale vault references can't leak across a lock boundary.
- **Home screen** , `src/popup/routes/Home.jsx` ships the full unlocked-wallet landing view: - Header: wallet name (from `wallet.list[0]`: single-wallet Phase 1 scope; picker is a later piece) + `Lock` button with loading state. - Body: per-chain `<ChainBalanceCard>` rendered from `balances.wallet`.
- **ChainBalanceCard**, `src/popup/components/ChainBalanceCard.jsx` + `.module.css`. Card with a `ChainBadge` header, address-count sub-label, and a fallback body that surfaces the SDK error when all entries failed.
- **`useAutoLock` hook**, `src/popup/hooks/useAutoLock.js` foreground auto-lock (§26). 5-min default, 30s tick, listens for mousemove / keydown / scroll / click / touchstart. Calls `onLock()` once the idle threshold is crossed. Documents the scope gap: background-mediated auto-lock (survives popup close/reopen) is a later piece.
- `lockWallet()` / `listWallets()` / `getWalletBalances(walletId)` added to `messaging.js`.

### Changed

- `packages/extension/src/storage/index.js` re-exports `ChromeMetaBackend` + `DEFAULT_META_KEY`.
- `packages/extension/src/background/ChromeRuntimeAdapter.js` imports `PRE_HOST_MESSAGE_TYPES` and defers those types to the meta listener (replaces the piece-4 `session.*` prefix check).
- `packages/core/test/popup-shell.smoke.js` adapted to the new `attachSessionMetaListener(deps, chromeRuntime)` signature + the new adapter filter wording.

### Tests

- `packages/core/test/unlock-flow.smoke.js`: real-crypto round-trip. Builds a genuine AES-GCM vault blob via the core `Vault`, plants kdfParams in the meta slot, and drives `wallet.unlock` through four behavioural cases: no-vault, right-password (unlock + session seeded + `onUnlocked` fired), wrong-password (`InvalidPasswordError`, session untouched), empty-password (boundary guard).
- `packages/core/test/home-lock.smoke.js`: static wiring of Home / messaging / useAutoLock / ChainBalanceCard / background teardown, plus behavioural cases for `wallet.lock`: lock-from-unlocked (session cleared + `onLocked` fires + status flips to `locked`) and lock-without-session (idempotent, callback still fires).

Both new smokes install `webcrypto` from `node:crypto` onto `globalThis.crypto` since Node 18 exposes it only under the experimental flag and `@noble/hashes` + AES-GCM both reach for the bare global.

## [0.37.0] - 2026-04-22

### Added

**Extension popup HTML entry + React root + session-meta listener** (§8.1 target #3, §9.3.1 process isolation)

The popup is the user's primary entry point to the wallet. This piece ships the shell: HTML entry, React root, hash-free state-machine router, and the background wiring that lets the popup answer "what do I render?" without demanding an unlocked vault.

**Popup shell**

- `packages/extension/popup.html`: at the package root so MV3 can reference `popup.html` directly out of `dist/`. Mounts `<App />` into `#xchain-popup-root` via a type-module script tag pointing at `src/popup/main.jsx`.
- `packages/extension/src/popup/main.jsx`: `createRoot(container).render(<App />)`; imports `@xchain-wallet/core/ui/tokens.css` once so every route inherits the design-token palette + dark-mode + reduced-motion handling.
- `packages/extension/src/popup/App.jsx`: 5-state router: `loading → no-wallet | locked | unlocked | error`. Queries `session.status` on mount, renders the matching route, and passes each route a `refresh()` callback so flows that change state (create wallet, unlock, lock) re-pull ground truth from the background.
- `packages/extension/src/popup/messaging.js`: `sendMessage(type, request)` wraps `chrome.runtime.sendMessage` in a Promise. Surfaces the MessageHost `{ok, result} | {ok, error}` envelope as resolve/reject and preserves the error-class name. `getSessionStatus()` is the named query.
- `packages/extension/src/popup/routes/`: four route stubs with co-located CSS modules:   - `Loading.jsx`: animated three-dot pulse indicator; static under `prefers-reduced-motion`.   - `Onboarding.jsx`: logo hero + tagline from `branding.js`; "Create a new wallet" / "I already have one" buttons (disabled, real flows land in Batch 4).   - `Locked.jsx`: scaffold stub; real password form + `unlockWallet` wiring lands in piece 5.   - `Home.jsx`: scaffold stub with a header "Lock" trigger so the state machine is exercisable end-to-end; balances / send / receive land in pieces 6–7.

**Background session-meta listener**

The popup renders first-thing-on-open, before any unlock flow has run. `MessageHost` requires an open Vault, so a vault-less question like "is there a wallet?" couldn't be asked through it. The session-meta listener plugs that gap.

- `packages/extension/src/background/sessionMeta.js`: `attachSessionMetaListener(chromeRuntime?)` installs a `chrome.runtime.onMessage` listener that answers one type (`session.status`) from the two storage backends directly. Returns `{ hasWallet, hasSession, state }` where `state ∈ {'no-wallet', 'locked', 'unlocked'}`. Returns `false` for any non-`session.*` message so the host listener picks those up normally.
- `packages/extension/src/background/ChromeRuntimeAdapter.js`: host listener now returns `false` for `session.*` message types so the two listeners stay disjoint (prevents double-`sendResponse` on the same message).
- `packages/extension/src/background.js`: `attachSessionMetaListener()` runs before `ensureHost()` so the popup gets an answer even when the vault is still locked. Host listener attaches once the session key is present.

**Vite wiring + manifest + app icons** (§9.5, §51)

- `packages/extension/vite.config.js`: `@vitejs/plugin-react` enabled; fourth entry added (`popup` pointing at `popup.html`) so Vite's HTML pipeline produces `dist/popup.html` + a hashed `assets/popup-<hash>.js`. New `iconResizePlugin` uses `sharp` to resize `packages/core/src/branding/assets/favicon.png` (128×128 source) into MV3-standard 16 / 32 / 48 / 128 PNGs at `dist/icons/icon-<size>.png` on every build.
- `packages/extension/manifest.json`: added top-level `icons` + `action.default_popup = "popup.html"` + `action.default_icon` at all four sizes.
- `packages/extension/package.json`: `sharp@^0.33.5` devDep (consumed only by the icon-resize plugin at build time).

### Tests

- `packages/core/test/popup-shell.smoke.js`: 13 static-wiring checks (popup HTML, React entry, App state coverage, route exports, Vite config plugins + popup input + icon sizes, manifest popup/icon references, sharp devDep, background listener wiring) plus a runtime test that installs the session-meta listener against a fake `chrome.runtime` + `chrome.storage` and drives it through all three wallet states (no-wallet / locked / unlocked) plus a non-session-message passthrough check.

## [0.36.0] - 2026-04-22

### Changed

**Electron desktop shell moved out of Phase 1 into Phase 2** (spec §40.12)

Rationale: the desktop shell's headline differentiators over web + extension are (a) OS keychain integration and (b) native USB/HID hardware-wallet transports. Hardware signers (`TrezorSigner` / `LedgerSigner`) are Phase 2 per §17.3–17.4, so shipping the desktop shell in Phase 1 would mean a desktop app whose standout features are stubs. Bundling the two into Phase 2 (§40.11 Hardware Wallets + §40.12 Electron Desktop) delivers the desktop app with its value intact.

- `packages/desktop/package.json`: description flagged as "Phase 2 stub; ships alongside hardware signers per spec §40.12."
- `packages/desktop/README.md`: new; explains the deferral + points at spec §40.12. Phase 1 users get the web SPA + Chrome extension (both cover the full send/receive/sign surface).

Spec + IMPLEMENTATION_STATUS updates land in the platform working-copy (gitignored from this repo):

- §8.1 Phase 1 targets table no longer lists Electron desktop
- §8.2 deferred targets table adds the Electron desktop row with a Phase 2 marker
- §39.1 Phase 1 per-target delivery drops "Desktop (Electron) with OS keychain"
- §39.2 Phase 1 out-of-scope adds "Electron desktop shell → Phase 2"
- §40.12 new subsection "Electron Desktop Shell Goes Live" covers main-process signing isolation, OS keychain (safeStorage / keytar), native Trezor / Ledger node transports, URI scheme registration, `electron-builder` packaging + signing, and reproducible builds
- IMPLEMENTATION_STATUS scope-change note + Target-Matrix row + Shell-layer descriptions refreshed to match

### Tests

- `packages/core/test/phase-scope.smoke.js`: new; guards the scope change against accidental revert. Verifies §8.1 does not list Electron desktop, §8.2 lists it with a Phase 2 marker, §39.2 out-of-scope calls it out, §40.12 subsection exists, IMPLEMENTATION_STATUS records the scope change and references §40.12, and desktop/package.json description mentions Phase 2.

## [0.35.0] - 2026-04-22

### Added

**React + CSS Modules wiring + `@xchain-wallet/core/ui` primitives**

Picks the UI framework + styling approach for the Phase 1 UI session. React 18.3 + CSS Modules wins on ecosystem depth (hardware-wallet libs, QR libs, a11y libs) and bundler-native styling (no runtime cost).

**Framework wiring**

- `packages/core/package.json`: `react` / `react-dom` declared as optional peer dependencies (`^18.3.0`).
- `packages/extension/package.json` + `packages/web/package.json`: `react` / `react-dom` as regular deps; `@vitejs/plugin-react@^4.3.0` as a dev dep. Wired at the shell level so each Vite config can opt in to JSX in a later piece.

**Design tokens (§5.4 visual identity, §37 micro-UX)**

- `packages/core/src/ui/tokens.css`: CSS custom properties for spacing (4px grid), typography (system-font stack + monospace), radii, motion (≤200ms, cubic-bezier(0.2, 0, 0.2, 1) per §5.4), and a full palette. Light theme default + `@media (prefers-color-scheme: dark)` overrides. `@media (prefers-reduced-motion: reduce)` disables transitions. Accent colours match `branding.js` ACCENT_PRIMARY / ACCENT_SECONDARY. Shells import once: `import '@xchain-wallet/core/ui/tokens.css'`.

**Primitives (`packages/core/src/ui/`)**

Six components, each a JSX file plus a co-located `.module.css`:

- `<Screen />`: top-level layout wrapper. `variant="popup"` renders fixed 360×600 per §8.1; `variant="full"` flexes for extension full-screen / web SPA. Header / body / footer slots.
- `<Button />`: `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'`, `block`, `loading` (spinner + aria-busy), `disabled`. Focus ring from tokens. Spinner disables under `prefers-reduced-motion`.
- `<Input />`: `forwardRef`'d text input with label, hint, and error slots. `aria-invalid` + `aria-describedby` wired to the matching hint/error nodes via `useId()`. Pass-through props land on the underlying `<input>` so `value` / `onChange` / `autoFocus` / `autoComplete` go directly through.
- `<ChainBadge />`: icon + display name pill. Reads `branding.chainIconSmallUrl(descriptor.id)` for the asset; `descriptor.color` drives the tinted background/border via `color-mix()`. Non-mainnet networks surface the network kind in muted text next to the name.
- `<AddressText />`: monospace address with optional `first6…last6` truncation. Full address preserved via `title` + `aria-label` so hover and AT still expose the canonical string.
- `<CopyButton />`: writes to clipboard via `navigator.clipboard.writeText()`, flips label to "Copied" for 1.5s (configurable via `feedbackMs`). Silent no-op when clipboard is unavailable, callers own the fallback (manual-selection hint, QR).

**`packages/core/src/ui/index.js`**, barrel re-export for the 6 primitives. `tokens.css` stays unreferenced here (it's a global side-effect import shells do once at their entry point).

### Tests

- `packages/core/test/ui-surface.smoke.js`: static check: tokens.css declares the expected 11 custom properties + dark-mode + reduced-motion blocks + brand accent hex matches branding.js; every primitive exports its name, imports its co-located CSS module, references design tokens; `ui/index.js` re-exports all six; `core/package.json` declares the `./ui` + `./ui/tokens.css` subpath exports and `react` / `react-dom` as peerDeps; both shell `package.json`s declare `react` / `react-dom` / `@vitejs/plugin-react`. Runtime JSX smoke lives in the popup piece once a shell bundle compiles it.

## [0.34.0] - 2026-04-22

### Added

**§5 product identity, branding module + chain-icon assets**

- `packages/core/src/branding/branding.js`: single source of truth for user-facing brand strings and asset pointers. Exports `PRODUCT_NAME` (`"XChain Wallet"`), `TAGLINE` (placeholder from §5.2 candidate), `CANONICAL_DOMAIN` (`wallet.xchain.io`), `HOMEPAGE_URL`, `ACCENT_PRIMARY` / `ACCENT_SECONDARY` (sampled from the XChain logo, blue `#1E90C7`, purple `#7B2C8F`), `DEFAULT_EXPLORER_BASE` / `DEFAULT_HUB_BASE`, and chain-icon maps (`CHAIN_ICON_SMALL`, `CHAIN_ICON_LARGE`) keyed by ChainDescriptor.id
- `packages/core/src/branding/assets/`: 20 files vendored from `xchain-explorer/src/content/images/`: product logo (`xchain-color-750.png`), favicon (`favicon.png`), and 9 chain icons × 2 sizes (20px + 500px) covering BTC / DOGE / LTC × mainnet / testnet / regtest
- `assetUrl(filename)` / `logoUrl()` / `faviconUrl()` / `chainIconSmallUrl(chainId)` / `chainIconLargeUrl(chainId)`: resolve asset filenames to runtime URLs via `new URL('./assets/...', import.meta.url)`, the Vite-friendly pattern that emits hashed static assets at build time and still resolves on disk under Node

**§5.5 placeholders, resolved (non-marketing-gated)**

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

ADS donation addresses remain the `PLACEHOLDER_REPLACE_BEFORE_MAINNET` sentinel (unchanged, marketing-/ops-gated). Tagline, primary-brand wordmark, and store-listing copy remain pending the marketing pass per §5.5.

### Changed

- `packages/core/src/registry/descriptors/{bitcoin,dogecoin,litecoin}.js`: replaced empty `icon: ''` with per-network asset filenames (e.g. `icon: 'bitcoin-mainnet-icon-20.png'`) on each of the 9 bundled descriptors. Validator JSDoc updated to describe `icon` as an asset filename resolved via `branding.assetUrl()`.
- `packages/extension/src/bridge/handlers.js`: `bridge.getSupportedChains` no longer forwards `descriptor.icon` verbatim to dApps. Raw filenames would be unresolvable cross-origin; a follow-up shell-layer piece will resolve them to `chrome.runtime.getURL(...)` URLs against a web-accessible asset path. Until then the bridge sends `icon: ''` (pre-existing behaviour) with an in-line TODO.

### Tests

- `packages/core/test/branding.smoke.js`: verifies 17 exports, 20 asset files exist on disk, all 9 bundled descriptors validate with their new `icon` fields, and no §5.5 `PLACEHOLDER_` sentinel leaks into branding strings.

## [0.33.0] - 2026-04-22

### Added

**Vite build scaffolding for `extension` and `web` packages** (§9.5 / §51.1), infrastructure only, no UI framework decisions yet

- `packages/extension/vite.config.js`: multi-entry rollup with three fixed outputs (`background.js`, `content/contentScript.js`, `inject/xchainProvider.js`) matching the paths `manifest.json` already references. Custom `closeBundle` plugin copies `manifest.json` from the package root into `dist/` at build close (keeps the canonical manifest location stable while the UI session adds popup / full-screen HTML). Shared `@xchain-wallet/core` split into its own chunk so the three entries don't duplicate it
- `packages/extension/src/background.js`: MV3 service-worker entry. Builds a `ChainRegistry`, `SDKRegistry` (with a scaffold `throw`-on-use SDK factory, real SDK wires in at build time alongside the popup UI), and lazy-initialises a Vault + MessageHost against `ChromeStorageBackend` + `ChromeSessionBackend`. `attachChromeRuntime(host)` fires once a master key exists in session storage; the popup's unlock flow is responsible for triggering re-init
- `packages/web/vite.config.js`: minimal SPA config. Root `index.html` + `src/main.js` entry that imports `@xchain-wallet/core` and renders a scaffold marker into `#app`, proving the bundler reaches workspace deps. Dev server on port 5173
- `vite@^5.4.0` added as a dev dependency on both packages; build + dev scripts wired (`pnpm -C packages/extension build`, `pnpm -C packages/web build`, `pnpm -C packages/web dev`)
- CI build step enabled: the `install` job now runs `pnpm -r --if-present build` after install, exercising both Vite configs on every PR

### Scope boundary for the UI session

This release is a pipeline prover. No UI framework decision is baked in, the web `main.js` and extension popup/full-screen HTML are deliberately absent so the UI session can pick React / Solid / vanilla / etc. without config churn. What lands when UI work begins: popup HTML entry added to the extension's `rollupOptions.input`, framework runtime added to both packages' devDeps, the scaffold `main.js` replaced wholesale.

## [0.32.0] - 2026-04-22

### Added

**`bridge.parallel` stub**, structured `PHASE_DEFERRED` response so the inject script's `provider.parallel(actions)` surfaces a clean result-shape (`{ error: 'PHASE_DEFERRED', phase: 4, message }`) instead of falling through to `UnknownMessageTypeError`. Matches `bridge.signAction`'s `UNSUPPORTED_ACTION` pattern, dApp authors branch on `result.error` rather than try/catch. Full implementation ships with cross-chain orchestration in Phase 4+.

## [0.31.0] - 2026-04-22

### Added

**§9.8 dependency hygiene**, `docs/DEPENDENCIES.md` + CI audit step
- `docs/DEPENDENCIES.md` enumerates every runtime dep per-package with the specific feature it provides, license, and maintainer trust signal. Current runtime deps are all from Paul Miller's audited `@noble/*` + `@scure/*` line; workspace-only for extension / web / test-dapp
- CI `audit` job runs `pnpm audit --prod --audit-level=high` on every PR. Independent of the install job so a failing audit doesn't block typecheck reporting. Moderate advisories surface in logs but don't fail, tracked via the weekly review cadence documented in the file
- Review cadence spelled out: every `package.json` PR updates this file; weekly `pnpm outdated -r` check; advisories jump to the front of the queue regardless

## [0.30.0] - 2026-04-22

### Added

**§43 dApp bridge runtime**, the `window.xchain` provider + content-script + background handlers

Three layers shipped:

1. **Inject script (`src/inject/xchainProvider.js`)**, runs in the page's main world, defines `window.xchain` as a thin RPC shim per §43.2. Every method forwards to the content script via `window.postMessage` with an id-tagged envelope; responses are matched back against pending promises. Emits an `xchain#initialized` event on ready. Frozen after install (`Object.defineProperty` non-writable) so dApps can't swap it mid-session.

2. **Content script (`src/content/contentScript.js`)**, runs in the extension's isolated world on every http/https page. Injects the provider from `web_accessible_resources` at `document_start`, then pure-relays page ↔ background: every outbound request is annotated with `origin: window.location.origin` so the background resolves `ConnectedSite` permissions against a trusted origin, not one sent by the page. Handles `chrome.runtime.lastError` gracefully (extension context invalidation → `RUNTIME_UNAVAILABLE` structured error).

3. **Background handlers (`src/bridge/handlers.js`)**, Phase 1 bridge surface registered against `MessageHost`:
   - `bridge.connect` / `bridge.disconnect`: ConnectedSite lifecycle; first-call-per-origin prompts `Approvals.connect`, subsequent calls are idempotent and update `lastUsedAt`
   - `bridge.getAccounts` / `bridge.getAddresses` / `bridge.getBalances`: scoped to `ConnectedSite.permissions.accounts` + `chains`; `getAddresses` filters by `(coin, network)` from the descriptor; `getBalances` rejects addresses the site isn't permitted to see with `ADDRESS_NOT_PERMITTED`
   - `bridge.getSupportedChains` / `bridge.getActiveChains`: registry enumeration; `getActiveChains` reads seeded per-chain settings
   - `bridge.signMessage` / `bridge.signPsbt`: route through `Approvals` unless the site already has the permission; approvals returns `{ approved, walletId, password, bip39Passphrase }` to complete the flow
   - `bridge.signAction`: Phase 1 supports `SEND` + `SWEEP`; other actions return `{ error: 'UNSUPPORTED_ACTION', supportedActions }` per §43.2 (structured, not thrown). `savePermanent: true` on the decision persists `canSignAction[KIND] = 'always'` on the ConnectedSite record
   - `bridge.signIn`: §43.6 challenge format `XChain Sign-In | appId | address | nonce | timestamp | expiresAt`, signed via the regular signMessageFlow. Default expiry 5 min, capped at 1 hour

**`Approvals` injection point**, shells inject an implementation that opens approval popups; `rejectAllApprovals` default throws `USER_APPROVAL_REQUIRED` so dApps get a structured error instead of a hang when the shell hasn't wired a popup yet. `UserRejectedError` class for explicit rejections.

**Manifest updates**, `content_scripts` matches `http://*/*` + `https://*/*` at `document_start`; `web_accessible_resources` exposes `inject/xchainProvider.js`; `permissions` adds `storage`.

Smoke-tested end-to-end through `MessageHost.handle()` (29 assertions): NOT_CONNECTED / MISSING_ORIGIN / CHAIN_NOT_PERMITTED / UNSUPPORTED_ACTION / USER_REJECTED / USER_APPROVAL_REQUIRED all surface as structured errors; connect → getAccounts → getAddresses → signMessage → signIn round-trip, signature verifies via SDK; disconnect removes the ConnectedSite; re-connect is idempotent.

## [0.29.0] - 2026-04-22

### Added

**§15.4 gap-limit address scan**, `discoverUsedAddresses(opts)`

Walks each chain's default HD derivation path from `startIndex`, asks the explorer "has this address been seen?", and stops after `gapLimit` consecutive unused addresses (BIP44 standard 20). Closes the "restore from seed" completeness gap: after an import the wallet knows the seed but not which addresses the user actually used, this flow discovers them.

Judgment calls (documented in the module header):

- **Partial-result semantics.** A chain's probe can fail mid-scan. The flow returns what was discovered up to the failure, marks `{ incomplete: true, error }`, and continues to the next chain. Callers resume by re-calling with `startIndex = lastScannedIndex + 1`
- **Unknown addresses preserve the gap.** When a single probe fails or times out, that index is recorded as `{ unknown: true }`: doesn't advance the gap counter, doesn't reset it either. Prevents a flaky response from masking a real used address (conservative; the chain-level timeout bounds the work if failures persist)
- **Two-tier timeouts.** `perQueryTimeoutMs` (default 5000) bounds one explorer call. `chainTimeoutMs` (default 60000) bounds the whole per-chain scan, a hanging or wildly-slow explorer can't lock the scan indefinitely
- **No persistence.** The flow returns a discovery report. Callers compose with `receiveAddress` or a review UI to persist what they want, same flow backs both "dry-run" and "real" restores
- **Address-type coverage.** Default scans only the descriptor's `defaultAddressType`. Opt in to every supported type via `addressTypes: 'all'`. Type-level failures (e.g. SDK doesn't support p2tr yet) mark that type as `incomplete` but other types on the same chain still scan, no whole-scan aborts from one unsupported type
- **Injectable used-check.** Default probe is `sdk.explorer.getHistory(address, 'address', { limit: 1 })`: empty array → unused. Callers can supply a bespoke `isUsedProbe` (e.g. `getBalances` + tx count) if the deployment's explorer exposes cheaper queries

Progress reporting: synchronous `onProgress(event)`: events `chain-start`, `scan-progress` (per-address, with `{ used, unknown, consecutiveUnused }` in `data`), `chain-complete`, `chain-failed`. Callback exceptions are isolated from the scan.

Smoke-tested: used addresses at {0, 3, 7} found with `highestUsedIndex=7` and exactly 13 queries at gapLimit=5; empty wallet terminates at gapLimit=20; multi-chain scan per-chain independent; mid-scan probe failures mark addresses unknown and record chain error without killing other chains; hanging probes bounded by `chainTimeoutMs`; resume via `startIndex=5` still finds index-7 used; `addressTypes: 'all'` scans every supported type; unsupported type in explicit list rejected; invalid mnemonic → `InvalidMnemonicError`.

## [0.28.0] - 2026-04-22

### Added

**§50 Diagnostic dump**, `diagnosticDump({ vault, chainRegistry, … })` + `createErrorRingBuffer({ capacity })`
- Collects the §50.1 JSON blob: wallet (version, platform, os, browser), sdk version, chain registry summary (id / coin / networkKind / user-added flag), endpoints per chain with custom-override flag, signer kinds + HW models, non-sensitive settings, recent errors (truncated), record counts (not records), build metadata
- Strict redaction via whitelist. Settings sanitization picks only known non-sensitive fields, future Settings additions default to being REDACTED unless added to the list (sensitive-by-default). ADS `accumulatedSats` and `lifetimeDonatedSats` redacted even though they're user-visible counters; `perTxAmountSats` / `triggerAmountSats` / `lifetimeTxCount` kept since they're useful for bug triage
- Every field the spec says to redact is absent: mnemonics, WIFs, passphrases, address strings, balance values, txids, contact names/addresses/notes, connected-site details. Counts only for wallets / accounts / addresses / contacts / connected_sites / pending_txs
- `createErrorRingBuffer({ capacity })`: fixed-size buffer for the shell's `window.onerror` / `unhandledrejection` / extension service-worker crash hooks (§50.4). Each entry: `{ at, kind, message (capped at 500 chars), phase? }`. Overflow drops oldest
- Dump is always producible, missing inputs become `null` rather than throwing, so even a half-configured wallet can emit a diagnostic
- Smoke-tested: empty-vault dump; full dump with wallet + imported WIF + contact (no secrets leak through `JSON.stringify`); user-custom endpoint override reflected; ring-buffer overflow and message-length truncation; dump round-trips through `JSON.stringify/parse` (no circular refs, no Uint8Array leaks)

## [0.27.0] - 2026-04-22

### Added

**§49 Offline / degraded mode**, reachability classification + queued broadcasts
- `checkReachability({ sdkRegistry, chainIds, probes?, timeoutMs? })`: per-chain × per-service (explorer / encoder / hub) probe with per-probe timeout. Returns `{ overall: 'normal'|'degraded'|'offline', perChain: [{ chainId, services, mode, latencyMs, errors }] }`. Default probes: `sdk.pingEncoder()`, `sdk.pingHub()`, and `sdk.explorer._get('/')` for explorer (any HTTP response within the timeout counts as reachable, probe only measures TCP+HTTP round-trip, not status code)
- Callers supply custom probes via `probes`; `null` disables that check and reports `'not-configured'` instead of reachable/unreachable. Cross-chain rollup: all-normal → `normal`, all-offline → `offline`, anything mixed → `degraded`
- New PendingTx status `'queued'` for §49.5 queued broadcasts
- `enqueueSignedTx`: stash signed tx hex in a PendingTx (fresh record or update an existing one). `listQueuedBroadcasts`: read all `status='queued'` records, optionally filtered by chainId. `drainQueuedBroadcast`: attempt to broadcast one; on success transition to `broadcast`, on failure stay `queued` with error recorded. `discardQueuedBroadcast`: user's "Discard" button (idempotent)
- Spec-compliant: §49.5 calls for per-record explicit user approval, not automatic re-broadcast, `drainQueuedBroadcast` is one-at-a-time and surfaces failure without swallowing. `discardQueuedBroadcast` is the dual
- Smoke-tested: normal/degraded/offline classification under all single- and multi-chain configurations, disabled-probe path, timeout path, end-to-end enqueue → drain success → drain failure → discard lifecycle, per-chain filtering

## [0.26.0] - 2026-04-22

### Added

**Signing from imported-WIF addresses**, unblocks spending from wif-only wallets and from imported-WIF addresses in HD wallets
- `SoftwareSigner.unlock` now decrypts every `Wallet.importedKeys` entry into `_unlocked.importedWifs` (Map<addressId, Uint8Array>). Same master-key lifetime as the seed, zeroed on `lock()` alongside it
- Abstract Signer contract updated: `SigningPathEntry` carries either `path` (HD, all signers) or `addressId` (imported-WIF, software signer only). Multi-key signing within one tx remains a future enhancement
- `SoftwareSigner.signPsbt` / `signMessage` / new `exportWifForAddressId` route by which field the entry carries. Exactly-one-of validation, supplying both or neither surfaces as a structured error at the signer boundary
- `normalizeSource` in `sendAsset` / `sweepAsset` now accepts Address records with `source='imported-wif'` and `derivationPath=null`; extracts the Address record's `id` as the `addressId` in the resulting signing-path entry. Watch-only and hardware sources still rejected with a clear message
- `signMessageFlow` accepts `{ path }` or `{ addressId }` (exactly one); `signPsbtFlow` passes the new `SigningPathEntry` shape through unchanged
- Smoke-tested end-to-end: HD+imported hybrid wallet signs via both paths (both signatures verify through `sdk.auth.verifyMessage`); wif-only wallet signs a message through the imported-key path; `normalizeSource` accepts imported-WIF records and still rejects watch-only; the signer's `exportWifForAddressId` returns the exact WIF that was imported

### Changed

- `Signer.SignMessageParams` now declares `path` and `addressId` as optional; exactly one must be present. HW-signer implementations should reject `addressId` at their own boundary (software-only concept)

## [0.25.0] - 2026-04-22

### Added

**ADS submission integration** (§36.3), donation output injection + counter commit wired into `submitAction`
- New `ChainDescriptor.adsDonationAddress` field. All 9 bundled descriptors ship with the sentinel `'PLACEHOLDER_REPLACE_BEFORE_MAINNET'` (§5.5), real addresses TBD closer to launch
- `ADS_DONATION_ADDRESS_PLACEHOLDER` + `isDonationAddressConfigured(descriptor)` exposed from the registry. A grep-replace sweep before mainnet release physically can't be missed, the sentinel is an obvious non-address string that fails any address validator
- `resolveAdsPlanForNextTx(settings, chainId, chainRegistry)` → `{ donationAmount, donationAddress, canSubmit, reason }`. Combines the pure arithmetic (`resolveAdsForNextTx`) with the address configuration check. `reason` enumerates `ok`, `ads-disabled`, `chain-not-seeded`, `trigger-not-reached`, `address-not-configured`, `unknown-chain` so UI can surface specific states (e.g. "pending donation $X, address not yet configured")
- `submitAction` now resolves the ADS plan up front and: (a) when `canSubmit`, appends `{ address, value }` to `encoderOpts.customOutputs` so the encoder builds the donation into the transaction; (b) after a successful broadcast calls `commitAdsStep` with `donationIncluded: canSubmit`. When ADS is enabled but `canSubmit=false` (placeholder still in place), the counter STILL advances with `donationIncluded=false` so the user's `lifetimeTxCount` reflects reality
- Caller-supplied `customOutputs` (e.g. for a COINPAY tx) survive alongside the ADS injection, the ADS output is appended, not replaced
- `commitAdsStep` failures are swallowed into an `ads-commit-failed` `onProgress` event rather than throwing; ADS accounting must not obscure a successful broadcast from the caller
- Smoke-tested: 9-descriptor sentinel sweep; all 6 resolver reasons; end-to-end inject path (real address) produces the expected customOutput + post-submit state (accumulator reset to perTx, `lifetimeDonatedSats` advanced); placeholder path produces NO injection but still advances `lifetimeTxCount` + `accumulatedSats`; caller's customOutputs preserved alongside ADS

### Known follow-up

Mainnet release checklist now has one concrete gate: `grep -r PLACEHOLDER_REPLACE_BEFORE_MAINNET packages/` must return empty before shipping. Regtest / testnet descriptors also carry the sentinel today; if e2e tests need the donation path exercised live, test harnesses should inject a custom descriptor via `ChainRegistry.addCustom`.

## [0.24.0] - 2026-04-22

### Added

**`importSingleWif(opts)`** (§15.4), fresh wallet backed only by an imported WIF, no HD
- New `Wallet.format = 'wif-only'`. Schema carve-outs: `encryptedSeed` may be the empty string; `passphraseEnabled` must be false; `importedKeys` must have at least one entry (otherwise there's literally no key material and nothing to unlock)
- `SoftwareSigner.unlock` now branches on format: for `wif-only`, derives the master key from the password and probes it by decrypting the first `importedKey` entry. Wrong password surfaces the same way seed-decrypt failures do for seed-backed wallets (AEAD auth-tag mismatch)
- `exportPrivateKey` now branches its password-verification path by format: seed-backed wallets decrypt the seed blob as the probe; wif-only wallets decrypt the target `importedKey` directly (reused below for the actual WIF return). Either way a wrong password surfaces as `WrongPasswordError`
- Wallet + address + importedKey entry persisted atomically in order: wallet record (with the importedKey entry pre-populated) → address record. This keeps the wallet record schema-valid at the moment it hits the vault
- Smoke-tested: create → validate → unlock (right / wrong password) → export WIF → backup round-trip (the wif-only wallet survives `exportBackupFile` + `importBackupFile` and exportPrivateKey on the restored vault returns the same WIF)

### Known limitations

Spending from a wif-only wallet (and spending from imported-WIF addresses in an HD wallet) is still blocked on the separate signer gap: `SoftwareSigner.signPsbt` routes key lookup via HD path only. `sendAsset` / `sweepAsset` currently reject `source='imported-wif'` with a helpful error. The wif-only wallet can persist, unlock, receive, and export; spending lands when the signer routes through `importedKeys`.

## [0.23.0] - 2026-04-22

### Added

**XCW chunked PSBT-over-QR transport** (§20.3), foundation for air-gapped signing
- Wire format: `XCW:<n>/<total>:<crc32-hex>:<base64-bytes>`. Per-chunk CRC32 in a separate textual field (not packed inside the base64) so a receiver sees a corrupted chunk before the payload parser
- Chunk content layout: chunk 1 carries `[32-byte SHA256 of reassembled bytes][payload part 1]`; chunks 2..N are raw payload parts. Hash on chunk 1 only (not every chunk), putting the hash on every chunk would mean trusting the LATEST-scanned hash, exactly the wrong property
- `encodeXcwChunks(psbt, { chunkBytes })`: hex-or-Uint8Array input, default 180 bytes/chunk (~240 base64 chars; fits comfortably in an alphanumeric QR code)
- `decodeXcwChunks(frames)`: one-shot order-independent reassembly. `parseXcwChunk(frame)`: single-frame validation. `createXcwCollector` / `addChunkToCollector`: progressive scanner state for animated QR streams
- Order-independent reassembly, duplicate-chunk dedup (animated QR loops), CRC32 per-chunk integrity, overall SHA256 verification after reassembly. All four failure modes surface as structured `XcwChunkError` with specific messages (`crc32 mismatch on chunk N/M`, `SHA256 of reassembled PSBT does not match`, `chunk 1 too short`, `malformed frame`)
- `detectQrContent` now recognizes `xcw-chunk` frames and returns `{ type: 'xcw-chunk', n, total, content }` so scanner UIs can branch on the type before feeding into a collector. Matched BEFORE generic URI detection because `XCW:` with a BIP21 parser loosely applied would misclassify as scheme `xcw`
- Smoke-tested: tiny-PSBT-single-chunk, 1KB-PSBT-13-chunks round-trip; out-of-order reassembly; duplicates silently ignored; CRC flip caught mid-stream; hash-mismatch caught when a chunk is forged with a valid CRC but different content

## [0.22.0] - 2026-04-22

### Added

**Labels-survive-restore: on-chain FILE-action sync** (§19.5.2), seed-derived encrypted labels + contacts
- `computeLabelSyncCommitmentKey(seed)` → `SHA256("xchain-wallet-label-sync" || seed)`: deterministic 32-byte AES-256 key; same seed always produces the same key
- `computeLabelSyncDiscoveryName(commitmentKey)` → hex SHA256 of the key, goes into the FILE action's `name` field so a restoring wallet can find its own ciphertext without trial-decrypting every FILE on the chain
- `encodeLabelSyncPayload` / `decodeLabelSyncPayload`: AES-256-GCM `iv || ct || tag` round-trip; body shape `{ version, updatedAt, labels, contacts }`
- `buildLabelSyncPayload({ vault, walletId, seed })`: reads the wallet's labeled addresses (HD + imported-WIF, label must be non-empty) and contacts; returns `{ ciphertext, discoveryName, body }` ready for the caller to publish via a FILE action
- `applyLabelSyncPayload({ vault, walletId, payload, onConflict })`: matches incoming labels to persisted addresses by id first, by `address` string as fallback (the id can't survive a from-seed restore because the new wallet generates fresh UUIDs). `onConflict: 'overwrite'` (default, user asked for sync) or `'preserve'`. Contacts are fully upserted with a fresh `updatedAt`
- Returns `{ addressesUpdated, addressesSkipped, addressesMissing, contactsAdded, contactsUpdated, contactsSkipped }` so the shell can surface "restored N labels, Y incoming labels had no matching address"
- Smoke-tested: deterministic keys, round-trip decrypt, wrong-key rejection, end-to-end on a seed-restored wallet (labeled HD address on wallet A → new wallet B from same mnemonic → payload decrypts with B's seed → label applied to B's corresponding address)

The FILE action submission itself (calling `sdk.encoder.action` with the chain choice) is kept in the shell integration, it needs a chainId picker (lowest-fee chain by default per spec) and access to the wallet's fee strategy, both of which are orthogonal to the payload codec.

## [0.21.0] - 2026-04-22

### Added

**`dryRunRestore(opts)`** (§19.6), test a backup without committing
- Derives the first N HD addresses per active chain from a caller-supplied mnemonic (+ optional BIP39 passphrase) and compares them against the current wallet's persisted addresses
- Format-aware (`bip39` vs `counterwallet-legacy`). Does NOT auto-detect, the same 12 words could be valid in both lists; a silent choice would mask a mismatch. Callers pick the format up-front, matching how the user entered their words
- Returns `{ overallMatch, perChain: [{ chainId, addressType, derived, comparisons, matchedCount, divergentCount, missingCount }] }` so the shell can render the per-chain green-check / red-X treatment from the spec
- `overallMatch = false` when any comparison diverges OR when the wallet has persisted addresses but none match (guards against "seed looks valid but isn't mine")
- Nothing persists. Seed material zeroed on exit; per-path HD keys zeroed inside the loop. `gapLimit` default 10, configurable 1–1000
- Smoke-tested: correct mnemonic matches, random BIP39 mnemonic diverges, `InvalidMnemonicError` for bad words, right/wrong BIP39 passphrase differentiate cleanly, `gapLimit` respected, address count unchanged after the flow runs

## [0.20.0] - 2026-04-22

### Added

**`exportBackupFile(opts)` / `importBackupFile(opts)`** (§19.4), encrypted `.xchain-wallet` backup file
- Envelope per spec: `{ magic: 'XCHAIN-WALLET-BACKUP', formatVersion: 1, createdAt, walletName, encryption: { algorithm, kdf, iv, tag }, payload }`. iv/tag stored as separate base64 fields (not the vault codec's packed blob) so third-party implementations / auditors can inspect the envelope without matching our concatenation order
- Independent backup password per §19.4, fresh Argon2id KDF params generated at export time (or caller-supplied via `kdfParams` override); the params land in the envelope so import reproduces the same master key
- Payload captures: wallet (incl. `encryptedSeed` + `importedKeys`), accounts scoped to the target walletId, addresses scoped via accountId or imported-key linkage, contacts + connectedSites (not wallet-scoped; ride whole), settings, pendingTxs for linked addresses, `signers: []` (reserved for HW pairings)
- Per-spec omissions: BIP39 passphrase (user re-enters on restore to preserve the passphrase's security property), hardware-wallet private keys (live on device)
- Import conflict policy `onConflict`: `'error'` (default, throws `BackupConflictError` with the conflict list), `'preserve'` (skip existing, write missing), `'overwrite'` (incoming wins). Returns `{ writes, skipped }` counts per collection
- Round-trip verified: labels survive, imported-WIF exports to the same string from the restored wallet, tampered payload bytes flip auth and reject, wrong magic / wrong password / wrong formatVersion all rejected with structured errors (`BackupFormatError`, `BackupPasswordError`)

**`@xchain-wallet/core/crypto/backup.js`** exposes the low-level primitives (`encodeBackupEnvelope`, `decodeBackupEnvelope`, `parseBackupEnvelope`, `stringifyBackupEnvelope`) for callers that want to wrap alternate payload shapes in the same envelope, e.g. the §19.5.2 label-sync commitment or a future diagnostic-dump envelope.

## [0.19.0] - 2026-04-22

### Added

**`exportPrivateKey(opts)`** (§17.7), user-visible private-key export, parity with FreeWallet
- Routes by `Address.source`: HD addresses derive on-demand from the in-memory seed at the address's derivation path; `imported-wif` addresses decrypt the matching entry from `Wallet.importedKeys` under the wallet master key
- Refuses `trezor` / `ledger` with `NoKeyForAddressError({ reason: 'hardware' })` (key lives on device); refuses `watch-only` with `reason: 'watch-only'`
- Verifies password first by decrypting the seed blob, a wrong password returns `WrongPasswordError` on the imported-wif path instead of a vague AEAD failure
- Returns `{ wif, source, derivationPath, address, chainId }` for shell display. Memory hygiene: master key zeroed on exit, decrypted WIF-bytes zeroed after decoding. JS-string caveat from §17.7.3 still applies
- `SoftwareSigner.exportWifForPath({ chainId, path })` exposed as the HD path primitive; caller can use it directly during an already-unlocked session to avoid a second Argon2id round
- Smoke-tested end-to-end on real SDK: HD WIF round-trips to the same address via `sdk.wallet.importWIF` + `sdk.wallet.deriveAddress`; imported-WIF export returns the exact string that was imported; wrong password, missing address, watch-only, and hardware sources all reject with the right error class

## [0.18.0] - 2026-04-22

### Added

**ADS accumulator arithmetic** (§36.3), pure + vault-aware helpers that drive the Automatic Donation System
- `resolveAdsForNextTx(settings, chainId) → { donationAmount }`: read-only check run BEFORE constructing a tx. If the accumulator has crossed the trigger, the next tx carries a donation output of that amount
- `stepAdsAccumulator(settings, chainId, { donationIncluded }) → Settings`: pure state transition run AFTER a successful broadcast. Normal: `accumulated += perTx`, `lifetimeTxCount++`. When `donationIncluded`: `lifetimeDonatedSats += prior accumulated`, `accumulated = perTx` (this tx's own contribution seeds the next cycle), `lifetimeTxCount++`
- `commitAdsStep({ vault, chainId, donationIncluded })`: vault-aware wrapper: reads current Settings, runs `stepAdsAccumulator`, persists
- Pure `step` is identity when ADS is disabled or the chain isn't seeded, safe to call unconditionally from submission flows
- Round-trip verified: 1000 txs at `perTx=1, trigger=1000` → exactly one donation fires on tx 1001; `accumulated` resets correctly; other chains' state is untouched

**Known gap:** the `submitAction` integration (inject donation output into `encoderOpts.customOutputs`, then `commitAdsStep`) is intentionally deferred. It needs a per-chain donation address, which is a §5.5 placeholder pending hub-config resolution. The arithmetic ships now; the integration lands when the address is wired.

## [0.17.0] - 2026-04-22

### Added

**`@xchain-wallet/core/uri`**, URI parsing + QR content detection

- `parseBip21Uri(uri)` / `encodeBip21Uri(opts)` (§29.10), full BIP21 round-trip. Standard params (`amount`, `label`, `message`) lifted to the top level for convenience; anything else (including chain-specific `tick`, `action`, etc.) flows through `params`. `req-*` prefixed params surface in `required[]` so callers can enforce the BIP21 "must support" semantics. Percent-decoding at parse, percent-encoding at emit, round-trip verified through Unicode and special chars (`a&b=c d`, `Coffee ☕ / 50%`). `InvalidBip21Error` for malformed input
- `detectQrContent(input, { chainRegistry? })` (§32.2), classifies a scanned string into one of: `bip21`, `xchain-uri`, `psbt-hex` (PSBT magic `70736274ff` prefix), `wif`, `mnemonic-bip39` (with whitespace + case normalization), `mnemonic-counterwallet`, `address` (loose heuristic fallback), or `unknown`. First-match-wins with specific formats tried before the loose address fallback. Chain-registry-aware: when a registry is supplied, BIP21 detection is restricted to its known `uriScheme`s (so `myscheme:addr` doesn't get misclassified as BIP21)

## [0.16.0] - 2026-04-22

### Changed

**`submitAction` now optionally tracks a PendingTx record (§11.3.8) through the submission lifecycle**
- New optional `pendingTxMeta: { fromAddress, toAddress, actionSummary }`. When supplied, the flow creates a PendingTx at `composing`, advances through `awaiting-signature` → `broadcasting` → `broadcast` (or → `indexed` if `waitForTxid` is supplied), and persists via the vault at every transition
- On error, status transitions to `failed` with the error message recorded; the record is preserved so the history screen (§28) can surface failure reasons instead of losing the submission
- Return shape adds `pendingTxId: string | null` so callers can look up the record later
- Caller's `onProgress` still fires alongside the lifecycle tracker; a thrown `onProgress` does NOT derail the tracker's persistence
- `sendAsset` and `sweepAsset` auto-populate `pendingTxMeta` with generated summaries (`"Send 100 XCP to bc1q…, memo"`, `"Sweep balances + ownerships to bc1q…, memo"`). Opt-out via `trackPendingTx: false`

**The tx-status timeline (§28.4) and RBF/cancel flows (§44.4) can now read live state**, every submitted action leaves a traceable record in the vault without the UI layer needing to intercept progress events.

## [0.15.0] - 2026-04-22

### Added

**`createDemoWallet(opts)`** (§25.2), ephemeral try-before-commit wallet
- In-memory only (`InMemoryBackend`); nothing ever touches IndexedDB / chrome.storage / file
- Auto-generated 64-char hex password (256 bits) returned to the caller, shell holds it for the session, drops it when the user exits demo
- Intentionally weak KDF (`iterations: 1, memory: 8192`), the ciphertext never reaches an attacker, so paying ~1s of Argon2id buys nothing and makes demo feel sluggish
- Per-spec the shell does NOT display the mnemonic (nothing useful to back up for a throwaway wallet)
- Default `activeChainIds` is the three regtest chains (no endpoint dependency, no mainnet confusion); overridable
- Returned `{ vault, password, walletId, mnemonic, wallet, account, addresses }` drives every existing flow (unlockWallet / receiveAddress / walletBalances / sendAsset / …) unchanged, demo mode is the same code path with a different backend

## [0.14.0] - 2026-04-22

### Added

**`signMessageFlow(opts)`** and **`signPsbtFlow(opts)`**, standalone user-initiated sign flows (§30.1, §30.4)
- `signMessageFlow({ walletId, password, chainId, path, message, … })`: unlocks, signs, locks. Round-trip verified via real SDK `verifyMessage` on BTC p2wpkh
- `signPsbtFlow({ walletId, password, chainId, psbtHex, signingPaths, … })`: unlocks, signs, locks. Real-PSBT end-to-end test produces a 64-hex-char txid
- Both guarantee `signer.lock()` in a `finally`: seed material zeroed on success and on throw
- Input validation: paths that don't start with `m/`, non-string messages, empty `psbtHex`, and empty `signingPaths` all rejected at the flow boundary with clear errors

## [0.13.0] - 2026-04-22

### Added

**`importWif(opts)`**, add a single imported private key to an existing HD wallet (§15.5)
- Validates the WIF via `sdk.wallet.importWIF` (checksum + chain network match); derives the address via `sdk.wallet.deriveAddress`
- Encrypts the WIF under the same master key that protects the wallet's seed (one password unlocks both); uses the wallet's existing `kdfParams` so the derivation matches
- Creates an `Address` record with `source: 'imported-wif'`, `derivationPath: null`, `accountId: null`, `signerId: walletId`: per §11.3.3's carve-out for non-HD entries
- Appends an `{ addressId, encryptedWif, importedAt }` entry to `Wallet.importedKeys` (§11.3.1); round-trip verified, the stored ciphertext decrypts back to the original WIF under the same password
- Single KDF round per import: the password is verified by decrypting the seed blob, then the same derived master key encrypts the WIF, one Argon2id round, not two
- `InvalidWifError` for malformed / network-mismatched WIFs; `WrongPasswordError` for bad passwords (password check runs before any WIF persistence so a bad-password attempt leaves the wallet unchanged)

## [0.12.0] - 2026-04-22

### Added

**`@xchain-wallet/extension/background`**, MV3 service-worker skeleton
- `MessageHost`: transport-agnostic request/response router with typed handlers. Uniform response envelope `{ ok: true, result } | { ok: false, error: { name, message } }`; synchronous and async handler errors are serialized (the transport never drops a silent failure). `UnknownMessageTypeError` / `InvalidMessageError` for diagnostics
- `createBackgroundHost(deps)`: factory that registers the Phase 1 handler surface: `wallet.list` / `wallet.exists` / `wallet.create` / `wallet.import` / `wallet.checkPassword` / `receive.getAddress` / `action.send` / `action.sweep` / `balances.wallet` / `balances.address` / `history.address`
- Safe-wallet projection: wallet records returned over the wire strip `encryptedSeed` / `kdfParams` / `importedKeys`: narrows the blast radius of any future popup-side logging
- `attachChromeRuntime(host, chromeRuntime?)`: wires the host to `chrome.runtime.onMessage` using the MV3 `return true` + `sendResponse` async-response contract. Returns a detach function for hot-reload / tests; injectable runtime for tests

**`@xchain-wallet/web/storage/IndexedDBStorageBackend`**, primary-store adapter for the browser SPA target (§11.2)
- Wraps raw IndexedDB with a minimal Promise surface; bytes ↔ base64 at the wire boundary (same pattern as the Chrome backend, avoids cross-browser typed-array round-trip quirks)
- `KeyValStore` injectable adapter lets tests run against a Map-backed mock without fake-indexeddb; production lazy-opens a real database + object store
- Defaults: `DEFAULT_DB_NAME = 'xchain-wallet'`, `DEFAULT_STORE_NAME = 'vault'`, `DEFAULT_STORAGE_KEY = 'wallet-vault'`
- Full Vault round-trip verified end-to-end through the backend

**`@xchain-wallet/web`** now depends on `@xchain-wallet/core` via `workspace:*`.

## [0.11.0] - 2026-04-22

### Added

**`@xchain-wallet/extension`**, first shell-layer modules
- `ChromeStorageBackend`: `StorageBackend` adapter for MV3 `chrome.storage.local`, the primary persistent store per §11.2. Base64-encodes bytes at the wire boundary (Chrome's structured-clone of `Uint8Array` has historically been unreliable between popup / service-worker contexts)
- `ChromeSessionBackend`: subclass targeting `chrome.storage.session` for ephemeral state (unlocked-session handles, dApp tokens). Default key distinct from local so the two stores can coexist on the same mock in tests and never collide in production
- Both accept an injected `chromeStorage` for tests / non-browser targets; throw session-aware or local-aware errors when no storage is available
- `DEFAULT_STORAGE_KEY = 'xchain-wallet:vault'`, `DEFAULT_SESSION_STORAGE_KEY = 'xchain-wallet:session'`
- Workspace wire-up: `@xchain-wallet/extension` now declares `@xchain-wallet/core` as a `workspace:*` dep
- End-to-end verified: full `Vault` round-trip through `ChromeStorageBackend`: wallet records persisted and retrievable across vault reopens

**`reconcileAddressSigners(opts)`**, closes the Address v1→v2 migration loop (§17.6)
- Walks addresses with `signerId === null`, derives the pubkey from each supplied unlocked signer at the stored `derivationPath`, and writes back the matching signer's id when exactly one matches
- Caller supplies unlocked signers (the function doesn't touch unlock/lock state); fits naturally into `withUnlocked(opts, (signer) => reconcileAddressSigners({ ..., signers: [signer] }))`
- Idempotent; returns `{ scanned, reconciled, skipped[] }` with per-address skip reasons (`no-path` / `unknown-chain` / `no-match`)
- Optional `walletId` and `chainId` filters narrow scope
- `AmbiguousSignerMatchError` thrown if multiple signers derive the same pubkey at the same path, silent ambiguity could misroute future ops, so we fail loudly

**Migration cycle now end-to-end:** the harness (v0.3.0) + the first bump (v0.8.0, Address v1→v2) + the reconciler (this release) demonstrate the full schema-evolution story, forward-only migration on read, followed by runtime reconciliation of any deferred resolution.

## [0.10.0] - 2026-04-22

### Added

**`receiveAddress(opts)`** (§29.7), derive and persist the next unused external HD address
- Scans persisted addresses scoped to (accountId, chain, network, addressType, source='hd', change=0); parses the BIP44 index from the stored path; derives `max + 1`
- Per-chain and per-addressType scoping: BTC p2wpkh and BTC p2pkh count separately; DOGE and BTC count independently
- Ignores internal change-chain (change=1) addresses when computing the next external index
- Defaults addressType to `descriptor.defaultAddressType`; default label `"Address #N+1"`
- `NoMatchingAccountError` for a missing `accountIndex`
- Real-SDK verified: after `importMnemonic` of the canonical BIP39 test vector, indices 1 and 2 match the canonical BIP84 addresses (`bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g`, `bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z`)

**Balance / history read flows**, `addressBalances`, `addressHistory`, `walletBalances`
- `addressBalances({ sdkRegistry, chainId, address, opts? })` / `addressHistory(...)`: thin pass-throughs to `sdk.getBalances` / `sdk.getHistory(address, 'address', opts)`
- `walletBalances({ vault, walletId, chainRegistry, sdkRegistry, chainId?, opts? })`: wallet-scoped aggregator. Resolves the wallet's account ids → filters addresses → groups by chainId → fetches in parallel per address
- Partial results: one-address fetch failure yields `{ balances: null, error: <message> }`; other entries are unaffected
- Optional `chainId` filter; `opts` forwarded to every call; stray addresses not tied to the wallet and addresses on unknown chains are silently skipped

**`ChainRegistry.chainIdFor(coin, networkKind)`**, reverse lookup from Address record fields (coin + network) to chainId. Enables the balances aggregator and any future flow that needs to route operations per chainId when the input records don't carry it.

**`withUnlocked(unlockOpts, fn)`** / **`withUnlockedRecord(unlockOpts, fn)`**, session helpers
- Unlock → `await fn(signer)` → lock in `finally`. Signer guaranteed locked on resolve *and* reject, no half-unlocked state can leak
- Batches multiple signing ops under one unlock. Argon2id is ~1s per unlock; deriving three addresses under one `withUnlocked` pays one KDF round, not three
- Callback can be async or sync; return value flows through. Nested `withUnlocked` calls each get their own signer with independent lifecycles

## [0.9.0] - 2026-04-22

### Added

**`sendAsset(opts)`**, convenience wrapper for the SEND action (§Phase 1 authoring surface)
- JS-friendly params (`to`, `asset`, `amount`, `memo`, `fee`, `feePerKb`, `rbf`) mapped to protocol field names (`DESTINATION`, `TICK`, `AMOUNT`, `MEMO`)
- `amount` coerced to string so callers can pass numbers; `memo` is omitted from the action string when not supplied
- `from` accepts either a full `Address` record (from the vault) or an explicit `{ address, publicKey, derivationPath }` triple
- Multi-destination SEND (protocol formats v1–v3) intentionally out of scope; drop to `submitAction` for those
- Verified against real `xchain-sdk` to produce the canonical `SEND|0|XCP|100|<addr>|gift` action string

**`sweepAsset(opts)`**, convenience wrapper for the SWEEP action
- JS booleans (`balances`, `ownerships`, `escrows`) mapped to protocol `'1'`/`'0'` strings
- Protocol defaults mirrored: `balances=true, ownerships=true, escrows=false`
- No-op guard: rejects when all three flags are false
- Verified against real `xchain-sdk` to produce the canonical `SWEEP|0|<addr>|1|1|0[|memo]` action string

**`normalizeSource(from, fnName?)`**, shared helper exported from `sendAsset.js`. Duck-types either Address records or `{ address, publicKey, derivationPath }` triples into the triple form; rejects null `derivationPath` (imported-WIF paths don't support HD signing). Available for future single-source flows.

**`seedSettingsForChains(settings, chainRegistry, activeChainIds)`** and **`ensureSettings(vault, chainRegistry, activeChainIds)`**, populate `Settings.fees[chainId]` and `Settings.ads.perChain[chainId]` from chain-descriptor defaults
- Per-chain fee defaults: `strategy = descriptor.feeStrategy.defaultStrategy`, `customSatsPerKb = null`, `rbfByDefault = descriptor.feeStrategy.rbfSupported` (so BTC / LTC default to RBF-on, DOGE to RBF-off)
- Idempotent: existing entries are never overwritten, a user's customized fee strategy or accumulated ADS state survives a second invocation
- `ensureSettings` handles the vault-level read-or-default, seed, and write-back

### Changed

**`_persistHdWallet`** (internal), added a final step calling `ensureSettings(...)`, so every wallet created through `createWallet` or `importMnemonic` has a valid Settings record with per-chain entries for its active chains. Fees and ADS panels are now renderable without handling an empty-map case.

## [0.8.0] - 2026-04-22

### Added

**`importMnemonic(opts)`** (§15.4 paths 1+2), user-supplied mnemonic import
- Handles BIP39 (12 / 24 words) and Counterwallet-legacy from one entry point
- Auto-detects format (BIP39 checksum-validated first; Counterwallet as fallback) or validates an explicit `format` against the input
- Normalizes input: trims, collapses whitespace, lowercases, so paste-from-anywhere works
- Counterwallet path explicitly rejects any `bip39Passphrase`
- Default `origin` derived from format (`imported-mnemonic` / `imported-freewallet`); caller can override
- Exports `normalizeMnemonic`, `detectMnemonicFormat` as public utilities
- Error classes: `InvalidMnemonicError` (carries `format` + per-field `errors`), `UnknownMnemonicFormatError`
- Verified against real `xchain-sdk`: `abandon × 11 + about` produces the canonical BIP84 address `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`

**`submitAction(opts)`**, one-call submission wrapper
- Composes `unlockWallet` → `submitWithSigner` → `signer.lock()` in a `finally`
- Seed material is always zeroed, even if `submitWithSigner` throws mid-pipeline
- Returns the full `SubmitResult` from `submitWithSigner`; every shell's "Send" and dApp-sign-request flows can land on this
- For batched submissions under one unlock, callers compose directly, re-unlocking is ~1s of Argon2id

### Changed

**`Address` schema v1 → v2**, §17.6 signer routing
- Added `signerId: string | null` field, stable id of the owning signer (SoftwareSigner uses `wallet.id`); `null` = needs reconciliation
- Added `addressMigrations[1]`: carries v1 records forward with `signerId: null` and documents runtime reconciliation intent
- `validateAddress` accepts `string | null`; rejects numeric/wrong types; new records written at v2 and v1 `put` attempts are rejected
- `createWallet` / `importMnemonic` (via `_persistHdWallet`) populate `signerId = signer.id` on initial addresses, wallets created post-migration are linked from day one

**`createWallet`**, refactored to share post-encryption plumbing with `importMnemonic` via an internal `_persistHdWallet` helper. 175 lines → 84. Same behavior (regression-tested); one source of truth for the persist-new-HD-wallet pipeline.

## [0.7.0] - 2026-04-22

### Added

**`@xchain-wallet/core/flows`**, first full-stack user-facing flows
- `createWallet({ password, vault, chainRegistry, sdkRegistry, activeChainIds, name?, strengthBits?, bip39Passphrase?, kdfParams? })` (§15.3), generates a BIP39 mnemonic, encrypts it under a device-calibrated Argon2id master key, and persists a ready-to-use wallet: Wallet + first Account (index 0) + first Address per active chain (using each chain's defaultAddressType). Returns the plaintext mnemonic for the §19.2 seed-phrase display ceremony. KDF calibration defaults to ~1s via `calibrateKdfParams`; tests / shells can pre-supply `kdfParams`
- `unlockWallet({ vault, walletId, password, bip39Passphrase?, chainRegistry, sdkRegistry })`: vault lookup + `unlockWalletRecord`; returns an available SoftwareSigner
- `unlockWalletRecord({ wallet, password, bip39Passphrase?, chainRegistry, sdkRegistry })`: the shared primitive for flows that already hold a Wallet record in hand. Locks the signer if unlock throws (no half-unlocked state ever leaks)
- `WalletNotFoundError`: thrown on missing walletId

Round-trip verified: address created at wallet-creation time matches address re-derived after unlock on a fresh signer. Counterwallet-format records unlock through the same primitive (synthetic fixture; seeds the raw 16-byte Counterwallet seed rather than a PBKDF2-stretched BIP39 seed).

End-to-end verified against the real `xchain-sdk`: generated wallet produces valid `bc1q…` / `D…` / `ltc1…` addresses that `sdk.wallet.validateAddress` accepts.

## [0.6.0] - 2026-04-22

### Added

**`submitWithSigner(opts)`** (§10.4), action submission lifecycle routed through the Signer interface
- Pipeline: `createAction` → `encoder.createTx` → `signer.signPsbt` → `encoder.broadcastTx` → optional P2SH/P2WSH second phase (`spendP2sh` + second sign + second broadcast) → optional indexer wait
- Returns `{ txid, actionString, action, version, encoding, signed, indexed }`; `txid` is always the *final* (phase-2 in P2SH/P2WSH case) txid
- Progress callback fires `creating` / `encoding` / `signing` / `broadcasting` / `p2sh_spending` / `waiting` / `confirmed`
- Indexer wait is opt-in via caller-supplied `waitForTxid(txid, opts)`: the SDK doesn't expose `ActionWaiter` on the instance, so shells wire this themselves (keeps the wrapper decoupled from the polling strategy)
- Strict input validation: missing `encoderOpts.pubkey`, empty `signingPaths`, or uninitialized encoder all throw clear errors
- Verified end-to-end against real `xchain-sdk` with an actual `SEND|XCP|100|...` action: real 64-hex-char ECDSA txid, real action string, full progress sequence

**`adaptXChainSDK(XChainSDKClass)`**, convenience helper that wraps an `XChainSDK` constructor as the `SDKFactory` shape `SDKRegistry` expects; validates the input is a class/function. Shells use it as `sdkFactory: adaptXChainSDK(XChainSDK)` regardless of how they imported the SDK (native ESM / `createRequire` / bundled browser build)

### Changed

**`SoftwareSigner.signMessage`**, two fixes surfaced by real-SDK integration
- Unwraps the SDK's `{ signature, address }` return; formerly was embedding the whole object as the "signature" (which wasn't a string)
- Routes `segwitNative` / `segwitRedeemScript` opts based on the BIP44 purpose in the path: `m/84'` → `segwitNative: true`, `m/49'` → `segwitRedeemScript: true`, `m/44'` → no flags, `m/86'` → explicit `p2tr message signing not supported` error (SDK's `bitcoinjs-message` backend doesn't do taproot)
- Verified round-trip via `sdk.auth.verifyMessage` on BTC p2wpkh, BTC p2sh-p2wpkh, and DOGE p2pkh

## [0.5.0] - 2026-04-22

### Added

**`@xchain-wallet/core/sdk`**, per-chain SDK instance registry (§10.2)
- `SDKRegistry` class: lazy instantiation on `get(chainId)`, instance caching, `initActive(chainIds)` for parallel startup, `invalidate(chainId)` / `invalidateAll()` with `sdk.close()` cleanup hook, `setEndpointOverrides()` for Settings-driven URL overrides
- `SDKFactory` callback pattern, `core` stays SDK-agnostic; shells pass in whatever import path works for their target (`require('xchain-sdk')`, `await import`, or a mock for tests)
- `XChainSDKLike` typedef documenting the minimal SDK surface the wallet depends on.
- `UnknownChainError` for unregistered chain ids
- Smart URL join: `:443` / `:80` elided; other ports kept explicit

### Changed

**Chain descriptors** carry `wifVersionByte`
- Added to `ChainDescriptor` shape and validator (`[0,255]` required)
- Bundled values: BTC 0x80 / 0xef (mainnet / test+regtest), LTC 0xb0 / 0xef, DOGE 0x9e / 0xf1

**`SoftwareSigner`**, three previously stubbed methods are now real
- Constructor takes optional `sdkRegistry`; throws a clear error if a delegated method is called without one
- `getAddresses({ chainId, accountIndex, change, startIndex, count, addressType? })`: derives each pubkey via BIP32, calls `sdk.wallet.deriveAddress(pubkeyHex, { type })`. Rejects address types the chain doesn't support. Derived keys zeroed after encoding
- `signPsbt({ psbtHex, chainId, signingPaths })`: derives WIF with chain-appropriate version byte, calls `sdk.wallet.signPsbt`. Phase 1 restriction: all `signingPaths` must share one path; multi-key signing is flagged as a future enhancement
- `signMessage({ message, chainId, path })`: derives WIF, calls `sdk.auth.signMessage`
- All three still gate on `_assertUnlocked()` (`SignerLockedError` when locked)

## [0.4.0] - 2026-04-22

### Added

**`@xchain-wallet/core/storage`**, persistent-state facade (§11.2)
- `Vault` class with `open()` / `save()` / `clear()` / `close()` lifecycle and per-collection handles (`vault.wallets`, `accounts`, `addresses`, `contacts`, `connectedSites`, `pendingTxs`) plus singleton `vault.settings`
- Per-collection API: `get(id)`, `list()`, `put(record)` (with schema validation), `delete(id)`, `count()`, `findBy(field, value)`
- Migration-on-read, records auto-upgrade via the schema migration harness on their way out of the vault
- Auto-save-per-mutation default; `autoSave: false` lets shells batch explicitly
- Abstract `StorageBackend` contract; `InMemoryBackend` ships in `core` for tests and the no-wallet-yet empty state
- `codec.js`: document-level encrypt/decrypt via the shared AES-256-GCM AEAD. `documentVersion` header gates future codec breakage; missing collections default to `[]` so forward-compatible reads stay clean
- Master-key lifecycle: `Vault` holds a private copy, zeros it on `close()`. AAD passthrough lets shells scope the vault to a wallet id or origin
- `VaultStateError` (pre-open / post-close operations) and `VaultValidationError` (put with invalid record, carries `collection` + per-field errors)

**`@xchain-wallet/core/crypto/counterwallet`**, legacy Counterwallet mnemonic import (§15.2)
- Canonical 1626-word wordlist vendored from `Mnemonic.js` v1.1.0 (Yiorgis Gozadinos / Crypho AS, MIT) with attribution header, no runtime dep on a stale npm package
- `validateCounterwalletMnemonic(str) → { ok, errors }` with word-level diagnostics; tolerates whitespace and mixed case
- `counterwalletMnemonicToSeedBytes(str)` returns the 16-byte raw seed (Counterwallet has no PBKDF2 stretching, the decoded bytes feed directly into BIP32 `HDKey.fromMasterSeed`)
- `counterwalletMnemonicToSeedHex(str)` convenience hex form
- Verified against the reference Mnemonic.js implementation for 100 random seed round-trips

### Changed
- `SoftwareSigner.unlock` now routes by `walletEncryption.format`: `'bip39'` (default, optional §15.6 passphrase) or `'counterwallet-legacy'` (Counterwallet decoder, BIP39 passphrase rejected).
- `@xchain-wallet/core` root barrel adds `storage` namespace alongside `schemas` / `registry` / `signers` / `crypto`

## [0.3.0] - 2026-04-22

### Added

**`@xchain-wallet/bridge-spec`**, complete dApp-bridge surface (§43)
- Full TypeScript definitions for `window.xchain`: `XChainProvider`, per-method param/return types, permission shapes, error codes
- Sign-in with XChain v1 challenge format + `formatSignInChallenge` / `parseSignInChallenge` helpers
- Reference client (`client.ts`): `getProvider({ timeoutMs })` discovery, `PROVIDER_READY_EVENT`, `generateNonce`, `makeSignInParams`, `validateSignInChallenge`
- Global `Window.xchain` augmentation so dApps get IDE completion

**`@xchain-wallet/test-dapp`** (new package), reference dApp exercising the bridge
- `MockXChainProvider` implementing the full `XChainProvider` interface; configurable `autoApprove` / `rejectAll` / `supportedActions` for testing both paths
- `runExample()` worked example covering connect → getAccounts/Addresses/Balances → signIn → signMessage → signAction(SEND) → signAction(ISSUE)→UNSUPPORTED_ACTION → disconnect
- Compile-time conformance check: if `MockXChainProvider` compiles against `XChainProvider`, the interface is internally coherent

**`@xchain-wallet/core/schemas`**, data-model schemas (§11)
- Eight record schemas: `Wallet`, `Account`, `Address`, `Contact`, `ConnectedSite`, `MultisigConfig` (reserved; validator only), `Settings`, `PendingTx`
- Per-schema `createXxx(input)` factories, `validateXxx(record) → { ok, errors }` validators, JSDoc typedefs
- Shared enums (`NETWORKS`, `ACTION_PERMISSIONS`, `ADDRESS_SOURCES`) and dep-free validation primitives
- Forward-only migration harness (`migrate(record, migrations, target)`) with empty per-schema maps ready for future version bumps
- Sensible defaults: `ADS_DEFAULT_ENABLED = true`, 1 sat per tx, 1000 sat trigger, 5-sec undo-send grace, 15-min autolock

**`@xchain-wallet/core/registry`**, chain registry (§9.7)
- `ChainRegistry` class with `get` / `has` / `supportedChains` / `byCoin` / `byNetworkKind` / `coins` / `derivationPathFor` / `addCustom` / `removeCustom`
- Nine bundled descriptors: bitcoin/dogecoin/litecoin × mainnet/testnet/regtest
- Real BIP44/49/84/86 derivation paths from §16.1; address types per chain (BTC: p2pkh/p2sh-p2wpkh/p2wpkh/p2tr, LTC: first three, DOGE: p2pkh only)
- `validateChainDescriptor` with cross-field check that every declared `addressType` has a derivation-path template
- Canonical `COMMON_ACTIONS` (20) + `BTC_EXCLUSIVE_ACTIONS` (9) sourced from `xchain-documentation/protocol/actions/`
- Developer-Mode custom-chain path: `addCustom` sets `isUserAdded = true`; `removeCustom` refuses bundled

**`@xchain-wallet/core/signers`**, signer interface (§17)
- Abstract `Signer` class with the full §17.1 contract (`id` / `displayName` / `kind` / `requiresPhysicalConfirmation` / `getStatus` / `getAddresses` / `signPsbt` / `signMessage` / `getPublicKey` / `subscribe`)
- Error classes: `AbstractMethodError`, `SignerLockedError`, `SignerStatusError`, `NotImplementedError`
- `SoftwareSigner` (§17.2): real `unlock({ password, bip39Passphrase? })` and `getPublicKey({ chainId, path })`; `getAddresses` / `signPsbt` / `signMessage` stay stubbed pending SDK integration
- Memory hygiene: `lock()` zeros seed + mnemonic bytes + imported WIF bytes; derived keys zeroed after every `getPublicKey` call

**`@xchain-wallet/core/crypto`**, cryptographic foundations (§11.4, §15–16)
- `kdf.js`: Argon2id via `@noble/hashes`, `makeFreshKdfParams` / `calibrateKdfParams({ targetMs })` for per-device ~1-second tuning
- `aead.js`: AES-256-GCM via Web Crypto `SubtleCrypto`; 12-byte random IVs; AAD binding; `iv || ct(||tag)` output format
- `mnemonic.js`: BIP39 wrap (`generateBip39Mnemonic` / `isValidBip39Mnemonic` / `bip39MnemonicToSeed` / entropy round-trip) via `@scure/bip39`
- `hd.js`: BIP32 wrap (`hdKeyFromSeed`, `derive(root, path)` returning `{ privateKey, publicKey, chainCode, publicKeyHex, fingerprint, path }`) via `@scure/bip32`
- `wif.js`: chain-agnostic WIF encode/decode via `@scure/base` base58check
- `walletBlob.js`: pairs KDF + AEAD with the Wallet schema's `encryptedSeed` + `kdfParams` fields; master key zeroed after use
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
- CI skeleton (`.github/workflows/ci.yml`), installs deps; typecheck/lint/test/build steps wired as placeholders until packages define them
- Documentation home (`docs/README.md`) with planned-contents list
- Phase 1 package stubs: `@xchain-wallet/core`, `@xchain-wallet/bridge-spec`, `@xchain-wallet/web`, `@xchain-wallet/extension`, `@xchain-wallet/desktop`
- `bridge-spec` TypeScript configuration (`packages/bridge-spec/tsconfig.json`), emits `.d.ts` for dApp-developer consumption
- MV3 manifest stub (`packages/extension/manifest.json`)
- `packageManager` field pinned to `pnpm@9.0.0`
- Workspace-wide scripts: `typecheck`, `lint`, `test`, `build` (all via `pnpm -r --if-present`)

### Changed
- `README.md` repository-layout section now annotates scaffolded vs Phase-2-pending vs not-yet-started items

## [0.1.0] - 2026-04-22

### Added
- Repository seeded with standard XChain Platform project metadata: `LICENSE.md`, `NOTICE.md`, `README.md`, `CHANGELOG.md`, `package.json`, `.gitignore`
