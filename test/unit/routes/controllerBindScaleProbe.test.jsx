// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The controller-bind form opens with a source for every wallet kind that can
// author the bind: a hardware-only wallet signs on its device, and a
// watcher-mode wallet builds an unsigned transaction from a watch-only address.
// Neither holds an HD address, so a source pick limited to HD external
// addresses leaves both on "No address on this network to sign from".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const mode = vi.hoisted(() => ({ watcher: false }));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({
        walletMode: mode.watcher ? 'watcher' : 'full',
        isFullMode: !mode.watcher,
        isWatcherMode: mode.watcher,
        isSignerMode: false,
    }),
}));

const CHAIN = 'litecoin-regtest';
const COUNT = 60;
const NO_SOURCE = 'No address on this network to sign from';

function manyAddresses(makeSource) {
    return Array.from({ length: COUNT }, (_, i) => ({
        id: `a${i}`,
        address: `rltc1qprobe${String(i).padStart(4, '0')}`,
        publicKey: `02${String(i).padStart(4, '0')}`,
        derivationPath: `m/84'/1'/0'/0/${i}`,
        ...makeSource(i),
    }));
}

function renderForm(addresses) {
    const messaging = {
        getAddressesByChain: async () => ({ [CHAIN]: addresses }),
        getSettings: async () => null,
        getControllerActionClasses: async () => ({
            actionClasses: ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'],
        }),
        getSignerStatus: async () => ({ status: 'unavailable' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ControllerBindForm, {
                walletId: 'w1',
                chainId: undefined,
                tick: undefined,
                onBack() {},
            }),
        ),
    );
}

async function expectFormWithSource(addresses) {
    renderForm(addresses);
    await waitFor(() => expect(screen.getByLabelText('Guard contract')).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('From')).toBeTruthy());
    const known = new Set(addresses.map((a) => a.address));
    expect(known.has(screen.getByLabelText('From').value)).toBe(true);
    expect(screen.queryByText(new RegExp(NO_SOURCE))).toBeNull();
}

describe('controller-bind source pick across wallet kinds', () => {
    beforeEach(() => { mode.watcher = false; });

    it('(d1) a hardware-only wallet opens with a device address as the source', async () => {
        const addresses = manyAddresses((i) => ({
            source: i % 2 === 0 ? 'trezor' : 'ledger',
            signerId: i % 2 === 0 ? 'trezor-1' : 'ledger-1',
        }));
        await expectFormWithSource(addresses);
    });

    it('(d2) a watcher-mode wallet opens with a watch-only address as the source', async () => {
        mode.watcher = true;
        const addresses = manyAddresses(() => ({ source: 'watch-only' }));
        await expectFormWithSource(addresses);
    });
});
