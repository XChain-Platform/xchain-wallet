// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import {
    getRecentShellErrors,
    installShellErrorCapture,
} from '../../../packages/web/src/errorCapture.js';

function fakeTarget() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) listeners.delete(type);
        },
    };
}

let stop;

afterEach(() => {
    stop?.();
    stop = undefined;
});

describe('web shell error capture', () => {
    it('records browser errors and promise rejections for diagnostics', () => {
        const target = fakeTarget();
        stop = installShellErrorCapture(target);

        target.listeners.get('error')({ error: new TypeError('render failed') });
        target.listeners.get('unhandledrejection')({ reason: new Error('request failed') });

        expect(getRecentShellErrors().slice(-2)).toEqual([
            expect.objectContaining({
                kind: 'TypeError',
                message: 'render failed',
                phase: 'error',
            }),
            expect.objectContaining({
                kind: 'Error',
                message: 'request failed',
                phase: 'unhandledrejection',
            }),
        ]);
    });

    it('installs once and permits a fresh target after uninstall', () => {
        const first = fakeTarget();
        const second = fakeTarget();
        const stopFirst = installShellErrorCapture(first);
        stop = installShellErrorCapture(second);

        expect(first.listeners.has('error')).toBe(true);
        expect(second.listeners.size).toBe(0);

        stopFirst();
        expect(first.listeners.size).toBe(0);
        stop = installShellErrorCapture(second);
        expect(second.listeners.has('error')).toBe(true);
    });
});
