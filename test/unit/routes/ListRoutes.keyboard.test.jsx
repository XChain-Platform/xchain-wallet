// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN = 'bitcoin-testnet';
const ADDRESS = 'tb1qkeyboard000000000000000000000000000';

function mount(Component, messaging, props) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component walletId="wallet-1" accountId="account-1" {...props} />
        </MessagingProvider>,
    );
}

async function tabTo(user, target, limit = 30) {
    for (let index = 0; index < limit; index += 1) {
        await user.tab();
        if (document.activeElement === target) return;
    }
    throw new Error(`Tab did not reach ${target.getAttribute('aria-label') || target.textContent}`);
}

async function exerciseRoute({ Component, messaging, primaryName, props = {} }) {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onPrimary = vi.fn();
    mount(Component, messaging, { onBack, ...props(onPrimary) });

    const primary = await screen.findByRole('button', { name: primaryName });
    await tabTo(user, primary);
    await user.keyboard('{Enter}');
    expect(onPrimary).toHaveBeenCalledOnce();

    const back = screen.getByRole('button', { name: /Back/ });
    await tabTo(user, back);
    await user.keyboard('{Enter}');
    expect(onBack).toHaveBeenCalledOnce();
}

afterEach(() => cleanup());

describe('list route keyboard flows', () => {
    it('reaches Publish contract and leaves Contracts with Back', async () => {
        await exerciseRoute({
            Component: ContractsList,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({
                    [CHAIN]: [{ address: ADDRESS }],
                }),
                getContractsForSource: vi.fn().mockResolvedValue([]),
                getDepositsForAddress: vi.fn().mockResolvedValue([]),
                getWithdrawalsForAddress: vi.fn().mockResolvedValue([]),
                getContractsBrowseAll: vi.fn().mockResolvedValue([]),
            },
            primaryName: '+ Publish contract',
            props: (onPrimary) => ({ onDeploy: onPrimary, onOpenContract: vi.fn() }),
        });
    });

    it('reaches Create dispenser and leaves My dispensers with Back', async () => {
        await exerciseRoute({
            Component: DispensersList,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({}),
                getDispensersForSource: vi.fn().mockResolvedValue([]),
            },
            primaryName: 'Create dispenser',
            props: (onPrimary) => ({
                activeAccountId: 'account-1',
                onCreateDispenser: onPrimary,
                onOpenDispenser: vi.fn(),
            }),
        });
    });

    it('reaches New conversation and leaves Messaging with Back', async () => {
        await exerciseRoute({
            Component: MessagingInbox,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({
                    [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
                }),
                listContacts: vi.fn().mockResolvedValue([]),
                signerReady: vi.fn().mockResolvedValue({ ready: true }),
                getMessagingInboxSweep: vi.fn().mockResolvedValue({
                    messages: [], addresses: [], errors: [],
                }),
            },
            primaryName: 'New conversation',
            props: (onPrimary) => ({ activeAccountId: 'account-1', onCompose: onPrimary }),
        });
    });

    it('reaches Create list and leaves My lists with Back', async () => {
        await exerciseRoute({
            Component: MyLists,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({}),
                getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
            },
            primaryName: 'Create list',
            props: (onPrimary) => ({ onCreateList: onPrimary, onOpenList: vi.fn() }),
        });
    });

    it('reaches New order and leaves My orders with Back', async () => {
        await exerciseRoute({
            Component: MyOrdersView,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({}),
                getOrdersForAddress: vi.fn().mockResolvedValue([]),
            },
            primaryName: 'New order',
            props: (onPrimary) => ({ onCreateOrder: onPrimary }),
        });
    });

    it('reaches New swap and leaves My swaps with Back', async () => {
        await exerciseRoute({
            Component: MySwapsView,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({}),
                getSwapsForAddress: vi.fn().mockResolvedValue([]),
            },
            primaryName: 'New swap',
            props: (onPrimary) => ({ onCreateSwap: onPrimary }),
        });
    });

    it('reaches Issue new token and leaves My tokens with Back', async () => {
        await exerciseRoute({
            Component: MyTokens,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({}),
                getOwnedTokens: vi.fn().mockResolvedValue([]),
            },
            primaryName: 'Issue new token',
            props: (onPrimary) => ({ onIssue: onPrimary, onSelectTick: vi.fn() }),
        });
    });

    it('reaches New stake and leaves Staking with Back', async () => {
        await exerciseRoute({
            Component: StakingList,
            messaging: {
                getAddressesByChain: vi.fn().mockResolvedValue({}),
            },
            primaryName: 'New stake',
            props: (onPrimary) => ({
                activeAccountId: 'account-1',
                onNewStake: onPrimary,
                onOpenStake: vi.fn(),
            }),
        });
    });
});
