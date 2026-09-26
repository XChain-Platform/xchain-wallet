// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// envelopeRevealCheck. The confirm lane's checks on a Taproot envelope REVEAL.
//
// The commit PSBT goes through the ordinary output-set check, but the reveal is
// a second transaction the user signs on the same Approve, so it is held to the
// same standard here: it must spend the commit's envelope output, pay only the
// wallet's own addresses, and carry exactly the action the user approved.

import { sameSats } from './confirmChecks.js';
import { exactNetworkFeeSats } from './psbtNetworkFee.js';

/**
 * @typedef {Object} EnvelopeRevealVerdict
 * @property {boolean} ok
 * @property {string} [reason]   machine-readable refusal code when not ok
 */

/**
 * Check a composed envelope reveal against its commit and the approved action.
 *
 * @param {object} args
 * @param {{ inputs?: object[], outputs?: object[] }} args.commit   decomposed commit PSBT
 * @param {{ inputs?: object[], outputs?: object[] }} args.reveal   decomposed reveal PSBT
 * @param {{ commitTxid: string, commitVout: number, commitValue: number|string, commitAddress: string }} args.envelope
 * @param {Iterable<string>} args.ownAddresses   addresses the reveal may pay
 * @param {string} args.actionString             the action string the user approved
 * @param {() => { ok: boolean, actionString?: string, reason?: string }} args.decodeRevealAction
 *   reads the action the reveal's envelope leaf carries
 * @returns {EnvelopeRevealVerdict}
 */
export function checkEnvelopeReveal({ commit, reveal, envelope, ownAddresses, actionString, decodeRevealAction }) {
    const commitOutputs = Array.isArray(commit?.outputs) ? commit.outputs : [];
    const revealInputs = Array.isArray(reveal?.inputs) ? reveal.inputs : [];
    const revealOutputs = Array.isArray(reveal?.outputs) ? reveal.outputs : [];

    // The commit must fund the envelope output the recovery record names.
    const funded = commitOutputs[envelope?.commitVout];
    if (!funded || funded.address !== envelope.commitAddress || !sameSats(funded.value, envelope.commitValue)) {
        return { ok: false, reason: 'COMMIT_OUTPUT_MISMATCH' };
    }

    // The reveal spends that one output and nothing else, so it cannot pull in
    // another of the wallet's coins that the user never saw.
    if (revealInputs.length !== 1) return { ok: false, reason: 'REVEAL_INPUT_COUNT' };
    const spent = revealInputs[0];
    if (spent.prevTxHash !== envelope.commitTxid || spent.prevTxIndex !== envelope.commitVout) {
        return { ok: false, reason: 'REVEAL_SPENDS_OTHER_OUTPOINT' };
    }
    // Same value and script as the commit output, so the fee read off the
    // reveal is the fee the network will charge.
    if (!sameSats(spent.value, funded.value) || spent.scriptPubKeyHex !== funded.scriptPubKeyHex) {
        return { ok: false, reason: 'REVEAL_PREVOUT_MISMATCH' };
    }

    // Every reveal output is change back to this wallet.
    const own = new Set([...(ownAddresses || [])].filter(Boolean));
    if (revealOutputs.length === 0 || !revealOutputs.every((o) => o?.address && own.has(o.address))) {
        return { ok: false, reason: 'REVEAL_PAYS_FOREIGN_ADDRESS' };
    }

    // The action in the envelope leaf is byte for byte the approved one.
    let decoded;
    try { decoded = decodeRevealAction(); } catch { decoded = null; }
    if (!decoded?.ok || decoded.actionString !== actionString) {
        return { ok: false, reason: 'REVEAL_ACTION_MISMATCH' };
    }
    return { ok: true };
}

/**
 * The miner fee of each envelope transaction, read from the built bytes.
 *
 * @param {object} commit   decomposed commit PSBT
 * @param {object} reveal   decomposed reveal PSBT
 * @returns {{ commitFeeSats: number|null, revealFeeSats: number|null, totalFeeSats: number|null }}
 *   each NULL when that transaction's fee is not knowable, and the total NULL when either is
 */
export function envelopeNetworkFees(commit, reveal) {
    const commitFeeSats = exactNetworkFeeSats(commit);
    const revealFeeSats = exactNetworkFeeSats(reveal);
    const totalFeeSats = commitFeeSats !== null && revealFeeSats !== null
        ? commitFeeSats + revealFeeSats
        : null;
    return { commitFeeSats, revealFeeSats, totalFeeSats };
}
