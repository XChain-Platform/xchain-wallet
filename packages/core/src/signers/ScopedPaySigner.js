// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ScopedPaySigner (PC-16 Phase B): the only signer that exists while the
// wallet is locked. Auto pay keeps paying armed orders after a lock, and
// this signer is what makes that safe to allow: it signs exactly one kind of
// transaction, a COINPAY payment for one match, and refuses everything else.
//
// One instance is bound to one payment. The binding (source address, payee,
// exact amount, match index, deadline, fee-rate ceiling) comes from the
// locked session's own table and the obligation the watcher verified; the
// caller's signing paths are ignored and the key is the one sealed for that
// source address at lock time. Every check runs on the PSBT bytes handed to
// signPsbt, never on what the caller says they contain.
//
// A refusal is reported to the session, which ends locked auto pay: a
// request this signer will not sign means something upstream is building
// transactions it should not, and the safe answer is to stop until the
// person unlocks.

import { Signer } from './Signer.js';

/** Signer kind reported for the locked auto pay lane. */
export const SCOPED_PAY_SIGNER_KIND = 'scoped-pay';

// Conservative byte sizes for the fee ceiling: a legacy P2PKH input with its
// signature is about 148 bytes and an output at most about 43, so these
// over-estimate every script type the wallet funds from. The ceiling is a
// tripwire for a fee the payment never meant to spend, not a fee policy.
const INPUT_BYTES = 150;
const OUTPUT_BYTES = 45;
const OVERHEAD_BYTES = 12;

/**
 * Raised for every request the scoped signer will not sign. `reason` is a
 * short machine word for tests and logs; it never carries key material.
 */
export class ScopedPayRefusalError extends Error {
    /** @param {string} reason */
    constructor(reason) {
        super(`Locked auto pay refused to sign (${reason}).`);
        this.name = 'ScopedPayRefusalError';
        this.code = 'SCOPED_PAY_REFUSED';
        this.reason = reason;
    }
}

/**
 * @typedef {Object} ScopedPayBinding
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} sourceAddress        the armed order's source; every input and any change
 * @property {string} payeeAddress         the obligation's payee
 * @property {string} amountBase           exact payee amount, base units (decimal string)
 * @property {string} matchIndex           ORDER_MATCH action index being paid
 * @property {number} deadlineSeconds      obligation expiration, unix seconds
 * @property {number} feeRatePerByteCeiling  base units per byte, fixed at lock time
 */

function toBig(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    return null;
}

function isOpReturn(out) {
    return typeof out?.scriptPubKeyHex === 'string'
        && out.scriptPubKeyHex.toLowerCase().startsWith('6a');
}

