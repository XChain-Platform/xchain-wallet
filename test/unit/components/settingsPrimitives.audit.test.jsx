// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { selectOption } from '../../helpers/selectOption.js';

let settings;
let update;
let messaging;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({
    LogConsole: () => <div>Log output</div>,
}));

const { ToggleRow } = await import(
    '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx'
);
const { DisplaySection } = await import(
    '../../../packages/core/src/shared/components/settings/DisplaySection.jsx'
);
const { LanguageRegionSection } = await import(
    '../../../packages/core/src/shared/components/settings/LanguageRegionSection.jsx'
);
const { AppearanceSection } = await import(
    '../../../packages/core/src/shared/components/settings/AppearanceSection.jsx'
);
const { FeesHarness: FeesSection } = await import('./networkRowHarness.jsx');
const { DeveloperModeSection } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);
const { LayoutModeToggle } = await import(
    '../../../packages/core/src/shared/components/LayoutModeToggle.jsx'
);
const { TestNetworkPage, buildCustomDescriptor } = await import(
    '../../../packages/core/src/shared/components/settings/TestNetworksPages.jsx'
);
const { defaultRegistry } = await import('../../../packages/core/src/registry/index.js');

function describedText(control) {
    const id = control.getAttribute('aria-describedby');
    return id ? document.getElementById(id)?.textContent : null;
}

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
    messaging = {
        listWallets: vi.fn(async () => [{ id: 'wallet-1' }]),
        listCustomChains: vi.fn(async () => ({ descriptors: [] })),
    };
});

afterEach(() => {
    cleanup();
    delete globalThis.chrome;
});

