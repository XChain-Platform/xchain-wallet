// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the official-token list flow lays out through a page
// template, the same as its compose and review stages: the watcher-mode
// refusal, the load errors, the loading line, the queued panel, the wait for
// indexing and the done panel each sit inside ListPage or FormPage, so the
// page edge and rhythm match the form on every shell.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';

const CHAIN = 'dogecoin-testnet';
const ADDRESS = {
    id: 'address-1',
    address: 'DProjectOwnerAddress',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};
const LIST_TXID = 'aa'.repeat(32);
const LINK_TXID = 'bb'.repeat(32);

function messagingWith(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
        getProjectForToken: vi.fn().mockResolvedValue(null),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        createList: vi.fn().mockResolvedValue({ txid: LIST_TXID }),
        getActionByTxid: vi.fn().mockResolvedValue({}),
        linkAction: vi.fn().mockResolvedValue({ txid: LINK_TXID }),
        ...overrides,
    };
}

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ProjectRosterForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="PROJ"
                issuerAddress={ADDRESS.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

// The root class of each template, read from the component itself so the
// check follows the CSS-module naming the test run uses.
function templateSelector() {
    const list = render(<ListPage><p>x</p></ListPage>);
    const listClass = list.container.firstChild.className.split(' ')[0];
    list.unmount();
    const form = render(<FormPage onSubmit={() => {}} label="x"><p>x</p></FormPage>);
    const formClass = form.container.querySelector('form').className.split(' ')[0];
    form.unmount();
    return [listClass, formClass].map((name) => `.${CSS.escape(name)}`).join(', ');
}

function expectInsideTemplate(element) {
    expect(element.closest(templateSelector()), 'inside ListPage or FormPage').not.toBeNull();
}

async function publishList() {
    await screen.findByText('No list published yet. This will be the first.');
    fireEvent.change(screen.getByLabelText('Tokens (one per line)'), { target: { value: 'VALID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save roster' }));
    await screen.findByRole('form', { name: 'Review official token list' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
    fireEvent.click(await screen.findByTestId('confirm-approve'));
}

afterEach(cleanup);

describe('ProjectRosterForm: every state renders inside a page template', () => {
    it('renders the watcher-mode refusal inside a template', async () => {
        mount(messagingWith({ getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }) }));
        expectInsideTemplate(await screen.findByText('Not available in watcher mode'));
    });

    it('renders the address load error inside a template', async () => {
        mount(messagingWith({ getAddressesByChain: vi.fn().mockResolvedValue({}) }));
        expectInsideTemplate(await screen.findByText(/No address on this network yet/));
    });

    it('renders the loading line inside a template', () => {
        mount(messagingWith({ getAddressesByChain: vi.fn(() => new Promise(() => {})) }));
        expectInsideTemplate(screen.getByText('Loading wallet…'));
    });

    it('renders the roster load error inside a template', async () => {
        mount(messagingWith({ getProjectForToken: vi.fn().mockRejectedValue(new Error('offline')) }));
        expectInsideTemplate(await screen.findByText(/Failed to load the current official-token list/));
    });

    it('renders the queued panel inside a template', async () => {
        const transient = Object.assign(new Error('network down'), { name: 'BroadcastFailedTransientError' });
        mount(messagingWith({ createList: vi.fn().mockRejectedValue(transient) }));
        await publishList();
        expectInsideTemplate(await screen.findByText(/Your official token list is signed/));
    });

    it('renders the wait for indexing inside a template', async () => {
        mount(messagingWith());
        await publishList();
        expectInsideTemplate(await screen.findByText('List is on its way'));
    });

    it('renders the done panel inside a template', async () => {
        const messaging = messagingWith({ getActionByTxid: vi.fn().mockResolvedValue({ action_index: 91 }) });
        mount(messaging);
        await publishList();
        await screen.findByRole('form', { name: 'Review official token link' });
        fireEvent.click(screen.getByRole('button', { name: 'Make it official' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.linkAction).toHaveBeenCalled());
        expectInsideTemplate(await screen.findByText('Official list published'));
    });
});
