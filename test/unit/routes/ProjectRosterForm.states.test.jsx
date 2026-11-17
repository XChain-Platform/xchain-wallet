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
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

// Tokens join the list only through the token picker; this stand-in picks
// whatever ticker is typed into it, on the chain the form locked it to.
vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, chainIdFilter, onSelect, onBack }) => (
        <section aria-label={title}>
            <input aria-label="Token to pick" id="pick-tick" />
            <button type="button" onClick={() => onSelect({ chainId: chainIdFilter, tick: document.getElementById('pick-tick').value })}>Pick token</button>
            <button type="button" onClick={onBack}>Close token picker</button>
        </section>
    ),
}));

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
    // A wallet's mode is published from the wallet list, not read from
    // settings; the harness publishes the mode the settings mock names.
    Promise.resolve(messaging.getSettings()).then((settings) => {
        publishWalletModes({
            wallets: [{ id: 'wallet-1', walletMode: settings?.walletMode || 'full' }],
            activeWalletId: 'wallet-1',
        });
    });
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
    fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: 'VALID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
    await screen.findByRole('form', { name: 'Review official token list' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish List' }));
    fireEvent.click(await screen.findByTestId('confirm-approve'));
}

afterEach(() => {
    cleanup();
    resetWalletModes();
});

describe('ProjectRosterForm: every state renders inside a page template', () => {
    it('renders the watcher-mode refusal inside a template', async () => {
        mount(messagingWith({ getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }) }));
        expectInsideTemplate(await screen.findByText('Not available when another phone signs'));
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

    it('keeps Publish List enabled and refuses an empty password in the form', async () => {
        const messaging = messagingWith({ signerReady: vi.fn().mockResolvedValue({ ready: false }) });
        mount(messaging);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
        fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: 'VALID' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));

        const publish = await screen.findByRole('button', { name: 'Publish List' });
        expect(publish).toBeEnabled();
        fireEvent.click(publish);
        expect(await screen.findByRole('alert', { name: /form errors/i }))
            .toHaveTextContent('Enter your wallet password.');
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('renders the done panel inside a template', async () => {
        const messaging = messagingWith({ getActionByTxid: vi.fn().mockResolvedValue({ action_index: 91 }) });
        mount(messaging);
        await publishList();
        await screen.findByRole('form', { name: 'Review official token link' });
        fireEvent.click(screen.getByRole('button', { name: 'Make It Official' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.linkAction).toHaveBeenCalled());
        expectInsideTemplate(await screen.findByText('Official list published'));
    });
});
