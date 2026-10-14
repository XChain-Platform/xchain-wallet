/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
    installProcessErrorHandlers,
    reportMainFailure,
    runMainCallback,
    runMainTask,
} from '../../../packages/desktop/main/errorBoundary.js';

describe('desktop failure boundary edge branches', () => {
    it('returns successful callback and task values unchanged', async () => {
        expect(runMainCallback(() => 17, 'callback')).toBe(17);
        await expect(runMainTask(() => Promise.resolve(23), 'task')).resolves.toBe(23);
    });

    it('reports primitive failures on every occurrence', () => {
        const log = vi.fn();

        expect(reportMainFailure('primitive', 'failure', log)).toBe(true);
        expect(reportMainFailure('primitive', 'failure', log)).toBe(true);

        expect(log).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith('[xchain] primitive failed');
    });

    it('recovers from a synchronous task failure', async () => {
        const log = vi.fn();
        const recover = vi.fn();

        await expect(runMainTask(() => { throw new Error('private'); }, 'launch', {
            log,
            recover,
        })).resolves.toBeUndefined();

        expect(recover).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledExactlyOnceWith('[xchain] launch failed');
    });

    it('contains and separately reports a recovery failure', async () => {
        const log = vi.fn();

        await expect(runMainTask(
            () => Promise.reject(new Error('task secret')),
            'window load',
            {
                log,
                recover: () => { throw new Error('recovery secret'); },
            },
        )).resolves.toBeUndefined();

        expect(log.mock.calls).toEqual([
            ['[xchain] window load failed'],
            ['[xchain] window load recovery failed'],
        ]);
        expect(log.mock.calls.flat().join(' ')).not.toContain('secret');
    });

    it('can reinstall process handlers after disposal', () => {
        const listeners = new Map();
        const proc = {
            on: vi.fn((name, handler) => { listeners.set(name, handler); }),
            off: vi.fn((name, handler) => {
                if (listeners.get(name) === handler) listeners.delete(name);
            }),
        };

        const first = installProcessErrorHandlers(proc, vi.fn());
        first();
        const second = installProcessErrorHandlers(proc, vi.fn());

        expect(second).not.toBe(first);
        expect(proc.on).toHaveBeenCalledTimes(4);
        expect(listeners.size).toBe(2);
        second();
    });
});
