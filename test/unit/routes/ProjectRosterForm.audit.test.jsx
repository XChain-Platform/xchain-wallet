// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { tokenInfoCacheKey, writeTokenInfoCache } from '../../../packages/core/src/shared/utils/tokenInfoCache.js';

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

const UNKNOWN_ISSUER = "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.";
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

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('ProjectRosterForm editing validation', () => {
    it('refuses before review when the issuer is unknown', async () => {
        const messaging = messagingWith({
            createList: vi.fn(),
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'PROJ', loadError: true }),
        });
        mount(messaging, null);

        // The owner read settles after mount, so the wait is on the text.
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        // G130: the button keeps its colour and a tap is refused at the top.
        const submit = screen.getByRole('button', { name: 'Create and Link' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        expect(await screen.findByRole('alert')).toHaveTextContent(UNKNOWN_ISSUER);
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
        expect(messaging.createList).not.toHaveBeenCalled();
    });

    // The regtest trace (content-registry:478, 2026-11-18): Official list was
    // tapped 80 ms after the token page mounted, before its token read named
    // the owner, so the form opened with no issuer and Create and Link stayed
    // disabled for good.
    it('reads the owner itself when it opens before the token page named one', async () => {
        mount(messagingWith({
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'PROJ', creator: ADDRESS.address }),
        }), null);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('VALID');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect(await screen.findByRole('form', { name: 'Review official token list' })).toBeTruthy();
        expect(screen.queryByText(UNKNOWN_ISSUER)).toBeNull();
    });

    // The Issue form's ticker check caches a not-yet-issued tick as null for
    // the cache TTL, and a mounted read never re-asks on its own.
    it('asks the explorer again when a tap finds the owner still unread', async () => {
        writeTokenInfoCache(tokenInfoCacheKey(CHAIN, 'PROJ'), null);
        const getTokenInfo = vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'PROJ', creator: ADDRESS.address });
        mount(messagingWith({ getTokenInfo }), null);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('VALID');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        await waitFor(() => expect(screen.getAllByText('Wait for the wallet to verify the current owner of PROJ.').length).toBeGreaterThan(0));
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect(await screen.findByRole('form', { name: 'Review official token list' })).toBeTruthy();
    });

    it('answers a tap while the owner read is in flight with the wait refusal', async () => {
        mount(messagingWith({ getTokenInfo: vi.fn(() => new Promise(() => {})) }), null);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('VALID');
        const submit = screen.getByRole('button', { name: 'Create and Link' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        await waitFor(() => expect(screen.getAllByText('Wait for the wallet to verify the current owner of PROJ.').length).toBeGreaterThan(0));
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
    });

    it('keeps protocol-valid spelling and refuses a case-insensitive duplicate', async () => {
        mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('Wow!');
        addToken('WOW!');
        // The notice at the top and the outlined box both carry it.
        expect(await screen.findAllByText('WOW! is already on the list.')).toHaveLength(2);
        expect(screen.getByLabelText('Tokens')).toHaveAttribute('aria-invalid', 'true');
        addToken('FLAM1N-H0T-CHEET0S');

        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));

        const roster = await screen.findByRole('list', { name: 'Tokens' });
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(roster).toHaveTextContent('Wow!');
        expect(roster).toHaveTextContent('FLAM1N-H0T-CHEET0S');
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it('returns from review without submitting the compose form again', async () => {
        mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('VALID');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect(await screen.findByRole('form', { name: 'Review official token list' })).toBeTruthy();

        const clickAllowed = fireEvent.click(screen.getByRole('button', { name: 'Back to Edit' }));

        expect(clickAllowed).toBe(false);
        expect(screen.getByRole('form', { name: 'Project tokens' })).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
    });

    it('refuses an empty list and an overlong memo before review', async () => {
        mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect(await screen.findAllByText('Add at least one token to the list.')).toHaveLength(2);

        addToken('VALID');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'x'.repeat(251) } });
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect(await screen.findByText(/network accepts at most 250/)).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
    });

    it('shows a roster lookup failure instead of claiming the roster is empty', async () => {
        mount(messagingWith({
            getProjectForToken: vi.fn().mockRejectedValue(new Error('offline')),
        }));

        expect(await screen.findByText(/Failed to load the current official-token list/)).toBeTruthy();
        expect(screen.queryByText(/Loading the current project token list/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^(Create and Link|Update List)$/ })).toBeNull();
    });

    it('reports a creation-record request failure separately from an unindexed record', async () => {
        mount(messagingWith({
            getGenesisForToken: vi.fn().mockRejectedValue(new Error('offline')),
        }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        addToken('VALID');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));

        expect(await screen.findByText(/Couldn't load the creation record for PROJ/)).toBeTruthy();
        expect(screen.queryByText(/isn't indexed yet/)).toBeNull();
    });
});
