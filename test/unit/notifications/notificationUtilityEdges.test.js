// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveAddressPoll, isVaultLockedError } from '../../../packages/core/src/notifications/activeAddressPoll.js';
import { getActiveAddresses } from '../../../packages/core/src/notifications/getActiveAddresses.js';
import {
    getBroadcastTxids,
    markPendingTxIndexed,
} from '../../../packages/core/src/notifications/pendingTxBridge.js';
import { isWithinQuietHours } from '../../../packages/core/src/notifications/quietHours.js';
import { taggedLogger } from '../../../packages/core/src/notifications/taggedLogger.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('active address helper edges', () => {
    it('rejects missing storage and registry dependencies before reading', async () => {
        await expect(getActiveAddresses(null, {})).rejects.toThrow('vault is required');
        await expect(getActiveAddresses({}, null)).rejects.toThrow('chainRegistry is required');
    });

    it('filters unusable, demo, foreign-network, unknown-chain, and duplicate rows', async () => {
        const vault = {
            addresses: { list: vi.fn(async () => [
                null,
                { accountId: 'real-account', address: '' },
                { accountId: 'demo-account', address: 'demo', chain: 'bitcoin', network: 'mainnet' },
                { accountId: 'real-account', address: 'test', chain: 'bitcoin', network: 'testnet' },
                { accountId: 'real-account', address: 'unknown', chain: 'unknown', network: 'mainnet' },
                { accountId: 'real-account', address: 'same', chain: 'bitcoin', network: 'mainnet' },
                { accountId: 'real-account', address: 'same', chain: 'bitcoin', network: 'mainnet' },
                { address: 'fallback', chain: 'litecoin', network: 'mainnet' },
            ]) },
            accounts: { list: vi.fn(async () => [
                { id: 'demo-account', walletId: 'demo-wallet' },
                { id: 'real-account', walletId: 'real-wallet' },
            ]) },
            wallets: { list: vi.fn(async () => [
                { id: 'demo-wallet', origin: 'demo' },
                { id: 'real-wallet', origin: 'created' },
            ]) },
        };
        const chainRegistry = {
            chainIdFor: vi.fn((chain, network) => chain === 'unknown' ? null : `${chain}-${network}`),
            descriptorFor: vi.fn((chainId) => chainId.startsWith('bitcoin') ? { displayName: 'Bitcoin' } : null),
        };

        await expect(getActiveAddresses(vault, chainRegistry, { activeNetwork: 'mainnet' })).resolves.toEqual([
            { address: 'same', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' },
            { address: 'fallback', chainId: 'litecoin-mainnet', label: 'litecoin', network: 'mainnet' },
        ]);
    });
});

