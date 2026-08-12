// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WebView floor + direct-update check (S4).
//
// The floor tests are about the SPLIT: a missing crypto primitive must stop
// the wallet, and an old-but-working engine must not. Getting that backwards
// either strands users who can move their own coins perfectly well, or lets
// a wallet boot on an engine that cannot encrypt it.
//
// The update tests are about the feed being hostile. It is a file on a
// server, and servers get compromised; everything below asserts that the
// worst a bad feed achieves is a wrong version number in a sentence the app
// wrote itself.

import { describe, it, expect, vi } from 'vitest';
import {
    checkWebViewFloor,
    detectChromiumMajor,
    floorFailureMessage,
    floorStaleMessage,
    SOFT_MIN_CHROMIUM,
} from '../../../packages/web/src/platform/webviewFloor.js';
import {
    parseUpdateFeed,
    isNewerVersion,
    updateNoticeText,
    checkForDirectUpdate,
    setUpdateCheckEnabled,
    isUpdateCheckEnabled,
    UpdateFeedError,
    UPDATE_FEED_URL,
    UPDATE_CHECK_INTERVAL_MS,
} from '../../../packages/web/src/update/directUpdateCheck.js';

function capableEnv(overrides = {}) {
    return {
        crypto: {
            subtle: { importKey() {}, encrypt() {}, decrypt() {}, deriveBits() {} },
            getRandomValues: () => {},
        },
        indexedDB: { open() {} },
        TextEncoder: function TextEncoder() {},
        TextDecoder: function TextDecoder() {},
        BigInt: globalThis.BigInt,
        navigator: { userAgent: `Mozilla/5.0 Chrome/${SOFT_MIN_CHROMIUM + 10}.0.0.0 Mobile` },
        ...overrides,
    };
}

function memStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
    };
}

describe('WebView floor: hard tier', () => {
    it('passes a capable engine', () => {
        const report = checkWebViewFloor(capableEnv());
        expect(report.usable).toBe(true);
        expect(report.missing).toEqual([]);
        expect(report.stale).toBe(false);
    });

    it('refuses when a crypto primitive is missing', () => {
        for (const [name, env] of [
            ['crypto.subtle', capableEnv({ crypto: { getRandomValues: () => {} } })],
            ['crypto.getRandomValues', capableEnv({ crypto: { subtle: { importKey() {}, encrypt() {} } } })],
            ['indexedDB', capableEnv({ indexedDB: undefined })],
            ['BigInt', capableEnv({ BigInt: undefined })],
        ]) {
            const report = checkWebViewFloor(env);
            expect(report.usable, name).toBe(false);
            expect(report.missing).toContain(name);
        }
    });

    it('refuses a subtle object whose methods are not there', () => {
        // The shape some embedded engines ship: truthy `subtle`, no methods.
        // A truthiness check passes it and the wallet dies at the first
        // key derivation instead of at the door.
        const report = checkWebViewFloor(capableEnv({
            crypto: { subtle: {}, getRandomValues: () => {} },
        }));
        expect(report.usable).toBe(false);
        expect(report.missing).toContain('crypto.subtle');
    });

    it('names what is missing and what to do, in the failure text', () => {
        const report = checkWebViewFloor(capableEnv({ indexedDB: undefined }));
        const msg = floorFailureMessage(report);
        expect(msg).toContain('indexedDB');
        expect(msg).toMatch(/Android System WebView/);
        // The one reassurance that is actually true and actually matters.
        expect(msg).toMatch(/recovery phrase is unaffected/i);
    });
});

describe('WebView floor: soft tier', () => {
    it('warns about an old-but-capable engine without blocking it', () => {
        const report = checkWebViewFloor(capableEnv({
            navigator: { userAgent: `Mozilla/5.0 Chrome/${SOFT_MIN_CHROMIUM - 20}.0.0.0 Mobile` },
        }));
        expect(report.usable).toBe(true);
        expect(report.stale).toBe(true);
        expect(floorStaleMessage(report)).toMatch(/out of date/);
    });

    it('says nothing about an engine it cannot identify', () => {
        // Guessing "old" from an unfamiliar user agent would nag every user
        // of every engine we have not heard of, including the de-Googled
        // ROMs the direct-APK lane exists for.
        const report = checkWebViewFloor(capableEnv({
            navigator: { userAgent: 'SomeFutureEngine/9' },
        }));
        expect(report.chromium).toBeNull();
        expect(report.stale).toBe(false);
    });

    it('never marks an unusable engine stale as well', () => {
        // The user gets one message, and it is the one that blocks.
        const report = checkWebViewFloor(capableEnv({
            indexedDB: undefined,
            navigator: { userAgent: 'Chrome/50.0.0.0' },
        }));
        expect(report.usable).toBe(false);
        expect(report.stale).toBe(false);
    });

    it('parses the Chromium major version, or null', () => {
        expect(detectChromiumMajor('Mozilla/5.0 Chrome/120.0.6099.43 Mobile')).toBe(120);
        expect(detectChromiumMajor('no version here')).toBeNull();
        expect(detectChromiumMajor(undefined)).toBeNull();
    });
});

