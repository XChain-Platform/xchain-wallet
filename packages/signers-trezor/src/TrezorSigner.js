// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TrezorSigner (§17.3): wraps a Trezor Connect instance (a
// `@trezor/connect-web` popup-transport factory in browser/extension,
// a `@trezor/connect` node-transport factory in desktop). The class
// itself imports nothing from the Trezor SDK. `connect` is injected
// so the signer stays testable without hardware and doesn't pull the
// SDK into the package's dep graph.
//
// §9 / G001: this module lives in `@xchain-wallet/signers-trezor`
// (its own workspace package). The base `Signer` class is shared
// across vendors and stays in `@xchain-wallet/core/signers/Signer.js`;
// we reach it via a relative cross-package path so Node smoke tests
// resolve the module without depending on pnpm workspace symlinks
// (matches the convention in packages/web/src/signers/trezorFactory.js).
//
// Per-target transports live in the shell packages:
//
//   packages/extension/src/signers/trezorFactory.js
//   packages/web/src/signers/trezorFactory.js
//   packages/desktop/renderer/signerFactories/trezorFactory.js
//
// Each factory dynamic-imports its transport package, initializes it
// with the wallet's Trezor Connect manifest, and constructs a
// TrezorSigner wrapping the initialized instance.
//
// signPsbt / signMessage also require `sdkRegistry` so the signer can
// ask `sdk.wallet.decomposePsbt` to turn an encoder-produced PSBT into
// the normalized shape the Trezor envelope builder consumes. That
// keeps `bitcoinjs-lib` out of @xchain-wallet/core (per SDKRegistry.js's
// rationale).

import {
    Signer, SignerStatusError, assertCannotSignEnvelopeReveal, assertFullInputCoverage,
} from '../../core/src/signers/Signer.js';
import { chainIdToTrezorCoin, toTrezorSignTransaction } from './trezorFormat.js';

// Plain-language error for the hardware MuSig2 gap: this message is what the
// sign screen renders directly, so it stays house-voice (no Class.method:
// breadcrumb, no repeated jargon). `err.code` gives callers a stable
// identifier to branch on; `err.cause` keeps the qualified technical string
// for logs.
function hwMusig2UnsupportedError(qualifiedMethod, detail) {
    const err = new Error(
        'This Trezor can\'t co-sign shared-wallet payments yet. Update its firmware, or sign with this wallet\'s built-in signer.',
        { cause: `${qualifiedMethod}: ${detail}` },
    );
    err.code = 'HW_MUSIG2_UNSUPPORTED';
    return err;
}

/**
 * @typedef {Object} TrezorConnectResponse
 * @property {boolean} success
 * @property {any} [payload]            on success
 * @property {{ code?: string, error: string }} [error]   flat on failure (Connect wraps error info under `payload`; factories normalize to this shape)
 */

/**
 * Minimal shape of the injected Connect instance. Production code
 * passes the real `@trezor/connect-web` default export after `init`;
 * tests pass a hand-written fake. The methods listed here are all the
 * TrezorSigner class reaches for. Keeping this narrow is what makes
 * the mock surface tiny (see trezor-signer.smoke.js).
 *
 * @typedef {Object} TrezorConnect
 * @property {() => Promise<TrezorConnectResponse>} getFeatures
 * @property {(args: { path: string, coin: string, showOnTrezor?: boolean }) => Promise<TrezorConnectResponse>} getAddress
 * @property {(args: { path: string, coin: string }) => Promise<TrezorConnectResponse>} getPublicKey
 * @property {(args: any) => Promise<TrezorConnectResponse>} signTransaction
 * @property {(args: { path: string, coin: string, message: string }) => Promise<TrezorConnectResponse>} signMessage
 */

