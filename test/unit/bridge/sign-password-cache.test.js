// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: Developer-Mode localhost auto-sign primitives (Cluster Q FOLLOWUP 3).
//   - shouldAutoApproveSign: the gate deciding whether a sign request may
//     reuse a session-cached password instead of prompting.
//   - createSignPasswordCache: the SW-memory password cache with TTL.

import { describe, it, expect } from 'vitest';
import { shouldAutoApproveSign } from '../../../packages/core/src/shared/utils/originAutoApprove.js';
import { createSignPasswordCache } from '../../../packages/extension/src/bridge/signPasswordCache.js';
import {
    AUTO_SIGN_LOCALHOST_OFF,
    AUTO_SIGN_LOCALHOST_5M,
    AUTO_SIGN_LOCALHOST_1H,
    AUTO_SIGN_LOCALHOST_OPTIONS,
    validateSettings,
    createDefaultSettings,
} from '../../../packages/core/src/schemas/settings.js';

const ON = { developerMode: true, autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M };

describe('shouldAutoApproveSign: all gates must line up', () => {
    it('is true for a localhost origin with dev mode + a positive timeout', () => {
        expect(shouldAutoApproveSign({ origin: 'http://localhost:5173', settings: ON })).toBe(true);
        expect(shouldAutoApproveSign({ origin: 'http://127.0.0.1:8080', settings: ON })).toBe(true);
        expect(shouldAutoApproveSign({ origin: 'http://[::1]:3000', settings: ON })).toBe(true);
        expect(shouldAutoApproveSign({ origin: 'https://localhost', settings: ON })).toBe(true);
    });

    it('is false without settings', () => {
        expect(shouldAutoApproveSign({ origin: 'http://localhost', settings: null })).toBe(false);
        expect(shouldAutoApproveSign({ origin: 'http://localhost', settings: undefined })).toBe(false);
    });

    it('is false when Developer Mode is off, even with a timeout set', () => {
        expect(shouldAutoApproveSign({
            origin: 'http://localhost',
            settings: { developerMode: false, autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M },
        })).toBe(false);
    });

    it('is false when the timeout is off / absent / non-positive (default posture)', () => {
        expect(shouldAutoApproveSign({ origin: 'http://localhost', settings: { developerMode: true } })).toBe(false);
        expect(shouldAutoApproveSign({
            origin: 'http://localhost',
            settings: { developerMode: true, autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_OFF },
        })).toBe(false);
        expect(shouldAutoApproveSign({
            origin: 'http://localhost',
            settings: { developerMode: true, autoSignLocalhostMs: -1 },
        })).toBe(false);
        expect(shouldAutoApproveSign({
            origin: 'http://localhost',
            settings: { developerMode: true, autoSignLocalhostMs: 'lots' },
        })).toBe(false);
    });

    it('is false for a non-localhost origin regardless of settings', () => {
        expect(shouldAutoApproveSign({ origin: 'https://evil.example', settings: ON })).toBe(false);
        expect(shouldAutoApproveSign({ origin: 'http://localhost.evil.com', settings: ON })).toBe(false);
        expect(shouldAutoApproveSign({ origin: 'file:///etc/passwd', settings: ON })).toBe(false);
        expect(shouldAutoApproveSign({ origin: '', settings: ON })).toBe(false);
    });

    it('is independent of the connect auto-approve toggle', () => {
        // autoApproveLocalhost governs connect; auto-sign must not require it.
        expect(shouldAutoApproveSign({
            origin: 'http://localhost',
            settings: { developerMode: true, autoApproveLocalhost: false, autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_1H },
        })).toBe(true);
    });
});

describe('createSignPasswordCache: remember / recall / expiry', () => {
    it('recalls a remembered credential within the TTL', () => {
        const cache = createSignPasswordCache();
        cache.remember('wallet-1', { password: 'hunter2', bip39Passphrase: 'extra' }, AUTO_SIGN_LOCALHOST_5M);
        expect(cache.recall('wallet-1')).toEqual({ password: 'hunter2', bip39Passphrase: 'extra' });
        expect(cache.size).toBe(1);
    });

    it('returns null for an unknown wallet', () => {
        const cache = createSignPasswordCache();
        expect(cache.recall('nope')).toBe(null);
    });

    it('expires and evicts once the TTL elapses', () => {
        let t = 1_000;
        const cache = createSignPasswordCache({ now: () => t });
        cache.remember('w', { password: 'pw' }, 5_000); // expiresAt = 6_000
        t = 5_999;
        expect(cache.recall('w')).toEqual({ password: 'pw', bip39Passphrase: undefined });
        t = 6_000; // exactly at expiry counts as expired
        expect(cache.recall('w')).toBe(null);
        // The expired entry was evicted, not just hidden.
        expect(cache.size).toBe(0);
    });

    it('a later remember refreshes the expiry window', () => {
        let t = 0;
        const cache = createSignPasswordCache({ now: () => t });
        cache.remember('w', { password: 'a' }, 100); // expiresAt 100
        t = 90;
        cache.remember('w', { password: 'b' }, 100); // expiresAt 190
        t = 150;
        expect(cache.recall('w')).toEqual({ password: 'b', bip39Passphrase: undefined });
    });

    it('is a no-op for missing walletId / password / non-positive TTL', () => {
        const cache = createSignPasswordCache();
        cache.remember('', { password: 'pw' }, 1000);
        cache.remember('w', { password: '' }, 1000);
        cache.remember('w', null, 1000);
        cache.remember('w', { password: 'pw' }, 0);
        cache.remember('w', { password: 'pw' }, -5);
        cache.remember('w', { password: 'pw' }, NaN);
        expect(cache.size).toBe(0);
        expect(cache.recall('w')).toBe(null);
    });

    it('forget drops one entry; clear drops all', () => {
        const cache = createSignPasswordCache();
        cache.remember('a', { password: 'pa' }, 1000);
        cache.remember('b', { password: 'pb' }, 1000);
        cache.forget('a');
        expect(cache.recall('a')).toBe(null);
        expect(cache.recall('b')).not.toBe(null);
        cache.clear();
        expect(cache.size).toBe(0);
        expect(cache.recall('b')).toBe(null);
    });
});

describe('settings schema: autoSignLocalhostMs is v2-tolerant + option-bounded', () => {
    it('accepts each allowed option and a wallet with the field absent', () => {
        const base = createDefaultSettings();
        // Field absent = off = valid (default settings never set it).
        expect(base.autoSignLocalhostMs).toBeUndefined();
        expect(validateSettings(base).ok).toBe(true);
        for (const ms of AUTO_SIGN_LOCALHOST_OPTIONS) {
            expect(validateSettings({ ...base, autoSignLocalhostMs: ms }).ok).toBe(true);
        }
    });

    it('rejects a value outside the allowed set', () => {
        const base = createDefaultSettings();
        const res = validateSettings({ ...base, autoSignLocalhostMs: 7 * 60 * 1000 });
        expect(res.ok).toBe(false);
        expect(JSON.stringify(res.errors)).toMatch(/autoSignLocalhostMs/);
    });
});
