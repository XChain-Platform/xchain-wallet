// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { userEvent } from '../../helpers/userEvent.js';
import { typeCustomRate } from '../../helpers/customNetworkFee.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const DELEGATE = 'bc1qdevmock03aabbcc';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qdevmock01aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// Form sections other than the main one start closed; open one by its title.
function openSection(title) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

const confirmFactValue = (label) => within(screen.getByTestId('confirm-facts'))
    .getByText(label, { selector: 'dt' }).nextElementSibling;

// Fills the required poll fields: the question (open Poll section), two options
// (numbered from 1) and the closing block (closed Voting section).
function fillPoll(endBlock = '244') {
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Ship it?' } });
    fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Yes' } });
    fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'No' } });
    openSection('Voting');
    fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: endBlock } });
}

beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    resetBackStackForTests();
});

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getChainTipBlockTime: vi.fn().mockResolvedValue({ blockTime: 0 }),
        governancePolls: vi.fn().mockResolvedValue([]),
        governancePoll: vi.fn().mockResolvedValue(null),
        governancePollResults: vi.fn().mockResolvedValue([]),
        governanceVotes: vi.fn().mockResolvedValue([]),
        composeVoteForConfirm: vi.fn().mockResolvedValue({ psbt: '00', encoding: 'psbt' }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(Component, props, messaging = messagingWith()) {
    // The forms read the active wallet's mode (from its wallet-list record).
    publishWalletModes({ activeWalletId: 'wallet-1' });
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    ));
}

beforeEach(() => {
    // Wallet mode is read from the wallet list; forget the previous test's.
    resetWalletModes();
    __clearTokenInfoCache();
});

