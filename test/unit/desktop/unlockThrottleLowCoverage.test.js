/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    FileUnlockThrottleStore,
    unlockThrottlePathFor,
} from '../../../packages/desktop/main/unlockThrottle.js';

const dirs = [];

function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'xchain-throttle-branches-'));
    dirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('unlock throttle persistence branches', () => {
    it.each([undefined, null, '', 7, {}])('rejects an invalid store path: %j', (path) => {
        expect(() => new FileUnlockThrottleStore(path)).toThrow(/filePath is required/);
    });

    it.each([undefined, null, '', 7, {}])('rejects an invalid user-data path: %j', (path) => {
        expect(() => unlockThrottlePathFor(path)).toThrow(/userDataDir is required/);
    });

    it('rejects parsed JSON values that are not records', async () => {
        const dir = tempDir();
        const path = join(dir, 'unlock-throttle.json');
        const store = new FileUnlockThrottleStore(path);

        for (const value of [null, false, 42, 'state']) {
            writeFileSync(path, JSON.stringify(value));
            await expect(store.load()).resolves.toBeNull();
        }
    });

    it('normalizes absent and non-numeric fields while exposing its path', async () => {
        const path = join(tempDir(), 'nested', 'unlock-throttle.json');
        const store = new FileUnlockThrottleStore(path);

        await store.save({ failCount: 'bad', lockedUntil: null });

        expect(store.filePath).toBe(path);
        await expect(store.load()).resolves.toEqual({ failCount: 0, lockedUntil: 0 });
    });

    it('propagates clear failures other than a missing file', async () => {
        const path = join(tempDir(), 'unlock-throttle.json');
        mkdirSync(path);

        await expect(new FileUnlockThrottleStore(path).clear()).rejects.toBeDefined();
    });
});
