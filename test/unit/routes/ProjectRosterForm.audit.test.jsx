// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';

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

function addToken(tick) {
    fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
    fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: tick } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
}

const CHAIN = 'dogecoin-testnet';
const ADDRESS = {
    id: 'address-1',
    address: 'DProjectOwnerAddress',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};

function messagingWith(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
        getProjectForToken: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}

function mount(messaging = messagingWith(), issuerAddress = ADDRESS.address) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ProjectRosterForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="PROJ"
                issuerAddress={issuerAddress}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('ProjectRosterForm editing validation', () => {
    it('refuses before review when the issuer is unknown', async () => {
        const messaging = messagingWith({ createList: vi.fn() });
        mount(messaging, null);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(screen.getByRole('button', { name: /^Create project tokens$/i })).toBeDisabled();
        expect(messaging.createList).not.toHaveBeenCalled();
    });

    it('keeps protocol-valid spelling and refuses a case-insensitive duplicate', async () => {
        mount();
        await screen.findByText('No list published yet. This will be the first.');
        addToken('Wow!');
        addToken('WOW!');
        expect(await screen.findByText('WOW! is already on the list.')).toBeTruthy();
        addToken('FLAM1N-H0T-CHEET0S');

        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));

        const roster = await screen.findByRole('list', { name: 'Tokens' });
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(roster).toHaveTextContent('Wow!');
        expect(roster).toHaveTextContent('FLAM1N-H0T-CHEET0S');
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it('returns from review without submitting the compose form again', async () => {
        mount();
        await screen.findByText('No list published yet. This will be the first.');
        addToken('VALID');
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));
        expect(await screen.findByRole('form', { name: 'Review official token list' })).toBeTruthy();

        const clickAllowed = fireEvent.click(screen.getByRole('button', { name: 'Back to Edit' }));

        expect(clickAllowed).toBe(false);
        expect(screen.getByRole('form', { name: 'Project tokens' })).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
    });

    it('refuses an empty list and an overlong memo before review', async () => {
        mount();
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));
        expect(await screen.findByText('Add at least one token to the list.')).toBeTruthy();

        addToken('VALID');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'x'.repeat(251) } });
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));
        expect(await screen.findByText(/network accepts at most 250/)).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
    });

    it('shows a roster lookup failure instead of claiming the roster is empty', async () => {
        mount(messagingWith({
            getProjectForToken: vi.fn().mockRejectedValue(new Error('offline')),
        }));

        expect(await screen.findByText(/Failed to load the current official-token list/)).toBeTruthy();
        expect(screen.queryByText('No list published yet. This will be the first.')).toBeNull();
        expect(screen.queryByRole('button', { name: /project tokens$/i })).toBeNull();
    });

    it('reports a creation-record request failure separately from an unindexed record', async () => {
        mount(messagingWith({
            getGenesisForToken: vi.fn().mockRejectedValue(new Error('offline')),
        }));
        await screen.findByText('No list published yet. This will be the first.');
        addToken('VALID');
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));

        expect(await screen.findByText(/Couldn't load the creation record for PROJ/)).toBeTruthy();
        expect(screen.queryByText(/isn't indexed yet/)).toBeNull();
    });
});
