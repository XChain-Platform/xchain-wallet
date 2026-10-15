// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    connectExtensionWallet,
    disableExtensionWallet,
    readExtensionWalletPreference,
    writeExtensionWalletPreference,
} from '../../../packages/web/src/extensionWallet.js';

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    delete window.xchain;
    vi.restoreAllMocks();
});

describe('extension wallet storage failures', () => {
    it('treats a throwing localStorage accessor as an unavailable preference', () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get: () => { throw new Error('storage denied'); },
        });

        expect(readExtensionWalletPreference()).toBe(false);
        expect(() => writeExtensionWalletPreference(true)).not.toThrow();
        expect(() => disableExtensionWallet()).not.toThrow();
    });

    it('contains read, write, and removal refusals from an available storage object', () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn(() => { throw new Error('read denied'); }),
                setItem: vi.fn(() => { throw new Error('quota exceeded'); }),
                removeItem: vi.fn(() => { throw new Error('write denied'); }),
            },
        });

        expect(readExtensionWalletPreference()).toBe(false);
        expect(() => writeExtensionWalletPreference(true)).not.toThrow();
        expect(() => writeExtensionWalletPreference(false)).not.toThrow();
    });

    it('returns a successful connect result even when persistence is denied', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn(() => null),
                setItem: vi.fn(() => { throw new Error('quota exceeded'); }),
                removeItem: vi.fn(),
            },
        });
        const result = { ok: true, accounts: [], chains: [] };
        window.xchain = {
            isXChainWallet: true,
            connect: vi.fn().mockResolvedValue(result),
        };

        await expect(connectExtensionWallet()).resolves.toBe(result);
        expect(window.xchain.connect).toHaveBeenCalledWith({});
    });
});
