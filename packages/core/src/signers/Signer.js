// Abstract Signer contract — §17.1. Every wallet flow that needs to sign
// something goes through a Signer. Implementations: SoftwareSigner
// (§17.2, here in `core`), TrezorSigner / LedgerSigner (§17.3–4, separate
// workspace packages), MultisigSigner (§17.5, Phase 4+).
//
// The base class throws from every abstract method; subclasses override.
// A tiny pub/sub is provided on the base since all signers share the
// same 'status-change' event shape.

/** Stable error classes consumers can branch on. */
export class AbstractMethodError extends Error {
    constructor(method) {
        super(`Signer: abstract method "${method}" not implemented`);
        this.name = 'AbstractMethodError';
    }
}

export class SignerLockedError extends Error {
    constructor(signerId) {
        super(`Signer "${signerId}" is locked`);
        this.name = 'SignerLockedError';
        this.signerId = signerId;
    }
}

export class SignerStatusError extends Error {
    constructor(signerId, status, detail) {
        super(`Signer "${signerId}" is in status "${status}"${detail ? `: ${detail}` : ''}`);
        this.name = 'SignerStatusError';
        this.signerId = signerId;
        this.status = status;
    }
}

export class NotImplementedError extends Error {
    constructor(method) {
        super(`${method}: not yet implemented`);
        this.name = 'NotImplementedError';
    }
}

/** @typedef {'software' | 'trezor' | 'ledger' | 'multisig' | 'airgap'} SignerKind */
/** @typedef {'available' | 'locked' | 'disconnected' | 'wrong-app' | 'error'} SignerStatus */

/**
 * @typedef {Object} GetAddressesParams
 * @property {string} chainId
 * @property {number} accountIndex
 * @property {0 | 1} change
 * @property {number} startIndex
 * @property {number} count
 * @property {string} [addressType]  defaults to the chain's defaultAddressType
 */

/**
 * @typedef {Object} DerivedAddress
 * @property {number} index
 * @property {string} address
 * @property {string} publicKey   hex
 * @property {string} path        concrete BIP32 path
 */

/**
 * A signing-path entry. Exactly one of `path` (HD-derived) or
 * `addressId` (imported-WIF, software signer only) must be present.
 * Hardware signers accept only the `path` form.
 *
 * @typedef {Object} SigningPathEntry
 * @property {number} inputIndex
 * @property {string} [path]         BIP32 path — HD-derived key
 * @property {string} [addressId]    Address record id — imported-WIF key (SoftwareSigner only)
 * @property {number} [sighashType]
 */

/**
 * @typedef {Object} SignPsbtParams
 * @property {string} psbtHex
 * @property {string} chainId
 * @property {SigningPathEntry[]} signingPaths
 */

/**
 * @typedef {Object} SignPsbtReturn
 * @property {string} signedPsbtHex
 * @property {string} txHex
 * @property {string} txid
 */

/**
 * Sign a message. Like `SignPsbtParams.signingPaths`, exactly one of
 * `path` or `addressId` identifies the key.
 *
 * @typedef {Object} SignMessageParams
 * @property {string} message
 * @property {string} chainId
 * @property {string} [path]
 * @property {string} [addressId]
 */

/**
 * @typedef {Object} SignMessageReturn
 * @property {string} signature
 */

/**
 * @typedef {Object} GetPublicKeyParams
 * @property {string} chainId
 * @property {string} path
 */

/**
 * @typedef {Object} GetPublicKeyReturn
 * @property {string} publicKey
 * @property {string} chainCode
 * @property {string} fingerprint
 */

/**
 * @typedef {Object} MultisigSessionRef
 * @property {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} scheme
 * @property {number} threshold
 * @property {string[]} cosignerPubkeys     33-byte hex, ordered same as MultisigConfig.cosigners
 * @property {string} msgHash               32-byte hex; sighash of the input being signed
 * @property {string} fingerprint           32-byte hex of the canonicalized sessionRef (multisigPsbtEnvelope.fingerprintSessionRef)
 */

/**
 * @typedef {Object} SignMusig2Round1Params
 * @property {string} chainId
 * @property {string} path                  cosigner's BIP32 path
 * @property {MultisigSessionRef} sessionRef
 */

/**
 * @typedef {Object} SignMusig2Round1Return
 * @property {string} publicNonce           66-byte hex
 */

/**
 * @typedef {Object} SignMusig2Round2Params
 * @property {string} chainId
 * @property {string} path
 * @property {MultisigSessionRef} sessionRef
 * @property {string} aggNonceHex           66-byte aggregated public nonce, post-round-1
 */

