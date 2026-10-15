// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { Loading } from '../../../packages/core/src/shared/routes/Loading.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import { QrScanner } from '../../../packages/core/src/ui/QrScanner.jsx';
import { setNativeQrScanner } from '../../../packages/core/src/ui/nativeQrScanner.js';
import { clearDemoWalletId, clearLockoutState, setBiometricProvider } from '../../../packages/core/src/flows/index.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import screenStyles from '../../../packages/core/src/ui/Screen.module.css';
import overlayStyles from '../../../packages/core/src/shared/components/OverlaySurface.module.css';

const { qrToDataURL, showToast } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    showToast: vi.fn(),
}));

vi.mock('qrcode', () => ({ default: { toDataURL: qrToDataURL } }));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', async (importOriginal) => ({
    ...(await importOriginal()),
    useToast: () => ({ showToast, dismissToast: vi.fn(), clearToasts: vi.fn() }),
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const ADDRESS = {
    id: 'address-1',
    address: 'bcrt1qmobilekit',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function withMessaging(child, messaging = {}) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>
    );
}

beforeEach(() => {
    qrToDataURL.mockClear();
    showToast.mockClear();
});

afterEach(() => {
    cleanup();
    setBiometricProvider(null);
    setNativeQrScanner(null);
    clearDemoWalletId();
    clearLockoutState();
    delete window.Capacitor;
    delete window.BarcodeDetector;
    delete navigator.share;
    delete navigator.canShare;
    delete navigator.clipboard;
    vi.restoreAllMocks();
});

describe('mobile-only surfaces use the shared kit', () => {
    it('keeps biometric unlock on a full-width medium kit button', async () => {
        setBiometricProvider({
            name: 'mobile-test',
            isSupported: vi.fn(async () => true),
            isRegistered: vi.fn(() => true),
            register: vi.fn(),
            unlock: vi.fn(),
            clear: vi.fn(),
        });
        render(withMessaging(<Locked />, { unlockWallet: vi.fn() }));

        const biometric = await screen.findByRole('button', { name: 'Use biometrics' });
        expect(biometric).toHaveClass(buttonStyles.btn, buttonStyles.md, buttonStyles.block);
        expect(biometric.closest(`.${screenStyles.screen}`)).toBeTruthy();
    });

    it('keeps the deep-link notice inside safe areas and the responsive gutter', () => {
        render(<NoticeModal title="Cannot open link" message="That link is not supported." onClose={() => {}} />);

        const dialog = screen.getByRole('dialog', { name: 'Cannot open link' });
        expect(dialog).toHaveClass(overlayStyles.overlay, overlayStyles.dialogOverlay);
        expect(screen.getByRole('button', { name: 'OK' })).toHaveClass(
            buttonStyles.btn,
            buttonStyles.md,
            buttonStyles.block,
        );

        const css = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/OverlaySurface.module.css',
        ), 'utf8');
        const overlayRule = css.match(/\.dialogOverlay\s*\{[^}]*\}/)?.[0] || '';
        expect(overlayRule).toContain('var(--xc-space-4)');
        for (const edge of ['top', 'right', 'bottom', 'left']) {
            expect(overlayRule).toContain(`env(safe-area-inset-${edge}, 0px)`);
        }
        expect(css).not.toMatch(
            /@media \(orientation: landscape\)[\s\S]*?\.overlay\s*\{[^}]*padding/,
        );
    });

    it('uses medium kit controls for native and pasted QR scanning', () => {
        setNativeQrScanner({ start: vi.fn(() => new Promise(() => {})) });
        window.Capacitor = { isNativePlatform: () => true };
        const native = render(<QrScanner onFrame={() => {}} alt="Scan a QR code" />);

        expect(screen.getByTestId('qr-scanner-native')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Scan with camera' })).toHaveClass(
            buttonStyles.btn,
            buttonStyles.md,
        );

        native.unmount();
        render(<ScanRoute onClassified={() => {}} onBack={() => {}} />);
        expect(screen.getByTestId('scan-route')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Use pasted text' })).toHaveClass(
            buttonStyles.btn,
            buttonStyles.md,
        );
        expect(screen.getByRole('heading', { name: 'Scan' }).closest(`.${screenStyles.screen}`))
            .toBeTruthy();
    });

    it('covers a suspended app with the shared Screen and tokenized scanner layer', () => {
        render(withMessaging(<Loading />));
        expect(document.querySelector(`.${screenStyles.screen}`)).toBeTruthy();

        const app = readFileSync(resolve(process.cwd(), 'packages/web/src/App.jsx'), 'utf8');
        expect(app).toMatch(/if \(nativeSuspended && status\.state === 'unlocked'\) return <Loading \/>/);
        expect(app).toMatch(/aria-labelledby="xc-global-scanner-title"[\s\S]*?zIndex: 'var\(--xc-z-overlay\)'/);
        expect(app).not.toMatch(/aria-labelledby="xc-global-scanner-title"[\s\S]{0,500}?zIndex: 50/);
    });

    it('opens the native share sheet from a medium kit button', async () => {
        const share = vi.fn(async () => {});
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn(async () => {}) },
        });
        const messaging = {
            getSettings: vi.fn(async () => ({
                schemaVersion: 1,
                activeNetwork: 'regtest',
                fees: { 'bitcoin-regtest': { strategy: 'normal' } },
            })),
            getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [ADDRESS] })),
            getNewestAddress: vi.fn(async () => ADDRESS),
        };
        render(withMessaging(<Receive walletId="wallet-1" accountId="account-1" />, messaging));

        const trigger = await screen.findByRole('button', { name: 'Share QR payment link' });
        await waitFor(() => expect(trigger).toBeEnabled());
        expect(trigger).toHaveClass(buttonStyles.btn, buttonStyles.md);
        fireEvent.click(trigger);
        await waitFor(() => expect(share).toHaveBeenCalledOnce());
    });
});
