# Glossary — XChain Wallet

A reference for terms used throughout the wallet's code, documentation,
and user-facing surfaces. Wallet-specific vocabulary lives here;
protocol-level terms (ACTION names, encoding types, BATCH, magic
prefix) are defined upstream in [`xchain-documentation/getting-started/Key_Terms.md`](https://github.com/XChain-platform/xchain-documentation/blob/master/getting-started/Key_Terms.md)
and not duplicated here unless the wallet reuses the term with a
narrower meaning.

If a term you need is missing, please open a PR adding it. Glossaries
that fall behind the codebase are worse than no glossary at all.

---

## Wallet architecture

**core** — The `@xchain-wallet/core` package. Houses every shell-agnostic
module: schemas, validators, flows, signers, the bridge spec, the
shared route components, the i18n primitives, and the build-info
constants. The three shells (extension / web / desktop) consume core
through workspace symlinks; nothing in core imports from a shell.

**shell** — One of three end-user packages: `extension` (Chrome /
Firefox / Edge MV3), `web` (browser SPA at a hosted domain), `desktop`
(Electron). Each shell wires `core` flows to its platform's storage
substrate, messaging transport, and signer surface.

**three-shell model** — The architectural rule that every user-visible
feature must work on all three shells before it lands. Storage
substrates differ (extension: chrome.storage; web: IndexedDB; desktop:
OS keychain), but the React surface and flow logic are shared.

**vault** — The persistent store wrapping every collection the wallet
maintains: wallets, accounts, addresses, settings, contacts, signers,
connected sites. Each shell provides its own concrete implementation
(`extensionVault`, `webVault`, `desktopVault`); flows accept a
`{ vault }` dependency and never know which shell they are running on.

**flow** — A pure(-ish) function in `core/src/flows/` that runs an
end-to-end operation: create a wallet, send an asset, sign a message,
import a backup. Flows accept dependency injection (`vault`,
`chainRegistry`, `sdkRegistry`, `signerPool`) so they can be tested
without a live shell.

**MessageHost** — The background-process router that registers handlers
by name (`wallet.create`, `bridge.signMessage`, …) and dispatches
incoming messages to them. Each shell instantiates one host at startup
and shares it across the popup / tab / renderer surfaces.

**messaging shim** — A per-shell module (`extension/.../popup/messaging.js`,
`web/.../messaging.js`, `desktop/renderer/messaging.js`) that exposes
typed wrappers around `sendMessage('handler.name', payload)`. Shells
expose the same shim shape so shared routes under `core/shared/routes/`
render unchanged across shells.

---

## Signing and key management

**HD wallet** — A wallet whose private keys are derived deterministically
from a single seed via BIP-32 / BIP-39 / BIP-44 / BIP-84. The wallet's
default model. Allows recovery from a 12 or 24-word mnemonic.

**imported WIF** — A single private key imported into an existing HD
wallet (§19.4 / G020). The key sits alongside derived keys but is not
recoverable from the mnemonic — it must be backed up separately.

**BIP39 passphrase** — An optional "25th word" added to the mnemonic
when deriving the seed. Different passphrases produce different
wallets from the same mnemonic. Permanent: forgetting the passphrase
permanently locks the wallet (§15.4 / G019).

**signer** — An object that produces a signature for a transaction or
message. Three concrete kinds: software (mnemonic + password unlock),
Trezor (`TrezorSigner` over Trezor Connect), Ledger (`LedgerSigner`
over WebHID). Selected per address via `signerId`.

**SignerPool** — Per-wallet cache of unlocked signers. Software signers
sit in the pool while the wallet is unlocked and are evicted on lock /
remove. Hardware signers live there as connection metadata only — the
device itself holds the key.

**panic mode** — A 24-hour signing freeze the user activates from the
Locked screen (§26.5 / G068). All sign methods reject with `PANIC_MODE`
until the freeze elapses. A separate "duress passphrase" silently
trips the same state when entered as the unlock password.

**clipboard auto-clear** — A configurable timer (0–600 s, default 60 s)
that wipes the clipboard after the wallet copies a sensitive value
like a private key (§17.7 / G028).

---

## dApp bridge

**bridge** — The `window.xchain` provider injected by the extension's
content script (or attached directly in desktop / web). dApps call
`connect()`, `signMessage()`, `signAction()`, `signPsbt()`, `signIn()`
plus the read methods. The full surface is documented in
[`docs/BRIDGE.md`](BRIDGE.md).

**ConnectedSite** — A vault record created when a user approves a
`bridge.connect` request. Stores the origin, app name, granted
chains, granted accounts, and per-action permissions (`canSignMessage`,
`canSignAction[KIND]`).

**approval** — A user prompt that the bridge raises before performing
a sign request that needs interactive consent. Implemented by the
`Approvals` broker in each shell — popup window, modal dialog, or
desktop toast — depending on shell. The broker returns a decision
object including the password needed for software-signer flows.

**bridge error code** — A stable string identifier returned in
`{ ok: false, error: ... }` responses. `USER_REJECTED`,
`NOT_CONNECTED`, `WALLET_LOCKED`, `BLOCKED_BY_USER`, `THROTTLED`, etc.
The full table lives in [`docs/BRIDGE.md`](BRIDGE.md).

**throttle** — Per-origin token-bucket rate limiter on the four sign
methods (§12 / G012). When an origin exceeds `burst` requests inside
`windowMs` (defaults 5 / 60 s) the bridge rejects with `THROTTLED` +
a `retryAfterMs` hint. Connect / disconnect / read methods are not
throttled.

**blocklist** — User-managed list of origins (`settings.blockedOrigins`)
that the bridge hard-rejects with `BLOCKED_BY_USER` (§12 / G009).
Adding to the blocklist also evicts the matching ConnectedSite record
so an in-flight session stops signing.

**SIWX** — Sign-In with XChain. The `bridge.signIn` flow's wire
format: a deterministic challenge string produced from `appId`,
`address`, `nonce`, `issuedAt`, `expiresAt`, signed by the wallet
address (§43.6).

---

## Storage and state

**Wallet record** — The vault's representation of one HD wallet
(`schemas/wallet.js`). Holds `name`, `createdAt`, `encryptedSeed`,
`kdfParams`, plus optional `importedKeys[]` for imported WIFs.

**Account** — A `Wallet → Account` partition (§11.3.3). Each account
is a BIP-44 derivation index off the wallet seed. Default account at
index 0 plus user-named accounts at higher indices. Addresses derive
under their account's derivation path.

**Address record** — A persisted `(chain, account, derivationPath,
addressType, address)` entry. Created the first time an address is
needed (Receive, Send-from selector, sign request).

**Settings record** — One per wallet (`schemas/settings.js`). Stores
theme, fees, ADS state, notifications, panic mode, autolock, blocklist,
pinned tokens, hidden tokens, and other per-wallet preferences. v2 is
the current schema; new fields are v2-tolerant (optional, with sane
defaults).

**v2-tolerant** — A schema convention: a new field added inside the
v2 schema is declared optional and defaults sensibly when missing.
Avoids forcing a v3 bump for additive changes. Pattern documented in
the spec (§35) and enforced by the settings validator.

**ConnectedSites collection** — Vault store of approved dApp origins.
Collection methods: `list`, `findBy('origin', …)`, `put`, `delete`.

**ADS** — Automatic Donation System (§36). Per-chain accumulator that
adds a configurable per-tx donation to user transactions until the
trigger threshold is reached, then bundles the accumulated donation
into a single ACTION.

---

## Onboarding and recovery

**onboarding** — The first-launch flow under `Onboarding.jsx`. License
acceptance → choose between create / import / try-demo → password
setup → BIP39 passphrase opt-in → mnemonic display + word-quiz → ADS
consent.

**dry-run restore** — A non-destructive reverse of `importMnemonic`
(§19.6 / G038). Computes the addresses + balances a mnemonic would
restore without writing anything to the vault. Used by the Backup
panel to let a user verify their backup before relying on it.

**word-quiz** — The verification stage during wallet creation
(§19.3 / G033) where the user re-types three random non-adjacent
mnemonic words to prove they wrote the phrase down correctly.

**backup reminder** — Progressive Home banner (§19.7 / G034) that
escalates from "gentle" to "firm" copy if the user has not yet passed
the word-quiz or written the mnemonic somewhere durable.

**demo mode** — A try-before-commit lane that creates a throw-away
HD wallet without prompting for a name (§25.4 / G058). The wallet is
flagged in localStorage so the Home banner offers an "Exit demo and
wipe" affordance.

---

## Build and release

**reproducible build** — A build that produces the same bytes given
the same source tree, locked toolchain, and pinned environment. The
wallet's desktop pipeline targets Level-2 reproducibility (pre-signing
artifact). See [`docs/Reproducible_Builds.md`](Reproducible_Builds.md).

