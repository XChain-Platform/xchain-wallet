// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings Network and Fees pages (operator walk 2026-11-15):
// - the Network page's rows are the Settings landing's list rows in the
//   landing's list card (dividers edge to edge, chevron at the row inset);
// - the Fees list has no "Active networks" heading;
// - a coin's fee page holds no card and no second coin label: the fee-bump
//   switch first, then the Fee strategy dropdown field, then the custom rate
//   only when Custom is chosen, with no description lines under the fields.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings = createDefaultSettings();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, unsupportedFiatCurrency: null, update: vi.fn().mockResolvedValue(settings) }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: { setActiveNetwork: vi.fn() } }),
}));

const { NetworkEnvironmentPage } = await import('../../../packages/core/src/shared/routes/SettingsInlineRows.jsx');
const { FeesNetworkPage, feesNetworkSectionFor } = await import(
    '../../../packages/core/src/shared/components/settings/FeesSection.jsx'
);
const { FeesHarness } = await import('../components/networkRowHarness.jsx');

function feeSettings(strategy = 'normal') {
    return {
        ...createDefaultSettings(),
        activeNetwork: 'mainnet',
        fees: {
            'bitcoin-mainnet': { strategy, rbfByDefault: true, customSatsPerKb: strategy === 'custom' ? 5000 : null },
            'litecoin-mainnet': { strategy: 'normal', rbfByDefault: null, customSatsPerKb: null },
            'dogecoin-mainnet': { strategy: 'normal', rbfByDefault: null, customSatsPerKb: null },
        },
    };
}

afterEach(() => {
    cleanup();
    settings = createDefaultSettings();
});

