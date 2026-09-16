// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Four spend-from-balance forms (DispenserForm, TokenWizard, the batch and
// parallel composers) rolled their own "newest external HD address" pick for
// SOURCE / "Fee paid by", while Send and every other action form default to
// the chain's ACTIVE address through the shared `preferredSourceId` helper.
// A wallet that has just generated a receive address therefore opened these
// four forms on an unfunded address and blocked at the pre-flight.
//
// Fixture: index 0 is the active address, index 3 the newest personal
// address, and index 4 a dispenser-delegated address (newest of all). Each
// form must default to index 0; and when the active entry itself names the
// delegated address, the default must skip it for the newest personal one.
// Teeth: restore any of the hand-rolled sorts and its form picks index 3 or 4.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN = 'bitcoin-mainnet';

const hd = (index, extra = {}) => ({
    id: `addr-${index}`,
    address: `bc1qindex${index}indexindexindexindexindexindexi`,
    publicKey: `02a${index}`,
    derivationPath: `m/84'/0'/0'/0/${index}`,
    source: 'hd',
    signerId: 'signer-1',
    ...extra,
});

const ACTIVE = hd(0);
const NEWEST_PERSONAL = hd(3);
const DELEGATED = hd(4, { role: 'dispenser' });
const ADDRESSES = { [CHAIN]: [ACTIVE, NEWEST_PERSONAL, DELEGATED] };

function mount(Form, props, activeByChain) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue(activeByChain),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listActions: vi.fn().mockResolvedValue(['SEND', 'ISSUE']),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Form, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

// Each form names its source in its own control; the readers return the
// selected address record's address string.
const FORMS = [
    {
        name: 'DispenserForm',
        Form: DispenserForm,
        props: {},
        read: async () => (await screen.findByLabelText('Source')).value,
    },
    {
        name: 'TokenWizard',
        Form: TokenWizard,
        props: {},
        read: async () => {
            fireEvent.click(await screen.findByText('Meme token'));
            return (await screen.findByLabelText('Fee paid by')).value;
        },
    },
    {
        name: 'BatchComposerForm',
        Form: BatchComposerForm,
        props: {},
        read: async () => {
            const select = await screen.findByLabelText('From address');
            return ADDRESSES[CHAIN].find((a) => a.id === select.value)?.address;
        },
    },
    {
        name: 'ParallelComposer',
        Form: ParallelComposer,
        props: {},
        read: async () => {
            const select = await screen.findByLabelText('From address');
            return ADDRESSES[CHAIN].find((a) => a.id === select.value)?.address;
        },
    },
];

describe.each(FORMS)('$name source default', ({ Form, props, read }) => {
    it('defaults to the active address, not the newest one', async () => {
        const messaging = mount(Form, props, { [CHAIN]: { id: ACTIVE.id, address: ACTIVE.address } });
        expect(await read()).toBe(ACTIVE.address);
        expect(messaging.getActiveAddresses).toHaveBeenCalled();
    });

    it('never defaults to a dispenser-delegated address, even as the active entry', async () => {
        mount(Form, props, { [CHAIN]: { id: DELEGATED.id, address: DELEGATED.address } });
        expect(await read()).toBe(NEWEST_PERSONAL.address);
    });

    it('falls back to the newest personal address when the host has no active map', async () => {
        mount(Form, props, {});
        expect(await read()).toBe(NEWEST_PERSONAL.address);
    });
});
