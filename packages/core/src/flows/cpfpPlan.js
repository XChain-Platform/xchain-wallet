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

// Child vsize by the spent script type: one input of that type plus one output
// back to the source address, which is assumed to share it. Overhead is 10 vB
// legacy or 10.5 vB segwit (marker + flag), rounded up with the total.
const CHILD_VBYTES_BY_SCRIPT = [
    { name: 'p2pkh', test: /^76a914[0-9a-f]{40}88ac$/, vbytes: 192, segwit: false },
    { name: 'p2wpkh', test: /^0014[0-9a-f]{40}$/, vbytes: 110, segwit: true },
    { name: 'p2sh-p2wpkh', test: /^a914[0-9a-f]{40}87$/, vbytes: 134, segwit: true },
    { name: 'p2tr', test: /^5120[0-9a-f]{64}$/, vbytes: 111, segwit: true },
];

// A witness program (v0 to v16) cannot be spent as planned on a chain without segwit.
function isWitnessProgram(scriptPubKey) {
    return /^(?:00|5[1-9a-f]|60)(?:14[0-9a-f]{40}|20[0-9a-f]{64})$/.test(scriptPubKey);
}

// Read the chain's dust floor and segwit flag; never fall back to Bitcoin's 546
// (it would let a Dogecoin child output under the 100000-koinu floor through).
function networkRules(network) {
    const dust = Number(network?.dustThreshold);
    if (!Number.isSafeInteger(dust) || dust <= 0) {
        throw new CpfpPlanError('planCpfpChild: dust floor is unknown for this network');
    }
    return { dust: BigInt(dust), supportsSegwit: network.supportsSegwit !== false };
}

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
 * @param {number} [opts.childVbytes] Defaults to the size for the spent script type; an
 *   unrecognized script needs it passed explicitly.
 * @param {{ dustThreshold: number, supportsSegwit?: boolean }} opts.network The SDK network
 *   params (`sdk.wallet.getBitcoinNetwork()`); the plan is refused without a dust floor.
 * @returns {{ encoderOpts: object, parentFeeSats: string, childFeeSats: string, packageFeeSats: string, packageVbytes: number }}
 */
export function planCpfpChild({
    parentTxid,
    parent,
    sourceAddress,
    ownAddresses = [sourceAddress],
    feeRate,
    parentVbytes,
    childVbytes,
    network,
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
    if (!Number.isSafeInteger(pBytes) || pBytes <= 0) {
        throw new CpfpPlanError('planCpfpChild: parentVbytes is required');
    }
    const explicitChild = childVbytes !== undefined && childVbytes !== null;
    if (explicitChild && (!Number.isSafeInteger(Number(childVbytes)) || Number(childVbytes) <= 0)) {
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
    const scriptKind = CHILD_VBYTES_BY_SCRIPT.find((kind) => kind.test.test(spend.scriptPubKey));
    if (!explicitChild && !scriptKind) {
        throw new CpfpPlanError('planCpfpChild: cannot size the child for this script type; pass childVbytes');
    }
    const cBytes = explicitChild ? Number(childVbytes) : scriptKind.vbytes;

    // Package fee must reach feeRate over parent + child; the child carries
    // whatever the parent is short, and never less than feeRate on its own.
    const packageBytes = pBytes + cBytes;
    const roundedPackageFee = Math.ceil(rate * packageBytes);
    const roundedChildFee = Math.ceil(rate * cBytes);
    if (!Number.isSafeInteger(roundedPackageFee) || !Number.isSafeInteger(roundedChildFee)) {
        throw new CpfpPlanError('planCpfpChild: feeRate produces an inexact satoshi amount');
    }
    const packageFloor = BigInt(roundedPackageFee);
    const childFloor = BigInt(roundedChildFee);
    const shortfall = packageFloor > parentFee ? packageFloor - parentFee : 0n;
    const childFee = shortfall > childFloor ? shortfall : childFloor;
    const rules = networkRules(network);
    if (!rules.supportsSegwit && (scriptKind?.segwit || isWitnessProgram(spend.scriptPubKey))) {
        throw new CpfpPlanError('planCpfpChild: this network has no segwit, so the wallet-owned output cannot be spent');
    }
    // The child's single output must clear the chain's own dust floor.
    if (spend.value < childFee + rules.dust) {
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
