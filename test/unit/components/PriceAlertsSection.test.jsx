// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings, Notifications, Price alerts (2026-11-14): the alert list, the Price
// Alert page (identity card, Actions | Details), Add and Edit Price Alert, the
// empty state and the paused state. usePriceAlerts is mocked so each action is
// seen as the call it makes.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { selectOption } from '../../helpers/selectOption.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings;
let priceAlerts;
let prices;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => priceAlerts,
}));

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlertPrices.js', () => ({
    usePriceAlertPrices: () => (alert) => prices[alert.chainId] ?? null,
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: {} }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onBack, onSelect }) => (
        <section aria-label="Asset picker">
            <h1>{title}</h1>
            <button type="button" onClick={onBack}>Back to price alert</button>
            <button
                type="button"
                onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native' })}
            >
                Select BTC
            </button>
        </section>
    ),
}));

const { PriceAlertsSection, formatThreshold } = await import(
    '../../../packages/core/src/shared/components/settings/PriceAlertsSection.jsx');

function alertRecord(overrides = {}) {
    return {
        id: 'alert-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        direction: 'above',
        targetFiat: 70000,
        fiatCurrency: 'usd',
        status: 'armed',
        createdAt: '2026-11-01T10:00:00.000Z',
        triggeredAt: null,
        ...overrides,
    };
}

function renderSection(props = {}) {
    return render(<PriceAlertsSection walletId="wallet-1" onBack={vi.fn()} {...props} />);
}

