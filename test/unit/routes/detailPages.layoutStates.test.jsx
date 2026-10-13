// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import detailStyles from '../../../packages/core/src/shared/routes/IssueTokenForm.module.css';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';
import formPageStyles from '../../../packages/core/src/ui/FormPage.module.css';
import screenStyles from '../../../packages/core/src/ui/Screen.module.css';
import sectionHeaderStyles from '../../../packages/core/src/ui/SectionHeader.module.css';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: `GET${'Y'.repeat(48)}` })}>
            Choose {title}
        </button>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const LONG_ADDRESS = `bc1q${'addresspart'.repeat(12)}`;
const OTHER_LONG_ADDRESS = `bc1q${'destination'.repeat(12)}`;
const LONG_INDEX = '1234567890'.repeat(9);
const LONG_KEY = `02${'abcdef'.repeat(22)}`;
const LONG_NAME = `Protocol${'Name'.repeat(14)}`;
const LONG_TICK = `GIVE${'X'.repeat(48)}`;
const LONG_GET_TICK = `GET${'Y'.repeat(48)}`;
const LARGE_AMOUNT = '1234567890123456789012345678901234567890';

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

function mountCompact(child, messaging) {
    return render(
        <div data-testid="compact-viewport" style={{ width: '412px', maxWidth: '412px' }}>
            <MessagingProvider shell="web" messaging={messaging}>
                {child}
            </MessagingProvider>
        </div>,
    );
}

function detailValue(label) {
    return screen.getByText(label, { exact: true }).nextElementSibling;
}

function expectCompactCanvas(container) {
    const viewport = screen.getByTestId('compact-viewport');
    const main = container.querySelector('main');
    expect(viewport.style.width).toBe('412px');
    expect(main).toHaveClass(screenStyles.body);
    expect(main.firstElementChild.classList.contains(listPageStyles.page)
        || main.firstElementChild.classList.contains(formPageStyles.form)).toBe(true);
}

function expectWrappingValue(element, text) {
    expect(element.textContent.replaceAll(',', '')).toContain(String(text).replaceAll(',', ''));
    expect(element.style.overflowWrap === 'anywhere'
        || element.classList.contains(detailStyles.detailsValue)
        || element.classList.contains(detailStyles.choiceText)
        || element.classList.contains(detailStyles.splitValue)
        || element.classList.contains(sectionHeaderStyles.title)).toBe(true);
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
                text: 'Contract not found',
            }),
        ],
        [
            'list',
            () => ({
                messaging: messagingWith({ getListByActionIndex: vi.fn().mockResolvedValue(null) }),
                child: <ListDetail chainId={CHAIN} actionIndex="7" onBack={() => {}} onFork={() => {}} />,
                text: 'List not found',
            }),
        ],
        [
            'dispenser',
            () => ({
                messaging: messagingWith({ getDispenserByActionIndex: vi.fn().mockResolvedValue(null) }),
                child: <DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex="7" onBack={() => {}} />,
                text: 'Dispenser not found',
            }),
        ],
    ])('renders a shared empty state when the %s record is absent', async (_name, build) => {
        const { messaging, child, text } = build();
        mount(child, messaging);
        const title = await screen.findByRole('heading', { name: text });
        expect(title.closest('[role="status"]')).toHaveTextContent(text);
    });
});

