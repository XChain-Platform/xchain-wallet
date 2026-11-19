// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Project Tokens page edits the project's one list instead of starting
// over. Each test checks the exact LIST, BATCH and LINK messages handed to
// composition: a new list is LIST v4 then a LINK; the owner's change to the
// linked list is ONE transaction of LIST edits naming it (EDIT 1 adds, EDIT 2
// removes, v5 renames; more than one as a BATCH) with no new LINK; a signer
// that does not own the list republishes it as v4 and links that.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const BATCH_TXID = 'cc'.repeat(32);
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
        advancedAction: vi.fn().mockResolvedValue({ txid: BATCH_TXID }),
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

function composed(messaging) {
    return messaging.composeForConfirm.mock.calls.map(([req]) => req.actionData);
}

// The token text box, one token per line.
function tokensBox() {
    return screen.getByRole('textbox', { name: /^Tokens/ });
}

function typeTokens(text) {
    fireEvent.change(tokensBox(), { target: { value: text } });
}

// The step line's items as [label, state] pairs.
function steps() {
    const line = screen.getByRole('list', { name: 'What saving does' });
    return within(line).getAllByRole('listitem').map((item) => [item.textContent.trim(), item.dataset.stepState]);
}

function openListDetails() {
    fireEvent.click(screen.getByRole('button', { name: /^List Details/, expanded: false }));
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
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        expect(steps()).toEqual([['1Save the list', 'todo'], ['2Link to PROJ', 'todo']]);

        openListDetails();
        fireEvent.change(screen.getByRole('textbox', { name: /^List name/ }), { target: { value: 'Game items' } });
        fireEvent.change(screen.getByRole('textbox', { name: /^Description/ }), { target: { value: 'Every PROJ card' } });
        addToken('AAA');
        addToken('BBB');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));

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
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('AAA');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        await signReviewedList();
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0]).toEqual({
            action: 'LIST', params: { VERSION: '0', TYPE: '1', ITEM: ['AAA'] },
        });
    });

    it('refuses a token from another network and keeps the picker on the project chain', async () => {
        mount(messagingWith());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
        expect(screen.getByTestId('token-picker-chain')).toHaveTextContent(CHAIN);
        fireEvent.click(screen.getByRole('button', { name: 'Close token picker' }));

        addToken('LTCTOKEN', 'litecoin-testnet');
        expect((await screen.findAllByText(/Pick a token on .*The project list counts only tokens on its own network/)).length).toBeGreaterThan(0);
        expect(tokensBox().value).toBe('');
    });

    it('takes tokens typed one per line and sends the same LIST as picked ones', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        typeTokens('AAA\nBBB');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        await signReviewedList();
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0]).toEqual({
            action: 'LIST', params: { VERSION: '0', TYPE: '1', ITEM: ['AAA', 'BBB'] },
        });
    });

    it('Add Token appends the picked ticker on a new line and returns to the form', async () => {
        mount(messagingWith());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        typeTokens('AAA');
        addToken('BBB');
        expect(screen.queryByLabelText('Token to pick')).toBeNull();
        expect(tokensBox().value).toBe('AAA\nBBB');
        addToken('CCC');
        expect(tokensBox().value).toBe('AAA\nBBB\nCCC');
    });

    it('reports a bad line, clears it on change, and ignores a repeated line', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());

        typeTokens('AAA\nnot a token!\nBBB');
        expect(screen.getByText(/2 valid token names · 1 invalid/)).toBeTruthy();
        expect(screen.getByText('Not a token name: not a token!')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect((await screen.findAllByText("These don't look like token names: not a token!")).length).toBe(2);
        expect(tokensBox()).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        typeTokens('AAA\nBBB');
        expect(screen.queryByText(/don't look like token names/)).toBeNull();
        expect(tokensBox()).not.toHaveAttribute('aria-invalid', 'true');

        typeTokens('AAA\nBBB\naaa');
        expect(screen.getByText(/2 valid token names · 1 duplicate ignored/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect(await screen.findByRole('form', { name: 'Review official token list' })).toBeTruthy();
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
});

describe('ProjectRosterForm draws layout 1: one token card, one button, a step line', () => {
    it('empty: an empty text box with Add Token under it, two steps to go, Create and Link', async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingWith()}>
                <ProjectRosterForm walletId="wallet-1" chainId={CHAIN} tick="PROJ" issuerAddress={OWNER.address} onBack={() => {}} />
            </MessagingProvider>,
        );
        const add = await screen.findByRole('button', { name: 'Add Token' });
        await waitFor(() => expect(add).toBeEnabled());

        expect(tokensBox().value).toBe('');
        // The button sits under the text box.
        expect(tokensBox().compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Tokens' })).toBeNull();

        expect(steps()).toEqual([['1Save the list', 'todo'], ['2Link to PROJ', 'todo']]);
        const action = screen.getByRole('button', { name: 'Create and Link' });
        expect(action.className).toMatch(/success/);
        expect(action.querySelector('svg[data-xc-icon]')).not.toBeNull();
        // Name and description wait in the closed, optional List Details section.
        const details = screen.getByRole('button', { name: /^List Details/, expanded: false });
        expect(details).toHaveTextContent('Optional');
        expect(details).toHaveTextContent('None');
    });

    it('linked: the tokens fill the text box with no chips, both steps done, Update List', async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) })}>
                <ProjectRosterForm walletId="wallet-1" chainId={CHAIN} tick="PROJ" issuerAddress={OWNER.address} onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByDisplayValue('Old name');

        expect(tokensBox().value).toBe('AAA\nBBB');
        // The shared list editor previews each parsed token and keeps it editable.
        expect(screen.getByRole('list', { name: 'Token order' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove AAA' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove BBB' })).toBeTruthy();

        expect(steps()).toEqual([['List saved', 'done'], ['Linked to PROJ', 'done']]);
        expect(screen.getByRole('button', { name: 'Update List' }).className).toMatch(/success/);
        expect(screen.getByRole('button', { name: /^List Details/ })).toHaveTextContent('Old name');
    });

    it('editing: a line deleted and a line added is one step with no relink', async () => {
        mount(messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) }));
        await screen.findByDisplayValue('Old name');

        typeTokens('BBB');
        addToken('CCC');
        expect(tokensBox().value).toBe('BBB\nCCC');

        expect(steps()).toEqual([['Update the list in one transaction', 'todo']]);
        expect(screen.queryByText(/Link to PROJ|Linked to PROJ/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Update List' })).toBeTruthy();
    });

    it('a line deleted and typed back is nothing to save', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        typeTokens('AAA');
        typeTokens('AAA\nBBB');
        expect(steps()).toEqual([['List saved', 'done'], ['Linked to PROJ', 'done']]);
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
        expect(await screen.findByText(/Nothing to save/)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('ProjectRosterForm edits the existing list', () => {
    it('shows the current name, description and tokens in the text box, one per line, with Add Token', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);

        expect(await screen.findByDisplayValue('Old name')).toBeTruthy();
        expect(screen.getByDisplayValue('Old description')).toBeTruthy();
        expect(messaging.getListByActionIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '50' });
        expect(tokensBox().value).toBe('AAA\nBBB');
        expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Update List' })).toBeTruthy();
    });

    it('refuses a save with nothing changed', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
        expect(await screen.findByText(/Nothing to save/)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('saves a name change as one LIST v5 on the same list with no LINK', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        fireEvent.change(await screen.findByDisplayValue('Old name'), { target: { value: 'New name' } });
        expect(steps()).toEqual([['Update the name and description in one transaction', 'todo']]);

        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());
        expect(composed(messaging)[0].params).toEqual({
            VERSION: '5', LIST_ACTION_INDEX: '50', NAME: '', DESCRIPTION: '-', MEMO: '',
        });
    });

    it('adds a token as one LIST EDIT 1 naming the linked list, with no LINK', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        addToken('CCC');
        fireEvent.change(screen.getByRole('textbox', { name: 'Memo', hidden: true }), { target: { value: 'season two' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.createList).toHaveBeenCalled());

        expect(composed(messaging)).toEqual([{
            action: 'LIST',
            params: { VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '50', MEMO: 'season two', ITEM: ['CCC'] },
        }]);
        expect(messaging.createList).toHaveBeenCalledWith(expect.objectContaining({ payFeeInNativeCoin: true }));
        expect(await screen.findByText('Project tokens saved')).toBeTruthy();
        expect(screen.getByText('List update transaction')).toBeTruthy();
        expect(messaging.linkAction).not.toHaveBeenCalled();
        expect(messaging.getActionByTxid).not.toHaveBeenCalled();
        expect(messaging.advancedAction).not.toHaveBeenCalled();
    });

    it('sends an add and a remove as one BATCH of EDIT 1 then EDIT 2 on the linked list, with no LINK', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        await screen.findByDisplayValue('Old name');
        typeTokens('AAA\nCCC');

        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.advancedAction).toHaveBeenCalled());

        expect(composed(messaging)).toEqual([{
            action: 'BATCH',
            params: { VERSION: '0', COMMAND: 'LIST|1|1|50||CCC;LIST|1|2|50||BBB' },
        }]);
        expect(messaging.advancedAction).toHaveBeenCalledWith(expect.objectContaining({
            action: 'BATCH',
            params: { VERSION: '0', COMMAND: 'LIST|1|1|50||CCC;LIST|1|2|50||BBB' },
            payFeeInNativeCoin: true,
        }));
        expect(messaging.createList).not.toHaveBeenCalled();
        expect(messaging.linkAction).not.toHaveBeenCalled();
        expect(messaging.getActionByTxid).not.toHaveBeenCalled();
        expect(await screen.findByText('Project tokens saved')).toBeTruthy();
        expect(screen.getByText(BATCH_TXID)).toBeTruthy();
    });

    it('rides a new name with a token change in the same BATCH, the memo on the first command', async () => {
        const messaging = messagingWith({ getProjectForToken: vi.fn().mockResolvedValue(EXISTING) });
        mount(messaging);
        fireEvent.change(await screen.findByDisplayValue('Old name'), { target: { value: 'New name' } });
        typeTokens('BBB');
        fireEvent.change(screen.getByRole('textbox', { name: 'Memo', hidden: true }), { target: { value: 'tidy' } });

        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.advancedAction).toHaveBeenCalled());
        expect(composed(messaging)[0]).toEqual({
            action: 'BATCH',
            params: { VERSION: '0', COMMAND: 'LIST|1|2|50|tidy|AAA;LIST|5|50|New name' },
        });
    });

    it('republishes instead of editing when this address does not own the list', async () => {
        const messaging = messagingWith({
            getProjectForToken: vi.fn().mockResolvedValue(EXISTING),
            getListByActionIndex: vi.fn().mockResolvedValue({
                action_index: 50, name: 'Old name', description: '', source: 'DSomeoneElse',
            }),
        });
        mount(messaging);
        fireEvent.change(await screen.findByDisplayValue('Old name'), { target: { value: 'New name' } });
        expect(screen.getByText(/doesn't own the current list/)).toBeTruthy();
        expect(steps()).toEqual([['1Save the list', 'todo'], ['2Link to PROJ', 'todo']]);
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
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
        expect(tokensBox()).toHaveAttribute('readonly');

        // The name can still change, through SET META.
        fireEvent.change(screen.getByDisplayValue('Old name'), { target: { value: 'New name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update List' }));
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
        expect(screen.queryByRole('button', { name: /^(Create and Link|Update List)$/ })).toBeNull();
    });
});
