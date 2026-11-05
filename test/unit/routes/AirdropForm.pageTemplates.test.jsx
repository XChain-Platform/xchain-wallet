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

function mountAirdrop({ overrides = {}, resumeId = null } = {}) {
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
            walletId: 'w', resumeId, initialChainId: CHAIN, initialTick: 'XCHAIN', onBack() {},
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
                getListsForSource: vi.fn().mockResolvedValue([{ action_index: 42, type: '2', status: 'valid', block_index: 10 }]),
            },
        });
        await flushTimers();
        fireEvent.change(screen.getByLabelText(/^Airdrop to/), { target: { value: 'existing' } });
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Choose list' }));
        await flushTimers();
        const row = screen.getByRole('button', { name: /Address list #42/ });
        expect(row.closest('[data-test-template="list"]')).not.toBeNull();
    });
});
