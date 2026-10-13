// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainTemplates } from '../../../packages/core/src/shared/routes/CrossChainTemplates.jsx';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';

function mount(getAddressesByChain, onLaunch = vi.fn()) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: { getAddressesByChain } },
            React.createElement(CrossChainTemplates, {
                walletId: 'w',
                onLaunch,
                onBack: vi.fn(),
            }),
        ),
    );
    return onLaunch;
}

afterEach(() => cleanup());

describe('CrossChainTemplates states', () => {
    it('keeps templates in a loading state until wallet chains resolve', () => {
        mount(() => new Promise(() => {}));

        expect(screen.getByText('Loading templates…')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Use template' })).toBeNull();
    });

    it('does not launch a cross-chain template when the wallet has only one chain', async () => {
        const onLaunch = mount(() => Promise.resolve({
            [DOGE]: [{ address: 'DExampleAddress' }],
        }));

        await screen.findByText('Two chains required');
        expect(screen.queryByRole('button', { name: 'Use template' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect(onLaunch).not.toHaveBeenCalled();
    });

    it('shows templates when addresses exist on two chains', async () => {
        mount(() => Promise.resolve({
            [DOGE]: [{ address: 'DExampleAddress' }],
            [BTC]: [{ address: 'bc1qexample' }],
        }));

        expect((await screen.findAllByRole('button', { name: 'Use template' })).length)
            .toBeGreaterThan(0);
    });

    it('shows wallet load failures as errors', async () => {
        const getAddressesByChain = vi.fn()
            .mockRejectedValueOnce(new Error('Wallet unavailable'))
            .mockResolvedValueOnce({
                [DOGE]: [{ address: 'DExampleAddress' }],
                [BTC]: [{ address: 'bc1qexample' }],
            });
        mount(getAddressesByChain);

        await screen.findByText('Wallet unavailable');
        expect(screen.queryByText('Two chains required')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect((await screen.findAllByRole('button', { name: 'Use template' })).length)
            .toBeGreaterThan(0);
        expect(getAddressesByChain).toHaveBeenCalledTimes(2);
    });

    it('reports a rejected template launch without leaving an unhandled promise', async () => {
        const onLaunch = vi.fn().mockRejectedValue(new Error('Template launcher unavailable'));
        mount(() => Promise.resolve({
            [DOGE]: [{ address: 'DExampleAddress' }],
            [BTC]: [{ address: 'bc1qexample' }],
        }), onLaunch);

        fireEvent.click((await screen.findAllByRole('button', { name: 'Use template' }))[0]);

        expect(await screen.findByText('Template launcher unavailable')).toBeInTheDocument();
        expect(onLaunch).toHaveBeenCalledTimes(1);
    });

    it('launches a template once when its button is activated twice in one turn', async () => {
        let resolveLaunch;
        const launch = new Promise((resolve) => { resolveLaunch = resolve; });
        const onLaunch = vi.fn(() => launch);
        mount(() => Promise.resolve({
            [DOGE]: [{ address: 'DExampleAddress' }],
            [BTC]: [{ address: 'bc1qexample' }],
        }), onLaunch);
        const button = (await screen.findAllByRole('button', { name: 'Use template' }))[0];

        await act(async () => {
            button.click();
            button.click();
        });
        expect(onLaunch).toHaveBeenCalledTimes(1);

        await act(async () => { resolveLaunch(); });
    });
});
