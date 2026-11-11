// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Trading, bridge, market, batch, contract and staking forms give every
// Network, Token and Checkbox field a help tip written for that form.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { CrossChainOrderForm } from '../../../packages/core/src/shared/routes/CrossChainOrderForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { BridgeMoveForm } from '../../../packages/core/src/shared/routes/BridgeMoveForm.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { ContractFundsForm } from '../../../packages/core/src/shared/routes/ContractFundsForm.jsx';
import { ContractStakeForm } from '../../../packages/core/src/shared/routes/ContractStakeForm.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const DOGE = 'dogecoin-mainnet';
const DOGE_ADDRESS = Object.freeze({
    id: 'address-2',
    address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx',
    publicKey: '02cd',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const REGTEST = 'bitcoin-regtest';
const REGTEST_ADDRESS = Object.freeze({
    id: 'address-3',
    address: 'bcrt1qactiveactiveactiveactiveactiveactive0',
    publicKey: '02ef',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith(extra = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [ADDRESS], [DOGE]: [DOGE_ADDRESS], [REGTEST]: [REGTEST_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getContractByActionIndex: vi.fn().mockResolvedValue({
            row: { cooldown_blocks: 10, slash_destination: REGTEST_ADDRESS.address },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        ...extra,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
        has: (object, property) => property in object,
    });
}

function mount(Component, props) {
    render(
        <MessagingProvider shell="web" messaging={messagingWith()}>
            <Component walletId="wallet-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

async function expectTip(name, copy) {
    const button = (await screen.findAllByRole('button', { name }))[0];
    fireEvent.click(button);
    expect(screen.getAllByRole('tooltip').map((node) => node.textContent).join(' | ')).toContain(copy);
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
}

describe('Network, Token and Checkbox field help on trading, contract and staking forms', () => {
    it('Swap: Network, Give token and Get token tips', async () => {
        mount(SwapForm, {});
        await expectTip('About Network', 'The chain this swap offer is recorded on.');
        await expectTip('About Give token', 'held in escrow until the offer is matched');
        await expectTip('About Get token', 'paid to your receive address');
        await expectTip(/^About Give this token's ownership/, 'single-fill swap');
    });

    it('Create order: Network tip carries the line that used to sit under the field', async () => {
        mount(CreateOrderForm, {});
        await expectTip('About Network', 'to get a token on another chain, use Cross-chain order.');
        expect(screen.queryByText(/^Both sides of this order settle on the same chain\./)).toBeNull();
        await expectTip(/^About Trade ownership of this ticker/, 'no partial fills');
    });

    it('Cross-chain order: Give and Get network tips', async () => {
        mount(CrossChainOrderForm, {});
        await expectTip('About Give network', 'The chain you pay from.');
        await expectTip('About Get network', 'The chain you want to be paid on.');
        await expectTip(/^About Give this token's ownership/, 'moves as one piece');
    });

    it('Cross-chain swap: network and token tips', async () => {
        mount(CrossChainSwapForm, {});
        await expectTip('About Give network', 'changing it clears the give token');
        await expectTip('About Get network', 'changing it clears the get token');
        await expectTip('About Give token', 'held in escrow');
        await expectTip('About Get token', 'paid to your Receive at address');
        await expectTip(/^About Require the matcher/, "ownership record across chains");
    });

    it('Bridge move: Move from, Token and Move to tips', async () => {
        mount(BridgeMoveForm, {});
        await expectTip('About Move from', 'The network the token leaves.');
        await expectTip('About Token', 'Only tokens with a bridge route');
    });

    it('Bet market: Network and Token tips', async () => {
        mount(CreateBetFeedForm, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
        await expectTip('About Network', 'The chain the market is created on.');
        await expectTip('About Token bets are placed in', 'Every bet and every payout is in this token.');
    });

    it('Batch composer: Network tip', async () => {
        mount(BatchComposerForm, {});
        await expectTip('About Network', 'The chain the whole batch is sent on.');
    });

    it('Contract funds: Network and Token tips follow the mode', async () => {
        mount(ContractFundsForm, { mode: 'deposit', chainId: CHAIN, contractActionIndex: '5' });
        await expectTip('About Network', 'It is fixed by the contract');
        await expectTip('About Token', 'The token to send into the contract.');
    });

    it('Contract funds withdraw: Token tip names the withdrawal', async () => {
        mount(ContractFundsForm, { mode: 'withdraw', chainId: CHAIN, contractActionIndex: '5' });
        await expectTip('About Token', 'The token to pull out of the contract.');
    });

    it('Contract stake: Token tip', async () => {
        mount(ContractStakeForm, { chainId: REGTEST, contractActionIndex: '5' });
        await expectTip('About Token', 'The token staked in this contract.');
    });

    it('Deploy contract: Network tip', async () => {
        mount(DeployContractForm, {});
        await expectTip('About Network', 'The chain the contract is published on.');
    });

    it('Stake, staking action and delegation: Network tips', async () => {
        mount(StakeForm, { chainId: CHAIN });
        await expectTip('About Network', 'The chain your stake is locked on.');
        cleanup();
        mount(StakingActionForm, { mode: 'unstake', chainId: CHAIN });
        await expectTip('About Network', 'The chain your stake is on.');
        cleanup();
        mount(DelegationActionForm, { mode: 'delegate', chainId: CHAIN });
        await expectTip('About Network', 'The chain the staked address is on.');
    });

    it('Execute contract: the deposit token help is a dictionary key', () => {
        expect(en['execute.depositTokenHelp']).toMatch(/same transaction, before the method runs/);
    });
});
