// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bench scenario: formatAmount throughput. Renders 100K rows worth of
// number formatting per iteration.

function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) return groupThousands(q);
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    let frac = padded.slice(padded.length - divisibility);
    frac = frac.replace(/0+$/, '');
    const out = frac ? `${groupThousands(whole)}.${frac}` : groupThousands(whole);
    return negative ? `-${out}` : out;
}
function groupThousands(s) {
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export async function runScenario(run) {
    return [
        await run('format-amount-100k-rows', async () => {
            for (let i = 0; i < 100_000; i += 1) {
                formatAmount('1234567890123456', 8);
            }
        }, 5),
    ];
}