/**
 * Pure check of one decomposed PSBT against a payment binding. Exported so
 * the rules can be tested without keys.
 *
 * @param {Object} args
 * @param {{ inputs?: any[], outputs?: any[] }} args.decomposed   sdk.wallet.decomposePsbt output
 * @param {{ ok: boolean, action?: string, params?: Record<string, unknown> } | null} args.decodedAction
 *   sdk.decoder.decodeActionFromPsbt output
 * @param {ScopedPayBinding} args.binding
 * @param {number} args.nowSeconds
 * @param {boolean} args.alreadyPaid
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkScopedPayment({ decomposed, decodedAction, binding, nowSeconds, alreadyPaid }) {
    const fail = (reason) => ({ ok: false, reason });
    if (!binding) return fail('unbound');
    if (alreadyPaid) return fail('repeat-match');
    if (!Number.isFinite(binding.deadlineSeconds) || !(nowSeconds < binding.deadlineSeconds)) {
        return fail('past-deadline');
    }
    const amount = toBig(binding.amountBase);
    if (amount === null || amount <= 0n) return fail('bad-binding');

    const inputs = Array.isArray(decomposed?.inputs) ? decomposed.inputs : [];
    const outputs = Array.isArray(decomposed?.outputs) ? decomposed.outputs : [];
    if (inputs.length === 0) return fail('no-inputs');

    // Every input must be the armed source address, with a value we can
    // count. An input whose script does not decode to an address is not
    // "unknown, leave it to the signer" here: it is foreign.
    let inTotal = 0n;
    for (const input of inputs) {
        if (input?.address !== binding.sourceAddress) return fail('foreign-input');
        const v = toBig(input?.value);
        if (v === null) return fail('input-value-unknown');
        inTotal += v;
    }

    // Outputs: exactly one payee output at exactly the amount, exactly one
    // zero-value OP_RETURN, and at most one change output back to the source.
    let payee = 0;
    let carrier = 0;
    let change = 0;
    let unknown = 0;
    let outTotal = 0n;
    for (const out of outputs) {
        const v = toBig(out?.value);
        if (v === null) return fail('output-value-unknown');
        outTotal += v;
        if (isOpReturn(out)) {
            if (v !== 0n) return fail('carrier-has-value');
            carrier += 1;
            continue;
        }
        if (out?.address === binding.payeeAddress && payee === 0 && v === amount) {
            payee += 1;
            continue;
        }
        if (out?.address === binding.sourceAddress && binding.sourceAddress !== binding.payeeAddress) {
            change += 1;
            continue;
        }
        if (out?.address === binding.payeeAddress) return fail('wrong-amount');
        unknown += 1;
    }
    if (payee !== 1) return fail('wrong-payee');
    if (unknown > 0 || change > 1) return fail('extra-output');
    if (carrier !== 1) return fail(carrier === 0 ? 'no-carrier' : 'extra-carrier');

    // The OP_RETURN must be this match's COINPAY and nothing else.
    if (!decodedAction || decodedAction.ok !== true) return fail('carrier-undecodable');
    if (String(decodedAction.action).toUpperCase() !== 'COINPAY') return fail('not-coinpay');
    const decodedIndex = decodedAction.params?.ORDER_MATCH_ACTION_INDEX;
    if (String(decodedIndex) !== String(binding.matchIndex)) return fail('wrong-match');

    // Fee: what the inputs leave behind, against the lock-time rate ceiling
    // sized by this transaction's own shape.
    if (outTotal > inTotal) return fail('outputs-exceed-inputs');
    const fee = inTotal - outTotal;
    const rate = Number(binding.feeRatePerByteCeiling);
    if (!Number.isFinite(rate) || rate <= 0) return fail('bad-binding');
    const sizeBytes = OVERHEAD_BYTES + INPUT_BYTES * inputs.length + OUTPUT_BYTES * outputs.length;
    const ceiling = BigInt(Math.ceil(rate)) * BigInt(sizeBytes);
    if (fee > ceiling) return fail('fee-over-ceiling');

    return { ok: true };
}

export class ScopedPaySigner extends Signer {
    /**
     * @param {Object} opts
     * @param {ScopedPayBinding | null} opts.binding     null builds a signer that refuses every request
     * @param {any} opts.sdkRegistry
     * @param {(args: { binding: ScopedPayBinding, psbtHex: string, inputIndices: number[] }) => Promise<{ signedPsbtHex: string, txHex: string, txid: string }>} opts.signWithSealedKey
     *   unseals the source key inside the session, signs and zeroes; never returns key bytes
     * @param {(chainId: string, matchIndex: string) => boolean} opts.isPaid
     * @param {(reason: string) => void} opts.onRefusal
     * @param {() => number} [opts.now]   milliseconds
     */
    constructor({ binding, sdkRegistry, signWithSealedKey, isPaid, onRefusal, now }) {
        super();
        this._binding = binding ? Object.freeze({ ...binding }) : null;
        this._sdkRegistry = sdkRegistry;
        this._signWithSealedKey = signWithSealedKey;
        this._isPaid = typeof isPaid === 'function' ? isPaid : () => true;
        this._onRefusal = typeof onRefusal === 'function' ? onRefusal : () => {};
        this._now = typeof now === 'function' ? now : () => Date.now();
        this._used = false;
    }

    get id() {
        return `scoped-pay:${this._binding?.walletId ?? 'unbound'}`;
    }

    get displayName() {
        return 'Auto pay';
    }

    get kind() {
        return SCOPED_PAY_SIGNER_KIND;
    }

    get requiresPhysicalConfirmation() {
        return false;
    }

    async getStatus() {
        return this._binding && !this._used ? 'available' : 'locked';
    }

    _refuse(reason) {
        try { this._onRefusal(reason); } catch { /* the refusal still stands */ }
        throw new ScopedPayRefusalError(reason);
    }

    /**
     * Sign the bound COINPAY payment, once.
     *
     * @param {{ psbtHex: string, chainId: string, signingPaths?: any[], reveal?: boolean, envelopeReveal?: boolean }} params
     */
    async signPsbt({ psbtHex, chainId, reveal, envelopeReveal } = {}) {
        const binding = this._binding;
        if (!binding) this._refuse('unbound');
        if (this._used) this._refuse('already-used');
        if (reveal || envelopeReveal) this._refuse('not-op-return');
        if (chainId !== binding.chainId) this._refuse('wrong-chain');
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) this._refuse('no-psbt');
        this._used = true;

        let decomposed;
        let decodedAction;
        try {
            const sdk = this._sdkRegistry.get(chainId);
            decomposed = sdk.wallet.decomposePsbt(psbtHex);
            decodedAction = sdk.decoder.decodeActionFromPsbt(psbtHex);
        } catch {
            this._refuse('undecodable');
        }
        const verdict = checkScopedPayment({
            decomposed,
            decodedAction,
            binding,
            nowSeconds: Math.floor(this._now() / 1000),
            alreadyPaid: this._isPaid(binding.chainId, binding.matchIndex) === true,
        });
        if (!verdict.ok) this._refuse(verdict.reason);

        // Sign every input: the check above proved they are all the source's.
        const inputIndices = decomposed.inputs.map((_input, index) => index);
        return this._signWithSealedKey({ binding, psbtHex, inputIndices });
    }

    async signMessage() { return this._refuse('message-signing'); }

    async getAddresses() { return this._refuse('derivation'); }

    async getPublicKey() { return this._refuse('derivation'); }

    async getAccountXpub() { return this._refuse('derivation'); }

    async getMasterFingerprint() { return this._refuse('derivation'); }

    async signMusig2Round1() { return this._refuse('multisig'); }

    async signMusig2Round2() { return this._refuse('multisig'); }

    async signMultisigClassical() { return this._refuse('multisig'); }

    async signMultisigPsbt() { return this._refuse('multisig'); }

    getMasterKey() { return this._refuse('key-export'); }

    exportWifForPath() { return this._refuse('key-export'); }

    exportWifForAddressId() { return this._refuse('key-export'); }

    addImportedWif() { return this._refuse('key-import'); }

    /** The session owns the key; there is nothing here to lock. */
    lock() {}
}
