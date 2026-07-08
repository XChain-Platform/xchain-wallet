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

Currently scaffold-only (`package.json`). No runtime deps yet. When
the Electron shell lands, `electron` itself is the main addition;
`electron-updater` follows for auto-update (§51.2).

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
