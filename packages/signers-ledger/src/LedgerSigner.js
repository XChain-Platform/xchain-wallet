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
import { Signer, SignerStatusError } from '../../core/src/signers/Signer.js';
import {
    composeBitcoinCompactSignature,
    toLedgerCreatePayment,
} from './ledgerFormat.js';

/**
 * Minimal shape of the injected Ledger Bitcoin app instance.
 * Production code passes a real `@ledgerhq/hw-app-btc` client; tests
 * pass a hand-written fake. Every method TrezorSigner calls is
 * listed; keeping this narrow is what makes the mock surface tiny.
 *
 * @typedef {Object} LedgerBtcApp
 * @property {() => Promise<{ name: string, version: string, flags?: number }>} getAppAndVersion
 * @property {(path: string, opts?: { verify?: boolean, format?: string }) => Promise<{ publicKey: string, bitcoinAddress: string, chainCode: string }>} getWalletPublicKey
 * @property {(path: string, messageHex: string) => Promise<{ v: number, r: string, s: string }>} signMessageNew
 * @property {(args: any) => Promise<string>} createPaymentTransaction
 * @property {(rawTxHex: string, isSegwitSupported?: boolean, hasTimestamp?: boolean, hasExtraData?: boolean, additionals?: string[]) => any} splitTransaction
 */

/**
 * Ledger app names exposed via `getAppAndVersion`. Keyed by chainId
 * so getStatus can check the user has the right app open. All the
 * BIP44-coin variants the wallet supports run on Ledger's Bitcoin
 * app; the `currency` parameter inside the app handles the
 * per-coin differences.
 */
const LEDGER_APP_NAME_FOR_CHAIN = {
    'bitcoin-mainnet': 'Bitcoin',
    'bitcoin-testnet': 'Bitcoin Test',
    'litecoin-mainnet': 'Litecoin',
    'dogecoin-mainnet': 'Dogecoin',
};

function chainIdToLedgerFormat(chainId) {
    switch (chainId) {
        case 'bitcoin-mainnet':
        case 'bitcoin-testnet':
        case 'litecoin-mainnet':
        case 'dogecoin-mainnet':
            return 'bech32';
        default:
            throw new Error(`LedgerSigner: unsupported chainId "${chainId}"`);
    }
}

