// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const LONG_ADDRESS = `bc1q${'addresspart'.repeat(12)}`;
const OTHER_LONG_ADDRESS = `bc1q${'destination'.repeat(12)}`;
const LONG_INDEX = '1234567890'.repeat(9);
const LONG_KEY = `02${'abcdef'.repeat(22)}`;

function pending() {
    return new Promise(() => {});
}

function messagingWith(overrides = {}) {
    const defaults = {
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
    };
    const target = { ...defaults, ...overrides };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(child, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('detail page loading and empty states', () => {
    it.each([
        [
            'contract',
            () => ({
                messaging: messagingWith({
                    getContractByActionIndex: vi.fn().mockImplementation(pending),
                    getContractState: vi.fn().mockImplementation(pending),
                    getContractBalance: vi.fn().mockImplementation(pending),
                    getExecutionsForContract: vi.fn().mockImplementation(pending),
                }),
                child: <ContractDetail chainId={CHAIN} contractActionIndex="7" onBack={() => {}} />,
                text: 'Loading contract…',
            }),
        ],
        [
            'stake',
            () => ({
                messaging: messagingWith({ getStakesForAddress: vi.fn().mockImplementation(pending) }),
                child: <StakeDetail walletId="wallet" kind="validator" chainId={CHAIN} address={LONG_ADDRESS} onBack={() => {}} />,
                text: 'Loading staking position…',
            }),
        ],
        [
            'list',
            () => ({
                messaging: messagingWith({ getListByActionIndex: vi.fn().mockImplementation(pending) }),
                child: <ListDetail chainId={CHAIN} actionIndex="7" onBack={() => {}} onFork={() => {}} />,
                text: 'Loading list…',
            }),
        ],
        [
            'dispenser',
            () => ({
                messaging: messagingWith({ getDispenserByActionIndex: vi.fn().mockImplementation(pending) }),
                child: <DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex="7" onBack={() => {}} />,
                text: 'Loading dispenser…',
            }),
        ],
    ])('announces the %s loading state through the shared status component', (_name, build) => {
        const { messaging, child, text } = build();
        mount(child, messaging);
        expect(screen.getByRole('status').textContent).toContain(text);
    });

    it('does not report empty contract history while executions are loading', async () => {
        const messaging = messagingWith({
            getContractByActionIndex: vi.fn().mockResolvedValue({ data: { action_index: '7' } }),
            getActionByIndex: vi.fn().mockResolvedValue({}),
            getContractState: vi.fn().mockResolvedValue({}),
            getContractBalance: vi.fn().mockResolvedValue({}),
            getExecutionsForContract: vi.fn().mockImplementation(pending),
        });
        mount(<ContractDetail chainId={CHAIN} contractActionIndex="7" onBack={() => {}} />, messaging);

        const executionLoading = await screen.findByText('Loading execution history…');
        expect(executionLoading.closest('[role="status"]')).toBeTruthy();
        expect(screen.queryByText('No contract calls recorded against this contract yet.')).toBeNull();
    });

    it('does not report empty dispenser activity while dispenses are loading', async () => {
        const messaging = messagingWith({
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                action_index: '7',
                source: LONG_ADDRESS,
                give_tick: 'WRAP',
                give_amount: '1',
                get_tick: 'PAY',
                get_amount: '2',
                status: 'open',
                current_status: 'open',
            }),
            getDispenses: vi.fn().mockImplementation(pending),
            getDispenserLifecycle: vi.fn().mockImplementation(pending),
        });
        mount(<DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex="7" onBack={() => {}} />, messaging);

        const dispensesLoading = await screen.findByText('Loading dispenses…');
        expect(dispensesLoading.closest('[role="status"]')).toBeTruthy();
        expect(screen.queryByText('No dispenses yet.')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle' }));
        const lifecycleLoading = await screen.findByText('Loading lifecycle…');
        expect(lifecycleLoading.closest('[role="status"]')).toBeTruthy();
        expect(screen.queryByText('No lifecycle events yet.')).toBeNull();
    });

    it.each([
        [
            'contract',
            () => ({
                messaging: messagingWith({
                    getContractByActionIndex: vi.fn().mockResolvedValue(null),
                    getContractState: vi.fn().mockResolvedValue({}),
                    getContractBalance: vi.fn().mockResolvedValue({}),
                    getExecutionsForContract: vi.fn().mockResolvedValue({ data: [] }),
                }),
                child: <ContractDetail chainId={CHAIN} contractActionIndex="7" onBack={() => {}} />,
                text: 'Contract not found.',
            }),
        ],
        [
            'list',
            () => ({
                messaging: messagingWith({ getListByActionIndex: vi.fn().mockResolvedValue(null) }),
                child: <ListDetail chainId={CHAIN} actionIndex="7" onBack={() => {}} onFork={() => {}} />,
                text: 'List not found.',
            }),
        ],
        [
            'dispenser',
            () => ({
                messaging: messagingWith({ getDispenserByActionIndex: vi.fn().mockResolvedValue(null) }),
                child: <DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex="7" onBack={() => {}} />,
                text: 'Dispenser not found.',
            }),
        ],
    ])('renders a shared empty state when the %s record is absent', async (_name, build) => {
        const { messaging, child, text } = build();
        mount(child, messaging);
        const title = await screen.findByRole('heading', { name: text });
        expect(title.closest('[role="status"]')).toHaveTextContent(text);
    });
});

describe('detail page sections and long identifiers', () => {
    it('keeps contract identifiers visible and heads the actions', async () => {
        const contractAddress = `C:BTC:${LONG_INDEX}`;
        const messaging = messagingWith({
            getContractByActionIndex: vi.fn().mockResolvedValue({
                data: {
                    action_index: LONG_INDEX,
                    source: LONG_ADDRESS,
                    status: 'valid',
                    code_hash: LONG_KEY,
                },
            }),
            getActionByIndex: vi.fn().mockResolvedValue({}),
            getContractState: vi.fn().mockResolvedValue({}),
            getContractBalance: vi.fn().mockResolvedValue({}),
            getExecutionsForContract: vi.fn().mockResolvedValue({ data: [] }),
        });
        mount(
            <ContractDetail
                walletId="wallet"
                chainId={CHAIN}
                contractActionIndex={LONG_INDEX}
                onExecute={() => {}}
                onBack={() => {}}
            />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: 'Actions' })).toBeTruthy();
        const address = screen.getByLabelText(contractAddress);
        expect(address.textContent).toBe(contractAddress);
        expect(address.closest('dl').style.overflowWrap).toBe('anywhere');
        expect(screen.getByText(LONG_KEY, { selector: 'code' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Call method' }).disabled).toBe(false);
    });

    it('shows full list addresses under headed detail and action sections', async () => {
        const messaging = messagingWith({
            getListByActionIndex: vi.fn().mockResolvedValue({
                type: '2',
                status: 'valid',
                source: LONG_ADDRESS,
                list: [OTHER_LONG_ADDRESS],
            }),
        });
        mount(
            <ListDetail chainId={CHAIN} actionIndex={LONG_INDEX} onBack={() => {}} onFork={() => {}} />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: 'List details' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
        expect(screen.getByLabelText(OTHER_LONG_ADDRESS).textContent).toBe(OTHER_LONG_ADDRESS);
        expect(screen.getByRole('button', { name: 'Fork & edit' })).toBeTruthy();
    });

    it('shows the full delegated key and keeps every stake action reachable', async () => {
        const messaging = messagingWith({
            getStakesForAddress: vi.fn().mockResolvedValue({ data: [{ amount: '10', status: 'valid' }] }),
            getDelegationsForAddress: vi.fn().mockResolvedValue({
                data: [{ signing_pubkey: LONG_KEY, status: 'valid', block_index: '9' }],
            }),
            getRewardsForAddress: vi.fn().mockResolvedValue({ data: [{ amount: '2' }] }),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        });
        mount(
            <StakeDetail
                walletId="wallet"
                kind="validator"
                chainId={CHAIN}
                address={LONG_ADDRESS}
                onClaimRewards={() => {}}
                onUnstake={() => {}}
                onDelegate={() => {}}
                onBack={() => {}}
            />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: 'Position details' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Position activity' })).toBeTruthy();
        expect(screen.getByText(LONG_KEY, { selector: 'code' })).toBeTruthy();
        expect(screen.getByText(LONG_KEY, { selector: 'code' }).closest('dd').style.overflowWrap).toBe('anywhere');
        for (const label of ['Claim', 'Unstake', 'Delegate', 'More']) {
            expect(screen.getByRole('button', { name: label })).toBeTruthy();
        }
    });

    it('wraps full dispenser addresses and heads its action and activity regions', async () => {
        const messaging = messagingWith({
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                action_index: LONG_INDEX,
                source: LONG_ADDRESS,
                get_address: OTHER_LONG_ADDRESS,
                give_tick: 'WRAP',
                give_amount: '1',
                get_tick: 'PAY',
                get_amount: '2',
                escrow_remaining: '5',
                status: 'open',
                current_status: 'open',
            }),
            getDispenses: vi.fn().mockResolvedValue({ data: [] }),
            getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
        });
        mount(
            <DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex={LONG_INDEX} onBack={() => {}} />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: 'Dispenser details' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
        await waitFor(() => expect(screen.getByLabelText(OTHER_LONG_ADDRESS).textContent).toBe(OTHER_LONG_ADDRESS));
        expect(screen.getByLabelText(OTHER_LONG_ADDRESS).closest('dd').style.overflowWrap).toBe('anywhere');
        expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    });
});
