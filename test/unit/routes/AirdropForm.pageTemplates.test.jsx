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

function mountAirdrop({ overrides = {}, resumeId = null, lockedToken = true } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
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
afterEach(() => { cleanup(); __clearTokenInfoCache(); vi.useRealTimers(); });

describe('AirdropForm page templates', () => {
    it('starts with Network and From, then orders the U90 fields and keeps Addresses functional', async () => {
        mountAirdrop({ lockedToken: false });
        await flushTimers();

        const network = screen.getByRole('button', { name: /^Network:/ });
        const from = screen.getByLabelText('From');
        const token = screen.getByText('Token to drop').parentElement;
        const amount = screen.getByLabelText(/^Per-recipient amount/);
        const destination = screen.getByLabelText(/^Airdrop to/);
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(from.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(token.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(amount.compareDocumentPosition(destination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(Array.from(destination.options).map((option) => option.textContent)).toEqual([
            'Addresses',
            'Existing list',
            'Token holders',
        ]);
        expect(destination).toHaveValue('paste');
        expect(screen.getByRole('textbox', { name: 'Recipients' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Upload a CSV or text file' })).toBeInTheDocument();

        fireEvent.change(destination, { target: { value: 'existing' } });
        expect(screen.queryByText('Existing list', { selector: 'label' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Recipients' })).toBeNull();

        fireEvent.change(destination, { target: { value: 'paste' } });
        expect(screen.getByRole('textbox', { name: 'Recipients' })).toBeInTheDocument();
    });

    it('shows the AIRDROP Fees card in the compose form', async () => {
        mountAirdrop();
        await flushTimers();

        const fees = document.querySelector('[data-fees-card]');
        expect(fees).not.toBeNull();
        expect(fees.querySelector('[data-fees-row="network"]')).not.toBeNull();
        expect(fees.querySelector('[data-fees-row="protocol"]')).not.toBeNull();
        expect(fees.querySelector('[data-fees-row="total"]')).not.toBeNull();
    });

    it('uses the approved main action and form-specific field help', async () => {
        mountAirdrop();
        await flushTimers();

        const review = screen.getByRole('button', { name: 'Review recipients' });
        expect(review.className).toMatch(/success/);
        expect(review.querySelector('svg')).not.toBeNull();

        const fromTip = screen.getByRole('button', { name: 'About From' });
        expect(document.getElementById(fromTip.getAttribute('aria-describedby')).textContent)
            .toBe('The address that sends the airdrop. It must hold the token and pays the fees.');
        const recipientsTip = screen.getByRole('button', { name: 'About Recipients' });
        expect(document.getElementById(recipientsTip.getAttribute('aria-describedby')).textContent)
            .toBe('Enter or upload the recipient addresses for this airdrop. A new address list is published first, then the airdrop is sent to that list.');

        fireEvent.change(screen.getByLabelText(/^Airdrop to/), { target: { value: 'holders' } });
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

        mountAirdrop({ overrides: { getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }) } });
        await flushTimers();
        expectInsideTemplate(screen.getByRole('heading', { name: 'Not available in watcher mode' }));
        expectInsideTemplate(screen.getByText(/Switch this wallet to/));
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
        fireEvent.change(screen.getByLabelText(/^Airdrop to/), { target: { value: 'existing' } });
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Choose list' }));
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
        fireEvent.change(screen.getByLabelText(/^Airdrop to/), { target: { value: 'existing' } });
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Choose list' }));
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
        expect(screen.getByText('PEPE and DANKEST holders, token list, 2 tokens')).toBeTruthy();
    });
});
