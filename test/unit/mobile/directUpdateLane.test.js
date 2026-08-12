// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The direct-update lane gate (§6, D4).
//
// The thing under test is not "does the update check work" - `directUpdateCheck`
// already has its own tests - it is WHO IS ALLOWED TO ASK. §6 gives exactly one
// shipped artifact no update path (the direct Android APK), and the same bytes
// signed by Google are a Play install that updates itself and must never be
// told to go and download anything. So the interesting cases here are all the
// ones that must stay silent, and they outnumber the one that must not.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    __setNativeVaultForTests,
} from '../../../packages/web/src/storage/nativeVault.js';
import {
    getInstallOrigin,
    isSelfUpdatingLane,
} from '../../../packages/web/src/update/installOrigin.js';
import { installDirectUpdateProvider } from '../../../packages/web/src/update/directUpdateProvider.js';
import {
    hasDirectUpdateLane,
    checkForUpdateNotice,
    isUpdateNoticeEnabled,
    setUpdateNoticeEnabled,
    setDirectUpdateProvider,
    directUpdateFeedUrl,
} from '../../../packages/core/src/flows/directUpdate.js';

/** A plugin stub that satisfies `getNativeVault()`'s `loadVault` probe. */
function pluginAnswering(origin) {
    return {
        loadVault: async () => ({ status: 'ABSENT' }),
        ...(origin === undefined
            ? {}
            : { getInstallOrigin: async () => origin }),
    };
}

beforeEach(() => {
    __setNativeVaultForTests(undefined);
    setDirectUpdateProvider(null);
    globalThis.localStorage?.clear?.();
});

afterEach(() => {
    __setNativeVaultForTests(undefined);
    setDirectUpdateProvider(null);
});

describe('installOrigin: who is asked, and what counts as an answer', () => {
    it('a browser has no plugin at all', async () => {
        __setNativeVaultForTests(null);
        expect(await getInstallOrigin()).toEqual({ channel: 'unknown', installer: null });
    });

    it('a native shell whose plugin lacks the method answers unknown, not direct', async () => {
        // This is the iOS case, and it is the one that must not regress: the
        // Swift plugin implements no `getInstallOrigin`, so a shared bundle
        // running there has to fall through to silence rather than to a
        // default.
        __setNativeVaultForTests(pluginAnswering(undefined));
        expect(await getInstallOrigin()).toEqual({ channel: 'unknown', installer: null });
    });

    it('a Play install is a store lane', async () => {
        __setNativeVaultForTests(pluginAnswering({
            status: 'OK', channel: 'store', installer: 'com.android.vending',
        }));
        const origin = await getInstallOrigin();
        expect(origin).toEqual({ channel: 'store', installer: 'com.android.vending' });
        expect(isSelfUpdatingLane(origin)).toBe(false);
    });

    it('a sideloaded install is a direct lane, installer or no installer', async () => {
        __setNativeVaultForTests(pluginAnswering({
            status: 'OK', channel: 'direct', installer: null,
        }));
        const origin = await getInstallOrigin();
        expect(origin).toEqual({ channel: 'direct', installer: null });
        expect(isSelfUpdatingLane(origin)).toBe(true);
    });

    it('an unrecognised channel is unknown, never direct', async () => {
        // Same rule the vault read statuses follow: a native side that grows a
        // third answer must not have it quietly mapped onto user-visible
        // behaviour.
        for (const channel of ['DIRECT', 'sideload', '', null, undefined, 42]) {
            __setNativeVaultForTests(pluginAnswering({ status: 'OK', channel }));
            // eslint-disable-next-line no-await-in-loop
            expect((await getInstallOrigin()).channel, String(channel)).toBe('unknown');
        }
    });

    it('a native call that throws is unknown, not an unhandled rejection', async () => {
        __setNativeVaultForTests({
            loadVault: async () => ({ status: 'ABSENT' }),
            getInstallOrigin: async () => { throw new Error('binder died'); },
        });
        expect(await getInstallOrigin()).toEqual({ channel: 'unknown', installer: null });
    });
});

describe('the provider is installed only on the direct lane', () => {
    it('installs on direct', async () => {
        __setNativeVaultForTests(pluginAnswering({ status: 'OK', channel: 'direct', installer: null }));
        expect(await installDirectUpdateProvider()).toBe(true);
        expect(hasDirectUpdateLane()).toBe(true);
        expect(directUpdateFeedUrl()).toMatch(/^https:\/\/downloads\.xchain\.io\//);
    });

    for (const [name, plugin] of [
        ['a Play install', pluginAnswering({ status: 'OK', channel: 'store', installer: 'com.android.vending' })],
        ['an iOS build (no such method)', pluginAnswering(undefined)],
        ['a browser (no plugin)', null],
    ]) {
        it(`does not install for ${name}`, async () => {
            __setNativeVaultForTests(plugin);
            expect(await installDirectUpdateProvider()).toBe(false);
            expect(hasDirectUpdateLane()).toBe(false);
            expect(await checkForUpdateNotice()).toBeNull();
            expect(directUpdateFeedUrl()).toBeNull();
        });
    }

    it('uninstalls a stale provider when the lane goes away', async () => {
        __setNativeVaultForTests(pluginAnswering({ status: 'OK', channel: 'direct', installer: null }));
        await installDirectUpdateProvider();
        expect(hasDirectUpdateLane()).toBe(true);
        // A reload into a different shell (or a test that forgot to reset)
        // must not leave a Settings switch behind that drives nothing.
        __setNativeVaultForTests(null);
        await installDirectUpdateProvider();
        expect(hasDirectUpdateLane()).toBe(false);
    });
});

describe('the core seam swallows what a wallet should not be interrupted by', () => {
    it('rejects a provider that is missing a method rather than half-installing it', () => {
        expect(() => setDirectUpdateProvider({ check: () => null })).toThrow(/isEnabled/);
        expect(hasDirectUpdateLane()).toBe(false);
    });

    it('a provider whose check throws yields null, not a rejection', async () => {
        setDirectUpdateProvider({
            check: async () => { throw new Error('offline'); },
            isEnabled: () => true,
            setEnabled: () => {},
        });
        expect(await checkForUpdateNotice()).toBeNull();
    });

    it('the enable switch round-trips through the provider', () => {
        let on = true;
        setDirectUpdateProvider({
            check: async () => null,
            isEnabled: () => on,
            setEnabled: (next) => { on = next; },
        });
        expect(isUpdateNoticeEnabled()).toBe(true);
        setUpdateNoticeEnabled(false);
        expect(on).toBe(false);
        expect(isUpdateNoticeEnabled()).toBe(false);
    });

    it('the switch is inert with no lane, rather than throwing', () => {
        expect(isUpdateNoticeEnabled()).toBe(false);
        expect(() => setUpdateNoticeEnabled(true)).not.toThrow();
        expect(isUpdateNoticeEnabled()).toBe(false);
    });
});
