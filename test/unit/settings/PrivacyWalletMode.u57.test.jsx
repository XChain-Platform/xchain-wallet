// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U57 and U63 on the Privacy and Wallet mode subpages: the two Privacy
// fields carry written tips in place of their static lines, Reset to
// defaults shows an icon, and the Transaction handling group has a tip.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings = createDefaultSettings();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: {}, shell: 'web' }),
}));

const { PrivacySection } = await import(
    '../../../packages/core/src/shared/components/settings/PrivacySection.jsx'
);
const { WalletModeSection } = await import(
    '../../../packages/core/src/shared/components/settings/WalletModeSection.jsx'
);

afterEach(() => {
    cleanup();
    settings = createDefaultSettings();
});

function tipText(name) {
    const trigger = screen.getByRole('button', { name });
    fireEvent.click(trigger);
    return trigger.closest('span').parentElement;
}

describe('Privacy fields (U57)', () => {
    it('explains Clipboard auto-clear and Form draft retention from label tips', () => {
        render(<PrivacySection />);
        expect(within(tipText('About clipboard auto-clear')).getByText(/Set 0 to keep copies/)).toBeTruthy();
        expect(within(tipText('About form draft retention')).getByText(/Choose Off to stop keeping drafts/)).toBeTruthy();
    });

    it('no longer prints the two static lines under the fields', () => {
        render(<PrivacySection />);
        expect(screen.queryByText(/Set to 0 to keep them until they are replaced/)).toBeNull();
        expect(screen.queryByText(/Keep in-progress send and sign-message fields/)).toBeNull();
    });
});

describe('Privacy reset (U63)', () => {
    it('draws an icon on Reset to defaults', () => {
        render(<PrivacySection />);
        const reset = screen.getByRole('button', { name: /Reset to defaults/ });
        expect(reset.querySelector('svg')).not.toBeNull();
    });
});

describe('Wallet mode (U57)', () => {
    it('puts a written tip on the Transaction handling group', () => {
        render(<WalletModeSection />);
        expect(within(tipText(/More info|Transaction handling/)).getByText(/Whether this device signs and broadcasts/)).toBeTruthy();
    });
});
