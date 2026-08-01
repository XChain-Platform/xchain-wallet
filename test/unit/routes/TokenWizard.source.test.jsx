// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-163: the wizard's chain step must let the user choose WHO SIGNS.
//
// It used to render the fee-payer as read-only text and auto-pick the highest
// external HD address, with no control anywhere in the flow to change it. For
// five of the seven templates that is a cosmetic limit. For SUBTOKEN it is the
// whole feature: the indexer refuses `PARENT.CHILD` unless the action's SOURCE
// is the parent's owner (`issue.js`: "TICK (parent issued by another address)"),
// so a wallet whose parent owner is not its newest address could not create a
// subtoken from any screen - and the refusal it got back said "adjust the action
// and try again", over an action that was already correct.
//
// This pins the REMEDY's existence at the unit level; the full drive (refused
// from the wrong address, accepted from the right one, same form and same
// minute) is `test/e2e/tests/tokens/subtoken-issue.regtest.spec.js`, which needs
// a chain. Teeth: revert the AddressField in `renderChainStage` to the old
// read-only line and both cases below fail.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

// TWO external HD addresses on one chain, which is the situation the defect
// needs: index 1 is "newest" and wins the auto-pick, while index 0 is the one
// that issued the parent in every realistic history (you issue a token, then
// take a payment).
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-0',
            address: 'bc1qownerownerownerownerownerownerownerow',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
        {
            id: 'addr-1',
            address: 'bc1qnewestnewestnewestnewestnewestnewestn',
            publicKey: '02cd',
            derivationPath: "m/84'/0'/0'/0/1",
            source: 'hd',
        },
    ],
};

function mountWizard() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

/** Template -> chain, where the fee payer is named. */
async function driveToChainStage(template = 'Subtoken') {
    fireEvent.click(await screen.findByText(template));
    return screen.findByLabelText('Fee paid by');
}

afterEach(() => cleanup());

describe('TokenWizard signing address', () => {
    it('names the fee payer in a field that opens the address picker', async () => {
        mountWizard();
        const field = await driveToChainStage();

        // Unchanged default: the newest external HD address. The fix adds a
        // way past it, and must not quietly move the default underneath every
        // other template.
        expect(field.value).toBe(ADDRESSES['bitcoin-mainnet'][1].address);

        // The remedy itself. Before D-163 this button did not exist on any
        // stage of this wizard, while every other authoring form in the wallet
        // had one.
        const open = screen.getByRole('button', { name: 'Choose source address' });
        expect(open).toBeTruthy();
        fireEvent.click(open);
        expect(screen.queryByLabelText('Fee paid by')).toBeNull();
    });

    it('tells a subtoken author that the signer is what the chain checks', async () => {
        mountWizard();
        await driveToChainStage('Subtoken');

        // The sentence exists because the refusal it prevents names a wire
        // field ("TICK") rather than the signer, so a user reading the error
        // alone looks at the wrong control.
        expect(screen.getByText(
            /subtoken can only be created by the address that owns its parent/i,
        )).toBeTruthy();
    });

    it('says nothing about parents on a template that has none', async () => {
        mountWizard();
        await driveToChainStage('Meme token');

        expect(screen.queryByText(
            /subtoken can only be created by the address that owns its parent/i,
        )).toBeNull();
        expect(screen.getByRole('button', { name: 'Choose source address' })).toBeTruthy();
    });
});
