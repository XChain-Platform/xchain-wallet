// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Receive's Copy QR and Share QR toasts speak plain words. What the
// Clipboard and Web Share APIs throw ("Failed to execute 'write' on
// 'Clipboard': Document is not focused.") is developer text, so it goes to
// the log and the toast says what failed in the user's terms.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const showToast = vi.fn();
const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast, dismissToast: () => {}, clearToasts: () => {} }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

// jsdom has no canvas, so the real encoder cannot draw the QR; a fixed PNG
// data URL lets the Copy and Share buttons enable.
vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};
const ADDRESS = {
    id: 'a1',
    address: 'bcrt1qexample',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'Daily deposits',
};
const BROWSER_TEXT = "Failed to execute 'write' on 'Clipboard': Document is not focused.";

function renderReceive(overrides = {}) {
    const messaging = {
        getSettings: async () => REGTEST_SETTINGS,
        getAddressesByChain: async () => ({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: async () => ADDRESS,
        ...overrides,
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="w1" accountId="acct-1" />
        </MessagingProvider>,
    );
}

/** Install the clipboard and share surfaces the screen feature-detects. */
function stubBrowser({ write, share }) {
    globalThis.ClipboardItem = class ClipboardItem {
        constructor(items) { this.items = items; }
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
}

async function clickWhenEnabled(name) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
}

let consoleError;
beforeEach(() => {
    showToast.mockClear();
    qrToDataURL.mockReset();
    qrToDataURL.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    consoleError.mockRestore();
    delete globalThis.ClipboardItem;
    delete navigator.clipboard;
    delete navigator.share;
    delete navigator.canShare;
});

describe('Receive QR copy and share toasts', () => {
    it('copies the same BIP21 payment request that the QR encodes', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderReceive();

        const amount = await screen.findByRole('textbox', { name: /^Amount/ });
        fireEvent.change(amount, { target: { value: '0.00000001' } });
        await waitFor(() => expect(qrToDataURL.mock.calls.some(
            ([value]) => value.includes('amount=0.00000001'),
        )).toBe(true));
        const paymentRequest = qrToDataURL.mock.calls.findLast(
            ([value]) => value.includes('amount=0.00000001'),
        )[0];

        expect(paymentRequest).toMatch(
            /^bitcoin:bcrt1qexample\?chain=bitcoin-regtest&feePriority=normal&amount=0\.00000001$/,
        );
        fireEvent.click(screen.getByDisplayValue(ADDRESS.address));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(paymentRequest));
        expect(showToast).toHaveBeenCalledWith({
            message: 'Payment request copied to clipboard.',
        });
    });

    it('converts fiat to coin precision and updates both QR and copied request', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderReceive();

        fireEvent.click(await screen.findByRole('button', { name: /Switch input to USD/ }));
        const amount = screen.getByRole('textbox', { name: 'Amount (USD)' });
        fireEvent.change(amount, { target: { value: '10.123456789' } });

        expect(amount).toHaveValue('10.123456789');
        await waitFor(() => expect(qrToDataURL.mock.calls.some(
            ([value]) => value.includes('amount=0.00020247'),
        )).toBe(true));
        const paymentRequest = qrToDataURL.mock.calls.findLast(
            ([value]) => value.includes('amount=0.00020247'),
        )[0];

        fireEvent.click(screen.getByDisplayValue(ADDRESS.address));
        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(paymentRequest));
    });

    it('clears the amount from the QR and copied request', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderReceive();
        const amount = await screen.findByRole('textbox', { name: 'Amount (BTC)' });

        fireEvent.change(amount, { target: { value: '1.25' } });
        await waitFor(() => expect(qrToDataURL.mock.calls.some(
            ([value]) => value.includes('amount=1.25'),
        )).toBe(true));
        fireEvent.change(amount, { target: { value: '' } });
        fireEvent.click(screen.getByDisplayValue(ADDRESS.address));
        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(
            `bitcoin:${ADDRESS.address}`,
        ));
        await waitFor(() => expect(qrToDataURL).toHaveBeenLastCalledWith(
            `bitcoin:${ADDRESS.address}`,
            expect.any(Object),
        ));
    });

    it('shows plain copy-failure text and logs the browser message', async () => {
        stubBrowser({
            write: vi.fn(async () => { throw new Error(BROWSER_TEXT); }),
            share: vi.fn(async () => {}),
        });
        renderReceive();

        await clickWhenEnabled(/Copy QR/);

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        const messages = showToast.mock.calls.map(([t]) => t.message);
        expect(messages).toEqual(['Copy failed: clipboard unavailable']);
        expect(messages.join(' ')).not.toContain('Document is not focused');
        expect(consoleError.mock.calls.some(([, err]) => err?.message === BROWSER_TEXT)).toBe(true);
    });

    it('shows plain share-failure text for a non-cancel share error', async () => {
        stubBrowser({
            write: vi.fn(async () => {}),
            share: vi.fn(async () => {
                throw Object.assign(new Error('NotAllowedError: Permission denied by user agent.'), {
                    name: 'NotAllowedError',
                });
            }),
        });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        const messages = showToast.mock.calls.map(([t]) => t.message);
        expect(messages).toEqual(['Share failed: share unavailable']);
        expect(messages.join(' ')).not.toContain('Permission denied');
    });

    it('stays silent when the user closes the share sheet', async () => {
        const share = vi.fn(async () => {
            throw Object.assign(new Error('Share canceled'), { name: 'AbortError' });
        });
        stubBrowser({ write: vi.fn(async () => {}), share });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect(showToast).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    });
});

