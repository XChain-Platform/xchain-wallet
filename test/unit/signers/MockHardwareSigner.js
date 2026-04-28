// MockHardwareSigner — §52 / G162 test scaffolding.
//
// Deterministic, in-process Signer implementation usable by unit tests
// that exercise signer-touching code without a paired Trezor / Ledger.
// Extends the abstract Signer base from `@xchain-wallet/core` so the
// interface contract is honoured: any test running against a real HW
// signer can swap in this mock and still hit the same call sites.
//
// Configurable via constructor:
//   - vendor:           'trezor' | 'ledger'           (default 'trezor')
//   - model:            free-form string              (default 'mock')
//   - firmwareVersion:  free-form string              (default '0.0.0')
//   - id:               stable signer-record id       (default `mock-${vendor}-${counter}`)
//   - status:           SignerStatus                  (default 'available')
//   - getAddresses:     (params) => DerivedAddress[]  (default returns N synthesized rows)
//   - signPsbtResult:   (params) => SignPsbtReturn    (default returns canned envelope)
//   - signMessageResult:(params) => SignMessageReturn (default returns canned hex)
//   - getPublicKeyResult:(params) => GetPublicKeyReturn  (default returns canned triple)
//
// Tests that need to assert call counts / parameters can wrap any of
// the *Result functions in vi.fn() / spy themselves.

import { Signer } from '../../../packages/core/src/signers/Signer.js';

let mockCounter = 0;

const ZERO_PUBKEY = '02' + '00'.repeat(32); // 33-byte compressed
const ZERO_TX_HEX = '00';
const ZERO_TXID = '0'.repeat(64);
const ZERO_PSBT_HEX = '70736274ff'; // PSBT magic + separator (no inputs / outputs)
const ZERO_SIG_HEX = '0'.repeat(128); // 64-byte ECDSA placeholder
const ZERO_FINGERPRINT = '00000000';
const ZERO_CHAIN_CODE = '0'.repeat(64);

/**
 * @typedef {Object} MockHardwareSignerOpts
 * @property {'trezor' | 'ledger'} [vendor]
 * @property {string} [model]
 * @property {string} [firmwareVersion]
 * @property {string} [id]
 * @property {import('../../../packages/core/src/signers/Signer.js').SignerKind} [kind]
 * @property {string} [displayName]
 * @property {import('../../../packages/core/src/signers/Signer.js').SignerStatus} [status]
 * @property {boolean} [requiresPhysicalConfirmation]
 * @property {(params: object) => any[]} [getAddresses]
 * @property {(params: object) => object} [signPsbtResult]
 * @property {(params: object) => object} [signMessageResult]
 * @property {(params: object) => object} [getPublicKeyResult]
 */

/**
 * @extends Signer
 */
export class MockHardwareSigner extends Signer {
    /** @param {MockHardwareSignerOpts} [opts] */
    constructor(opts = {}) {
        super();
        const vendor = opts.vendor === 'ledger' ? 'ledger' : 'trezor';
        mockCounter += 1;
        this._id = opts.id ?? `mock-${vendor}-${mockCounter}`;
        this._vendor = vendor;
        this._model = opts.model ?? 'mock';
        this._firmwareVersion = opts.firmwareVersion ?? '0.0.0';
        this._kind = opts.kind ?? vendor;
        this._displayName = opts.displayName ?? `Mock ${vendor[0].toUpperCase() + vendor.slice(1)}`;
        this._status = opts.status ?? 'available';
        this._requiresPhysicalConfirmation = Boolean(opts.requiresPhysicalConfirmation ?? true);
        this._getAddressesImpl = opts.getAddresses ?? null;
        this._signPsbtResult = opts.signPsbtResult ?? null;
        this._signMessageResult = opts.signMessageResult ?? null;
        this._getPublicKeyResult = opts.getPublicKeyResult ?? null;
        // Counters tests can assert on without wrapping individual handlers.
        this.calls = {
            getStatus: 0,
            getAddresses: 0,
            signPsbt: 0,
            signMessage: 0,
            getPublicKey: 0,
        };
    }

    get id() { return this._id; }
    get displayName() { return this._displayName; }
    get kind() { return this._kind; }
    get vendor() { return this._vendor; }
    get model() { return this._model; }
    get firmwareVersion() { return this._firmwareVersion; }
    get requiresPhysicalConfirmation() { return this._requiresPhysicalConfirmation; }

    /**
     * Tests can call this to drive status transitions deterministically.
     * Fires the same listener event the real signers fire on connect /
     * disconnect / wrong-app.
     * @param {import('../../../packages/core/src/signers/Signer.js').SignerStatus} status
     * @param {string} [detail]
     */
    setStatus(status, detail) {
        this._status = status;
        this._emitStatus(status, detail);
    }

    async getStatus() {
        this.calls.getStatus += 1;
        return this._status;
    }

    async getAddresses(params) {
        this.calls.getAddresses += 1;
        if (this._getAddressesImpl) return this._getAddressesImpl(params);
        const count = Math.max(1, Number(params?.count ?? 1));
        const startIndex = Number(params?.startIndex ?? 0);
        const accountIndex = Number(params?.accountIndex ?? 0);
        const change = Number(params?.change ?? 0);
        const out = [];
        for (let i = 0; i < count; i += 1) {
            const index = startIndex + i;
            out.push({
                index,
                address: `mock-${this._vendor}-addr-${accountIndex}-${change}-${index}`,
                publicKey: ZERO_PUBKEY,
                path: `m/84'/0'/${accountIndex}'/${change}/${index}`,
            });
        }
        return out;
    }

    async signPsbt(params) {
        this.calls.signPsbt += 1;
        if (this._signPsbtResult) return this._signPsbtResult(params);
        return {
            signedPsbtHex: ZERO_PSBT_HEX,
            txHex: ZERO_TX_HEX,
            txid: ZERO_TXID,
        };
    }

    async signMessage(params) {
        this.calls.signMessage += 1;
        if (this._signMessageResult) return this._signMessageResult(params);
        return { signature: ZERO_SIG_HEX };
    }

    async getPublicKey(params) {
        this.calls.getPublicKey += 1;
        if (this._getPublicKeyResult) return this._getPublicKeyResult(params);
        return {
            publicKey: ZERO_PUBKEY,
            chainCode: ZERO_CHAIN_CODE,
            fingerprint: ZERO_FINGERPRINT,
        };
    }
}

/** Convenience factory. */
export function makeMockTrezorSigner(opts = {}) {
    return new MockHardwareSigner({ vendor: 'trezor', ...opts });
}

/** Convenience factory. */
export function makeMockLedgerSigner(opts = {}) {
    return new MockHardwareSigner({ vendor: 'ledger', ...opts });
}