beforeEach(() => {
    settings = createDefaultSettings();
    prices = { 'bitcoin-mainnet': 68412, 'dogecoin-mainnet': 0.1184 };
    priceAlerts = {
        alerts: [],
        loading: false,
        supported: true,
        error: null,
        addAlert: vi.fn().mockResolvedValue(undefined),
        updateAlert: vi.fn().mockResolvedValue(undefined),
        removeAlert: vi.fn().mockResolvedValue(undefined),
        rearm: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Price Alerts list', () => {
    it('shows a chevron row per alert: the terms, then how far the price has to go', () => {
        priceAlerts.alerts = [
            alertRecord(),
            alertRecord({ id: 'alert-2', chainId: 'dogecoin-mainnet', direction: 'below', targetFiat: 0.1 }),
        ];
        renderSection();

        expect(screen.getByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
        const rows = within(screen.getByRole('list', { name: 'Price Alerts' })).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(screen.getByRole('list', { name: 'Price Alerts' })).toHaveAttribute('data-list-card');
        expect(rows[0]).not.toHaveAttribute('data-list-divider');
        expect(rows[1]).toHaveAttribute('data-list-divider');
        expect(rows[0]).toHaveTextContent('BTC above $70,000');
        expect(rows[0]).toHaveTextContent('Now $68,412, 2.3% to go');
        expect(rows[1]).toHaveTextContent('DOGE below $0.1');
        expect(rows[1]).toHaveTextContent('Now $0.1184, 15.5% to go');
        expect(within(rows[0]).getByRole('button', { name: 'Open BTC above $70,000 alert' })).toBeTruthy();
    });

    it('puts the plus at the top right and the filter beside it', () => {
        priceAlerts.alerts = [alertRecord()];
        renderSection();
        expect(screen.getByRole('button', { name: 'Add Price Alert' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Filter price alerts' })).toBeTruthy();
    });

    it('says Paused on a paused row and when a fired alert fired', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
        priceAlerts.alerts = [
            alertRecord({ id: 'p', status: 'paused' }),
            alertRecord({ id: 'f', chainId: 'dogecoin-mainnet', status: 'triggered', triggeredAt: '2026-01-15T11:58:00.000Z' }),
        ];
        renderSection();

        const paused = screen.getByRole('button', { name: /Open BTC above/ });
        expect(paused).toHaveTextContent('Paused');
        expect(paused).not.toHaveTextContent('Now');
        expect(screen.getByRole('button', { name: /Open DOGE above/ })).toHaveTextContent('Fired 2 minutes ago');
    });

    it('groups only the whole-number part of a saved target', () => {
        expect(formatThreshold(0.1234, 'usd')).toBe('$0.1234');
        expect(formatThreshold(70000.123456, 'usd')).toBe('$70,000.123456');
        expect(formatThreshold(1e21, 'usd')).toBe('$1,000,000,000,000,000,000,000');
        expect(formatThreshold(1e-7, 'usd')).toBe('$0.0000001');
        expect(formatThreshold(5, 'eur')).toBe('5 EUR');
    });

    it('filters the rows by the search text', () => {
        priceAlerts.alerts = [
            alertRecord(),
            alertRecord({ id: 'alert-2', chainId: 'dogecoin-mainnet', targetFiat: 0.2 }),
        ];
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: 'Filter price alerts' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search price alerts' }), { target: { value: 'doge' } });

        const rows = within(screen.getByRole('list', { name: 'Price Alerts' })).getAllByRole('listitem');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent('DOGE above $0.2');
    });

    it('shows the empty state with its one-line hint, and the plus still adds', () => {
        renderSection();
        expect(screen.getByText('No price alerts yet')).toBeTruthy();
        expect(screen.getByText('Tap + to get an alert when a price rises above or falls below a level you pick.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add Price Alert' })).toBeTruthy();
    });

    it('never depends on the Price alerts switch: no turn-on hint, alerts listed while it is off', () => {
        settings.notifications.priceAlerts = false;
        priceAlerts.alerts = [alertRecord()];
        renderSection();
        expect(screen.getByRole('button', { name: /Open BTC above/ })).toBeTruthy();
        expect(screen.queryByText(/Turn on Price alerts/)).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('distinguishes loading from an empty result', () => {
        priceAlerts.loading = true;
        renderSection();
        expect(screen.getByText('Loading price alerts…')).toBeTruthy();
        expect(screen.queryByText('No price alerts yet')).toBeNull();
    });

    it('offers a retry after the alert list fails to load', () => {
        priceAlerts.error = 'storage failed';
        renderSection();
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load price alerts.");
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(priceAlerts.reload).toHaveBeenCalledTimes(1);
    });

    it('says so when the shell has no price alerts', () => {
        priceAlerts.supported = false;
        renderSection();
        expect(screen.getByText('Price alerts unavailable')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Price Alert' })).toBeNull();
    });
});

describe('Price Alert page', () => {
    function openAlert(alert = alertRecord()) {
        priceAlerts.alerts = [alert];
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: /^Open / }));
    }

    it('has the title only in its header and the terms once, in the identity card', () => {
        openAlert();

        const heading = screen.getByRole('heading', { level: 1, name: 'Price Alert' });
        expect(heading.closest('header')).not.toHaveTextContent('BTC above');
        expect(screen.getAllByText('BTC above $70,000')).toHaveLength(1);
        const card = document.querySelector('[data-identity-card]');
        expect(card).toHaveTextContent('BTC above $70,000');
        expect(card).toHaveTextContent('Now $68,412, 2.3% to go · Watching');
    });

    it('offers Edit, Pause and Delete as an action list, none of them red', () => {
        openAlert();

        const list = screen.getByRole('list', { name: 'Price alert actions' });
        const names = within(list).getAllByRole('button').map((b) => b.textContent);
        expect(names).toEqual([
            'Edit alertChange the asset, the direction or the price',
            'Pause alertStop watching until you resume it',
            'Delete alertRemove this alert for good',
        ]);
        for (const button of within(list).getAllByRole('button')) {
            expect(button.className).not.toMatch(/danger/);
            expect(button.querySelector('svg')).toBeTruthy();
        }
    });

    it('pauses a watching alert', async () => {
        openAlert();
        fireEvent.click(screen.getByRole('button', { name: /^Pause alert/ }));
        await waitFor(() => expect(priceAlerts.pause).toHaveBeenCalledWith('alert-1'));
    });

    it('offers Resume on a paused alert and resumes it', async () => {
        openAlert(alertRecord({ status: 'paused' }));
        expect(screen.queryByRole('button', { name: /^Pause alert/ })).toBeNull();
        expect(document.querySelector('[data-identity-card]')).toHaveTextContent('Paused');
        fireEvent.click(screen.getByRole('button', { name: /^Resume alert/ }));
        await waitFor(() => expect(priceAlerts.rearm).toHaveBeenCalledWith('alert-1'));
    });

    it('offers Re-arm on a fired alert', async () => {
        openAlert(alertRecord({ status: 'triggered', triggeredAt: '2026-11-02T10:00:00.000Z' }));
        expect(screen.queryByRole('button', { name: /^Pause alert/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Re-arm alert/ }));
        await waitFor(() => expect(priceAlerts.rearm).toHaveBeenCalledWith('alert-1'));
    });

    it('asks before deleting, keeps the alert on cancel and returns to the list after a delete', async () => {
        openAlert();

        fireEvent.click(screen.getByRole('button', { name: /^Delete alert/ }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(priceAlerts.removeAlert).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /^Delete alert/ }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(priceAlerts.removeAlert).toHaveBeenCalledWith('alert-1'));
        expect(await screen.findByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
    });

    it('reports an action that fails and stays on the page', async () => {
        priceAlerts.pause.mockRejectedValueOnce(new Error('save failed'));
        openAlert();
        fireEvent.click(screen.getByRole('button', { name: /^Pause alert/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update the price alert. Try again.");
        expect(screen.getByRole('heading', { level: 1, name: 'Price Alert' })).toBeTruthy();
    });

    it('lists the alert facts under Details', () => {
        openAlert();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const details = document.querySelector('dl');
        expect(details).toHaveTextContent('AssetBTC');
        expect(details).toHaveTextContent('When the priceRises above');
        expect(details).toHaveTextContent('Target price$70,000');
        expect(details).toHaveTextContent('StatusWatching');
        for (const value of details.querySelectorAll('dd')) {
            expect(value).toHaveAttribute('title', value.textContent);
            expect(getComputedStyle(value).wordBreak).not.toBe('break-all');
        }
    });

    it('goes back to the list', () => {
        openAlert();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
    });
});

describe('Add and Edit Price Alert', () => {
    it('opens Add Price Alert from the plus, picks an asset, adds the alert and returns to the list', async () => {
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: 'Add Price Alert' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Add Price Alert' })).toBeTruthy();
        const add = screen.getByRole('button', { name: 'Add Alert' });
        expect(add).toBeEnabled();
        fireEvent.click(add);
        expect(document.querySelector('[data-form-errors]')).toHaveTextContent('Select an asset');
        expect(priceAlerts.addAlert).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Asset: Select an asset' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Choose Asset' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Select BTC' }));

        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '71000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Alert' }));
        await waitFor(() => expect(priceAlerts.addAlert).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            direction: 'above',
            targetFiat: 71000,
            fiatCurrency: 'usd',
        }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
    });

    it('keeps the form as it was when the Choose Asset page is left with Back', () => {
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: 'Add Price Alert' }));
        selectOption(screen.getByRole('button', { name: /^When the price/ }), 'below');
        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Asset: Select an asset' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to price alert' }));

        expect(screen.getByRole('button', { name: /^When the price/ })).toHaveAccessibleName('When the price: Falls below');
        expect(screen.getByRole('textbox', { name: 'Target price' }).value).toBe('123');
    });

    it('edits an alert on the same form, pre-filled, and returns to its page', async () => {
        priceAlerts.alerts = [alertRecord()];
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: /^Open / }));
        fireEvent.click(screen.getByRole('button', { name: /^Edit alert/ }));

        expect(screen.getByRole('heading', { level: 1, name: 'Edit Price Alert' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Target price' }).value).toBe('70000');
        selectOption(screen.getByRole('button', { name: /^When the price/ }), 'below');
        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '65000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Alert' }));

        await waitFor(() => expect(priceAlerts.updateAlert).toHaveBeenCalledWith('alert-1', {
            chainId: 'bitcoin-mainnet',
            direction: 'below',
            targetFiat: 65000,
            fiatCurrency: 'usd',
        }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Price Alert' })).toBeTruthy();
    });

    it('keeps an alert in its original currency while it is edited', async () => {
        settings = { ...settings, fiatCurrency: 'EUR' };
        priceAlerts.alerts = [alertRecord({ fiatCurrency: 'usd' })];
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: /^Open / }));
        fireEvent.click(screen.getByRole('button', { name: /^Edit alert/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Alert' }));

        await waitFor(() => expect(priceAlerts.updateAlert).toHaveBeenCalledWith('alert-1', expect.objectContaining({
            fiatCurrency: 'usd',
        })));
    });

    it('Back from Edit returns to the alert page, and Back from Add returns to the list', () => {
        priceAlerts.alerts = [alertRecord()];
        renderSection();
        fireEvent.click(screen.getByRole('button', { name: /^Open / }));
        fireEvent.click(screen.getByRole('button', { name: /^Edit alert/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Price Alert' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Price Alert' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
    });
});