describe('412px protocol detail layouts', () => {
    it('keeps the contract name, identifiers, balances, and actions visible', async () => {
        const contractAddress = `C:BTC:${LONG_INDEX}`;
        const messaging = messagingWith({
            getContractByActionIndex: vi.fn().mockResolvedValue({
                data: {
                    action_index: LONG_INDEX,
                    source: LONG_ADDRESS,
                    status: 'valid',
                    code_hash: LONG_KEY,
                    meta_name: LONG_NAME,
                },
            }),
            getActionByIndex: vi.fn().mockResolvedValue({}),
            getContractState: vi.fn().mockResolvedValue({}),
            getContractBalance: vi.fn().mockResolvedValue({ [LONG_TICK]: LARGE_AMOUNT }),
            getExecutionsForContract: vi.fn().mockResolvedValue({ data: [] }),
        });
        const view = mountCompact(
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
        expectCompactCanvas(view.container);
        expectWrappingValue(screen.getByRole('heading', { name: new RegExp(LONG_NAME) }), LONG_NAME);
        const address = screen.getByLabelText(contractAddress);
        expect(address.textContent).toBe(contractAddress);
        expect(address.closest('dl').style.overflowWrap).toBe('anywhere');
        expect(screen.getByText(LONG_KEY, { selector: 'code' })).toBeTruthy();
        expectWrappingValue(screen.getByText(LARGE_AMOUNT), LARGE_AMOUNT);
        expect(screen.getByRole('button', { name: 'Call method' }).disabled).toBe(false);
    });

    it('keeps the list name, index, members, and actions visible', async () => {
        const messaging = messagingWith({
            getListByActionIndex: vi.fn().mockResolvedValue({
                type: '2',
                status: 'valid',
                source: LONG_ADDRESS,
                list: [OTHER_LONG_ADDRESS],
                name: LONG_NAME,
                description: LONG_NAME.repeat(2),
                block_index: LARGE_AMOUNT,
            }),
        });
        const view = mountCompact(
            <ListDetail
                chainId={CHAIN}
                actionIndex={LONG_INDEX}
                onBack={() => {}}
                onFork={() => {}}
                onShare={() => {}}
            />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: 'List details' })).toBeTruthy();
        expectCompactCanvas(view.container);
        expectWrappingValue(detailValue('Name'), LONG_NAME);
        expectWrappingValue(detailValue('Block'), LARGE_AMOUNT);
        expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
        expect(screen.getByLabelText(OTHER_LONG_ADDRESS).textContent).toBe(OTHER_LONG_ADDRESS);
        expect(screen.getByRole('button', { name: 'Fork & edit' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Share list' })).toBeTruthy();
    });

    it('keeps stake names, amounts, activity, and every action visible', async () => {
        const messaging = messagingWith({
            getStakesForAddress: vi.fn().mockResolvedValue({
                data: [{ amount: LARGE_AMOUNT, asset: LONG_TICK, capability_label: LONG_NAME, status: 'valid' }],
            }),
            getDelegationsForAddress: vi.fn().mockResolvedValue({
                data: [{ signing_pubkey: LONG_KEY, status: 'valid', block_index: LARGE_AMOUNT }],
            }),
            getRewardsForAddress: vi.fn().mockResolvedValue({ data: [{ amount: LARGE_AMOUNT, block_index: LARGE_AMOUNT }] }),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        });
        const view = mountCompact(
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
        expectCompactCanvas(view.container);
        expectWrappingValue(detailValue('Role'), LONG_NAME);
        expectWrappingValue(detailValue('Staked'), LARGE_AMOUNT);
        expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Position activity' })).toBeTruthy();
        expect(screen.getByText(LONG_KEY, { selector: 'code' })).toBeTruthy();
        expect(screen.getByText(LONG_KEY, { selector: 'code' }).closest('dd').style.overflowWrap).toBe('anywhere');
        for (const label of ['Claim', 'Unstake', 'Delegate', 'More']) {
            expect(screen.getByRole('button', { name: label })).toBeTruthy();
        }
    });

    it('keeps dispenser tickers, amounts, addresses, and actions visible', async () => {
        const messaging = messagingWith({
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                action_index: LONG_INDEX,
                source: LONG_ADDRESS,
                get_address: OTHER_LONG_ADDRESS,
                give_tick: LONG_TICK,
                give_amount: LARGE_AMOUNT,
                get_tick: LONG_GET_TICK,
                get_amount: LARGE_AMOUNT,
                escrow_remaining: LARGE_AMOUNT,
                status: 'open',
                current_status: 'open',
            }),
            getDispenses: vi.fn().mockResolvedValue({
                data: [{
                    dispenser_action_index: LONG_INDEX,
                    dispense_quantity: LARGE_AMOUNT,
                    give_quantity: LARGE_AMOUNT,
                    block_index: LARGE_AMOUNT,
                    status: 'valid',
                }],
            }),
            getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
        });
        const view = mountCompact(
            <DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex={LONG_INDEX} onBack={() => {}} />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: 'Dispenser details' })).toBeTruthy();
        expectCompactCanvas(view.container);
        expectWrappingValue(detailValue('Dispensing'), LARGE_AMOUNT);
        expectWrappingValue(detailValue('Payment'), LARGE_AMOUNT);
        expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
        await waitFor(() => expect(screen.getByLabelText(OTHER_LONG_ADDRESS).textContent).toBe(OTHER_LONG_ADDRESS));
        expect(screen.getByLabelText(OTHER_LONG_ADDRESS).closest('dd').style.overflowWrap).toBe('anywhere');
        expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    });

    it('keeps a long poll question, option, amount, and vote action visible', async () => {
        const option = `Option${'Choice'.repeat(16)}`;
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: LONG_INDEX,
                tick: LONG_TICK,
                question: LONG_NAME.repeat(2),
                options: [option, 'Other'],
                poll_status: 'open',
                tally_mode: 'approval',
                weight_mode: 'balance',
                max_selections: '1',
                end_block: LARGE_AMOUNT,
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            governanceVotes: vi.fn().mockResolvedValue({ data: [] }),
        });
        const view = mountCompact(
            <PollDetail walletId="wallet" chainId={CHAIN} pollIndex={LONG_INDEX} onBack={() => {}} />,
            messaging,
        );

        expect(await screen.findByText(LONG_NAME.repeat(2))).toBeTruthy();
        expectCompactCanvas(view.container);
        expectWrappingValue(detailValue('Question'), LONG_NAME.repeat(2));
        expectWrappingValue(detailValue('Closes at block'), LARGE_AMOUNT);
        expectWrappingValue(screen.getByText(`0: ${option}`), option);
        expect(screen.getByRole('button', { name: 'Vote' })).toBeTruthy();
    });

    it('keeps finalized poll result names and large totals visible', async () => {
        const option = `Final${'Outcome'.repeat(16)}`;
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: LONG_INDEX,
                tick: LONG_TICK,
                options: [option],
                poll_status: 'finalized',
                end_block: LARGE_AMOUNT,
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [{ option_index: 0, total_weight: LARGE_AMOUNT, voter_count: LARGE_AMOUNT }],
            }),
        });
        const view = mountCompact(
            <PollDetail walletId="wallet" chainId={CHAIN} pollIndex={LONG_INDEX} onBack={() => {}} />,
            messaging,
        );

        const optionCell = await screen.findByText(`0: ${option}`);
        expectCompactCanvas(view.container);
        expect(optionCell.closest('table')).toHaveClass(detailStyles.compactTable);
        const cells = optionCell.closest('tr').querySelectorAll('td');
        expect(cells[1]).toHaveTextContent(LARGE_AMOUNT);
        expect(cells[2]).toHaveTextContent(LARGE_AMOUNT);
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeTruthy();
    });

    it('keeps a long bet feed name, split values, and review action visible', async () => {
        const outcome = `Outcome${'Result'.repeat(16)}`;
        const messaging = messagingWith({
            betFeed: vi.fn().mockResolvedValue({
                action_index: LONG_INDEX,
                source: LONG_ADDRESS,
                label: LONG_NAME.repeat(2),
                tick: LONG_TICK,
                outcomes: [outcome, 'Other'],
                pools: [{ outcome: 0, pool: LARGE_AMOUNT, bet_count: LARGE_AMOUNT }],
                feed_status: 'open',
                deadline: 4_102_444_800,
                expire_at: 4_102_531_200,
                fee: LARGE_AMOUNT,
                min_amount: LARGE_AMOUNT,
                timeline: [],
            }),
        });
        const view = mountCompact(
            <BetFeedDetail walletId="wallet" chainId={CHAIN} feedIndex={LONG_INDEX} onBack={() => {}} />,
            messaging,
        );

        expect(await screen.findByRole('heading', { name: LONG_NAME.repeat(2) })).toBeTruthy();
        expectCompactCanvas(view.container);
        expectWrappingValue(screen.getByText(`0: ${outcome}`), outcome);
        expectWrappingValue(screen.getByText(new RegExp(`^${LARGE_AMOUNT}`)), LARGE_AMOUNT);
        const outcomeAction = screen.getByRole('button', { name: outcome });
        expect(outcomeAction.style.whiteSpace).toBe('normal');
        expect(outcomeAction.style.overflowWrap).toBe('anywhere');
        expect(screen.getByRole('button', { name: 'Review bet' })).toBeTruthy();
    });

    it('keeps long swap terms, large amounts, and review actions visible', async () => {
        const address = {
            id: 'address',
            address: LONG_ADDRESS,
            publicKey: LONG_KEY,
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
            signerId: 'signer',
        };
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [address] }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 18 }),
        });
        const view = mountCompact(
            <SwapForm walletId="wallet" initialChainId={CHAIN} initialGiveTick={LONG_TICK} onBack={() => {}} />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        fireEvent.change(screen.getByLabelText(`Give amount (${LONG_TICK})`), { target: { value: LARGE_AMOUNT } });
        fireEvent.change(screen.getByLabelText(`Get amount (${LONG_GET_TICK})`), { target: { value: LARGE_AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByRole('form', { name: 'Review swap' })).toBeTruthy();
        expectCompactCanvas(view.container);
        expectWrappingValue(detailValue('Give amount'), `${LARGE_AMOUNT} ${LONG_TICK}`);
        expectWrappingValue(detailValue('Get amount'), `${LARGE_AMOUNT} ${LONG_GET_TICK}`);
        expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create unsigned transaction' })).toBeTruthy();
    });
});
