// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings > Automatic donations (§36, ruling 2026-11-14): layout 1's header
// above layout 4's Donation and Totals groups. One wallet-wide fiat setting,
// changed in place on SettingsInlineRow rows; None turns donations off (no
// switch) and Custom opens an amount field in place.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { selectOption } from '../../helpers/selectOption.js';

let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

const { AdsSection, normalizeAdsAmount } = await import(
    '../../../packages/core/src/shared/components/settings/AdsSection.jsx'
);
const { AdsNotice } = await import(
    '../../../packages/core/src/shared/components/AdsNotice.jsx'
);

function settingsWith(ads = {}, extra = {}) {
    const s = createDefaultSettings();
    return { ...s, ...extra, ads: { ...s.ads, ...ads } };
}

function row(id) {
    return document.querySelector(`[data-settings-row-id="${id}"]`);
}
function trigger(id) {
    return within(row(id)).getByRole('combobox');
}

beforeEach(() => {
    settings = settingsWith({ queued: '3.45', donated: '12.4', donationCount: 3 });
    update = vi.fn(async () => settings);
});

afterEach(() => cleanup());

describe('header', () => {
    it('keeps the heart hero, amount and whole rule in the Notice Standard', () => {
        render(<AdsSection />);
        const hero = screen.getByTestId('ads-hero');
        expect(hero).toHaveAttribute('data-tone', 'info');
        expect(hero).toHaveAttribute('role', 'note');
        expect(hero.querySelector('.lucide-heart')).not.toBeNull();
        expect(hero).toHaveTextContent('$0.05 per transaction');
        expect(hero).toHaveTextContent(
            'Each mainnet transaction adds $0.05. When the total reaches $5.00 it goes to Protocol with your next mainnet send that can cover it.',
        );
        expect(document.querySelector('[role="progressbar"], progress')).toBeNull();
    });

    it('says donations are off at None', () => {
        settings = settingsWith({ perTransaction: '0' });
        render(<AdsSection />);
        expect(screen.getByTestId('ads-hero')).toHaveTextContent('Automatic Donations off');
        expect(screen.getByTestId('ads-hero')).toHaveTextContent('Nothing is added while Per transaction is None.');
    });

    it('has no on and off switch', () => {
        render(<AdsSection />);
        expect(screen.queryByRole('switch')).toBeNull();
    });
});

describe('Donation group', () => {
    it('lists Per transaction, Send at and Donate to as inline rows with their lines', () => {
        render(<AdsSection />);
        const group = screen.getByRole('list', { name: 'Donation' });
        expect(within(group).getByText('Per transaction')).toBeTruthy();
        expect(within(group).getByText('None turns automatic donations off')).toBeTruthy();
        expect(within(group).getByText('Send at')).toBeTruthy();
        expect(within(group).getByText('Queued total that sends it')).toBeTruthy();
        expect(within(group).getByText('Donate to')).toBeTruthy();
        expect(within(group).getByText('Who receives it')).toBeTruthy();
        expect(trigger('ads-per-transaction')).toHaveTextContent('$0.05');
        expect(trigger('ads-send-at')).toHaveTextContent('$5');
        expect(trigger('ads-donate-to')).toHaveTextContent('Protocol');
        fireEvent.click(screen.getByRole('button', { name: 'About Send at' }));
        expect(screen.getByText(/The default is \$5\.00, about 100 transactions/)).toBeTruthy();
    });

    it('offers the ruled presets and Custom', () => {
        render(<AdsSection />);
        fireEvent.click(trigger('ads-per-transaction'));
        const perTx = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent.trim());
        expect(perTx).toEqual(['None', '$0.01', '$0.05', '$0.10', '$0.25', 'Custom']);
        cleanup();
        render(<AdsSection />);
        fireEvent.click(trigger('ads-send-at'));
        const sendAt = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent.trim());
        expect(sendAt).toEqual(['$5', '$10', '$25', '$50', '$100', 'Custom']);
        cleanup();
        render(<AdsSection />);
        fireEvent.click(trigger('ads-donate-to'));
        const recipientOptions = Array.from(document.querySelectorAll('[role="option"]'));
        const to = recipientOptions.map((o) => o.textContent.trim());
        expect(to).toEqual(['Protocol', 'Community', 'Explorer']);
        expect(recipientOptions.every((option) => option.querySelector('svg'))).toBe(true);
    });

    it('writes each pick with the currency it is in', () => {
        render(<AdsSection />);
        selectOption(trigger('ads-per-transaction'), '0.1');
        selectOption(trigger('ads-send-at'), '50');
        selectOption(trigger('ads-donate-to'), 'explorer');
        expect(update).toHaveBeenNthCalledWith(1, { ads: { perTransaction: '0.1', currency: 'USD' } });
        expect(update).toHaveBeenNthCalledWith(2, { ads: { sendAt: '50', currency: 'USD' } });
        expect(update).toHaveBeenNthCalledWith(3, { ads: { recipient: 'explorer', currency: 'USD' } });
    });

    it('None turns donations off', () => {
        render(<AdsSection />);
        selectOption(trigger('ads-per-transaction'), '0');
        expect(update).toHaveBeenCalledWith({ ads: { perTransaction: '0', currency: 'USD' } });
    });

    it('Custom opens an amount field in place and saves a valid amount', () => {
        render(<AdsSection />);
        selectOption(trigger('ads-per-transaction'), 'custom');
        const field = screen.getByTestId('ads-custom-perTransaction');
        expect(field.type).toBe('text');
        expect(field.inputMode).toBe('decimal');
        expect(row('ads-per-transaction').contains(field)).toBe(true);
        fireEvent.change(field, { target: { value: '0.07' } });
        fireEvent.blur(field);
        expect(update).toHaveBeenCalledWith({ ads: { perTransaction: '0.07', currency: 'USD' } });
    });

    it('Custom refuses an amount outside the bounds and saves nothing', () => {
        render(<AdsSection />);
        selectOption(trigger('ads-send-at'), 'custom');
        const field = screen.getByTestId('ads-custom-sendAt');
        for (const value of ['0.5', '1e3', '20000', '12.345', 'abc']) {
            fireEvent.change(field, { target: { value } });
            fireEvent.blur(field);
        }
        expect(update).not.toHaveBeenCalled();
        expect(row('ads-send-at')).toHaveTextContent('Enter an amount from $1.00 to $10,000.00, with at most two decimals.');
    });

    it('opens with the field showing a stored custom amount', () => {
        settings = settingsWith({ sendAt: '40' });
        render(<AdsSection />);
        expect(trigger('ads-send-at')).toHaveTextContent('Custom');
        expect(screen.getByTestId('ads-custom-sendAt').value).toBe('40');
        expect(screen.getByTestId('ads-hero')).toHaveTextContent('When the total reaches $40.00');
    });

    it('shows and writes the display currency while nothing is queued or donated', () => {
        settings = settingsWith({}, { fiatCurrency: 'EUR' });
        render(<AdsSection />);
        expect(screen.getByTestId('ads-hero')).toHaveTextContent('€0.05 per transaction');
        selectOption(trigger('ads-send-at'), '10');
        expect(update).toHaveBeenCalledWith({ ads: { sendAt: '10', currency: 'EUR' } });
    });
});

