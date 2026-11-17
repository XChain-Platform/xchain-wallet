// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export function orderPieces(totalParts) {
    const parts = Array.from({ length: totalParts }, (_, index) => index);
    return ['funding', ...parts, -1];
}

function chainStateOf(chainStates, txid) {
    if (!txid) return null;
    if (chainStates instanceof Map) return chainStates.get(txid) ?? null;
    return chainStates?.[txid] ?? null;
}

function fundingPlan(record, chainStates) {
    const wave = record.wave ?? record;
    if (!wave.fundingTxid) return 'send';
    const state = chainStateOf(chainStates, wave.fundingTxid);
    if (state === 'confirmed') return 'done';
    if (state === 'dropped') return 'send';
    return 'wait';
}

function txidsOf(piece) {
    const txids = [...(Array.isArray(piece?.signedTxids) ? piece.signedTxids : [])];
    if (piece?.txid && !txids.includes(piece.txid)) txids.push(piece.txid);
    return txids;
}

function fundingOutputFor(record, index) {
    const wave = record.wave ?? record;
    const outputs = Array.isArray(wave.fundingOutputs) ? wave.fundingOutputs : [];
    const named = outputs.find((output) => (
        output?.index === index || output?.pieceIndex === index
    ));
    if (named) return named;
    const offset = wave.pieces?.findIndex((piece) => piece?.index === index) ?? -1;
    return offset >= 0 ? outputs[offset] : null;
}

function outputIsUnspent(output) {
    if (!output) return false;
    if (output.unspent === false || output.spent === true) return false;
    if (String(output.status || '').toLowerCase() === 'spent') return false;
    return true;
}

function piecePlan(piece, record, chainStates) {
    const txids = txidsOf(piece);
    if (txids.length === 0) return 'send';
    const states = txids.map((txid) => chainStateOf(chainStates, txid));
    const primaryState = chainStateOf(chainStates, piece?.txid);
    if (primaryState === 'confirmed') return 'skip';
    if (primaryState === 'mempool') return 'wait';
    if (states.some((state) => state === 'confirmed' || state === 'mempool')) return 'wait';
    if (states.every((state) => state === 'dropped')) {
        return outputIsUnspent(fundingOutputFor(record, piece.index)) ? 'send' : 'blocked';
    }
    return 'wait';
}

export function planResend({ record, chainStates }) {
    const wave = record.wave ?? record;
    const plan = {
        funding: fundingPlan(record, chainStates),
        send: [],
        skip: [],
        wait: [],
        blocked: null,
    };
    const ordered = Array.isArray(wave.pieces) ? wave.pieces : [];
    const pieces = new Map(ordered.map((piece) => [piece.index, piece]));
    for (const piece of ordered) {
        if (piece.index === -1) continue;
        const index = piece.index;
        const verdict = piecePlan(piece, record, chainStates);
        if (verdict === 'blocked') {
            plan.wait.push(index);
            plan.blocked = 'FUNDING_OUTPUT_SPENT';
        } else {
            plan[verdict].push(index);
        }
    }
    if (!record.wave && (plan.send.length > 0 || plan.blocked)) {
        plan.wait.push(-1);
        return plan;
    }
    const manifest = pieces.get(-1);
    if (!manifest) return plan;
    const manifestVerdict = piecePlan(manifest, record, chainStates);
    if (manifestVerdict === 'blocked') {
        plan.wait.push(-1);
        plan.blocked = 'FUNDING_OUTPUT_SPENT';
    } else {
        plan[manifestVerdict].push(-1);
    }
    return plan;
}
