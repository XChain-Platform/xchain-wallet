/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stateChangeForMessage } from '../../../packages/desktop/main/multiWindowState.js';
import {
    FileWindowBoundsStore,
    cascadeWindowBounds,
    normalizeWindowBounds,
    restoreWindowBounds,
    windowBoundsPathFor,
} from '../../../packages/desktop/main/windowBounds.js';

const tempDirs = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('desktop multi-window state notifications', () => {
    it.each(['wallet.unlock', 'wallet.lock', 'wallet.create', 'wallet.import', 'wallet.importBackup.fresh'])(
        'broadcasts successful %s session changes',
        (type) => {
            expect(stateChangeForMessage({ type }, { ok: true })).toEqual({ kind: 'session' });
        },
    );

    it.each(['wallet.add.import', 'wallet.importBackup', 'wallet.importBackupPointer'])(
        'tells sibling windows to re-read their wallet list after a successful %s',
        (type) => {
            expect(stateChangeForMessage({ type }, { ok: true })).toEqual({ kind: 'wallets', change: 'added' });
            expect(stateChangeForMessage({ type }, { ok: false })).toBeNull();
        },
    );

    it('broadcasts a validated active wallet selection', () => {
        expect(stateChangeForMessage(
            { type: 'wallet.setActive', request: { walletId: 'wallet-2' } },
            { ok: true },
        )).toEqual({ kind: 'active-wallet', walletId: 'wallet-2' });
    });

    it('does not broadcast failed, read-only, or malformed messages', () => {
        expect(stateChangeForMessage({ type: 'wallet.lock' }, { ok: false })).toBeNull();
        expect(stateChangeForMessage({ type: 'wallet.list' }, { ok: true })).toBeNull();
        expect(stateChangeForMessage({ type: 'wallet.setActive', request: {} }, { ok: true })).toBeNull();
    });
});

describe('desktop multi-window record notifications', () => {
    it('broadcasts a renamed wallet from the record the host returns', () => {
        expect(stateChangeForMessage(
            { type: 'wallet.rename', request: { walletId: 'wallet-2', name: 'Savings' } },
            { ok: true, result: { wallet: { id: 'wallet-2', name: 'Savings' } } },
        )).toEqual({ kind: 'wallets', change: 'renamed', walletId: 'wallet-2' });
    });

    it('broadcasts a removed wallet from the removal request', () => {
        expect(stateChangeForMessage(
            { type: 'wallet.remove', request: { walletId: 'wallet-2' } },
            { ok: true, result: { removed: true } },
        )).toEqual({ kind: 'wallets', change: 'removed', walletId: 'wallet-2' });
    });

    it('broadcasts an added or renamed account with its wallet', () => {
        const account = { id: 'account-3', walletId: 'wallet-1', index: 2, name: 'Spending' };
        expect(stateChangeForMessage(
            { type: 'account.create', request: { walletId: 'wallet-1' } },
            { ok: true, result: { account, addresses: [] } },
        )).toEqual({ kind: 'accounts', change: 'added', walletId: 'wallet-1', accountId: 'account-3' });
        expect(stateChangeForMessage(
            { type: 'account.rename', request: { accountId: 'account-3', name: 'Spending' } },
            { ok: true, result: { account } },
        )).toEqual({ kind: 'accounts', change: 'renamed', walletId: 'wallet-1', accountId: 'account-3' });
    });

    it('does not broadcast a failed record write or one with no record', () => {
        const rename = { type: 'wallet.rename', request: { walletId: 'wallet-2', name: 'x' } };
        expect(stateChangeForMessage(rename, { ok: false, result: { wallet: { id: 'wallet-2' } } })).toBeNull();
        expect(stateChangeForMessage(rename, { ok: true, result: {} })).toBeNull();
        expect(stateChangeForMessage({ type: 'wallet.remove', request: {} }, { ok: true })).toBeNull();
        expect(stateChangeForMessage({ type: 'account.create', request: { walletId: 'wallet-1' } }, { ok: true, result: { account: { id: 'a' } } })).toBeNull();
        expect(stateChangeForMessage({ type: 'account.rename', request: {} }, { ok: true, result: null })).toBeNull();
    });
});

describe('desktop multi-window settings notifications', () => {
    const saved = { schemaVersion: 2, activeNetwork: 'mainnet', theme: 'dark', fiatCurrency: 'EUR' };

    it('broadcasts the saved settings for a settings.update that leaves the network alone', () => {
        expect(stateChangeForMessage(
            { type: 'settings.update', request: { patch: { theme: 'dark' } } },
            { ok: true, result: saved },
        )).toEqual({ kind: 'settings', settings: saved });
        // The host also accepts the patch as the request itself.
        expect(stateChangeForMessage(
            { type: 'settings.update', request: { fiatCurrency: 'EUR' } },
            { ok: true, result: saved },
        )).toEqual({ kind: 'settings', settings: saved });
    });

    it('broadcasts a network change for a patch that moves the active network', () => {
        expect(stateChangeForMessage(
            { type: 'settings.update', request: { patch: { activeNetwork: 'testnet' } } },
            { ok: true, result: saved },
        )).toEqual({ kind: 'network', settings: saved });
        expect(stateChangeForMessage(
            { type: 'settings.update', request: { activeNetwork: 'testnet', developerMode: false } },
            { ok: true, result: saved },
        )).toEqual({ kind: 'network', settings: saved });
    });

    it('broadcasts a network change for settings.setActiveNetwork', () => {
        expect(stateChangeForMessage(
            { type: 'settings.setActiveNetwork', request: { walletId: 'wallet-1', network: 'testnet' } },
            { ok: true, result: { settings: saved, addresses: [] } },
        )).toEqual({ kind: 'network', settings: saved });
    });

    it('does not broadcast a failed settings write or one with no settings object', () => {
        const update = { type: 'settings.update', request: { patch: { theme: 'dark' } } };
        expect(stateChangeForMessage(update, { ok: false, result: saved })).toBeNull();
        expect(stateChangeForMessage(update, { ok: true })).toBeNull();
        expect(stateChangeForMessage(update, { ok: true, result: null })).toBeNull();
        expect(stateChangeForMessage(update, { ok: true, result: [saved] })).toBeNull();
        expect(stateChangeForMessage(
            { type: 'settings.setActiveNetwork', request: {} },
            { ok: true, result: { addresses: [] } },
        )).toBeNull();
    });
});

