// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the sign-transaction approval lists the dApp's signing paths as text,
// never as "[object Object]".

import { describe, expect, it } from 'vitest';
import { signingPathLines } from '../../../packages/extension/src/approval/signingPathLines.js';

describe('signingPathLines', () => {
    it('shows the input index and the address for an address path', () => {
        expect(signingPathLines([{ inputIndex: 0, address: 'bc1qexample' }])).toEqual(['0: bc1qexample']);
    });

    it('shows a derivation path and a sighash type when the request names them', () => {
        expect(signingPathLines([{ inputIndex: 2, derivationPath: "m/84'/0'/0'/0/1", sighashType: 1 }]))
            .toEqual(["2: m/84'/0'/0'/0/1 (sighash 1)"]);
    });

    it('never prints an object as text', () => {
        const lines = signingPathLines([{ inputIndex: 0, address: 'a' }, { inputIndex: 1 }, 'plain']);
        expect(lines.join('\n')).not.toMatch(/\[object/);
        expect(lines).toEqual(['0: a', '1:', 'plain']);
    });

    it('strips control and bidi characters the page supplied', () => {
        const [line] = signingPathLines([{ inputIndex: 0, address: 'bc1q‮evil\nline' }]);
        expect(line).not.toMatch(/[‮\n]/);
    });

    it('returns nothing for a missing list', () => {
        expect(signingPathLines(undefined)).toEqual([]);
    });
});
