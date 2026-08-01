# Dependencies

Per spec §9.8, every third-party runtime dependency in XChain Wallet is
enumerated here with:

- **Why we depend on it** - the specific feature it provides that we
  would otherwise have to implement (and review) ourselves
- **License** - must be permissive (MIT, Apache-2.0, BSD, ISC, CC0)
- **Maintainer context** - trust signal; we prefer deps from authors who
  also maintain widely-used adjacent packages

Any new runtime dep requires an addition to this file. CI runs
`pnpm audit --prod` on every PR; known advisories are surfaced as
review comments before merge.

> **Scope.** This file tracks *runtime* dependencies - anything that
> ships in a user-installable artifact. Dev-only tooling (build,
> lint, test runners) lives in each package's `devDependencies` and
> is reviewed at bump time but not enumerated here.

## `@xchain-wallet/core`

### `@noble/hashes` (^1.5.0)

**Why.** SHA-256, SHA-512, HMAC, Argon2id, PBKDF2 - all the primitives
behind the wallet's crypto layer (KDF, seed derivation, commitment
keys, label-sync, PSBT-QR integrity). Constant-time implementations,
audited, no native bindings.

**License.** MIT.

**Maintainer.** Paul Miller (@paulmillr). Author of the adjacent
`@noble/curves` (secp256k1) and `@noble/ciphers` packages; Bitcoin
Core contributor.

### `@scure/base` (^1.1.9)

**Why.** base58check encoding/decoding for WIF + address parsing.
Avoids pulling in the larger bitcoinjs-lib for a 3-function need.

**License.** MIT.

**Maintainer.** Paul Miller (@paulmillr) + Trail of Bits audit.

### `@scure/bip32` (^1.5.0)

**Why.** BIP32 HD derivation. Used everywhere the wallet derives a
key from the seed (receive addresses, signing, WIF export, dry-run
restore, gap-limit scan).

**License.** MIT.

**Maintainer.** Paul Miller (@paulmillr) + Trail of Bits audit.

### `@scure/bip39` (^1.4.0)

**Why.** BIP39 mnemonic generation + validation + seed derivation.
The Counterwallet legacy import path lives in our own codebase
(§15.2) because that wordlist isn't standardized anywhere; BIP39 is
the ubiquitous case and `@scure/bip39` is the audited implementation.

**License.** MIT.

**Maintainer.** Paul Miller (@paulmillr) + Trail of Bits audit.

## `@xchain-wallet/extension`

### `@xchain-wallet/core` (workspace:\*)

Workspace dep. Pulls in all of core's transitive deps listed above -
no new third-party deps introduced by the extension shell itself.

## `@xchain-wallet/web`

### `@xchain-wallet/core` (workspace:\*)

Workspace dep. Pulls in core's transitive deps; web shell adds no new
third-party runtime deps.

## `@xchain-wallet/desktop`

The Electron shell. This section was stale for a while (it still said
"scaffold-only, no runtime deps yet" after the shell had shipped);
corrected 2026-07-31 alongside the `openpgp` addition.

### `electron-updater`

Auto-update against the self-hosted feed (§51.2). Downloads and
installs; it does **not** decide whether an update is trustworthy. See
`openpgp` below.

### `openpgp` ( S5)

Verifies the maintainer's GPG signature over the release manifest
**before** an update is installed
(`packages/desktop/main/updateVerify.js`).

This is a real dependency in a wallet, so the reason has to be worth
it. electron-updater checks a SHA512 from the channel pointer
(`stable-linux.yml` and friends), which is
served by the same host as the binary, so it is a checksum from the
party that served the file rather than a signature. On Windows and
macOS the OS code-signature check is a genuine second factor; on Linux
there is none, so whoever controls the download host, or the Cloudflare
account in front of it, could silently update every Linux desktop user
to attacker code. Verifying K1's signature against a key pinned in the
app closes that, and doing it needs an OpenPGP implementation.

The alternative considered and rejected was a second signing key using
primitives already present (`node:crypto` Ed25519), which needs no
dependency but adds a second key, a second ceremony step and a second
thing to rotate. The operator chose one key and one signature. The
rejected design is recorded in `claude/specs/wallet-release-rails.md`
§9 in case the trade is ever revisited.

Runs in the **main process only**. It is not in the renderer bundle and
is not on any path that touches user keys.

### `undici` 

Routes Node's global `fetch` through a SOCKS5 proxy when the user turns
on Tor routing (`packages/desktop/main/torRouting.js`).

Node already runs undici internally for every `fetch` call, so this is
not new code in the process; what the direct dependency buys is the
`setGlobalDispatcher` entry point, which Node does not expose. undici
ignores `http.Agent` entirely, so without it the SDK's axios traffic
would be proxied while price lookups, token metadata and registry sync
kept going direct. A privacy feature that covers some of the egress
paths is worse than none, because the user believes all of them are
covered.

The alternative was a hand-written `fetch`-shaped wrapper over
`node:https`, which needs no dependency but only covers the call sites
known today: the next `fetch` added in the main process would silently
leak. A global dispatcher covers them all, including future ones.

Main process only.

### `@ledgerhq/hw-app-btc`, `@ledgerhq/hw-transport-webhid`

Ledger hardware-signer support over WebHID. Local USB transport, no
network service.

### `react`, `react-dom`, `lightweight-charts`

The renderer, shared with the other shells.

### `@xchain-wallet/core`, `@xchain-wallet/extension` (workspace:\*), `xchain-sdk` (link:)

Workspace and linked deps: shared flows, the background host, and the
protocol SDK.

## `@xchain-wallet/bridge-spec`

Zero runtime deps. Ships TypeScript types + a handful of pure helpers.
Consumers are third-party dApp authors who install this package
directly; keeping it dep-free keeps their install light.

## `@xchain-wallet/test-dapp`

### `@xchain-wallet/bridge-spec` (workspace:\*)

Workspace dep. Test dApp exercises the bridge surface via the type
definitions; no third-party runtime deps.

---

## Review cadence

- **Every PR that touches a `package.json`** - reviewer confirms this
  file is updated for any new / removed / version-bumped runtime dep.
- **Weekly** - `pnpm outdated -r` run against the lockfile; bumps
  scheduled for the next weekly release window.
- **On advisory** - if `pnpm audit` surfaces a CVE mid-cycle, it goes
  to the top of the queue regardless of cadence.

## Floor versions

Every dep above uses a caret (`^`) range. The floor is what we've
actually tested against; the lockfile (`pnpm-lock.yaml`, committed)
pins the exact installed versions. Reproducible builds (§51.4) work
from the lockfile, not the ranges.
