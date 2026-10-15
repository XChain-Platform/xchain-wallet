// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A submit while the ticker availability check is pending is held, not
// rejected: it replays once the check settles (available, taken, or unknown,
// including the TICKER_LOOKUP_TIMEOUT_MS bound for a lookup that never settles).
// See https://github.com/XChain-Platform/xchain-wallet/issues/83.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    IssueTokenForm,
    TICKER_LOOKUP_TIMEOUT_MS,
} from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const TAKEN_ERROR = 'Ticker "HELD" already exists on this network.';
const WAIT_ERROR = 'Wait for the ticker availability check to finish.';
const DEBOUNCE_MS = 350;

const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

let composeForConfirm;
let getTokenInfo;

function mountForm(lookup) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    getTokenInfo = vi.fn(lookup);
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        getTokenInfo,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(IssueTokenForm, { walletId: 'w', onBack() {} }),
        ),
    );
}

async function advance(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function submit() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        await vi.advanceTimersByTimeAsync(0);
    });
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

async function fillAndSubmit() {
    await advance(0);
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '5000' } });
    await submit();
}

describe('IssueTokenForm submit held by the ticker check', () => {
    it('replays a held submit once a missing tick resolves', async () => {
        vi.useFakeTimers();
        mountForm(() => Promise.resolve({}));
        await fillAndSubmit();
        expect(screen.queryByText(WAIT_ERROR)).toBeNull();
        expect(composeForConfirm).not.toHaveBeenCalled();

        await advance(DEBOUNCE_MS);
        expect(getTokenInfo).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(WAIT_ERROR)).toBeNull();
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('holds a submit for a lookup that never settles, then proceeds as unknown', async () => {
        vi.useFakeTimers();
        mountForm(() => new Promise(() => {}));
        await fillAndSubmit();

        await advance(DEBOUNCE_MS + TICKER_LOOKUP_TIMEOUT_MS - 1);
        expect(getTokenInfo).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(WAIT_ERROR)).toBeNull();
        expect(composeForConfirm).not.toHaveBeenCalled();

        await advance(1);
        expect(screen.queryByText(WAIT_ERROR)).toBeNull();
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('shows the taken error for a held submit when the tick is found', async () => {
        vi.useFakeTimers();
        mountForm(() => Promise.resolve({ creator: 'bc1qcreator', totalSupply: '1000' }));
        await fillAndSubmit();

        await advance(DEBOUNCE_MS);
        expect(screen.getAllByText(TAKEN_ERROR).length).toBeGreaterThan(0);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
