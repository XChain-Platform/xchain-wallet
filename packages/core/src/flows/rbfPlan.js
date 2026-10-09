// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export class RbfPlanError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RbfPlanError';
    }
}

const RBF_SEQUENCE_LIMIT = 0xfffffffe;
const DEFAULT_INCREMENT_SATS = 1000n;

function sats(value, label) {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    throw new RbfPlanError(`planRbfReplacement: ${label} must be an exact non-negative satoshi amount`);
}

function txShape(value, label) {
    if (!value || !Array.isArray(value.inputs) || value.inputs.length === 0) {
        throw new RbfPlanError(`planRbfReplacement: ${label}.inputs must be a non-empty array`);
    }
    if (!Array.isArray(value.outputs) || value.outputs.length === 0) {
        throw new RbfPlanError(`planRbfReplacement: ${label}.outputs must be a non-empty array`);
    }
    const inputs = value.inputs.map((input, index) => {
        const txid = String(input?.prevTxHash || input?.txid || '').toLowerCase();
        const vout = Number(input?.prevTxIndex ?? input?.vout);
        const scriptPubKey = String(input?.scriptPubKeyHex || input?.scriptPubKey || '');
        if (!/^[0-9a-f]{64}$/.test(txid)) {
            throw new RbfPlanError(`planRbfReplacement: ${label}.inputs[${index}] has an invalid txid`);
        }
        if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
            throw new RbfPlanError(`planRbfReplacement: ${label}.inputs[${index}] has an invalid vout`);
        }
        if (!/^(?:[0-9a-fA-F]{2})+$/.test(scriptPubKey)) {
            throw new RbfPlanError(`planRbfReplacement: ${label}.inputs[${index}] has no usable scriptPubKey`);
        }
        return {
            txid,
            vout,
            value: sats(input?.value, `${label}.inputs[${index}].value`),
            scriptPubKey: scriptPubKey.toLowerCase(),
            confirmations: 0,
            sequence: Number(input?.sequence),
        };
    });
    const outputs = value.outputs.map((output, index) => ({
        address: typeof output?.address === 'string' && output.address ? output.address : null,
        value: sats(output?.value, `${label}.outputs[${index}].value`),
        scriptType: String(output?.scriptType || '').toLowerCase(),
        scriptPubKey: String(output?.scriptPubKeyHex || '').toLowerCase(),
    }));
    return { inputs, outputs };
}

function sumValues(rows) {
    return rows.reduce((sum, row) => sum + row.value, 0n);
}

function sameOutpoints(left, right) {
    if (left.length !== right.length) return false;
    return left.every((input, index) => (
        input.txid === right[index].txid && input.vout === right[index].vout
    ));
}

function replacementFee({ originalFee, feeRate, transactionBytes }) {
    const bytes = Number(transactionBytes);
    const byteIncrement = Number.isSafeInteger(bytes) && bytes > 0 ? BigInt(bytes) : 0n;
    const proportional = originalFee / 4n;
    const increment = proportional > DEFAULT_INCREMENT_SATS
        ? (proportional > byteIncrement ? proportional : byteIncrement)
        : (DEFAULT_INCREMENT_SATS > byteIncrement ? DEFAULT_INCREMENT_SATS : byteIncrement);
    const minimum = originalFee + increment;
    if (feeRate === undefined || feeRate === null || feeRate === '') return minimum;
    const rate = typeof feeRate === 'number' ? feeRate : Number(String(feeRate).trim());
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new RbfPlanError('planRbfReplacement: feeRate must be a positive satoshi-per-vbyte rate');
    }
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new RbfPlanError('planRbfReplacement: transactionBytes is required with feeRate');
    }
    const roundedRateFee = Math.ceil(rate * bytes);
    if (!Number.isSafeInteger(roundedRateFee)) {
        throw new RbfPlanError('planRbfReplacement: feeRate produces an inexact satoshi amount');
    }
    const rateFee = BigInt(roundedRateFee);
    if (rateFee <= originalFee) {
        throw new RbfPlanError('planRbfReplacement: feeRate does not increase the original transaction fee');
    }
    return rateFee > minimum ? rateFee : minimum;
}

function wireAmount(value) {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : String(value);
}

