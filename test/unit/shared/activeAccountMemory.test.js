// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: per-wallet active-account memory round-trip. localStorage is
// provided by the jsdom test environment.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    readActiveAccount,
    writeActiveAccount,
    clearActiveAccount,
} from '../../../packages/core/src/shared/utils/activeAccountMemory.js';

describe('activeAccountMemory', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns null when nothing is stored', () => {
        expect(readActiveAccount('wallet-1')).toBe(null);
    });

    it('persists and reads back the active account per wallet', () => {
        writeActiveAccount('wallet-1', 'acct-9');
        writeActiveAccount('wallet-2', 'acct-3');
        expect(readActiveAccount('wallet-1')).toBe('acct-9');
        expect(readActiveAccount('wallet-2')).toBe('acct-3');
    });

    it('clears a wallet entry', () => {
        writeActiveAccount('wallet-1', 'acct-9');
        clearActiveAccount('wallet-1');
        expect(readActiveAccount('wallet-1')).toBe(null);
    });

    it('ignores missing wallet id or account id', () => {
        writeActiveAccount('', 'acct-9');
        writeActiveAccount('wallet-1', '');
        expect(readActiveAccount('')).toBe(null);
        expect(readActiveAccount('wallet-1')).toBe(null);
    });
});
