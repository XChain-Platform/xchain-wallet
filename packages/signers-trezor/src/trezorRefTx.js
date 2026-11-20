// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Maps the SDK's PrevTxInfo onto Connect's RefTransaction. The SDK names the
// lock field `locktime`; Connect asserts `lock_time` on every refTx it is
// given as an object, so the SDK object is never forwarded as-is. Only the
// fields Connect reads are copied, and a malformed lock time, version or
// list is refused here: a wrong lock time makes the device hash a different
// previous transaction.

/**
 * @param {import('../../core/src/signers/types.js').PrevTxInfo} info
 * @param {number} inputIndex   the spending input, for the error message
 * @returns {object}            a Connect RefTransaction
 */
export function toTrezorRefTx(info, inputIndex) {
    if (!Number.isInteger(info?.locktime) || info.locktime < 0 || info.locktime > 0xffffffff) {
        throw new Error(`toTrezorSignTransaction: input ${inputIndex} previous transaction has invalid locktime`);
    }
    if (typeof info?.version !== 'number' || !Number.isFinite(info.version)) {
        throw new Error(`toTrezorSignTransaction: input ${inputIndex} previous transaction has invalid version`);
    }
    if (!Array.isArray(info.inputs) || !Array.isArray(info.bin_outputs)) {
        throw new Error(`toTrezorSignTransaction: input ${inputIndex} previous transaction is malformed`);
    }
    return {
        hash: info.hash,
        version: info.version,
        lock_time: info.locktime,
        inputs: info.inputs.map((input) => ({
            prev_hash: input.prev_hash,
            prev_index: input.prev_index,
            script_sig: input.script_sig,
            sequence: input.sequence,
        })),
        bin_outputs: info.bin_outputs.map((output) => ({
            amount: String(output.amount),
            script_pubkey: output.script_pubkey,
        })),
    };
}
