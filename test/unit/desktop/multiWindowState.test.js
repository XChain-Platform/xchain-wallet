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
import { mkdtempSync, rmSync } from 'node:fs';
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

    it('drops an off-screen position while preserving the remembered size', () => {
        const restored = restoreWindowBounds(
            { x: 4000, y: 3000, width: 900, height: 700 },
            [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        );

        expect(restored).toEqual({ width: 900, height: 700 });
    });

    it('keeps a position with a useful visible edge on a current display', () => {
        const bounds = { x: -800, y: 100, width: 900, height: 700 };
        expect(restoreWindowBounds(
            bounds,
            [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        )).toEqual(bounds);
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
});
