// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A demo wallet cannot move funds. Every route that would compose or
// broadcast a transaction shows Send's inline demo note in the page content,
// keeps its form browsable, disables its submit and never asks the encoder
// (compose, build or broadcast) for anything.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { BridgeMoveForm } from '../../../packages/core/src/shared/routes/BridgeMoveForm.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';
import { ContractFundsForm } from '../../../packages/core/src/shared/routes/ContractFundsForm.jsx';
import { ContractStakeForm } from '../../../packages/core/src/shared/routes/ContractStakeForm.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { CrossChainOrderForm } from '../../../packages/core/src/shared/routes/CrossChainOrderForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';
import { ListTransferForm } from '../../../packages/core/src/shared/routes/ListTransferForm.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const DEMO_NOTE = /Demo wallets can't move funds/;
const ENCODER_CALL = /compose|encode|broadcast|buildBet|buildAction|submit|signAndSend|sign[A-Z]/;

const address = {
    id: 'addr-1',
    address: 'bc1qsendersendersendersendersendersendersa',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 's',
};
const listRef = { chainId: CHAIN, actionIndex: '7', address: address.address, type: 'address', items: [] };
const dogeAddress = { ...address, id: 'addr-2', address: 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns', derivationPath: "m/44'/3'/0'/0/0" };
const regtestAddress = { ...address, id: 'addr-3', address: 'bcrt1qsendersendersendersendersendersendersa' };

// Every route gets the same inputs; a route reads only the props it names.
const base = {
    chainId: CHAIN,
    initialChainId: CHAIN,
    tick: 'XCHAIN',
    initialTick: 'XCHAIN',
    contractActionIndex: '5',
    listRef,
    address: address.address,
    issuerAddress: address.address,
    activeAccountId: 'acct-1',
};

const ROUTES = [
    ['Swap', SwapForm],
    ['Create token (wizard)', TokenWizard, {}, async () => {
        fireEvent.click(await screen.findByRole('button', { name: /^Custom/ }));
    }],
    ['Issue token', IssueTokenForm],
    ['Mint', MintForm],
    ['Destroy', DestroyForm],
    ['Sweep', SweepForm],
    ['Create dispenser', DispenserForm],
    ['Dividend', DividendForm],
    ['Airdrop', AirdropForm],
    ['Create order', CreateOrderForm],
    ['Sell ownership', SellOwnershipForm],
    ['Cross-chain order', CrossChainOrderForm],
    ['Cross-chain swap', CrossChainSwapForm],
    ['Batch composer', BatchComposerForm],
    ['Parallel composer', ParallelComposer],
    ['Place order panel', PlaceOrderPanel, { tick1: 'XCHAIN', tick2: 'BTC' }],
    ['Stake', StakeForm],
    ['Staking action', StakingActionForm, { mode: 'unstake' }],
    ['Contract stake', ContractStakeForm, { chainId: 'bitcoin-regtest', contractActionIndex: '1024' }],
    ['Delegation action', DelegationActionForm, { mode: 'delegate' }],
    ['Delegate vote', DelegateVoteForm],
    ['Create poll', CreatePollForm],
    ['Compose message', ComposeMessage],
    ['Broadcast', BroadcastForm],
    ['Create list', ListCreateForm],
    ['Fork list', ListForkForm],
    ['Rename list', ListRenameForm],
    ['Share list', ListShareForm],
    ['Transfer list', ListTransferForm],
    ['Union list', UnionListForm],
    ['Deploy contract', DeployContractForm],
    ['Execute contract', ExecuteContractForm],
    ['Contract funds', ContractFundsForm, { mode: 'deposit' }],
    ['Create bet feed', CreateBetFeedForm],
    ['Oracle price', OracleForm],
    ['Attach artwork', AttachContentForm],
    ['Publish file', PublishFileForm],
    ['Gated publish', GatedPublishForm],
    ['Project roster', ProjectRosterForm],
    ['Link', LinkForm],
    ['Callback', CallbackForm],
    ['Sleep', SleepForm, { mode: 'sleep' }],
    ['Bind controller', ControllerBindForm],
    ['Token admin', TokenAdminForm, { mode: 'transfer' }],
    ['Address preferences', AddressPreferencesForm],
    ['Bridge move', BridgeMoveForm],
];

function mount(Route, extra = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [address],
            'dogecoin-mainnet': [dogeAddress],
            'bitcoin-regtest': [regtestAddress],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({}),
        getAddressBalances: () => Promise.resolve({ native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (typeof prop !== 'string') return undefined;
            if (ENCODER_CALL.test(prop)) return (...args) => { calls.push(prop); return Promise.resolve({ rows: [] }); };
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const view = render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Route, { walletId: 'demo-w', onBack() {}, ...base, ...extra }),
    ));
    return { calls, view };
}

beforeEach(() => { clearDemoWalletId(); markDemoWallet('demo-w'); });
afterEach(() => { cleanup(); clearDemoWalletId(); });

describe('demo wallets cannot move funds from any compose route', () => {
    it.each(ROUTES)('%s shows the inline note and no enabled submit', async (_name, Route, extra, step) => {
        const { calls, view } = mount(Route, extra);
        if (step) await step();

        const note = await waitFor(() => {
            const hit = screen.getAllByRole('status').find((node) => DEMO_NOTE.test(node.textContent || ''));
            expect(hit).toBeTruthy();
            return hit;
        }, { timeout: 4000 });

        expect(within(note).getByRole('button', { name: 'Create a real wallet' })).toBeInTheDocument();
        const submits = [...view.container.querySelectorAll('button[type="submit"]')];
        expect(submits.filter((button) => !button.disabled)).toEqual([]);

        // Enter in a field must not reach a compose either.
        for (const form of view.container.querySelectorAll('form')) fireEvent.submit(form);
        expect(calls).toEqual([]);
    });

    it('opens the exit confirmation from the note', async () => {
        mount(SwapForm);
        fireEvent.click(await screen.findByRole('button', { name: 'Create a real wallet' }));
        expect(await screen.findByRole('dialog', { name: 'Exit demo and delete its data?' })).toBeInTheDocument();
    });

    it('shows no note for a real wallet', async () => {
        clearDemoWalletId();
        mount(SwapForm);
        await screen.findByRole('form', { name: 'Swap tokens' });
        expect(screen.queryByText(DEMO_NOTE)).toBeNull();
    });
});
