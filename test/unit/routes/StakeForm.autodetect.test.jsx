// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural test for the STAKE form's new-vs-top-up auto-detect
// . The stake-form smoke only greps the source for the string
// `messaging.getStakesForAddress`; it never proves the detection effect
// actually fires, calls the indexer with the right args, aggregates the
// source's existing valid stake, or flips the mode radio. This drives
// the real component: enter a valid 64-hex pubkey and assert the
// indexer query, the surfaced hint, the auto-selected mode, and the
// existing-stake aggregation that feeds the qualify readout.
//
// Auto-detect logic under test lives in StakeForm.jsx (the effect keyed
// on signingPubkey/fromAddress that calls messaging.getStakesForAddress).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';

// One HD external address on Bitcoin mainnet so preferredSourceId picks
// it as the funding SOURCE and the detection effect has a fromAddress.
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

// A well-formed 64-hex Ed25519 pubkey the form treats as "detectable".
const PUBKEY = 'a'.repeat(64);

/**
 * Mount StakeForm with a messaging mock. `getStakesForAddress` is the
 * unit under test; callers pass its resolved/rejected value.
 */
function mountForm(getStakesForAddress, extra = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getStakesForAddress,
        ...extra,
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(StakeForm, {
                walletId: 'w',
                chainId: 'bitcoin-mainnet',
                onBack() {},
            }),
        ),
    );
    return messaging;
}

// Type a valid pubkey once the form (not the "Loading addresses…"
// placeholder) is on screen; the detection effect fires on this change.
async function enterPubkey(pubkey = PUBKEY) {
    const input = await screen.findByLabelText('Signing pubkey');
    fireEvent.change(input, { target: { value: pubkey } });
    return input;
}

afterEach(() => cleanup());

describe('StakeForm new-vs-top-up auto-detect (getStakesForAddress)', () => {
    it('queries the indexer for the source address and auto-selects Top up when a matching valid stake exists', async () => {
        const getStakesForAddress = vi.fn().mockResolvedValue([
            { signing_pubkey: PUBKEY, status: 'valid', amount: '100' },
        ]);
        mountForm(getStakesForAddress);

        await enterPubkey();

        // Detection queried the indexer scoped to chain + source address.
        await waitFor(() => expect(getStakesForAddress).toHaveBeenCalledTimes(1));
        expect(getStakesForAddress.mock.calls[0][0]).toEqual({
            chainId: 'bitcoin-mainnet',
            address: ADDRESS,
        });

        // Existing stake found -> Top up hint + mode radio auto-checked.
        expect(await screen.findByText(/Existing stake found/)).toBeInTheDocument();
        expect(
            screen.getByRole('radio', { name: /Top up an existing stake/ }),
        ).toBeChecked();
        expect(
            screen.getByRole('radio', { name: /New stake/ }),
        ).not.toBeChecked();
    });

    it('auto-selects New stake when no stake matches the entered pubkey', async () => {
        // Rows exist for the address but none match this pubkey, so the
        // form must treat it as a fresh (VERSION 1) stake.
        const getStakesForAddress = vi.fn().mockResolvedValue([
            { signing_pubkey: 'b'.repeat(64), status: 'valid', amount: '500' },
        ]);
        mountForm(getStakesForAddress);

        await enterPubkey();

        expect(await screen.findByText(/No existing stake for this pubkey/)).toBeInTheDocument();
        expect(
            screen.getByRole('radio', { name: /New stake/ }),
        ).toBeChecked();
        expect(
            screen.getByRole('radio', { name: /Top up an existing stake/ }),
        ).not.toBeChecked();
    });

    it('surfaces a manual-choice hint (and does not throw) when the indexer query rejects', async () => {
        const getStakesForAddress = vi.fn().mockRejectedValue(new Error('indexer down'));
        mountForm(getStakesForAddress);

        await enterPubkey();

        expect(await screen.findByText(/Couldn't reach the network/)).toBeInTheDocument();
    });

    it('does not query the indexer while the pubkey is not a valid 64-hex string', async () => {
        const getStakesForAddress = vi.fn().mockResolvedValue([]);
        mountForm(getStakesForAddress);

        await enterPubkey('nothex');

        // Give any (incorrectly-scheduled) effect a tick to run.
        await Promise.resolve();
        expect(getStakesForAddress).not.toHaveBeenCalled();
        expect(screen.queryByText(/Checking the network/)).toBeNull();
    });

    it('aggregates only this pubkey\'s valid stakes into the projected qualify total', async () => {
        // Two valid rows for the pubkey (100 + 50) plus rows that must be
        // excluded: a different pubkey, and a non-"valid" status. The sum
        // (150) surfaces through the qualify readout's projected total.
        const getStakesForAddress = vi.fn().mockResolvedValue([
            { signing_pubkey: PUBKEY, status: 'valid', amount: '100' },
            { signing_pubkey: PUBKEY, status: 'valid', amount: '50' },
            { signing_pubkey: PUBKEY, status: 'revoked', amount: '999' },
            { signing_pubkey: 'c'.repeat(64), status: 'valid', amount: '777' },
        ]);
        mountForm(getStakesForAddress, {
            getCapabilityThresholds: vi
                .fn()
                .mockResolvedValue([{ capability: 'price', min_stake: '160' }]),
        });

        await enterPubkey();
        // Adding 10 to the aggregated 150 projects a 160 total, which
        // exactly meets the price threshold.
        fireEvent.change(await screen.findByLabelText('Amount'), {
            target: { value: '10' },
        });

        // "existing + this top-up" copy only renders when the aggregated
        // existing stake is > 0, and it prints the projected total (160).
        expect(
            await screen.findByText(/total stake of 160 XCHAIN for this pubkey/),
        ).toBeInTheDocument();
    });
});
