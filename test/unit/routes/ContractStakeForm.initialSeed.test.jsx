// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (xchain-wallet#34). From a contract stake position's detail page, the
// Unstake / Delegate / Add stake quick actions opened ContractStakeForm with
// only the action radio preselected. The form fell back to its own generic
// defaults - token XCHAIN, an empty signing pubkey, and whichever address the
// chain's active-address default picked as From - so every one of those
// buttons made the user re-enter the position's own token, pubkey and source
// by hand. For a position staked in a token other than XCHAIN the shortcut
// landed the user on a form that did not match the position at all.
//
// These mount ContractStakeForm directly (the level StakeDetail's quick
// actions ultimately hand off to) and assert the seeded field values, the
// same way IssueTokenForm.initialMint.test.jsx checks composed behavior
// rather than the callers that reach it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractStakeForm } from '../../../packages/core/src/shared/routes/ContractStakeForm.jsx';

const CHAIN = 'bitcoin-regtest';
const CONTRACT_INDEX = '2048';

// Two of the wallet's own addresses on the target chain: ACTIVE is what
// preferredSourceId would pick with no seed at all, and POSITION is the
// staker address a real position would carry - distinct on purpose, so a
// test that finds POSITION selected can only have gotten there through
// initialFromAddress, never through the ordinary active-address default.
const ACTIVE_ADDRESS = 'bcrt1qactiveactiveactiveactiveactiveactive0';
const POSITION_ADDRESS = 'bcrt1qpositionpositionpositionpositionposit';
const ADDRESSES = {
    [CHAIN]: [
        {
            id: 'addr-active',
            address: ACTIVE_ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/1'/0'/0/0",
            source: 'hd',
        },
        {
            id: 'addr-position',
            address: POSITION_ADDRESS,
            publicKey: '02cd',
            derivationPath: "m/84'/1'/0'/0/1",
            source: 'hd',
        },
    ],
};

const POSITION_PUBKEY = '03f0e1d2c3b4a5968778695a4b3c2d1e0fa1b2c3d4e5f60718293a4b5c6d7e8f9';

function mountForm(props = {}, messagingExtra = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        // Shaped like the real host's getActiveAddresses(): a map of chainId
        // to { id, address }, which is what activeSourceId() matches against.
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-active', address: ACTIVE_ADDRESS } }),
        // A stakeable contract: cooldown_blocks present is what makes
        // contractMeta.valid true and lets the real form (not the "not
        // stakeable" error screen) render.
        getContractByActionIndex: vi.fn().mockResolvedValue({
            row: { cooldown_blocks: 10, slash_destination: 'bcrt1qslashdestinationexampleexampleexample' },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        ...messagingExtra,
    };
    // Anything else the form's hooks reach for (native-fee quotes, staked
    // balance lookups) answers empty rather than throwing: this suite is
    // about the seeded fields, not those side lookups.
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ContractStakeForm, {
                walletId: 'w',
                chainId: CHAIN,
                contractActionIndex: CONTRACT_INDEX,
                onBack() {},
                ...props,
            }),
        ),
    );
}

afterEach(() => cleanup());

describe('ContractStakeForm seeds from the position that opened it', () => {
    it('seeds token, signing pubkey and From from a non-XCHAIN position', async () => {
        mountForm({
            initialMode: 'unstake',
            initialTick: 'PEPECASH',
            initialSigningPubkey: POSITION_PUBKEY,
            initialFromAddress: POSITION_ADDRESS,
        });

        // Token: TokenField's accessible name carries the current selection,
        // e.g. "Token: PEPECASH on <chain>" - never the XCHAIN default.
        const tokenField = await screen.findByRole('button', { name: /^Token: PEPECASH/ });
        expect(tokenField).toBeTruthy();

        // Signing pubkey: pre-filled with the position's key, not blank.
        const pubkeyField = screen.getByLabelText(/signing public key/i);
        expect(pubkeyField.value).toBe(POSITION_PUBKEY);

        // From: the position's own address, not whichever address the
        // active-address default would otherwise have picked.
        const fromField = await screen.findByLabelText('From');
        expect(fromField.value).toBe(POSITION_ADDRESS);
    });

    it('falls back to today\'s defaults when no initial props are given', async () => {
        mountForm({ initialMode: 'stake' });

        const tokenField = await screen.findByRole('button', { name: /^Token: XCHAIN/ });
        expect(tokenField).toBeTruthy();

        const pubkeyField = screen.getByLabelText(/signing public key/i);
        expect(pubkeyField.value).toBe('');

        // No initialFromAddress: the ordinary active-address default wins.
        const fromField = await screen.findByLabelText('From');
        expect(fromField.value).toBe(ACTIVE_ADDRESS);
    });

    it('bounds unstake by tip-effective contract positions only', async () => {
        mountForm({
            initialMode: 'unstake',
            initialTick: 'PEPECASH',
            initialSigningPubkey: POSITION_PUBKEY,
            initialFromAddress: POSITION_ADDRESS,
        }, {
            getContractStakesForAddress: vi.fn().mockResolvedValue([
                {
                    target_contract_index: CONTRACT_INDEX,
                    tick: 'PEPECASH',
                    signing_pubkey: POSITION_PUBKEY,
                    amount: '100',
                    status: 'valid',
                    activation_block: 1,
                    deactivation_block: 90,
                },
                {
                    target_contract_index: CONTRACT_INDEX,
                    tick: 'PEPECASH',
                    signing_pubkey: POSITION_PUBKEY,
                    amount: '7',
                    status: 'valid',
                    activation_block: 95,
                    deactivation_block: null,
                },
            ]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        });

        expect(await screen.findByText('7 PEPECASH staked')).toBeInTheDocument();
    });
});