export class TrezorSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id                Stable signer id (typically the SignerRecord id)
     * @param {string} opts.displayName       UI label, e.g. "Trezor Model T (My Trezor)"
     * @param {string} opts.model             Model code (matches SignerRecord.model + firmware-manifest keys)
     * @param {string} opts.deviceIdentifier  Opaque per-device id
     * @param {TrezorConnect} opts.connect    Injected Connect instance (production: @trezor/connect-web post-init; tests: fake)
     * @param {import('../sdk/index.js').SDKRegistry} [opts.sdkRegistry]   Optional; required for signPsbt (decomposePsbt lookup)
     */
    constructor({ id, displayName, model, deviceIdentifier, connect, sdkRegistry }) {
        super();
        if (!id) throw new Error('TrezorSigner: id is required');
        if (!displayName) throw new Error('TrezorSigner: displayName is required');
        if (!model) throw new Error('TrezorSigner: model is required');
        if (!deviceIdentifier) throw new Error('TrezorSigner: deviceIdentifier is required');
        if (!connect || typeof connect !== 'object') {
            throw new Error('TrezorSigner: connect is required');
        }
        this._id = id;
        this._displayName = displayName;
        this._model = model;
        this._deviceIdentifier = deviceIdentifier;
        this._connect = connect;
        this._sdkRegistry = sdkRegistry;
    }

    get id() { return this._id; }
    get displayName() { return this._displayName; }
    get kind() { return 'trezor'; }
    get requiresPhysicalConfirmation() { return true; }
    get model() { return this._model; }
    get deviceIdentifier() { return this._deviceIdentifier; }

    /**
     * Reads device status by pinging `getFeatures`. Returns:
     *   - `'available'`: device reachable + same physical device we paired
     *   - `'disconnected'`: Connect rejects or the device identifier doesn't match
     *   - `'error'`: unexpected Connect failure
     *
     * @returns {Promise<import('./Signer.js').SignerStatus>}
     */
    async getStatus() {
        let res;
        try {
            res = await this._connect.getFeatures();
        } catch {
            return 'disconnected';
        }
        if (!res?.success) {
            return 'disconnected';
        }
        const features = res.payload;
        // If we paired with deviceIdentifier X and the attached device
        // reports a different id, treat that as disconnected. The user
        // plugged in a different Trezor. Matching uses either the
        // `device_id` or the `fw_fingerprint` field, whichever the
        // pairing flow captured.
        const observedId = features?.device_id ?? features?.fw_fingerprint ?? null;
        // Fail closed on an unconfirmable identity. If the attached device
        // reports neither device_id nor fw_fingerprint, we cannot confirm
        // it is the device we paired with, so report 'disconnected' rather
        // than 'available' (which would assert the paired device is
        // present). Returning 'available' here would let a swapped or
        // counterfeit device that omits both id fields pass the paired-
        // device binding this check exists to enforce.
        if (!observedId || observedId !== this._deviceIdentifier) {
            return 'disconnected';
        }
        return 'available';
    }

    /**
     * Derive a range of addresses by repeated `getAddress` calls. The
     * user is prompted on-device once per session (Connect caches the
     * "this host is trusted" decision).
     *
     * @param {import('./Signer.js').GetAddressesParams} params
     * @returns {Promise<import('./Signer.js').DerivedAddress[]>}
     */
    async getAddresses({ chainId, accountIndex, change, startIndex, count, addressType, verify }) {
        const coin = chainIdToTrezorCoin(chainId);
        const out = [];
        for (let i = 0; i < count; i += 1) {
            const index = startIndex + i;
            const path = formatBip44Path({
                purpose: bip44PurposeFor(addressType, coin),
                coin,
                accountIndex,
                change,
                index,
            });
            // verify: display the address on the Trezor's trusted screen and
            // require the user to confirm it (defeats a compromised host/
            // transport substituting a receive address). Off = silent
            // derivation for gap-limit scanning.
            const [addrRes, pkRes] = await Promise.all([
                this._connect.getAddress({ path, coin, showOnTrezor: !!verify }),
                this._connect.getPublicKey({ path, coin }),
            ]);
            if (!addrRes?.success) {
                throw signerFailure(this._id, 'getAddress', addrRes);
            }
            if (!pkRes?.success) {
                throw signerFailure(this._id, 'getPublicKey', pkRes);
            }
            out.push({
                index,
                address: addrRes.payload?.address,
                publicKey: pkRes.payload?.publicKey,
                path,
            });
        }
        return out;
    }

    /**
     * Fetch a public key + chain-code + fingerprint for one path.
     * Used by the pairing flow to derive a stable xpub the wallet can
     * match against on reconnect, and by multisig setup (Phase 4+).
     *
     * @param {import('./Signer.js').GetPublicKeyParams} params
     * @returns {Promise<import('./Signer.js').GetPublicKeyReturn>}
     */
    async getPublicKey({ chainId, path }) {
        const coin = chainIdToTrezorCoin(chainId);
        const res = await this._connect.getPublicKey({ path, coin });
        if (!res?.success) {
            throw signerFailure(this._id, 'getPublicKey', res);
        }
        return {
            publicKey: res.payload?.publicKey,
            chainCode: res.payload?.chainCode ?? res.payload?.chain_code ?? '',
            fingerprint: String(res.payload?.fingerprint ?? ''),
        };
    }

    /**
     * PSBT signing. Pipes the PSBT through `sdk.wallet.decomposePsbt`
     * to get a vendor-agnostic shape, translates it into Trezor
     * Connect's `signTransaction` envelope, then returns the signed
     * raw transaction the device produces. Trezor returns the final
     * serialized tx directly (not a signed PSBT), so `signedPsbtHex`
     * is returned empty; the caller broadcasts `txHex`.
     *
     * @param {import('./Signer.js').SignPsbtParams} params
     * @returns {Promise<import('./Signer.js').SignPsbtReturn>}
     */
    async signPsbt({ psbtHex, chainId, signingPaths, envelopeReveal }) {
        // The renderer registers THIS class as the live signer, so the
        // RemoteSigner backstop is not in the path on desktop or the popup.
        // Without this the flag was ignored and the request failed later at
        // `unsupported input scriptType "p2tr"`, which reads as a malformed
        // PSBT rather than as the capability limit it is.
        assertCannotSignEnvelopeReveal(this._id, { envelopeReveal });
        this._assertSdkRegistry('signPsbt');
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('TrezorSigner.signPsbt: psbtHex is required');
        }
        const coin = chainIdToTrezorCoin(chainId);
        const sdk = this._sdkRegistry.get(chainId);
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);
        // All-or-refuse: a mixed-input (co-signed) PSBT gets the capability
        // message here, not the converter's `no signingPath for input index N`.
        assertFullInputCoverage(this._id, decomposed.inputs.length, signingPaths);
        const payload = toTrezorSignTransaction({ decomposed, coin, signingPaths });
        const res = await this._connect.signTransaction(payload);
        if (!res?.success) {
            throw signerFailure(this._id, 'signTransaction', res);
        }
        const txHex = res.payload?.serializedTx;
        if (typeof txHex !== 'string' || txHex.length === 0) {
            throw new SignerStatusError(
                this._id, 'error', 'signTransaction: Trezor returned no serializedTx',
            );
        }
        const txid = sdk.wallet.txidOf(txHex);
        return { signedPsbtHex: '', txHex, txid };
    }

    /**
     * Message signing via Trezor Connect's `signMessage`. The device
     * returns a base64-encoded compact signature in the Bitcoin
     * message-signing convention (the same shape xchain-sdk's
     * `auth.signMessage` produces, so no protocol wrapping is needed.
     *
     * @param {import('./Signer.js').SignMessageParams} params
     * @returns {Promise<import('./Signer.js').SignMessageReturn>}
     */
    async signMessage({ message, chainId, path }) {
        if (typeof message !== 'string') {
            throw new Error('TrezorSigner.signMessage: message is required');
        }
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error('TrezorSigner.signMessage: path is required (HW signers have no imported WIFs)');
        }
        const coin = chainIdToTrezorCoin(chainId);
        const res = await this._connect.signMessage({ path, coin, message });
        if (!res?.success) {
            throw signerFailure(this._id, 'signMessage', res);
        }
        const signature = res.payload?.signature;
        if (typeof signature !== 'string' || signature.length === 0) {
            throw new SignerStatusError(
                this._id, 'error', 'signMessage: Trezor returned no signature',
            );
        }
        return { signature };
    }

    _assertSdkRegistry(method) {
        if (!this._sdkRegistry) {
            throw new Error(
                `TrezorSigner.${method}: requires an sdkRegistry; construct with { ..., sdkRegistry }`,
            );
        }
    }

    // §22.3 + §42.9 multisig-cosigner methods. Trezor firmware does
    // not yet expose BIP327 nonce generation or partial signing
    // through Connect's signTransaction surface (as of firmware
    // releases through Q2 2026). Surface a clear error so the sign
    // screen can prompt the user to update; SoftwareSigner remains
    // the supported MuSig2 path on this device.
    /** @returns {Promise<import('./Signer.js').SignMusig2Round1Return>} */
    async signMusig2Round1() {
        throw hwMusig2UnsupportedError('TrezorSigner.signMusig2Round1',
            'hardware MuSig2 is not supported on Trezor. Update firmware to use MuSig2 on this device, or use the wallet\'s software signer for the MuSig2 cosigner.');
    }

    /** @returns {Promise<import('./Signer.js').SignMusig2Round2Return>} */
    async signMusig2Round2() {
        throw hwMusig2UnsupportedError('TrezorSigner.signMusig2Round2',
            'hardware MuSig2 is not supported on Trezor. Update firmware to use MuSig2 on this device, or use the wallet\'s software signer for the MuSig2 cosigner.');
    }

    // P2SH / P2WSH classical multisig signing isn't wired through
    // Trezor's Connect bridge yet. Trezor expects to drive the full
    // multisig PSBT, not produce a single-input partial sig from a
    // raw msgHash. Surface the limit clearly until the proper
    // signTransaction-based multisig path lands (Step 22+).
    /** @returns {Promise<import('./Signer.js').SignMultisigClassicalReturn>} */
    async signMultisigClassical() {
        throw new Error(
            'TrezorSigner.signMultisigClassical: classical multisig signing on Trezor is not yet wired. Use the wallet\'s software signer for this cosigner, or wait for the §22 hardware-multisig PSBT path.',
        );
    }

    // Trezor's classical-multisig signing flow requires the
    // signTransaction envelope with a `multisig` parameter on each
    // input (redeemScript / witnessScript / signatures array). The
    // envelope builder in trezorFormat.js is single-key today; wiring
    // the multisig envelope + the public-key-order bookkeeping that
    // Connect's multisig flow requires is a separate substantial
    // piece of work. Surface the limit with a clear path to the
    // software signer until the full envelope lands.
    /** @returns {Promise<import('./Signer.js').SignMultisigPsbtReturn>} */
    async signMultisigPsbt() {
        throw new Error(
            'TrezorSigner.signMultisigPsbt: hardware multisig PSBT signing on Trezor is not yet wired. The signTransaction envelope requires multisig `signatures` arrays + public-key-ordering plumbing that isn\'t in trezorFormat.js today. Use the wallet\'s software signer for this cosigner.',
        );
    }
}

