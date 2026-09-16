// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ListCreateForm: the bridge-foreclosure disclosure (xchain-token-bridge-
// policy.md section 8, D9/milestone-1 refusal). This form is where an address
// list is born, and TokenAdminForm's own "access-lists" hint sends owners here
// ("create one in My Lists first") before pointing a token's allow-list or
// block-list at it - a bind that permanently forecloses bridging for that
// token in milestone 1 and can never be undone (a bound list can never be
// cleared). This form cannot know whether a list it creates will ever be
// bound, so the disclosure is a heads-up shown at create time, in the same
// voice IssueTokenForm already uses for the mirror-image warning on the
// binding side.
//
// No JSX: the file is named *list*.test.js so the list suite can be run on
// its own, and React.createElement reads the same to the renderer.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const BTC = 'bitcoin-mainnet';

const BTC_ADDRESS = {
    id: 'a-btc', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
};

/**
 * @param {object} [opts]
 * @param {Record<string, any[]>} [opts.byChain]
 * @param {'1' | '2'} [opts.initialType]
 */
function mount(opts = {}) {
    const byChain = opts.byChain || { [BTC]: [BTC_ADDRESS] };
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ListCreateForm, {
            walletId: 'w',
            chainId: BTC,
            initialType: opts.initialType,
            onBack() {},
        }),
    ));
    return messaging;
}

const FORECLOSURE_TEXT = /can never be bridged to another chain/i;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ListCreateForm: the bridge-foreclosure disclosure', () => {
    it('discloses, on the address-list (TYPE=2) form, that binding this list to a token forecloses bridging', async () => {
        mount({ initialType: '2' });
        expect(await screen.findByText(FORECLOSURE_TEXT)).toBeInTheDocument();
    });

    it('defaults to the address-list type and still shows the disclosure with no initialType given', async () => {
        mount();
        expect(await screen.findByText(FORECLOSURE_TEXT)).toBeInTheDocument();
    });

    it('does not show the address-list bridge disclosure on the token-list (TYPE=1) form', async () => {
        mount({ initialType: '1' });
        // The token-list body renders (its own textarea), and the address-list
        // disclosure is not among it: a token list is never an ALLOW_LIST/
        // BLOCK_LIST binding target, so the warning would be a false alarm here.
        await screen.findByLabelText('Tokens (one per line)');
        expect(screen.queryByText(FORECLOSURE_TEXT)).not.toBeInTheDocument();
    });

    it('the disclosure appears and disappears live when the user switches List type', async () => {
        mount({ initialType: '1' });
        await screen.findByLabelText('Tokens (one per line)');
        expect(screen.queryByText(FORECLOSURE_TEXT)).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('List type'), { target: { value: '2' } });
        expect(await screen.findByText(FORECLOSURE_TEXT)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('List type'), { target: { value: '1' } });
        expect(screen.queryByText(FORECLOSURE_TEXT)).not.toBeInTheDocument();
    });

    it('names both the allow-list and the block-list binding as irreversible for bridging', async () => {
        mount({ initialType: '2' });
        expect(await screen.findByText(
            /allow-list or block-list.*can never be bridged.*binding itself can never be cleared/is,
        )).toBeInTheDocument();
    });
});
