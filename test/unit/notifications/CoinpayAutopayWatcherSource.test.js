// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Auto-pay source resolution: the record that signs must be owned by the
// consent's wallet and be a software-signable address. Duplicated address
// strings across wallets, watch-only copies, device addresses and
// ambiguous matches must never reach coinpayAction or take a hold.

import { describe, it, expect, vi } from 'vitest';
import { CoinpayAutopayWatcher } from '../../../packages/core/src/notifications/CoinpayAutopayWatcher.js';
import { resolveAutopaySource } from '../../../packages/core/src/notifications/autopaySource.js';

const NOW = 1_800_000_000_000;
const ADDR = 'addr-payer';

const chainRegistry = {
    get: vi.fn(() => ({ coin: 'bitcoin' })),
    chainIdFor: vi.fn((chain, network) => `${chain}-${network}`),
};

function addr(id, over = {}) {
    return {
        id, chain: 'bitcoin', network: 'regtest', address: ADDR, publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0", source: 'hd', accountId: 'acct-w2', signerId: null, ...over,
    };
}

function makeVault(addresses, { importedKeys = [] } = {}) {
    const consent = {
        schemaVersion: 1, id: 'bitcoin-regtest::aa', walletId: 'w2', chainId: 'bitcoin-regtest',
        sourceAddress: ADDR, txid: 'aa', orderActionIndex: '500', giveCoinAmount: '0.05',
        getTick: 'PEPE', getAmount: '1000', autopay: true, payments: [], createdAt: new Date(0).toISOString(),
    };
    return {
        consent,
        autopayOrders: { get: vi.fn(async () => consent), put: vi.fn(async () => {}), list: vi.fn(async () => [consent]) },
        autopayLeases: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
        pendingTxs: { list: vi.fn(async () => []) },
        addresses: { list: vi.fn(async () => addresses) },
        accounts: { get: vi.fn(async (id) => ({ 'acct-w1': { id, walletId: 'w1' }, 'acct-w2': { id, walletId: 'w2' } })[id] ?? null) },
        wallets: { get: vi.fn(async (id) => (id === 'w2' ? { id, importedKeys } : null)) },
    };
}

function makeSdk() {
    const sdk = {
        getStatus: vi.fn(async () => ({ last_block: { RBTC: 101 } })),
        explorer: { coin: 'RBTC' },
        getCoinpayObligations: vi.fn(async () => ({ data: [{
            action_index: '900', payer_address: ADDR, payee_address: 'addr-seller', coin: 'BTC',
            coin_amount: '0.005', expiration: Math.floor(NOW / 1000) + 7000, block_index: 100,
            coinpay_status: 'pending_coinpay',
        }] })),
        getOrderMatches: vi.fn(async () => ({ data: [{
            action_index: '900', give_action_index: '600', get_action_index: '500',
            give_amount: '0.005', get_amount: '100', settlement_type: 'coinpay', status: 'pending_coinpay',
        }] })),
        getTransaction: vi.fn(async () => null),
        onCoinpayRequired: vi.fn(() => () => {}),
    };
    return { get: vi.fn(() => sdk) };
}

async function run(addresses, opts) {
    const vault = makeVault(addresses, opts);
    const ledger = { reserve: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const notify = vi.fn(async () => {});
    const recordAlert = vi.fn(async () => {});
    const coinpayAction = vi.fn(async ({ onProgress }) => {
        onProgress?.('broadcast');
        return { txid: 'paytx1' };
    });
    const watcher = new CoinpayAutopayWatcher({
        vault, sdkRegistry: makeSdk(), chainRegistry,
        getSigner: vi.fn(() => ({ id: 'signer-w2' })),
        getSettings: vi.fn(async () => ({ notifications: { incomingReceipts: true } })),
        reservationLedger: ledger, notify, recordAlert, shellKind: 'web', intervalMs: 60_000,
        now: () => NOW, coinpayAction,
    });
    await watcher.pollOnce();
    return { notify, recordAlert, ledger, coinpayAction, watcher };
}

function refusedWith(_reason, { notify, recordAlert, ledger, coinpayAction, watcher }) {
    expect(coinpayAction).not.toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
    expect(watcher.attemptedMatches()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(recordAlert).toHaveBeenCalledTimes(1);
    expect(recordAlert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'payment-due:bitcoin-regtest:900',
        attention: 'autopay-cannot-sign',
    }));
}

describe('auto-pay source is scoped to the consent wallet', () => {
    it('pays from the consent wallet record when another wallet lists the same address first', async () => {
        const res = await run([addr('other', { accountId: 'acct-w1' }), addr('mine')]);
        expect(res.coinpayAction).toHaveBeenCalledTimes(1);
        expect(res.coinpayAction.mock.calls[0][0].from.id).toBe('mine');
        expect(res.coinpayAction.mock.calls[0][0].signer).toEqual({ id: 'signer-w2' });
    });

    it('skips a watch-only copy listed before the signable record', async () => {
        const res = await run([addr('watch', { source: 'watch-only' }), addr('mine')]);
        expect(res.coinpayAction.mock.calls[0][0].from.id).toBe('mine');
    });

    it('resolves an imported key through the wallet importedKeys list', async () => {
        const imported = addr('imp', { source: 'imported-wif', accountId: null, derivationPath: undefined });
        const res = await run([imported], { importedKeys: [{ addressId: 'imp' }] });
        expect(res.coinpayAction).toHaveBeenCalledTimes(1);
        expect(res.coinpayAction.mock.calls[0][0].from.id).toBe('imp');
    });

    it('does not use an imported key that only another wallet holds', async () => {
        const imported = addr('imp', { source: 'imported-wif', accountId: null, derivationPath: undefined });
        refusedWith('source-missing', await run([imported], { importedKeys: [] }));
    });

    it('reports source-missing when only another wallet has the address', async () => {
        refusedWith('source-missing', await run([addr('other', { accountId: 'acct-w1' })]));
    });

    it('refuses two matching records in the consent wallet before any hold', async () => {
        const res = await run([addr('a'), addr('b')]);
        refusedWith('source-ambiguous', res);
    });
});

describe('auto-pay never signs a device or unknown source with the pooled signer', () => {
    it('refuses a trezor-derived source in a wallet that also holds a seed', async () => {
        refusedWith('hardware-source', await run([addr('hw', { source: 'trezor', signerId: 'sg1' })]));
    });

    it('refuses a ledger-derived source', async () => {
        refusedWith('hardware-source', await run([addr('hw', { source: 'ledger', signerId: 'sg1' })]));
    });

    it('refuses an unknown source tag', async () => {
        refusedWith('unsignable-source', await run([addr('x', { source: 'mystery' })]));
    });

    it('a watch-only record alone reads as source-missing', async () => {
        const res = await run([addr('watch', { source: 'watch-only' })]);
        refusedWith('source-missing', res);
    });
});

describe('resolveAutopaySource', () => {
    it('falls back to source-missing when the vault reads throw', async () => {
        const vault = makeVault([addr('mine')]);
        vault.wallets.get = vi.fn(async () => { throw new Error('vault closed'); });
        const out = await resolveAutopaySource({ vault, chainRegistry, consent: vault.consent, chainId: 'bitcoin-regtest' });
        expect(out).toEqual({ record: null, reason: 'source-missing' });
    });

    it('ignores records on another chain', async () => {
        const vault = makeVault([addr('mine', { network: 'testnet' })]);
        const out = await resolveAutopaySource({ vault, chainRegistry, consent: vault.consent, chainId: 'bitcoin-regtest' });
        expect(out.reason).toBe('source-missing');
    });
});
