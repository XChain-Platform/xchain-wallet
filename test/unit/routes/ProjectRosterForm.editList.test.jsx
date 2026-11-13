// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Project Tokens page edits the project's one list instead of starting
// over. Each test checks the exact LIST and LINK messages handed to
// composition: a new list is LIST v4 then a LINK; a name or description change
// alone is one LIST v5 on the same list with no LINK; a token change is the
// new full list as v4 with its name and description, then a LINK.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, chainIdFilter, onSelect, onBack }) => (
        <section aria-label={title}>
            <span data-testid="token-picker-chain">{chainIdFilter}</span>
            <input aria-label="Token to pick" id="pick-tick" />
            <input aria-label="Chain to pick" id="pick-chain" />
            <button
                type="button"
                onClick={() => onSelect({
                    chainId: document.getElementById('pick-chain').value || chainIdFilter,
                    tick: document.getElementById('pick-tick').value,
                })}
            >
                Pick token
            </button>
            <button type="button" onClick={onBack}>Close token picker</button>
        </section>
    ),
}));

const CHAIN = 'dogecoin-testnet';
const OWNER = {
    id: 'address-1',
    address: 'DProjectOwnerAddress',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};
const LIST_TXID = 'aa'.repeat(32);
const LINK_TXID = 'bb'.repeat(32);
const META_FORMATS = {
    0: 'VERSION|TYPE|MEMO|ITEM',
    4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|ITEM',
    5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
};
const EXISTING = {
    tick: 'PROJ',
    roster_action_index: 50,
    membership_action_index: 50,
    link_action_index: 51,
    total: 2,
    members: [{ tick: 'AAA' }, { tick: 'BBB' }],
};

function messagingWith(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
        getProjectForToken: vi.fn().mockResolvedValue(null),
        getActionFormats: vi.fn().mockResolvedValue(META_FORMATS),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 50, name: 'Old name', description: 'Old description', source: OWNER.address,
        }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        createList: vi.fn().mockResolvedValue({ txid: LIST_TXID }),
        getActionByTxid: vi.fn().mockResolvedValue({ action_index: 91 }),
        linkAction: vi.fn().mockResolvedValue({ txid: LINK_TXID }),
        ...overrides,
    };
}

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ProjectRosterForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="PROJ"
                issuerAddress={OWNER.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

function addToken(tick, chainId = '') {
    fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
    fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: tick } });
    if (chainId) fireEvent.change(screen.getByLabelText('Chain to pick'), { target: { value: chainId } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
}

// The actionData of every compose call, in order.
function composed(messaging) {
    return messaging.composeForConfirm.mock.calls.map(([req]) => req.actionData);
}

async function signReviewedList() {
    await screen.findByRole('form', { name: 'Review official token list' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish List' }));
    fireEvent.click(await screen.findByTestId('confirm-approve'));
}

async function signLink(messaging) {
    await screen.findByRole('form', { name: 'Review official token link' });
    fireEvent.click(screen.getByRole('button', { name: 'Make It Official' }));
    fireEvent.click(await screen.findByTestId('confirm-approve'));
    await waitFor(() => expect(messaging.linkAction).toHaveBeenCalled());
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProjectRosterForm creates a new list', () => {
    it('sends LIST v4 with the name, description and picked tokens, then the owner LINK', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await screen.findByText('No list published yet. This will be the first.');
        expect(screen.getByText(/two transactions: the list, then the link/)).toBeTruthy();

        fireEvent.change(screen.getByRole('textbox', { name: /^List name/ }), { target: { value: 'Game items' } });
        fireEvent.change(screen.getByRole('textbox', { name: /^Description/ }), { target: { value: 'Every PROJ card' } });
        addToken('AAA');
        addToken('BBB');
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));

        const review = await screen.findByRole('form', { name: 'Review official token list' });
        expect(review).toHaveTextContent('Game items');
        expect(review).toHaveTextContent('Every PROJ card');
        await signReviewedList();
        await signLink(messaging);

        const [list, link] = composed(messaging);
        expect(list).toEqual({
            action: 'LIST',
            params: { VERSION: '4', TYPE: '1', NAME: 'Game items', DESCRIPTION: 'Every PROJ card', ITEM: ['AAA', 'BBB'] },
        });
        expect(link.action).toBe('LINK');
        expect(link.params).toEqual(expect.objectContaining({
            VERSION: '0', COIN1: 'DOGE', COIN2: 'DOGE', COIN2_ACTION_INDEX: '77', MEMO: '',
        }));
        expect(String(link.params.COIN1_ACTION_INDEX)).toBe('91');
        // Dogecoin needs the native-fee flag even on these feeless actions.
        const [listReq] = messaging.composeForConfirm.mock.calls[0];
        expect(listReq.encoderOpts).toEqual(expect.objectContaining({ payFeeInNativeCoin: true }));
        expect(messaging.createList).toHaveBeenCalledWith(expect.objectContaining({
            params: list.params, payFeeInNativeCoin: true,
        }));
        expect(await screen.findByText('Official list published')).toBeTruthy();
    });

    it('sends LIST v0 when the name and description are both empty', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await screen.findByText('No list published yet. This will be the first.');
        addToken('AAA');
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));
        await signReviewedList();
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0]).toEqual({
            action: 'LIST', params: { VERSION: '0', TYPE: '1', ITEM: ['AAA'] },
        });
    });

    it('refuses a token from another network and keeps the picker on the project chain', async () => {
        mount(messagingWith());
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
        expect(screen.getByTestId('token-picker-chain')).toHaveTextContent(CHAIN);
        fireEvent.click(screen.getByRole('button', { name: 'Close token picker' }));

        addToken('LTCTOKEN', 'litecoin-testnet');
        expect(await screen.findByText(/Pick a token on .*The project list counts only tokens on its own network/)).toBeTruthy();
        expect(screen.queryByRole('listitem')).toBeNull();
    });
});

