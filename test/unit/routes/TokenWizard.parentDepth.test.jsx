// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-168: the subtoken wizard could not name a parent that was itself a subtoken.
//
// `handleDetailsSubmit` validated the parent field as a single alphanumeric run
// (`/^[A-Za-z0-9]+$/`), so any dotted parent was refused on the form with
// "Parent ticker must be A–Z, 0–9." The chain has no such limit: `issue.js`
// resolves a child's parent as `parts.slice(0,-1).join('.')`, so `A.B.C` is a
// child of `A.B`, nests to any depth, and is priced at the discounted
// ISSUE_SUBTOKEN rate like any other subtoken. Measured against the venue before
// this was written: `GAT530653.KID.GRAND` quotes `valid` at 0.50000000 XCHAIN
// against a plain ISSUE's 1.00000000.
//
// It mattered because the Subtoken template is the ONLY way to author a
// subtoken at all - the Ticker field refuses a dot - so a grandchild was
// uncreatable from the wallet rather than merely awkward. The template now
// lives on the one Issue Token form (its Parent ticker field), which is what
// these cases drive.
//
// The parent field is a REFERENCE to something already on the ledger, which is
// why D-168 widened it while leaving the child-name field alone. Both fields
// are now widened to the chain's own allowlist minus the caret, with the
// uppercase coercion dropped, so the two fields share one rule module
// (`shared/utils/tickerGrammar.js`) and this file's subject is what it has
// always been about: the DOT, and how deep a parent may nest. The character
// class is pinned in `test/unit/utils/tickerGrammar.test.js`.
//
// Teeth: restore `/^[A-Za-z0-9]+$/` and case 2 fails. The full drive - a real
// grandchild on chain at the subtoken price - is
// `test/e2e/tests/tokens/subtoken-depth.regtest.spec.js`.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const OWNER = 'bc1qownerownerownerownerownerownerownerow';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-0',
            address: OWNER,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

let messaging;

function mountWizard() {
    messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        // Any parent is this wallet's; the full PARENT.CHILD tick is free.
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve(
            tick.endsWith('.GRAND') ? {} : { creator: OWNER },
        )),
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

/**
 * Pick the Subtoken template on the Issue Token form, then submit `parent` as
 * the parent ticker with a fixed child name.
 *
 * Assertions read the form error off the screen afterwards. These values are
 * already uppercase: the subject here is the RULE, not any coercion.
 */
async function submitParent(parent) {
    mountWizard();
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: /Subtoken/ }));

    const parentField = await screen.findByLabelText('Parent ticker');
    fireEvent.change(parentField, { target: { value: parent } });
    fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'GRAND' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
}

/**
 * Any refusal this field can produce, so both directions assert on it.
 *
 * The rule lives in `shared/utils/tickerGrammar.js`, which names the field
 * and then the reason ("Parent ticker cannot start or end with a dot.",
 * "Parent ticker can only use ..."), so no single-sentence matcher covers
 * every refusal. Anchored on the field noun plus the verb rather than on any
 * one reason: this test is about DEPTH, and it must not fail when a
 * different rule rewords itself.
 */
const PARENT_RULE = /parent ticker (cannot|can only use|is required)/i;

async function composedTick() {
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    return messaging.composeForConfirm.mock.calls[0][0].actionData.params.TICK;
}

describe('Issue Token subtoken parent depth (D-168)', () => {
    afterEach(cleanup);

    it('accepts a plain parent, which is the case that always worked', async () => {
        await submitParent('GAT530653');
        expect(await composedTick()).toBe('GAT530653.GRAND');
        expect(screen.queryByText(PARENT_RULE)).toBeNull();
    });

    it('accepts a parent that is itself a subtoken, so a grandchild is authorable', async () => {
        await submitParent('GAT530653.KID');
        // The full path, never truncated to the parent's first level.
        expect(await composedTick()).toBe('GAT530653.KID.GRAND');
        expect(screen.queryByText(PARENT_RULE)).toBeNull();
    });

    it('still refuses a leading dot, which the chain refuses too', async () => {
        // `issue.js` answers `invalid: TICK (period)` for this, so letting it
        // through would only move the refusal to a screen that costs a round
        // trip. The empty first segment is what the regex catches.
        await submitParent('.GAT530653');
        expect(await screen.findByRole('alert')).toHaveTextContent(PARENT_RULE);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('still refuses a trailing dot', async () => {
        await submitParent('GAT530653.');
        expect(await screen.findByRole('alert')).toHaveTextContent(PARENT_RULE);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('still refuses an empty middle segment', async () => {
        // `A..B` splits to an empty parent segment; the chain would read the
        // parent as `A.` and never find it.
        await submitParent('GAT..KID');
        expect(await screen.findByRole('alert')).toHaveTextContent(PARENT_RULE);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
