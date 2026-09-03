// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The surface half: both Create-token surfaces, driven.
//
// `tickerGrammar.test.js` pins the RULE. This file pins that the two forms
// actually read it, and that the ticker reaches the composer as typed, which is
// the half a rule test cannot see. The defect had two mechanisms and they fail
// differently:
//
//   the REGEX refused a symbol-bearing name with a message on the screen;
//   the COERCION rewrote a lowercase one under the cursor with no message at
//   all, so a check that only looked for an error would have called lowercase
//   authorable.
//
// So every case here asserts on the composed ISSUE params (`TICK`), not just on
// the absence of an error banner: a form that accepted `jdog$` and then
// uppercased it into `JDOG$` would pass the weaker assertion and still ship the
// defect.
//
// Both surfaces are driven in one file on purpose. They are separate components
// with separate state that must not drift apart on this rule, and the operator's
// ruling moves both or neither.
//
// Teeth: put `.toUpperCase()` back on either input or either params builder and
// the lowercase cases fail. Restore `/^[A-Za-z0-9]+$/` and the symbol cases fail.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-0',
            address: 'bc1qownerownerownerownerownerownerownerow',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

let composeForConfirm;

function messagingStub() {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    return {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8 }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
}

function mount(Component) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: messagingStub() },
            React.createElement(Component, { walletId: 'w', onBack() {} }),
        ),
    );
}

/**
 * Drive the wizard's Custom template to a submitted ISSUE of `tick`.
 *
 * Custom because it is the template with a bare Supply field and nothing else
 * required, so the ticker is the only thing a refusal can be about.
 */
async function submitWizard(tick) {
    mount(TokenWizard);
    fireEvent.click(await screen.findByText('Custom'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const field = await screen.findByLabelText('Token name (ticker)');
    fireEvent.change(field, { target: { value: tick } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
    return field;
}

/** The same, on the standalone Issue form. */
async function submitDirect(tick) {
    mount(IssueTokenForm);
    const field = await screen.findByLabelText('Ticker');
    fireEvent.change(field, { target: { value: tick } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
    return field;
}

/** The TICK the form handed the composer, once it composed at all. */
async function composedTick() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params.TICK;
}

/** The two surfaces, so every case below runs on both without being written twice. */
const SURFACES = [
    ['the Create-token wizard', submitWizard],
    ['the direct Issue form', submitDirect],
];

describe.each(SURFACES)('%s ticker grammar', (_label, submit) => {
    afterEach(() => {
        cleanup();
        composeForConfirm = undefined;
    });

    it('composes a plain alphanumeric ticker, which is the control', async () => {
        // Without this, every assertion below is satisfiable by a form that
        // composes nothing at all.
        await submit('CONTROL1');
        expect(await composedTick()).toBe('CONTROL1');
    });

    it('accepts a symbol-bearing ticker the chain admits', async () => {
        await submit('JDOG$');
        expect(await composedTick()).toBe('JDOG$');
    });

    it('accepts a tilde inside the name', async () => {
        await submit('A~B');
        expect(await composedTick()).toBe('A~B');
    });

    it('keeps a lowercase ticker lowercase, in the field and on the wire', async () => {
        // The silent half of the defect. The field is read back as well as the
        // composed params, because the coercion lived in BOTH the input's
        // onChange and the params builder: fixing one alone still ships it.
        const field = await submit('jdogtest');
        expect(field.value, 'the input rewrote what the user typed').toBe('jdogtest');
        expect(await composedTick()).toBe('jdogtest');
    });

    it('keeps mixed case exactly as typed', async () => {
        await submit('JDog$');
        expect(await composedTick()).toBe('JDog$');
    });

    it('accepts a one-character ticker, which MIN_TICK_LENGTH allows', async () => {
        await submit('F');
        expect(await composedTick()).toBe('F');
    });

    it('refuses a caret ticker, and does not compose it', async () => {
        // Held closed deliberately: a caret ISSUE can land valid with a NULL
        // ticker id, so this is the one shape the chain quotes and the wallet
        // still will not author.
        await submit('^999999');
        expect(await screen.findByText(/reserved for token IDs/)).toBeTruthy();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a dot, because a dotted name is a subtoken and costs a fee to learn', async () => {
        // `issue.js` reads `A.B` as a child of `A` and answers "parent unknown"
        // AFTER the miner fee is spent, so widening the character class must
        // not quietly open this. The wizard's Subtoken template is the surface
        // that composes one, and the copy says so.
        await submit('PARENT.CHILD');
        expect(await screen.findByText(/cannot contain a dot/)).toBeTruthy();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('still refuses a character outside the chain allowlist', async () => {
        await submit('TWO WORDS');
        expect(await screen.findByText(/can only use/)).toBeTruthy();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('no longer promises uppercase in the field hint', async () => {
        await submit('CONTROL2');
        expect(screen.queryByText(/Uppercase\./)).toBeNull();
    });
});
