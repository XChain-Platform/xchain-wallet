// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Twelve more forms rolled their own "newest external HD address" pick for
// the signing / funding address without consulting the chain's active
// address, the same defect sourceDefault.activeAddress.test.jsx pins for
// DispenserForm, TokenWizard and the two composers. Same fixture, same
// three cases per form: index 0 is the active address, index 3 the newest
// personal address, and index 4 a dispenser-delegated address (newest of
// all). Each form must default to index 0; when the active entry names the
// delegated address the default must skip it for the newest personal one;
// and with no active map at all the newest personal address wins.
//
// Seven forms show the address on their compose stage. The other five only
// render it on review, so each of those is driven to review with the
// smallest input that passes its validation (watcher mode keeps the three
// single-encode forms on the DOM review stage instead of the confirm page).
// Teeth: restore any of the hand-rolled sorts and its form picks index 3
// or 4 in the first case, and index 4 in the second.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

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

const byId = (id) => ADDRESSES[CHAIN].find((a) => a.id === id)?.address;

function mount(Form, props, activeByChain, walletMode) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue(activeByChain),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        listActions: vi.fn().mockResolvedValue(['SEND', 'ISSUE']),
        listContacts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        // The roster and artwork forms refuse to review until the token's
        // creation record is known; the link form previews each index.
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 9 }),
        getProjectForToken: vi.fn().mockResolvedValue(null),
        getActionByIndex: vi.fn().mockResolvedValue(null),
        getOwnedTokens: vi.fn().mockResolvedValue([]),
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

// The review stages render the address through AddressText, which carries
// the full string on the span's title; the first such span is the From row.
async function reviewAddress() {
    const span = await waitFor(() => {
        const el = document.querySelector('dd span[title]');
        if (!el) throw new Error('review stage has no address row yet');
        return el;
    });
    return span.getAttribute('title');
}

async function pickFile(label) {
    const input = await screen.findByLabelText(label);
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    // The FileReader is asynchronous; the button relabels once bytes land.
    await screen.findByText('Choose a different file');
}

const submitFormOf = (el) => fireEvent.submit(el.closest('form'));

const FORMS = [
    {
        name: 'BroadcastForm',
        Form: BroadcastForm,
        props: {},
        read: async () => (await screen.findByLabelText('From')).value,
    },
    {
        name: 'IssueTokenForm',
        Form: IssueTokenForm,
        props: {},
        read: async () => (await screen.findByLabelText('From')).value,
    },
    {
        name: 'ListCreateForm',
        Form: ListCreateForm,
        props: {},
        read: async () => (await screen.findByLabelText('From')).value,
    },
    {
        name: 'AirdropForm',
        Form: AirdropForm,
        props: {},
        read: async () => (await screen.findByLabelText('From')).value,
    },
    {
        name: 'AdvancedActionsForm',
        Form: AdvancedActionsForm,
        props: {},
        read: async () => (await screen.findByLabelText('From')).value,
    },
    {
        name: 'SignMessageForm',
        Form: SignMessageForm,
        props: {},
        read: async () => {
            const select = await screen.findByLabelText('Address');
            await waitFor(() => { if (!select.value) throw new Error('no default yet'); });
            return byId(select.value);
        },
    },
    {
        name: 'PsbtSignForm',
        Form: PsbtSignForm,
        props: {},
        read: async () => {
            const select = await screen.findByLabelText('Signing address');
            await waitFor(() => { if (!select.value) throw new Error('no default yet'); });
            return byId(select.value);
        },
    },
    {
        name: 'ListForkForm',
        Form: ListForkForm,
        props: { listRef: { chainId: CHAIN, actionIndex: '5', type: '1', items: ['AAA'] }, onDone() {} },
        walletMode: 'watcher',
        read: async () => {
            const add = await screen.findByLabelText('Add tokens (one per line)');
            fireEvent.change(add, { target: { value: 'BBB' } });
            submitFormOf(add);
            return reviewAddress();
        },
    },
    {
        name: 'ProjectRosterForm',
        Form: ProjectRosterForm,
        props: { chainId: CHAIN, tick: 'JDOG' },
        read: async () => {
            const members = await screen.findByLabelText('Tokens (one per line)');
            fireEvent.change(members, { target: { value: 'AAA' } });
            submitFormOf(members);
            return reviewAddress();
        },
    },
    {
        name: 'AttachContentForm',
        Form: AttachContentForm,
        props: { chainId: CHAIN, tick: 'JDOG' },
        read: async () => {
            await pickFile('Choose file to attach');
            submitFormOf(screen.getByLabelText('Choose file to attach'));
            return reviewAddress();
        },
    },
    {
        name: 'LinkForm',
        Form: LinkForm,
        props: {},
        walletMode: 'watcher',
        read: async () => {
            const [a, b] = await screen.findAllByLabelText('Action to reference');
            fireEvent.change(a, { target: { value: '11' } });
            fireEvent.change(b, { target: { value: '22' } });
            submitFormOf(a);
            return reviewAddress();
        },
    },
    {
        name: 'PublishFileForm',
        Form: PublishFileForm,
        props: {},
        walletMode: 'watcher',
        read: async () => {
            await pickFile('Choose file to publish');
            fireEvent.click(screen.getByRole('checkbox'));
            submitFormOf(screen.getByLabelText('Choose file to publish'));
            return reviewAddress();
        },
    },
];

describe.each(FORMS)('$name source default', ({ Form, props, read, walletMode = 'full' }) => {
    it('defaults to the active address, not the newest one', async () => {
        const messaging = mount(Form, props, { [CHAIN]: { id: ACTIVE.id, address: ACTIVE.address } }, walletMode);
        expect(await read()).toBe(ACTIVE.address);
        expect(messaging.getActiveAddresses).toHaveBeenCalled();
    });

    it('never defaults to a dispenser-delegated address, even as the active entry', async () => {
        mount(Form, props, { [CHAIN]: { id: DELEGATED.id, address: DELEGATED.address } }, walletMode);
        expect(await read()).toBe(NEWEST_PERSONAL.address);
    });

    it('falls back to the newest personal address when the host has no active map', async () => {
        mount(Form, props, {}, walletMode);
        expect(await read()).toBe(NEWEST_PERSONAL.address);
    });
});
