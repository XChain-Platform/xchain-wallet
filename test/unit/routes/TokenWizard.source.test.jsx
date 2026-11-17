// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-163: the token form must let the user choose WHO SIGNS. On the one Issue
// Token form that is the From section (Network plus the source address and
// its picker), which these cases drive.
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
// a chain. Teeth: drop the From section's picker and the cases below fail.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
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

/** Pick a template, then open the From section, where the signer is named. */
async function driveToFrom(template = 'Subtoken') {
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(template) }));
    const field = await screen.findByLabelText('From address');
    fireEvent.click(screen.getByRole('button', { name: /^From/, expanded: false }));
    return field;
}

/** Opens the From address help tip and returns its text. */
function fromAddressHelp() {
    fireEvent.click(screen.getByRole('button', { name: /^About From address/ }));
    return document.body.textContent;
}

afterEach(() => cleanup());

describe('Issue Token signing address', () => {
    it('gives the Network field a help tip', async () => {
        mountWizard();
        await driveToFrom('Meme token');
        expect(screen.getByRole('button', { name: 'About Network' })).toBeTruthy();
    });

    it('names the fee payer in a field that opens the address picker', async () => {
        mountWizard();
        const field = await driveToFrom();

        // Unchanged default: the newest external HD address. The picker adds
        // a way past it, and must not quietly move the default underneath
        // every other template.
        expect(field.value).toBe(ADDRESSES['bitcoin-mainnet'][1].address);

        // The remedy itself: the signer can be changed.
        const open = screen.getByRole('button', { name: 'Choose source address' });
        fireEvent.click(open);
        expect(screen.queryByLabelText('From address')).toBeNull();
    });

    it('tells a subtoken author that the signer is what the chain checks', async () => {
        mountWizard();
        await driveToFrom('Subtoken');

        // The sentence exists because the refusal it prevents names a wire
        // field ("TICK") rather than the signer, so a user reading the error
        // alone looks at the wrong control.
        expect(fromAddressHelp()).toMatch(
            /subtoken can only be issued by the address that owns its parent/i,
        );
    });

    it('says nothing about parents on a template that has none', async () => {
        mountWizard();
        await driveToFrom('Meme token');

        expect(fromAddressHelp()).not.toMatch(
            /subtoken can only be issued by the address that owns its parent/i,
        );
        expect(screen.getByRole('button', { name: 'Choose source address' })).toBeTruthy();
    });
});
