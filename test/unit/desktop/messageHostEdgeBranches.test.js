/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createBackgroundHost = vi.hoisted(() => vi.fn());

vi.mock('@xchain-wallet/extension/src/background/createBackgroundHost.js', () => ({
    createBackgroundHost,
}));

import {
    IPC_CHANNEL,
    createDesktopMessageHost,
} from '../../../packages/desktop/main/messageHost.js';

const completeDeps = () => ({
    vault: {},
    chainRegistry: {},
    sdkRegistry: {},
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('desktop message host edge branches', () => {
    it.each([
        ['vault', /vault is required/],
        ['chainRegistry', /chainRegistry is required/],
        ['sdkRegistry', /sdkRegistry is required/],
    ])('refuses a missing %s dependency', (name, pattern) => {
        const deps = completeDeps();
        delete deps[name];

        expect(() => createDesktopMessageHost(deps)).toThrow(pattern);
        expect(createBackgroundHost).not.toHaveBeenCalled();
    });

    it('refuses an absent dependency object', () => {
        expect(() => createDesktopMessageHost()).toThrow(/vault is required/);
        expect(createBackgroundHost).not.toHaveBeenCalled();
    });

    it('returns the host and forwards responses without changing the envelope', async () => {
        const response = { ok: false, error: { code: 'LOCKED', message: 'Wallet is locked' } };
        const host = { handle: vi.fn(async () => response) };
        createBackgroundHost.mockReturnValue(host);
        const deps = completeDeps();

        const desktop = createDesktopMessageHost(deps);
        const message = { type: 'wallet.list', request: { includeHidden: true } };

        expect(desktop.host).toBe(host);
        await expect(desktop.handle(message)).resolves.toBe(response);
        expect(host.handle).toHaveBeenCalledExactlyOnceWith(message);
        expect(createBackgroundHost).toHaveBeenCalledExactlyOnceWith(deps);
        expect(IPC_CHANNEL).toBe('xchain-wallet:message');
    });

    it('leaves host rejections for the main IPC boundary to contain', async () => {
        const failure = new Error('host unavailable');
        createBackgroundHost.mockReturnValue({ handle: vi.fn(async () => { throw failure; }) });

        const desktop = createDesktopMessageHost(completeDeps());

        await expect(desktop.handle({ type: 'wallet.list' })).rejects.toBe(failure);
    });
});
