// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { readFileSync } from 'node:fs';
import betFeedStyles from '../../../packages/core/src/shared/routes/BetFeedDetail.module.css';
import detailStyles from '../../../packages/core/src/shared/routes/IssueTokenForm.module.css';
import tableStyles from '../../../packages/core/src/shared/components/DataTable.module.css';
import pollStyles from '../../../packages/core/src/shared/routes/PollDetail.module.css';
import outcomeStyles from '../../../packages/core/src/shared/components/outcomeDetail/OutcomeDetail.module.css';
import outcomeListStyles from '../../../packages/core/src/shared/routes/OutcomeList.module.css';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';
import formPageStyles from '../../../packages/core/src/ui/FormPage.module.css';
import screenStyles from '../../../packages/core/src/ui/Screen.module.css';
import sectionHeaderStyles from '../../../packages/core/src/ui/SectionHeader.module.css';
import stakeStyles from '../../../packages/core/src/shared/routes/StakeDetail.module.css';
import listDetailStyles from '../../../packages/core/src/shared/routes/ListDetail.module.css';
import heroStyles from '../../../packages/core/src/shared/components/TotalBalanceHero.module.css';

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
// Poll indexes are uint64; LONG_INDEX is wider and is refused by design.
const POLL_INDEX = '18446744073709551615';

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
        || main.firstElementChild.classList.contains(formPageStyles.page)
        || main.firstElementChild.classList.contains(formPageStyles.form)).toBe(true);
}

function expectWrappingValue(element, text) {
    expect(element.textContent.replaceAll(',', '')).toContain(String(text).replaceAll(',', ''));
    expect(element.style.overflowWrap === 'anywhere'
        || element.classList.contains(detailStyles.detailsValue)
        || element.classList.contains(detailStyles.choiceText)
        || element.classList.contains(tableStyles.cell)
        || element.classList.contains(pollStyles.optionLabel)
        // The shared outcome page (bet market and poll): the hero question,
        // a pick row's name, a result row's name and figures, a fact value,
        // and an approval checkbox, whose overflow-wrap the label inherits.
        || element.classList.contains(outcomeStyles.question)
        || element.classList.contains(outcomeStyles.identityTitle)
        || element.classList.contains(outcomeStyles.pickName)
        || element.classList.contains(outcomeStyles.resultName)
        || element.classList.contains(outcomeStyles.resultSub)
        || element.classList.contains(outcomeStyles.factValue)
        || Boolean(element.closest(`.${outcomeStyles.pickCheck}`))
        || element.classList.contains(sectionHeaderStyles.title)).toBe(true);
}

