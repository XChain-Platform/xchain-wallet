// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: pressing Bind twice before the first compose settles builds the
// params once and opens one confirm page, not a second compose that fails
// with a "confirmation already in progress" banner.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ControllerBindForm } from '../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

describe('controller bind form double submit', () => {
    it('builds the bind params once for two quick presses', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const buildControllerBindParams = vi.fn(async () => {
            await gate;
            return { action: 'ADDRESS', params: { controller: '5', actionClass: 'all', unbind: '0' } };
        });
        const messaging = {
            getAddressesByChain: async () => ({
                'bitcoin-regtest': [{
                    id: 'a1',
                    address: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
                    publicKey: '02aa',
                    derivationPath: "m/84'/1'/0'/0/0",
                    source: 'hd',
                }],
            }),
            getControllerActionClasses: async () => ({ actionClasses: ['transfer', 'all'] }),
            getSignerStatus: async () => ({ status: 'unavailable' }),
            buildControllerBindParams,
            composeForConfirm: () => new Promise(() => {}),
        };
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ControllerBindForm, {
                    walletId: 'w1', chainId: 'bitcoin-regtest', tick: undefined, onBack() {},
                }),
            ),
        );
        const guard = await screen.findByLabelText('Guard contract');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bind' }).disabled).toBe(false));
        fireEvent.change(guard, { target: { value: '5' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bind' })).toBeTruthy());
        const form = guard.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);
        release();
        await waitFor(() => expect(buildControllerBindParams).toHaveBeenCalled());
        expect(buildControllerBindParams).toHaveBeenCalledTimes(1);
    });
});
