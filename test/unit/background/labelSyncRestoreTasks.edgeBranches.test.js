// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    LABEL_SYNC_RESULTS_SESSION_KEY,
    createLabelSyncRestoreTaskRegistry,
} from '../../../packages/extension/src/background/labelSyncRestoreTasks.js';

function callbackArea() {
    const values = new Map();
    return {
        values,
        get(key, callback) {
            callback(values.has(key) ? { [key]: values.get(key) } : {});
        },
        set(items, callback) {
            for (const [key, value] of Object.entries(items)) values.set(key, value);
            callback();
        },
    };
}

describe('label-sync restore task edge branches', () => {
    it('validates task starts and result tokens', async () => {
        const registry = createLabelSyncRestoreTaskRegistry({ newId: () => 'id' });
        expect(() => registry.start({ walletId: '', run: vi.fn() })).toThrow('walletId is required');
        expect(() => registry.start({ walletId: 'wallet-1' })).toThrow('run is required');
        await expect(registry.wait('')).rejects.toThrow('token is required');
    });

    it('turns a restore rejection into a null result and logs the refusal', async () => {
        const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
        const registry = createLabelSyncRestoreTaskRegistry({ newId: () => 'failed' });
        const token = registry.start({
            walletId: 'wallet-1',
            run: async () => { throw new Error('explorer refused'); },
        });

        await expect(registry.wait(token)).resolves.toBeNull();
        expect(logger).toHaveBeenCalledWith(
            '[xchain-wallet] label-sync restore skipped:',
            expect.objectContaining({ message: 'explorer refused' }),
        );
        logger.mockRestore();
    });

    it('supports callback-only session storage across worker replacement', async () => {
        const area = callbackArea();
        const first = createLabelSyncRestoreTaskRegistry({
            sessionArea: area,
            newId: () => 'callback',
        });
        const token = first.start({ walletId: 'wallet-1', run: async () => ({ restored: 2 }) });
        await vi.waitFor(() => expect(
            area.values.get(LABEL_SYNC_RESULTS_SESSION_KEY)?.[token],
        ).toEqual({ restored: 2 }));

        const replacement = createLabelSyncRestoreTaskRegistry({ sessionArea: area });
        await expect(replacement.wait(token)).resolves.toEqual({ restored: 2 });
        await expect(replacement.wait(token)).resolves.toBeNull();
    });

    it('finishes active tasks when session storage rejects reads and writes', async () => {
        const area = {
            get: vi.fn(() => Promise.reject(new Error('read refused'))),
            set: vi.fn(() => Promise.reject(new Error('write refused'))),
        };
        const registry = createLabelSyncRestoreTaskRegistry({
            sessionArea: area,
            newId: () => 'refused',
        });
        const token = registry.start({ walletId: 'wallet-1', run: async () => 'done' });

        await expect(registry.wait(token)).resolves.toBe('done');
        expect(area.get).toHaveBeenCalled();
        expect(area.set).toHaveBeenCalled();
    });

    it('keeps only the newest sixteen settled results', async () => {
        const area = callbackArea();
        let id = 0;
        const registry = createLabelSyncRestoreTaskRegistry({
            sessionArea: area,
            newId: () => `task-${id++}`,
        });
        const tokens = [];
        for (let index = 0; index < 17; index += 1) {
            tokens.push(registry.start({
                walletId: 'wallet-1',
                run: async () => index,
            }));
        }
        await vi.waitFor(() => expect(
            Object.keys(area.values.get(LABEL_SYNC_RESULTS_SESSION_KEY) ?? {}),
        ).toHaveLength(16));

        const replacement = createLabelSyncRestoreTaskRegistry({ sessionArea: area });
        await expect(replacement.wait(tokens[0])).resolves.toBeNull();
        await expect(replacement.wait(tokens.at(-1))).resolves.toBe(16);
    });
});
