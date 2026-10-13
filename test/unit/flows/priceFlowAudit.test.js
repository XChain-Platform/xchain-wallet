// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { clearAlert, markAlertTriggered, rearmAlert, saveAlert } from '../../../packages/core/src/flows/priceAlerts.js';
import { createPriceOracle } from '../../../packages/core/src/flows/priceOracle.js';
import { checkReachability } from '../../../packages/core/src/flows/reachability.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

let hookMessaging;
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: hookMessaging }),
}));

const { usePriceAlerts } = await import('../../../packages/core/src/shared/hooks/usePriceAlerts.js');

function response(data) {
    return { ok: true, status: 200, json: vi.fn(async () => data) };
}

describe('price flow failure handling', () => {
    it('rejects malformed request keys before contacting the provider', async () => {
        const fetch = vi.fn();
        const oracle = createPriceOracle({ fetch });

        await expect(oracle.getNativePrices({ chainIds: [null] }))
            .rejects.toThrow('chainIds must contain non-empty strings');
        await expect(oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'], fiatCurrency: 'US/D' }))
            .rejects.toThrow('fiatCurrency must be a three-letter currency code');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a malformed batched spot result without partly replacing cached prices', async () => {
        let now = 0;
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({
                bitcoin: { usd: 60000 },
                litecoin: { usd: 80 },
            }))
            .mockResolvedValueOnce(response({
                bitcoin: { usd: 61000 },
            }));
        const oracle = createPriceOracle({ fetch, now: () => now });
        const request = { chainIds: ['bitcoin-mainnet', 'litecoin-mainnet'] };
        const initial = await oracle.getNativePrices(request);

        now = 6 * 60 * 1000;
        const failed = await oracle.getNativePrices(request);

        expect(failed.error).toMatch(/no valid USD price for litecoin/);
        expect(failed.prices).toEqual(initial.prices);
    });

    it('reports malformed sparkline data while retaining the valid spot price', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ bitcoin: { usd: 60000 } }))
            .mockResolvedValueOnce(response({ prices: [] }));
        const oracle = createPriceOracle({ fetch });

        const result = await oracle.getNativePrices({
            chainIds: ['bitcoin-mainnet'],
            includeSparkline: true,
        });

        expect(result.prices['bitcoin-mainnet'].priceFiat).toBe(60000);
        expect(result.error).toMatch(/no valid price history for bitcoin/);
    });
});

describe('price alert wallet ownership', () => {
    /** @type {Vault} */
    let vault;

    beforeEach(async () => {
        vault = new Vault({
            backend: new InMemoryBackend(),
            masterKey: new Uint8Array(32).fill(7),
        });
        await vault.open();
    });

    it('does not clear or rearm an alert through another wallet', async () => {
        const alert = await saveAlert({
            vault,
            walletId: 'wallet-1',
            chainId: 'bitcoin-mainnet',
            direction: 'above',
            targetFiat: 70000,
            fiatCurrency: 'usd',
        });
        await markAlertTriggered({ vault, id: alert.id });

        expect(await clearAlert({ vault, id: alert.id, walletId: 'wallet-2' })).toBe(false);
        expect(await rearmAlert({ vault, id: alert.id, walletId: 'wallet-2' })).toBeNull();
        expect((await vault.priceAlerts.get(alert.id)).status).toBe('triggered');

        expect(await rearmAlert({ vault, id: alert.id, walletId: 'wallet-1' }))
            .toMatchObject({ status: 'armed' });
        expect(await clearAlert({ vault, id: alert.id, walletId: 'wallet-1' })).toBe(true);
    });

    it('sends the active wallet with renderer clear and rearm requests', async () => {
        hookMessaging = {
            listPriceAlertsForWallet: vi.fn(async () => []),
            savePriceAlert: vi.fn(),
            clearPriceAlert: vi.fn(async () => true),
            rearmPriceAlert: vi.fn(async () => null),
        };
        const { result } = renderHook(() => usePriceAlerts('wallet-1'));
        await waitFor(() => expect(hookMessaging.listPriceAlertsForWallet).toHaveBeenCalled());

        await act(async () => result.current.removeAlert('alert-1'));
        await act(async () => result.current.rearm('alert-2'));

        expect(hookMessaging.clearPriceAlert).toHaveBeenCalledWith({ id: 'alert-1', walletId: 'wallet-1' });
        expect(hookMessaging.rearmPriceAlert).toHaveBeenCalledWith({ id: 'alert-2', walletId: 'wallet-1' });
    });
});

describe('reachability failure classification', () => {
    it('does not turn a network failure into success because its URL contains status', async () => {
        const sdk = {
            pingHub: async () => true,
            pingEncoder: async () => true,
            getStatus: async () => {
                throw new Error('Explorer request failed: Network Error for /TBTC/api/status');
            },
            explorer: { coin: 'TBTC' },
        };

        const result = await checkReachability({
            sdkRegistry: { get: () => sdk },
            chainIds: ['bitcoin-testnet'],
            timeoutMs: 100,
        });

        expect(result.perChain[0].services.explorer).toBe('unreachable');
        expect(result.perChain[0].mode).toBe('degraded');
    });

    it('rejects false encoder pings and invalid timeout configuration', async () => {
        const sdk = {
            pingHub: async () => true,
            pingEncoder: async () => false,
            explorer: { _get: async () => ({ ok: true }) },
        };
        const sdkRegistry = { get: () => sdk };

        const result = await checkReachability({
            sdkRegistry,
            chainIds: ['bitcoin-testnet'],
            timeoutMs: 100,
        });
        expect(result.perChain[0].services.encoder).toBe('unreachable');
        await expect(checkReachability({ sdkRegistry, chainIds: ['bitcoin-testnet'], timeoutMs: 0 }))
            .rejects.toThrow('timeoutMs must be a positive number');
    });
});