/**
 * Read a `SignerRecord`-compatible device identifier out of a
 * `getFeatures` payload. Prefers `device_id` (stable across firmware
 * resets on modern models); falls back to `fw_fingerprint` on older
 * devices that don't expose `device_id`. Returns `null` if neither
 * is present. The pairing flow should reject that case.
 *
 * @param {any} features
 * @returns {string | null}
 */
export function deviceIdentifierFromFeatures(features) {
    if (!features || typeof features !== 'object') return null;
    if (typeof features.device_id === 'string' && features.device_id.length > 0) {
        return features.device_id;
    }
    if (typeof features.fw_fingerprint === 'string' && features.fw_fingerprint.length > 0) {
        return features.fw_fingerprint;
    }
    return null;
}

/**
 * Read a model code out of a `getFeatures` payload. Trezor reports
 * `internal_model` on modern firmwares (e.g. "T2T1" / "T2B1" /
 * "T3T1") and `model` on older firmwares (where it's a one-letter
 * code: "1" / "T"). Normalize to the firmware-manifest model keys.
 *
 * @param {any} features
 * @returns {string | null}
 */
export function modelFromFeatures(features) {
    if (!features || typeof features !== 'object') return null;
    if (typeof features.internal_model === 'string' && features.internal_model.length > 0) {
        return features.internal_model;
    }
    if (typeof features.model === 'string') {
        switch (features.model) {
            case '1': return 'T1B1';
            case 'T': return 'T2T1';
            default: return features.model;
        }
    }
    return null;
}

