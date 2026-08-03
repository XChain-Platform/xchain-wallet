// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: active-WALLET memory round-trip (D-34c). The twin of
// activeAccountMemory one level up. localStorage comes from the jsdom test
// environment.
//
// The module is the easy half; the hard half was that only one of three shells
// used it, which `test/smoke/shells/active-wallet-memory-parity.smoke.js`
// covers. What matters here is the contract that smoke leans on: reads are
// hint-only (the caller validates the id against the live wallet list), and
// nothing throws where localStorage is unavailable, because two of the three
// shells run in environments where it can be.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    readActiveWallet,
    writeActiveWallet,
    clearActiveWallet,
} from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

describe('activeWalletMemory', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when nothing is stored', () => {
        expect(readActiveWallet()).toBe(null);
    });

    it('persists and reads back the active wallet', () => {
        writeActiveWallet('wallet-2');
        expect(readActiveWallet()).toBe('wallet-2');
    });

    it('the last write wins, because there is exactly one active wallet', () => {
        writeActiveWallet('wallet-1');
        writeActiveWallet('wallet-2');
        expect(readActiveWallet()).toBe('wallet-2');
    });

    it('clears the entry', () => {
        writeActiveWallet('wallet-1');
        clearActiveWallet();
        expect(readActiveWallet()).toBe(null);
    });

    it('ignores an empty or non-string id rather than storing a falsy marker', () => {
        writeActiveWallet('wallet-1');
        writeActiveWallet('');
        writeActiveWallet(null);
        writeActiveWallet(undefined);
        // A stored empty string would read back as null anyway, but it would
        // also have DESTROYED the real selection on the way in.
        expect(readActiveWallet()).toBe('wallet-1');
    });

    it('survives a localStorage that throws, in all three directions', () => {
        // Safari private mode, a blocked third-party context, a desktop
        // renderer with storage partitioned off. The selection is a UI
        // convenience; losing it must never take the app down with it.
        const boom = () => { throw new Error('storage disabled'); };
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

        expect(() => writeActiveWallet('wallet-1')).not.toThrow();
        expect(readActiveWallet()).toBe(null);
        expect(() => clearActiveWallet()).not.toThrow();
    });
});
