// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-34(b): the dispenser explorer's two observed faults, both of which the
// user meets in the same moment.
//
//   1. "All chains" fanned out over `chainRegistry.supportedChains()` - EVERY
//      chain the registry knows - while the wallet was sitting on Regtest. So
//      a regtest wallet fired searches at mainnet and testnet explorers it is
//      not configured to reach, on every search.
//   2. Those requests came back 404, which for this endpoint means "no
//      dispensers for that token", and the screen rendered the raw string:
//      "Couldn't search: Explorer returned HTTP 404 for
//      /BTC/api/dispensers/XCHAIN/token". A user who searched a ticker nobody
//      dispenses was told the app was broken.
//
// (1) is the cause and (2) is what made it visible, so both are pinned here.
// The 404 rule is deliberately narrow: every other status still surfaces,
// because a 500 or a dead host IS a failure and swallowing it would trade a
// noisy bug for a silent one.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('DispenserExplorer network scoping (D-34b)', () => {
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
        const getDispensersForToken = vi.fn().mockRejectedValue(
            new Error('Explorer returned HTTP 404 for /BTC/api/dispensers/XCHAIN/token'),
        );
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        await waitFor(() => expect(screen.getByText(/No open dispensers matched/i)).toBeTruthy());
        expect(screen.queryByRole('alert'),
            'the raw explorer error is still on screen for what is an ordinary empty result')
            .toBeNull();
        expect(screen.queryByText(/HTTP 404/)).toBeNull();
    });

    it('a search where EVERY chain fails says so, instead of "no results"', async () => {
        // Found while fixing the 404 case. `ResultsPane` returned "No open
        // dispensers matched" on the row count alone, so a totally failed
        // search - explorer down, wrong endpoint configured - reported an
        // empty result and dropped every error on the floor. The original
        // D-34(b) complaint was only ever VISIBLE because one chain returned
        // rows while the out-of-network ones 404'd.
        const getDispensersForToken = vi.fn().mockRejectedValue(
            new Error('Explorer returned HTTP 503 for /BTC/api/dispensers/XCHAIN/token'),
        );
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        // One alert per failing chain: the fan-out is per chain and so is the
        // report, which is what tells the user WHICH explorer is down.
        const alerts = await waitFor(() => screen.getAllByRole('alert'));
        expect(alerts.every((el) => /HTTP 503/.test(el.textContent))).toBe(true);
        expect(screen.queryByText(/No open dispensers matched/i),
            'every chain failed and the screen still called it an empty result')
            .toBeNull();
    });

    it('but a 500 still surfaces, because that one IS a failure', async () => {
        const getDispensersForToken = vi.fn().mockRejectedValue(
            new Error('Explorer returned HTTP 500 for /BTC/api/dispensers/XCHAIN/token'),
        );
        renderExplorer({ activeNetwork: 'mainnet', getDispensersForToken });
        await searchFor('XCHAIN');

        // Matched on the alert ROLE, not the copy: the label and the message
        // are two text nodes, and what actually matters is that the failure is
        // announced rather than which words wrap it.
        // One alert per failing chain: the fan-out is per chain and so is the
        // report, which is what tells the user WHICH explorer is down.
        const alerts = await waitFor(() => screen.getAllByRole('alert'));
        expect(alerts.map((el) => el.textContent).join(' '),
            'a real explorer failure was swallowed along with the 404s, trading a noisy bug for a '
            + 'silent one')
            .toMatch(/HTTP 500/);
    });
});
