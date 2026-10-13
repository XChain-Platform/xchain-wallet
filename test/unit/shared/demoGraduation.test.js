// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: demo-mode exit primitives.
//
// Leg 2 of the demo funnel: the vault has ONE password. A real wallet
// created from inside the demo lands in a vault whose master key comes
// from the demo's throwaway password, so once the demo is gone the
// user's own password is refused and the wallet is unreachable. The
// add-wallet lane therefore refuses to grow a demo vault; it clears the
// demo first and carries the chosen lane across the reload the wipe
// needs. These are the pure pieces of that decision.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    POST_DEMO_INTENT_KEY,
    setPostDemoIntent,
    takePostDemoIntent,
    demoOwnsVaultPassword,
    readVaultOccupancy,
    isVaultEmpty,
    exitDemoWallet,
} from '../../../packages/core/src/shared/utils/demoGraduation.js';
import {
    getDemoWalletExpiry,
    getDemoWalletId,
    getDemoWalletPassword,
    isDemoWallet,
    markDemoWallet,
} from '../../../packages/core/src/flows/demoMode.js';

const DEMO_ID_KEY = 'xc:demoWalletId';

beforeEach(() => {
    globalThis.localStorage?.clear();
});

describe('demoOwnsVaultPassword', () => {
    it('is true only in the add lane with a live demo wallet', () => {
        expect(demoOwnsVaultPassword({ mode: 'add', demoWalletId: 'demo-1' })).toBe(true);
    });

    it('is false on the fresh-install lane, where the new wallet makes its own vault', () => {
        expect(demoOwnsVaultPassword({ mode: 'fresh', demoWalletId: 'demo-1' })).toBe(false);
    });

    it('is false when no demo is active, so normal multi-wallet vaults are untouched', () => {
        expect(demoOwnsVaultPassword({ mode: 'add', demoWalletId: null })).toBe(false);
        expect(demoOwnsVaultPassword({ mode: 'add', demoWalletId: '' })).toBe(false);
        expect(demoOwnsVaultPassword({ mode: 'add' })).toBe(false);
        expect(demoOwnsVaultPassword()).toBe(false);
    });
});

describe('post-demo onboarding intent', () => {
    it('round-trips the lane the user picked', () => {
        setPostDemoIntent('import');
        expect(takePostDemoIntent()).toBe('import');
    });

    it('is one-shot, so a stale lane cannot hijack a later visit to Welcome', () => {
        setPostDemoIntent('create');
        expect(takePostDemoIntent()).toBe('create');
        expect(takePostDemoIntent()).toBe(null);
    });

    it('refuses to store a lane the shell has no case for', () => {
        setPostDemoIntent('pair-partner');
        expect(globalThis.localStorage.getItem(POST_DEMO_INTENT_KEY)).toBe(null);
        expect(takePostDemoIntent()).toBe(null);
    });

    it('drops a handcrafted value on read and clears it', () => {
        globalThis.localStorage.setItem(POST_DEMO_INTENT_KEY, 'settings');
        expect(takePostDemoIntent()).toBe(null);
        expect(globalThis.localStorage.getItem(POST_DEMO_INTENT_KEY)).toBe(null);
    });

    it('returns null when nothing is pending', () => {
        expect(takePostDemoIntent()).toBe(null);
    });
});

describe('readVaultOccupancy', () => {
    it('separates empty from occupied from unreadable', async () => {
        expect(await readVaultOccupancy({ listWallets: async () => [] })).toBe('empty');
        expect(await readVaultOccupancy({ listWallets: async () => ({ wallets: [] }) })).toBe('empty');
        expect(await readVaultOccupancy({ listWallets: async () => [{ id: 'w1' }] })).toBe('occupied');
        expect(await readVaultOccupancy({ listWallets: async () => { throw new Error('locked'); } })).toBe('unknown');
        expect(await readVaultOccupancy({})).toBe('unknown');
        expect(await readVaultOccupancy(null)).toBe('unknown');
        expect(await readVaultOccupancy({ listWallets: async () => 'nope' })).toBe('unknown');
    });

    it('keeps isVaultEmpty failing closed', async () => {
        expect(await isVaultEmpty({ listWallets: async () => [] })).toBe(true);
        expect(await isVaultEmpty({ listWallets: async () => [{ id: 'w1' }] })).toBe(false);
        expect(await isVaultEmpty(null)).toBe(false);
    });
});