**synchronized versioning** — The wallet's release rule: every
`package.json` bumps to the same version on every release, plus
`buildInfo.WALLET_VERSION`. The root `package.json` is the source of
truth. See `CONTRIBUTING.md` for the bump procedure.

**RELEASE_HASHES.txt** — The per-release manifest of SHA-256 hashes
for every artifact (.dmg, .exe, .AppImage, .deb, .zip). Published
alongside each release tag. GPG-signed once G158 / G180 land.

**smoke** — A standalone node script under `test/smoke/` that exercises
a thin slice of wiring (no Vitest, no jsdom). The runner picks up any
`*.smoke.js` it finds. Smokes pin source-grep assertions plus runtime
exercises of small modules. The current baseline is 24 failing smokes
that are unrelated to in-progress work and tracked separately; new
work must not change that count.

**spec gap ledger** — `claude/reports/xchain-wallet/SPEC_GAPS.md`. The
canonical living document of every spec-vs-implementation gap.
Updated inline as gaps close. Each row is referenced by ID (G001,
G178, …) throughout commit messages, CHANGELOG entries, and code
comments.

**cluster** — A bundle of related spec-gap rows shipped together over
a sequence of versions. Each cluster has a name (e.g., "Cluster T —
§13 + §55 Docs") and a step count. Cluster close reports were used
historically; current practice is to append per-cluster FOLLOWUPs to
`claude/reports/xchain-wallet/FOLLOWUPS.md` and skip standalone close
reports.

---

## Other terms

**chain registry** — The runtime catalog of supported chains
(`core/src/chains/`). Each `ChainDescriptor` carries `id`, `coin`,
`networkKind`, `displayName`, `addressTypes`, `defaultAddressType`,
`supportedActions`, and the URI scheme. Bridge handlers consult it
to validate `req.chainId` against permitted chains.

**SDK registry** — Per-chain bundle of SDK modules (`xchain-sdk`)
keyed by chainId. Provides encoder, broadcast, and explorer
client. Flows accept `{ sdkRegistry }` and call `sdkRegistry.get(chainId)`.

**reachability** — The wallet's offline-detection layer (§49 / G152–G155).
A periodic background ping against the configured RPC + indexer
endpoints feeds an offline / degraded banner mounted in every shell.

**learn mode** — A Settings toggle that surfaces extra explanatory
copy throughout the UI for users still learning the protocol. Off by
default.

**developer mode** — A Settings toggle that surfaces low-level
features: regtest chain activation, log console, auto-approve for
localhost dApps, custom endpoint editing. Off by default; gated as a
single switch in the Developer Mode panel.

**i18n** — Internationalization. The wallet's `i18n/` module supports
ICU MessageFormat-subset templates with plural and select. Locales
live in `core/src/i18n/locales/<bcp47>/`. The `t()` function is a
React hook reading the active locale from context. CSS uses logical
properties (`margin-inline-start`, `padding-inline-end`) so a future
RTL locale lays out correctly without per-file edits.

---

<!-- BEGIN auto-generated glossary appendix -->

## Appendix: Machine-derived terms

The entries in this appendix are auto-generated from canonical
source files. Do **not** edit by hand; run
`node tools/glossary/generate-appendix.js` to refresh from source.
Sources:

- `packages/bridge-spec/src/index.ts`: `BridgeErrorCode` union
- `packages/core/src/schemas/connectedSite.js`: `SitePermissions` keys

### Bridge error codes

Reasons a bridge call (connect / signMessage / signAction / signPsbt /
signIn) can fail. dApps switch on `result.error` to choose the
right user-facing copy.

- `USER_REJECTED`
- `NOT_CONNECTED`
- `WALLET_LOCKED`
- `CHAIN_NOT_SUPPORTED`
- `ACCOUNT_NOT_AUTHORIZED`
- `ADDRESS_NOT_AUTHORIZED`
- `UNSUPPORTED_ACTION`
- `INVALID_PARAMS`
- `CHALLENGE_EXPIRED`
- `BROADCAST_FAILED`
- `PANIC_MODE`
- `THROTTLED`
- `BLOCKED_BY_USER`
- `BRIDGE_VERSION_MISMATCH`
- `INTERNAL_ERROR`

### ConnectedSite permission keys

Per-origin permissions surface; each key on a `ConnectedSite.permissions`
record gates a bridge capability for that origin.

- `chains`
- `accounts`
- `canSignMessage`
- `canSignAction`

<!-- END auto-generated glossary appendix -->