describe('update feed validation', () => {
    it('accepts exactly one plain semver field', () => {
        expect(parseUpdateFeed({ version: '0.334.0' })).toBe('0.334.0');
        // Extra keys are ignored, not rejected: rejecting them would let
        // whoever writes the feed break every old client on purpose.
        expect(parseUpdateFeed({ version: '1.0.0', '//': 'a comment' })).toBe('1.0.0');
    });

    it('refuses everything that is not a plain version', () => {
        for (const bad of [
            null, undefined, 'string', [], 42,
            {}, { version: 1 }, { version: '1.0' }, { version: '1.0.0-rc.1' },
            { version: '1.0.0+build' }, { version: '01.0.0' }, { version: ' 1.0.0 ' },
        ]) {
            expect(() => parseUpdateFeed(bad), JSON.stringify(bad)).toThrow(UpdateFeedError);
        }
    });

    it('never lets feed content into the notice', () => {
        // The whole reason the schema has one field: nothing here is text a
        // server can choose.
        const notice = updateNoticeText('0.334.0');
        expect(notice).toContain('0.334.0');
        expect(notice).toMatch(/check its fingerprint/i);
        expect(notice).not.toMatch(/http|<|>/);
    });

    it('compares versions numerically, not lexically', () => {
        expect(isNewerVersion('0.334.0', '0.333.1')).toBe(true);
        expect(isNewerVersion('0.9.0', '0.10.0')).toBe(false);   // lexical says otherwise
        expect(isNewerVersion('1.0.0', '0.999.99')).toBe(true);
        expect(isNewerVersion('0.333.1', '0.333.1')).toBe(false);
        expect(isNewerVersion('0.333.0', '0.333.1')).toBe(false);
    });
});

describe('checkForDirectUpdate', () => {
    const currentVersion = '0.333.1';

    it('reports a newer version', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '{"version":"0.334.0"}' }));
        const result = await checkForDirectUpdate({ currentVersion, fetchImpl, storage: memStorage() });
        expect(result).toEqual({ version: '0.334.0', notice: updateNoticeText('0.334.0') });
        expect(fetchImpl).toHaveBeenCalledWith(UPDATE_FEED_URL, expect.objectContaining({
            credentials: 'omit',
            redirect: 'error',
        }));
    });

    it('says nothing when the feed is not ahead', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '{"version":"0.333.1"}' }));
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage: memStorage() })).toBeNull();
    });

    it('stays silent on every failure', async () => {
        const cases = [
            async () => { throw new Error('offline'); },
            async () => ({ ok: false, status: 500, text: async () => '' }),
            async () => ({ ok: true, text: async () => 'not json' }),
            async () => ({ ok: true, text: async () => '{"version":"pwned"}' }),
            async () => ({ ok: true, text: async () => `{"version":"0.334.0","x":"${'a'.repeat(5000)}"}` }),
        ];
        for (const fetchImpl of cases) {
            expect(await checkForDirectUpdate({
                currentVersion, fetchImpl, storage: memStorage(),
            })).toBeNull();
        }
    });

    it('honours the opt-out', async () => {
        const storage = memStorage();
        const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '{"version":"0.334.0"}' }));
        setUpdateCheckEnabled(false, storage);
        expect(isUpdateCheckEnabled(storage)).toBe(false);
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
        // Even forcing does not override the user's decision.
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage, force: true })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('checks at most once a day', async () => {
        const storage = memStorage();
        const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '{"version":"0.334.0"}' }));
        const t0 = 1_700_000_000_000;
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage, now: t0 })).not.toBeNull();
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage, now: t0 + 1000 })).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const later = t0 + UPDATE_CHECK_INTERVAL_MS + 1;
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage, now: later })).not.toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('does not retry a failing feed on every launch', async () => {
        // The timestamp is written before the request precisely so an outage
        // cannot turn into a beacon reporting how often the wallet is opened.
        const storage = memStorage();
        const fetchImpl = vi.fn(async () => { throw new Error('down'); });
        const t0 = 1_700_000_000_000;
        await checkForDirectUpdate({ currentVersion, fetchImpl, storage, now: t0 });
        await checkForDirectUpdate({ currentVersion, fetchImpl, storage, now: t0 + 60_000 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does nothing without a usable current version', async () => {
        const fetchImpl = vi.fn();
        expect(await checkForDirectUpdate({ currentVersion: 'dev', fetchImpl })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
