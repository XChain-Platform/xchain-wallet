// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Network and Fees (operator ruling 2026-11-14): the Network row is a chevron
// row showing the wallet-wide environment; it opens its own page that lists
// Mainnet, Testnet and Regtest as the shared network rows. A pick keeps the
// confirm step, switches as the dropdown did, and returns to Network and Fees.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

afterEach(() => {
    cleanup();
    resetBackStackForTests();
});

/** A messaging stub whose settings persist across mounts. */
function harness(overrides = {}) {
    let stored = { ...structuredClone(createDefaultSettings()), activeNetwork: 'mainnet', developerMode: true, ...overrides };
    const known = {
        getSettings: vi.fn(async () => structuredClone(stored)),
        updateSettings: vi.fn(async (patch) => {
            stored = { ...stored, ...patch };
            return structuredClone(stored);
        }),
        setActiveNetwork: vi.fn(async ({ network }) => {
            stored = { ...stored, activeNetwork: network };
            return { settings: structuredClone(stored) };
        }),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        listBlockedOrigins: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(known, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string' || property === 'then') return undefined;
            target[property] = vi.fn(() => new Promise(() => {}));
            return target[property];
        },
    });
}

function renderSettings(messaging, props = {}) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <Settings onBack={() => {}} activeWallet={{ id: 'w1', name: 'Main' }} {...props} />
        </MessagingContext.Provider>,
    );
}

async function openNetworkAndFees(messaging, props = {}) {
    const view = renderSettings(messaging, { initialSubpageId: 'g-network', ...props });
    await waitFor(() => expect(networkRow(view.container)).toBeTruthy());
    return view;
}

const networkRow = (container) => container.querySelector('[data-settings-row-id="network-active"]');
const optionNames = (container) => [...container.querySelectorAll('button[data-network-option]')]
    .map((button) => button.getAttribute('aria-label').replace(/^Select /, ''));

describe('Network row on Network and Fees', () => {
    it('is a chevron row with the current environment as its summary, no dropdown', async () => {
        const { container } = await openNetworkAndFees(harness({ activeNetwork: 'testnet' }));
        const row = networkRow(container);
        expect(row.querySelector(':scope > button')).toBeTruthy();
        await waitFor(() => expect(row.textContent).toContain('Testnet'));
        expect(row.textContent).not.toContain('Switching asks you to confirm');
        expect(screen.queryByRole('combobox', { name: 'Active network' })).toBeNull();
        expect(row.querySelector('[data-settings-inline]')).toBeNull();
    });

    it('leaves the Fee strategy and Automatic donations rows as they were', async () => {
        const { container } = await openNetworkAndFees(harness());
        const ids = [...container.querySelectorAll('[data-settings-row-id]')].map((li) => li.getAttribute('data-settings-row-id'));
        expect(ids).toContain('fees');
        expect(ids).toContain('ads');
        expect(ids.indexOf('network-active')).toBeLessThan(ids.indexOf('fees'));
    });
});

describe('Network page', () => {
    it('lists Mainnet, Testnet and Regtest as network rows with a line each, the current one marked', async () => {
        const { container } = await openNetworkAndFees(harness({ activeNetwork: 'testnet' }));
        fireEvent.click(networkRow(container).querySelector(':scope > button'));
        await screen.findByRole('heading', { name: 'Network' });
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(3));
        expect(optionNames(container)).toEqual(['Mainnet', 'Testnet', 'Regtest']);
        const options = [...container.querySelectorAll('button[data-network-option]')];
        expect(options.map((o) => o.getAttribute('aria-current'))).toEqual([null, 'true', null]);
        expect(options[0].querySelector('[data-network-description]').textContent).toBe('Real funds');
        expect(options[1].querySelector('[data-network-description]').textContent).toBe('Free test coins with no value');
        expect(options[2].querySelector('[data-network-description]').textContent).toBe('A local developer network');
    });

    it('offers only Mainnet and Testnet while Developer Mode is off and Regtest is not current', async () => {
        const { container } = renderSettings(harness({ developerMode: false }), { initialSubpageId: 'network-active' });
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(2));
        expect(optionNames(container)).toEqual(['Mainnet', 'Testnet']);
    });

    it('opens from the old Network page id', async () => {
        const { container } = renderSettings(harness(), { initialSubpageId: 'network' });
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(3));
    });
});

describe('Network page confirm', () => {
    async function openPage(messaging, props) {
        const view = renderSettings(messaging, { initialSubpageId: 'network-active', ...props });
        await waitFor(() => expect(view.container.querySelectorAll('button[data-network-option]').length).toBeGreaterThan(0));
        return view;
    }
    const option = (container, name) => [...container.querySelectorAll('button[data-network-option]')]
        .find((button) => button.getAttribute('aria-label').includes(name));

    it('asks before switching and changes nothing when cancelled', async () => {
        const onActiveNetworkChange = vi.fn().mockResolvedValue(undefined);
        const { container } = await openPage(harness(), { onActiveNetworkChange });
        fireEvent.click(option(container, 'Testnet'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Switch to Testnet?')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(onActiveNetworkChange).not.toHaveBeenCalled();
        expect(container.querySelectorAll('button[data-network-option]').length).toBe(3);
    });

    it('switches through the shell handler once confirmed and returns to Network and Fees', async () => {
        const onActiveNetworkChange = vi.fn().mockResolvedValue(undefined);
        const { container } = await openNetworkAndFees(harness(), { onActiveNetworkChange });
        fireEvent.click(networkRow(container).querySelector(':scope > button'));
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(3));
        fireEvent.click(option(container, 'Testnet'));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Switch network' }));
        await waitFor(() => expect(onActiveNetworkChange).toHaveBeenCalledWith('testnet'));
        // Back on Network and Fees, with the Network row in the list.
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(0));
        expect(networkRow(container)).toBeTruthy();
    });

    it('saves the setting and reloads when the shell has no handler, then shows the new value', async () => {
        const messaging = harness();
        const reload = vi.fn();
        const { container } = await openNetworkAndFees(messaging, { reload });
        fireEvent.click(networkRow(container).querySelector(':scope > button'));
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(3));
        fireEvent.click(option(container, 'Regtest'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Switch to Regtest?')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Switch network' }));
        await waitFor(() => expect(messaging.setActiveNetwork).toHaveBeenCalledWith({ walletId: 'w1', network: 'regtest' }));
        await waitFor(() => expect(reload).toHaveBeenCalled());
        await waitFor(() => expect(container.querySelectorAll('button[data-network-option]').length).toBe(0));
        expect(networkRow(container)).toBeTruthy();
    });

    it('shows the failure and stays on the page when the switch is refused', async () => {
        const onActiveNetworkChange = vi.fn().mockRejectedValue(new Error('boom'));
        const { container } = await openPage(harness(), { onActiveNetworkChange });
        fireEvent.click(option(container, 'Testnet'));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Switch network' }));
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(container.querySelectorAll('button[data-network-option]').length).toBe(3);
    });
});
