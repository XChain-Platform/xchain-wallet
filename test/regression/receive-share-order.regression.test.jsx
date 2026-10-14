// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

const showToast = vi.fn();
const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast, dismissToast: () => {}, clearToasts: () => {} }),
}));

vi.mock('../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const { Receive } = await import('../../packages/core/src/shared/routes/Receive.jsx');

const ADDRESS = {
    id: 'receive-share-address',
    address: 'bcrt1qsharefallback',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'Share fallback',
};

function renderReceive() {
    const messaging = {
        getSettings: vi.fn(async () => ({
            schemaVersion: 1,
            activeNetwork: 'regtest',
            fees: { 'bitcoin-regtest': { strategy: 'normal' } },
        })),
        getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [ADDRESS] })),
        getNewestAddress: vi.fn(async () => ADDRESS),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="wallet-1" accountId="account-1" />
        </MessagingProvider>,
    );
}

function exposeWebShare(share) {
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
}

function exposeClipboard(writeText) {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
}

function exposeNativePlatform(plugins) {
    globalThis.Capacitor = {
        isNativePlatform: () => true,
        Plugins: plugins,
    };
}

// The shells expose sharing on their own App plugin; no Share plugin ships.
function exposeNativeShare(share) {
    exposeNativePlatform({ App: { share } });
}

async function clickShare() {
    const button = await screen.findByRole('button', { name: 'Share QR payment link' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
}

beforeEach(() => {
    showToast.mockClear();
    qrToDataURL.mockClear();
});

afterEach(() => {
    cleanup();
    delete globalThis.Capacitor;
    delete navigator.clipboard;
    delete navigator.share;
    delete navigator.canShare;
});

describe('regression/receive-share-order', () => {
    it('[REGRESSION P1] prefers the native share bridge over Web Share', async () => {
        const nativeShare = vi.fn(async () => {});
        const webShare = vi.fn(async () => {});
        const writeText = vi.fn(async () => {});
        exposeNativeShare(nativeShare);
        exposeWebShare(webShare);
        exposeClipboard(writeText);
        renderReceive();

        await clickShare();

        await waitFor(() => expect(nativeShare.mock.calls.length + webShare.mock.calls.length)
            .toBeGreaterThan(0));
        expect(nativeShare).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Receive BTC with XChain',
            text: 'Send BTC to this XChain wallet.',
            url: 'bitcoin:bcrt1qsharefallback',
        }));
        expect(webShare).not.toHaveBeenCalled();
        expect(writeText).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] uses Web Share when no native share bridge is exposed', async () => {
        const webShare = vi.fn(async () => {});
        const writeText = vi.fn(async () => {});
        exposeNativePlatform({});
        exposeWebShare(webShare);
        exposeClipboard(writeText);
        renderReceive();

        await clickShare();

        await waitFor(() => expect(webShare).toHaveBeenCalledTimes(1));
        expect(writeText).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] copies the payment link and explains the fallback last', async () => {
        const writeText = vi.fn(async () => {});
        exposeClipboard(writeText);
        renderReceive();

        await clickShare();

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(
            'bitcoin:bcrt1qsharefallback',
        ));
        expect(showToast).toHaveBeenCalledWith({
            message: 'Sharing is unavailable, so the payment link was copied to the clipboard.',
        });
    });
});
