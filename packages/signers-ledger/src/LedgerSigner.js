// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LedgerSigner (§17.4): wraps a Ledger Bitcoin app client (from
// `@ledgerhq/hw-app-btc`) talking over an injected Transport. Mirrors
// TrezorSigner's DI posture: the class itself imports nothing from
// Ledger's SDK; both `app` and `transport` are passed in by the
// per-target factory, so core stays testable without hardware.
//
// Per-target transports (§18.2):
//
//   packages/extension/src/signers/ledgerFactory.js   (WebHID)
//   packages/web/src/signers/ledgerFactory.js         (WebHID)
//   packages/desktop/src/signers/ledgerFactory.js     (node-HID; Piece 5)
//
// Ledger specifics that shape the surface:
//
//   - Ledger requires the user to open the correct coin app on the
//     device before signing. `getStatus()` returns `'wrong-app'` when
//     the user has the wrong app open, so the UI can prompt them.
//   - Ledger does not expose a stable device identifier via a standard
//     API (privacy). The factory computes one from a fingerprint of
//     the account-0 xpub and the class takes it as a parameter.
//   - Apps are per-coin. The factory constructs one Btc client per
//     chain family (BTC / LTC / DOGE / testnet all use the Bitcoin
//     app, parameterized by `currency`). The signer's `chainId` ->
//     `currency` mapping mirrors Trezor's `chainIdToTrezorCoin`.
//
// HW Sign Step 3 wires signPsbt + signMessage: signPsbt pipes the PSBT
// through `sdk.wallet.decomposePsbt`, translates into the
// `createPaymentTransaction` envelope via `ledgerFormat.js`, runs the
// resulting prev-tx hexes through `app.splitTransaction`, and
// broadcasts whatever serializedTx the device produces. signMessage
// composes the device's `{ v, r, s }` result into the base64 compact
// Bitcoin-message signature xchain-sdk's `auth.verifyMessage`
// accepts.

// §9 / G002: this module lives in `@xchain-wallet/signers-ledger`
// (its own workspace package). The base `Signer` class is shared
// across vendors and stays in `@xchain-wallet/core/signers/Signer.js`;
// we reach it via a relative cross-package path so Node smoke tests
// resolve the module without depending on pnpm workspace symlinks
// (matches the convention in @xchain-wallet/signers-trezor).

import { sha256 } from '@noble/hashes/sha2';
import {
    Signer, SignerStatusError, assertCannotSignEnvelopeReveal, assertFullInputCoverage,
} from '../../core/src/signers/Signer.js';
import { assertSignedTxMatchesPsbt } from '../../core/src/signers/verifySignedTx.js';
import {
    addressTypeFromPath,
    composeBitcoinCompactSignature,
    toLedgerCreatePayment,
} from './ledgerFormat.js';
import { readLedgerAppInfo } from './appInfo.js';

/**
 * Minimal shape of the injected Ledger Bitcoin app instance.
 * Production code passes a real `@ledgerhq/hw-app-btc` client; tests
 * pass a hand-written fake. Every method LedgerSigner calls is listed;
 * keeping this narrow is what makes the mock surface tiny.
 *
 * Every name here must exist on the real `Btc` prototype. It did not
 * for two releases: the fakes were written from this typedef
 * and the typedef from our own call sites, so nothing compared either
 * against the shipped class. `test/unit/signers-ledger/hw-app-btc-surface.test.js`
 * now pins that comparison against the installed package.
 *
 * @typedef {Object} LedgerBtcApp
 * @property {(path: string, opts?: { verify?: boolean, format?: string }) => Promise<{ publicKey: string, bitcoinAddress: string, chainCode: string }>} getWalletPublicKey
 * @property {(path: string, messageHex: string) => Promise<{ v: number, r: string, s: string }>} signMessage
 * @property {(args: any) => Promise<string>} createPaymentTransaction
 * @property {(rawTxHex: string, isSegwitSupported?: boolean, hasExtraData?: boolean, additionals?: string[]) => any} splitTransaction
 */

