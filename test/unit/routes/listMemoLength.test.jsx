// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Create list and Fork & edit against the chain's MAX_MEMO_LENGTH. Both forms
// checked only for | and ;, so a memo the indexer refuses as
// `invalid: MEMO (length)` went on to compose and was caught, at best, by the
// confirm-lane pre-flight. Each form is mounted in Full mode on an unlocked
// signer, which is the path that calls composeForConfirm, and driven with a
// memo one over the limit (refused at the form, nothing composed) and one
// exactly at it (composed, with the memo on the wire params).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../../../packages/core/src/shared/utils/memoLimit.js';

const DOGE = 'dogecoin-mainnet';
const SOURCE = {
    id: 'doge-0',
    address: 'D8indexindexindexindexindexindexin',
    publicKey: '02a0',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

// The indexer's value (xchain-indexer src/config/token_limits.js). Pinned
// here as a literal so a drift in the wallet constant fails this file.
const INDEXER_MAX_MEMO_LENGTH = 250;
const AT_LIMIT = 'm'.repeat(INDEXER_MAX_MEMO_LENGTH);
const OVER_LIMIT = 'm'.repeat(INDEXER_MAX_MEMO_LENGTH + 1);

function messagingFor() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [DOGE]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
}

function mount(Component, props) {
    const messaging = messagingFor();
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    ));
    return messaging;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

const lengthErrorText = new RegExp(`at most ${INDEXER_MAX_MEMO_LENGTH}`);

async function createWithMemo(memo) {
    const messaging = mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} });
    fireEvent.change(await screen.findByLabelText(/Tokens \(one per line\)/), { target: { value: 'SWAPTEST' } });
    fireEvent.change(screen.getByLabelText(/Memo/), { target: { value: memo } });
    const publish = await screen.findByRole('button', { name: 'Publish list' });
    await waitFor(() => expect(publish.disabled).toBe(false));
    fireEvent.click(publish);
    return messaging;
}

async function forkWithMemo(memo) {
    const messaging = mount(ListForkForm, {
        walletId: 'w',
        listRef: { chainId: DOGE, actionIndex: '2700', type: '1', items: ['SWAPTEST'], editResolutionActive: true },
        onBack() {},
        onDone() {},
    });
    await screen.findByText(/Forking token list #2700/);
    fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'NEWTICK' } });
    fireEvent.change(screen.getByLabelText(/Memo/), { target: { value: memo } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    return messaging;
}

describe('memoLengthError', () => {
    it('carries the indexer value and refuses only past it', () => {
        expect(MAX_MEMO_LENGTH).toBe(INDEXER_MAX_MEMO_LENGTH);
        expect(memoLengthError('')).toBeNull();
        expect(memoLengthError(undefined)).toBeNull();
        expect(memoLengthError(AT_LIMIT)).toBeNull();
        expect(memoLengthError(OVER_LIMIT)).toMatch(lengthErrorText);
    });
});

describe('ListCreateForm memo length', () => {
    it('refuses a memo one over the limit at the form, before compose', async () => {
        const messaging = await createWithMemo(OVER_LIMIT);
        expect(await screen.findByText(lengthErrorText)).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes a memo exactly at the limit', async () => {
        const messaging = await createWithMemo(AT_LIMIT);
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params)
            .toMatchObject({ VERSION: '0', TYPE: '1', MEMO: AT_LIMIT, ITEM: ['SWAPTEST'] });
        expect(screen.queryByText(lengthErrorText)).toBeNull();
    });
});

describe('ListForkForm memo length', () => {
    it('refuses a memo one over the limit at the form, before compose', async () => {
        const messaging = await forkWithMemo(OVER_LIMIT);
        expect(await screen.findByText(lengthErrorText)).toBeTruthy();
        // Still on the compose stage: no review, so nothing to sign.
        expect(screen.queryByRole('button', { name: 'Publish add' })).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes a memo exactly at the limit', async () => {
        const messaging = await forkWithMemo(AT_LIMIT);
        const publish = await screen.findByRole('button', { name: 'Publish add' });
        await waitFor(() => expect(publish.disabled).toBe(false));
        fireEvent.click(publish);
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params)
            .toMatchObject({ VERSION: '1', MEMO: AT_LIMIT, ITEM: ['NEWTICK'] });
        expect(screen.queryByText(lengthErrorText)).toBeNull();
    });
});

// "Protocol rejects | or ;." under the Memo field read as an error to a
// tester on Create list. The hint now says what the memo is and keeps the
// character rule, and every memo form shares the one wording.
describe('Memo hint on Create list', () => {
    it('says the memo is public and names the forbidden characters', async () => {
        mount(ListCreateForm, { walletId: 'w', chainId: DOGE, initialType: '1', onBack() {} });
        expect(await screen.findByText('A public note saved on the blockchain with this action. It cannot contain | or ;.')).toBeTruthy();
        expect(screen.queryByText('Protocol rejects | or ;.')).toBeNull();
    });
});

// A tester opened a one-member list, wrote only a memo in Fork & edit, and
// was refused "Nothing changed". A memo-only edit is valid on chain (a new
// version of the list, same members), so the form now publishes it as one
// LIST v1 edit with no items and says the members are unchanged.
describe('ListForkForm memo-only edit', () => {
    function openFork() {
        return mount(ListForkForm, {
            walletId: 'w',
            listRef: { chainId: DOGE, actionIndex: '2700', type: '1', items: ['SWAPTEST'], editResolutionActive: true },
            onBack() {},
            onDone() {},
        });
    }

    it('publishes a memo with no member change as one item-less edit', async () => {
        const messaging = openFork();
        await screen.findByText(/Forking token list #2700/);
        fireEvent.change(screen.getByLabelText(/Memo/), { target: { value: 'season two' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText(/Only the memo changes\. The list keeps its 1 member/)).toBeTruthy();
        expect(screen.getByText(/^Update the memo on list #2700/)).toBeTruthy();
        const publish = screen.getByRole('button', { name: 'Publish memo' });
        await waitFor(() => expect(publish.disabled).toBe(false));
        fireEvent.click(publish);
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params)
            .toEqual({ VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '2700', MEMO: 'season two', ITEM: [] });
    });

    it('still refuses an edit with no member change and no memo', async () => {
        const messaging = openFork();
        await screen.findByText(/Forking token list #2700/);
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Nothing changed: add or remove an item, or write a memo.')).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
