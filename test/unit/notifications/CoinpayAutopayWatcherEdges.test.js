// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    CoinpayAutopayWatcher,
    pendingTxReferencesMatch,
} from '../../../packages/core/src/notifications/CoinpayAutopayWatcher.js';

function consent(overrides = {}) {
    return {
        id: 'bitcoin-mainnet::tx',
        walletId: 'wallet',
        chainId: 'bitcoin-mainnet',
        sourceAddress: 'mine',
        txid: 'tx',
        orderActionIndex: '5',
        autopay: true,
        payments: [],
        ...overrides,
    };
}

function vaultWith(consents = []) {
    return {
        autopayOrders: {
            list: vi.fn(async () => consents),
            get: vi.fn(),
            put: vi.fn(),
        },
        autopayLeases: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
        pendingTxs: { list: vi.fn(async () => []) },
        addresses: { list: vi.fn(async () => []) },
    };
}

function makeLogger() {
    return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeWatcher(overrides = {}) {
    const logger = overrides.logger || makeLogger();
    const notify = overrides.notify || vi.fn(async () => {});
    const watcher = new CoinpayAutopayWatcher({
        vault: overrides.vault || vaultWith(),
        sdkRegistry: overrides.sdkRegistry || { get: vi.fn(() => ({})) },
        chainRegistry: overrides.chainRegistry || {
            get: vi.fn(() => ({ coin: 'bitcoin' })),
            chainIdFor: vi.fn((chain, network) => `${chain}-${network}`),
        },
        getSigner: overrides.getSigner || vi.fn(() => null),
        getSettings: overrides.getSettings || vi.fn(async () => ({ notifications: { incomingReceipts: true } })),
        reservationLedger: overrides.reservationLedger,
        notify,
        shellKind: overrides.shellKind || 'web',
        logger,
        coinpayAction: vi.fn(),
    });
    return { watcher, logger, notify };
}

describe('pendingTxReferencesMatch edge parsing', () => {
    it('rejects malformed records and non-numeric match ids', () => {
        expect(pendingTxReferencesMatch(null, '1')).toBe(false);
        expect(pendingTxReferencesMatch({ action: 'SEND' }, '1')).toBe(false);
        expect(pendingTxReferencesMatch({ action: 'COINPAY', actionSummary: 'match #1' }, '1|2')).toBe(false);
    });

    it('falls back to summary matching when structured params disagree', () => {
        const tx = {
            action: 'COINPAY',
            params: { ORDER_MATCH_ACTION_INDEX: '901' },
            actionSummary: 'Paid ORDER_MATCH #900 manually',
        };
        expect(pendingTxReferencesMatch(tx, '900')).toBe(true);
    });

    it('enforces a digit boundary after the match index', () => {
        const exact = { action: 'COINPAY', actionSummary: 'Auto-paid match #900 for order #5' };
        const longer = { action: 'COINPAY', actionSummary: 'Auto-paid match #9001 for order #5' };
        expect(pendingTxReferencesMatch(exact, '900')).toBe(true);
        expect(pendingTxReferencesMatch(longer, '900')).toBe(false);
    });
});

describe('CoinpayAutopayWatcher dependency guards', () => {
    it('names every missing dependency and rejects an unsupported shell', () => {
        const valid = {
            vault: vaultWith(),
            sdkRegistry: { get: vi.fn() },
            chainRegistry: { get: vi.fn(), chainIdFor: vi.fn() },
            getSigner: vi.fn(),
            getSettings: vi.fn(),
            notify: vi.fn(),
            shellKind: 'web',
        };
        for (const key of ['vault', 'sdkRegistry', 'chainRegistry', 'getSigner', 'getSettings', 'notify']) {
            expect(() => new CoinpayAutopayWatcher({ ...valid, [key]: null })).toThrow(key);
        }
        expect(() => new CoinpayAutopayWatcher({ ...valid, shellKind: 'mobile' })).toThrow('shellKind');
    });
});

describe('CoinpayAutopayWatcher orchestration fallbacks', () => {
    it('returns quietly when refresh cannot read consent records', async () => {
        const vault = vaultWith();
        vault.autopayOrders.list.mockRejectedValue(new Error('vault closed'));
        const sdkRegistry = { get: vi.fn() };
        const { watcher } = makeWatcher({ vault, sdkRegistry });

        await expect(watcher.refresh()).resolves.toBeUndefined();
        expect(sdkRegistry.get).not.toHaveBeenCalled();
    });

    it('subscribes once per armed address and isolates unsupported and throwing SDKs', async () => {
        const rows = [
            consent(),
            consent({ id: 'duplicate', txid: 'tx-2' }),
            consent({ id: 'off', sourceAddress: 'off', autopay: false }),
            consent({ id: 'unsupported', chainId: 'litecoin-mainnet', sourceAddress: 'ltc' }),
            consent({ id: 'throwing', chainId: 'dogecoin-mainnet', sourceAddress: 'doge' }),
        ];
        const unsubscribe = vi.fn();
        const bitcoin = { onCoinpayRequired: vi.fn(() => unsubscribe) };
        const sdkRegistry = {
            get: vi.fn((chainId) => {
                if (chainId === 'bitcoin-mainnet') return bitcoin;
                if (chainId === 'dogecoin-mainnet') throw new Error('SDK unavailable');
                return {};
            }),
        };
        const log = makeLogger();
        const { watcher } = makeWatcher({ vault: vaultWith(rows), sdkRegistry, logger: log });

        await watcher.refresh();
        expect(bitcoin.onCoinpayRequired).toHaveBeenCalledTimes(1);
        expect(watcher._unsubs).toEqual([unsubscribe]);
        expect(log.warn).toHaveBeenCalledWith(
            '[coinpay] CoinpayAutopayWatcher: WS subscribe failed',
            '<Error>',
        );
    });

    it('drops an overlapping poll while the current cycle is pending', async () => {
        let finish;
        const { watcher } = makeWatcher();
        watcher._cycle = vi.fn(() => new Promise((resolve) => { finish = resolve; }));

        const first = watcher.pollOnce();
        await watcher.pollOnce();
        expect(watcher._cycle).toHaveBeenCalledTimes(1);
        finish();
        await first;
    });

    it('retries notification after settings fail, but deduplicates an adapter failure', async () => {
        const getSettings = vi.fn()
            .mockRejectedValueOnce(new Error('locked'))
            .mockResolvedValue({ notifications: { incomingReceipts: true } });
        const notify = vi.fn(async () => { throw new Error('host failed'); });
        const log = makeLogger();
        const { watcher } = makeWatcher({ getSettings, notify, logger: log });
        const payload = { kind: 'coinpay-autopay-manual', title: 'Attention', body: 'Open payments.' };

        await watcher._notifyOnce('9', 'locked', payload);
        await watcher._notifyOnce('9', 'locked', payload);
        await watcher._notifyOnce('9', 'locked', payload);
        expect(getSettings).toHaveBeenCalledTimes(2);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(log.error).toHaveBeenCalledWith(
            '[coinpay] CoinpayAutopayWatcher: getSettings failed',
            '<Error>',
        );
        expect(log.error).toHaveBeenCalledWith(
            '[coinpay] CoinpayAutopayWatcher: notify adapter threw',
            '<Error>',
        );
    });

    it('forgets a hold even when ledger release fails', async () => {
        const ledger = { reserve: vi.fn(), release: vi.fn(async () => { throw new Error('ledger down'); }) };
        const log = makeLogger();
        const { watcher } = makeWatcher({ reservationLedger: ledger, logger: log });
        watcher._holds.set('9', { reservationId: 'hold-9', chainId: 'bitcoin-mainnet' });

        await watcher._releaseHold('9');
        expect(watcher._holds.has('9')).toBe(false);
        expect(ledger.release).toHaveBeenCalledWith('hold-9');
        expect(log.warn).toHaveBeenCalledWith(
            '[coinpay] CoinpayAutopayWatcher: hold release failed',
            '<Error>',
        );
    });
});