/**
 * Ledger app names as the device reports them (see appInfo.js). Keyed by chainId
 * so getStatus can check the user has the right app open. All the
 * BIP44-coin variants the wallet supports run on Ledger's Bitcoin
 * app; the `currency` parameter inside the app handles the
 * per-coin differences.
 *
 * bitcoin-testnet is deliberately absent (see coinTypeFor): the Bitcoin Test
 * app forces SLIP-44 coin-type 1', which diverges from the wallet's
 * 0'-anchored derivation, so the network is hardware-unsupported.
 */
const LEDGER_APP_NAME_FOR_CHAIN = {
    'bitcoin-mainnet': 'Bitcoin',
    'litecoin-mainnet': 'Litecoin',
    'dogecoin-mainnet': 'Dogecoin',
};

// Plain-language error for the hardware MuSig2 gap: this message is what the
// sign screen renders directly, so it stays house-voice (no Class.method:
// breadcrumb, no repeated jargon). `err.code` gives callers a stable
// identifier to branch on; `err.cause` keeps the qualified technical string
// for logs.
function hwMusig2UnsupportedError(qualifiedMethod, detail) {
    const err = new Error(
        'This Ledger can\'t co-sign shared-wallet payments yet. Update its Bitcoin app, or sign with this wallet\'s built-in signer.',
        { cause: `${qualifiedMethod}: ${detail}` },
    );
    err.code = 'HW_MUSIG2_UNSUPPORTED';
    return err;
}

function chainIdToLedgerFormat(chainId) {
    switch (chainId) {
        case 'bitcoin-mainnet':
        case 'litecoin-mainnet':
        case 'dogecoin-mainnet':
            return 'bech32';
        case 'bitcoin-testnet':
        case 'bitcoin-regtest':
            throw unsupportedBitcoinNetworkError(chainId);
        default:
            throw new Error(`LedgerSigner: unsupported chainId "${chainId}"`);
    }
}

// Bitcoin-testnet and bitcoin-regtest are both disabled on the Ledger signer
// for derivation parity, the same way LTC/DOGE testnet + regtest are
// (ledgerFormat.js): the chain descriptors deliberately pin SLIP-44 coin-type
// 0' on EVERY Bitcoin network so derivation matches the software signer and the
// backend, but Ledger's Bitcoin Test app forces the generic testnet coin-type
// 1'. Deriving either would silently produce m/84'/1'/... addresses the rest of
// the wallet cannot see (funds appear missing). Throw instead of diverging.
// Mirror the parity-explaining wording the Trezor side uses for both networks
// (trezorFormat.js chainIdToTrezorCoin) so the "do not 'fix' this by mapping to
// the Test app" guardrail attaches to the regtest branch too.
function unsupportedBitcoinNetworkError(chainId) {
    return new Error(
        `This hardware device can't be used on ${chainId} - use a software wallet for this network. `
        + '(On this network the device would derive a different set of addresses than the '
        + 'rest of the wallet, so any funds would appear missing.)',
    );
}

