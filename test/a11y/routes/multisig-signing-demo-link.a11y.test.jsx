// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Multisig Sessions in a demo wallet (each Ready, Waiting and Done tab of
// sample sessions, an empty tab's line, and one session's named cosigners),
// and the Open Signing Link page with its field error. The route sweeps only
// see the empty list.

import React from 'react';
import { afterEach, describe, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigSigningSession } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const WALLET = 'demo-a11y-wallet';

function messaging() {
    return new Proxy({ listMultisigSigningSessions: async () => [] }, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return async () => ({});
        },
    });
}

function renderPage(walletId) {
    return render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <MultisigSigningSession walletId={walletId} onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('Multisig signing demo sessions and Open Signing Link accessibility', () => {
    it('scans each tab of the demo sessions list', async () => {
        markDemoWallet(WALLET);
        const { container } = renderPage(WALLET);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        await expectNoSeriousAxeViolations(container);
        for (const tab of ['Waiting', 'Done']) {
            fireEvent.click(screen.getByRole('tab', { name: tab }));
            await screen.findByRole('tabpanel', { name: tab });
            await expectNoSeriousAxeViolations(container);
        }
    });

    it('scans an empty tab with its own line', async () => {
        // Every demo tab holds a session, so a wallet with one sent session
        // shows an empty Ready tab.
        const sent = {
            id: 's', walletId: 'real-wallet', chainId: 'bitcoin-mainnet', scheme: 'p2wsh-multisig', threshold: 2,
            cosignerPubkeys: [`02${'11'.repeat(32)}`, `02${'22'.repeat(32)}`], actionSummary: 'Send 0.1 BTC',
            nonces: [], partialSigs: [], signatures: [], status: 'broadcast',
            createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z',
        };
        const one = new Proxy({ listMultisigSigningSessions: async () => [sent] }, {
            get(t, prop) {
                if (prop in t) return t[prop];
                return async () => ({});
            },
        });
        const { container } = render(
            <MessagingProvider shell="web" messaging={one}>
                <MultisigSigningSession walletId="real-wallet" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(screen.getByRole('tab', { name: 'Ready' }));
        await screen.findByText('Nothing to sign or send');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a demo session with its named cosigners', async () => {
        markDemoWallet(WALLET);
        const { container } = renderPage(WALLET);
        const ready = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(ready).getByRole('button', { name: /Send 1\.2 BTC/ }));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        await screen.findByText('You (this wallet)');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the Open Signing Link page with its field error', async () => {
        const { container } = renderPage('real-wallet');
        fireEvent.click(await screen.findByRole('button', { name: 'Open a signing link' }));
        await screen.findByRole('heading', { level: 1, name: 'Open Signing Link' });
        fireEvent.click(screen.getByRole('button', { name: 'Open Signing Link' }));
        const field = screen.getByLabelText('Signing link to open');
        await waitFor(() => {
            if (field.getAttribute('aria-invalid') !== 'true') throw new Error('field not marked');
        });
        await expectNoSeriousAxeViolations(container);
    });
});