describe('Totals group', () => {
    it('shows the queued and donated totals in fiat', () => {
        render(<AdsSection />);
        const group = screen.getByRole('list', { name: 'Totals' });
        expect(row('ads-queued')).toHaveTextContent('Queued');
        expect(row('ads-queued')).toHaveTextContent('Sent with a transaction at $5.00');
        expect(row('ads-queued')).toHaveTextContent('$3.45');
        expect(row('ads-donated')).toHaveTextContent('Donated so far');
        expect(row('ads-donated')).toHaveTextContent('3 donations');
        expect(row('ads-donated')).toHaveTextContent('$12.40');
        expect(group.contains(row('ads-donated'))).toBe(true);
    });

    it('says when nothing has been donated yet', () => {
        settings = settingsWith();
        render(<AdsSection />);
        expect(row('ads-donated')).toHaveTextContent('No donations yet');
        expect(row('ads-donated')).toHaveTextContent('$0.00');
    });

    it('groups thousands in totals and donation counts', () => {
        settings = settingsWith({ queued: '12345.67', donated: '98765.43', donationCount: 12345 });
        render(<AdsSection />);
        expect(row('ads-queued')).toHaveTextContent('$12,345.67');
        expect(row('ads-donated')).toHaveTextContent('12,345 donations');
        expect(row('ads-donated')).toHaveTextContent('$98,765.43');
    });
});

describe('normalizeAdsAmount', () => {
    it('reads the forms people type', () => {
        expect(normalizeAdsAmount('05.')).toBe('5');
        expect(normalizeAdsAmount('.5')).toBe('0.5');
        expect(normalizeAdsAmount('0.10')).toBe('0.1');
        expect(normalizeAdsAmount(' 25 ')).toBe('25');
        expect(normalizeAdsAmount('')).toBeNull();
        expect(normalizeAdsAmount('.')).toBeNull();
        expect(normalizeAdsAmount('1e3')).toBeNull();
        expect(normalizeAdsAmount('-1')).toBeNull();
    });
});

describe('onboarding notice', () => {
    it('describes the same rule with the default amounts', () => {
        render(<AdsNotice onContinue={() => {}} />);
        const behavior = screen.getByText(/Each mainnet transaction you send adds \$0\.05 to one queue, and when the queue reaches \$5\.00/);
        const notice = behavior.closest('[data-tone]');
        const form = screen.getByRole('form', { name: 'Automatic Donations' });
        const continueButton = screen.getByRole('button', { name: 'Continue' });
        expect(notice?.dataset.tone).toBe('info');
        expect(notice?.getAttribute('role')).toBeNull();
        expect(form).toContainElement(notice);
        expect(form).toContainElement(continueButton);
        expect(screen.getByText(/XChain Platform includes automatic donations/)).toBeTruthy();
        expect(behavior).toHaveTextContent('At the defaults, that is about 100 transactions.');
        expect(screen.getByText(/Settings → Automatic Donations/)).toBeTruthy();
    });
});