export class LedgerSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id                 SignerRecord-derived id
     * @param {string} opts.displayName
     * @param {string} opts.model              Matches firmware-manifest keys (nanoS, nanoSP, nanoX, stax)
     * @param {string} opts.deviceIdentifier
     * @param {LedgerBtcApp} opts.app          Ledger Bitcoin app client
     * @param {import('../sdk/index.js').SDKRegistry} [opts.sdkRegistry]   Optional; required for signPsbt
     */
    constructor({ id, displayName, model, deviceIdentifier, app, sdkRegistry }) {
        super();
        if (!id) throw new Error('LedgerSigner: id is required');
        if (!displayName) throw new Error('LedgerSigner: displayName is required');
        if (!model) throw new Error('LedgerSigner: model is required');
        if (!deviceIdentifier) throw new Error('LedgerSigner: deviceIdentifier is required');
        if (!app || typeof app !== 'object') {
            throw new Error('LedgerSigner: app is required');
        }
        this._id = id;
        this._displayName = displayName;
        this._model = model;
        this._deviceIdentifier = deviceIdentifier;
        this._app = app;
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
     *   - `'disconnected'`: `getAppAndVersion` throws (cable unplugged,
     *                       PIN locked, transport error)
     *
     * `expectedApp` is optional: pass the chainId you care about, or
     * omit it to accept any app (useful for initial pairing before a
     * chain is chosen).
     *
     * @param {{ chainId?: string }} [opts]
     * @returns {Promise<import('./Signer.js').SignerStatus>}
     */
    async getStatus(opts = {}) {
        let info;
        try {
            info = await this._app.getAppAndVersion();
        } catch {
            return 'disconnected';
        }
        if (!info || typeof info.name !== 'string') {
            return 'disconnected';
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
     * @param {import('./Signer.js').GetAddressesParams} params
     * @returns {Promise<import('./Signer.js').DerivedAddress[]>}
     */
    async getAddresses({ chainId, accountIndex, change, startIndex, count, addressType }) {
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
            const res = await runLedger(
                this._id,
                'getWalletPublicKey',
                () => this._app.getWalletPublicKey(path, { verify: false, format }),
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
     * @param {import('./Signer.js').GetPublicKeyParams} params
     * @returns {Promise<import('./Signer.js').GetPublicKeyReturn>}
     */
    async getPublicKey({ chainId: _chainId, path }) {
        const res = await runLedger(
            this._id,
            'getWalletPublicKey',
            () => this._app.getWalletPublicKey(path, { verify: false }),
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
     * @param {import('./Signer.js').SignPsbtParams} params
     * @returns {Promise<import('./Signer.js').SignPsbtReturn>}
     */
    async signPsbt({ psbtHex, chainId, signingPaths }) {
        this._assertSdkRegistry('signPsbt');
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('LedgerSigner.signPsbt: psbtHex is required');
        }
        const sdk = this._sdkRegistry.get(chainId);
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);
        const payload = toLedgerCreatePayment({ decomposed, chainId, signingPaths });

        const splitInputs = payload.inputs.map((i) => {
            const split = this._app.splitTransaction(
                i.prevTxHex, true, false, false, payload.additionals,
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
        const txid = sdk.wallet.txidOf(txHex);
        return { signedPsbtHex: '', txHex, txid };
    }

    /**
     * Message signing via Ledger's `signMessageNew`. The device
     * returns `{ v, r, s }` as the compact ECDSA signature plus
     * recovery id; `composeBitcoinCompactSignature` packs these into
     * the 65-byte base64 envelope xchain-sdk's `auth.verifyMessage`
     * accepts. The header byte's script-type base (31 / 35 / 39) is
     * derived from the BIP44 purpose on the path.
     *
     * @param {import('./Signer.js').SignMessageParams} params
     * @returns {Promise<import('./Signer.js').SignMessageReturn>}
     */
    async signMessage({ message, path }) {
        if (typeof message !== 'string') {
            throw new Error('LedgerSigner.signMessage: message is required');
        }
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error('LedgerSigner.signMessage: path is required');
        }
        const messageHex = messageToHex(message);
        const sig = await runLedger(this._id, 'signMessageNew', () =>
            this._app.signMessageNew(path, messageHex),
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
    /** @returns {Promise<import('./Signer.js').SignMusig2Round1Return>} */
    async signMusig2Round1() {
        throw new Error(
            'LedgerSigner.signMusig2Round1: hardware MuSig2 is not supported on this Ledger Bitcoin app. Update firmware to use MuSig2 on this device, or use the wallet\'s software signer for the MuSig2 cosigner.',
        );
    }

    /** @returns {Promise<import('./Signer.js').SignMusig2Round2Return>} */
    async signMusig2Round2() {
        throw new Error(
            'LedgerSigner.signMusig2Round2: hardware MuSig2 is not supported on this Ledger Bitcoin app. Update firmware to use MuSig2 on this device, or use the wallet\'s software signer for the MuSig2 cosigner.',
        );
    }

    // P2SH / P2WSH classical multisig signing on Ledger goes through
    // the full createPaymentTransaction + registerWallet flow, not a
    // raw msgHash. Surface the limit until the proper hardware
    // multisig PSBT path lands (Step 22+).
    /** @returns {Promise<import('./Signer.js').SignMultisigClassicalReturn>} */
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
    /** @returns {Promise<import('./Signer.js').SignMultisigPsbtReturn>} */
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

function ledgerFormatFor(addressType, chainId) {
    // Ledger's `format` option: 'legacy' | 'p2sh' | 'bech32' | 'bech32m' | 'cashaddr'.
    if (addressType === 'p2wpkh') return 'bech32';
    if (addressType === 'p2sh-p2wpkh') return 'p2sh';
    if (addressType === 'p2pkh') return 'legacy';
    // DOGE + LTC default to legacy on Ledger.
    if (chainId === 'dogecoin-mainnet' || chainId === 'litecoin-mainnet') return 'legacy';
    return chainIdToLedgerFormat(chainId);
}

function bip44PurposeFor(addressType, chainId) {
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

function coinTypeFor(chainId) {
    switch (chainId) {
        case 'bitcoin-mainnet': return "0'";
        case 'bitcoin-testnet': return "1'";
        case 'litecoin-mainnet': return "2'";
        case 'dogecoin-mainnet': return "3'";
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