/**
 * Compose the firmware version string "major.minor.patch" from
 * `getFeatures` fields. Returns `null` if any component is missing
 * so the caller can record `firmwareVersion: null` and show "unknown"
 * rather than a half-filled version in the UI.
 *
 * @param {any} features
 * @returns {string | null}
 */
export function firmwareVersionFromFeatures(features) {
    if (!features || typeof features !== 'object') return null;
    const maj = features.major_version;
    const min = features.minor_version;
    const pat = features.patch_version;
    if (typeof maj === 'number' && typeof min === 'number' && typeof pat === 'number') {
        return `${maj}.${min}.${pat}`;
    }
    return null;
}

// The address types this seam can derive. The doc comment below states the
// hazard and the map still fell through on it: the bitcoin descriptor lists
// p2tr as a first-class type (template m/86'), so a p2tr request returned an
// 84' segwit-v0 address that the caller recorded as taproot - "an address the
// device will happily sign but the wallet won't recognize later", exactly as
// warned. SoftwareSigner.getAddresses validates the request against
// descriptor.addressTypes; this refusal is the hardware equivalent. Do NOT add
// an 86' branch: Connect would derive it, but this wallet cannot sign taproot,
// so the failure would only move to spend time on funds already received.
const TREZOR_DERIVABLE_ADDRESS_TYPES = new Set(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh']);

/**
 * BIP44 purpose field for an address type. Trezor expects the purpose
 * in the path to match the script format; picking the wrong one here
 * produces addresses the device will happily sign but the wallet
 * won't recognize later.
 *
 * An OMITTED addressType keeps its existing per-coin default and is not an
 * error; only an explicitly requested type this seam cannot derive is refused.
 *
 * @param {string | undefined} addressType
 * @param {string} coin
 */
function bip44PurposeFor(addressType, coin) {
    if (addressType !== undefined && addressType !== null
        && !TREZOR_DERIVABLE_ADDRESS_TYPES.has(addressType)) {
        throw new Error(
            `This hardware device can't derive ${String(addressType).toUpperCase()} addresses in `
            + 'this wallet - use a software wallet for this address type. (The device would derive '
            + 'at a different BIP44 purpose than the rest of the wallet, so the address would not '
            + 'be recognized later.)',
        );
    }
    if (addressType === 'p2wpkh') return "84'";
    if (addressType === 'p2sh-p2wpkh') return "49'";
    if (addressType === 'p2pkh') return "44'";
    // Dogecoin + Litecoin legacy default to p2pkh purpose 44'.
    if (coin === 'doge' || coin === 'ltc') return "44'";
    // Bitcoin default is native segwit.
    return "84'";
}

/**
 * @param {{ purpose: string, coin: string, accountIndex: number, change: 0 | 1, index: number }} parts
 *
 * `purpose` + `coinType` already carry their own hardening quote;
 * don't double-quote them in the template.
 */
function formatBip44Path({ purpose, coin, accountIndex, change, index }) {
    const coinType = coinTypeFor(coin);
    return `m/${purpose}/${coinType}/${accountIndex}'/${change}/${index}`;
}

/**
 * SLIP-44 coin types for the chains the wallet supports. Mainnet slots only,
 * matching the chain descriptors' parity anchor (coin-type stays at the mainnet
 * slot on every network). Trezor's 'test' coin is intentionally absent: it
 * forces coin-type 1', which diverges from the wallet's 0'-anchored bitcoin
 * derivation, so bitcoin-testnet is rejected upstream in chainIdToTrezorCoin
 * and can never reach this formatter.
 *
 * Exported (in addition to its internal use in formatBip44Path) so a parity
 * test can assert this hardware-signer copy of the coin-type slot never
 * diverges from the chain descriptors' derivationPaths, which is the copy
 * the software signer derives against (uuid 980fe12c).
 * @param {string} coin
 */
export function coinTypeFor(coin) {
    switch (coin) {
        case 'btc': return "0'";
        case 'ltc': return "2'";
        case 'doge': return "3'";
        default:
            throw new Error(`TrezorSigner: unknown Trezor coin "${coin}"`);
    }
}

function signerFailure(signerId, method, res) {
    const code = res?.payload?.code ?? res?.error?.code ?? null;
    const msg = res?.payload?.error ?? res?.error?.error ?? 'unknown Trezor Connect failure';
    return new SignerStatusError(signerId, 'error', `${method} failed: ${msg}${code ? ` (${code})` : ''}`);
}
