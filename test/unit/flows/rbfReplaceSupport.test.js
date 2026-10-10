// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { isReplaceCallAvailable } from '../../../packages/core/src/flows/rbfReplace.js';

describe('isReplaceCallAvailable', () => {
    it.each([
        ['no messaging module', undefined],
        ['a null messaging module', null],
        ['a module without replaceTx', {}],
        ['a non-callable replaceTx member', { replaceTx: true }],
    ])('refuses %s', (_name, messaging) => {
        expect(isReplaceCallAvailable(messaging)).toBe(false);
    });

    it('accepts a shell that exposes replaceTx', () => {
        expect(isReplaceCallAvailable({ replaceTx() {} })).toBe(true);
    });

    it('refuses a shell-shaped module that exposes other calls but not replaceTx', () => {
        const messaging = {
            getAddressHistory() {},
            getAddressMempool() {},
            getPendingTxsForAddress() {},
        };
        expect(isReplaceCallAvailable(messaging)).toBe(false);
    });
});
