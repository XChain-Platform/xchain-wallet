// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => ({
        alerts: [],
        loading: false,
        supported: false,
        error: null,
        addAlert: vi.fn(),
        updateAlert: vi.fn(),
        removeAlert: vi.fn(),
        rearm: vi.fn(),
        reload: vi.fn(),
    }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: null }),
}));

const { PrivacySection } = await import(
    '../../../packages/core/src/shared/components/settings/PrivacySection.jsx'
);
const { NetworkEndpointsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx'
);
const { FeesSection } = await import(
    '../../../packages/core/src/shared/components/settings/FeesSection.jsx'
);
const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx'
);
const { DisplaySection } = await import(
    '../../../packages/core/src/shared/components/settings/DisplaySection.jsx'
);

function renderSection(section) {
    return render(<ToastHost>{section}</ToastHost>);
}

function expectNoSuccessToast() {
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull();
}

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn().mockRejectedValue(new Error('storage failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('background settings save failures', () => {
    it('shows a privacy error beside the switch and restores its value', async () => {
        renderSection(<PrivacySection />);
        const control = screen.getByRole('switch', { name: 'Change-address rotation' });
        const previous = control.checked;

        fireEvent.click(control);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Could not save this privacy setting. Try again.');
        expect(control.parentElement.nextElementSibling).toBe(alert);
        expect(control.checked).toBe(previous);
        expectNoSuccessToast();
    });

    it('shows an endpoint error in the edited chain and restores the persisted URL', async () => {
        renderSection(<NetworkEndpointsSection />);
        const block = screen.getByRole('region', { name: 'Bitcoin' });
        const control = within(block).getByRole('textbox', { name: 'Explorer URL' });
        const previous = control.value;

        fireEvent.change(control, { target: { value: 'https://private.example.com' } });
        fireEvent.click(within(block).getByRole('button', { name: 'Save' }));

        expect(await within(block).findByRole('alert')).toHaveTextContent('storage failed');
        expect(control.value).toBe(previous);
        expectNoSuccessToast();
    });

    it('shows a fee error in the chain block and restores the previous strategy', async () => {
        settings = {
            ...createDefaultSettings(),
            fees: {
                'bitcoin-mainnet': {
                    strategy: 'normal',
                    customSatsPerKb: null,
                    rbfByDefault: true,
                },
            },
        };
        renderSection(<FeesSection />);
        const block = screen.getByText('Bitcoin').parentElement;
        const control = within(block).getByLabelText('Bitcoin fee strategy');

        fireEvent.change(control, { target: { value: 'fast' } });

        expect(await within(block).findByRole('alert')).toHaveTextContent(
            'Could not save this fee setting. Try again.',
        );
        expect(control.value).toBe('normal');
        expectNoSuccessToast();
    });

    it('shows a notification error beside the switch and restores its value', async () => {
        renderSection(<NotificationsSection />);
        const control = screen.getByRole('switch', { name: 'Transaction confirmations' });
        const previous = control.checked;

        fireEvent.click(control);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Could not update transaction confirmations. Try again.');
        expect(control.parentElement.nextElementSibling).toBe(alert);
        expect(control.checked).toBe(previous);
        expectNoSuccessToast();
    });

    it('shows a display error beside the switch and restores its value', async () => {
        renderSection(<DisplaySection />);
        const control = screen.getByRole('switch', { name: 'Hide small balances' });
        const previous = control.checked;

        fireEvent.click(control);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Could not save this display preference. Try again.');
        expect(control.parentElement.nextElementSibling).toBe(alert);
        await waitFor(() => expect(control.checked).toBe(previous));
        expectNoSuccessToast();
    });
});
