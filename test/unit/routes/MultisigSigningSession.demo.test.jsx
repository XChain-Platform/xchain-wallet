// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: a demo wallet's Multisig Sessions page shows sample sessions
// in each state (waiting on your signature, waiting on others, ready to
// broadcast, broadcast) instead of the empty state. The samples come from
// the demo source, never the vault, and every action that would change a
// session answers with the demo refusal.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    demoMessaging,
    synthesizeDemoMultisigSessions,
} from '../../../packages/core/src/flows/demoFixtures.js';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { validateMultisigSigningSession } from '../../../packages/core/src/schemas/multisigSigningSession.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigSigningSession } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';

const NOW = Date.UTC(2026, 0, 15, 15, 4, 0);
const WALLET = 'demo-multisig-wallet';

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.clearAllMocks();
});

function hostMessaging() {
    return {
        listMultisigSigningSessions: vi.fn(async () => []),
        getMultisigSigningSession: vi.fn(async () => null),
        cancelMultisigSigningSession: vi.fn(async () => undefined),
        finalizeMultisigSigningSession: vi.fn(async () => undefined),
        signMultisigLocally: vi.fn(async () => undefined),
        importMultisigSigningRequest: vi.fn(async () => ({ sessionId: 'x' })),
        getSettings: vi.fn(async () => ({ walletMode: 'full', activeNetwork: 'mainnet' })),
    };
}

function renderPage(messaging, walletId = WALLET) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(MultisigSigningSession, { walletId, onBack: () => {} }),
    ));
}

describe('demo multisig signing sessions fixture', () => {
    const sessions = synthesizeDemoMultisigSessions(WALLET, { now: NOW });

    it('has one session per list state, all valid session records', () => {
        expect(sessions).toHaveLength(4);
        for (const s of sessions) {
            expect(validateMultisigSigningSession(s)).toEqual({ ok: true, errors: [] });
            expect(s.walletId).toBe(WALLET);
            // Multisig spends are Bitcoin-only today.
            expect(s.chainId).toMatch(/^bitcoin-/);
        }
        expect(sessions.map((s) => s.status)).toEqual(['collecting-sigs', 'collecting-sigs', 'finalized', 'broadcast']);
        expect(new Set(sessions.map((s) => s.id)).size).toBe(4);
    });

    it('counts only listed cosigners and names every cosigner', () => {
        for (const s of sessions) {
            const contributions = [...s.signatures, ...s.partialSigs, ...s.nonces];
            for (const c of contributions) expect(s.cosignerPubkeys).toContain(c.pubkey);
            expect(Object.keys(s.cosignerNames).sort()).toEqual([...s.cosignerPubkeys].sort());
        }
        const [yours, others] = sessions;
        const youKey = Object.entries(yours.cosignerNames).find(([, name]) => name.startsWith('You'))[0];
        // Waiting on your signature: your key has not signed, the others have.
        expect(yours.signatures.map((x) => x.pubkey)).not.toContain(youKey);
        expect(yours.signatures).toHaveLength(yours.threshold - 1);
        // Waiting on others: you signed, 1 of 2.
        expect(others.signatures.map((x) => x.pubkey)).toEqual([youKey]);
        expect(others.threshold).toBe(2);
    });

    it('repeats exactly at one injected instant', () => {
        expect(synthesizeDemoMultisigSessions(WALLET, { now: NOW })).toEqual(sessions);
        expect(synthesizeDemoMultisigSessions(WALLET, { now: NOW + 60_000 })).not.toEqual(sessions);
    });

    it('is served by the demo source and never read from the host vault', async () => {
        const host = hostMessaging();
        const source = demoMessaging(host);
        const listed = await source.listMultisigSigningSessions({ walletId: WALLET });
        expect(Array.isArray(listed)).toBe(true);
        expect(listed.map((s) => s.id)).toEqual(sessions.map((s) => s.id));
        expect((await source.getMultisigSigningSession({ sessionId: sessions[2].id })).status).toBe('finalized');
        expect(host.listMultisigSigningSessions).not.toHaveBeenCalled();
        expect(host.getMultisigSigningSession).not.toHaveBeenCalled();
    });
});

// The sessions list of the tab on show.
const sessionsList = () => screen.findByRole('list', { name: 'Multisig sessions' });