afterEach(() => {
    cleanup();
    resetWalletModes();
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

        // The calls are the Activity tab's list.
        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
        const executionLoading = await screen.findByText('Loading execution history…');
        expect(executionLoading.closest('[role="status"]')).toBeTruthy();
        expect(screen.queryByText('No contract activity yet')).toBeNull();
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

        // Fills and lifecycle events sit in one list on the Activity tab.
        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
        const activityLoading = await screen.findByText('Loading activity…');
        expect(activityLoading.closest('[role="status"]')).toBeTruthy();
        expect(screen.queryByText('No activity yet')).toBeNull();
    });

    it('shows empty dispenser activity as a bare empty state, not inside the list card', async () => {
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
            getDispenses: vi.fn().mockResolvedValue([]),
            getDispenserLifecycle: vi.fn().mockResolvedValue([]),
        });
        mount(<DispenserDetail walletId="wallet" chainId={CHAIN} actionIndex="7" onBack={() => {}} />, messaging);

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
        const activity = await screen.findByText('No activity yet');
        expect(activity.closest('ul')).toBeNull();
        expect(screen.queryByRole('list', { name: 'Dispenser activity' })).toBeNull();
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

        // The actions are the Actions tab's action list (G101, G102).
        expect(await screen.findByRole('list', { name: 'Contract actions' })).toBeTruthy();
        expectCompactCanvas(view.container);
        expectWrappingValue(screen.getByRole('heading', { name: new RegExp(LONG_NAME) }), LONG_NAME);
        expect(screen.getByRole('button', { name: /^Call by name/ }).getAttribute('aria-disabled')).toBeNull();
        // The identity card names the address too (a fitting AddressText,
        // G99); the Details tab's facts hold it whole in a wrapping value.
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const address = (await screen.findAllByLabelText(contractAddress)).find((el) => el.closest('dl'));
        expect(address.textContent).toBe(contractAddress);
        expect(address.closest('dd')).toHaveClass(betFeedStyles.factValue);
        const holding = screen.getByText(`${LARGE_AMOUNT} ${LONG_TICK}`);
        expect(holding.closest('dd')).toHaveClass(betFeedStyles.factValue);
        // The code hash is on the View code page, an Actions row.
        fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
        fireEvent.click(screen.getByRole('button', { name: /^View code/ }));
        expect(await screen.findByText(LONG_KEY, { selector: 'code' })).toBeTruthy();
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

        // The name heads the identity card and wraps; the actions open first,
        // the members sit on the List tab and the facts on Details.
        const name = await screen.findByRole('heading', { level: 2, name: LONG_NAME });
        expect(screen.getByRole('heading', { level: 1, name: 'List' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'List details' })).toBeNull();
        expectCompactCanvas(view.container);
        expect(name).toHaveClass(listDetailStyles.identityName);
        const actions = screen.getByRole('list', { name: 'List actions' });
        expect(within(actions).getByRole('button', { name: /^Fork\b/ })).toBeTruthy();
        expect(within(actions).getByRole('button', { name: /^Share\b/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const block = within(screen.getByText('Block').closest('li')).getByText(LARGE_AMOUNT);
        expect(block).toHaveClass(listDetailStyles.detailValue);
        fireEvent.click(screen.getByRole('tab', { name: 'List' }));
        expect(screen.getByLabelText(OTHER_LONG_ADDRESS)).toBeTruthy();
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

        const tiles = await screen.findByRole('list', { name: 'Stake actions' });
        expect(screen.getByRole('heading', { level: 1, name: 'Validator Stake' })).toBeTruthy();
        expectCompactCanvas(view.container);
        // The huge staked amount wraps inside the hero instead of clipping.
        const heroAmount = screen.getByText((_, node) => node?.classList?.contains(heroStyles.amountValue));
        expect(heroAmount.textContent.replaceAll(',', '')).toContain(LARGE_AMOUNT);
        // So does each bubble's amount (the Earned bubble holds the reward).
        const bubbles = screen.getByRole('group', { name: 'Rewards summary' });
        const earned = [...bubbles.querySelectorAll(`.${stakeStyles.bubbleAmount}`)].pop();
        expect(earned.textContent.replaceAll(',', '')).toContain(LARGE_AMOUNT);
        // Each action is a row of the shared action list, its title shown.
        for (const label of ['Claim', 'Unstake', 'Delegate']) {
            const row = within(tiles).getByRole('button', { name: new RegExp(`^${label}\\b`) });
            expect(within(row).getByText(label)).toBeTruthy();
        }

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const role = within(screen.getByText('Validator').closest('li')).getByText(LONG_NAME);
        expect(role).toHaveClass(stakeStyles.detailValue);
        // The delegated key is cut in the middle with the whole key in its title.
        expect(screen.getByTitle(LONG_KEY)).toBeTruthy();
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

        // The page opens on Actions (G102); the facts are on the Details tab.
        fireEvent.click(await screen.findByRole('tab', { name: /^Details$/ }));
        await waitFor(() => expect(detailValue('Dispensing')).toBeTruthy());
        expect(screen.getByRole('heading', { level: 1, name: 'Dispenser Detail' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Dispenser details' })).toBeNull();
        expectCompactCanvas(view.container);
        expectWrappingValue(detailValue('Dispensing'), LARGE_AMOUNT);
        expectWrappingValue(detailValue('Payment'), LARGE_AMOUNT);
        // The page is a Home-style card with Actions, Details and Activity tabs for every reader.
        for (const name of ['Actions', 'Details', 'Activity']) {
            expect(screen.getByRole('tab', { name })).toBeTruthy();
        }
        await waitFor(() => expect(screen.getByLabelText(OTHER_LONG_ADDRESS).textContent).toBe(OTHER_LONG_ADDRESS));
        expect(screen.getByLabelText(OTHER_LONG_ADDRESS).closest('dd').style.overflowWrap).toBe('anywhere');
        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
        expect(await screen.findByRole('list', { name: 'Dispenser activity' })).toBeTruthy();
    });

    it('keeps a long poll question, option, amount, and vote action visible', async () => {
        const option = `Option${'Choice'.repeat(16)}`;
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: POLL_INDEX,
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
            <PollDetail walletId="wallet" chainId={CHAIN} pollIndex={POLL_INDEX} onBack={() => {}} />,
            messaging,
        );

        expect(await screen.findByText(LONG_NAME.repeat(2))).toBeTruthy();
        expectCompactCanvas(view.container);
        // The question heads the hero as its own wrapping line, not a details row.
        expectWrappingValue(screen.getByText(LONG_NAME.repeat(2)), LONG_NAME.repeat(2));
        // The choice row is the bet market's outcome row and its own Vote
        // button: a long name stays on one line, cut with an ellipsis by the
        // shared stylesheet, and the row's accessible name carries it whole.
        const choiceAction = screen.getByRole('button', { name: `Vote for ${option}` });
        expect(choiceAction).toHaveClass(outcomeListStyles.row);
        expect(choiceAction.textContent).toContain(option);
        // The close block is a poll fact, under the Details option.
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expectWrappingValue(detailValue('Closes at block'), LARGE_AMOUNT);
    });

    it('keeps finalized poll result names and large totals visible', async () => {
        const option = `Final${'Outcome'.repeat(16)}`;
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: POLL_INDEX,
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
            <PollDetail walletId="wallet" chainId={CHAIN} pollIndex={POLL_INDEX} onBack={() => {}} />,
            messaging,
        );

        // Result's final results row: the option's name and its figures
        // each wrap through the shared outcome page's rules.
        const optionCell = await screen.findByText(`0: ${option}`);
        expectCompactCanvas(view.container);
        expect(optionCell).toHaveClass(outcomeStyles.resultName);
        const item = optionCell.closest('li');
        expect(item).toHaveClass(outcomeStyles.resultRow);
        expect(item).toHaveTextContent(`${LARGE_AMOUNT.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} weight`);
        expectWrappingValue(item.querySelector(`.${outcomeStyles.resultSub}`), LARGE_AMOUNT);
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeTruthy();
    });

    it('keeps a long bet feed name, split values, and review action visible', async () => {
        // Outcome labels display at most 40 characters.
        const outcome = `Outcome${'Result'.repeat(5)}`;
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
        // The market opens on Bet: each outcome is a list row. A long name
        // stays on one line, cut with an ellipsis by the shared stylesheet
        // (not inline styles), and the row's accessible name carries it whole.
        const outcomeAction = screen.getByRole('button', { name: new RegExp(`^Buy ${outcome}, `) });
        expect(outcomeAction).toHaveClass(outcomeListStyles.row);
        expect(outcomeAction.textContent).toContain(outcome);
        const outcomeCss = readFileSync('packages/core/src/shared/routes/OutcomeList.module.css', 'utf8');
        expect(outcomeCss).toMatch(/\.content > :first-child\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
        expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull();
        // The pool is a Details fact, its value wrapping.
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expectWrappingValue(detailValue('Pool'), LARGE_AMOUNT);
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
        // The wallet's mode is read from the wallet list, not from settings.
        publishWalletModes({ wallets: [{ id: 'wallet', walletMode: 'watcher' }], activeWalletId: 'wallet' });
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [address] }),
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet', name: 'W', walletMode: 'watcher' }]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 18 }),
        });
        const view = mountCompact(
            <SwapForm walletId="wallet" initialChainId={CHAIN} initialGiveTick={LONG_TICK} onBack={() => {}} />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        fireEvent.change(screen.getByLabelText(`Give amount (${LONG_TICK})`), { target: { value: LARGE_AMOUNT } });
        fireEvent.change(screen.getByLabelText(`Get amount (${LONG_GET_TICK})`), { target: { value: LARGE_AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        const sentence = await screen.findByTestId('confirm-sentence');
        expect(view.container.querySelector('main')).toContainElement(screen.getByTestId('confirm-modal'));
        const groupedAmount = LARGE_AMOUNT.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        expect(sentence).toHaveTextContent(`${groupedAmount} ${LONG_TICK}`);
        expect(sentence).toHaveTextContent(`${groupedAmount} ${LONG_GET_TICK}`);
        expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    });
});
