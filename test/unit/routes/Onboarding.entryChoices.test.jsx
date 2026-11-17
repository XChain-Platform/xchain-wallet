// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import {
    _resetHardwareReconnectForTests,
    setHardwareFactories,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

// The label reads "Connect Hardware Wallet" per the ruling; the locale line
// may still carry the older "Connect a Hardware Wallet".
const CONNECT_HARDWARE = /^Connect (a )?Hardware Wallet$/;

function mount(props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <Onboarding
                onCreate={() => {}}
                onImport={() => {}}
                onDemoEntered={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
}

let savedHid;
beforeEach(() => {
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
    savedHid = Object.getOwnPropertyDescriptor(navigator, 'hid');
    _resetHardwareReconnectForTests();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    if (savedHid) Object.defineProperty(navigator, 'hid', savedHid);
    else delete navigator.hid;
    _resetHardwareReconnectForTests();
});

function withWebHid() {
    Object.defineProperty(navigator, 'hid', { value: {}, configurable: true });
}

describe('Onboarding entry choices', () => {
    it('removes the separate FreeWallet entry and keeps Try Demo distinct', () => {
        mount();

        expect(screen.queryByRole('button', { name: 'Import FreeWallet' })).toBeNull();

        const demo = screen.getByRole('button', { name: 'Try Demo' });
        expect(demo.className).toMatch(/danger/);
        expect(demo.querySelector('svg')).not.toBeNull();
    });

    it('no longer offers the two-phone pairing on Welcome', () => {
        mount({ onPairPartner: vi.fn() });
        expect(screen.queryByRole('button', { name: /Offline Signer/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /another phone/i })).toBeNull();
    });

    it('shows the four welcome choices in order when hardware is available', () => {
        withWebHid();
        setHardwareFactories({ trezor: null, ledger: vi.fn() });
        const onConnectHardware = vi.fn();
        mount({ onConnectHardware });

        const choices = screen.getAllByRole('button').map((b) => b.textContent.trim());
        expect(choices.slice(0, 4)).toEqual([
            'Create New Wallet', 'Import Wallet',
            expect.stringMatching(CONNECT_HARDWARE), 'Try Demo',
        ]);

        const connect = screen.getByRole('button', { name: CONNECT_HARDWARE });
        expect(connect.className).toMatch(/hardwareButton/);
        expect(connect.querySelector('svg[data-icon="hardware-wallet"]')).not.toBeNull();
        fireEvent.click(connect);
        expect(onConnectHardware).toHaveBeenCalledTimes(1);
    });

    it('hides Connect Hardware Wallet when no vendor factory can reach a device', () => {
        const onConnectHardware = vi.fn();
        // No factory at all.
        setHardwareFactories({});
        const first = mount({ onConnectHardware });
        expect(screen.queryByRole('button', { name: CONNECT_HARDWARE })).toBeNull();
        first.unmount();

        // A Ledger factory without WebHID (Firefox, Safari, the Android app) cannot reach a device.
        delete navigator.hid;
        setHardwareFactories({ trezor: null, ledger: vi.fn() });
        mount({ onConnectHardware });
        expect(screen.queryByRole('button', { name: CONNECT_HARDWARE })).toBeNull();
        expect(onConnectHardware).not.toHaveBeenCalled();
    });

    it('hides Connect Hardware Wallet when the shell does not wire it', () => {
        withWebHid();
        setHardwareFactories({ trezor: vi.fn(), ledger: vi.fn() });
        mount();
        expect(screen.queryByRole('button', { name: CONNECT_HARDWARE })).toBeNull();
    });
});
