// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §43.5 / Cluster F FOLLOWUP 2: web-app "use the extension wallet"
// handoff core. Exercises preference persistence, provider detection,
// the connect handshake, and the bridge-native forwarding helpers with a
// fake `window.xchain`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    EXT_WALLET_PREF_KEY,
    ExtensionUnavailableError,
    connectExtensionWallet,
    disableExtensionWallet,
    forwardGetAccounts,
    forwardGetAddresses,
    forwardGetBalances,
    forwardGetSupportedChains,
    forwardSignAction,
    forwardSignMessage,
    forwardSignPsbt,
    getExtensionProvider,
    hasExtensionProvider,
    isExtensionWalletEnabled,
    readExtensionWalletPreference,
    writeExtensionWalletPreference,
} from '../../../packages/web/src/extensionWallet.js';

// bridge-spec shapes, not approximations of them: connect answers a
// ConnectResult union and getBalances answers a Balance[].
const CONNECT_SUCCESS = {
    ok: true,
    version: '0.1.0',
    accounts: [{ id: 'acct-1', name: 'A' }],
    chains: ['bitcoin'],
    permissions: {
        chains: ['bitcoin'],
        accounts: ['acct-1'],
        canSignMessage: false,
        canSignAction: {},
    },
};

function makeProvider(overrides = {}) {
    return {
        isXChainWallet: true,
        connect: vi.fn().mockResolvedValue(CONNECT_SUCCESS),
        getAccounts: vi.fn().mockResolvedValue([{ id: 'acct-1', name: 'A' }]),
        getAddresses: vi.fn().mockResolvedValue([{ id: 'addr-1' }]),
        getBalances: vi.fn().mockResolvedValue([]),
        getSupportedChains: vi.fn().mockResolvedValue([{ id: 'bitcoin-mainnet' }]),
        signMessage: vi.fn().mockResolvedValue({ signature: 'sig' }),
        signAction: vi.fn().mockResolvedValue({ txid: 'tx' }),
        signPsbt: vi.fn().mockResolvedValue({ signedPsbtHex: 'ab' }),
        ...overrides,
    };
}

beforeEach(() => {
    localStorage.clear();
    delete window.xchain;
});
afterEach(() => {
    localStorage.clear();
    delete window.xchain;
    vi.restoreAllMocks();
});

describe('preference persistence', () => {
    it('defaults to false with an empty store', () => {
        expect(readExtensionWalletPreference()).toBe(false);
    });

    it('round-trips the preference through localStorage under the documented key', () => {
        writeExtensionWalletPreference(true);
        expect(localStorage.getItem(EXT_WALLET_PREF_KEY)).toBe('1');
        expect(readExtensionWalletPreference()).toBe(true);
    });

    it('clears the key rather than storing a falsey value', () => {
        writeExtensionWalletPreference(true);
        writeExtensionWalletPreference(false);
        expect(localStorage.getItem(EXT_WALLET_PREF_KEY)).toBeNull();
        expect(readExtensionWalletPreference()).toBe(false);
    });
});

describe('provider detection', () => {
    it('reports absent when no provider is injected', () => {
        expect(getExtensionProvider()).toBeUndefined();
        expect(hasExtensionProvider()).toBe(false);
    });

    it('requires the isXChainWallet brand (rejects an impostor global)', () => {
        window.xchain = { connect: () => {} }; // no brand
        expect(hasExtensionProvider()).toBe(false);
    });

    it('detects a branded provider', () => {
        window.xchain = makeProvider();
        expect(hasExtensionProvider()).toBe(true);
    });
});

describe('isExtensionWalletEnabled', () => {
    it('is false when the preference is set but no provider is present', () => {
        writeExtensionWalletPreference(true);
        expect(isExtensionWalletEnabled()).toBe(false);
    });

    it('is false when the provider is present but the user has not opted in', () => {
        window.xchain = makeProvider();
        expect(isExtensionWalletEnabled()).toBe(false);
    });

    it('is true only when both the preference and the provider are present', () => {
        window.xchain = makeProvider();
        writeExtensionWalletPreference(true);
        expect(isExtensionWalletEnabled()).toBe(true);
    });
});

