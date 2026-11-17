// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 2 of a pasted-address airdrop is priced on the list the chain stored,
// which can be shorter than the list the wallet submitted. The review screen
// reads that list back, so signing waits for the read to settle (answered,
// failed or timed out), and a row that carries no member array counts as an
// unknown membership, never as an empty list.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { AirdropForm } = await import('../../../packages/core/src/shared/routes/AirdropForm.jsx');
const { __clearTokenInfoCache } = await import('../../../packages/core/src/shared/hooks/useTokenInfo.js');

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
const KEPT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const DROPPED = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const PENDING_NOTICE = /Checking the published list/;

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

function pendingRecord(listType = '2') {
    return {
        id: 'pending-1',
        walletId: 'w',
        chainId: CHAIN,
        token: 'XCHAIN',
        amountPer: '1',
        listType,
        recipients: listType === '2' ? [KEPT, DROPPED] : ['XCHAIN'],
        memo: '',
        fromAddress: SOURCE,
        listTxid: 'aa'.repeat(32),
        listActionIndex: '42',
        airdropTxid: null,
        stage: 'ready-to-airdrop',
    };
}

/** A promise the test settles by hand. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function mountReview({ read, listType = '2' }) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'XCHAIN', divisibility: 8, locks: {} }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue([]),
        listPendingAirdropsForWallet: vi.fn().mockResolvedValue([pendingRecord(listType)]),
        getListByActionIndex: vi.fn(read),
        getActionByTxid: vi.fn().mockResolvedValue(null),
        updatePendingAirdrop: vi.fn().mockResolvedValue({}),
        clearPendingAirdrop: vi.fn().mockResolvedValue({}),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        airdropAction: vi.fn().mockResolvedValue({ txid: 'bb'.repeat(32) }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AirdropForm, {
            walletId: 'w',
            resumeId: 'pending-1',
            initialChainId: CHAIN,
            initialTick: 'XCHAIN',
            onBack() {},
        }),
    ));
    return messaging;
}

async function flush(ms = 400) {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    }
}

// Step 2 is the Confirm Standard modal: Approve never looks disabled (G130),
// and a tap while the stored-list read holds signing composes nothing.
const signButton = () => screen.getByRole('button', { name: 'Approve' });

async function submitReview() {
    await act(async () => { fireEvent.click(signButton()); });
    await flush(50);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); __clearTokenInfoCache(); vi.useRealTimers(); });

describe('AirdropForm step 2 waits for the stored-list read', () => {
    it('holds signing while the read is pending and says why', async () => {
        const read = deferred();
        const messaging = mountReview({ read: () => read.promise });
        await flush();

        expect(messaging.getListByActionIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '42' });
        await submitReview();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(screen.getByText(PENDING_NOTICE)).toBeInTheDocument();
        await submitReview();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('opens signing on the stored count and names the dropped address once the read answers', async () => {
        const read = deferred();
        const messaging = mountReview({ read: () => read.promise });
        await flush();

        await act(async () => { read.resolve({ type: '2', list: [KEPT] }); });
        await flush();
        expect(signButton()).toBeInTheDocument();
        expect(screen.queryByText(PENDING_NOTICE)).toBeNull();
        expect(document.body.textContent).toMatch(/The published list holds 1 of the 2 addresses you submitted/);
        expect(document.body.textContent).toContain(DROPPED);
        await submitReview();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('lets signing go ahead on the submitted list when the read fails', async () => {
        const messaging = mountReview({ read: () => Promise.reject(new Error('explorer unreachable')) });
        await flush();

        expect(signButton()).toBeInTheDocument();
        expect(screen.queryByText(PENDING_NOTICE)).toBeNull();
        expect(document.body.textContent).not.toMatch(/The published list holds/);
        await submitReview();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('lets signing go ahead once a read that never settles passes its time limit', async () => {
        const messaging = mountReview({ read: () => new Promise(() => {}) });
        await flush();
        await submitReview();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        await flush(15_000);
        expect(signButton()).toBeInTheDocument();
        expect(screen.queryByText(PENDING_NOTICE)).toBeNull();
        await submitReview();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('never holds a token-holder airdrop, which has no address list to read back', async () => {
        const messaging = mountReview({ read: () => new Promise(() => {}), listType: '1' });
        await flush();

        expect(messaging.getListByActionIndex).not.toHaveBeenCalled();
        expect(signButton()).toBeInTheDocument();
        expect(screen.queryByText(PENDING_NOTICE)).toBeNull();
    });
});

describe('AirdropForm reconcile with a row that has no member array', () => {
    it.each([
        ['a row with no list, items or members', { action_index: 42, type: '2' }],
        ['no row at all', null],
    ])('keeps the submitted count for %s', async (_label, row) => {
        const messaging = mountReview({ read: () => Promise.resolve(row) });
        await flush();

        expect(messaging.getListByActionIndex).toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/rejected by the network/);
        expect(document.body.textContent).not.toMatch(/The published list holds/);
        expect(signButton()).toBeInTheDocument();
        expect(document.body.textContent).toMatch(/Recipients\s*2(?!\d)/);
    });

    it('still reports every address as rejected when the stored list really is empty', async () => {
        mountReview({ read: () => Promise.resolve({ action_index: 42, type: '2', list: [] }) });
        await flush();

        expect(document.body.textContent).toMatch(/The published list holds 0 of the 2 addresses you submitted/);
        expect(document.body.textContent).toContain(KEPT);
        expect(document.body.textContent).toContain(DROPPED);
    });
});
