// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lookalike address warnings became a switch (operator ruling 2026-11-14),
// stored as `grace.lookalikeWarnings` and read by the send form's lookalike
// check. The warning guards against address poisoning, so both states are
// pinned on the real form: on (the default, or stored true) the send form
// warns about a recipient one character off a past recipient; off, it does
// not, and nothing else about the send changes.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
// A real bech32 destination the form accepts, and a past recipient that
// differs from it by one character in the middle (same ends).
const TYPED = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const KNOWN = 'bc1qw508d6qejxtdg4y5r3zarvaey0c5xw7kv8f3t4';

function mount(grace) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({ grace }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        getAddressHistory: vi.fn().mockResolvedValue([{ action: 'SEND', destination: KNOWN }]),
    };
    // Anything else the form asks for answers empty.
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            target[prop] = vi.fn().mockResolvedValue(null);
            return target[prop];
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Send walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function typeRecipient() {
    const to = await screen.findByLabelText(/^To$/);
    // The history read lands before the check can see the past recipient.
    await waitFor(() => expect(to).not.toBeDisabled());
    fireEvent.change(to, { target: { value: TYPED } });
}

const WARNING = /similar to an address you have sent to before/i;

afterEach(() => cleanup());

describe('Send lookalike warning follows Settings > Security', () => {
    it('warns about a near-match recipient by default (setting absent)', async () => {
        mount({});
        await typeRecipient();
        expect(await screen.findByText(WARNING)).toBeInTheDocument();
        expect(screen.getByText(WARNING).textContent).toContain(KNOWN);
    });

    it('warns about a near-match recipient with the switch on', async () => {
        mount({ lookalikeWarnings: true });
        await typeRecipient();
        expect(await screen.findByText(WARNING)).toBeInTheDocument();
    });

    it('shows no lookalike warning with the switch off', async () => {
        const messaging = mount({ lookalikeWarnings: false });
        await typeRecipient();
        // The same history is loaded, so the check had its candidate.
        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.queryByText(WARNING)).toBeNull();
    });
});