describe('shared settings row semantics', () => {
    it('wraps the currency and threshold controls before their label copy is squeezed', () => {
        render(<LanguageRegionSection />);
        const currencyCopy = screen.getByText('Fiat currency').parentElement;
        expect(currencyCopy.parentElement.style.flexWrap).toBe('wrap');
        expect(currencyCopy.style.flex).toBe('1 1 280px');
        expect(currencyCopy.style.minWidth).toBe('min(100%, 280px)');

        cleanup();
        render(<DisplaySection />);
        const thresholdCopy = screen.getByText('Small-balance threshold').parentElement;
        // The threshold row is a grid that collapses to one column on phones
        // (Settings widths ruling), so the wrap guarantee lives in the CSS module.
        expect(thresholdCopy.parentElement.style.display).toBe('grid');
        const displayCss = readFileSync(
            'packages/core/src/shared/components/settings/DisplaySection.module.css',
            'utf8',
        );
        expect(displayCss).toMatch(/@media \(max-width: 640px\)\s*\{[^}]*\.fieldRow[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(thresholdCopy.style.flex).toBe('1 1 280px');
        expect(thresholdCopy.style.minWidth).toBe('min(100%, 280px)');
    });

    it('pairs a toggle label and description with its checked state', () => {
        const onChange = vi.fn();
        render(
            <ToggleRow
                label="Protect previews"
                hint="Requires confirmation before opening a preview."
                checked
                onChange={onChange}
            />,
        );

        const toggle = screen.getByRole('switch', { name: 'Protect previews' });
        expect(toggle.checked).toBe(true);
        expect(describedText(toggle)).toBe('Requires confirmation before opening a preview.');
        expect(toggle).toHaveAttribute('type', 'checkbox');
        expect(toggle.className).toMatch(/input/);
        expect(toggle.closest('label')).toHaveTextContent('Protect previews');

        fireEvent.click(screen.getByText('Protect previews'));
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it('names a toggle with a help tip by its label alone, even with the tip open', () => {
        render(
            <ToggleRow
                label="Show pin button on rows"
                help="A star pins or unpins the token on Home."
                checked={false}
                onChange={() => {}}
            />,
        );

        const tip = screen.getByRole('button', { name: 'About Show pin button on rows' });
        expect(screen.getByRole('switch', { name: 'Show pin button on rows' })).toBeTruthy();
        fireEvent.click(tip);
        expect(screen.getByRole('switch', { name: 'Show pin button on rows' })).toBeTruthy();
    });

    it('gives appearance controls visible labels without repeating them in a description', () => {
        render(<AppearanceSection />);

        const theme = screen.getByRole('combobox', { name: 'Theme' });
        const motion = screen.getByRole('combobox', { name: 'Reduced motion' });
        expect(describedText(theme) ?? '').not.toMatch(/follow your device setting/i);
        expect(describedText(motion) ?? '').not.toMatch(/device accessibility setting/i);
        // The control sits in the row's end slot; the row itself wraps.
        expect(theme.closest('[data-settings-control]').parentElement.style.flexWrap).toBe('wrap');
        expect(motion.closest('[data-settings-control]').parentElement.style.flexWrap).toBe('wrap');
    });

    it('keeps the saved appearance value and reports a failed update', async () => {
        update = vi.fn(async () => {
            throw new Error('appearance.save: E_STORAGE_WRITE');
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<AppearanceSection />);

        const theme = screen.getByRole('combobox', { name: 'Theme' });
        selectOption(theme, 'dark');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not save appearance settings. Try again.',
        );
        await waitFor(() => expect(theme).toHaveValue('system'));
        consoleError.mockRestore();
    });

    it('disambiguates fee controls by network and connects validation errors', () => {
        settings = {
            ...createDefaultSettings(),
            fees: {
                'bitcoin-mainnet': {
                    strategy: 'custom',
                    customSatsPerKb: 6000,
                    rbfByDefault: true,
                },
            },
        };
        render(<FeesSection />);
        fireEvent.click(document.querySelector('[data-network-row="bitcoin-mainnet"] button'));

        const strategy = screen.getByRole('combobox', { name: 'Bitcoin fee strategy' });
        const rate = screen.getByRole('textbox', { name: 'Bitcoin custom fee rate' });
        const bump = screen.getByRole('switch', {
            name: 'Bitcoin allow fee bump (Replace-by-Fee)',
        });
        // No description lines under the fields (operator walk 2026-11-15):
        // the rate's unit and the fee-bump explanation live in the '?' tips.
        expect(describedText(strategy)).toBeNull();
        expect(describedText(rate)).toBeNull();
        expect(describedText(bump)).toBeNull();
        expect(screen.getByRole('button', { name: /About Custom fee rate/ }).parentElement.textContent).toContain('sat/vB');
        expect(screen.getByRole('button', { name: /About Allow fee bump/ }).parentElement.textContent).toMatch(/raised later/i);
        expect(bump.checked).toBe(true);
        expect(bump).toHaveAttribute(
            'aria-label',
            'Bitcoin allow fee bump (Replace-by-Fee)',
        );

        fireEvent.change(rate, { target: { value: '' } });
        fireEvent.blur(rate);
        expect(rate.getAttribute('aria-invalid')).toBe('true');
        // The standard field's own error line under it, tied to the input.
        expect(describedText(rate)).toMatch(/fee rate/i);
    });
});

describe('settings actions and mode choices', () => {
    // A Remove row is never red (ruling 2026-11-14): a custom network's
    // Remove network is a plain action row on its own page.
    it('draws custom network removal as a plain action row, never red', async () => {
        settings = { ...createDefaultSettings(), developerMode: true };
        const registry = defaultRegistry();
        const descriptor = buildCustomDescriptor(registry.get('bitcoin-regtest'), {
            name: 'Fork Regtest',
            id: 'audit-fork-regtest',
            explorer: { defaultUrl: 'http://localhost', defaultPort: 18090 },
            encoder: { defaultUrl: 'http://localhost', defaultPort: 3033 },
        });
        registry.addCustom(descriptor);
        try {
            render(<TestNetworkPage chainId="audit-fork-regtest" activeWallet={{ id: 'wallet-1' }} />);
            const remove = await screen.findByRole('button', { name: /^Remove network/ });
            expect(remove.className).not.toMatch(/danger/);
            expect(remove.getAttribute('data-tone')).toBe('default');
        } finally {
            registry.removeCustom('audit-fork-regtest');
        }
    });

    it('names and describes the extension layout choice and exposes radio state', async () => {
        const set = vi.fn();
        globalThis.chrome = {
            sidePanel: {},
            storage: {
                local: {
                    get: vi.fn((_key, callback) => callback({ 'xchain.layoutMode': 'popup' })),
                    set,
                },
                onChanged: {
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                },
            },
        };
        render(<LayoutModeToggle />);

        const group = await screen.findByRole('radiogroup', { name: 'Open as' });
        const popup = screen.getByRole('radio', { name: 'Popup' });
        const sidebar = screen.getByRole('radio', { name: 'Sidebar' });
        expect(describedText(group)).toMatch(/extension toolbar/i);
        expect(popup.getAttribute('aria-checked')).toBe('true');
        expect(sidebar.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(sidebar);
        expect(sidebar.getAttribute('aria-checked')).toBe('true');
        expect(set).toHaveBeenCalledWith({ 'xchain.layoutMode': 'sidepanel' });
    });
});
