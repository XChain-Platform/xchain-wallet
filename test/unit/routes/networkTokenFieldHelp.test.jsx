// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'HELP', creator: ADDRESS.address, divisibility: 0, locks: {} }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
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
}

describe('Network and Token field help on route forms', () => {
    it('Link: form Network and per-card Network tips', async () => {
        mount(LinkForm, {});
        const tips = await screen.findAllByRole('button', { name: 'About Network' });
        expect(tips).toHaveLength(3);
        fireEvent.click(tips[1]);
        expect(screen.getByRole('tooltip')).toHaveTextContent('The chain Action 1 was recorded on.');
    });

    it('Publish: Network tip, gated Token tip, acknowledgement tip', async () => {
        mount(PublishFileForm, {});
        await expectTip('About Network', 'The chain the file is published on.');
        fireEvent.click(screen.getByRole('radio', { name: /token-gated/ }));
        await expectTip('About Token', 'Only tokens you own are listed.');
    });

    it('Attach: artwork checkbox tip', async () => {
        mount(AttachContentForm, { chainId: CHAIN, tick: 'HELP', issuerAddress: ADDRESS.address });
        await expectTip(/^About Also make this HELP/, 'this becomes the token\'s picture everywhere');
    });

    it('List create: Network tip', async () => {
        mount(ListCreateForm, { chainId: CHAIN });
        await expectTip('About Network', 'The chain the list is published on.');
    });

    it('Union list: Network tip', async () => {
        mount(UnionListForm, { chainId: CHAIN });
        await expectTip('About Network', 'Only your lists on this network can be combined.');
    });

    it('Oracle: Publishing network tip', async () => {
        mount(OracleForm, { initialChainId: CHAIN });
        await expectTip('About Publishing network', 'it becomes your oracle\'s identity');
    });

    it('Create poll: Network and Governance token tips', async () => {
        mount(CreatePollForm, { chainId: CHAIN, presetTick: 'HELP' });
        await expectTip('About Network', 'The chain the poll is recorded on.');
        await expectTip('About Governance token', 'The token whose holders can vote on this poll.');
    });

    it('Delegate vote: Network and Governance token tips', async () => {
        mount(DelegateVoteForm, { chainId: CHAIN, presetTick: 'HELP' });
        await expectTip('About Network', 'The chain the delegation is recorded on.');
        await expectTip('About Governance token', 'voting weight you are delegating');
    });

    it('Sell ownership: Network tip', async () => {
        mount(SellOwnershipForm, { chainId: CHAIN, tick: 'HELP' });
        await expectTip('About Network', 'The chain the name is listed for sale on.');
    });

    it('Controller bind: Network tip', async () => {
        mount(ControllerBindForm, { chainId: CHAIN, tick: 'HELP' });
        await expectTip('About Network', 'The chain the token and its controller binding are on.');
    });
});