/** True when `a` comes before `b` in document order. */
function before(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('Network page rows', () => {
    it('draws Mainnet and Testnet as landing list rows in one edge-to-edge list card', () => {
        settings = { ...createDefaultSettings(), activeNetwork: 'mainnet', developerMode: false };
        const { container } = render(<NetworkEnvironmentPage activeWallet={{ id: 'w1' }} />);
        const list = container.querySelector('ul[data-network-environment-list]');
        expect(list).not.toBeNull();
        // The landing's list surface, set inline so the nested-card rule cannot strip it.
        expect(list.style.border).toBe('1px solid var(--xc-border)');
        expect(list.style.borderRadius).toBe('var(--xc-radius-md)');
        expect(list.style.overflow).toBe('hidden');
        // The list card is the page's first box: nothing wraps it in a second card.
        expect(list.parentElement).toBe(container);
        const rows = [...list.children];
        expect(rows.map((li) => li.tagName)).toEqual(['LI', 'LI']);
        for (const li of rows) {
            // Each row is the row button itself, filling its li edge to edge.
            const button = li.querySelector(':scope > button[data-network-option]');
            expect(button).not.toBeNull();
            expect(li.children).toHaveLength(1);
            // The chevron is the row's last box (the standard ListRow chevron).
            const chevron = button.lastElementChild;
            expect(chevron.getAttribute('aria-hidden')).toBe('true');
            expect(chevron.querySelector('svg')).not.toBeNull();
        }
        const options = rows.map((li) => li.querySelector('button'));
        expect(options.map((b) => b.getAttribute('aria-label'))).toEqual(['Select Mainnet', 'Select Testnet']);
        expect(options.map((b) => b.getAttribute('aria-current'))).toEqual(['true', null]);
        expect(options[0].querySelector('[data-network-description]').textContent).toBe('Real funds');
    });

    it('moves between rows with the arrow keys', () => {
        settings = { ...createDefaultSettings(), activeNetwork: 'mainnet', developerMode: true };
        const { container } = render(<NetworkEnvironmentPage activeWallet={{ id: 'w1' }} />);
        const list = container.querySelector('ul[data-network-environment-list]');
        const options = [...list.querySelectorAll('button[data-network-option]')];
        expect(options).toHaveLength(3);
        options[0].focus();
        fireEvent.keyDown(options[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(options[1]);
        fireEvent.keyDown(options[1], { key: 'End' });
        expect(document.activeElement).toBe(options[2]);
    });
});

describe('Fees list', () => {
    it('lists the networks with their speeds and no Active networks heading', async () => {
        settings = feeSettings();
        render(<FeesHarness />);
        const list = await screen.findByRole('list', { name: 'Active networks' });
        expect(screen.queryByText('Active networks')).toBeNull();
        expect(within(list).getByText('Bitcoin')).toBeTruthy();
        expect(within(list).getByText('Litecoin')).toBeTruthy();
        expect(within(list).getByText('Dogecoin')).toBeTruthy();
        expect(within(list).getAllByText('Normal speed')).toHaveLength(3);
    });
});

describe('Coin fee page', () => {
    it('shows the fee-bump switch first, then the Fee strategy field, with no card and no second coin label', () => {
        settings = feeSettings();
        const { container } = render(<FeesNetworkPage chainId="bitcoin-mainnet" />);
        const page = container.querySelector('[data-fee-page="bitcoin-mainnet"]');
        expect(page).not.toBeNull();
        // No card: no border, fill, inset divider or padding on the page box.
        expect(page.style.border).toBe('');
        expect(page.style.background).toBe('');
        expect(page.style.boxShadow).toBe('');
        expect(page.style.padding).toBe('');
        // The title bar names the coin; the page does not repeat it.
        expect(page.textContent).not.toContain('Bitcoin');
        const toggle = screen.getByRole('switch', { name: 'Bitcoin allow fee bump (Replace-by-Fee)' });
        const strategy = page.querySelector('[aria-label="Bitcoin fee strategy"]');
        expect(before(toggle, strategy)).toBe(true);
        // The standard dropdown field: its label sits on its own line above it.
        expect(within(page).getByText('Fee strategy')).toBeTruthy();
        // No description lines under the fields; the help lives in the '?' tips.
        expect(page.textContent).not.toMatch(/Keep this on so you can raise the fee/);
        expect(screen.getByRole('button', { name: /About Allow fee bump/i })).toBeTruthy();
        expect(toggle.getAttribute('aria-describedby')).toBeNull();
        expect(screen.getByRole('button', { name: /About Fee strategy/i })).toBeTruthy();
        // Two items only while the strategy is not Custom.
        expect(screen.queryByRole('textbox', { name: /custom fee rate/i })).toBeNull();
        expect(page.querySelectorAll('[data-settings-row]')).toHaveLength(0);
    });

    it('shows the custom fee field under Fee strategy when Custom is chosen', () => {
        settings = feeSettings('custom');
        const { container } = render(<FeesNetworkPage chainId="bitcoin-mainnet" />);
        const page = container.querySelector('[data-fee-page="bitcoin-mainnet"]');
        const strategy = page.querySelector('[aria-label="Bitcoin fee strategy"]');
        const custom = screen.getByRole('textbox', { name: 'Bitcoin custom fee rate' });
        expect(page.contains(custom)).toBe(true);
        expect(before(strategy, custom)).toBe(true);
        expect(within(page).getByText('Custom fee rate')).toBeTruthy();
        // The unit note lives in the field's tip, not as a hint line under it.
        expect(String(custom.getAttribute('aria-describedby') || '')).not.toMatch(/-hint/);
        expect(page.querySelector('[id$="-hint"]')).toBeNull();
    });

    it('keeps a network with no fee bump explained in its tip, not under the switch', () => {
        settings = feeSettings();
        const { container } = render(<FeesNetworkPage chainId="dogecoin-mainnet" />);
        const page = container.querySelector('[data-fee-page="dogecoin-mainnet"]');
        const toggle = screen.getByRole('switch', { name: 'Dogecoin allow fee bump (Replace-by-Fee)' });
        expect(toggle.disabled).toBe(true);
        // No description line under the switch; the reason is in the tip.
        expect(toggle.getAttribute('aria-describedby')).toBeNull();
        const tip = screen.getByRole('button', { name: /About Allow fee bump/i });
        fireEvent.click(tip);
        return waitFor(() => expect(tip.parentElement.textContent).toMatch(/Fee bumping isn't supported on this network\./)).then(() => {
            expect(page.contains(tip)).toBe(true);
        });
    });

    it('uses the shared responsive form frame', () => {
        expect(feesNetworkSectionFor('fees-network:bitcoin-mainnet')).toMatchObject({ formFrame: true, title: 'Bitcoin' });
    });
});