describe('exitDemoWallet', () => {
    function harness({ wallets = [], removeWallet } = {}) {
        const calls = { removed: [], wiped: 0, reloaded: 0 };
        const messaging = {
            listWallets: async () => wallets,
            removeWallet: removeWallet || (async ({ walletId }) => { calls.removed.push(walletId); }),
        };
        return {
            calls,
            messaging,
            wipe: async () => { calls.wiped += 1; },
            reload: () => { calls.reloaded += 1; return true; },
        };
    }

    it('removes the demo record, clears the flags, and wipes when nothing is left', async () => {
        markDemoWallet('demo-1', { password: 'throwaway-password', now: 1000 });
        const h = harness({ wallets: [] });
        const r = await exitDemoWallet({
            messaging: h.messaging,
            walletId: 'demo-1',
            wipe: h.wipe,
            reload: h.reload,
        });
        expect(r).toEqual({ wiped: true, reloaded: true, remaining: 'empty' });
        expect(h.calls.removed).toEqual(['demo-1']);
        expect(h.calls.wiped).toBe(1);
        expect(getDemoWalletId()).toBe(null);
        expect(getDemoWalletPassword()).toBe(null);
        expect(getDemoWalletExpiry()).toBe(null);
        expect(isDemoWallet('real-wallet-created-next')).toBe(false);
    });

    it('records the onboarding lane only on the wiping branch', async () => {
        const h = harness({ wallets: [] });
        await exitDemoWallet({
            messaging: h.messaging,
            walletId: 'demo-1',
            intent: 'create',
            wipe: h.wipe,
            reload: h.reload,
        });
        expect(takePostDemoIntent()).toBe('create');
    });

    it('keeps a real wallet alongside the demo: no wipe, no intent, no reload', async () => {
        const h = harness({ wallets: [{ id: 'real-1' }] });
        const r = await exitDemoWallet({
            messaging: h.messaging,
            walletId: 'demo-1',
            intent: 'create',
            wipe: h.wipe,
            reload: h.reload,
        });
        expect(r).toEqual({ wiped: false, reloaded: false, remaining: 'occupied' });
        expect(h.calls.wiped).toBe(0);
        expect(h.calls.reloaded).toBe(0);
        expect(takePostDemoIntent()).toBe(null);
    });

    it('reports an unreadable wallet list as a retryable failure instead of claiming success', async () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        const messaging = {
            listWallets: async () => { throw new Error('vault locked'); },
            removeWallet: async () => {},
        };
        let wiped = 0;
        await expect(exitDemoWallet({
            messaging,
            walletId: 'demo-1',
            intent: 'create',
            wipe: async () => { wiped += 1; },
            reload: () => true,
        })).rejects.toThrow(/could not verify/i);
        expect(wiped).toBe(0);
        expect(takePostDemoIntent()).toBe(null);
        expect(globalThis.localStorage.getItem(DEMO_ID_KEY)).toBe('demo-1');
    });

    it('falls back to the raw wallet.remove message when removeWallet is absent', async () => {
        const sent = [];
        const r = await exitDemoWallet({
            messaging: {
                listWallets: async () => [],
                sendMessage: async (type, req) => { sent.push([type, req]); },
            },
            walletId: 'demo-1',
            wipe: async () => {},
            reload: () => true,
        });
        expect(sent).toEqual([['wallet.remove', { walletId: 'demo-1' }]]);
        expect(r.wiped).toBe(true);
    });

    it('reports reloaded:false when the shell has no reload, so the caller still refreshes', async () => {
        const h = harness({ wallets: [] });
        const r = await exitDemoWallet({
            messaging: h.messaging,
            walletId: 'demo-1',
            wipe: h.wipe,
            reload: () => false,
        });
        expect(r).toEqual({ wiped: true, reloaded: false, remaining: 'empty' });
    });

    it('refuses to run without a wallet id', async () => {
        await expect(exitDemoWallet({ messaging: {}, walletId: '' })).rejects.toThrow(/walletId is required/);
    });

    it('does not wipe when removal fails and the remaining vault cannot be verified empty', async () => {
        let wiped = 0;
        await expect(exitDemoWallet({
            messaging: {
                listWallets: async () => { throw new Error('vault locked'); },
                removeWallet: async () => { throw new Error('remove failed'); },
            },
            walletId: 'demo-1',
            wipe: async () => { wiped += 1; },
            reload: () => true,
        })).rejects.toThrow(/remove failed/);
        expect(wiped).toBe(0);
    });

    it('retries the wipe when an earlier attempt removed the demo before the wipe failed', async () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        let removeCalls = 0;
        let wipeCalls = 0;
        const messaging = {
            listWallets: async () => [],
            removeWallet: async () => {
                removeCalls += 1;
                if (removeCalls > 1) throw new Error('wallet not found');
            },
        };
        const wipe = async () => {
            wipeCalls += 1;
            if (wipeCalls === 1) throw new Error('host storage is busy');
        };

        await expect(exitDemoWallet({
            messaging,
            walletId: 'demo-1',
            wipe,
            reload: () => true,
        })).rejects.toThrow(/host storage is busy/);
        expect(globalThis.localStorage.getItem(DEMO_ID_KEY)).toBe('demo-1');

        await expect(exitDemoWallet({
            messaging,
            walletId: 'demo-1',
            wipe,
            reload: () => true,
        })).resolves.toEqual({ wiped: true, reloaded: true, remaining: 'empty' });
        expect(removeCalls).toBe(2);
        expect(wipeCalls).toBe(2);
        expect(globalThis.localStorage.getItem(DEMO_ID_KEY)).toBe(null);
    });
});