describe('ProjectRosterForm edits the existing list', () => {
    it('shows the current name, description and tokens as rows with remove and add', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);

        expect(await screen.findByDisplayValue('Old name')).toBeTruthy();
        expect(screen.getByDisplayValue('Old description')).toBeTruthy();
        expect(messaging.getListByActionIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '50' });
        const rows = screen.getAllByRole('listitem');
        expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('AAA'), expect.stringContaining('BBB')]);
        expect(screen.getByRole('button', { name: 'Remove AAA' }).querySelector('svg[data-xc-icon]')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled();
        expect(screen.getByRole('button', { name: /^Save project tokens$/i })).toBeTruthy();
        expect(screen.queryByRole('textbox', { name: /one per line/ })).toBeNull();
    });

    it('refuses a save with nothing changed', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        fireEvent.click(screen.getByRole('button', { name: /^Save project tokens$/i }));
        expect(await screen.findByText(/Nothing to save/)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('saves a name change as one LIST v5 on the same list with no LINK', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        fireEvent.change(await screen.findByDisplayValue('Old name'), { target: { value: 'New name' } });
        expect(screen.getByText(/one transaction: the new name and description/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Save project tokens$/i }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());

        expect(composed(messaging)).toEqual([{
            action: 'LIST',
            params: { VERSION: '5', LIST_ACTION_INDEX: '50', NAME: 'New name', DESCRIPTION: '', MEMO: '' },
        }]);
        expect(await screen.findByText('Project tokens saved')).toBeTruthy();
        expect(screen.getByText('List details transaction')).toBeTruthy();
        expect(messaging.linkAction).not.toHaveBeenCalled();
        expect(messaging.getActionByTxid).not.toHaveBeenCalled();
    });

    it('clears a description with the v5 dash', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        fireEvent.change(await screen.findByDisplayValue('Old description'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save project tokens$/i }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0].params).toEqual({
            VERSION: '5', LIST_ACTION_INDEX: '50', NAME: '', DESCRIPTION: '-', MEMO: '',
        });
    });

    it('republishes the full list with its name and description and re-links it after a token change', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        fireEvent.click(screen.getByRole('button', { name: 'Remove BBB' }));
        addToken('CCC');
        expect(screen.getByText(/two transactions: the new full list, then the link/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Save project tokens$/i }));
        await signReviewedList();
        await signLink(messaging);

        const [list, link] = composed(messaging);
        expect(list).toEqual({
            action: 'LIST',
            params: { VERSION: '4', TYPE: '1', NAME: 'Old name', DESCRIPTION: 'Old description', ITEM: ['AAA', 'CCC'] },
        });
        expect(link.action).toBe('LINK');
        expect(String(link.params.COIN1_ACTION_INDEX)).toBe('91');
        expect(link.params.COIN2_ACTION_INDEX).toBe('77');
    });

    it('republishes instead of SET META when this address does not own the list', async () => {
        const messaging = messagingWith({
            getProjectForToken: vi.fn().mockResolvedValue(EXISTING),
            getListByActionIndex: vi.fn().mockResolvedValue({
                action_index: 50, name: 'Old name', description: '', source: 'DSomeoneElse',
            }),
        });
        mount(messaging);
        fireEvent.change(await screen.findByDisplayValue('Old name'), { target: { value: 'New name' } });
        expect(screen.getByText(/doesn't own the current list/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Save project tokens$/i }));
        await signReviewedList();
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0]).toEqual({
            action: 'LIST',
            params: { VERSION: '4', TYPE: '1', NAME: 'New name', DESCRIPTION: '', ITEM: ['AAA', 'BBB'] },
        });
    });

    it('locks token changes when the wallet loaded only part of the list', async () => {
        const messaging = messagingWith({
            getProjectForToken: vi.fn().mockResolvedValue({ ...EXISTING, total: 1500 }),
        });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        expect(screen.getByText(/holds 1500 tokens and the wallet loaded 2/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add Token' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove AAA' })).toBeDisabled();

        // The name can still change, through SET META.
        fireEvent.change(screen.getByDisplayValue('Old name'), { target: { value: 'New name' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save project tokens$/i }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0].params.VERSION).toBe('5');
    });

    it('stops on a failed read of the list name and description', async () => {
        const messaging = messagingWith({
            getProjectForToken: vi.fn().mockResolvedValue(EXISTING),
            getListByActionIndex: vi.fn().mockRejectedValue(new Error('offline')),
        });
        mount(messaging);
        expect(await screen.findByText(/Couldn't load the current list name and description/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /project tokens$/i })).toBeNull();
    });
});
