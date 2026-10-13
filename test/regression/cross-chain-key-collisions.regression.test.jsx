// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: cross-chain identity keys.
//
//   [P1] 2026-10-13: Owned-token rows with the same ticker on different
//        chains can collapse when ticker alone identifies a row.
//
//   [P0] 2026-10-13: Equal transaction ids from different chains can let a
//        foreign message replace the recipient's home-chain message.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getMessagingInboxSweep } from '../../packages/core/src/flows/messagingInbox.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { MyTokens } from '../../packages/core/src/shared/routes/MyTokens.jsx';

const BTC = 'bitcoin-regtest';
const DOGE = 'dogecoin-regtest';

afterEach(() => cleanup());

describe('regression/cross-chain-key-collisions', () => {
    it('[REGRESSION P1] keeps equal token tickers distinct across chains', async () => {
        const onSelectTick = vi.fn();
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [BTC]: [{ address: 'btc-owner' }],
                [DOGE]: [{ address: 'doge-owner' }],
            }),
            getOwnedTokens: vi.fn(({ chainId }) => Promise.resolve([{
                tick: 'SHARED',
                description: `${chainId} token`,
                locked: false,
                divisibility: 8,
            }])),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyTokens
                    walletId="wallet-1"
                    onBack={() => {}}
                    onIssue={() => {}}
                    onSelectTick={onSelectTick}
                />
            </MessagingProvider>,
        );

        const rows = await screen.findAllByRole('button', { name: 'Open SHARED token details' });
        expect(rows).toHaveLength(2);
        fireEvent.click(rows[0]);
        fireEvent.click(rows[1]);

        expect(onSelectTick.mock.calls.map(([, chainId]) => chainId).sort()).toEqual([BTC, DOGE]);
    });

    it('[REGRESSION P0] keeps the home-chain message when transaction ids collide', async () => {
        const addressRecords = {
            doge: {
                address: 'doge-owner', chain: 'dogecoin', network: 'regtest',
                derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
            },
            btc: {
                address: 'btc-owner', chain: 'bitcoin', network: 'regtest',
                derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
            },
        };
        const vault = {
            addresses: { get: vi.fn(async (id) => addressRecords[id] || null) },
        };
        const chainRegistry = {
            chainIdFor: (chain, network) => `${chain}-${network}`,
        };
        const sdkRegistry = {
            get: (chainId) => ({
                getMessagesForAddress: async (address) => {
                    if (address === 'btc-owner' && chainId === BTC) {
                        return [{ txid: 'shared-txid', text: 'genuine', timestamp: 10 }];
                    }
                    if (address === 'btc-owner' && chainId === DOGE) {
                        return [{ txid: 'shared-txid', text: 'foreign', timestamp: 10 }];
                    }
                    return [];
                },
            }),
        };
        const signer = {
            exportWifForPath: () => 'WIF',
            exportWifForAddressId: () => 'WIF',
        };

        const result = await getMessagingInboxSweep({
            vault,
            walletId: 'wallet-1',
            chainRegistry,
            sdkRegistry,
            signer,
            addressIds: ['doge', 'btc'],
        });

        expect(result.messages).toEqual([
            expect.objectContaining({
                txid: 'shared-txid',
                text: 'genuine',
                chainId: BTC,
            }),
        ]);
    });
});
