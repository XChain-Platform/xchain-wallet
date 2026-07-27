# Hardware signer test rig (Ledger / Speculos)

`test/hardware/ledger-speculos.js` runs the wallet's real pair sequence
and signer against a real Ledger Bitcoin app, emulated. It is opt-in and
skips loudly when the emulator is not configured, so it never turns into
a silently-green test.

```
SPECULOS_API_URL=http://devhost:5012 \
SPECULOS_TESTNET_API_URL=http://devhost:5011 \
pnpm test:hardware:ledger
```

## Why it exists

Every other Ledger test injects a hand-written app object. Those fakes
were written from our own call sites rather than from the vendor
library, so for two releases they asserted an API that does not exist:
`app.getAppAndVersion()` (never a method on `Btc`, only a standalone
helper taking a transport) and `app.signMessageNew()` (renamed to
`signMessage` in hw-app-btc v10). Both threw `TypeError` on first contact
with hardware while the whole suite stayed green .

`test/unit/signers-ledger/hw-app-btc-surface.test.js` now catches that
class of drift offline by extracting the app-client calls from the source
and checking them against the installed package. This rig is the
end-to-end counterpart: it proves the device actually answers.

## Standing up Speculos

Speculos publishes arm64, so it runs natively on both Apple Silicon and
the devhost VM.

```
docker run -d --name xchain-speculos \
  -p 5012:5000 -p 9999:9999 \
  -v REDACTED-LOCAL-PATH:/apps \
  ghcr.io/ledgerhq/speculos:latest \
  --model nanosp --display headless --api-port 5000 --apdu-port 9999 \
  /apps/bitcoin-mainnet-nanosp.elf
```

Ports: 5000 is the HTTP API this harness drives (APDU exchange at
`POST /apdu`, screen text at `GET /events`, buttons at `POST /button/*`).
9999 is the raw APDU socket, which this harness does not use.

## Getting the app ELF

**The image bundles no apps.** `/speculos/apps` is empty, and
`app-bitcoin-new` publishes no release assets, so the ELF comes from the
repo's CI artifacts:

```
gh api "repos/LedgerHQ/app-bitcoin-new/actions/artifacts?per_page=100" \
  --jq '.artifacts[] | select(.expired==false)
        | select(.name=="bitcoin-app-nanosp") | "\(.id)\t\(.created_at)"'

gh api "repos/LedgerHQ/app-bitcoin-new/actions/artifacts/<id>/zip" > app.zip
unzip app.zip           # yields app.elf, app.hex, app.apdu, app.sha256
```

Use `bitcoin-app-nanosp` for the mainnet app and
`bitcoin-testnet-app-nanosp` for the Test app. Artifacts expire, so re-run
the query rather than reusing an old id.

`app.sha256` is Ledger's installed-app hash and matches none of the three
files; do not treat a mismatch against `sha256sum app.elf` as corruption.

## The prev-tx requirement (read before "fixing" the segwit refusal)

`toLedgerCreatePayment` refuses an input that carries only a
`witnessUtxo`. That is deliberate and it is not a Ledger limitation.

Ledger derives the outpoint it signs from the **bytes of the previous
transaction it is handed**. The old code synthesized a stand-in prev tx
from the witnessUtxo's script and value, and a synthesized transaction
hashes to a different txid than the real one by construction. The device
therefore signed a spend of an outpoint that does not exist, and returned
a perfectly well-formed transaction to prove it. That is exactly what the
`spends` assertion in `ledger-speculos.js` pins.

The wallet's default path hits this: `XChainEncoder.js` builds segwit
inputs with `witnessUtxo` only, and p2wpkh is the default address type.
So hardware signing currently works for legacy inputs and refuses segwit
ones. Completing it means supplying the real previous transaction, one of:

1. the encoder attaching `nonWitnessUtxo` to segwit inputs too (it
   already fetches the whole prev-tx hex for the legacy branch),
2. `decomposePsbt` exposing `nonWitnessUtxo` whenever it is present (it
   currently reports it only when `witnessUtxo` is absent, so even a PSBT
   carrying both loses it), or
3. the wallet hydrating inputs from a connector before hardware signing.

Do not "fix" it by restoring the synthesized prev tx. That path returns
transactions that cannot be broadcast and signatures over the wrong
outpoint.

## Things that will cost you an hour

- **The two apps partition the derivation space and share nothing.** The
  mainnet app serves only SLIP-44 coin-type 0' and answers `0x6a82` for
  anything else; the Test app is the exact mirror. There is no path both
  apps will sign, which is why pairing pins the mainnet app.
- **`0x6a82` surfaces as "UNKNOWN_ERROR"** through hw-app-btc. It means
  the path was refused, not that the device is broken.
- **Signing needs the buttons driven.** The device waits for physical
  approval, so the harness presses through the confirm screens while the
  signer call is in flight. Without that it just hangs.
- **`splitTransaction` takes four arguments in hw-app-btc v10**, not the
  five the older API had. Passing five silently shifts `false` into
  `additionals` and fails inside the library rather than at the call.
- **hw-app-btc's ESM build does not load under plain Node** (extensionless
  relative imports). The harness uses the CJS build via `createRequire`.
  The shells are unaffected: Vite resolves them.
- Port 6080 on the Trezor image is noVNC; Speculos in `--display headless`
  has no screen to view, but `GET /events` returns the screen TEXT, which
  is what the harness asserts against.
