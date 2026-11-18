// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The five-minute reuse rule's shared parts: the age check, the stale mark a
// broadcast leaves, the broadcast route list the shell transports read, and
// My Tokens' saved ownership read.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import {
    BALANCE_MAX_AGE_MS,
    WALLET_DATA_STALE_KEY,
    isWalletDataFresh,
    markWalletDataStale,
    readTimeOf,
    subscribeWalletDataStale,
} from '../../../../packages/core/src/shared/utils/walletDataFreshness.js';
import { isBroadcastMessageType } from '../../../../packages/core/src/shared/utils/broadcastRoutes.js';
import { QUIT_DEFERRING_MESSAGE_TYPES } from '../../../../packages/desktop/main/quitGuard.js';
import {
    ownedTokensAddressKey,
    readFreshOwnedTokens,
    writeOwnedTokensCache,
} from '../../../../packages/core/src/shared/utils/ownedTokensCache.js';
import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyTokens } from '../../../../packages/core/src/shared/routes/MyTokens.jsx';

afterEach(() => cleanup());

describe('wallet data freshness', () => {
    it('is fresh under five minutes and stale at five', () => {
        const now = 10_000_000;
        expect(isWalletDataFresh(now - 60_000, now)).toBe(true);
        expect(isWalletDataFresh(now - BALANCE_MAX_AGE_MS + 1, now)).toBe(true);
        expect(isWalletDataFresh(now - BALANCE_MAX_AGE_MS, now)).toBe(false);
        expect(isWalletDataFresh(null, now)).toBe(false);
        // A read stamped ahead of the clock is not trusted.
        expect(isWalletDataFresh(now + 1, now)).toBe(false);
    });

    it('a broadcast makes every earlier read stale and is stored for other windows', () => {
        const readAt = Date.now() - 1000;
        expect(isWalletDataFresh(readAt)).toBe(true);
        const heard = vi.fn();
        const stop = subscribeWalletDataStale(heard);
        markWalletDataStale();
        stop();
        expect(heard).toHaveBeenCalledTimes(1);
        expect(isWalletDataFresh(readAt)).toBe(false);
        expect(Number(localStorage.getItem(WALLET_DATA_STALE_KEY))).toBeGreaterThan(readAt);
    });

    it('hears a stale mark another window stored', () => {
        const heard = vi.fn();
        const stop = subscribeWalletDataStale(heard);
        window.dispatchEvent(new StorageEvent('storage', { key: WALLET_DATA_STALE_KEY, newValue: '1' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '1' }));
        stop();
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('a read that spans a broadcast counts from its start, so it stays stale', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const startedAt = Date.now();
            vi.setSystemTime(startedAt + 500);
            expect(readTimeOf(startedAt)).toBe(startedAt + 500);
            markWalletDataStale();
            vi.setSystemTime(startedAt + 900);
            expect(readTimeOf(startedAt)).toBe(startedAt);
            expect(isWalletDataFresh(readTimeOf(startedAt))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('broadcast routes', () => {
    it('names signing and broadcast routes, never previews, quotes or reads', () => {
        for (const type of ['action.send', 'action.send.hw', 'broadcast.signedTx', 'tx.replace', 'action.fileMultipart']) {
            expect(isBroadcastMessageType(type)).toBe(true);
        }
        for (const type of ['action.composeForConfirm', 'action.preflight', 'action.quoteMaxSendable', 'action.send.psbt', 'wallet.balances', 'broadcast.queue.enqueue']) {
            expect(isBroadcastMessageType(type)).toBe(false);
        }
    });

    it('is the list the desktop quit guard waits on, plus a queue enqueue', () => {
        const quitOnly = [...QUIT_DEFERRING_MESSAGE_TYPES].filter((type) => !isBroadcastMessageType(type));
        expect(quitOnly).toEqual(['broadcast.queue.enqueue']);
    });
});

describe('My Tokens reuses a fresh ownership read', () => {
    const BY_CHAIN = { 'bitcoin-regtest': [{ id: 'a', address: 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt' }] };
    const TOKEN = { tick: 'SAVEDTOK', description: 'saved', locked: false, divisibility: 8, totalSupply: '1', maxSupply: null, youOwn: true };

    function mount() {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue(BY_CHAIN),
            getOwnedTokens: vi.fn().mockResolvedValue([TOKEN]),
        };
        const proxy = new Proxy(messaging, {
            get(t, prop) {
                if (prop in t) return t[prop];
                return () => Promise.resolve({ rows: [] });
            },
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={proxy}>
                <MyTokens walletId="w-saved" onBack={() => {}} onIssue={() => {}} onSelectTick={() => {}} />
            </MessagingProvider>,
        );
        return messaging;
    }

    it('reads once, then a reopen inside five minutes reads nothing', async () => {
        const first = mount();
        await screen.findByRole('button', { name: 'Open SAVEDTOK token details' });
        expect(first.getOwnedTokens).toHaveBeenCalledTimes(1);
        cleanup();

        const second = mount();
        await screen.findByRole('button', { name: 'Open SAVEDTOK token details' });
        expect(second.getOwnedTokens).not.toHaveBeenCalled();
    });

    it('a saved list for another address set is not reused', () => {
        const key = ownedTokensAddressKey(BY_CHAIN);
        writeOwnedTokensCache('w-other', key, [TOKEN], Date.now());
        expect(readFreshOwnedTokens('w-other', key)).toEqual([TOKEN]);
        expect(readFreshOwnedTokens('w-other', `${key},bitcoin-regtest|mnew`)).toBeNull();
        markWalletDataStale({ now: Date.now() + 1 });
        expect(readFreshOwnedTokens('w-other', key)).toBeNull();
    });
});
