// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Receive request inputs.
//
//   [P1] 2026-10-23: A fifth typed digit read the field's own group mark as a
//        decimal point, so 1000000 became 1.0000.
//   [P2] 2026-10-23: An address label longer than the URI label limit went
//        into the payment request whole, giving a code the wallet's own
//        parser refuses or that cannot be drawn.

// Regression suite: Receive request inputs.
//
//   [P1] 2026-10-23: An address label longer than the URI label limit went
//        into the payment request whole, giving a code the wallet's own
//        parser refuses or that cannot be drawn.
//   [P2] 2026-10-23: A typed leading decimal mark was dropped, so .5 read as 5.

import { describe, expect, it } from 'vitest';
import { requestLabelFor, withLeadingZero } from '../../packages/core/src/shared/routes/Receive.jsx';
import { parseBip21Uri, encodeBip21Uri } from '../../packages/core/src/uri/index.js';

describe('the label a request carries', () => {
    it('stays inside the limit the parser enforces', () => {
        const label = requestLabelFor('é'.repeat(900));
        expect(label.length).toBeLessThanOrEqual(250);
        const uri = encodeBip21Uri({ scheme: 'bitcoin', address: 'bc1qxyz', label });
        expect(parseBip21Uri(uri).label).toBe(label);
    });

    it('cuts on a whole character and drops control characters', () => {
        expect(requestLabelFor('😀'.repeat(200))).toBe('😀'.repeat(125));
        expect(requestLabelFor('a\u0000b')).toBe('a b');
        expect(requestLabelFor('')).toBe('');
    });
});

describe('a typed leading decimal mark', () => {
    it('becomes a zero whole part', () => {
        expect(withLeadingZero('.5')).toBe('0.5');
        expect(withLeadingZero('.')).toBe('0.');
        expect(withLeadingZero('1.5')).toBe('1.5');
    });
});
