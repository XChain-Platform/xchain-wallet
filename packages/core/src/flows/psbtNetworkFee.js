// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The EXACT network fee of the composed transaction.
//
// The confirm surface must show the fee of the PSBT that will broadcast, not
// a rate-table estimate: the whole point of the single-encode pipeline is that
// what the user sees is what gets signed, and the fee is part of what they are
// agreeing to. A built PSBT knows its own fee exactly - inputs minus outputs -
// so there is no reason to show a guess.
//
// Returns null rather than a wrong number when it cannot be known. An input's
// value is only present when the PSBT carries that input's witnessUtxo or the
// full previous transaction; without every input value the difference is not a
// fee, it is an underestimate. Callers fall back to their estimate and label it
// as one (§3.5.5: never prettify what you cannot verify).

/**
 * @param {{ inputs?: Array<{value?: number|null}>, outputs?: Array<{value?: number|null}> } | null} decomposed
 * @returns {number | null}   fee in the chain's smallest unit, or null if not knowable
 */
export function exactNetworkFeeSats(decomposed) {
    const inputs = Array.isArray(decomposed?.inputs) ? decomposed.inputs : null;
    const outputs = Array.isArray(decomposed?.outputs) ? decomposed.outputs : null;
    if (!inputs || !outputs || inputs.length === 0) return null;
    // Every input value must be known. A single missing one makes the
    // subtraction meaningless, so refuse rather than under-report.
    if (!inputs.every((i) => Number.isFinite(i?.value))) return null;
    if (!outputs.every((o) => Number.isFinite(o?.value))) return null;
    const totalIn = inputs.reduce((a, i) => a + Number(i.value), 0);
    const totalOut = outputs.reduce((a, o) => a + Number(o.value), 0);
    const fee = totalIn - totalOut;
    // A negative fee is impossible in a well-formed tx; treat it as unknown
    // rather than rendering nonsense on a signing screen.
    return fee >= 0 ? fee : null;
}

// On the P2SH/P2WSH chunk lanes an action is TWO transactions, and
// `exactNetworkFeeSats` above can only ever see the first one. Measured
// on-chain (wallet E2E session 20, BET market #1160): the confirm screen said
// 0.00000546 BTC and the chain took 0.00001092, because the funding tx paid
// 546 sats of miner fee AND created a 546-sat carrier output which the reveal
// then spent in full. The screen quoted one transaction's fee for a
// two-transaction action.
//
// The encoder states the invariant this relies on (XChainEncoder.js, the
// two-tx flow note): "the reveal's only inputs are these funding outputs, so
// the funding outputs must carry enough value for the reveal to pay both its
// miner fee and those reveal-side customOutputs". So every satoshi placed in a
// carrier output leaves the wallet, split between the reveal's miner fee and
// the reveal-side outputs (today: the native-coin protocol fee). The reveal
// therefore contributes `carrierTotal - revealOutputSats` of MINER fee.
//
// Identifying carriers is the one subtle part. `scriptType` alone is not
// enough: an output paying a p2sh-p2wpkh CHANGE address also classifies as
// 'p2sh' (decomposePsbt classifies outputs with no redeemScript to hand), so
// keying on the type alone would count the user's own change as a carrier and
// overstate the fee. Carriers are the chunk outputs, which never pay an
// address the wallet owns, and the encoder tells us exactly how many it
// committed to. When those two facts disagree we return null and let the
// caller fall back to a labelled estimate, per this module's standing rule of
// refusing rather than reporting a wrong number on a signing screen.

/**
 * Total MINER fee an action pays across every transaction it takes, which on
 * the chunk lanes is two rather than one.
 *
 * @param {{ inputs?: Array<{value?: number|null}>, outputs?: Array<{value?: number|null, address?: string|null, scriptType?: string}> } | null} decomposed
 * @param {object} [opts]
 * @param {string[]} [opts.carrierScripts]   redeem scripts create_tx committed to; [] off the chunk lanes
 * @param {Iterable<string>} [opts.ownAddresses]  addresses the wallet controls, so change is not mistaken for a carrier
 * @param {number} [opts.revealOutputSats]   TOTAL value the reveal re-emits as outputs - the whole deferred set (protocol fee, oracle usage fee, ADS donation, native payment), not the protocol fee alone - so it is not counted as miner fee
 * @returns {number | null}  fee in the chain's smallest unit, or null if not knowable
 */
export function totalNetworkFeeSats(decomposed, {
    carrierScripts = [],
    ownAddresses = [],
    revealOutputSats = 0,
} = {}) {
    const fundingFee = exactNetworkFeeSats(decomposed);
    if (fundingFee === null) return null;
    // Single-transaction lanes (OP_RETURN, MULTISIGN) are unchanged: no
    // carriers, so the funding fee IS the whole fee.
    const carrierCount = Array.isArray(carrierScripts) ? carrierScripts.length : 0;
    if (carrierCount === 0) return fundingFee;

    const own = new Set([...ownAddresses].filter(Boolean));
    const carriers = (decomposed.outputs || []).filter((o) => (
        (o?.scriptType === 'p2sh' || o?.scriptType === 'p2wsh')
        && !(o?.address && own.has(o.address))
    ));
    // The encoder committed to a known number of chunks. A different count
    // means our identification is wrong, not that the fee is different.
    if (carriers.length !== carrierCount) return null;
    if (!carriers.every((o) => Number.isFinite(o?.value))) return null;

    const carrierTotal = carriers.reduce((a, o) => a + Number(o.value), 0);
    const revealFee = carrierTotal - Number(revealOutputSats || 0);
    if (!Number.isFinite(revealFee) || revealFee < 0) return null;
    return fundingFee + revealFee;
}
