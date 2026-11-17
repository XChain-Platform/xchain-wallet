# Hardware signer test rig (Ledger / Speculos)

`test/hardware/ledger-speculos.js` runs the wallet's real pair sequence
and signer against a real Ledger Bitcoin app, emulated. It is opt-in and
skips loudly when the emulator is not configured, so it never turns into
a silently-green test.

```
SPECULOS_API_URL=http://localhost:5012 \
SPECULOS_TESTNET_API_URL=http://localhost:5011 \
pnpm test:hardware:ledger
```

## Why it exists

Every other Ledger test injects a hand-written app object. Those fakes
were written from our own call sites rather than from the vendor
library, so for two releases they asserted an API that does not exist:
`app.getAppAndVersion()` (never a method on `Btc`, only a standalone
helper taking a transport) and `app.signMessageNew()` (renamed to
`signMessage` in hw-app-btc v10). Both threw `TypeError` on first contact
with hardware while the whole suite stayed green.

`test/unit/signers-ledger/hw-app-btc-surface.test.js` now catches that
class of drift offline by extracting the app-client calls from the source
and checking them against the installed package. This rig is the
end-to-end counterpart: it proves the device actually answers.

## Standing up Speculos

Speculos publishes arm64, so it runs natively on both Apple Silicon and
the shared regtest VM.

```
docker run -d --name xchain-speculos \
  -p 5012:5000 -p 9999:9999 \
  -v "$HOME"/xchain-speculos/apps:/apps \
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

The supported wallet compose path supplies that transaction at build
time. The encoder's `attachPrevTx` option adds `nonWitnessUtxo` beside
the normal `witnessUtxo`, and wallet compose routes request the option
for Ledger and Trezor sources. Doing this before review keeps the PSBT
the user previews byte-identical to the one later signed. The SDK's
`decomposePsbt` preserves `nonWitnessUtxo` when both fields are present,
so `prevTxHexForInput` can pass the real transaction to Ledger.

The signer still refuses a segwit PSBT that carries only `witnessUtxo`,
including one built outside the wallet's device compose path. That is
the intended boundary: the signer cannot recover the real previous
transaction from the script and value alone.

Do not "fix" it by restoring the synthesized prev tx. That path returns
transactions that cannot be broadcast and signatures over the wrong
outpoint.

## Test networks: each device's own derivation

Operator ruling 2026-11-15: a hardware wallet derives a test network at the
device's own native test coin type, SLIP-44 `1'` (`m/84'/1'/A'/C/I` and the
44', 49' siblings), and the wallet stores the address the device gives.
Mainnet is unchanged: `0'`, `2'`, `3'`, the same addresses as the software
signer. The accepted cost: a software wallet restored from the same seed
derives test networks at the mainnet slot, so its testnet addresses differ
from the device's.

| Vendor | Network | Mainnet | Testnet | Regtest |
|---|---|---|---|---|
| Trezor | Bitcoin | yes, `btc` at 0' | yes, `test` at 1' | yes, `regtest` at 1' |
| Trezor | Litecoin | yes, `ltc` at 2' | yes, `tltc` at 1' (no P2SH-P2WPKH) | no: no firmware coin |
| Trezor | Dogecoin | yes, `doge` at 3' | no: no firmware coin | no: no firmware coin |
| Ledger | Bitcoin | yes, Bitcoin app at 0' | yes, Bitcoin Test app at 1' | yes, Bitcoin Test app at 1' |
| Ledger | Litecoin | yes, Litecoin app at 2' | no: no test app | no: no test app |
| Ledger | Dogecoin | yes, Dogecoin app at 3' | no: no test app | no: no test app |

`HARDWARE_NETWORK_SUPPORT` in `packages/core/src/flows/hardwareWallet.js`
is built from `TREZOR_NETWORK_SUPPORT` and `LEDGER_NETWORK_SUPPORT`, so the
connect flow's table cannot drift from the signers.

- **Trezor needs no setting.** Each test coin carries slip44 1 in its
  firmware definition, so Connect's path check and the default Strict safety
  checks both pass. No call carries `crossChain`. Message signing works on
  the test networks too.
- **Trezor Litecoin testnet P2SH.** The `tltc` coin writes P2SH at version
  58 (`Q...`) where the SDK writes 0xc4 (`2...`), so P2SH-P2WPKH derivation
  and payments to a `2...` address are refused there.
- **Ledger regtest prints `tb1`.** The Bitcoin Test app encodes with testnet
  parameters on regtest too. Base58 forms match (versions 111 and 196), and
  `LedgerSigner` rewrites a segwit answer from `tb` to `bcrt`, keeping the
  witness program. The device screen still shows `tb1...` for the same key,
  so the hardware sign page says so in one line on a Ledger regtest send.
- **Ledger checks the open app before a test-network derive.** Another app
  answering a 1' path would write a mainnet-form address, so the signer
  refuses unless Bitcoin Test is open.
- **A Ledger is recognised per chain, from the app that is open.** No key
  can be read from every app, so the SignerRecord keeps `identities`: for
  each chain with an account, the first address path and a 16-hex hash of
  that address's compressed key (no key is stored). Pairing and reconnect
  run the same factory, which accepts Bitcoin, Bitcoin Test, Litecoin or
  Dogecoin; `hardwareSession.ensureLive` then re-derives the recorded path
  of a chain the open app serves (the operation's chain first) and refuses
  a mismatch with `HW_WRONG_DEVICE`. `signer.list` fills identities from the
  device's own stored addresses, so older records and chains added after
  pairing are covered. The Bitcoin-app `deviceIdentifier` is unchanged; a
  pairing from another app gets another one, and `addHardwareWallet` still
  refuses that same device as already linked by its identities.
  `test/unit/signers/ledger-identity-across-apps.test.js` proves it on a
  fake where every app, Bitcoin included, refuses other coin types.
- **A network with no identity yet is read once, then checked.** Design
  ruling 2026-11-15: `ensureLive(..., { read: true })` lets a read through
  an app that serves a chain the record has no identity for (the connect
  flow's rule: the device never answered in that app), and the session
  signer records the identity from that first address read; a sign there
  gets `HW_NETWORK_UNREAD`, never `HW_WRONG_APP`, re-reads the record and
  otherwise takes the same read at its signing key before it signs. A
  device taken unchecked for a read is never reused for a sign. Add network
  on the manage page and the waiting networks of Add account run through
  `wallet.activateChain` with `signerId` and `accountId`, which records the
  identity on the SignerRecord (`recordLedgerIdentities`).
  `test/unit/signers/hw-add-network-read.test.js` and
  `test/unit/shells/hw-add-network-bridges.test.js` (web, popup and desktop
  bridges) prove it.

`test/unit/signers/hw-test-networks.test.js` proves every supported pair at
the address level against the SDK's encoding, with fakes that enforce the
vendors' path checks.

## Things that will cost you an hour

- **The two apps partition the derivation space and share nothing.** The
  mainnet app serves only SLIP-44 coin-type 0' and answers `0x6a82` for
  anything else; the Test app is the exact mirror. There is no path both
  apps will sign, which is why a Ledger's identity is kept per chain.
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
