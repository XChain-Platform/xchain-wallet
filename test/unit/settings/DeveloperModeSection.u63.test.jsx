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
const { AddNetworkPage, CustomNetworkFormPage, FaucetPage } = await import(
    '../../../packages/core/src/shared/components/settings/TestNetworksPages.jsx'
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
    it('opens each developer-off tool from a drill-in row with the chevron, not a grey button', () => {
        const onNavigateToAdvanced = vi.fn();
        render(<DeveloperModeSection onNavigateToAdvanced={onNavigateToAdvanced} onNavigateToActionQueue={() => {}} />);

        expect(screen.queryByText('Regtest faucet')).toBeNull();
        const row = screen.getByRole('button', { name: 'Open Advanced action' });
        expect(row).not.toHaveClass(buttonStyles.btn);
        expect(row.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Open Action queue' })).toBeTruthy();
        fireEvent.click(row);
        expect(onNavigateToAdvanced).toHaveBeenCalledOnce();
    });

    it('leaves the tool rows to the Advanced page when asked', () => {
        render(<DeveloperModeSection tools={false} onNavigateToAdvanced={() => {}} onNavigateToActionQueue={() => {}} />);
        expect(screen.queryByRole('button', { name: /Advanced action/ })).toBeNull();
    });

    // The regtest faucet, activation and custom networks moved to the Test
    // Networks pages (operator picks 2026-11-14); their actions keep the named
    // green action with its icon.
    it('uses named success actions and icons throughout the Test Networks forms', async () => {
        settings = { ...settings, developerMode: true };
        const view = render(<FaucetPage activeWallet={{ id: 'wallet-1' }} activeAccount={{ id: 'account-1' }} onNavigateToMint={() => {}} />);
        const faucetAction = screen.getByRole('button', { name: 'Get Test Coins' });
        expect(faucetAction).toHaveClass(buttonStyles.success);
        expect(faucetAction.querySelector('svg')).not.toBeNull();
        expectEveryActionButtonToHaveAnIcon();
        view.unmount();

        const picker = render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} />);
        fireEvent.click(screen.getAllByRole('button', { name: /Activate with your password/ })[0]);
        const activationAction = screen.getByRole('button', { name: 'Activate Network' });
        expect(activationAction).toHaveClass(buttonStyles.success);
        expect(activationAction.querySelector('svg')).not.toBeNull();
        expectEveryActionButtonToHaveAnIcon();
        picker.unmount();

        render(<CustomNetworkFormPage />);
        const addAction = screen.getByRole('button', { name: 'Add Network' });
        expect(addAction).toHaveClass(buttonStyles.success);
        expectEveryActionButtonToHaveAnIcon();
    });

    it('puts field-specific help tips on directly rendered form fields', async () => {
        settings = { ...settings, developerMode: true };
        const view = render(<FaucetPage activeWallet={{ id: 'wallet-1' }} activeAccount={{ id: 'account-1' }} />);
        expect(screen.getByRole('button', { name: 'About Amount (BTC)' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Miner/ }));
        expect(screen.getByRole('button', { name: 'About Miner URL' })).toBeTruthy();
        view.unmount();

        const picker = render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} />);
        fireEvent.click(screen.getAllByRole('button', { name: /Activate with your password/ })[0]);
        expect(screen.getByRole('button', { name: 'About Wallet password' })).toBeTruthy();
        picker.unmount();

        render(<CustomNetworkFormPage />);
        fireEvent.click(screen.getByRole('button', { name: /^Descriptor JSON/ }));
        expect(screen.getByRole('button', { name: 'About Descriptor JSON' })).toBeTruthy();
    });

    it('draws the tools as list rows, never the grey ghost button', () => {
        const component = readFileSync(
            'packages/core/src/shared/components/settings/DeveloperModeSection.jsx',
            'utf8',
        );

        expect(component).not.toMatch(/className=\{styles\.toolAction\}/);
        expect(component).not.toMatch(/variant="ghost"/);
        // Advanced action, Action queue and the log console page.
        expect(component.match(/<ListRow[\s\S]*?chevron/g)).toHaveLength(3);
    });

    it('opens the log console on its own page, never expanding it in place', () => {
        settings = { ...settings, developerMode: true };
        const onOpenLogs = vi.fn();
        render(<DeveloperModeSection onOpenLogs={onOpenLogs} />);

        expect(screen.queryByRole('button', { name: /^(Show|Hide)$/ })).toBeNull();
        expect(document.querySelector('[aria-controls="settings-log-console"]')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Logs and diagnostics console/ }));
        expect(onOpenLogs).toHaveBeenCalledOnce();
        expect(document.getElementById('settings-log-console')).toBeNull();
    });
});