describe('Receive address handling', () => {
    it('switches supported address types, generates that type, shows its label, and copies its request', async () => {
        const legacy = {
            id: 'a2',
            address: 'mlegacyexample',
            addressType: 'p2pkh',
            derivationPath: "m/44'/0'/0'/0/2",
            source: 'hd',
            label: 'Legacy deposits',
        };
        const generated = {
            id: 'a3',
            address: 'mnewlegacyexample',
            addressType: 'p2pkh',
            derivationPath: "m/44'/0'/0'/0/3",
            source: 'hd',
            label: 'BTC Address #4',
        };
        const generateReceiveAddress = vi.fn(async () => generated);
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderReceive({
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [ADDRESS, legacy] }),
            generateReceiveAddress,
        });

        expect(await screen.findByLabelText('Daily deposits')).toHaveValue(ADDRESS.address);
        fireEvent.change(screen.getByLabelText('Address type'), { target: { value: 'p2pkh' } });
        expect(await screen.findByLabelText('Legacy deposits')).toHaveValue(legacy.address);

        fireEvent.click(screen.getByRole('button', { name: /Generate new address/ }));
        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledWith({
            walletId: 'w1',
            accountId: 'acct-1',
            chainId: 'bitcoin-regtest',
            addressType: 'p2pkh',
        }));
        const generatedField = await screen.findByLabelText('BTC Address #4');
        expect(generatedField).toHaveValue(generated.address);

        fireEvent.click(generatedField);
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(writeText.mock.calls.at(-1)[0]).toBe(`bitcoin:${generated.address}`);
        expect(qrToDataURL.mock.calls.at(-1)[0]).toBe(`bitcoin:${generated.address}`);
    });

    it('shows amount validation and never encodes a rejected value', async () => {
        renderReceive();
        const amount = await screen.findByRole('textbox', { name: /^Amount/ });

        fireEvent.change(amount, { target: { value: '1.123456789' } });

        expect(await screen.findByRole('alert')).toHaveTextContent('at most 8 decimal places');
        expect(amount).toHaveValue('');
        expect(qrToDataURL.mock.calls.some(([value]) => value.includes('1.123456789'))).toBe(false);

        fireEvent.change(amount, { target: { value: '1.12345678' } });
        await waitFor(() => expect(screen.queryByText(/at most 8 decimal places/)).toBeNull());
        await waitFor(() => expect(qrToDataURL.mock.calls.some(
            ([value]) => value.includes('amount=1.12345678'),
        )).toBe(true));
    });

    it('hides an old QR while the current payment request is still rendering', async () => {
        /** @type {Array<(value: string) => void>} */
        const resolveQr = [];
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        qrToDataURL.mockImplementation(() => new Promise((resolve) => resolveQr.push(resolve)));
        renderReceive();

        await waitFor(() => expect(resolveQr).toHaveLength(1));
        resolveQr[0]('data:image/png;base64,aW5pdGlhbA==');
        expect(await screen.findByRole('img', { name: /QR code for/ })).toBeInTheDocument();

        fireEvent.change(screen.getByRole('textbox', { name: /^Amount/ }), {
            target: { value: '2' },
        });
        await waitFor(() => expect(resolveQr).toHaveLength(2));
        expect(screen.queryByRole('img', { name: /QR code for/ })).toBeNull();
        expect(screen.getByText('Rendering QR…')).toBeInTheDocument();
        fireEvent.click(screen.getByDisplayValue(ADDRESS.address));
        await waitFor(() => expect(writeText.mock.calls.at(-1)[0]).toContain('amount=2'));

        resolveQr[1]('data:image/png;base64,Y3VycmVudA==');
        const currentQr = await screen.findByRole('img', { name: /QR code for/ });
        expect(currentQr).toHaveAttribute('src', 'data:image/png;base64,Y3VycmVudA==');
    });
});
