// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListForkRoute as ListForkForm } from '../../helpers/listFormRoutes.jsx';
import messages from '../../../packages/core/src/i18n/locales/en/components.js';

// An open confirm page for the flow in flight, drawn as its summary verb.
// Each render of the form calls the hook twice, the name-and-description
// lane first and the members flow second; only the second is open.
const { hookCalls } = vi.hoisted(() => ({ hookCalls: { n: 0 } }));
vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', () => ({
    isUserRejection: () => false,
    useConfirmSubmit: () => vi.fn(),
    useActionConfirmFlow: () => {
        hookCalls.n += 1;
        return { open: hookCalls.n % 2 === 0, composing: false, confirmAction: {}, run: vi.fn() };
    },
}));
vi.mock('../../../packages/core/src/shared/components/ActionConfirmScreen.jsx', () => ({
    ActionConfirmScreen: ({ summary }) => <div data-testid="confirm-verb">{summary.verb}</div>,
}));

const CHAIN = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'doge-0',
    address: 'DExampleExampleExampleExampleExample',
    publicKey: '02aa',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const OTHER_OWNER = 'DSomeoneElseSomeoneElseSomeoneElse1';
const ITEMS = ['KEEP'];

function mountFork(owner) {
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'full' }], activeWalletId: 'wallet-1' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode: 'full' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700,
            type: '1',
            source: owner,
            list: ITEMS,
            state: { edit_resolution_active: true, current_list: ITEMS, owner },
        }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListForkForm
                walletId="wallet-1"
                listRef={{
                    chainId: CHAIN,
                    actionIndex: '2700',
                    type: '1',
                    items: ITEMS,
                    editResolutionActive: true,
                    source: owner,
                    parentIndex: null,
                }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    hookCalls.n = 0;
    resetWalletModes();
    vi.clearAllMocks();
});

describe('ListForkForm confirm page verb', () => {
    it('names the fork verb in the locale', () => {
        expect(messages['components.confirmSummary.verbForkList']).toBe('Fork List');
    });

    it('confirms a fork of a list the wallet does not own as Fork List, not Edit List', async () => {
        mountFork(OTHER_OWNER);
        expect((await screen.findByTestId('confirm-verb')).textContent).toBe('Fork List');
    });

    it('confirms a fork of an owned list as Fork List too', async () => {
        mountFork(ADDRESS.address);
        expect((await screen.findByTestId('confirm-verb')).textContent).toBe('Fork List');
    });
});
