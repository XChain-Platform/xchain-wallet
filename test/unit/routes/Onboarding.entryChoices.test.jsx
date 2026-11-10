// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HARDWARE_ONLY_WALLET_SUPPORTED, Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

function mount(props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <Onboarding
                onCreate={() => {}}
                onImport={() => {}}
                onImportFromFreeWallet={() => {}}
                onPairPartner={() => {}}
                onDemoEntered={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Onboarding entry choices', () => {
    it('gives the FreeWallet, offline signer, and demo choices distinct marks and colours', () => {
        mount();

        const freeWallet = screen.getByRole('button', { name: 'From FreeWallet' });
        expect(freeWallet.className).toMatch(/freeWalletButton/);
        expect(freeWallet.querySelector('img')?.getAttribute('src')).toContain('freewallet-wally-180.png');

        const pair = screen.getByRole('button', { name: 'Pair an offline signer' });
        expect(pair.className).toMatch(/primary/);

        const demo = screen.getByRole('button', { name: 'Try in demo mode' });
        expect(demo.className).toMatch(/danger/);
        expect(demo.querySelector('svg')).not.toBeNull();
    });

    it('does not offer hardware setup while no hardware-only wallet can be saved', () => {
        expect(HARDWARE_ONLY_WALLET_SUPPORTED).toBe(false);
        const onConnectHardware = vi.fn();
        mount({ onConnectHardware });
        expect(screen.queryByRole('button', { name: 'Connect a hardware wallet' })).toBeNull();
        expect(onConnectHardware).not.toHaveBeenCalled();
    });
});
