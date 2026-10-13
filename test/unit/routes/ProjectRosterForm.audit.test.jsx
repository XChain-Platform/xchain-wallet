// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';

const CHAIN = 'dogecoin-mainnet';
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

function mount(messaging = messagingWith()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ProjectRosterForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="PROJ"
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('ProjectRosterForm editing validation', () => {
    it('preserves protocol-valid spelling and removes case-insensitive duplicates', async () => {
        mount();
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.change(screen.getByLabelText('Tokens (one per line)'), {
            target: { value: 'Wow!\nWOW!\nFLAM1N-H0T-CHEET0S' },
        });

        expect(screen.getByText(/2 valid token names/).textContent).toMatch(/1 duplicate removed/);
        fireEvent.click(screen.getByRole('button', { name: 'Review list' }));

        expect(await screen.findByText('Wow!, FLAM1N-H0T-CHEET0S')).toBeTruthy();
    });

    it('rejects malformed references and an overlong memo before review', async () => {
        mount();
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.change(screen.getByLabelText('Tokens (one per line)'), {
            target: { value: '^not-an-id' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review list' }));
        expect(await screen.findByText("These don't look like token names: ^not-an-id")).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Tokens (one per line)'), { target: { value: 'VALID' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'x'.repeat(251) } });
        fireEvent.click(screen.getByRole('button', { name: 'Review list' }));
        expect(await screen.findByText(/network accepts at most 250/)).toBeTruthy();
    });

    it('shows a roster lookup failure instead of claiming the roster is empty', async () => {
        mount(messagingWith({
            getProjectForToken: vi.fn().mockRejectedValue(new Error('offline')),
        }));

        expect(await screen.findByText(/Failed to load the current official-token list/)).toBeTruthy();
        expect(screen.queryByText('No list published yet. This will be the first.')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Review list' })).toBeNull();
    });

    it('reports a creation-record request failure separately from an unindexed record', async () => {
        mount(messagingWith({
            getGenesisForToken: vi.fn().mockRejectedValue(new Error('offline')),
        }));
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.change(screen.getByLabelText('Tokens (one per line)'), { target: { value: 'VALID' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review list' }));

        expect(await screen.findByText(/Couldn't load the creation record for PROJ/)).toBeTruthy();
        expect(screen.queryByText(/isn't indexed yet/)).toBeNull();
    });
});
