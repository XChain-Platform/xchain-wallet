// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every Airdrop state lays out through a page template: the load error, the
// loading line, the watcher-mode notice, the wait-for-index panel and the
// done panel sit inside ListPage or FormPage, never as bare children of
// Screen, and the existing-list picker routes each of its states through
// ListPage. CSS modules are blank under the unit config, so the templates
// carry a data marker here to make the structure visible to the DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { selectOption, selectOptionLabels } from '../../helpers/selectOption.js';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    const MarkedFormPage = React.forwardRef(function MarkedFormPage(props, ref) {
        return React.createElement(actual.FormPage, { ...props, ref, 'data-test-template': 'form' });
    });
    function MarkedListPage(props) {
        return React.createElement(actual.ListPage, { ...props, 'data-test-template': 'list' });
    }
    return { ...actual, FormPage: MarkedFormPage, ListPage: MarkedListPage };
});

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { publishWalletModes, resetWalletModes } = await import('../../../packages/core/src/shared/hooks/useWalletMode.js');
const { AirdropForm } = await import('../../../packages/core/src/shared/routes/AirdropForm.jsx');
const { existingListRowText } = await import('../../../packages/core/src/shared/utils/existingListRowText.js');
const { __clearTokenInfoCache } = await import('../../../packages/core/src/shared/hooks/useTokenInfo.js');

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
const LIST_TXID = 'aa'.repeat(32);
const AIRDROP_TXID = 'bb'.repeat(32);

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: SOURCE,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
};

function pendingRecord(stage) {
    return {
        id: 'pending-1',
        walletId: 'w',
        chainId: CHAIN,
        token: 'XCHAIN',
        amountPer: '1',
        listType: '2',
        recipients: ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
        memo: '',
        fromAddress: SOURCE,
        listTxid: LIST_TXID,
        listActionIndex: stage === 'done' ? 7 : null,
        airdropTxid: stage === 'done' ? AIRDROP_TXID : null,
        stage,
    };
}

function mountAirdrop({
    overrides = {}, resumeId = null, lockedToken = true, walletMode = 'full',
} = {}) {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'XCHAIN', divisibility: 8, locks: {} }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue([]),
        listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
        getActionByTxid: vi.fn().mockResolvedValue(null),
        clearPendingAirdrop: vi.fn().mockResolvedValue({}),
        ...overrides,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AirdropForm, {
            walletId: 'w',
            resumeId,
            initialChainId: CHAIN,
            initialTick: lockedToken ? 'XCHAIN' : undefined,
            onBack() {},
        }),
    ));
    return messaging;
}

async function flushTimers() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
}

function expectInsideTemplate(node) {
    expect(node).toBeTruthy();
    const template = node.closest('[data-test-template]');
    expect(template, `"${node.textContent.slice(0, 60)}" renders outside ListPage and FormPage`).not.toBeNull();
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); resetWalletModes(); __clearTokenInfoCache(); vi.useRealTimers(); });

