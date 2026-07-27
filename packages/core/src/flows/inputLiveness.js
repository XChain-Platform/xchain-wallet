// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Input liveness ( §4.6, ).
//
// §4.6 has said since v3 that the Approve-time re-check "also validates the
// held PSBT's inputs are still unspent (utxo query); spent inputs ⇒ interrupt
// with a re-compose path". Only the pre-flight half of that re-check was ever
// built: a confirm page held open past a competing spend would sign a PSBT
// whose inputs were gone and fail at broadcast, which is the permanent-failure
// terminal §5.3.4 forbids re-signing out of.
//
// It matters twice over for a RESUMED confirm (§5.4): a stored session is by
// construction older than the one on screen, so it is the likeliest holder of
// a dead outpoint, and resuming one is the double-broadcast trap the store's
// `clear` contract is written against.
//
// FAILS TO UNKNOWN, NEVER TO SPENT. A false "your inputs are gone" is a hard
// block on an action the network would accept, which §4.2's false-block
// invariant forbids, so every path that cannot positively observe an outpoint
// - unresolvable input address, failed or empty utxo fetch, an address the
// caller could not query - lands in `unknown` and the caller treats it as
// unverified rather than as an interrupt. Only an outpoint whose OWN address
// answered with a utxo set that does not contain it counts as spent.

/**
 * @typedef {{ prevTxHash: string, prevTxIndex: number, address: string|null }} PsbtInputRef
 * @typedef {{ txid: string, vout: number }} Outpoint
 * @typedef {{ verdict: 'live'|'spent'|'unknown', spent: Outpoint[], unknown: Outpoint[] }} LivenessResult
 */

const outpointKey = (txid, vout) => `${String(txid).toLowerCase()}:${Number(vout)}`;

/**
 * Compare a PSBT's inputs against freshly-fetched utxo sets, one per address.
 *
 * `utxosByAddress` carries only the addresses that ANSWERED. An address that
 * threw, timed out, or was never queried must be absent from the map rather
 * than present-and-empty: present-and-empty is the legitimate "this address
 * has nothing left" answer and is what proves an input spent, so conflating
 * the two is exactly the false block this module fails to unknown to avoid.
 *
 * @param {object} args
 * @param {PsbtInputRef[]} args.inputs
 * @param {Record<string, Array<{ txid: string, vout: number }>>} args.utxosByAddress
 * @returns {LivenessResult}
 */
export function checkInputLiveness({ inputs, utxosByAddress }) {
    const spent = /** @type {Outpoint[]} */ ([]);
    const unknown = /** @type {Outpoint[]} */ ([]);

    const live = new Map();
    for (const [address, utxos] of Object.entries(utxosByAddress || {})) {
        const keys = new Set();
        for (const u of Array.isArray(utxos) ? utxos : []) {
            if (u && u.txid != null && u.vout != null) keys.add(outpointKey(u.txid, u.vout));
        }
        live.set(address, keys);
    }

    for (const input of Array.isArray(inputs) ? inputs : []) {
        if (!input) continue;
        const point = { txid: String(input.prevTxHash || ''), vout: Number(input.prevTxIndex) };
        if (!point.txid || !Number.isInteger(point.vout) || point.vout < 0) {
            unknown.push(point);
            continue;
        }
        // An input whose scriptPubKey did not decode to an address cannot be
        // attributed to a utxo set, so nothing about it is observable here.
        if (!input.address || !live.has(input.address)) {
            unknown.push(point);
            continue;
        }
        if (!live.get(input.address).has(outpointKey(point.txid, point.vout))) {
            spent.push(point);
        }
    }

    // A single dead outpoint is enough to kill the transaction, so `spent`
    // outranks `unknown`: there is no point reporting a partially-verified set
    // when one member is already proven gone.
    const verdict = spent.length > 0 ? 'spent' : unknown.length > 0 ? 'unknown' : 'live';
    return { verdict, spent, unknown };
}

/**
 * The distinct, resolvable input addresses of a decomposed PSBT - the set the
 * host has to query to answer `checkInputLiveness`.
 *
 * @param {PsbtInputRef[]} inputs
 * @returns {string[]}
 */
export function inputAddresses(inputs) {
    const out = new Set();
    for (const input of Array.isArray(inputs) ? inputs : []) {
        if (input && typeof input.address === 'string' && input.address) out.add(input.address);
    }
    return [...out];
}

/**
 * User-facing sentence for a `spent` verdict. The re-compose instruction is
 * part of the message rather than a separate hint because §5.3.4 forbids
 * re-signing this PSBT: the only way forward is a new one.
 *
 * @param {LivenessResult} result
 * @returns {string}
 */
export function livenessMessage(result) {
    const n = result?.spent?.length || 0;
    if (n === 0) return '';
    return n === 1
        ? 'One of the coins this transaction spends has already been used. Start over to build a new one.'
        : `${n} of the coins this transaction spends have already been used. Start over to build a new one.`;
}
