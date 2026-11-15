// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// Dev-shell stand-in for the SDK's action serializer. SEND-shaped by default
// (ACTION|0|TICK|AMOUNT|DESTINATION[|MEMO]); BROADCAST carries its own layout.
export function buildDevMockActionString(action, params) {
    const p = params || {};
    if (action === 'BROADCAST') {
        return [action, p.VERSION ?? '0', p.MESSAGE, p.VALUE, p.FEE, p.MEMO]
            .filter((f) => f != null && f !== '')
            .join('|');
    }
    const tail = [p.TICK, p.AMOUNT, p.DESTINATION];
    if (p.MEMO != null && p.MEMO !== '') tail.push(p.MEMO);
    return [action, '0', ...tail.filter((f) => f != null)].join('|');
}
