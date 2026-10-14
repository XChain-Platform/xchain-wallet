// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pin the dispenser explorer's network scope and user-facing failure copy,
// which the user meets in the same search.
//
// Restrict "All chains" to registry entries matching the active network.
// Otherwise a regtest wallet queries mainnet and testnet explorers that have
// no configured endpoint for the current wallet.
//
// Treat a 404 as "no dispensers for that token", which is an empty result.
// Keep other provider failures visible through fixed copy without exposing
// status codes or paths.
//
// Pin both rules here: the 404 rule is deliberately narrow, while a 500 or a
// dead host remains a visible failure through the shared message filter.

// Keep the cases separate because an empty result and an unavailable service
// require different recovery choices even though both return no rows.

// Assert on rendered copy as well as alert state so provider diagnostics cannot
// pass through while the component still appears structurally correct.

// Exercise all-chain fan-out because one failing network must not hide another.

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';

const chainRegistry = registryLib.defaultRegistry();

function chainIdsOn(networkKind) {
    return chainRegistry.supportedChains()
        .filter((d) => d.networkKind === networkKind)
        .map((d) => d.id);
}

/** Render the explorer with a settings record pinned to one network. */
function renderExplorer({ activeNetwork, getDispensersForToken }) {
    const messaging = {
        getSettings: async () => ({ schemaVersion: 2, activeNetwork }),
        updateSettings: async (p) => p,
        getDispensersForToken,
        getDispensersForAddress: vi.fn(),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function searchFor(token) {
    // The settings load is async; the chain list is empty until it lands, and
    // searching before then would escape the filter - so wait for it.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: token } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
}

describe('DispenserExplorer network scoping', () => {
    it('explains that a search term is required once the network is ready', async () => {
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken: vi.fn() });
        const action = await screen.findByRole('button', { name: /search/i });

        await waitFor(() => expect(screen.getByText('Enter a token ticker to search.')).toBeTruthy());
        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('aria-describedby', 'dispenser-search-disabled-reason');
    });

    it('explains and disables search until the active network is loaded', async () => {
        let resolveSettings;
        const getDispensersForToken = vi.fn();
        const messaging = {
            getSettings: () => new Promise((resolve) => { resolveSettings = resolve; }),
            updateSettings: async (p) => p,
            getDispensersForToken,
            getDispensersForAddress: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'XCHAIN' } });
        expect(screen.getByText('Loading available networks…')).toBeTruthy();
        const action = screen.getByRole('button', { name: /search/i });
        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('aria-describedby', 'dispenser-search-disabled-reason');
        expect(getDispensersForToken).not.toHaveBeenCalled();

        await act(async () => resolveSettings({ schemaVersion: 2, activeNetwork: 'mainnet' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /search/i })).not.toBeDisabled());
    });

    it('keeps a slower earlier search from replacing newer results', async () => {
        const pending = new Map();
        const getDispensersForToken = vi.fn(({ token }) => new Promise((resolve) => {
            pending.set(token, resolve);
        }));
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });

        const chain = chainIdsOn('mainnet')[0];
        const select = await screen.findByRole('combobox');
        fireEvent.change(select, { target: { value: chain } });
        const input = screen.getByRole('textbox');
        const form = input.closest('form');

        fireEvent.change(input, { target: { value: 'FIRST' } });
        fireEvent.submit(form);
        await waitFor(() => expect(pending.has('FIRST')).toBe(true));

        fireEvent.change(input, { target: { value: 'SECOND' } });
        fireEvent.submit(form);
        await waitFor(() => expect(pending.has('SECOND')).toBe(true));

        pending.get('SECOND')({ rows: [{ action_index: 2, give_tick: 'SECOND', address: 'new-result' }] });
        expect(await screen.findByText(/SECOND @/)).toBeTruthy();

        pending.get('FIRST')({ rows: [{ action_index: 1, give_tick: 'FIRST', address: 'old-result' }] });
        await Promise.resolve();
        expect(screen.queryByText(/FIRST @/)).toBeNull();
        expect(screen.getByText(/SECOND @/)).toBeTruthy();
    });

    it('an "All chains" search on REGTEST queries only regtest chains', async () => {
        const regtest = chainIdsOn('regtest');
        expect(regtest.length, 'the registry has no regtest chains, so this test proves nothing').toBeGreaterThan(0);

        const getDispensersForToken = vi.fn().mockResolvedValue({ dispensers: [] });
        renderExplorer({ activeNetwork: 'regtest', getDispensersForToken });
        await searchFor('XCHAIN');

        await waitFor(() => expect(getDispensersForToken).toHaveBeenCalled());
        const queried = getDispensersForToken.mock.calls.map((c) => c[0].chainId).sort();
        expect(queried,
            'the regtest wallet queried chains outside its active network - the mainnet and '
            + 'testnet explorers it is not configured to reach')
            .toEqual([...regtest].sort());
    });

    it('and on MAINNET it queries only mainnet chains', async () => {
        const mainnet = chainIdsOn('mainnet');
        const getDispensersForToken = vi.fn().mockResolvedValue({ dispensers: [] });
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        await waitFor(() => expect(getDispensersForToken).toHaveBeenCalled());
        const queried = getDispensersForToken.mock.calls.map((c) => c[0].chainId).sort();
        expect(queried).toEqual([...mainnet].sort());
        for (const id of queried) {
            expect(chainRegistry.descriptorFor(id).networkKind).toBe('mainnet');
        }
    });

    it('a 404 reads as "no dispensers", not as a broken app', async () => {
        // Treat absence as a valid result so a retry prompt does not imply that
        // the wallet or its connection failed.
        const getDispensersForToken = vi.fn().mockRejectedValue(
            new Error('Explorer returned HTTP 404 for /BTC/api/dispensers/XCHAIN/token'),
        );
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        await waitFor(() => expect(screen.getByText(/No matching dispensers/i)).toBeTruthy());
        expect(screen.queryByRole('alert'),
            'the raw explorer error is still on screen for what is an ordinary empty result')
            .toBeNull();
        expect(screen.queryByText(/HTTP 404/)).toBeNull();
    });

    it('a search where EVERY chain fails says so, instead of "no results"', async () => {
        // Distinguish a total request failure from an empty successful search.
        // ResultsPane receives both as zero rows, so the error flags carry the
        // difference and must remain visible through the rendering branch.
        const getDispensersForToken = vi.fn().mockRejectedValue(
            new Error('Explorer returned HTTP 503 for /BTC/api/dispensers/XCHAIN/token'),
        );
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        // Keep one alert per failing chain because the fan-out can return
        // partial results and each failed network remains independently retryable.
        const alerts = await waitFor(() => screen.getAllByRole('alert'));
        expect(alerts.every((el) => /Could not search for dispensers\. Try again\./.test(el.textContent)))
            .toBe(true);
        expect(alerts.every((el) => !/HTTP|\/api\//.test(el.textContent))).toBe(true);
        expect(screen.queryByText(/No matching dispensers/i),
            'every chain failed and the screen still called it an empty result')
            .toBeNull();
    });

    it('but a 500 still surfaces, because that one IS a failure', async () => {
        // Keep the service failure visible while filtering the status code and
        // request path, which are provider details rather than recovery advice.
        const getDispensersForToken = vi.fn().mockRejectedValue(
            new Error('Explorer returned HTTP 500 for /BTC/api/dispensers/XCHAIN/token'),
        );
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        // Match on the alert role because the label and message are separate
        // text nodes. One alert per chain keeps partial failures visible.
        const alerts = await waitFor(() => screen.getAllByRole('alert'));
        expect(alerts.map((el) => el.textContent).join(' '),
            'a real explorer failure was swallowed along with the 404s')
            .toMatch(/Could not search for dispensers\. Try again\./);
        expect(alerts.map((el) => el.textContent).join(' ')).not.toMatch(/HTTP 500|\/api\//);
    });

    it('shows a search skeleton, retries errors, and resets an empty search', async () => {
        // Verify the fixed fallback still retains the existing recovery action.
        let resolveFirst;
        const getDispensersForToken = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveFirst = { resolve, reject }; }))
            .mockResolvedValue({ data: [] });
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });

        const chain = chainIdsOn('mainnet')[0];
        fireEvent.change(await screen.findByRole('combobox'), { target: { value: chain } });
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'XCHAIN' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));

        expect(screen.getByRole('status', { name: 'Searching dispensers' })).toBeInTheDocument();
        await waitFor(() => expect(resolveFirst).toBeTruthy());
        await act(async () => resolveFirst.reject(new Error('service unavailable')));
        fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('No matching dispensers')).toBeInTheDocument();
        expect(getDispensersForToken).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(input).toHaveValue('');
        expect(screen.getByText(/Search by token ticker to find open dispensers/)).toBeInTheDocument();
    });
});
