// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolveAdsPlanForNextTx, stepAdsAccumulator } from '../../../packages/core/src/flows/ads.js';
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

function bitcoinSettings({
    enabled = true,
    accumulatedSats = 12_345,
    chainId = 'bitcoin-mainnet',
} = {}) {
    const networkKind = defaultRegistry().get(chainId)?.networkKind || 'mainnet';
    const seeded = seedSettingsForChains(
        { ...createDefaultSettings(), activeNetwork: networkKind },
        defaultRegistry(),
        [chainId],
    );
    return {
        ...seeded,
        ads: {
            ...seeded.ads,
            enabled,
            perChain: {
                ...seeded.ads.perChain,
                [chainId]: {
                    ...seeded.ads.perChain[chainId],
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
                <AdsNotice onContinue={() => {}} />
            </>,
        );

        expect(screen.getAllByText(/It sets aside a small amount when you send a transaction and sends it as one donation once it adds up/)).toHaveLength(2);
        expect(screen.getByLabelText('Bitcoin per-transaction amount').value).toBe('1000');
        expect(screen.getByLabelText('Bitcoin trigger threshold').value).toBe('25000');
        expect(screen.getByText(/About 25 outgoing transactions to reach the threshold, then sent with the next one/)).toBeTruthy();
        expect(screen.getByText('Pending donation').nextElementSibling.textContent)
            .toBe(`${(12_345).toLocaleString()} sats`);
    });

    it('does not repeat the active network kind in its chain heading', () => {
        settings = bitcoinSettings({ chainId: 'bitcoin-testnet' });
        render(<AdsSection />);

        expect(screen.getByText('Bitcoin')).toBeTruthy();
        expect(screen.queryByText(/testnet/i)).toBeNull();
    });

    it('labels its switch as an action instead of repeating the page title', () => {
        render(<AdsSection />);

        const toggle = screen.getByRole('switch', { name: 'Turn on Automatic Donation System' });
        expect(toggle.closest('label')).toHaveTextContent(/^Turn on/);
        expect(screen.queryByText('Automatic Donation System')).toBeNull();
    });

    it('writes the switch and both donation choices', () => {
        render(<AdsSection />);

        fireEvent.click(screen.getByRole('switch', { name: 'Turn on Automatic Donation System' }));
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

    it('keeps amount fields stable on wheel input and rejects exponent notation', () => {
        render(<AdsSection />);

        const amount = screen.getByLabelText('Bitcoin per-transaction amount');
        const threshold = screen.getByLabelText('Bitcoin trigger threshold');
        expect(amount.type).toBe('text');
        expect(amount.inputMode).toBe('numeric');
        expect(amount).toHaveAttribute('enterkeyhint', 'done');
        expect(amount).toHaveAttribute('autocomplete', 'off');
        expect(threshold.type).toBe('text');
        expect(threshold.inputMode).toBe('numeric');
        expect(threshold).toHaveAttribute('enterkeyhint', 'done');
        expect(threshold).toHaveAttribute('autocomplete', 'off');

        fireEvent.wheel(amount, { deltaY: -100 });
        expect(amount.value).toBe('1000');

        fireEvent.change(amount, { target: { value: '1e3' } });
        fireEvent.blur(amount);
        expect(amount.value).toBe('1000');
        expect(update).not.toHaveBeenCalled();
    });

    it('states what the setting does once, in the toggle card, whether it is on or off', () => {
        for (const enabled of [true, false]) {
            settings = bitcoinSettings({ enabled });
            const { container, unmount } = render(<AdsSection />);
            expect(screen.getAllByText(/sets aside a small amount when you send a transaction/)).toHaveLength(1);
            expect(screen.queryByRole('status')).toBeNull();
            expect(container.textContent).not.toMatch(/New outgoing transactions/);
            unmount();
        }
    });

    it('explains the threshold and makes the off state unambiguous', () => {
        settings = bitcoinSettings({ enabled: false });
        render(<AdsSection />);

        expect(screen.getByRole('switch', { name: 'Turn on Automatic Donation System' }).checked).toBe(false);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/^(On|Off)\. New outgoing transactions/)).toBeNull();
        expect(screen.getByLabelText('Bitcoin per-transaction amount').disabled).toBe(true);
        expect(screen.getByLabelText('Bitcoin trigger threshold').disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Trigger threshold help' }));
        const tip = screen.getByRole('tooltip').textContent;
        expect(tip).toMatch(/A sat is the smallest unit/);
        expect(tip).toMatch(/one network fee/);
        expect(tip.match(/[.!?](?:\s|$)/g)).toHaveLength(2);
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

// The donation recipient picker: DONATE1, DONATE2 or DONATE3 per chain. DONATE3 is
// stored under the registry's own name for it, EXPLORER, because that is the only
// spelling the donation flow honours; a stored 'DONATE3' would silently send nothing.
describe('Automatic Donation System donation recipient', () => {
    const chainIds = ['bitcoin-mainnet', 'litecoin-mainnet'];
    const roleValues = ['DONATE1', 'DONATE2', 'EXPLORER'];

    function settingsWith(perChainPatch = {}) {
        const seeded = seedSettingsForChains(
            { ...createDefaultSettings(), activeNetwork: 'mainnet' },
            defaultRegistry(),
            chainIds,
        );
        const perChain = { ...seeded.ads.perChain };
        for (const [chainId, patch] of Object.entries(perChainPatch)) {
            perChain[chainId] = { ...perChain[chainId], ...patch };
        }
        return { ...seeded, ads: { ...seeded.ads, enabled: true, perChain } };
    }

    const addressesOf = (chainId) => defaultRegistry().get(chainId).adsDonationAddresses;
    const pickerOf = (name) => screen.getByLabelText(`${name} donation recipient`);
    const addressOf = (name) => screen.getByLabelText(`${name} donation address`);

    it('lists the three roles for every chain, with DONATE1 chosen by default', () => {
        settings = settingsWith();
        render(<AdsSection />);

        for (const [chainId, name] of [['bitcoin-mainnet', 'Bitcoin'], ['litecoin-mainnet', 'Litecoin']]) {
            const picker = pickerOf(name);
            const options = Array.from(picker.options);
            expect(options.map((o) => o.textContent))
                .toEqual(['DONATE1 · protocol', 'DONATE2 · community', 'DONATE3 · explorer']);
            expect(options.map((o) => o.value)).toEqual(roleValues);
            expect(options.every((o) => !o.disabled)).toBe(true);
            expect(picker.value).toBe('DONATE1');
            expect(addressOf(name).value).toBe(addressesOf(chainId).DONATE1);
        }
    });

    it('persists the picked role for that chain only', () => {
        settings = settingsWith();
        render(<AdsSection />);

        fireEvent.change(pickerOf('Bitcoin'), { target: { value: 'DONATE2' } });
        fireEvent.change(pickerOf('Litecoin'), { target: { value: 'EXPLORER' } });

        expect(update).toHaveBeenNthCalledWith(1, {
            ads: { perChain: { 'bitcoin-mainnet': { donationAddressRole: 'DONATE2' } } },
        });
        expect(update).toHaveBeenNthCalledWith(2, {
            ads: { perChain: { 'litecoin-mainnet': { donationAddressRole: 'EXPLORER' } } },
        });
    });

    it('shows the chosen address read-only, the one the next donation is sent to', () => {
        // Pending past the trigger, so the flow names the address the next donation goes to.
        settings = settingsWith({
            'bitcoin-mainnet': { donationAddressRole: 'EXPLORER', accumulatedSats: 100_000_000 },
            'litecoin-mainnet': { donationAddressRole: 'DONATE2', accumulatedSats: 100_000_000 },
        });
        render(<AdsSection />);

        expect(pickerOf('Bitcoin').value).toBe('EXPLORER');
        const bitcoin = addressOf('Bitcoin');
        expect(bitcoin.value).toBe(addressesOf('bitcoin-mainnet').EXPLORER);
        expect(bitcoin.value).toMatch(/^1Donate3/);
        expect(bitcoin.readOnly).toBe(true);
        expect(addressOf('Litecoin').value).toBe(addressesOf('litecoin-mainnet').DONATE2);
        expect(addressOf('Litecoin').readOnly).toBe(true);

        for (const chainId of chainIds) {
            const plan = resolveAdsPlanForNextTx(settings, chainId, defaultRegistry());
            expect(plan.donationAddress).toBe(addressOf(chainId.startsWith('bitcoin') ? 'Bitcoin' : 'Litecoin').value);
        }
    });

    it('falls back to DONATE1 for a stored role the donation flow does not know', () => {
        settings = settingsWith({ 'bitcoin-mainnet': { donationAddressRole: 'DONATE3' } });
        render(<AdsSection />);

        expect(pickerOf('Bitcoin').value).toBe('DONATE1');
        expect(addressOf('Bitcoin').value).toBe(addressesOf('bitcoin-mainnet').DONATE1);
    });

    it('locks the picker while ADS is off', () => {
        settings = { ...settingsWith(), ads: { ...settingsWith().ads, enabled: false } };
        render(<AdsSection />);

        expect(pickerOf('Bitcoin').disabled).toBe(true);
        expect(pickerOf('Litecoin').disabled).toBe(true);
    });
});
