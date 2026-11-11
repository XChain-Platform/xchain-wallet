// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U57 on the Language & region and Network panels and the Fees subpage:
// each field label carries its own '?' tip, the static fiat line is gone,
// and the Fees fee-bump line never repeats the chain named by its group
// heading (U12).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings = createDefaultSettings();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, unsupportedFiatCurrency: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: { setActiveNetwork: vi.fn() } }),
}));

const { LanguageRegionSection } = await import(
    '../../../packages/core/src/shared/components/settings/LanguageRegionSection.jsx'
);
const { NetworkSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkSection.jsx'
);
const { FeesSection } = await import(
    '../../../packages/core/src/shared/components/settings/FeesSection.jsx'
);

afterEach(() => {
    cleanup();
    settings = createDefaultSettings();
});

function openTip(name) {
    const trigger = screen.getByRole('button', { name });
    fireEvent.click(trigger);
    return trigger.closest('span').parentElement;
}

describe('Language & region tips (U57)', () => {
    it('puts a written tip on the Language and Fiat currency labels', () => {
        render(<LanguageRegionSection />);
        expect(within(openTip('About the language setting')).getByText(/language the wallet uses/)).toBeTruthy();
        expect(within(openTip('About the fiat currency setting')).getByText(/never the coins or tokens you hold/)).toBeTruthy();
    });

    it('drops the static fiat line from under the field', () => {
        render(<LanguageRegionSection />);
        expect(screen.queryByText('Changes estimates, not asset balances.')).toBeNull();
    });
});

describe('Network panel tip (U57)', () => {
    it('puts a written tip on the Network label and keeps the mode select', () => {
        settings = { ...createDefaultSettings(), activeNetwork: 'mainnet', developerMode: false };
        render(<NetworkSection activeWallet={{ id: 'w1' }} />);
        expect(within(openTip('About the network setting')).getByText(/Mainnet uses real funds/)).toBeTruthy();
        expect(screen.getByLabelText('Active network').tagName).toBe('SELECT');
    });
});

describe('Fees fee-bump line (U12)', () => {
    it('never names the chain in the unsupported fee-bump line', () => {
        settings = {
            ...createDefaultSettings(),
            fees: {
                'bitcoin-mainnet': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
                'dogecoin-mainnet': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: false },
            },
        };
        render(<FeesSection />);
        expect(screen.getByText('Dogecoin')).toBeTruthy();
        const lines = screen.queryAllByText(/Fee bumping isn't supported/);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.textContent).toBe("Fee bumping isn't supported on this network.");
            expect(line.textContent).not.toMatch(/Dogecoin|Bitcoin|Litecoin/);
        }
    });
});
