// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export class CpfpPlanError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CpfpPlanError';
    }
}

// One P2WPKH input, one P2WPKH output.
const DEFAULT_CHILD_VBYTES = 110;
const DUST_SATS = 546n;

function sats(value, label) {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    throw new CpfpPlanError(`planCpfpChild: ${label} must be an exact non-negative satoshi amount`);
}

function wireAmount(value) {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : String(value);
}

/**
 * Build exact-input encoder options for a child-pays-for-parent transaction.
 *
 * Used when the pending send did not signal BIP-125, so it cannot be replaced
 * and the only way to speed it up is to spend its wallet-owned change in a
 * child that carries enough fee for the parent and child together to reach
 * `feeRate` as a package.
 *
 * @param {object} opts
 * @param {string} opts.parentTxid
 * @param {import('../signers/types.js').DecomposedPsbt} opts.parent
 * @param {string} opts.sourceAddress
 * @param {string[]} [opts.ownAddresses]
 * @param {string|number} opts.feeRate Target package feeRate in sat/vB.
 * @param {number} opts.parentVbytes
 * @param {number} [opts.childVbytes]
 * @returns {{ encoderOpts: object, parentFeeSats: string, childFeeSats: string, packageFeeSats: string, packageVbytes: number }}
 */
export function planCpfpChild({
    parentTxid,
    parent,
    sourceAddress,
    ownAddresses = [sourceAddress],
    feeRate,
    parentVbytes,
    childVbytes = DEFAULT_CHILD_VBYTES,
} = {}) {
    const txid = String(parentTxid || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new CpfpPlanError('planCpfpChild: parentTxid is invalid');
    if (typeof sourceAddress !== 'string' || !sourceAddress) {
        throw new CpfpPlanError('planCpfpChild: sourceAddress is required');
    }
    if (!parent || !Array.isArray(parent.inputs) || parent.inputs.length === 0
        || !Array.isArray(parent.outputs) || parent.outputs.length === 0) {
        throw new CpfpPlanError('planCpfpChild: parent needs inputs and outputs');
    }
    const rate = typeof feeRate === 'number' ? feeRate : Number(String(feeRate ?? '').trim());
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new CpfpPlanError('planCpfpChild: feeRate must be a positive satoshi-per-vbyte rate');
    }
    const pBytes = Number(parentVbytes);
    const cBytes = Number(childVbytes);
    if (!Number.isSafeInteger(pBytes) || pBytes <= 0) {
        throw new CpfpPlanError('planCpfpChild: parentVbytes is required');
    }
    if (!Number.isSafeInteger(cBytes) || cBytes <= 0) {
        throw new CpfpPlanError('planCpfpChild: childVbytes must be a positive integer');
    }

    const inputTotal = parent.inputs.reduce((sum, input, i) => sum + sats(input?.value, `parent.inputs[${i}].value`), 0n);
    const outputs = parent.outputs.map((output, i) => ({
        address: typeof output?.address === 'string' && output.address ? output.address : null,
        value: sats(output?.value, `parent.outputs[${i}].value`),
        scriptPubKey: String(output?.scriptPubKeyHex || output?.scriptPubKey || '').toLowerCase(),
    }));
    const outputTotal = outputs.reduce((sum, output) => sum + output.value, 0n);
    if (outputTotal >= inputTotal) {
        throw new CpfpPlanError('planCpfpChild: parent has no readable positive fee');
    }
    const parentFee = inputTotal - outputTotal;

    const owned = new Set((Array.isArray(ownAddresses) ? ownAddresses : []).filter(Boolean));
    owned.add(sourceAddress);
    let vout = -1;
    for (let i = outputs.length - 1; i >= 0; i -= 1) {
        if (outputs[i].address && owned.has(outputs[i].address)) { vout = i; break; }
    }
    if (vout < 0) {
        throw new CpfpPlanError('planCpfpChild: parent has no wallet-owned output to spend');
    }
    const spend = outputs[vout];
    if (!/^(?:[0-9a-f]{2})+$/.test(spend.scriptPubKey)) {
        throw new CpfpPlanError('planCpfpChild: wallet-owned output has no usable scriptPubKey');
    }

    // Package fee must reach feeRate over parent + child; the child carries
    // whatever the parent is short, and never less than feeRate on its own.
    const packageBytes = pBytes + cBytes;
    const packageFloor = BigInt(Math.ceil(rate * packageBytes));
    const childFloor = BigInt(Math.ceil(rate * cBytes));
    const shortfall = packageFloor > parentFee ? packageFloor - parentFee : 0n;
    const childFee = shortfall > childFloor ? shortfall : childFloor;
    if (spend.value < childFee + DUST_SATS) {
        throw new CpfpPlanError('planCpfpChild: wallet-owned output cannot cover the child fee');
    }

    return {
        encoderOpts: {
            change: sourceAddress,
            utxos: [{
                txid, vout, value: wireAmount(spend.value), scriptPubKey: spend.scriptPubKey, confirmations: 0,
            }],
            customOutputs: [{ address: sourceAddress, value: wireAmount(spend.value - childFee) }],
            fee: wireAmount(childFee),
            rbf: true,
            unconfirmed: true,
            options: { exactInputs: true },
        },
        parentFeeSats: String(parentFee),
        childFeeSats: String(childFee),
        packageFeeSats: String(parentFee + childFee),
        packageVbytes: packageBytes,
    };
}
