// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source-address',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-source',
});

function makeMessaging({ owned, shared = [] }) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListsForSource: vi.fn().mockResolvedValue({ data: owned }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: shared, unavailable: [] }),
        getListByActionIndex: vi.fn().mockResolvedValue(null),
        getActionFormats: vi.fn().mockResolvedValue({}),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(options) {
    listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    render(
        <MessagingProvider shell="web" messaging={makeMessaging(options)}>
            <UnionListForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} onDone={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('UnionListForm candidate names', () => {
    it('shows a local list name before the label', async () => {
        mount({ owned: [{ action_index: 101, type: 1, members: [], name: 'Stable coins' }] });
        expect(await screen.findByRole('checkbox', { name: 'Stable coins (Token list #101)' })).toBeTruthy();
    });

    it('shows a shared list name before the label', async () => {
        mount({
            owned: [],
            shared: [{ bindTarget: 900, type: 2, members: [], home_chain: 'LTC', home_list_index: 44, name: 'Friends' }],
        });
        expect(await screen.findByRole('checkbox', {
            name: 'Friends (Shared address list #900 from LTC list #44)',
        })).toBeTruthy();
    });

    it.each([
        ['no name', {}],
        ['an empty name', { name: '' }],
        ['a null name', { name: null }],
        ['a numeric name', { name: 42 }],
        ['an object name', { name: { text: 'x' } }],
        ['a whitespace-only name', { name: '   ' }],
    ])('keeps the plain label for %s', async (_case, extra) => {
        mount({ owned: [{ action_index: 101, type: 1, members: [], ...extra }] });
        expect(await screen.findByRole('checkbox', { name: 'Token list #101' })).toBeTruthy();
    });

    it('neutralizes a bidi override in the name', async () => {
        mount({ owned: [{ action_index: 101, type: 1, members: [], name: 'evil‮txt' }] });
        const box = await screen.findByRole('checkbox', { name: /evil.*txt \(Token list #101\)/ });
        const text = box.closest('label').textContent;
        expect(text).not.toContain('‮');
        expect(text).toContain('evil␦txt (Token list #101)');
    });
});
