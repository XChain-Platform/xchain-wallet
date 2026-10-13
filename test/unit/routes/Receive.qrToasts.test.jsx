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
import { userEvent } from '../../helpers/userEvent.js';

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

const { Receive, qrPixelSizeFor } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

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
const MOBILE_ADDRESS = 'bcrt1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
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
function stubBrowser({ write, writeText, share, canShare = () => true }) {
    globalThis.ClipboardItem = class ClipboardItem {
        constructor(items) { this.items = items; }
    };
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { ...(write ? { write } : {}), ...(writeText ? { writeText } : {}) },
    });
    if (share) {
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    }
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
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
    it('does not render fee controls or fee estimates', async () => {
        renderReceive();

        expect(await screen.findByRole('textbox', { name: 'Amount (BTC)' })).toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: /fee/i })).toBeNull();
        expect(screen.queryByText(/network fee|sat\/vB|fee estimate/i)).toBeNull();
        expect(screen.queryByText('0.000015 BTC')).toBeNull();
    });

    it.each([320, 360])('keeps the receive request usable at %ipx', async (viewportWidth) => {
        const originalInnerWidth = window.innerWidth;
        const originalResizeObserver = globalThis.ResizeObserver;
        const measuredQrWidth = viewportWidth - 42;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
        globalThis.ResizeObserver = class ResizeObserver {
            constructor(callback) { this.callback = callback; }
            observe(target) {
                this.callback([{ target, contentRect: { width: measuredQrWidth } }]);
            }
            disconnect() {}
        };

        try {
            renderReceive({
                getAddressesByChain: async () => ({
                    'bitcoin-regtest': [{ ...ADDRESS, address: MOBILE_ADDRESS }],
                }),
                getNewestAddress: async () => ({ ...ADDRESS, address: MOBILE_ADDRESS }),
            });

            expect(await screen.findByText(MOBILE_ADDRESS)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^Token:/ })).toBeInTheDocument();
            expect(screen.getByRole('textbox', { name: /^Amount/ })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Copy payment request' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Share QR' })).toBeInTheDocument();
            await waitFor(() => expect(qrToDataURL).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    margin: 4,
                    width: measuredQrWidth,
                }),
            ));
        } finally {
            globalThis.ResizeObserver = originalResizeObserver;
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: originalInnerWidth,
            });
        }
    });

    it('tabs from token to amount and keeps Enter on the live request form', async () => {
        const user = userEvent.setup();
        renderReceive();
        const amount = await screen.findByRole('textbox', { name: 'Amount (BTC)' });
        const token = await screen.findByRole('button', { name: /^Token:/ });
        token.focus();

        await user.tab();
        expect(document.activeElement).toBe(amount);
        fireEvent.change(amount, { target: { value: '1.25' } });
        await user.keyboard('{Enter}');

        expect(amount).toHaveValue('1.25');
        expect(screen.getByRole('form', { name: 'Receive request' })).toBeInTheDocument();
        expect(showToast).not.toHaveBeenCalled();
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Switch input to USD' }));
    });

    it('adds and edits the label of the receive address shown', async () => {
        const unlabeled = { ...ADDRESS, label: '' };
        const setAddressLabel = vi.fn().mockResolvedValue({ ok: true });
        renderReceive({
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [unlabeled] }),
            getNewestAddress: async () => unlabeled,
            setAddressLabel,
        });

        const label = await screen.findByRole('textbox', { name: 'Address label' });
        expect(label).toHaveValue('');
        fireEvent.change(label, { target: { value: '  Client invoices  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save label' }));

        await waitFor(() => expect(setAddressLabel).toHaveBeenCalledWith('a1', 'Client invoices'));
        expect(label).toHaveValue('Client invoices');

        fireEvent.change(label, { target: { value: 'Invoice 204' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save label' }));
        await waitFor(() => expect(setAddressLabel).toHaveBeenLastCalledWith('a1', 'Invoice 204'));
        expect(setAddressLabel).toHaveBeenCalledTimes(2);
    });

    it('renders a four-module quiet zone at the measured device-pixel width', async () => {
        const originalResizeObserver = globalThis.ResizeObserver;
        const originalDevicePixelRatio = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2.5 });
        globalThis.ResizeObserver = class ResizeObserver {
            constructor(callback) { this.callback = callback; }
            observe(target) {
                this.callback([{ target, contentRect: { width: 320 } }]);
            }
            disconnect() {}
        };

        try {
            renderReceive();

            await waitFor(() => expect(qrToDataURL).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    margin: 4,
                    width: 800,
                    color: { dark: '#0F172A', light: '#FFFFFF' },
                }),
            ));
            const address = await screen.findByRole('textbox', { name: 'Copy payment request for receive address' });
            expect(address.readOnly).toBe(true);
            expect(address.style.userSelect).toBe('text');
        } finally {
            globalThis.ResizeObserver = originalResizeObserver;
            Object.defineProperty(window, 'devicePixelRatio', {
                configurable: true,
                value: originalDevicePixelRatio,
            });
        }
    });

    it('rounds fractional device pixels up and falls back before layout', () => {
        expect(qrPixelSizeFor(319.5, 2)).toBe(639);
        expect(qrPixelSizeFor(320, 3)).toBe(960);
        expect(qrPixelSizeFor(0, 3)).toBe(512);
    });

    it('copies the same BIP21 payment request that the QR encodes', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderReceive();

        expect(await screen.findByRole('textbox', {
            name: 'Copy payment request for receive address',
        })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copy payment request' })).toBeTruthy();
        const amount = await screen.findByRole('textbox', { name: /^Amount/ });
        fireEvent.change(amount, { target: { value: '0.00000001' } });
        await waitFor(() => expect(qrToDataURL.mock.calls.some(
            ([value]) => value.includes('amount=0.00000001'),
        )).toBe(true));
        const paymentRequest = qrToDataURL.mock.calls.findLast(
            ([value]) => value.includes('amount=0.00000001'),
        )[0];

        expect(paymentRequest).toMatch(
            /^bitcoin:bcrt1qexample\?chain=bitcoin-regtest&amount=0\.00000001&label=Daily%20deposits$/,
        );
        fireEvent.click(screen.getByDisplayValue(ADDRESS.address));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(paymentRequest));
        expect(showToast).toHaveBeenCalledWith({
            message: 'Payment request copied to clipboard.',
            variant: 'default',
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

        await clickWhenEnabled('Copy QR code');

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        const messages = showToast.mock.calls.map(([t]) => t.message);
        expect(messages).toEqual(['Copy failed: clipboard unavailable']);
        expect(showToast).toHaveBeenCalledWith({
            message: 'Copy failed: clipboard unavailable',
            variant: 'error',
        });
        expect(messages.join(' ')).not.toContain('Document is not focused');
        expect(consoleError.mock.calls.some(([, err]) => err?.message === BROWSER_TEXT)).toBe(true);
    });

    it('shares a title, text, and the exact payment URL when Web Share is available', async () => {
        const share = vi.fn(async () => {});
        const writeText = vi.fn(async () => {});
        stubBrowser({ writeText, share, canShare: () => false });
        renderReceive();

        const amount = await screen.findByRole('textbox', { name: /^Amount/ });
        fireEvent.change(amount, { target: { value: '0.00000001' } });
        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        expect(share).toHaveBeenCalledWith({
            title: 'Receive BTC with XChain',
            text: 'Send 0.00000001 BTC to this XChain wallet.',
            url: 'bitcoin:bcrt1qexample?chain=bitcoin-regtest&amount=0.00000001&label=Daily%20deposits',
        });
        expect(writeText).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('keeps Share QR available and copies the payment URL when Web Share is absent', async () => {
        const writeText = vi.fn(async () => {});
        stubBrowser({ writeText });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        // With no amount or token the request is the bare address URI.
        expect(writeText).toHaveBeenCalledWith('bitcoin:bcrt1qexample');
        expect(showToast).toHaveBeenCalledWith({
            message: 'Share unavailable. Payment request copied to clipboard.',
        });
    });

    it('copies with a toast when Web Share rejects for a non-cancel reason', async () => {
        const writeText = vi.fn(async () => {});
        stubBrowser({
            writeText,
            share: vi.fn(async () => {
                throw Object.assign(new Error('NotAllowedError: Permission denied by user agent.'), {
                    name: 'NotAllowedError',
                });
            }),
        });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        const messages = showToast.mock.calls.map(([t]) => t.message);
        expect(messages).toEqual(['Share unavailable. Payment request copied to clipboard.']);
        expect(messages.join(' ')).not.toContain('Permission denied');
    });

    it('stays silent when the user closes the share sheet', async () => {
        const writeText = vi.fn(async () => {});
        const share = vi.fn(async () => {
            throw Object.assign(new Error('Share canceled'), { name: 'AbortError' });
        });
        stubBrowser({ writeText, share });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect(writeText).not.toHaveBeenCalled();
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
