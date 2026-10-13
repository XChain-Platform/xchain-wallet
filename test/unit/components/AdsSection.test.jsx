// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { stepAdsAccumulator } from '../../../packages/core/src/flows/ads.js';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

const { AdsSection } = await import(
    '../../../packages/core/src/shared/components/settings/AdsSection.jsx'
);
const { AdsNotice } = await import(
    '../../../packages/core/src/shared/components/AdsNotice.jsx'
);

function bitcoinSettings({ enabled = true, accumulatedSats = 12_345 } = {}) {
    const seeded = seedSettingsForChains(
        createDefaultSettings(),
        defaultRegistry(),
        ['bitcoin-mainnet'],
    );
    return {
        ...seeded,
        ads: {
            ...seeded.ads,
            enabled,
            perChain: {
                ...seeded.ads.perChain,
                'bitcoin-mainnet': {
                    ...seeded.ads.perChain['bitcoin-mainnet'],
                    accumulatedSats,
                },
            },
        },
    };
}

beforeEach(() => {
    settings = bitcoinSettings();
    update = vi.fn(async () => settings);
});

afterEach(() => cleanup());

describe('Automatic Donation System settings', () => {
    it('aligns its explanation with onboarding and exposes amount, cadence, and pending total', () => {
        render(
            <>
                <AdsSection />
                <AdsNotice
                    onContinue={() => {}}
                    isFull={false}
                    headClass=""
                    titleClass=""
                    subtitleClass=""
                    actionsClass=""
                />
            </>,
        );

        expect(screen.getAllByText(/It sets aside a small amount when you send a transaction and sends it as one donation once it adds up/)).toHaveLength(2);
        expect(screen.getByLabelText('Bitcoin per-transaction amount').value).toBe('1000');
        expect(screen.getByLabelText('Bitcoin trigger threshold').value).toBe('25000');
        expect(screen.getByText(/About 25 outgoing transactions to reach the threshold, then sent with the next one/)).toBeTruthy();
        expect(screen.getByText('Pending donation').nextElementSibling.textContent)
            .toBe(`${(12_345).toLocaleString()} sats`);
    });

    it('writes the switch and both donation choices', () => {
        render(<AdsSection />);

        fireEvent.click(screen.getByRole('switch', { name: 'Automatic Donation System' }));
        const amount = screen.getByLabelText('Bitcoin per-transaction amount');
        fireEvent.change(amount, { target: { value: '2000' } });
        fireEvent.blur(amount);
        const threshold = screen.getByLabelText('Bitcoin trigger threshold');
        fireEvent.change(threshold, { target: { value: '50000' } });
        fireEvent.blur(threshold);

        expect(update).toHaveBeenNthCalledWith(1, { ads: { enabled: false } });
        expect(update).toHaveBeenNthCalledWith(2, {
            ads: { perChain: { 'bitcoin-mainnet': { perTxAmountSats: 2000 } } },
        });
        expect(update).toHaveBeenNthCalledWith(3, {
            ads: { perChain: { 'bitcoin-mainnet': { triggerAmountSats: 50000 } } },
        });
    });

    it('explains the threshold and makes the off state unambiguous', () => {
        settings = bitcoinSettings({ enabled: false });
        render(<AdsSection />);

        expect(screen.getByRole('switch', { name: 'Automatic Donation System' }).checked).toBe(false);
        expect(screen.getByText('Off. New outgoing transactions do not add to the pending donation total.')).toBeTruthy();
        expect(screen.getByLabelText('Bitcoin per-transaction amount').disabled).toBe(true);
        expect(screen.getByLabelText('Bitcoin trigger threshold').disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Trigger threshold help' }));
        expect(screen.getByRole('tooltip').textContent).toMatch(/included with the next outgoing transaction/);
    });

    it('does not set aside more after ADS is turned off', () => {
        const disabled = bitcoinSettings({ enabled: false });
        const next = stepAdsAccumulator(disabled, 'bitcoin-mainnet', {
            donationIncluded: false,
            chainRegistry: defaultRegistry(),
        });

        expect(next).toBe(disabled);
        expect(next.ads.perChain['bitcoin-mainnet'].accumulatedSats).toBe(12_345);
    });
});
