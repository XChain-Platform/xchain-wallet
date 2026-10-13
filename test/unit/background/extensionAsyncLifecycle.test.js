// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
    LABEL_SYNC_RESULTS_SESSION_KEY,
    createLabelSyncRestoreTaskRegistry,
} from '../../../packages/extension/src/background/labelSyncRestoreTasks.js';
import {
    WIPE_STORAGE_MESSAGE_TYPE,
    attachWipeStorageListener,
} from '../../../packages/extension/src/background/wipeExtensionStorage.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

function sessionArea() {
    const values = new Map();
    return {
        values,
        async get(key) {
            return values.has(key) ? { [key]: values.get(key) } : {};
        },
        async set(items) {
            for (const [key, value] of Object.entries(items)) values.set(key, value);
        },
    };
}

function runtime() {
    let listener;
    return {
        id: 'ext-id',
        onMessage: {
            addListener(fn) { listener = fn; },
            removeListener() { listener = undefined; },
        },
        emit(message) {
            return new Promise((resolve) => {
                listener(message, {
                    id: 'ext-id',
                    url: 'chrome-extension://ext-id/popup.html',
                }, resolve);
            });
        },
    };
}

describe('extension background async lifecycle', () => {
    it('answers the wipe caller when an unexpected wipe rejection escapes', async () => {
        const chromeRuntime = runtime();
        attachWipeStorageListener({
            wipe: vi.fn(async () => { throw new Error('storage backend disappeared'); }),
        }, chromeRuntime);

        const response = await chromeRuntime.emit({ type: WIPE_STORAGE_MESSAGE_TYPE });

        expect(response).toEqual({
            ok: false,
            error: {
                name: 'Error',
                message: 'storage backend disappeared',
            },
        });
    });

    it('keeps a completed label-restore result across worker replacement', async () => {
        const area = sessionArea();
        const firstWorker = createLabelSyncRestoreTaskRegistry({
            sessionArea: area,
            newId: () => 'task-one',
        });
        const token = firstWorker.start({
            walletId: 'wallet-1',
            run: async () => ({ restored: true, labelsUpdated: 3 }),
        });
        await vi.waitFor(() => {
            expect(area.values.get(LABEL_SYNC_RESULTS_SESSION_KEY)?.[token]).toEqual({
                restored: true,
                labelsUpdated: 3,
            });
        });

        const restartedWorker = createLabelSyncRestoreTaskRegistry({ sessionArea: area });
        await expect(restartedWorker.wait(token)).resolves.toEqual({
            restored: true,
            labelsUpdated: 3,
        });
        expect(area.values.get(LABEL_SYNC_RESULTS_SESSION_KEY)).toEqual({});
    });

    it('observes both background boot promises without changing SDK refusal semantics', () => {
        const source = readFileSync(join(root, 'packages/extension/src/background.js'), 'utf8');

        expect(source).toMatch(/applyLayoutMode\(mode\);\s*\}\)\(\)\.catch\(/);
        expect(source).toContain('void sdkResolved.catch(() => {});');
        expect(source).toMatch(/if \(import\.meta\.env\?\.PROD\)[\s\S]*?throw err;/);
    });
});