describe('ActiveAddressPoll edge behavior', () => {
    it('recognizes only vault lock errors and tolerates non-array success values', async () => {
        expect(isVaultLockedError(null)).toBe(false);
        expect(isVaultLockedError('Vault is closed')).toBe(false);
        expect(isVaultLockedError({ name: 'VaultStateError' })).toBe(true);
        expect(isVaultLockedError({ message: 'wrapped VaultStateError: vault not open' })).toBe(true);
        expect(isVaultLockedError({ message: 'Vault is closed' })).toBe(true);
        expect(isVaultLockedError(new Error('network closed'))).toBe(false);

        const poll = new ActiveAddressPoll({
            getActiveAddresses: vi.fn(async () => ({ address: 'not-an-array' })),
            intervalMs: 100,
            logger: { error: vi.fn() },
            owner: 'test',
        });
        await expect(poll.read()).resolves.toEqual([]);
    });

    it('caps repeated-failure backoff at eight intervals', async () => {
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const readAddresses = vi.fn(async () => { throw new Error('offline'); });
        const logger = { error: vi.fn() };
        const poll = new ActiveAddressPoll({
            getActiveAddresses: readAddresses,
            intervalMs: 100,
            logger,
            owner: 'test',
        });

        for (const dueAt of [0, 100, 300, 700, 1_500]) {
            now = dueAt;
            await poll.read();
        }
        now = 2_299;
        await poll.read();
        expect(readAddresses).toHaveBeenCalledTimes(5);
        now = 2_300;
        await poll.read();
        expect(readAddresses).toHaveBeenCalledTimes(6);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

describe('taggedLogger edge behavior', () => {
    it('redacts error detail and supplies safe text for non-string messages', () => {
        const sink = {
            prefix: 'bound',
            debug: vi.fn(function debug(...args) { expect(this.prefix).toBe('bound'); return args; }),
            error: vi.fn(),
        };
        const log = taggedLogger(sink, 'edge');
        const secret = new Error('token=secret');
        secret.name = 'CustomTransportError';

        log.debug({ unsafe: true }, new TypeError('private payload'));
        log.error('request failed', secret);
        log.warn('missing sink method', secret);

        expect(sink.debug).toHaveBeenCalledWith('[edge] diagnostic event', '<TypeError>');
        expect(sink.error).toHaveBeenCalledWith('[edge] request failed', '<Error>');
        expect(JSON.stringify(sink.mock?.calls || sink.error.mock.calls)).not.toContain('secret');
    });

    it('uses no-op methods when no sink is provided', () => {
        const log = taggedLogger(null, 'edge');
        expect(() => {
            log.debug('a');
            log.warn('b');
            log.error('c');
        }).not.toThrow();
    });
});

describe('quiet-hour malformed boundaries', () => {
    const at = (hour, minute) => new Date(2026, 0, 1, hour, minute);

    it('rejects non-string and out-of-range endpoints', () => {
        for (const [start, end] of [
            [null, '08:00'],
            ['22:00', 800],
            ['24:00', '08:00'],
            ['22:00', '08:60'],
            ['2:00', '08:00'],
        ]) {
            expect(isWithinQuietHours({ quietHours: { enabled: true, start, end } }, at(23, 0))).toBe(false);
        }
    });

    it('includes midnight at the start and excludes the exact end', () => {
        const settings = { quietHours: { enabled: true, start: '00:00', end: '00:01' } };
        expect(isWithinQuietHours(settings, at(0, 0))).toBe(true);
        expect(isWithinQuietHours(settings, at(0, 1))).toBe(false);
    });
});

describe('pending transaction bridge edges', () => {
    function makeVault(rows) {
        const writes = [];
        return {
            pendingTxs: {
                list: vi.fn(async () => rows),
                findBy: vi.fn(async (_field, txid) => rows.filter((row) => row.txid === txid)),
                put: vi.fn(async (row) => { writes.push(row); }),
            },
            writes,
        };
    }

    it('guards missing inputs before touching storage', async () => {
        const vault = makeVault([]);
        await expect(markPendingTxIndexed(null, 'tx')).resolves.toBe(false);
        await expect(markPendingTxIndexed(vault, '')).resolves.toBe(false);
        expect(vault.pendingTxs.findBy).not.toHaveBeenCalled();
    });

    it('marks every non-indexed match and preserves an existing confirmation time', async () => {
        const vault = makeVault([
            { id: 'a', txid: 'tx', status: 'broadcast', confirmedAt: 'first' },
            { id: 'b', txid: 'tx', status: 'signed', confirmedAt: null },
            { id: 'c', txid: 'tx', status: 'indexed', confirmedAt: 'indexed' },
        ]);
        const now = vi.fn(() => 'later');

        await expect(markPendingTxIndexed(vault, 'tx', {
            now,
            inclusion: { blockIndex: 42 },
        })).resolves.toBe(true);
        expect(vault.writes).toEqual([
            expect.objectContaining({ id: 'a', status: 'indexed', confirmedAt: 'first', chainConfirmed: true, confirmedBlockIndex: 42 }),
            expect.objectContaining({ id: 'b', status: 'indexed', confirmedAt: 'later', chainConfirmed: true, confirmedBlockIndex: 42 }),
        ]);
        expect(now).toHaveBeenCalledTimes(1);
    });

    it('normalizes an unusable inclusion height to null', async () => {
        const vault = makeVault([{ id: 'a', txid: 'tx', status: 'broadcast' }]);
        await markPendingTxIndexed(vault, 'tx', { now: () => 'stamp', inclusion: { blockIndex: 0 } });
        expect(vault.writes[0]).toMatchObject({ chainConfirmed: true, confirmedBlockIndex: null });
    });

    it('deduplicates broadcast txids and skips malformed rows', async () => {
        const vault = makeVault([
            null,
            { txid: 'same', status: 'broadcast' },
            { txid: 'same', status: 'broadcast' },
            { txid: 'other', status: 'signed' },
        ]);
        await expect(getBroadcastTxids(vault)).resolves.toEqual(new Set(['same']));
    });
});