describe('connectExtensionWallet', () => {
    it('throws a typed error when no provider is present, persisting nothing', async () => {
        await expect(connectExtensionWallet()).rejects.toBeInstanceOf(
            ExtensionUnavailableError,
        );
        expect(readExtensionWalletPreference()).toBe(false);
    });

    it('runs the provider connect and persists the preference on success', async () => {
        const provider = makeProvider();
        window.xchain = provider;
        const result = await connectExtensionWallet({ chains: ['bitcoin-mainnet'] });
        expect(provider.connect).toHaveBeenCalledWith({ chains: ['bitcoin-mainnet'] });
        expect(result).toEqual(CONNECT_SUCCESS);
        expect(readExtensionWalletPreference()).toBe(true);
    });

    it('does NOT persist the preference when the user rejects the connect', async () => {
        const provider = makeProvider({
            connect: vi.fn().mockRejectedValue(new Error('User rejected')),
        });
        window.xchain = provider;
        await expect(connectExtensionWallet()).rejects.toThrow('User rejected');
        expect(readExtensionWalletPreference()).toBe(false);
    });

    // The published ConnectResult is a UNION, so a refusal RESOLVES
    // with `ok: false`. Persisting on any resolve flipped the web app into
    // extension-wallet mode against a session the wallet never granted.
    for (const refusal of [
        { ok: false, error: 'USER_REJECTED' },
        { ok: false, error: 'BLOCKED_BY_USER' },
        { ok: false, error: 'BRIDGE_VERSION_MISMATCH', message: 'bridge: BRIDGE_VERSION_MISMATCH' },
        { ok: false, error: 'THROTTLED', retryAfterMs: 4000 },
    ]) {
        it(`does NOT persist the preference on a resolved ${refusal.error} result`, async () => {
            window.xchain = makeProvider({
                connect: vi.fn().mockResolvedValue(refusal),
            });
            const result = await connectExtensionWallet();
            expect(result).toEqual(refusal);
            expect(readExtensionWalletPreference()).toBe(false);
        });
    }
});

describe('disableExtensionWallet', () => {
    it('clears a previously-set preference', () => {
        writeExtensionWalletPreference(true);
        disableExtensionWallet();
        expect(readExtensionWalletPreference()).toBe(false);
    });
});

describe('bridge-native forwarding helpers', () => {
    it('each helper throws ExtensionUnavailableError with no provider', () => {
        expect(() => forwardGetAccounts()).toThrow(ExtensionUnavailableError);
        expect(() => forwardGetAddresses('bitcoin-mainnet')).toThrow(ExtensionUnavailableError);
        expect(() => forwardGetBalances('bitcoin-mainnet', 'addr')).toThrow(ExtensionUnavailableError);
        expect(() => forwardGetSupportedChains()).toThrow(ExtensionUnavailableError);
        expect(() => forwardSignMessage({})).toThrow(ExtensionUnavailableError);
        expect(() => forwardSignAction({})).toThrow(ExtensionUnavailableError);
        expect(() => forwardSignPsbt({})).toThrow(ExtensionUnavailableError);
    });

    it('forwards to the provider with the bridge-native argument shapes', async () => {
        const provider = makeProvider();
        window.xchain = provider;

        await forwardGetAccounts();
        expect(provider.getAccounts).toHaveBeenCalledTimes(1);

        await forwardGetAddresses('bitcoin-mainnet');
        expect(provider.getAddresses).toHaveBeenCalledWith('bitcoin-mainnet');

        await forwardGetBalances('bitcoin-mainnet', 'bc1qaddr');
        expect(provider.getBalances).toHaveBeenCalledWith('bitcoin-mainnet', 'bc1qaddr');

        await forwardGetSupportedChains();
        expect(provider.getSupportedChains).toHaveBeenCalledTimes(1);

        const msg = { chainId: 'bitcoin-mainnet', address: 'bc1qaddr', message: 'hi' };
        await forwardSignMessage(msg);
        expect(provider.signMessage).toHaveBeenCalledWith(msg);

        const act = { chainId: 'bitcoin-mainnet', action: { type: 'SEND' } };
        await forwardSignAction(act);
        expect(provider.signAction).toHaveBeenCalledWith(act);

        const psbt = { chainId: 'bitcoin-mainnet', psbtHex: 'abcd' };
        await forwardSignPsbt(psbt);
        expect(provider.signPsbt).toHaveBeenCalledWith(psbt);
    });
});
