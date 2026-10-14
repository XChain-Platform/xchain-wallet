// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: native mobile update checks.
//
//   [P1] 2026-10-13: A direct-APK update check through WebView fetch cannot
//        reliably reach the cross-origin feed from the Android shell. The
//        shell uses its fixed-endpoint native bridge, still validates every
//        returned body as untrusted input, and remains silent while offline.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    __setNativeShellForTests,
    __setNativeVaultForTests,
} from '../../packages/web/src/storage/nativeVault.js';
import {
    checkForDirectUpdate,
    updateNoticeText,
} from '../../packages/web/src/update/directUpdateCheck.js';

const CURRENT_VERSION = '0.341.3';
const NEW_VERSION = '0.342.0';

function memStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    };
}

function installNativeFeed(reply) {
    const fetchDirectUpdateFeed = vi.fn(async () => reply);
    __setNativeShellForTests(true);
    __setNativeVaultForTests({
        loadVault: vi.fn(),
        fetchDirectUpdateFeed,
    });
    return fetchDirectUpdateFeed;
}

afterEach(() => {
    __setNativeShellForTests(undefined);
    __setNativeVaultForTests(undefined);
    vi.restoreAllMocks();
});

describe('regression/mobile-update-check-native-http', () => {
    it('[REGRESSION P1] uses the fixed native HTTP bridge without touching fetch', async () => {
        const nativeRequest = installNativeFeed({
            status: 'OK',
            body: JSON.stringify({ version: NEW_VERSION }),
        });
        const fetchImpl = vi.fn(async () => {
            throw new Error('WebView fetch must stay unused');
        });

        await expect(checkForDirectUpdate({
            currentVersion: CURRENT_VERSION,
            fetchImpl,
            storage: memStorage(),
        })).resolves.toEqual({
            version: NEW_VERSION,
            notice: updateNoticeText(NEW_VERSION),
        });
        expect(nativeRequest).toHaveBeenCalledOnce();
        expect(nativeRequest).toHaveBeenCalledWith({});
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] validates the manifest returned by the native bridge', async () => {
        const fetchImpl = vi.fn();
        for (const body of [
            '{"version":"0.342.0-rc.1"}',
            '{"version":342}',
            'not json',
        ]) {
            installNativeFeed({ status: 'OK', body });
            // Each attempt owns fresh preferences so validation, rather than
            // the daily interval, decides whether the body produces a notice.
            // eslint-disable-next-line no-await-in-loop
            await expect(checkForDirectUpdate({
                currentVersion: CURRENT_VERSION,
                fetchImpl,
                storage: memStorage(),
            }), body).resolves.toBeNull();
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] fails quietly while the native update endpoint is offline', async () => {
        const nativeRequest = installNativeFeed({ status: 'UNAVAILABLE' });
        const fetchImpl = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(checkForDirectUpdate({
            currentVersion: CURRENT_VERSION,
            fetchImpl,
            storage: memStorage(),
        })).resolves.toBeNull();
        expect(nativeRequest).toHaveBeenCalledOnce();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(consoleWarn).not.toHaveBeenCalled();
    });
});
