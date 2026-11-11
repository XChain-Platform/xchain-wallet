// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

let messaging;
let settings;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({ LogConsole: () => null }));
vi.mock('../../../packages/core/src/flows/regtestFaucet.js', () => ({
    fundActiveWalletFromMiner: vi.fn(async () => ({ ok: true, txid: 'txid', address: 'bcrt1qtest' })),
}));

const { DeveloperModeSection } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);

function expectEveryActionButtonToHaveAnIcon() {
    const buttons = Array.from(document.querySelectorAll(`button.${buttonStyles.btn}`))
        .filter((button) => !button.getAttribute('aria-label')?.startsWith('About '));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
        expect(button.querySelector('svg'), button.getAttribute('aria-label') || button.textContent)
            .not.toBeNull();
    }
}

beforeEach(() => {
    settings = {
        ...createDefaultSettings(),
        developerMode: false,
        fees: {
            'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        },
    };
    messaging = {
        listCustomChains: vi.fn(async () => ({
            descriptors: [{
                id: 'my-fork-regtest',
                displayName: 'My Fork',
                networkKind: 'regtest',
            }],
        })),
    };
});

afterEach(() => cleanup());

describe('DeveloperModeSection U57 and U63 controls', () => {
    it('keeps the developer-off tool buttons icon-bearing', () => {
        render(<DeveloperModeSection />);

        expect(screen.queryByText('Regtest faucet')).toBeNull();
        expectEveryActionButtonToHaveAnIcon();
    });

    it('uses named success actions and icons throughout the developer-on forms', async () => {
        settings = { ...settings, developerMode: true };
        render(<DeveloperModeSection onNavigateToMint={() => {}} />);

        const faucetAction = screen.getByRole('button', { name: 'Get test BTC' });
        expect(faucetAction).toHaveClass(buttonStyles.success);
        expect(faucetAction.querySelector('svg')).not.toBeNull();
        expectEveryActionButtonToHaveAnIcon();

        fireEvent.click(screen.getAllByRole('button', { name: 'Activate…' })[0]);
        const activationAction = screen.getByRole('button', { name: /^Activate / });
        expect(activationAction).toHaveClass(buttonStyles.success);
        expect(activationAction.textContent).not.toBe('Activate');
        expectEveryActionButtonToHaveAnIcon();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Add custom network…' }));
        const addAction = screen.getByRole('button', { name: 'Add network' });
        expect(addAction).toHaveClass(buttonStyles.success);
        expectEveryActionButtonToHaveAnIcon();
    });

    it('puts field-specific help tips on directly rendered form fields', async () => {
        settings = { ...settings, developerMode: true };
        render(<DeveloperModeSection />);

        expect(screen.getByRole('button', { name: 'About Miner URL' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Amount (BTC)' })).toBeTruthy();

        fireEvent.click(screen.getAllByRole('button', { name: 'Activate…' })[0]);
        expect(screen.getByRole('button', { name: /About .* activation password/ })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Add custom network…' }));
        expect(screen.getByRole('button', {
            name: 'About Custom network descriptor JSON',
        })).toBeTruthy();
    });

    it('adds token spacing around phone-width tool actions', () => {
        const component = readFileSync(
            'packages/core/src/shared/components/settings/DeveloperModeSection.jsx',
            'utf8',
        );
        const css = readFileSync(
            'packages/core/src/shared/components/settings/DeveloperModeSection.module.css',
            'utf8',
        );

        expect(component.match(/className=\{styles\.toolAction\}/g)).toHaveLength(2);
        expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*\.toolAction[\s\S]*margin-block:\s*var\(--xc-space-1\)/);
    });
});
