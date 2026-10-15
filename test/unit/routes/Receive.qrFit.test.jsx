// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Receive sizes its QR from the route scroller's height as well as its width,
// so the 360x600 extension popup shows the code, the address and the Copy row
// together without scrolling. The 42px clip this guards: at 600px tall a
// width-sized 300px code pushed the address below the bottom navigation.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: () => {}, dismissToast: () => {}, clearToasts: () => {} }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

// jsdom has no canvas; a fixed PNG lets the QR image render.
vi.mock('qrcode', () => ({
    default: { toDataURL: async () => 'data:image/png;base64,iVBORw0KGgo=' },
}));

const { Receive, qrFitSize, QR_FIT_MIN_SIZE } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const css = readFileSync('packages/core/src/shared/routes/Receive.module.css', 'utf8');
const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] || '';

const ADDRESS = {
    id: 'a1',
    address: 'bcrt1qexample',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: '',
};

function rect(top, height, width = 300) {
    return {
        top, bottom: top + height, height, left: 0, right: width, width, x: 0, y: top, toJSON() {},
    };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('qrFitSize', () => {
    it('gives the QR the scroller height the address and Copy row leave', () => {
        // The measured 360x600 side panel: a 430px scroller with 12px bottom
        // padding, the code 97px down its content and 171px from the code's
        // bottom to the Copy row's bottom.
        expect(qrFitSize({ viewportHeight: 430, paddingBottom: 12, contentTop: 97, belowQr: 171 }))
            .toBe(150);
    });

    it('stays out of the way when the code would be too small to scan', () => {
        expect(qrFitSize({ viewportHeight: 277, paddingBottom: 12, contentTop: 97, belowQr: 171 }))
            .toBeNull();
        expect(qrFitSize({
            viewportHeight: 280 + QR_FIT_MIN_SIZE, paddingBottom: 0, contentTop: 109, belowQr: 171,
        })).toBe(QR_FIT_MIN_SIZE);
    });

    it('returns null before layout', () => {
        expect(qrFitSize({ viewportHeight: 0, contentTop: 0, belowQr: 0 })).toBeNull();
        expect(qrFitSize({ viewportHeight: 430, contentTop: Number.NaN, belowQr: 171 })).toBeNull();
    });
});

describe('Receive QR height fit', () => {
    it('caps the QR surface at the measured height budget', async () => {
        const messaging = {
            getSettings: async () => ({
                schemaVersion: 1,
                activeNetwork: 'regtest',
                fees: { 'bitcoin-regtest': { strategy: 'normal' } },
            }),
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [ADDRESS] }),
            getNewestAddress: async () => ADDRESS,
        };
        const { container } = render(
            <div data-testid="scroller" style={{ overflowY: 'auto', paddingBottom: '12px' }}>
                <MessagingProvider shell="web" messaging={messaging}>
                    <Receive walletId="w1" accountId="acct-1" />
                </MessagingProvider>
            </div>,
        );
        const scroller = container.querySelector('[data-testid="scroller"]');
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 430 });
        const qr = await screen.findByRole('img', { name: /^QR code for / });
        const surface = qr.parentElement;
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measured() {
            if (this === scroller) return rect(114, 430, 360);
            if (this === surface) return rect(211, 300);
            if (/^Copy (QR code|payment link)$/.test(this.getAttribute('aria-label') || '')) return rect(646, 36, 159);
            return rect(0, 0, 0);
        });

        fireEvent(window, new Event('resize'));

        await waitFor(() => expect(surface.style.getPropertyValue('--xc-qr-fit-size')).toBe('150px'));
    });

    it('takes the smaller of the width cap and the height budget in CSS', () => {
        expect(rule('.qrSurface')).toMatch(
            /max-width:\s*min\(var\(--xc-qr-frame-size\), var\(--xc-qr-fit-size, var\(--xc-qr-frame-size\)\)\);/,
        );
        // The landscape-phone cap keeps its own viewport term alongside.
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 3\/2\) \{[\s\S]*?max-width: min\(var\(--xc-qr-frame-size\), var\(--xc-qr-fit-size, var\(--xc-qr-frame-size\)\), calc\(var\(--xc-viewport-h, 100vh\) - 11rem\)\);/,
        );
    });
});
