// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: { sendHoldCancel: vi.fn() } }),
}));
vi.mock('../../../packages/core/src/shared/components/settings/BiometricRow.jsx', () => ({ BiometricRow: () => null }));
vi.mock('../../../packages/core/src/shared/components/settings/PanicModeRow.jsx', () => ({ PanicModeRow: () => null }));
vi.mock('../../../packages/core/src/shared/components/settings/DuressPassphraseRow.jsx', () => ({ DuressPassphraseRow: () => null }));
vi.mock('../../../packages/core/src/shared/components/settings/UndoSendRow.jsx', () => ({ UndoSendRow: () => null }));

const { LanguageRegionSection } = await import(
    '../../../packages/core/src/shared/components/settings/LanguageRegionSection.jsx'
);
const { SafetySection } = await import(
    '../../../packages/core/src/shared/components/settings/SafetySection.jsx'
);
const { FeesSection } = await import(
    '../../../packages/core/src/shared/components/settings/FeesSection.jsx'
);
const { ToggleRow } = await import(
    '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx'
);
const { WalletModeSection } = await import(
    '../../../packages/core/src/shared/components/settings/WalletModeSection.jsx'
);

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
});

afterEach(() => cleanup());

describe('settings form validation', () => {
    it('searches supported currencies by code and name, shows symbols, and saves the choice', () => {
        render(<LanguageRegionSection />);
        const picker = screen.getByLabelText('Fiat currency');

        fireEvent.focus(picker);
        fireEvent.change(picker, { target: { value: 'yen' } });
        expect(screen.getByRole('option', { name: /Japanese Yen \(JPY\).*¥/ })).toBeTruthy();
        expect(screen.queryByRole('option', { name: /US Dollar/ })).toBeNull();

        fireEvent.change(picker, { target: { value: 'EUR' } });
        const euro = screen.getByRole('option', { name: /Euro \(EUR\).*€/ });
        fireEvent.click(euro);

        expect(update).toHaveBeenCalledWith({ fiatCurrency: 'EUR' });

        fireEvent.focus(picker);
        fireEvent.change(picker, { target: { value: 'XYZ' } });
        expect(within(screen.getByRole('listbox', { name: 'Supported fiat currencies' }))
            .queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('No supported currencies match.')).toBeTruthy();
    });

    it('does not turn an empty test-send threshold into zero', () => {
        render(<SafetySection />);
        const input = screen.getByLabelText('Test-send warning threshold (sats)');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);

        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText(/whole number of sats/)).toBeTruthy();
        expect(screen.queryByRole('switch', { name: 'Auto-arm panic mode' })).toBeNull();
    });

    it('saves the test-send threshold as an exact normalized integer string', () => {
        render(<SafetySection />);
        const input = screen.getByLabelText('Test-send warning threshold (sats)');
        fireEvent.change(input, { target: { value: '009007199254740993' } });
        fireEvent.blur(input);

        expect(update).toHaveBeenCalledWith({
            grace: { testSendThresholdSats: '9007199254740993' },
        });
    });

    it('explains the exact test-send gate and always-on recipient warnings', () => {
        render(<SafetySection />);

        const input = screen.getByLabelText('Test-send warning threshold (sats)');
        const hint = document.getElementById(input.getAttribute('aria-describedby'));
        expect(hint.textContent).toMatch(/native-coin sends above this amount/i);
        expect(hint.textContent).toMatch(/outside your contacts and send history/i);
        expect(hint.textContent).toMatch(/0 to turn this warning off/i);
        expect(screen.getByText('Lookalike address warnings')).toBeTruthy();
        expect(screen.getByText(/closely resembles a contact or a previous recipient/i)).toBeTruthy();
        expect(screen.getByText('Always on')).toBeTruthy();
    });

    it('does not offer a backup cadence that the reminder engine ignores', () => {
        render(<SafetySection />);

        expect(screen.queryByLabelText('Backup reminders')).toBeNull();
        expect(screen.getByText(/shown automatically for wallets without a verified recovery phrase/i))
            .toBeTruthy();
        expect(screen.getByText('Automatic')).toBeTruthy();
    });

    it('does not save an empty custom fee rate as zero', () => {
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
        const input = screen.getByLabelText('Bitcoin custom fee rate');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);

        expect(update).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toMatch(/non-negative custom fee rate/);
    });

    it('allows shared settings rows to wrap on narrow screens', () => {
        const { container } = render(
            <ToggleRow label="Long setting" checked={false} onChange={() => {}} />,
        );
        expect(container.firstElementChild.style.flexWrap).toBe('wrap');
    });

    it('explains and confirms a wallet mode change before persisting it', async () => {
        const { container } = render(<WalletModeSection />);

        fireEvent.click(screen.getByRole('radio', { name: /Watcher/ }));

        expect(update).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog').textContent).toContain(
            'Transaction actions produce unsigned PSBTs',
        );
        expect(container.querySelector('input[type="password"]')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm mode change' }));

        expect(update).toHaveBeenCalledWith({ walletMode: 'watcher' });
    });

    it('cancels a pending wallet mode change without persisting it', () => {
        render(<WalletModeSection />);
        fireEvent.click(screen.getByRole('radio', { name: /Signer/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(update).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.getByRole('radio', { name: /Normal/ }).checked).toBe(true);
    });
});
