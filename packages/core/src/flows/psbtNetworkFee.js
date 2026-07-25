// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §5.2.5: the EXACT network fee of the composed transaction.
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
