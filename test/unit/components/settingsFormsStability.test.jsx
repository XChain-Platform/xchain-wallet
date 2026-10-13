// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
});

afterEach(() => cleanup());

describe('settings form validation', () => {
    it('opens and saves the custom currency field', () => {
        render(<LanguageRegionSection />);
        fireEvent.change(screen.getByLabelText('Fiat currency'), { target: { value: '__custom__' } });

        const input = screen.getByLabelText('Custom currency code');
        fireEvent.change(input, { target: { value: 'nzd' } });
        fireEvent.blur(input);

        expect(update).toHaveBeenCalledWith({ fiatCurrency: 'NZD' });
    });

    it('rejects malformed custom currency codes with visible feedback', () => {
        render(<LanguageRegionSection />);
        fireEvent.change(screen.getByLabelText('Fiat currency'), { target: { value: '__custom__' } });
        const input = screen.getByLabelText('Custom currency code');
        fireEvent.change(input, { target: { value: 'US' } });
        fireEvent.blur(input);

        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText(/three-letter ISO currency code/)).toBeTruthy();
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
});