describe('AirdropForm page templates', () => {
    it('starts with Network and From, then orders the U90 fields and keeps Addresses functional', async () => {
        mountAirdrop({ lockedToken: false });
        await flushTimers();

        // Network and From sit in the standard From section (first,
        // closed on load); the field is labelled "From address".
        const network = screen.getByRole('button', { name: /^Network:/, hidden: true });
        const from = screen.getByLabelText('From address');
        const token = screen.getByText('Token to drop').parentElement;
        const amount = screen.getByLabelText(/^Per-recipient amount/);
        const destination = screen.getByLabelText(/^Airdrop to/);
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(from.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(token.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(amount.compareDocumentPosition(destination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(selectOptionLabels(destination)).toEqual([
            'Addresses',
            'Existing list',
            'Token holders',
        ]);
        expect(destination).toHaveValue('paste');
        expect(screen.getByRole('textbox', { name: 'Recipients' })).toBeInTheDocument();
        // The recipients file loads through the standard file field.
        expect(screen.getByRole('textbox', { name: /^Recipients file \(CSV or TXT\)/ })).toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();

        selectOption(destination, 'existing');
        expect(screen.queryByText('Existing list', { selector: 'label' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Recipients' })).toBeNull();

        selectOption(destination, 'paste');
        expect(screen.getByRole('textbox', { name: 'Recipients' })).toBeInTheDocument();
    });

    it('shows the AIRDROP fees in the compose form', async () => {
        mountAirdrop();
        await flushTimers();

        // The network and protocol fee lines sit in the standard Fees section,
        // with the pay-in-native switch (closed section, so hidden) and no Total.
        const fees = document.querySelector('[data-form-section="fee"]');
        expect(fees).not.toBeNull();
        expect(fees.querySelector('[data-fees-row="network"]')).not.toBeNull();
        expect(fees.querySelector('[data-fees-row="protocol"]')).not.toBeNull();
        expect(screen.getByRole('switch', { name: /Pay protocol fee in/, hidden: true })).toBeInTheDocument();
        expect(fees.querySelector('[data-fees-row="total"]')).toBeNull();
    });

    it('uses the approved main action and form-specific field help', async () => {
        mountAirdrop();
        await flushTimers();

        const review = screen.getByRole('button', { name: /^Review recipients$/i });
        expect(review.className).toMatch(/success/);
        expect(review.querySelector('svg')).not.toBeNull();

        const fromTip = screen.getByRole('button', { name: 'About From address', hidden: true });
        expect(document.getElementById(fromTip.getAttribute('aria-describedby')).textContent)
            .toBe('The address that sends the airdrop. It must hold the token and pays the fees.');
        const recipientsTip = screen.getByRole('button', { name: 'About Recipients' });
        expect(document.getElementById(recipientsTip.getAttribute('aria-describedby')).textContent)
            .toBe('Enter or upload the recipient addresses for this airdrop. A new address list is published first, then the airdrop is sent to that list.');

        selectOption(screen.getByLabelText(/^Airdrop to/), 'holders');
        const tokensTip = screen.getByRole('button', { name: 'About Tokens (one per line)' });
        expect(document.getElementById(tokensTip.getAttribute('aria-describedby')).textContent)
            .toContain('Enter one token ticker per line. A new token list is published first');
        expect(screen.getByRole('button', { name: 'Add from token picker' }).querySelector('svg'))
            .not.toBeNull();
    });

    it('gives the invalid-recipient toggle its state-specific icon', async () => {
        mountAirdrop();
        await flushTimers();
        fireEvent.change(screen.getByRole('textbox', { name: 'Recipients' }), {
            target: { value: 'not-an-address' },
        });
        await flushTimers();

        const show = screen.getByRole('button', { name: 'Show 1 invalid' });
        expect(show.querySelector('svg')).not.toBeNull();
        fireEvent.click(show);
        expect(screen.getByRole('button', { name: 'Hide 1 invalid' }).querySelector('svg')).not.toBeNull();
    });

    it('builds one matching description for named and derived list rows', () => {
        expect(existingListRowText({ type: '1', list: ['PEPE', 'DANKEST'] })).toBe(
            'PEPE and DANKEST holders, token list, 2 tokens',
        );
        expect(existingListRowText({ type: '2', label: 'Team wallets', memberCount: 14 })).toBe(
            'Team wallets, address list, 14 addresses',
        );
        expect(existingListRowText({ type: '2', label: 'Primary wallet', memberCount: 1 })).toBe(
            'Primary wallet, address list, 1 address',
        );
    });

    it('lays out the load error, the loading line and the watcher-mode notice through a page template', async () => {
        mountAirdrop({ overrides: { getAddressesByChain: vi.fn().mockRejectedValue(new Error('vault read failed')) } });
        await flushTimers();
        expectInsideTemplate(screen.getByText('vault read failed'));
        cleanup();

        mountAirdrop({ overrides: { getAddressesByChain: vi.fn(() => new Promise(() => {})) } });
        await flushTimers();
        expectInsideTemplate(screen.getByText('Loading…'));
        cleanup();

        mountAirdrop({ walletMode: 'watcher' });
        await flushTimers();
        expectInsideTemplate(screen.getByRole('heading', { name: 'Not available when another phone signs' }));
        expectInsideTemplate(screen.getByText(/To author an airdrop, use a wallet that signs on this/));
    });

    it('lays out the wait-for-index and done panels through a page template', async () => {
        mountAirdrop({
            resumeId: 'pending-1',
            overrides: { listPendingAirdropsForWallet: vi.fn().mockResolvedValue([pendingRecord('waiting-index')]) },
        });
        await flushTimers();
        expectInsideTemplate(screen.getByText(/Waiting for the recipient-list transaction to be indexed/));
        expectInsideTemplate(screen.getByRole('button', { name: 'Cancel airdrop' }));
        cleanup();

        mountAirdrop({
            resumeId: 'pending-1',
            overrides: { listPendingAirdropsForWallet: vi.fn().mockResolvedValue([pendingRecord('done')]) },
        });
        await flushTimers();
        expectInsideTemplate(screen.getByRole('heading', { name: 'Airdrop sent' }));
        expectInsideTemplate(screen.getByText(AIRDROP_TXID));
        expectInsideTemplate(screen.getByRole('button', { name: 'Done' }));
    });

    it('routes the existing-list picker loading, empty and list states through ListPage', async () => {
        let resolveLists;
        mountAirdrop({
            overrides: { getListsForSource: vi.fn(() => new Promise((resolve) => { resolveLists = resolve; })) },
        });
        await flushTimers();
        selectOption(screen.getByLabelText(/^Airdrop to/), 'existing');
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /^List:/ }));
        await flushTimers();
        const loading = screen.getByText('Loading lists…');
        expect(loading.closest('[data-test-template="list"]')).not.toBeNull();
        await act(async () => { resolveLists?.([]); });
        await flushTimers();
        const empty = screen.getByText('No published lists yet');
        expect(empty.closest('[data-test-template="list"]')).not.toBeNull();
        cleanup();

        mountAirdrop({
            overrides: {
                getListsForSource: vi.fn().mockResolvedValue([
                    { action_index: 42, type: '2', status: 'valid', block_index: 10 },
                    { action_index: 43, type: '1', status: 'valid', block_index: 9 },
                ]),
                getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve(actionIndex === '42'
                    ? { action_index: 42, type: '2', name: 'Team wallets', list: ['bc1qrecipient'] }
                    : { action_index: 43, type: '1', list: ['PEPE', 'DANKEST'] })),
            },
        });
        await flushTimers();
        selectOption(screen.getByLabelText(/^Airdrop to/), 'existing');
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /^List:/ }));
        await flushTimers();
        const addressRow = screen.getByRole('button', { name: 'Team wallets, address list, 1 address' });
        const tokenRow = screen.getByRole('button', {
            name: 'PEPE and DANKEST holders, token list, 2 tokens',
        });
        const listCard = addressRow.closest('ul');
        expect(listCard).not.toBeNull();
        expect(listCard.className).toMatch(/abList|flush/);
        expect(tokenRow.closest('ul')).toBe(listCard);
        expect(listCard.closest('[data-test-template="list"]')).not.toBeNull();
        expect(addressRow).toHaveTextContent('Team wallets, address list, 1 address');
        expect(tokenRow).toHaveTextContent('PEPE and DANKEST holders, token list, 2 tokens');
        expect(addressRow.querySelector('svg')).not.toBeNull();
        expect(tokenRow.querySelector('svg')).not.toBeNull();
        fireEvent.click(tokenRow);
        await flushTimers();
        expect(screen.getByRole('button', { name: 'List: List #43' })).toBeTruthy();
    });

    it('shows the existing list as a ListField: None set, then the picked name, then a changed pick', async () => {
        mountAirdrop({
            overrides: {
                getListsForSource: vi.fn().mockResolvedValue([
                    { action_index: 42, type: '2', status: 'valid', block_index: 10, name: 'Team wallets' },
                    { action_index: 44, type: '2', status: 'valid', block_index: 8, name: 'Friends' },
                ]),
                getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve(actionIndex === '42'
                    ? { action_index: 42, type: '2', name: 'Team wallets', list: ['bc1qrecipient'] }
                    : { action_index: 44, type: '2', name: 'Friends', list: ['bc1qother'] })),
            },
        });
        await flushTimers();
        selectOption(screen.getByLabelText(/^Airdrop to/), 'existing');
        await flushTimers();
        // Empty: the field reads None set, with the list icon, and the old line is gone.
        const field = screen.getByRole('button', { name: 'List: None set' });
        expect(field.querySelector('svg')).not.toBeNull();
        expect(screen.queryByText('No list chosen yet.')).toBeNull();
        // Pick: the field reads the chosen list's name.
        fireEvent.click(field);
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /^Team wallets, address list/ }));
        await flushTimers();
        expect(screen.getByRole('button', { name: /^List: Team wallets/ })).toBeTruthy();
        // Change: opening the field again and picking another list replaces the name.
        fireEvent.click(screen.getByRole('button', { name: /^List: Team wallets/ }));
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /^Friends, address list/ }));
        await flushTimers();
        expect(screen.getByRole('button', { name: /^List: Friends/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^List: Team wallets/ })).toBeNull();
    });
});
