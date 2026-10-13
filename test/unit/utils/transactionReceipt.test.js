// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { transactionReceiptText } from '../../../packages/core/src/shared/utils/transactionReceipt.js';

const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

describe('transactionReceiptText', () => {
    it('shares only the selected receipt fields', () => {
        const receipt = transactionReceiptText({
            chainId: 'litecoin-testnet',
            timestamp: 1705350600,
            txHash: TXID,
            address: 'tltc1privatewalletaddress',
            source: 'tltc1privatesource',
            walletId: 'private-wallet-id',
            raw: {
                amount: '12.5',
                tick: 'PEPE',
                fee: '0.001',
                destination: 'tltc1privatedestination',
                memo: 'private memo',
            },
        });

        expect(receipt).toBe([
            'Date: 2024-01-15T20:30:00.000Z',
            'Chain: Litecoin Testnet',
            'Amount: 12.5 PEPE',
            'Network fee: 0.001 LTC',
            `Transaction ID: ${TXID}`,
            `Explorer: https://explorer.xchain.io/TLTC/tx/${TXID}`,
        ].join('\n'));
        expect(receipt).not.toMatch(/private|source|destination|memo|wallet-id/i);
    });

    it.each([
        ['bitcoin-mainnet', 'BTC'],
        ['bitcoin-testnet', 'TBTC'],
        ['bitcoin-regtest', 'RBTC'],
        ['litecoin-mainnet', 'LTC'],
        ['litecoin-testnet', 'TLTC'],
        ['litecoin-regtest', 'RLTC'],
        ['dogecoin-mainnet', 'DOGE'],
        ['dogecoin-testnet', 'TDOGE'],
        ['dogecoin-regtest', 'RDOGE'],
    ])('uses the %s transaction route', (chainId, coinCode) => {
        const receipt = transactionReceiptText({ chainId, txHash: TXID });
        const origin = chainId.endsWith('-regtest') ? 'http://localhost:18080' : 'https://explorer.xchain.io';
        expect(receipt).toContain(`Explorer: ${origin}/${coinCode}/tx/${TXID}`);
    });

    it('preserves amount privacy while balances are hidden', () => {
        const receipt = transactionReceiptText({
            chainId: 'bitcoin-mainnet',
            txHash: TXID,
            raw: { amount: '21', tick: 'BTC', fee: '0.0001' },
        }, { balancesHidden: true });

        expect(receipt).toContain('Amount: Hidden\nNetwork fee: Hidden');
        expect(receipt).not.toContain('21 BTC');
        expect(receipt).not.toContain('0.0001 BTC');
    });
});
