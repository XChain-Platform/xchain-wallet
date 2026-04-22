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
 * @typedef {Object} SignPsbtParams
 * @property {string} psbtHex
 * @property {string} chainId
 * @property {Array<{ inputIndex: number, path: string, sighashType?: number }>} signingPaths
 */

/**
 * @typedef {Object} SignPsbtReturn
 * @property {string} signedPsbtHex
 * @property {string} txHex
 * @property {string} txid
 */

/**
 * @typedef {Object} SignMessageParams
 * @property {string} message
 * @property {string} chainId
 * @property {string} path
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
