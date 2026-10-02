// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Check the P2SH/P2WSH reveal's inputs before signing. The encoder spends only
// the commit's data legs and the software signer signs every input it is given,
// so any other input is coin the reveal must not move.

/** The script type every data leg of each two-phase encoding pays to. */
const LEG_SCRIPT_TYPE = Object.freeze({ P2SH: 'p2sh', P2WSH: 'p2wsh' });

/**
 * Thrown before the reveal is signed when one of its inputs is not a data leg
 * of the commit just broadcast. The commit is on chain by then, so the error
 * carries what a later clean reveal needs to spend its legs.
 */
export class RevealInputsRefusedError extends Error {
    /**
     * @param {{ reason: string, inputIndex: number | null, phase1Txid: string,
     *   phase1TxHex: string, chainId: string, encoding: string }} fields
     */
    constructor({ reason, inputIndex, phase1Txid, phase1TxHex, chainId, encoding }) {
        super(`The revealing transaction built for this ${encoding} action was not signed: `
            + `${inputIndex === null ? 'it' : `its input ${inputIndex}`} ${reason}. The commit `
            + `${phase1Txid} is on chain and its data outputs stay unspent until a revealing `
            + 'transaction that spends only them is signed.');
        this.name = 'RevealInputsRefusedError';
        this.code = 'REVEAL_INPUTS_REFUSED';
        this.userFacing = true;
        this.phase = 'phase2';
        this.reason = reason;
        this.inputIndex = inputIndex;
        this.phase1Txid = phase1Txid;
        this.phase1TxHex = phase1TxHex;
        this.chainId = chainId;
        this.encoding = encoding;
    }
}

/**
 * Why a reveal's inputs are refused, or null when each one spends a distinct
 * data leg of the commit. Inputs and outputs are `decomposePsbt` shapes: an
 * input names its outpoint (`prevTxHash` in display order, `prevTxIndex`) and
 * the script type it unlocks; a commit output names the script type it pays.
 *
 * @param {{ revealInputs: unknown, phase1Outputs: unknown, phase1Txid: string, encoding: string }} args
 * @returns {{ reason: string, inputIndex: number | null } | null}
 */
export function revealInputsRefusal({ revealInputs, phase1Outputs, phase1Txid, encoding }) {
    const legType = LEG_SCRIPT_TYPE[/** @type {keyof typeof LEG_SCRIPT_TYPE} */ (encoding)];
    if (!legType) return { reason: `uses an encoding with no data legs (${encoding})`, inputIndex: null };
    if (!Array.isArray(revealInputs) || revealInputs.length === 0) {
        return { reason: 'could not be read as a set of inputs', inputIndex: null };
    }
    const outputs = Array.isArray(phase1Outputs) ? phase1Outputs : [];
    const commitTxid = String(phase1Txid || '').toLowerCase();
    const spent = new Set();
    for (let i = 0; i < revealInputs.length; i += 1) {
        const input = revealInputs[i] || {};
        const txid = typeof input.prevTxHash === 'string' ? input.prevTxHash.toLowerCase() : '';
        if (!commitTxid || txid !== commitTxid) return { reason: 'spends coin from outside the commit', inputIndex: i };
        const vout = input.prevTxIndex;
        if (!Number.isInteger(vout) || spent.has(vout)) return { reason: 'names no single commit output', inputIndex: i };
        spent.add(vout);
        if (outputs[vout]?.scriptType !== legType) return { reason: 'spends a commit output that is not a data leg', inputIndex: i };
        // A nested-segwit change output also pays P2SH; its input unlocks a key, not data
        if (input.scriptType !== legType) return { reason: 'unlocks a key script, not a data script', inputIndex: i };
    }
    return null;
}

/**
 * Refuse, before signing, a reveal whose inputs are not all data legs of the
 * commit. A reveal that cannot be decomposed is refused the same way.
 *
 * @param {{ decomposePsbt: (hex: string) => { inputs: unknown }, revealPsbtHex: string,
 *   phase1Outputs: unknown, phase1Txid: string, phase1TxHex: string, chainId: string, encoding: string }} args
 */
export function assertRevealSpendsCommitLegs({
    decomposePsbt, revealPsbtHex, phase1Outputs, phase1Txid, phase1TxHex, chainId, encoding,
}) {
    let revealInputs = null;
    try { revealInputs = decomposePsbt(revealPsbtHex).inputs; } catch { revealInputs = null; }
    const refusal = revealInputsRefusal({ revealInputs, phase1Outputs, phase1Txid, encoding });
    if (refusal) throw new RevealInputsRefusedError({ ...refusal, phase1Txid, phase1TxHex, chainId, encoding });
}
