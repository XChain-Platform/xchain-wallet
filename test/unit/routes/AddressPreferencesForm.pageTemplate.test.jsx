// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The load error and the loading line of the preferences form lay out through
// the page template like every other route state, so neither sits bare in the
// Screen content box.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qprefsprefsprefsprefsprefsprefsprefs00';

function element(getAddressesByChain) {
    const target = {
        getAddressesByChain,
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'a0', address: ADDRESS } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AddressPreferencesForm, {
            walletId: 'w', chainId: CHAIN, address: ADDRESS, onBack() {},
        }),
    );
}

function listPageSelector() {
    const probe = render(React.createElement(ListPage, null, React.createElement('p', null, 'x')));
    const name = probe.container.firstChild.className.split(' ')[0];
    probe.unmount();
    return '.' + CSS.escape(name);
}

function expectInsideTemplate(node) {
    expect(node.closest(listPageSelector()), 'inside the ListPage template').not.toBeNull();
}

afterEach(() => cleanup());

describe('AddressPreferencesForm page template', () => {
    it('lays out the address load error inside the page template', async () => {
        render(element(vi.fn().mockRejectedValue(new Error('Address store unavailable'))));
        const alert = await screen.findByText(/Address store unavailable|Failed to load/);
        expectInsideTemplate(alert);
    });

    it('lays out the loading line inside the page template', () => {
        render(element(vi.fn().mockReturnValue(new Promise(() => {}))));
        expectInsideTemplate(screen.getByText('Loading…'));
    });
});
