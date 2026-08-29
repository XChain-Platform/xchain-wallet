// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet E2E campaign: the Airdrop holder-count preview threw away the cause
// of a failed read AND never asked again, so one transient refusal was both
// permanent and unexplained.
//
// Found by the whole-suite Litecoin run of 2026-08-28, where
// `tokens/airdrop` failed on a preview reading "1 token · holder count
// unavailable (Failed to load holder counts.)". Probed straight afterwards,
// the endpoint answered HTTP 200 in 11ms with exactly the two holders the
// spec asked for - so the read really was transient, and the measured
// candidate is the shared explorer's rate limit (RateLimit-Policy 120;w=60,
// as the header says), which the `tokens/` tail crosses because its specs are the
// longest in the suite.
//
// Two separate defects, and the second is what made it permanent:
//
// (1) THE CAUSE WAS DISCARDED. `.catch(() => null)` turned a 429, a dead
//     endpoint and an unknown tick into one identical sentence. This is the
//     class the campaign has now paid for four times (an absent
//     field read as a verdict) and it is a SLIP rather than a design choice,
//     because the twin fetch in DividendForm has always reported
//     `err.message`.
//
// (2) NOTHING EVER RE-ASKED. The effect re-runs only when the tick set or
//     the chain changes, so after one blip the form showed "holder count
//     unavailable" for the rest of the session with no control on screen to
//     retry it - the user's only way out is to retype the ticker.
//
// These tests drive the REAL component rather than the effect, because both
// defects are about what reaches the screen: a handler test would have passed
// against the broken build in each case.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'litecoin-mainnet';
const SOURCE = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const HELD = 'HDR550816';
const LISTED = 'MEM550816';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-ltc',
        address: SOURCE,
        publicKey: '02cd',
        derivationPath: "m/84'/2'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
};

/**
 * @param {() => Promise<any>} holders  the holder read, called once per attempt
 */
function mountAirdrop(holders) {
    const getHoldersForToken = vi.fn(holders);
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: HELD, divisibility: 0, locks: {},
        }),
        getHoldersForToken,
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: HELD, quantity: '1000', divisibility: 0 }],
                },
            }],
        }),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn(),
        airdropAction: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(AirdropForm, {
                walletId: 'w', onBack() {}, initialChainId: CHAIN, initialTick: HELD,
            }),
        ),
    );
    return getHoldersForToken;
}

/** Puts the form in 'Token holders' mode with one tick listed. */
async function listOneTick() {
    const mode = await screen.findByDisplayValue('Paste addresses');
    fireEvent.change(mode, { target: { value: 'holders' } });
    const ticks = await screen.findByLabelText('Tokens (one per line)');
    fireEvent.change(ticks, { target: { value: LISTED } });
}

const preview = () => screen.queryByText(/1 token ·/);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.useRealTimers();
});

describe('the Airdrop holder-count preview survives one refusal and names any it cannot', () => {
    it('retries a failed read, so a transient refusal does not poison the preview', async () => {
        // The measured shape: the explorer refuses once under load and
        // answers normally the next time. Before the fix, the first refusal
        // was the last word for the whole form session.
        let calls = 0;
        const holders = mountAirdrop(async () => {
            calls += 1;
            if (calls === 1) throw new Error('HTTP 429 rate limited');
            return { tick: LISTED, total: 2, data: [{ address: 'a' }, { address: 'b' }] };
        });

        await listOneTick();

        await waitFor(() => {
            expect(preview()?.textContent).toMatch(/~2 holders right now/);
        }, { timeout: 8000 });
        expect(holders.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('names the cause when every attempt is refused, instead of a bare sentence', async () => {
        // A read that fails BOTH times is a real outage and the preview
        // should say so - but it must say WHICH refusal, because "Failed to
        // load holder counts." cannot tell a rate limit from a dead endpoint
        // and sends the reader to seeding rather than to the venue.
        const holders = mountAirdrop(async () => {
            throw new Error('HTTP 429 rate limited');
        });

        await listOneTick();

        await waitFor(() => {
            expect(preview()?.textContent).toMatch(/holder count unavailable \(.*429 rate limited.*\)/);
        }, { timeout: 8000 });
        expect(holders.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('asks exactly once and reports the count when the venue answers first time', async () => {
        // The happy path must not pay for the retry: a working venue is read
        // once, which is what keeps this off the critical path of every
        // keystroke in the ticker box.
        const holders = mountAirdrop(async () => (
            { tick: LISTED, total: 2, data: [{ address: 'a' }, { address: 'b' }] }
        ));

        await listOneTick();

        await waitFor(() => {
            expect(preview()?.textContent).toMatch(/~2 holders right now/);
        }, { timeout: 8000 });
        expect(holders).toHaveBeenCalledTimes(1);
    });
});
