// RemoteSigner — §17.x (new). A Signer shim that forwards every
// interface call over an injected transport function. Exists so
// hardware signing can live in the renderer (where WebHID transport
// and Trezor Connect popups require a user gesture + tab anchor),
// while core wallet flows keep running in the background service
// worker.
//
// Wire protocol
// -------------
// The transport function the shim takes has the shape:
//
//   async transport({ op: string, payload: object }) -> any
//
// It is expected to serialize `{ op, payload }` over whatever
// messaging channel the shell provides (chrome.runtime ports for MV3
// extensions, `postMessage` for web, ipcMain/ipcRenderer for desktop)
// and return the response payload directly. Error handling:
//
//   - If the renderer rejects (user cancelled / device disconnected),
//     the transport should THROW the error so `signPsbt` / `signMessage`
//     reject with the underlying message.
//   - If the renderer reports a status change (locked, disconnected,
//     wrong-app), transport returns `{ status, detail }` for `getStatus`
//     and throws for `signPsbt` / `signMessage`.
//
// Ops
// ---
//
//   status                    -> SignerStatus
//   getAddresses(params)      -> DerivedAddress[]
//   getPublicKey(params)      -> GetPublicKeyReturn
//   signPsbt(params)          -> SignPsbtReturn
//   signMessage(params)       -> SignMessageReturn
//
// The shim passes the Signer-interface params through unchanged; the
// renderer-side handler is responsible for looking up the live signer
// instance by this shim's `id` (see §signingRegistry — shell-level)
// and calling the matching method.
//
// Why not just call the signer from the renderer?
// -----------------------------------------------
// Every existing action flow (sendToken, issueToken, mintToken, ...)
// runs in the background: it reads the vault, resolves chain state,
// assembles the PSBT via xchain-sdk, and broadcasts. Moving all of
// that to the renderer for HW-signed transactions would fork the code
// path. RemoteSigner keeps a single code path: background composes,
// hands the PSBT to a signer (software OR remote), signer handles
// signing, background broadcasts. Only the one round-trip to ask the
// device for a signature crosses the boundary.

import { Signer, SignerStatusError } from './Signer.js';

/**
 * @typedef {'status'|'getAddresses'|'getPublicKey'|'signPsbt'|'signMessage'} RemoteSignerOp
 */

/**
 * @typedef {(req: { op: RemoteSignerOp, payload: object }) => Promise<any>} RemoteSignerTransport
 */

export class RemoteSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id                           Stable signer id — must match a SignerRecord persisted on the renderer
     * @param {string} opts.displayName
     * @param {'trezor'|'ledger'} opts.kind              mirrors the paired SignerRecord
     * @param {RemoteSignerTransport} opts.transport
     */
    constructor({ id, displayName, kind, transport }) {
        super();
        if (!id) throw new Error('RemoteSigner: id is required');
        if (!displayName) throw new Error('RemoteSigner: displayName is required');
        if (kind !== 'trezor' && kind !== 'ledger') {
            throw new Error(`RemoteSigner: kind must be 'trezor' or 'ledger' (got "${kind}")`);
        }
        if (typeof transport !== 'function') {
            throw new Error('RemoteSigner: transport must be a function');
        }
        this._id = id;
        this._displayName = displayName;
        this._kind = kind;
        this._transport = transport;
    }

    get id() { return this._id; }
    get displayName() { return this._displayName; }
    get kind() { return this._kind; }
    get requiresPhysicalConfirmation() { return true; }

    async getStatus() {
        try {
            const res = await this._transport({ op: 'status', payload: { signerId: this._id } });
            if (typeof res === 'string') return res;
            if (res && typeof res.status === 'string') return res.status;
            return 'error';
        } catch {
            return 'disconnected';
        }
    }

    async getAddresses(params) {
        const res = await this._callOrThrow('getAddresses', params);
        if (!Array.isArray(res)) {
            throw new SignerStatusError(this._id, 'error', 'getAddresses: remote returned non-array');
        }
        return res;
    }

    async getPublicKey(params) {
        return this._callOrThrow('getPublicKey', params);
    }

    async signPsbt(params) {
        const res = await this._callOrThrow('signPsbt', params);
        if (!res || typeof res.txHex !== 'string' || typeof res.txid !== 'string') {
            throw new SignerStatusError(
                this._id, 'error', 'signPsbt: remote returned malformed result',
            );
        }
        return {
            signedPsbtHex: typeof res.signedPsbtHex === 'string' ? res.signedPsbtHex : '',
            txHex: res.txHex,
            txid: res.txid,
        };
    }

    async signMessage(params) {
        const res = await this._callOrThrow('signMessage', params);
        if (!res || typeof res.signature !== 'string') {
            throw new SignerStatusError(
                this._id, 'error', 'signMessage: remote returned no signature',
            );
        }
        return { signature: res.signature };
    }

    async _callOrThrow(op, payload) {
        try {
            return await this._transport({
                op,
                payload: { ...payload, signerId: this._id },
            });
        } catch (err) {
            const msg = err && err.message ? String(err.message) : String(err);
            throw new SignerStatusError(this._id, 'error', `${op} failed: ${msg}`);
        }
    }
}
