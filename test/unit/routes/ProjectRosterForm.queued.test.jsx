// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A roster list that is signed but held in the broadcast queue ends the flow on the
// queued panel: no failure banner and no Sign button that would broadcast a second copy.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const CHAIN = 'dogecoin-testnet';
const ADDRESS = {
    id: 'address-1',
    address: 'DProjectOwnerAddress',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};

afterEach(cleanup);

describe('ProjectRosterForm queued list', () => {
    it('ends on the queued panel when the list is signed but not broadcast', async () => {
        const transient = Object.assign(new Error('network down'), { name: 'BroadcastFailedTransientError' });
        const messaging = {
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
            createList: vi.fn().mockRejectedValue(transient),
        };
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
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
        fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: 'VALID' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
        fireEvent.click(screen.getByRole('button', { name: /^Create project tokens$/i }));
        await screen.findByRole('form', { name: 'Review official token list' });
        fireEvent.click(screen.getByRole('button', { name: 'Publish List' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));

        await waitFor(() => expect(document.body.textContent).toMatch(/Your official token list is signed/));
        expect(document.body.textContent).not.toMatch(/did not return a transaction ID/);
        expect(screen.queryByRole('button', { name: 'Publish List' })).toBeNull();
    });
});
