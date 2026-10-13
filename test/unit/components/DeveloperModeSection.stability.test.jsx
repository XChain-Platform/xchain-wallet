// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let messaging;
let settings;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({ LogConsole: () => null }));

const { DeveloperModeSection, RegtestRow } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);

beforeEach(() => {
    settings = {
        ...createDefaultSettings(),
        developerMode: true,
        fees: {
            'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        },
    };
    messaging = {
        listWallets: vi.fn(async () => [{ id: 'wallet-1' }]),
        listCustomChains: vi.fn(async () => ({ descriptors: [] })),
        getNewestAddress: vi.fn(async () => ({ address: 'bcrt1qtest' })),
    };
});

afterEach(() => cleanup());

describe('DeveloperModeSection unavailable actions', () => {
    it('does not render the unimplemented Raw PSBT control', () => {
        render(<DeveloperModeSection />);
        expect(screen.queryByRole('switch', { name: 'Raw PSBT inspector' })).toBeNull();
        expect(screen.queryByText(/Coming soon/)).toBeNull();
    });

    it('hides the mint handoff when the route callback is unavailable', () => {
        render(<DeveloperModeSection />);
        expect(screen.queryByRole('button', { name: 'Mint test XCHAIN' })).toBeNull();
    });

    it('rejects an empty faucet amount before requesting an address', () => {
        render(<DeveloperModeSection />);
        const input = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Get test BTC' }));

        expect(screen.getByText('Enter an amount of BTC greater than 0.')).toBeTruthy();
        expect(messaging.getNewestAddress).not.toHaveBeenCalled();
    });

    it('exposes the adopted style guide fields and actions by role', async () => {
        render(<DeveloperModeSection />);

        expect(screen.getByRole('combobox', {
            name: 'Cache password for localhost auto-sign',
        })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Miner URL' })).toBeTruthy();

        fireEvent.click(await screen.findByRole('button', { name: 'Add custom chain…' }));

        expect(screen.getByRole('textbox', {
            name: 'Custom chain descriptor JSON',
        })).toBeTruthy();
        expect(screen.getByRole('button', {
            name: 'Paste custom chain descriptor',
        })).toBeTruthy();
    });

    it('explains when a wallet cannot be loaded for activation', async () => {
        messaging.listWallets = vi.fn(async () => { throw new Error('offline'); });
        render(
            <RegtestRow
                descriptor={{ id: 'bitcoin-regtest', displayName: 'Bitcoin Regtest' }}
                isActive={false}
                disabled={false}
            />,
        );

        expect(await screen.findByText('Could not load a wallet for network activation.')).toBeTruthy();
    });
});