export class LedgerSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id                 SignerRecord-derived id
     * @param {string} opts.displayName
     * @param {string} opts.model              Matches firmware-manifest keys (nanoS, nanoSP, nanoX, stax)
     * @param {string} opts.deviceIdentifier
     * @param {LedgerBtcApp} opts.app          Ledger Bitcoin app client
     * @param {{ send: Function }} opts.transport   The same transport the app client talks over; getStatus reads the open app through it
     * @param {import('../../core/src/sdk/index.js').SDKRegistry} [opts.sdkRegistry]   Optional; required for signPsbt
     */
    constructor({ id, displayName, model, deviceIdentifier, app, transport, sdkRegistry }) {
        super();
        if (!id) throw new Error('LedgerSigner: id is required');
        if (!displayName) throw new Error('LedgerSigner: displayName is required');
        if (!model) throw new Error('LedgerSigner: model is required');
        if (!deviceIdentifier) throw new Error('LedgerSigner: deviceIdentifier is required');
        if (!app || typeof app !== 'object') {
            throw new Error('LedgerSigner: app is required');
        }
        // Required, not optional: the app client exposes no way to read the
        // open app (see appInfo.js), so a signer without a transport cannot
        // answer getStatus and would report every live device as
        // 'disconnected'.
        if (!transport || typeof transport.send !== 'function') {
            throw new Error('LedgerSigner: transport is required');
        }
        this._id = id;
        this._displayName = displayName;
        this._model = model;
        this._deviceIdentifier = deviceIdentifier;
        this._app = app;
        this._transport = transport;
        this._sdkRegistry = sdkRegistry;
    }

    get id() { return this._id; }
    get displayName() { return this._displayName; }
    get kind() { return 'ledger'; }
    get requiresPhysicalConfirmation() { return true; }
    get model() { return this._model; }
    get deviceIdentifier() { return this._deviceIdentifier; }

    /**
     * Reads the currently-open app + version from the device. Returns:
     *   - `'available'`: expected app open; device responsive
     *   - `'wrong-app'`: device responsive but a different app open;
     *                    UI should prompt the user to open the right one
     *   - `'unsupported-network'`: a chainId was passed that the Ledger path
     *                    cannot derive (no app / non-mainnet coin-type)
     *   - `'disconnected'`: the app-info read throws (cable unplugged,
     *                       PIN locked, transport error)
     *
     * `expectedApp` is optional: pass the chainId you care about, or
     * omit it to accept any app (useful for initial pairing before a
     * chain is chosen).
     *
     * @param {{ chainId?: string }} [opts]
     * @returns {Promise<import('../../core/src/signers/Signer.js').SignerStatus>}
     */
    async getStatus(opts = {}) {
        let info;
        try {
            info = await readLedgerAppInfo(this._transport);
        } catch {
            return 'disconnected';
        }
        // An empty name is as unusable as a missing one: it can never match
        // an expected app, so treat it as no answer rather than 'available'.
        if (!info || !info.name) {
            return 'disconnected';
        }
        // A provided chainId absent from the app-name map is one the Ledger
        // path cannot derive (coinTypeFor / chainIdToLedgerFormat throw for it
        // at getAddresses/sign time). Surface that here rather than reporting
        // 'available' and letting the very next call fail, matching Trezor's
        // fail-early status gating. The omitted-chainId case still accepts any
        // open app.
        if (opts.chainId && !Object.prototype.hasOwnProperty.call(LEDGER_APP_NAME_FOR_CHAIN, opts.chainId)) {
            return 'unsupported-network';
        }
        const expected = opts.chainId ? LEDGER_APP_NAME_FOR_CHAIN[opts.chainId] : null;
        if (expected && info.name !== expected) {
            return 'wrong-app';
        }
        return 'available';
    }

    /**
     * Derive a range of addresses. One `getWalletPublicKey` call per
     * index. The user confirms on-device the first time the app is
     * addressed per session (Ledger caches the "unlocked" state while
     * the app is open).
     *
     * @param {import('../../core/src/signers/Signer.js').GetAddressesParams} params
     * @returns {Promise<import('../../core/src/signers/Signer.js').DerivedAddress[]>}
     */
    async getAddresses({ chainId, accountIndex, change, startIndex, count, addressType, verify }) {
        const format = ledgerFormatFor(addressType, chainId);
        const out = [];
        for (let i = 0; i < count; i += 1) {
            const index = startIndex + i;
            const path = formatBip44Path({
                purpose: bip44PurposeFor(addressType, chainId),
                chainId,
                accountIndex,
                change,
                index,
            });
            // verify: ask the Ledger to display the address on its trusted
            // screen and require on-device confirmation (defeats a
            // compromised host/transport substituting a receive address).
            // Off = silent derivation for gap-limit scanning.
            const res = await runLedger(
                this._id,
                'getWalletPublicKey',
                () => this._app.getWalletPublicKey(path, { verify: !!verify, format }),
            );
            out.push({
                index,
                address: res.bitcoinAddress,
                publicKey: res.publicKey,
                path,
            });
        }
        return out;
    }

    /**
     * Fetch `{ publicKey, chainCode, fingerprint }` at a single path.
     * Used by the pairing flow to compute the `deviceIdentifier`
     * (factory-side) and by multisig setup in Phase 4+.
     *
     * @param {import('../../core/src/signers/Signer.js').GetPublicKeyParams} params
     * @returns {Promise<import('../../core/src/signers/Signer.js').GetPublicKeyReturn>}
     */
    async getPublicKey({ chainId, path }) {
        // The format is NOT optional in practice. Omitting it makes
        // hw-app-btc default to 'legacy', and the Bitcoin app rejects a
        // legacy request on a segwit path with 0x6a80 "Invalid data
        // received" (verified on Speculos against app 2.5.0: 84' and 49'
        // paths both fail without it, 44' is the only purpose that
        // survives). getAddresses always passed a format, which is why
        // only this method was broken. Derive it from the path's purpose,
        // which is the same thing the caller already encoded there.
        const format = ledgerFormatFor(addressTypeFromPath(path), chainId);
        const res = await runLedger(
            this._id,
            'getWalletPublicKey',
            () => this._app.getWalletPublicKey(path, { verify: false, format }),
        );
        return {
            publicKey: res.publicKey,
            chainCode: res.chainCode,
            // Ledger's getWalletPublicKey does not expose a BIP32
            // fingerprint directly. It's derivable from the pubkey
            // via hash160, but that computation lives at a higher
            // layer (xchain-sdk or a dedicated helper). Returning an
            // empty string here keeps the return shape aligned with
            // the Signer contract without lying about the value.
            fingerprint: '',
        };
    }

    /**
     * PSBT signing. Pipes the PSBT through `sdk.wallet.decomposePsbt`,
     * translates via `toLedgerCreatePayment` into the Ledger envelope,
     * splits each input's prev-tx hex via `app.splitTransaction`, and
     * returns the signed raw transaction the device produces.
     * `signedPsbtHex` is returned empty because Ledger hands back a
     * fully serialized tx, not a PSBT.
     *
     * @param {import('../../core/src/signers/Signer.js').SignPsbtParams} params
     * @returns {Promise<import('../../core/src/signers/Signer.js').SignPsbtReturn>}
     */
    async signPsbt({ psbtHex, chainId, signingPaths, envelopeReveal }) {
        // The renderer registers THIS class as the live signer, so the
        // RemoteSigner backstop is not in the path on desktop or the popup.
        // Without this the flag was ignored and the request failed later at
        // `input has only a witnessUtxo`, which reads as a broken PSBT rather
        // than as the capability limit it is.
        assertCannotSignEnvelopeReveal(this._id, { envelopeReveal });
        this._assertSdkRegistry('signPsbt');
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('LedgerSigner.signPsbt: psbtHex is required');
        }
        const sdk = this._sdkRegistry.get(chainId);
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);
        // All-or-refuse: a mixed-input (co-signed) PSBT gets the capability
        // message here, not the converter's `no signingPath for input index N`.
        assertFullInputCoverage(this._id, decomposed.inputs.length, signingPaths);
        const payload = toLedgerCreatePayment({ decomposed, chainId, signingPaths });

        const splitInputs = payload.inputs.map((i) => {
            // FOUR args, not five: hw-app-btc v10 dropped the `hasTimestamp`
            // parameter, so the old call shifted `hasExtraData` into it,
            // `false` into `additionals` (which then failed
            // `additionals.includes`), and dropped the real additionals
            // array entirely. Signature is now
            // (transactionHex, isSegwitSupported, hasExtraData, additionals).
            const split = this._app.splitTransaction(
                i.prevTxHex, true, false, payload.additionals,
            );
            const entry = [split, i.vout];
            if (i.redeemScriptHex) entry.push(i.redeemScriptHex);
            else entry.push(undefined);
            entry.push(i.sequence);
            return entry;
        });

        const txHex = await runLedger(this._id, 'createPaymentTransaction', () =>
            this._app.createPaymentTransaction({
                inputs: splitInputs,
                associatedKeysets: payload.associatedKeysets,
                outputScriptHex: payload.outputScriptHex,
                lockTime: payload.lockTime,
                segwit: payload.segwit,
                additionals: payload.additionals,
            }),
        );
        if (typeof txHex !== 'string' || txHex.length === 0) {
            throw new SignerStatusError(
                this._id, 'error', 'createPaymentTransaction: Ledger returned no signed tx',
            );
        }
        // The device never saw the PSBT; it signed the transaction
        // toLedgerCreatePayment REBUILT from `decomposed`, so the confirm-time
        // output-set checks covered bytes that are not these ones. Compare the
        // reply back to the PSBT before its txid escapes this method, because
        // every caller downstream treats txHex as the approved transaction.
        assertSignedTxMatchesPsbt({ txHex, decomposed, signerId: this._id });
        const txid = sdk.wallet.txidOf(txHex);
        return { signedPsbtHex: '', txHex, txid };
    }

    /**
     * Message signing via Ledger's `signMessage`. The device
     * returns `{ v, r, s }` as the compact ECDSA signature plus
     * recovery id; `composeBitcoinCompactSignature` packs these into
     * the 65-byte base64 envelope xchain-sdk's `auth.verifyMessage`
     * accepts. The header byte's script-type base (31 / 35 / 39) is
     * derived from the BIP44 purpose on the path.
     *
     * @param {import('../../core/src/signers/Signer.js').SignMessageParams} params
     * @returns {Promise<import('../../core/src/signers/Signer.js').SignMessageReturn>}
     */
    async signMessage({ message, path }) {
        if (typeof message !== 'string') {
            throw new Error('LedgerSigner.signMessage: message is required');
        }
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error('LedgerSigner.signMessage: path is required');
        }
        const messageHex = messageToHex(message);
        // `signMessage`, not `signMessageNew`: hw-app-btc v10 renamed it, and
        // the old name is absent from the shipped class.
        const sig = await runLedger(this._id, 'signMessage', () =>
            this._app.signMessage(path, messageHex),
        );
        const signature = composeBitcoinCompactSignature(sig, path);
        return { signature };
    }

    _assertSdkRegistry(method) {
        if (!this._sdkRegistry) {
            throw new Error(
                `LedgerSigner.${method}: requires an sdkRegistry; construct with { ..., sdkRegistry }`,
            );
        }
    }

    // §22.3 + §42.9 multisig-cosigner methods. The Ledger Bitcoin app
    // gained taproot + MuSig2 primitives at v2.4.0, but the
    // @ledgerhq/hw-app-btc client surface used here does not yet
    // expose nonce generation or partial signing as first-class
    // methods. Surface a clear error so the sign screen can prompt
    // the user to update or fall back to the wallet's software signer.
    //
    // The message itself is what the sign screen renders, so it stays
    // plain-language (house voice: no jargon without translation, no
    // Class.method: developer breadcrumb). `err.code` carries the typed
    // identifier for any caller that wants to branch on it; the original
    // qualified string survives as `err.cause` for logs.
    /** @returns {Promise<import('../../core/src/signers/Signer.js').SignMusig2Round1Return>} */
    async signMusig2Round1() {
        throw hwMusig2UnsupportedError('LedgerSigner.signMusig2Round1',
            'hardware MuSig2 is not supported on this Ledger Bitcoin app. Update firmware to use MuSig2 on this device, or use the wallet\'s software signer for the MuSig2 cosigner.');
    }

    /** @returns {Promise<import('../../core/src/signers/Signer.js').SignMusig2Round2Return>} */
    async signMusig2Round2() {
        throw hwMusig2UnsupportedError('LedgerSigner.signMusig2Round2',
            'hardware MuSig2 is not supported on this Ledger Bitcoin app. Update firmware to use MuSig2 on this device, or use the wallet\'s software signer for the MuSig2 cosigner.');
    }

    // P2SH / P2WSH classical multisig signing on Ledger goes through
    // the full createPaymentTransaction + registerWallet flow, not a
    // raw msgHash. Surface the limit until the proper hardware
    // multisig PSBT path lands (Step 22+).
    /** @returns {Promise<import('../../core/src/signers/Signer.js').SignMultisigClassicalReturn>} */
    async signMultisigClassical() {
        throw new Error(
            'LedgerSigner.signMultisigClassical: classical multisig signing on Ledger is not yet wired. Use the wallet\'s software signer for this cosigner, or wait for the §22 hardware-multisig PSBT path.',
        );
    }

    // Ledger's Bitcoin app requires a registered wallet policy
    // (registerWallet + the resulting policy hmac) before it will
    // sign a multisig PSBT. The app gained the wallet-policy API at
    // 2.1.0 but registering + storing the hmac is a separate
    // provisioning flow the wallet hasn't built yet. Surface the
    // limit with guidance until the provisioning flow lands.
    /** @returns {Promise<import('../../core/src/signers/Signer.js').SignMultisigPsbtReturn>} */
    async signMultisigPsbt() {
        throw new Error(
            'LedgerSigner.signMultisigPsbt: hardware multisig PSBT signing on Ledger requires a registered wallet policy (Bitcoin app >= 2.1.0 registerWallet flow) which this wallet hasn\'t provisioned yet. Use the wallet\'s software signer for this cosigner.',
        );
    }
}