/**
 * Build exact-input encoder options for a BIP-125 replacement.
 *
 * `conflict` is the transaction being evicted. `template` is the payment being
 * reproduced, and differs only for restore: the cancel is the conflict while
 * the pre-cancel spend is the template.
 *
 * @param {object} opts
 * @param {'speedup'|'cancel'|'restore'} opts.strategy
 * @param {import('../signers/types.js').DecomposedPsbt} opts.conflict
 * @param {import('../signers/types.js').DecomposedPsbt} [opts.template]
 * @param {string} opts.sourceAddress
 * @param {string[]} [opts.ownAddresses]
 * @param {string|number} [opts.feeRate]
 * @param {number} [opts.transactionBytes]
 * @returns {{ encoderOpts: object, originalFeeSats: string, replacementFeeSats: string, feeIncreaseSats: string }}
 */
export function planRbfReplacement({
    strategy,
    conflict,
    template = conflict,
    sourceAddress,
    ownAddresses = [sourceAddress],
    feeRate,
    transactionBytes,
} = {}) {
    if (!['speedup', 'cancel', 'restore'].includes(strategy)) {
        throw new RbfPlanError(`planRbfReplacement: unknown strategy "${String(strategy)}"`);
    }
    if (typeof sourceAddress !== 'string' || !sourceAddress) {
        throw new RbfPlanError('planRbfReplacement: sourceAddress is required');
    }
    const conflictTx = txShape(conflict, 'conflict');
    const templateTx = txShape(template, 'template');
    if (conflictTx.inputs.some((input) => !Number.isInteger(input.sequence)
        || input.sequence >= RBF_SEQUENCE_LIMIT)) {
        throw new RbfPlanError('planRbfReplacement: conflict transaction did not signal replaceability');
    }
    if (strategy === 'restore' && !sameOutpoints(conflictTx.inputs, templateTx.inputs)) {
        throw new RbfPlanError('planRbfReplacement: restore transaction does not spend the cancel inputs');
    }

    const inputTotal = sumValues(conflictTx.inputs);
    const outputTotal = sumValues(conflictTx.outputs);
    if (outputTotal >= inputTotal) {
        throw new RbfPlanError('planRbfReplacement: conflict transaction has no readable positive fee');
    }
    const originalFee = inputTotal - outputTotal;
    const fee = replacementFee({ originalFee, feeRate, transactionBytes });
    if (fee >= inputTotal) {
        throw new RbfPlanError('planRbfReplacement: replacement fee consumes every input');
    }

    const utxos = conflictTx.inputs.map(({ txid, vout, value, scriptPubKey, confirmations }) => ({
        txid, vout, value: wireAmount(value), scriptPubKey, confirmations,
    }));
    let customOutputs;
    let change = sourceAddress;
    if (strategy === 'cancel') {
        customOutputs = [{ address: sourceAddress, value: wireAmount(inputTotal - fee) }];
    } else {
        const owned = new Set(Array.isArray(ownAddresses) ? ownAddresses.filter(Boolean) : []);
        owned.add(sourceAddress);
        let changeIndex = -1;
        for (let i = templateTx.outputs.length - 1; i >= 0; i -= 1) {
            if (owned.has(templateTx.outputs[i].address)) {
                changeIndex = i;
                change = templateTx.outputs[i].address;
                break;
            }
        }
        if (changeIndex < 0) {
            throw new RbfPlanError('planRbfReplacement: template has no wallet change output to fund the fee bump');
        }
        customOutputs = templateTx.outputs.flatMap((output, index) => {
            if (index === changeIndex) return [];
            if (output.address) return [{ address: output.address, value: wireAmount(output.value) }];
            if (output.value === 0n
                && (output.scriptType === 'nulldata' || output.scriptPubKey.startsWith('6a'))) return [];
            throw new RbfPlanError(`planRbfReplacement: template output ${index} cannot be reproduced safely`);
        });
        const fixedOutputs = sumValues(templateTx.outputs.filter((_output, index) => index !== changeIndex));
        if (fixedOutputs + fee > inputTotal) {
            throw new RbfPlanError('planRbfReplacement: change output cannot cover the replacement fee');
        }
    }

    return {
        encoderOpts: {
            change,
            utxos,
            customOutputs,
            fee: wireAmount(fee),
            rbf: true,
            unconfirmed: true,
            options: { exactInputs: true },
        },
        originalFeeSats: String(originalFee),
        replacementFeeSats: String(fee),
        feeIncreaseSats: String(fee - originalFee),
    };
}
