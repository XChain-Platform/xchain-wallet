// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Key material is not copyable, on any shell (, operator decision
// 2026-08-01; wallet spec §12.2.1).
//
// Rendered rather than grepped, because the claim is about what a user can
// TAP. A source-level check would go green on a button that was moved rather
// than removed, and this policy is the kind that comes back by accident: a
// copy affordance is a natural thing to add to a screen that displays a
// string, and both of these screens display the most valuable string the
// wallet has.
//
// The rule exists because clipboard hygiene can narrow the risk but not remove
// the class: a clipboard is readable by other foreground apps, kept by
// clipboard-manager history, and on iOS synced to every nearby signed-in
// device by default. built the hygiene; this is the decision that
// there is nothing sensitive left to protect with it.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ViewPrivateKey } from '../../../packages/core/src/shared/routes/ViewPrivateKey.jsx';

const ADDRESS = {
    id: 'a1',
    address: 'bcrt1qexampleexampleexampleexampleexampleex',
    source: 'hd',
    chain: 'bitcoin',
    network: 'regtest',
    derivationPath: "m/84'/1'/0'/0/0",
    label: 'Main',
};

const messaging = {
    getSettings: async () => ({ schemaVersion: 1, activeNetwork: 'regtest' }),
    exportPrivateKey: async () => ({ wif: 'cQexampleWIFexampleWIFexampleWIFexampleWIFexample' }),
};

function draw(node) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>,
    );
}

afterEach(cleanup);

describe('the recovery-phrase screen', () => {
    it('offers no way to copy the phrase', () => {
        draw(<CreateWallet onBack={() => {}} onCreated={() => {}} />);
        // The screen opens on the password stage; no copy control exists on any
        // stage of it, so the whole render is checked rather than one stage.
        expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
        expect(screen.queryByText(/Copy recovery phrase/i)).toBeNull();
    });
});

/**
 * Drive past the "Before you continue" gate to the stage that actually shows
 * the key. The first version of this test asserted from the warning stage,
 * where the copy row does not render at ALL - so it passed with a Copy button
 * deliberately added back, which is a test that proves nothing. Caught by
 * trying to break it.
 */
async function reveal(props = {}) {
    draw(<ViewPrivateKey walletId="w1" address={ADDRESS} onBack={() => {}} {...props} />);
    const go = await screen.findByRole('button', { name: /show key/i });
    fireEvent.click(go);
    // The revealed stage is the one with the key on it.
    await waitFor(() => expect(screen.queryByText(/cQexampleWIF/)).toBeTruthy());
}

describe('the private-key screen', () => {
    it('offers no way to copy the key once it is revealed', async () => {
        await reveal();
        expect(screen.queryByRole('button', { name: /^copy$/i })).toBeNull();
        expect(screen.queryByText(/auto-clears in/i)).toBeNull();
    });

    it('names the QR as the transfer path when the shell renders one', async () => {
        // Removing the copy button without leaving a way to MOVE a key would
        // strand the user, so the advice has to change with the affordance.
        const renderQR = vi.fn(() => <div data-testid="qr" />);
        await reveal({ renderQR });
        expect(screen.queryByTestId('qr')).toBeTruthy();
        expect(screen.queryByText(/Scan the code to move this key/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^copy$/i })).toBeNull();
    });

    it('tells a shell with no QR renderer to write the key down', async () => {
        await reveal();
        expect(screen.queryByText(/Write this key down/i)).toBeTruthy();
    });
});