describe('desktop window bounds memory', () => {
    it('round-trips a normal window rectangle through the file store', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xchain-window-bounds-'));
        tempDirs.push(dir);
        const store = new FileWindowBoundsStore(windowBoundsPathFor(dir));
        const bounds = { x: 120, y: 80, width: 900, height: 700 };

        await store.save(bounds);

        await expect(store.load()).resolves.toEqual(bounds);
    });

    it('serializes rapid saves so the latest rectangle wins', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xchain-window-bounds-'));
        tempDirs.push(dir);
        const store = new FileWindowBoundsStore(windowBoundsPathFor(dir));
        const first = { x: 10, y: 20, width: 800, height: 650 };
        const latest = { x: 50, y: 60, width: 1000, height: 800 };

        await Promise.all([store.save(first), store.save(latest)]);

        await expect(store.load()).resolves.toEqual(latest);
    });

    it('writes a synchronous save before returning', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xchain-window-bounds-'));
        tempDirs.push(dir);
        const path = windowBoundsPathFor(join(dir, 'fresh-profile'));
        const store = new FileWindowBoundsStore(path);
        const bounds = { x: 40, y: 30, width: 960, height: 720 };

        store.saveSync(bounds);

        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(bounds);
        await expect(store.load()).resolves.toEqual(bounds);
    });

    it('does not let an older async save overwrite a later synchronous one', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xchain-window-bounds-'));
        tempDirs.push(dir);
        const store = new FileWindowBoundsStore(windowBoundsPathFor(dir));
        const older = { x: 10, y: 20, width: 800, height: 650 };
        const latest = { x: 50, y: 60, width: 1000, height: 800 };

        const pending = store.save(older);
        store.saveSync(latest);
        await pending;

        await expect(store.load()).resolves.toEqual(latest);
    });

    it('ignores malformed bounds on a synchronous save', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xchain-window-bounds-'));
        tempDirs.push(dir);
        const store = new FileWindowBoundsStore(windowBoundsPathFor(dir));

        store.saveSync({ width: 10, height: 10 });

        await expect(store.load()).resolves.toBeNull();
    });

    it('drops an off-screen position while preserving the remembered size', () => {
        const restored = restoreWindowBounds(
            { x: 4000, y: 3000, width: 900, height: 700 },
            [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        );

        expect(restored).toEqual({ width: 900, height: 700 });
    });

    it('clamps a partly visible position into the current display work area', () => {
        const bounds = { x: -800, y: 100, width: 900, height: 700 };
        expect(restoreWindowBounds(
            bounds,
            [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        )).toEqual({ x: 0, y: 100, width: 900, height: 700 });
    });

    it('shrinks and clamps an oversized saved window to its origin display', () => {
        expect(restoreWindowBounds(
            { x: 2100, y: 100, width: 2500, height: 1400 },
            [
                { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
                { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } },
            ],
        )).toEqual({ x: 1920, y: 0, width: 1280, height: 1024 });
    });

    it('drops an edge origin that leaves less than a usable window area visible', () => {
        expect(restoreWindowBounds(
            { x: 1919, y: 1079, width: 900, height: 700 },
            [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        )).toEqual({ width: 900, height: 700 });
    });

    it('cascades an additional window without changing its remembered size', () => {
        const bounds = { x: 100, y: 80, width: 900, height: 700 };
        expect(cascadeWindowBounds(
            bounds,
            [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        )).toEqual({ x: 124, y: 104, width: 900, height: 700 });
    });

    it('rejects malformed and undersized rectangles', () => {
        expect(normalizeWindowBounds({ x: 0, y: 0, width: 100, height: 100 })).toBeNull();
        expect(normalizeWindowBounds({ width: '900', height: 700 })).toBeNull();
    });

    it('accepts the compact 360 by 600 desktop layout floor', () => {
        expect(normalizeWindowBounds({ x: 0, y: 0, width: 360, height: 600 })).toEqual({
            x: 0,
            y: 0,
            width: 360,
            height: 600,
        });
        expect(normalizeWindowBounds({ width: 359, height: 600 })).toBeNull();
        expect(normalizeWindowBounds({ width: 360, height: 599 })).toBeNull();
    });
});
