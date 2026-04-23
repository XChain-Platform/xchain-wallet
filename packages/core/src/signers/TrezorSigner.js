// TrezorSigner — §17.3. Wraps a Trezor Connect instance (a
// `@trezor/connect-web` popup-transport factory in browser/extension,
// a `@trezor/connect` node-transport factory in desktop). The class
// itself imports nothing from the Trezor SDK — `connect` is injected
// so the signer stays testable without hardware and doesn't pull the
// SDK into core's dep graph.
//
// Per-target transports live in the shell packages:
//
//   packages/extension/src/signers/trezorFactory.js
//   packages/web/src/signers/trezorFactory.js
//   packages/desktop/src/signers/trezorFactory.js    (Piece 5)
//
// Each factory dynamic-imports its transport package, initializes it
// with the wallet's Trezor Connect manifest, and constructs a
// TrezorSigner wrapping the initialized instance.
//
// Step 13 scope: getStatus / getAddresses / getPublicKey are wired.
// signPsbt + signMessage throw NotImplementedError — PSBT↔Trezor
// input/output conversion is non-trivial and depends on xchain-sdk's
// PSBT utilities; that integration belongs in its own step (see
// CHANGELOG at v0.53.0 + the Step-13 smoke's guard).

import { AbstractMethodError, NotImplementedError, Signer, SignerStatusError } from './Signer.js';

/**
 * @typedef {Object} TrezorConnectResponse
 * @property {boolean} success
 * @property {any} [payload]            on success
 * @property {{ code?: string, error: string }} [error]   flat on failure (Connect wraps error info under `payload` — factories normalize to this shape)
 */

/**
 * Minimal shape of the injected Connect instance. Production code
 * passes the real `@trezor/connect-web` default export after `init`;
 * tests pass a hand-written fake. The methods listed here are all the
 * TrezorSigner class reaches for — keeping this narrow is what makes
 * the mock surface tiny (see trezor-signer.smoke.js).
 *
 * @typedef {Object} TrezorConnect
 * @property {() => Promise<TrezorConnectResponse>} getFeatures
 * @property {(args: { path: string, coin: string, showOnTrezor?: boolean }) => Promise<TrezorConnectResponse>} getAddress
 * @property {(args: { path: string, coin: string }) => Promise<TrezorConnectResponse>} getPublicKey
 * @property {(args: any) => Promise<TrezorConnectResponse>} signTransaction
 * @property {(args: { path: string, coin: string, message: string }) => Promise<TrezorConnectResponse>} signMessage
 */

/**
 * Maps a wallet chainId to the Trezor Connect `coin` string the SDK
 * expects. Kept local so the Trezor mapping doesn't leak out of the
 * signer. If the chainId isn't known the signer refuses to act —
 * there's no safe default.
 *
 * @param {string} chainId
 * @returns {string}
 */
function chainIdToTrezorCoin(chainId) {
    switch (chainId) {
        case 'bitcoin-mainnet': return 'btc';
        case 'bitcoin-testnet': return 'test';
        case 'litecoin-mainnet': return 'ltc';
        case 'dogecoin-mainnet': return 'doge';
        default:
            throw new Error(`TrezorSigner: unsupported chainId "${chainId}"`);
    }
}

export class TrezorSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id                Stable signer id — typically the SignerRecord id
     * @param {string} opts.displayName       UI label — "Trezor Model T (My Trezor)"
     * @param {string} opts.model             Model code — matches SignerRecord.model + firmware-manifest keys
     * @param {string} opts.deviceIdentifier  Opaque per-device id
     * @param {TrezorConnect} opts.connect    Injected Connect instance (production: @trezor/connect-web post-init; tests: fake)
     */
    constructor({ id, displayName, model, deviceIdentifier, connect }) {
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
    }

    get id() { return this._id; }
    get displayName() { return this._displayName; }
    get kind() { return 'trezor'; }
    get requiresPhysicalConfirmation() { return true; }
    get model() { return this._model; }
    get deviceIdentifier() { return this._deviceIdentifier; }

    /**
     * Reads device status by pinging `getFeatures`. Returns:
     *   - `'available'` — device reachable + same physical device we paired
     *   - `'disconnected'` — Connect rejects or the device identifier doesn't match
     *   - `'error'` — unexpected Connect failure
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
        // reports a different id, treat that as disconnected — the user
        // plugged in a different Trezor. Matching uses either the
        // `device_id` or the `fw_fingerprint` field, whichever the
        // pairing flow captured.
        const observedId = features?.device_id ?? features?.fw_fingerprint ?? null;
        if (observedId && observedId !== this._deviceIdentifier) {
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
    async getAddresses({ chainId, accountIndex, change, startIndex, count, addressType }) {
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
            const [addrRes, pkRes] = await Promise.all([
                this._connect.getAddress({ path, coin, showOnTrezor: false }),
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
     * PSBT signing. Trezor Connect takes its own inputs/outputs shape,
     * not a raw PSBT — we need a PSBT↔Trezor converter that draws on
     * xchain-sdk's PSBT utilities. That integration lives in a later
     * step; TrezorSigner intentionally throws NotImplementedError
     * today so callers get a loud message instead of silent wrong
     * signatures.
     *
     * See `Signer.signPsbt` for the contract the real implementation
     * must meet.
     *
     * @param {import('./Signer.js').SignPsbtParams} _params
     * @returns {Promise<import('./Signer.js').SignPsbtReturn>}
     */
    async signPsbt(_params) {
        throw new NotImplementedError(
            'TrezorSigner.signPsbt — PSBT↔Trezor conversion lands in a later step. '
            + 'See firmware-manifest.js + §17.3 for the pending work.',
        );
    }

    /**
     * Message signing. Same deferral as signPsbt — Trezor Connect's
     * `signMessage` returns its own envelope shape and needs protocol-
     * level wrapping to match xchain-sdk's message-auth expectations.
     *
     * @param {import('./Signer.js').SignMessageParams} _params
     * @returns {Promise<import('./Signer.js').SignMessageReturn>}
     */
    async signMessage(_params) {
        throw new NotImplementedError(
            'TrezorSigner.signMessage — protocol-level envelope wrapping lands in a later step.',
        );
    }
}

/**
 * Read a `SignerRecord`-compatible device identifier out of a
 * `getFeatures` payload. Prefers `device_id` (stable across firmware
 * resets on modern models); falls back to `fw_fingerprint` on older
 * devices that don't expose `device_id`. Returns `null` if neither
 * is present — the pairing flow should reject that case.
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

/**
 * BIP44 purpose field for an address type. Trezor expects the purpose
 * in the path to match the script format; picking the wrong one here
 * produces addresses the device will happily sign but the wallet
 * won't recognize later.
 *
 * @param {string | undefined} addressType
 * @param {string} coin
 */
function bip44PurposeFor(addressType, coin) {
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
 * `purpose` + `coinType` already carry their own hardening quote —
 * don't double-quote them in the template.
 */
function formatBip44Path({ purpose, coin, accountIndex, change, index }) {
    const coinType = coinTypeFor(coin);
    return `m/${purpose}/${coinType}/${accountIndex}'/${change}/${index}`;
}

/**
 * SLIP-44 coin types for the chains the wallet supports.
 * @param {string} coin
 */
function coinTypeFor(coin) {
    switch (coin) {
        case 'btc': return "0'";
        case 'test': return "1'";
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

// Re-export for the signers/index.js barrel's benefit; referenced
// only by error paths within this file.
export { AbstractMethodError };
