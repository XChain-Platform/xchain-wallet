// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

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
const { FeesSection } = await import(
    '../../../packages/core/src/shared/components/settings/FeesSection.jsx'
);
const { DeveloperModeSection } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);
const { LayoutModeToggle } = await import(
    '../../../packages/core/src/shared/components/LayoutModeToggle.jsx'
);

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
        expect(thresholdCopy.parentElement.style.flexWrap).toBe('wrap');
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
        expect(toggle.style.appearance).toBe('none');
        expect(toggle.style.borderRadius).toBe('999px');
        expect(toggle.style.backgroundColor).toBe('var(--xc-accent-primary)');

        fireEvent.click(screen.getByText('Protect previews'));
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it('gives appearance controls visible labels and linked descriptions', () => {
        render(<AppearanceSection />);

        const theme = screen.getByRole('combobox', { name: 'Theme' });
        const motion = screen.getByRole('combobox', { name: 'Reduced motion' });
        expect(describedText(theme)).toMatch(/follow your device setting/i);
        expect(describedText(motion)).toMatch(/device accessibility setting/i);
        expect(theme.closest('div').style.flexWrap).toBe('wrap');
        expect(motion.closest('div').style.flexWrap).toBe('wrap');
    });

    it('keeps the saved appearance value and reports a failed update', async () => {
        update = vi.fn(async () => {
            throw new Error('appearance.save: E_STORAGE_WRITE');
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<AppearanceSection />);

        const theme = screen.getByRole('combobox', { name: 'Theme' });
        fireEvent.change(theme, { target: { value: 'dark' } });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not save appearance settings. Try again.',
        );
        await waitFor(() => expect(theme).toHaveValue('system'));
        consoleError.mockRestore();
    });

    it('disambiguates fee controls by chain and connects validation errors', () => {
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

        const strategy = screen.getByRole('combobox', { name: 'Bitcoin fee strategy' });
        const rate = screen.getByRole('textbox', { name: 'Bitcoin custom fee rate' });
        const bump = screen.getByRole('switch', {
            name: 'Bitcoin allow fee bump (Replace-by-Fee)',
        });
        expect(describedText(strategy)).toMatch(/confirmation speed/i);
        expect(describedText(rate)).toContain('sat/vB');
        expect(describedText(bump)).toMatch(/raise the fee later/i);
        expect(bump.checked).toBe(true);

        fireEvent.change(rate, { target: { value: '' } });
        fireEvent.blur(rate);
        expect(rate.getAttribute('aria-invalid')).toBe('true');
        expect(rate.getAttribute('aria-errormessage')).toBeTruthy();
    });
});

describe('settings actions and mode choices', () => {
    it('styles custom-chain removal as a danger action', async () => {
        settings = { ...createDefaultSettings(), developerMode: true };
        messaging.listCustomChains = vi.fn(async () => ({
            descriptors: [{ id: 'fork-regtest', displayName: 'Fork Regtest', networkKind: 'regtest' }],
        }));
        render(<DeveloperModeSection />);

        const remove = await screen.findByRole('button', { name: 'Remove custom chain fork-regtest' });
        expect(remove.className).toMatch(/danger/);
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
