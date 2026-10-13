// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeTarget() {
    const listeners = new Map();
    return {
        listeners,
        target: {
            addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
            removeEventListener: vi.fn((type, listener) => {
                if (listeners.get(type) === listener) listeners.delete(type);
            }),
        },
    };
}

beforeEach(() => {
    vi.resetModules();
});

describe('popup error capture', () => {
    it('installs once, records both global failure types, and uninstalls', async () => {
        const capture = await import('../../../packages/extension/src/popup/errorCapture.js');
        const { listeners, target } = makeTarget();

        const uninstall = capture.installShellErrorCapture(target);
        capture.installShellErrorCapture(target);

        expect(target.addEventListener).toHaveBeenCalledTimes(2);
        listeners.get('error')({ error: new TypeError('render failed') });
        listeners.get('unhandledrejection')({ reason: new Error('request failed') });

        expect(capture.getRecentShellErrors()).toMatchObject([
            { kind: 'TypeError', message: 'render failed', phase: 'error' },
            { kind: 'Error', message: 'request failed', phase: 'unhandledrejection' },
        ]);

        uninstall();
        expect(target.removeEventListener).toHaveBeenCalledTimes(2);
        expect(listeners.size).toBe(0);
    });

    it('can install again after its cleanup runs', async () => {
        const capture = await import('../../../packages/extension/src/popup/errorCapture.js');
        const first = makeTarget();
        const second = makeTarget();

        capture.installShellErrorCapture(first.target)();
        capture.installShellErrorCapture(second.target);

        expect(first.target.removeEventListener).toHaveBeenCalledTimes(2);
        expect(second.target.addEventListener).toHaveBeenCalledTimes(2);
    });
});