describe('governance route audit', () => {
    it('reaches the poll browser actions in order and dismisses the network picker with Escape', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onCreate = vi.fn();
        const onDelegate = vi.fn();
        const onOpenPoll = vi.fn();
        const messaging = messagingWith({
            governancePolls: vi.fn().mockResolvedValue([{
                action_index: 7,
                tick: 'VOTE',
                question: 'Ship keyboard navigation?',
                poll_status: 'open',
                end_block: 200,
            }]),
        });
        mount(GovernancePolls, {
            walletId: 'wallet-1', onOpenPoll, onCreate, onDelegate, onBack,
        }, messaging);

        await screen.findByText('Ship keyboard navigation?');
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        back.focus();
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        // The network, search and filters sit behind the title bar's filter
        // button; the plus beside it opens the New menu.
        await user.tab();
        const filter = screen.getByRole('button', { name: 'Filter polls' });
        expect(filter).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('dialog', { name: 'Filter polls' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Filter polls' })).toBeNull();
        expect(filter).toHaveFocus();

        await user.tab();
        const add = screen.getByRole('button', { name: 'New poll or delegation' });
        expect(add).toHaveFocus();
        await user.keyboard('{Enter}');
        await user.tab();
        expect(screen.getByRole('menuitem', { name: /^Create poll$/i })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onCreate).toHaveBeenCalledWith(CHAIN);

        add.focus();
        await user.keyboard('{Enter}');
        await user.tab();
        await user.tab();
        expect(screen.getByRole('menuitem', { name: /^Delegate votes$/i })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onDelegate).toHaveBeenCalledWith(CHAIN);

        const poll = screen.getByRole('button', { name: /Ship keyboard navigation/ });
        poll.focus();
        expect(poll).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onOpenPoll).toHaveBeenCalledWith(CHAIN, 7);
    });

    it('manages poll options and validates the close block and selection count before compose', async () => {
        const messaging = messagingWith();
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);

        fireEvent.click(screen.getByRole('button', { name: 'Add Option' }));
        // Options are numbered from 1 in the form.
        expect(screen.getByLabelText('Option 3')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Remove option 3' }));
        expect(screen.queryByLabelText('Option 3')).toBeNull();

        fillPoll('0');
        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        expect(await screen.findByText('End block must be a positive whole block height.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        expect(await screen.findByText('End block must be above the current indexed block (100).')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: '244' } });
        expect(await screen.findByText(/Estimated close: ~/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Voters can pick up to'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        expect(await screen.findByText('Max selections must be a whole number from 1 to 2.')).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('validates a malformed governance ticker before compose', async () => {
        const messaging = messagingWith();
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'BAD|TICK', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fillPoll();

        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));

        expect(await screen.findByText(/Governance token can only use letters/)).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        ['Question', 'safe\u202eunsafe', 'Question cannot contain text-direction control characters.'],
        ['Option 1', 'safe\u200bunsafe', 'Option cannot contain zero-width characters.'],
    ])('refuses hostile poll text from %s before compose', async (label, value, message) => {
        const messaging = messagingWith();
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fillPoll();
        fireEvent.change(screen.getByLabelText(label), { target: { value } });

        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('refuses poll creation from an address with no governance-token balance', async () => {
        const messaging = messagingWith({
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS.address,
                    balances: { tokens: [{ tick: 'XCHAIN', quantity: '10', divisibility: 0 }] },
                }],
            }),
        });
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
        fillPoll();

        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));

        expect(await screen.findByText('This address must hold some VOTE to create its poll.')).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('fixes the review/build mismatch by labeling and canonicalizing XCHAIN escrow amounts', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '00' });
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }), listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', walletMode: 'watcher' }]),
            getTokenInfo: vi.fn().mockImplementation(({ tick }) => Promise.resolve({
                tick, divisibility: tick === 'XCHAIN' ? 2 : 1,
            })),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS.address,
                    balances: {
                        tokens: [
                            { tick: 'VOTE', quantity: '100', divisibility: 1 },
                            { tick: 'XCHAIN', quantity: '500', divisibility: 2 },
                        ],
                    },
                }],
            }),
            buildActionPsbtRequest,
        });
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
        fillPoll();
        openSection('Rules to Pass');
        openSection('Deposit');
        openSection('Run a Contract When It Ends');
        fireEvent.change(screen.getByLabelText('Minimum vote balance'), { target: { value: '1.23' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        expect(await screen.findByText('Minimum vote balance can have at most 1 decimal place for VOTE.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Minimum vote balance'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Creation deposit (XCHAIN)'), { target: { value: '-1' } });
        expect(await screen.findByText(/Enter a valid decimal amount/)).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Creation deposit (XCHAIN)'), { target: { value: '3.001' } });
        expect(await screen.findByText('Amount can have at most 2 decimal places.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Creation deposit (XCHAIN)'), { target: { value: '3.00' } });
        fireEvent.change(screen.getByLabelText('Contract to call'), { target: { value: '42' } });
        fireEvent.change(screen.getByLabelText('Method to run'), { target: { value: 'release' } });
        fireEvent.change(screen.getByLabelText('Quorum'), { target: { value: '0.2' } });
        fireEvent.change(screen.getByLabelText('Minimum voters'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Escrow to fund the call (XCHAIN)'), { target: { value: '2.01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        expect(await screen.findByText(/creation deposit and callback escrow together must stay within that balance/)).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Escrow to fund the call (XCHAIN)'), { target: { value: '2.00' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        expect(await screen.findByText(/Another phone signs for this wallet: this prepares the transaction for it/)).toBeTruthy();
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Create poll for VOTE holders: Ship it?');
        expect(confirmFactValue('Creation deposit')).toHaveTextContent('3 XCHAIN');
        expect(confirmFactValue('Callback escrow')).toHaveTextContent('2 XCHAIN');
        expect(confirmFactValue('End block')).toHaveTextContent('244');
        expect(confirmFactValue('Maximum selections')).toHaveTextContent('1');
        expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText('Creation deposit (XCHAIN)')).toHaveValue('3');
        expect(screen.getByLabelText('Escrow to fund the call (XCHAIN)')).toHaveValue('2');

        fireEvent.click(screen.getByRole('button', { name: /^Create poll$/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            actionData: expect.objectContaining({
                params: expect.objectContaining({ DEPOSIT: '3', GAS_ESCROW: '2' }),
            }),
        }));
    });

    it('starts a new poll with fresh fields when the wallet context changes', async () => {
        const messaging = messagingWith();
        const renderForm = (walletId) => React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(CreatePollForm, {
                walletId, chainId: CHAIN, presetTick: 'VOTE', onBack() {},
            }),
        );
        const mounted = render(renderForm('wallet-1'));
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Old question' } });
        fireEvent.change(screen.getByLabelText('Tally mode'), { target: { value: 'split' } });

        mounted.rerender(renderForm('wallet-2'));

        expect(await screen.findByLabelText('Question')).toHaveValue('');
        expect(screen.getByLabelText('Tally mode')).toHaveValue('approval');
    });

    it('admits only one watcher poll build from batched Approve clicks', async () => {
        const never = new Promise(() => {});
        const buildActionPsbtRequest = vi.fn(() => never);
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }), listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', walletMode: 'watcher' }]),
            buildActionPsbtRequest,
        });
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fillPoll();
        fireEvent.click(await screen.findByRole('button', { name: /^Create poll$/i }));
        const approve = await screen.findByRole('button', { name: 'Approve' });

        act(() => {
            fireEvent.click(approve);
            fireEvent.click(approve);
        });

        expect(buildActionPsbtRequest).toHaveBeenCalledOnce();
    });

    it('keeps delegation required-field messages reachable from the primary action', async () => {
        mount(DelegateVoteForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} });
        await screen.findByDisplayValue(ADDRESS.address);
        const action = screen.getByRole('button', { name: /^Delegate votes$/i });
        expect(action).toBeEnabled();
        fireEvent.click(action);
        expect(await screen.findByText('Governance token is required.')).toBeTruthy();
    });

    it('opens with the From section (Network, then From), then the Delegation section, with no mode buttons (U60)', async () => {
        mount(DelegateVoteForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} });
        const from = await screen.findByDisplayValue(ADDRESS.address);
        const fromSection = document.querySelector('[data-form-section="from"]');
        const network = within(fromSection).getByText('Network');
        const delegation = document.querySelector('[data-form-section="delegation"]');
        const follows = Node.DOCUMENT_POSITION_FOLLOWING;
        expect(fromSection.contains(from)).toBe(true);
        expect(network).not.toBeNull();
        expect(network.compareDocumentPosition(from) & follows).toBeTruthy();
        expect(fromSection.compareDocumentPosition(delegation) & follows).toBeTruthy();
        expect(delegation.contains(screen.getByLabelText('Delegate to address'))).toBe(true);
        // Delegate and clear are separate forms now, so no Action choice or mode buttons.
        expect(screen.queryByRole('group', { name: 'Action' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delegate' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
        // The help tip lives inside the closed From section; open it first.
        openSection('From');
        expect(screen.getByRole('button', { name: 'About From address' })).toBeTruthy();
    });

    it('names its main action per mode with an icon, never Review or Preview (U63)', async () => {
        mount(DelegateVoteForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} });
        await screen.findByDisplayValue(ADDRESS.address);
        const delegate = screen.getByRole('button', { name: /^Delegate votes$/i });
        expect(delegate.className).toMatch(/success/);
        expect(delegate.querySelector('svg')).not.toBeNull();
        cleanup();
        // Clearing starts from a My delegations row, which names the address,
        // token and current delegate.
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, mode: 'clear',
            clear: { tick: 'VOTE', delegate: DELEGATE, address: ADDRESS.address }, onBack() {},
        });
        await screen.findByDisplayValue(ADDRESS.address);
        const clear = screen.getByRole('button', { name: /^Clear delegation$/i });
        expect(clear.className).toMatch(/success/);
        expect(clear.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    });

    it('shows the From picker icon locked on a clear, with the reason', async () => {
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, mode: 'clear',
            clear: { tick: 'VOTE', delegate: DELEGATE, address: ADDRESS.address }, onBack() {},
        });
        await screen.findByDisplayValue(ADDRESS.address);
        openSection('From');
        const from = screen.getByLabelText('From address');
        expect(from).toHaveAttribute('readonly');
        const picker = screen.getByRole('button', { name: 'Choose source address' });
        expect(picker).toHaveAttribute('aria-disabled', 'true');
        expect(picker).toHaveAttribute('title', "The delegation's own address signs this clear");
        // Locked, not hidden: clicking it opens no picker page.
        fireEvent.click(picker);
        expect(screen.getByLabelText('From address')).toBeInTheDocument();
    });

    it('draws a lone memo without its own label row and counts in the Memo header', async () => {
        mount(DelegateVoteForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} });
        await screen.findByDisplayValue(ADDRESS.address);
        openSection('Memo');
        const section = document.querySelector('[data-form-section="memo"]');
        const memo = screen.getByRole('textbox', { name: 'Memo' });
        expect(section.contains(memo)).toBe(true);
        // "Memo" shows once, as the section title: no field label, no ? tip.
        expect(within(section).getAllByText('Memo')).toHaveLength(1);
        expect(section.querySelector('label')).toBeNull();
        expect(screen.queryByRole('button', { name: 'About Memo' })).toBeNull();
        const header = section.querySelector('[data-form-section-toggle]');
        const count = header.querySelector('[data-section-count]');
        expect(count).toHaveTextContent('0 / 250');
        expect(header.textContent.indexOf('Optional')).toBeLessThan(header.textContent.indexOf('0 / 250'));
        fireEvent.change(memo, { target: { value: 'keep my vote' } });
        expect(count).toHaveTextContent('12 / 250');
        expect(memo).toHaveAttribute('maxLength', '250');
        expect(memo.getAttribute('aria-describedby')).toContain(count.firstElementChild.id);
    });

    it('validates the source address and governance token before delegation compose', async () => {
        const invalidSource = { ...ADDRESS, address: 'not-an-address' };
        const sourceMessaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [invalidSource] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: invalidSource.id } }),
        });
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, sourceMessaging);
        await screen.findByDisplayValue(invalidSource.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText('The selected source address is not valid for this network.')).toBeTruthy();
        expect(sourceMessaging.composeVoteForConfirm).not.toHaveBeenCalled();

        cleanup();
        const tickMessaging = messagingWith();
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'BAD|TICK', onBack() {},
        }, tickMessaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText(/Governance token can only use letters/)).toBeTruthy();
        expect(tickMessaging.composeVoteForConfirm).not.toHaveBeenCalled();

        cleanup();
        const idMessaging = messagingWith();
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: '^0', onBack() {},
        }, idMessaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText('Governance token cannot contain ^. That form is reserved for token IDs.')).toBeTruthy();
        expect(idMessaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('validates delegation addresses and memo text before compose', async () => {
        const source = { ...ADDRESS, address: 'bc1qdevmock02aabbcc' };
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [source] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: source.id } }),
        });
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(source.address);

        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: 'not-an-address' } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText(/Delegate-to address is not valid/)).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: source.address } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText('Delegate-to address must be different from the source address.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'bad|memo' } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText('Memo cannot contain | or ; characters.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: `${'😀'.repeat(125)}a` } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findByText('Memo is 251 characters; the network accepts at most 250 characters.')).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('blocks vote delegation custom fee rates that cannot be built', async () => {
        const messaging = messagingWith();
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        openSection('Speed and Fees');
        await typeCustomRate('');
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findAllByText('Enter a custom network fee.')).toHaveLength(1);

        for (const [rate, message] of [
            ['0', 'Custom fee rate must be greater than zero.'],
            ['-1', 'Enter a valid non-negative network fee amount.'],
        ]) {
            await typeCustomRate(rate);
            fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
            expect(await screen.findAllByText(message)).toHaveLength(1);
        }
        // The one editor takes a fee, so a rate with more than 8 decimals cannot
        // be typed; FeeSelector.test covers that message.

        await typeCustomRate('1001');
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        expect(await screen.findAllByText('Enter a rate no higher than 1,000 sat/vB.')).toHaveLength(1);
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('reviews and builds the same trimmed delegation values, then keeps form input on Back', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '00' });
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }), listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', walletMode: 'watcher' }]),
            buildActionPsbtRequest,
        });
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: '  VoTe  ', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: `  ${DELEGATE}  ` } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '  keep my vote  ' } });
        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent(`Delegate VoTe voting power to ${DELEGATE}`);
        expect(screen.getByText(/Another phone signs for this wallet: this prepares the transaction for it/)).toBeTruthy();
        expect(confirmFactValue('Delegate to')).toHaveTextContent(DELEGATE);
        expect(confirmFactValue('Memo')).toHaveTextContent('keep my vote');

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText('Delegate to address')).toHaveValue(`  ${DELEGATE}  `);
        expect(screen.getByLabelText('Memo')).toHaveValue('  keep my vote  ');

        fireEvent.click(screen.getByRole('button', { name: /^Delegate votes$/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        expect(buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            actionData: {
                action: 'VOTE',
                params: { VERSION: '3', TICK: 'VoTe', DELEGATE_TO: DELEGATE, MEMO: 'keep my vote' },
            },
        }));
    });

    it('turns delegation address-load failures into plain copy', async () => {
        const internal = new Error('getAddressesByChain: failed at https://wallet.invalid/private');
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messagingWith({ getAddressesByChain: vi.fn().mockRejectedValue(internal) }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load your addresses. Something went wrong. Try again.");
        expect(alert).not.toHaveTextContent('wallet.invalid');
    });

    it('starts a new delegation with fresh fields when the wallet context changes', async () => {
        const messaging = messagingWith();
        const renderForm = (walletId) => React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DelegateVoteForm, {
                walletId, chainId: CHAIN, presetTick: 'VOTE', onBack() {},
            }),
        );
        const mounted = render(renderForm('wallet-1'));
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Old memo' } });

        mounted.rerender(renderForm('wallet-2'));

        expect(await screen.findByLabelText('Delegate to address')).toHaveValue('');
        expect(screen.getByLabelText('Memo')).toHaveValue('');
    });

    it('admits only one watcher delegation build from batched Approve clicks', async () => {
        const never = new Promise(() => {});
        const buildActionPsbtRequest = vi.fn(() => never);
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }), listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', walletMode: 'watcher' }]),
            buildActionPsbtRequest,
        });
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Delegate to address'), { target: { value: DELEGATE } });
        fireEvent.click(await screen.findByRole('button', { name: /^Delegate votes$/i }));
        const approve = await screen.findByRole('button', { name: 'Approve' });

        act(() => {
            fireEvent.click(approve);
            fireEvent.click(approve);
        });

        expect(buildActionPsbtRequest).toHaveBeenCalledOnce();
    });

    it('unwraps explorer poll rows and displays finalized results', async () => {
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                data: [{
                    action_index: 7,
                    tick: 'VOTE',
                    question: 'Ship it?',
                    poll_status: 'finalized',
                    options: ['Yes', 'No'],
                    tally_mode: 'approval',
                    weight_mode: 'balance',
                    end_block: 120,
                    winning_option: 0,
                }],
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [{ option_index: 0, total_weight: '42', voter_count: 3 }],
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: 'bitcoin-regtest', pollIndex: 7, onBack() {},
        }, messaging);

        expect(await screen.findByText('Ship it?')).toBeTruthy();
        // A decided yes/no poll states its outcome first on Result.
        const result = screen.getByRole('tabpanel', { name: 'Result' });
        expect(within(result).getByRole('note')).toHaveTextContent('Approved');
        expect(screen.getAllByText('0: Yes')).toHaveLength(1);
        expect(screen.getByText('42 weight, 3 voters')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
        // Details names the winning option too.
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.getByText('0: Yes', { selector: 'dd' })).toBeTruthy();
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it('shows the current ballot, delegation rules, change action, and block countdown', async () => {
        const messaging = messagingWith({
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 110 }),
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                max_selections: 1,
                end_block: 120,
            }),
            governanceVotes: vi.fn().mockResolvedValue({
                data: [
                    { action_index: 50, source: ADDRESS.address, poll_index: 7, choice: 0, share: '1' },
                    { action_index: 55, source: ADDRESS.address, poll_index: 7, choice: 1, share: '1', weight: '1200' },
                ],
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 7, onBack() {},
        }, messaging);

        // The latest ballot is named under the choice list; the rows stay
        // buttons, since a later vote replaces it until the close.
        expect(await screen.findByText('You voted: 1: No')).toBeTruthy();
        expect(screen.queryByText('You voted: 0: Yes')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Your vote' })).toBeTruthy();
        expect(screen.getByText('Voting weight: 1,200 VOTE')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Change Vote' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Vote for Yes' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Vote for No' })).toBeEnabled();
        // G121: the read-only votes and voters line carries no help tip, so
        // the delegation rule is not on the poll page itself.
        expect(screen.queryByText(/A direct vote overrides any standing VOTE delegation/)).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.getByText('10 blocks remaining')).toBeTruthy();
        expect(messaging.governanceVotes).toHaveBeenCalledWith({
            chainId: CHAIN, query: ADDRESS.address, type: 'address',
        });

        // The delegation rule is the help of the editable ballot: Cast Vote's
        // Change opens the choice editor, whose help tip states it.
        fireEvent.click(screen.getByRole('tab', { name: 'Vote' }));
        fireEvent.click(screen.getByRole('button', { name: 'Vote for No' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Change your choice' }));
        expect(await screen.findByText(/A direct vote overrides any standing VOTE delegation/)).toBeTruthy();
    });

    it('closes the editor at a passed end block and loads finalized results', async () => {
        const messaging = messagingWith({
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 121 }),
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 9,
                tick: 'VOTE',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                max_selections: 1,
                end_block: 120,
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [{ option_index: 1, total_weight: '25', voter_count: 2 }],
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 9, onBack() {},
        }, messaging);

        // The hero's status chip, then Result's verdict, both say so.
        expect(await screen.findAllByText('Awaiting finalization')).toHaveLength(2);
        expect(document.querySelector('[data-outcome-chip="status"]')).toHaveTextContent('Awaiting finalization');
        expect(await screen.findByText('25 weight, 2 voters')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Vote' })).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.getByText('Voting closed', { selector: 'dd' })).toBeTruthy();
        expect(messaging.governancePollResults).toHaveBeenCalledWith({ chainId: CHAIN, pollIndex: 9 });
    });

    it('reports a missing poll instead of leaving the loading state forever', async () => {
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 404, onBack() {},
        });
        expect(await screen.findByText('Poll not found.')).toBeTruthy();
        expect(screen.queryByText('Loading poll…')).toBeNull();
    });

    it('rejects a malformed poll id without querying the indexer', async () => {
        const messaging = messagingWith();
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: '7x', onBack() {},
        }, messaging);

        expect(await screen.findByText('Poll number must be a positive whole number.')).toBeTruthy();
        expect(messaging.governancePoll).not.toHaveBeenCalled();
        expect(messaging.governanceVotes).not.toHaveBeenCalled();
    });

    it('renders indexer failures as plain copy without exposing the request URL', async () => {
        const failure = Object.assign(
            new Error('Explorer returned HTTP 502 for https://service.invalid/api/polls/7'),
            { name: 'SDKExplorerError' },
        );
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 7, onBack() {},
        }, messagingWith({ governancePoll: vi.fn().mockRejectedValue(failure) }));

        expect(await screen.findByText(/Couldn.t load this poll.*temporarily unavailable/)).toBeTruthy();
        expect(screen.queryByText(/service\.invalid/)).toBeNull();
    });

    it('rejects invalid split shares before composing a ballot', async () => {
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 8,
                tick: 'VOTE',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'split',
                max_selections: 2,
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 8, onBack() {},
        }, messaging);

        // The Yes row opens Cast Vote with the split shares open, Yes at 1.
        const yes = await screen.findByRole('button', { name: 'Vote for Yes' });
        await waitFor(() => expect(yes).toBeEnabled());
        fireEvent.click(yes);
        const share = await screen.findByLabelText('0: Yes');
        expect(share).toHaveValue('1');
        fireEvent.change(share, { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign Vote' }));
        expect(await screen.findByText('Each split share must be a positive plain number.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('0: Yes'), { target: { value: 'not-a-number' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign Vote' }));
        expect(await screen.findByText('Each split share must be a positive plain number.')).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a ballot from an address with no governance-token balance', async () => {
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 8,
                tick: 'VOTE',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                max_selections: 1,
            }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{ address: ADDRESS.address, balances: { tokens: [] } }],
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 8, onBack() {},
        }, messaging);
        const yes = await screen.findByRole('button', { name: 'Vote for Yes' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });

        // The Yes row opens Cast Vote; Sign Vote checks the address's balance.
        fireEvent.click(yes);
        fireEvent.click(await screen.findByRole('button', { name: 'Sign Vote' }));

        expect(await screen.findAllByText('This address must hold some VOTE to vote.')).toHaveLength(2);
        // The error belongs to From, which reopens to show the address.
        expect(screen.getByRole('button', { name: /^From\b/, expanded: true })).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('shows the built ballot memo on watcher review and keeps it after Back', async () => {
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }), listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', walletMode: 'watcher' }]),
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 8,
                tick: 'VOTE',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                max_selections: 1,
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 8, onBack() {},
        }, messaging);

        const yes = await screen.findByRole('button', { name: 'Vote for Yes' });
        await waitFor(() => expect(yes).toBeEnabled());
        fireEvent.click(yes);
        fireEvent.change(await screen.findByLabelText('Memo'), { target: { value: 'Fund it' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign Vote' }));

        // The review lists the vote's fields; the repeated summary sentence is gone.
        expect(await screen.findByText('Fund it')).toBeTruthy();
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('BTC');
        // Back walks the review to Cast Vote, keeping the memo and the
        // choice, then Cast Vote to the poll's choice list.
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('heading', { name: 'Cast Vote' })).toBeTruthy();
        expect(screen.getByLabelText('Memo')).toHaveValue('Fund it');
        expect([...document.querySelectorAll('[data-poll-chosen] li')].map((li) => li.textContent)).toEqual(['0: Yes']);
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('button', { name: 'Vote for Yes' })).toBeTruthy();
    });

    it('shows the poll-list empty state after a successful empty read', async () => {
        mount(GovernancePolls, {
            walletId: 'wallet-1', onOpenPoll() {}, onCreate() {}, onDelegate() {}, onBack() {},
        });
        expect(await screen.findByText('No polls yet')).toBeTruthy();
        expect(screen.queryByText('Polls created on this network appear here.')).toBeNull();
    });

    it('hides poll rows that belong to the previous wallet while the next list loads', async () => {
        const never = new Promise(() => {});
        const governancePolls = vi.fn()
            .mockResolvedValueOnce([{
                action_index: 19,
                tick: 'VOTE',
                question: 'Previous wallet poll',
                poll_status: 'open',
                end_block: 300,
            }])
            .mockImplementation(() => never);
        const messaging = messagingWith({ governancePolls });
        const renderPolls = (walletId) => React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(GovernancePolls, {
                walletId, onOpenPoll() {}, onCreate() {}, onDelegate() {}, onBack() {},
            }),
        );
        const mounted = render(renderPolls('wallet-1'));
        expect(await screen.findByText('Previous wallet poll')).toBeTruthy();

        mounted.rerender(renderPolls('wallet-2'));

        expect(screen.queryByText('Previous wallet poll')).toBeNull();
        expect(screen.getByRole('status', { name: 'Loading governance addresses' })).toBeTruthy();
    });

    it('renders a long poll-list card and its actions at 320px', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        const longQuestion = 'Should-the-community-fund-this-unbroken-public-infrastructure-reference?';
        try {
            mount(GovernancePolls, {
                walletId: 'wallet-1', onOpenPoll() {}, onCreate() {}, onDelegate() {}, onBack() {},
            }, messagingWith({
                governancePolls: vi.fn().mockResolvedValue({
                    data: [{
                        action_index: 22,
                        tick: 'COMMUNITY-GOVERNANCE-TOKEN',
                        question: longQuestion,
                        poll_status: 'open',
                        end_block: 150,
                    }],
                }),
            }));

            expect(await screen.findByText(longQuestion)).toBeTruthy();
            expect(screen.getByText('Open')).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'New poll or delegation' }));
            expect(screen.getByRole('menuitem', { name: /^Create poll$/i })).toBeTruthy();
            expect(screen.getByRole('menuitem', { name: /^Delegate votes$/i })).toBeTruthy();
            // The poll card is one button named by its question (the poll number is no longer printed).
            expect(screen.getByRole('button', { name: new RegExp(longQuestion) })).toBeTruthy();
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('keeps long voting options, the countdown, and the vote action in the 320px render', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        const longOption = 'Fund-the-community-owned-infrastructure-program-with-an-unbroken-reference';
        try {
            mount(PollDetail, {
                walletId: 'wallet-1', chainId: CHAIN, pollIndex: 12, onBack() {},
            }, messagingWith({
                getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
                governancePoll: vi.fn().mockResolvedValue({
                    action_index: 12,
                    tick: 'VOTE',
                    poll_status: 'open',
                    question: 'Choose the next community project',
                    options: [longOption, 'Keep the treasury unchanged'],
                    tally_mode: 'approval',
                    max_selections: 1,
                    end_block: 125,
                }),
            }));

            // The long choice is its own row, and the row is the vote action.
            const row = await screen.findByRole('button', { name: `Vote for ${longOption}` });
            expect(row.textContent).toContain(longOption);
            expect(screen.getByRole('tabpanel', { name: 'Vote' }).contains(row)).toBe(true);
            fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
            expect(screen.getByText('25 blocks remaining')).toBeTruthy();
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('renders wrapped result labels, text values, and bars at 360px', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        const longOption = 'Community-maintained-public-goods-and-validator-infrastructure';
        try {
            mount(PollDetail, {
                walletId: 'wallet-1', chainId: CHAIN, pollIndex: 13, onBack() {},
            }, messagingWith({
                governancePoll: vi.fn().mockResolvedValue({
                    action_index: 13,
                    tick: 'VOTE',
                    poll_status: 'finalized',
                    options: [longOption, 'No'],
                    tally_mode: 'approval',
                    end_block: 120,
                    winning_option: 0,
                }),
                governancePollResults: vi.fn().mockResolvedValue({
                    data: [
                        { option_index: 0, total_weight: '987654321012345', voter_count: 17 },
                        { option_index: 1, total_weight: '123', voter_count: 2 },
                    ],
                }),
            }));

            expect(await screen.findByText('987,654,321,012,345 weight, 17 voters')).toBeTruthy();
            // Each final result row carries its share and a bar of it.
            const results = screen.getByRole('region', { name: 'Final Results' });
            const rows = [...results.querySelectorAll('li')];
            expect(rows.map((row) => row.textContent)).toEqual([
                `0: ${longOption}Winner100%987,654,321,012,345 weight, 17 voters`,
                '1: No0%123 weight, 2 voters',
            ]);
            expect(rows.map((row) => row.querySelector('[aria-hidden="true"] > span')?.style.width)).toEqual(['100%', '0%']);
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('retries a failed poll-list load', async () => {
        const messaging = messagingWith({
            governancePolls: vi.fn()
                .mockRejectedValueOnce(new Error('Polls unavailable'))
                .mockResolvedValueOnce([]),
        });
        mount(GovernancePolls, {
            walletId: 'wallet-1', onOpenPoll() {}, onCreate() {}, onDelegate() {}, onBack() {},
        }, messaging);

        expect(await screen.findByText('Polls unavailable')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

        expect(await screen.findByText('No polls yet')).toBeTruthy();
        expect(messaging.governancePolls).toHaveBeenCalledTimes(2);
    });
});