/**
 * UTF-8 encode a message string into a hex blob Ledger accepts.
 *
 * @param {string} message
 * @returns {string}
 */
function messageToHex(message) {
    const bytes = new TextEncoder().encode(message);
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

// The address types this seam can derive. The chain descriptors list p2tr as a
// first-class bitcoin type (registry/descriptors/bitcoin.js, template m/86'),
// and SoftwareSigner.getAddresses validates a request against them; the maps
// below are a local re-implementation that never learned about it, so a p2tr
// request fell through to the segwit-v0 default and returned a bc1q address on
// an 84' path which the caller then recorded as p2tr. Refuse instead: the Add
// Address dropdown builds itself straight from descriptor.addressTypes with no
// hardware filter, so this IS user-reachable, and a mislabeled record also
// collides in receiveAddress's per-type index space (a later p2wpkh request
// re-issues that same m/84'/.../0 address under a second label). Do NOT "fix"
// this by adding an 86' branch: createPaymentTransaction cannot sign taproot,
// so that only moves the failure to spend time, on funds already received.
const LEDGER_DERIVABLE_ADDRESS_TYPES = new Set(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh']);

// An OMITTED addressType keeps its existing per-chain default and is not an
// error; only an explicitly requested type this seam cannot derive is refused.
function assertDerivableAddressType(addressType) {
    if (addressType === undefined || addressType === null) return;
    if (LEDGER_DERIVABLE_ADDRESS_TYPES.has(addressType)) return;
    throw new Error(
        `This hardware device can't derive ${String(addressType).toUpperCase()} addresses in this `
        + 'wallet - use a software wallet for this address type. (The device would derive at a '
        + 'different BIP44 purpose than the rest of the wallet, so the address would not be '
        + 'recognized later.)',
    );
}

function ledgerFormatFor(addressType, chainId) {
    // Ledger's `format` option: 'legacy' | 'p2sh' | 'bech32' | 'bech32m' | 'cashaddr'.
    assertDerivableAddressType(addressType);
    if (addressType === 'p2wpkh') return 'bech32';
    if (addressType === 'p2sh-p2wpkh') return 'p2sh';
    if (addressType === 'p2pkh') return 'legacy';
    // DOGE + LTC default to legacy on Ledger.
    if (chainId === 'dogecoin-mainnet' || chainId === 'litecoin-mainnet') return 'legacy';
    return chainIdToLedgerFormat(chainId);
}

function bip44PurposeFor(addressType, chainId) {
    assertDerivableAddressType(addressType);
    if (addressType === 'p2wpkh') return "84'";
    if (addressType === 'p2sh-p2wpkh') return "49'";
    if (addressType === 'p2pkh') return "44'";
    if (chainId === 'dogecoin-mainnet' || chainId === 'litecoin-mainnet') return "44'";
    return "84'";
}

function formatBip44Path({ purpose, chainId, accountIndex, change, index }) {
    const coinType = coinTypeFor(chainId);
    return `m/${purpose}/${coinType}/${accountIndex}'/${change}/${index}`;
}

// Mainnet SLIP-44 slots only, matching the chain descriptors' parity anchor
// (registry/descriptors: coin-type stays at the mainnet slot on every network).
// bitcoin-testnet must NOT map to 1' here: the descriptor/SoftwareSigner/backend
// derive it at 0', so a 1' hardware derivation yields different addresses for
// the same seed (funds appear missing). Since the Ledger firmware cannot honor
// 0' on its testnet app, the network throws as hardware-unsupported instead.
export function coinTypeFor(chainId) {
    switch (chainId) {
        case 'bitcoin-mainnet': return "0'";
        case 'litecoin-mainnet': return "2'";
        case 'dogecoin-mainnet': return "3'";
        case 'bitcoin-testnet':
        case 'bitcoin-regtest':
            throw unsupportedBitcoinNetworkError(chainId);
        default:
            throw new Error(`LedgerSigner: unsupported chainId "${chainId}"`);
    }
}

/**
 * Helper that wraps a Ledger SDK call and converts thrown errors
 * (HID transport issues, app-level errors with statusCode) into a
 * SignerStatusError the rest of the wallet can branch on.
 */
async function runLedger(signerId, method, fn) {
    try {
        return await fn();
    } catch (err) {
        const msg = err && err.message ? String(err.message) : String(err);
        const code = err && err.statusCode ? ` (0x${Number(err.statusCode).toString(16)})` : '';
        throw new SignerStatusError(signerId, 'error', `${method} failed: ${msg}${code}`);
    }
}

/**
 * Ledger does not expose a stable, privacy-safe device serial number.
 * The convention across wallets (Sparrow, Ledger Live itself in some
 * contexts) is to fingerprint the account-0 xpub. This helper takes
 * the `publicKey` returned at path `m/44'/0'/0'` (or equivalent for
 * other chains) and returns its SHA-256 truncated to 16 hex chars.
 *
 * Factory code runs this during pairing and passes the result into
 * `LedgerSigner`'s constructor.
 *
 * @param {string} publicKeyHex
 * @returns {Promise<string>}
 */
export async function deriveLedgerDeviceIdentifier(publicKeyHex) {
    if (typeof publicKeyHex !== 'string' || publicKeyHex.length === 0) {
        throw new Error('deriveLedgerDeviceIdentifier: publicKeyHex is required');
    }
    // Pure-JS SHA-256 via `@noble/hashes` so this works on any
    // origin. `crypto.subtle.digest` is gated on secure context, but
    // a wallet served over plain HTTP from a LAN host should still be
    // able to identify a paired Ledger.
    const bytes = hexToBytes(publicKeyHex);
    const view = sha256(bytes);
    let out = '';
    for (let i = 0; i < 8; i += 1) {
        out += view[i].toString(16).padStart(2, '0');
    }
    return out;
}

function hexToBytes(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) {
        throw new Error('deriveLedgerDeviceIdentifier: publicKeyHex must have an even length');
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return bytes;
}

/**
 * Map Ledger's reported model flag (when the wallet exposes it via
 * transport.deviceModel) to a firmware-manifest key. If the flag
 * isn't supplied, fall back to 'nanoX' (the most common modern
 * Ledger) and leave the pairing flow free to correct it.
 *
 * @param {unknown} deviceModel
 * @returns {string}
 */
export function modelFromLedgerTransport(deviceModel) {
    if (deviceModel && typeof deviceModel === 'object' && typeof /** @type {any} */ (deviceModel).id === 'string') {
        const id = /** @type {any} */ (deviceModel).id;
        if (id === 'nanoS') return 'nanoS';
        if (id === 'nanoSP') return 'nanoSP';
        if (id === 'nanoX') return 'nanoX';
        if (id === 'stax') return 'stax';
    }
    return 'nanoX';
}
