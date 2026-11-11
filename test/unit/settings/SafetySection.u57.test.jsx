// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U57 and U63 on the Safety subpage: tips on Auto-lock, the test-send
// warning and Hold duration, and an icon on every button in every row state.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings = createDefaultSettings();
let biometric = { supported: true, reason: '', mechanism: 'Face unlock', wrapNote: 'It is wrapped by this device.' };
let registered = false;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: {}, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/flows/biometricUnlock.js', () => ({
    describeBiometric: () => Promise.resolve(biometric),
    isBiometricRegistered: () => registered,
    clearBiometricCredential: vi.fn(),
    registerBiometricCredential: vi.fn(),
}));

const { SafetySection } = await import(
    '../../../packages/core/src/shared/components/settings/SafetySection.jsx'
);
const { PanicModeRow } = await import(
    '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx'
);
const { DuressPassphraseRow } = await import(
    '../../../packages/core/src/shared/components/settings/DuressPassphraseRow.jsx'
);
const { BiometricRow } = await import(
    '../../../packages/core/src/shared/components/settings/BiometricRow.jsx'
);

afterEach(() => {
    cleanup();
    settings = createDefaultSettings();
    registered = false;
    window.localStorage.clear();
});

function expectAllButtonsIconed(container) {
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
        // InfoTip triggers are not action buttons.
        if (/^About /.test(b.getAttribute('aria-label') || '')) continue;
        expect(b.querySelector('svg'), `button "${b.textContent}" has an icon`).not.toBeNull();
    }
}

function tipText(name) {
    const trigger = screen.getByRole('button', { name });
    fireEvent.click(trigger);
    return trigger.closest('span').parentElement;
}

describe('Safety field tips (U57)', () => {
    it('explains Auto-lock, the test-send warning and Hold duration', () => {
        render(<SafetySection />);
        expect(within(tipText('About auto-lock timeout')).getByText(/idle before it locks/)).toBeTruthy();
        expect(within(tipText('About the new-recipient test-send warning')).getByText(/Enter 0 to turn this warning off/)).toBeTruthy();
        expect(within(tipText('About hold duration')).getByText(/send at once without holding/)).toBeTruthy();
    });

    it('drops the static test-send line and the parenthesised hold hint', () => {
        render(<SafetySection />);
        expect(document.getElementById('test-send-threshold-hint')).toBeNull();
        expect(screen.queryByText(/Hold duration in seconds \(0 disables\)/)).toBeNull();
        expect(screen.getByText(/Hold duration \(seconds\)/)).toBeTruthy();
    });
});

describe('Safety buttons carry icons (U63)', () => {
    it('panic idle, confirming', () => {
        const { container } = render(<PanicModeRow />);
        expectAllButtonsIconed(container);
        fireEvent.click(screen.getByRole('button', { name: /Activate/ }));
        expectAllButtonsIconed(container);
        expect(screen.getByRole('button', { name: /Confirm 24-hour freeze/ }).className).toMatch(/danger/);
    });

    it('panic active', async () => {
        const { container } = render(<PanicModeRow />);
        fireEvent.click(screen.getByRole('button', { name: /Activate/ }));
        fireEvent.click(screen.getByRole('button', { name: /Confirm 24-hour freeze/ }));
        await screen.findByRole('button', { name: /Deactivate/ });
        expectAllButtonsIconed(container);
    });

    it('duress idle and form open, with a green Save passphrase', () => {
        const { container } = render(<DuressPassphraseRow />);
        expectAllButtonsIconed(container);
        fireEvent.click(screen.getByRole('button', { name: /^Set/ }));
        expectAllButtonsIconed(container);
        const save = screen.getByRole('button', { name: /Save passphrase/ });
        expect(save.getAttribute('type')).toBe('submit');
        expect(save.className).toMatch(/success/);
        expect(container.querySelectorAll('button[class*="success"]').length).toBe(1);
    });

    it('duress form fields carry tips', () => {
        render(<DuressPassphraseRow />);
        fireEvent.click(screen.getByRole('button', { name: /^Set/ }));
        expect(screen.getAllByRole('button', { name: /^About / }).length).toBeGreaterThanOrEqual(3);
    });

    it('biometric idle, enrol form and registered', async () => {
        const { container, unmount } = render(<BiometricRow />);
        await screen.findByRole('button', { name: /Enable/ });
        expectAllButtonsIconed(container);
        fireEvent.click(screen.getByRole('button', { name: /^Enable/ }));
        expectAllButtonsIconed(container);
        const submit = screen.getByRole('button', { name: /Enable biometric unlock/ });
        expect(submit.className).toMatch(/success/);
        unmount();

        registered = true;
        const second = render(<BiometricRow />);
        await screen.findByRole('button', { name: /Re-enrol/ });
        expectAllButtonsIconed(second.container);
        fireEvent.click(screen.getByRole('button', { name: /Re-enrol/ }));
        expectAllButtonsIconed(second.container);
        expect(screen.getByRole('button', { name: /Re-enrol biometric unlock/ }).className).toMatch(/success/);
    });
});
