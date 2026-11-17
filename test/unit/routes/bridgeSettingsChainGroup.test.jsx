// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Bridge settings listed "Destination chains" and each chain checkbox as
// separate form rows, so the label sat a form gap plus its own 12px margin
// above the first chain (28px) and the chains were spaced like unrelated
// fields. They became one labelled group with the label gap inside it, and
// then (G117, operator 2026-11-14) one Destination networks picker field that
// opens a picker page of network switch rows, so the form never grows with the
// number of networks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const DOGE = 'dogecoin-mainnet';
const DOGE_ADDRESS = {
    id: 'a-doge', address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
};
const WAIT = { timeout: 4000 };

function mountAdmin(tokenInfo) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [DOGE_ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue(tokenInfo),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = new Proxy(base, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            t[p] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenAdminForm, {
            walletId: 'w',
            mode: 'bridge-settings',
            initialChainId: DOGE,
            initialTick: 'FUFU',
            onBack() {},
        }),
    ));
    return messaging;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

const networksField = (name = /^Destination networks: /) => screen.findByRole('button', { name }, WAIT);

describe('Bridge settings destination networks', () => {
    // G117: the form holds one picker field, never one row per network, so it
    // keeps its height however many chains the protocol adds.
    it('shows one Destination networks picker field and no inline network rows', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const field = await networksField('Destination networks: None set');
        expect(field).toHaveTextContent('None set');
        expect(field.closest('[data-networks-field]')).toBeTruthy();
        expect(screen.queryByLabelText('Bitcoin')).toBeNull();
        expect(screen.queryByLabelText('Litecoin')).toBeNull();
        expect(document.querySelector('[data-bridge-destination-list]')).toBeNull();
    });

    it('opens the picker page of switch rows with icons and returns the new choice to the field', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        fireEvent.click(await networksField());
        const list = await screen.findByRole('group', { name: 'Destination Networks' }, WAIT);
        expect(screen.getByRole('heading', { name: 'Destination Networks' })).toBeInTheDocument();
        const switches = within(list).getAllByRole('switch');
        expect(switches.map((s) => s.closest('label').textContent)).toEqual([
            expect.stringContaining('Bitcoin'), expect.stringContaining('Litecoin'),
        ]);
        // A token cannot bridge to the chain it lives on.
        expect(within(list).queryByLabelText('Dogecoin')).toBeNull();
        for (const input of switches) {
            expect(input).not.toBeChecked();
            expect(input.closest('label').querySelector('[aria-hidden="true"] img, [aria-hidden="true"] span')).toBeTruthy();
        }
        fireEvent.click(within(list).getByLabelText('Litecoin'));
        expect(within(list).getByLabelText('Litecoin')).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        const field = await networksField('Destination networks: Litecoin');
        expect(field).toHaveTextContent('Litecoin');
        expect(screen.queryByRole('group', { name: 'Destination Networks' })).toBeNull();
    });

    // G120: what the page is for is a standard info Notice at the top of the
    // picker page, never a bare line of text hanging over the list.
    it('opens the picker page with its guidance as an info Notice at the top', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        fireEvent.click(await networksField());
        const list = await screen.findByRole('group', { name: 'Destination Networks' }, WAIT);
        const notice = document.querySelector('[data-networks-picker-notice]');
        expect(notice).toBeTruthy();
        expect(notice.getAttribute('data-tone')).toBe('info');
        expect(notice.textContent).toContain('Turn on each network this token may be bridged to.');
        // It comes before the list, and no bare intro paragraph is left over it.
        expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const bare = [...document.querySelectorAll('p')].filter((p) => /Turn on each network/.test(p.textContent) && !p.closest('[data-tone]'));
        expect(bare).toHaveLength(0);
    });

    // The freeze is a normal toggle field: no card or bubble of its own, no
    // icon, a switch never a checkbox (G118), labelled "Freeze settings permanently".
    it('shows the freeze as a plain toggle field with no card and no icon', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const freeze = await screen.findByRole('switch', { name: 'Freeze settings permanently' }, WAIT);
        expect(screen.queryByRole('switch', { name: /Freeze these settings/i })).toBeNull();
        const row = freeze.closest('label');
        // No leading icon: the only svg allowed is inside the help tip's button.
        expect([...row.querySelectorAll('svg')].filter((svg) => !svg.closest('button'))).toHaveLength(0);
        expect(row.querySelector('img')).toBeNull();
        expect(document.querySelector('[data-bridge-freeze-list]')).toBeNull();
        expect(row.parentElement.closest('[data-bridge-freeze-list]')).toBeNull();
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        // The static warning sits directly under the field.
        const warning = document.querySelector('[data-bridge-freeze-warning]');
        expect(warning).toBeTruthy();
        expect(row.nextElementSibling).toBe(warning);
    });

    // The inline group and its .checkGroup rule are gone with G117.
    it('leaves no inline network group rule behind', () => {
        const css = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        expect(ruleBody(css, '.checkGroup')).toBeNull();
    });
});
