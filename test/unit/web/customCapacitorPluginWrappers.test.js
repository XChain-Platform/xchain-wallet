// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The JS boundaries for every app-local Capacitor plugin. A native rejection
// is hostile diagnostic input: wrappers may classify it, but must never put a
// password, QR payload, deep link, or copied value into a thrown message.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CopyFailure,
    copyText,
} from '../../../packages/core/src/shared/clipboard.js';
import {
    __setLinksPluginForTests,
    subscribeToNativeDeepLinks,
} from '../../../packages/web/src/deeplinks/nativeDeepLinks.js';
import {
    __setNativeVaultForTests,
    callNativeVault,
} from '../../../packages/web/src/storage/nativeVault.js';
import { startNativeQrScan } from '../../../packages/web/src/storage/nativeQrScanner.js';

const SECRET = 'legal winner thank year wave sausage worth useful';

async function rejected(promise) {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected rejection');
}

afterEach(() => {
    __setNativeVaultForTests(undefined);
    __setLinksPluginForTests(undefined);
});

describe('XChainClipboard wrapper', () => {
    it('refuses sensitive web fallback when the native plugin is unavailable', async () => {
        const writeText = vi.fn();
        const env = {
            Capacitor: { isNativePlatform: () => true, Plugins: {} },
            navigator: { clipboard: { writeText } },
        };

        await expect(copyText(SECRET, { sensitive: true, env })).resolves.toEqual({
            ok: false,
            native: true,
            reason: CopyFailure.NO_NATIVE_CLIPBOARD,
        });
        expect(writeText).not.toHaveBeenCalled();
    });

    it('turns a rejected sensitive write into a secret-free refusal', async () => {
        const writeText = vi.fn();
        const env = {
            Capacitor: {
                isNativePlatform: () => true,
                Plugins: {
                    XChainClipboard: {
                        write: vi.fn(async () => { throw new Error(`copy failed for ${SECRET}`); }),
                    },
                },
            },
            navigator: { clipboard: { writeText } },
        };

        const result = await copyText(SECRET, { sensitive: true, env });
        expect(result).toEqual({ ok: false, native: true, reason: CopyFailure.UNAVAILABLE });
        expect(JSON.stringify(result)).not.toContain(SECRET);
        expect(writeText).not.toHaveBeenCalled();
    });
});

describe('XChainVault wrapper', () => {
    it('surfaces unavailable and rejected calls as ordinary Error objects', async () => {
        __setNativeVaultForTests(null);
        const unavailable = await rejected(callNativeVault('loadVault'));
        expect(unavailable).toBeInstanceOf(Error);

        __setNativeVaultForTests({
            loadVault: vi.fn(async () => { throw { message: `failed for ${SECRET}` }; }),
        });
        const failure = await rejected(callNativeVault('loadVault'));
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toContain('XChainVault.loadVault failed');
        expect(failure.message).not.toContain(SECRET);
    });
});

describe('native QR wrapper', () => {
    it('uses a plain, secret-free error for absence and arbitrary rejection text', async () => {
        __setNativeVaultForTests(null);
        const unavailable = await rejected(startNativeQrScan(() => {}, () => {}));
        expect(unavailable).toBeInstanceOf(Error);
        expect(unavailable).toMatchObject({ reason: 'unavailable' });

        const remove = vi.fn(async () => {});
        __setNativeVaultForTests({
            loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
            addListener: vi.fn(async () => ({ remove })),
            qrScanStart: vi.fn(async () => { throw new Error(`bad QR ${SECRET}`); }),
        });
        const failure = await rejected(startNativeQrScan(() => {}, () => {}));
        expect(failure).toBeInstanceOf(Error);
        expect(failure).toMatchObject({ reason: 'error' });
        expect(failure.message).not.toContain(SECRET);
    });
});

describe('XChainLinks wrapper', () => {
    it('uses a no-op fallback and contains rejected native diagnostics', async () => {
        __setLinksPluginForTests(null);
        expect(subscribeToNativeDeepLinks(vi.fn())).toBeTypeOf('function');

        const onLink = vi.fn();
        __setLinksPluginForTests({
            takePendingLink: vi.fn(async () => { throw new Error(`bad link ${SECRET}`); }),
            addListener: vi.fn(() => { throw new Error(`listener failed for ${SECRET}`); }),
        });
        expect(() => subscribeToNativeDeepLinks(onLink)).not.toThrow();
        await Promise.resolve();
        expect(onLink).not.toHaveBeenCalled();
    });
});
