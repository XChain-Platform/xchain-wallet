// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Removing every face or finger happens in the device settings, with the
// wallet's Safety screen still mounted behind it. The biometric row asks the
// device again when the app comes back into view, so it stops reading
// "Enabled" once biometrics can no longer be evaluated, and reads it again
// once they can.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { BiometricRow } from '../../../packages/core/src/shared/components/settings/BiometricRow.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { setBiometricProvider } from '../../../packages/core/src/flows/biometricUnlock.js';

const NONE_ENROLLED = 'No fingerprint or face is set up on this device yet.';

function fakeProvider() {
    const state = { available: true, registered: true };
    const provider = {
        name: 'fake',
        mechanism: 'Face ID',
        describe: vi.fn(async () => (state.available
            ? { supported: true, mechanism: 'Face ID' }
            : { supported: false, reason: NONE_ENROLLED, mechanism: 'Face ID' })),
        isSupported: async () => state.available,
        isRegistered: () => state.registered,
        register: vi.fn(async () => {}),
        unlock: vi.fn(async () => 'pw'),
        clear: vi.fn(async () => {}),
    };
    setBiometricProvider(provider);
    return { provider, state };
}

function mount() {
    return render(
        <MessagingContext.Provider value={{ messaging: { unlockWallet: vi.fn() }, shell: 'web' }}>
            <BiometricRow />
        </MessagingContext.Provider>,
    );
}

function setVisibility(value) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}

afterEach(() => {
    cleanup();
    setBiometricProvider(null);
    delete document.visibilityState;
});

describe('BiometricRow on returning to the app', () => {
    it('stops reading Enabled once the device can no longer evaluate biometrics', async () => {
        const { state } = fakeProvider();
        mount();
        expect(await screen.findByText(/^Enabled\. Use/)).toBeTruthy();

        state.available = false;
        setVisibility('hidden');
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(screen.queryByText(/Not available\./)).toBeNull();

        setVisibility('visible');
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(await screen.findByText(/Not available\./)).toBeTruthy();
        expect(screen.getByText(new RegExp(NONE_ENROLLED.replace('.', '\\.')))).toBeTruthy();
        expect(screen.queryByText(/^Enabled\. Use/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Re-enrol' })).toBeNull();
    });

    it('reads Enabled again when focus returns with biometrics set up', async () => {
        const { state } = fakeProvider();
        state.available = false;
        mount();
        expect(await screen.findByText(/Not available\./)).toBeTruthy();

        state.available = true;
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        expect(await screen.findByText(/^Enabled\. Use/)).toBeTruthy();
    });

    it('stops listening once unmounted', async () => {
        const { provider } = fakeProvider();
        const { unmount } = mount();
        await screen.findByText(/^Enabled\. Use/);
        const calls = provider.describe.mock.calls.length;
        unmount();
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        expect(provider.describe.mock.calls.length).toBe(calls);
    });
});
