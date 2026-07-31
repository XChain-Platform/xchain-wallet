// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// D-153 (Session 34). The ADDRESS-scoped half of the programmable-policy layer
// had no way in.
//
// `ControllerBindForm` has two subjects. A TOKEN routes an action class to a
// guard contract (ISSUE v6); the SIGNING ADDRESS does the same for its own
// account (ADDRESS v1) - the self-imposed spending gate, and the recipient-side
// gate on what the address will accept. The second has nothing to do with
// tokens. But the only route to the form was Manage Token -> More -> Controller,
// and both shells additionally gated the route itself on `tokenDetailRef`, so a
// wallet that had never ISSUED a token could not reach the address lane from any
// screen. There was no palette entry and no All-actions entry either: 77 palette
// commands, none of them this one.
//
// Three things had to be true for the lane to be reachable, and each is pinned
// below, because any one of them alone leaves it dead:
//   1. a palette command exists and navigates to the route;
//   2. the form renders with NO token context at all;
//   3. it defaults a chain for itself, since with no token there is none to
//      inherit and every other free-entry form defaults to the first chain the
//      wallet has an address on (`useActionForm`).

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

describe('D-153: the address-controller lane is reachable without a token', () => {
    it('the command palette carries an entry that opens the form', () => {
        const navigate = vi.fn();
        const cmd = buildCommands({ navigate }).find((c) => c.id === 'create-controller-bind');
        expect(cmd, 'no palette command opens the controller form').toBeTruthy();
        cmd.run();
        expect(navigate).toHaveBeenCalledWith('controller-bind');
    });

    it('is findable by the words a user would type for it', () => {
        const cmd = buildCommands({ navigate() {} }).find((c) => c.id === 'create-controller-bind');
        const haystack = `${cmd.title} ${cmd.subtitle} ${(cmd.keywords || []).join(' ')}`.toLowerCase();
        // Not decoration: this lane's whole audience arrives with one of these
        // words in mind, and none of them appears in the screen's own title.
        for (const word of ['controller', 'guard', 'policy', 'compliance']) {
            expect(haystack, `"${word}" finds nothing in the palette`).toContain(word);
        }
    });

    it('renders with no tick and no chainId, defaulting the chain itself', async () => {
        const messaging = {
            getAddressesByChain: async () => ({
                'litecoin-regtest': [{
                    id: 'a1',
                    address: 'rltc1qexample',
                    publicKey: '02aa',
                    derivationPath: "m/84'/1'/0'/0/0",
                    source: 'hd',
                }],
            }),
            getControllerActionClasses: async () => ({
                actionClasses: ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'],
            }),
            getSignerStatus: async () => ({ status: 'unavailable' }),
        };

        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                // Exactly what the palette route now passes: no tick, no chain.
                React.createElement(ControllerBindForm, {
                    walletId: 'w1',
                    chainId: undefined,
                    tick: undefined,
                    onBack() {},
                }),
            ),
        );

        // The form, not the "No address on this chain to sign from" error it used
        // to render over a wallet with plenty - the symptom of an undefined chain.
        await waitFor(() => expect(screen.getByLabelText('Guard contract')).toBeTruthy());
        expect(screen.queryByRole('alert')).toBeNull();

        // With no token there is exactly one subject to offer, and it must be
        // the address one: a form defaulting to a token it was never given would
        // build an ISSUE v6 with an empty TICK.
        const subject = screen.getByLabelText(/What to protect/);
        expect(subject.value).toBe('address');
        expect(Array.from(subject.options).map((o) => o.value)).toEqual(['address']);
    });
});