/**
 * @typedef {Object} SignMusig2Round2Return
 * @property {string} publicNonce           66-byte hex; re-derived deterministically (same as round 1)
 * @property {string} partialSig            32-byte hex
 */

/**
 * @typedef {Object} SignMultisigClassicalParams
 * @property {string} chainId
 * @property {string} path                  cosigner's BIP32 path
 * @property {string} msgHash               32-byte hex; sighash being signed under the redeem/witness script
 */

/**
 * @typedef {Object} SignMultisigClassicalReturn
 * @property {string} sig                   DER-encoded ECDSA signature hex (no sighash flag byte)
 * @property {string} publicKey             33-byte hex of the signing key (for the sign-screen confirmation step)
 */

/** @typedef {(status: SignerStatus, detail?: string) => void} StatusListener */

export class Signer {
    constructor() {
        /** @type {Set<StatusListener>} */
        this._listeners = new Set();
    }

    /** Stable identifier (e.g. "software-wallet-abc", "trezor-device-xyz"). */
    get id() {
        throw new AbstractMethodError('id');
    }

    /** Human-readable name shown in UI. */
    get displayName() {
        throw new AbstractMethodError('displayName');
    }

    /** @returns {SignerKind} */
    get kind() {
        throw new AbstractMethodError('kind');
    }

    /** @returns {boolean} */
    get requiresPhysicalConfirmation() {
        return false;
    }

    /** @returns {Promise<SignerStatus>} */
    async getStatus() {
        throw new AbstractMethodError('getStatus');
    }

    /**
     * @param {GetAddressesParams} _params
     * @returns {Promise<DerivedAddress[]>}
     */
    async getAddresses(_params) {
        throw new AbstractMethodError('getAddresses');
    }

    /**
     * @param {SignPsbtParams} _params
     * @returns {Promise<SignPsbtReturn>}
     */
    async signPsbt(_params) {
        throw new AbstractMethodError('signPsbt');
    }

    /**
     * @param {SignMessageParams} _params
     * @returns {Promise<SignMessageReturn>}
     */
    async signMessage(_params) {
        throw new AbstractMethodError('signMessage');
    }

    /**
     * @param {GetPublicKeyParams} _params
     * @returns {Promise<GetPublicKeyReturn>}
     */
    async getPublicKey(_params) {
        throw new AbstractMethodError('getPublicKey');
    }

    /**
     * §22.3 MuSig2 round 1 — generate this signer's 66-byte publicNonce
     * for the given multisig session. The secret nonce is bound to the
     * (signer instance + sessionRef.fingerprint) tuple so round 2 can
     * deterministically re-derive it without persisting secret material.
     *
     * Hardware signers throw `NotImplementedError` with a clear
     * "Update firmware to use MuSig2 on this device" message until the
     * vendor app exposes MuSig2 nonce generation.
     *
     * @param {SignMusig2Round1Params} _params
     * @returns {Promise<SignMusig2Round1Return>}
     */
    async signMusig2Round1(_params) {
        throw new AbstractMethodError('signMusig2Round1');
    }

    /**
     * §22.3 MuSig2 round 2 — produce a 32-byte partial signature given
     * the aggregated public nonce. Re-derives the secret nonce from the
     * same deterministic sessionId used in round 1 (so the public
     * nonce returned matches round 1's output bit-for-bit).
     *
     * @param {SignMusig2Round2Params} _params
     * @returns {Promise<SignMusig2Round2Return>}
     */
    async signMusig2Round2(_params) {
        throw new AbstractMethodError('signMusig2Round2');
    }

    /**
     * §22.3 P2SH / P2WSH single-round contribution — produce a
     * DER-encoded ECDSA signature on the input's sighash under the
     * redeem / witness script. No sighash flag byte is appended; the
     * caller's PSBT finalizer adds it.
     *
     * @param {SignMultisigClassicalParams} _params
     * @returns {Promise<SignMultisigClassicalReturn>}
     */
    async signMultisigClassical(_params) {
        throw new AbstractMethodError('signMultisigClassical');
    }

    /**
     * Subscribe to status changes. Returns an unsubscribe function.
     * @param {StatusListener} listener
     * @returns {() => void}
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * @protected
     * @param {SignerStatus} status
     * @param {string} [detail]
     */
    _emitStatus(status, detail) {
        for (const fn of this._listeners) {
            try {
                fn(status, detail);
            } catch {
                // Listener errors are not the signer's concern.
            }
        }
    }
}