describe('demo wallet Multisig Sessions page', () => {
    it('sorts the sample sessions into Ready, Waiting and Done instead of the empty state', async () => {
        markDemoWallet(WALLET);
        const host = hostMessaging();
        renderPage(host);

        // Ready leads: waiting on your signature, then signed and ready to send.
        const ready = await sessionsList();
        expect(screen.getByRole('tab', { name: 'Ready' })).toHaveAttribute('aria-selected', 'true');
        expect(within(ready).getAllByRole('button').map((row) => row.textContent)).toEqual([
            expect.stringMatching(/^Send 1\.2 BTC3 of 3 SegWit · .*2 of 3$/),
            expect.stringMatching(/^Send 0\.08 BTC2 of 3 Classic · .*Send now$/),
        ]);

        // Waiting: you signed, the other cosigners have not.
        fireEvent.click(screen.getByRole('tab', { name: 'Waiting' }));
        const waiting = await sessionsList();
        expect(within(waiting).getAllByRole('button').map((row) => row.textContent)).toEqual([
            expect.stringMatching(/^Send 0\.35 BTC2 of 3 SegWit · .*1 of 2$/),
        ]);

        // Done: the sent session, shown in full with no fold.
        fireEvent.click(screen.getByRole('tab', { name: 'Done' }));
        const done = await sessionsList();
        expect(within(done).getByText('Send 0.015 TBTC')).toBeTruthy();
        expect(within(done).getByText('Sent')).toBeTruthy();
        expect(within(done).getByText(/^2 of 2 Taproot · /)).toBeTruthy();
        expect(within(done).getAllByRole('button')).toHaveLength(1);

        expect(screen.queryByText('No Signing Sessions')).toBeNull();
        expect(host.listMultisigSigningSessions).not.toHaveBeenCalled();
    });

    it('opens the session waiting on your signature, with you the only pending cosigner', async () => {
        markDemoWallet(WALLET);
        renderPage(hostMessaging());

        const ready = await sessionsList();
        fireEvent.click(within(ready).getByRole('button', { name: /Send 1\.2 BTC/ }));
        expect(await screen.findByLabelText('Multisig signing progress')).toHaveTextContent('2 of 3');
        expect(screen.getByText('Send 1.2 BTC to Priya Nair')).toBeTruthy();
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent('1 more signature required.');

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const signed = screen.getByRole('list', { name: 'Signed cosigners' });
        expect(within(signed).getByText('Erin Calloway')).toBeTruthy();
        expect(within(signed).getByText('Marcus Webb')).toBeTruthy();
        const pending = screen.getByRole('list', { name: 'Pending cosigners' });
        expect(within(pending).getByText('You (this wallet)')).toBeTruthy();
        expect(within(pending).getAllByRole('listitem')).toHaveLength(1);
    });

    it('opens the ready session with Broadcast, and refuses it as a demo', async () => {
        markDemoWallet(WALLET);
        const host = hostMessaging();
        renderPage(host);

        const ready = await sessionsList();
        fireEvent.click(within(ready).getByRole('button', { name: /Send 0\.08 BTC/ }));
        expect(await screen.findByText('This signed transaction is ready to broadcast.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast Transaction' }));

        expect(await screen.findByTestId('demo-guard-refusal')).toBeTruthy();
        expect(host.finalizeMultisigSigningSession).not.toHaveBeenCalled();
    });

    it('refuses Cancel on a sample session without reaching the host', async () => {
        markDemoWallet(WALLET);
        const host = hostMessaging();
        renderPage(host);

        await sessionsList();
        fireEvent.click(screen.getByRole('tab', { name: 'Waiting' }));
        fireEvent.click(within(await sessionsList()).getByRole('button', { name: /Send 0\.35 BTC/ }));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: /^Cancel session/ }));

        expect(await screen.findByTestId('demo-guard-refusal')).toBeTruthy();
        expect(host.cancelMultisigSigningSession).not.toHaveBeenCalled();
    });

    it('shows the broadcast session as complete', async () => {
        markDemoWallet(WALLET);
        renderPage(hostMessaging());

        await sessionsList();
        fireEvent.click(screen.getByRole('tab', { name: 'Done' }));
        fireEvent.click(within(await sessionsList()).getByRole('button'));
        expect(await screen.findByText(/^Broadcast complete: [0-9a-f]{64}$/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Cancel session/ })).toBeNull();
    });

    it('a real wallet reads its own vault and shows no sample sessions', async () => {
        const host = hostMessaging();
        renderPage(host, 'real-wallet');

        expect(await screen.findByText('No Signing Sessions')).toBeTruthy();
        await waitFor(() => expect(host.listMultisigSigningSessions).toHaveBeenCalledWith({ walletId: 'real-wallet' }));
        expect(screen.queryByText('Send 1.2 BTC')).toBeNull();
    });
});
