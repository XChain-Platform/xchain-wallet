// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RenameAccountForm } from '../../../packages/core/src/shared/routes/RenameAccountForm.jsx';
import { RouteNotFound } from '../../../packages/core/src/shared/routes/RouteNotFound.jsx';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import { VerifySignatureForm } from '../../../packages/core/src/shared/routes/VerifySignatureForm.jsx';
import { ViewPrivateKey } from '../../../packages/core/src/shared/routes/ViewPrivateKey.jsx';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => <div aria-label="QR scanner" /> };
});

const VIEWPORT_WIDTH = 320;
const viewportDescriptors = {};

function setViewportProperty(target, key) {
    viewportDescriptors[key] = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, value: VIEWPORT_WIDTH });
}

function restoreViewportProperty(target, key) {
    const descriptor = viewportDescriptors[key];
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
}

beforeAll(() => {
    setViewportProperty(window, 'innerWidth');
    setViewportProperty(document.documentElement, 'clientWidth');
});

afterAll(() => {
    restoreViewportProperty(window, 'innerWidth');
    restoreViewportProperty(document.documentElement, 'clientWidth');
});

function renderRoute(route, messaging = {}) {
    return render(
        <MessagingProvider
            shell="popup"
            messaging={{ getSettings: vi.fn().mockResolvedValue({}), ...messaging }}
        >
            {route}
        </MessagingProvider>,
    );
}

function expectNoFixedWidthBeyondViewport(container) {
    const offenders = [];
    for (const element of [container, ...container.querySelectorAll('*')]) {
        const style = getComputedStyle(element);
        for (const property of ['width', 'minWidth']) {
            const value = style[property];
            if (/^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) > VIEWPORT_WIDTH) {
                offenders.push(`${element.tagName.toLowerCase()}.${property}=${value}`);
            }
        }
        const widthAttribute = element.getAttribute?.('width');
        if (/^\d+(?:\.\d+)?$/.test(widthAttribute || '')
            && Number(widthAttribute) > VIEWPORT_WIDTH) {
            offenders.push(`${element.tagName.toLowerCase()}[width=${widthAttribute}]`);
        }
    }
    expect(offenders).toEqual([]);
}

describe('Q through Z routes at a 320px viewport', () => {
    it('keeps Rename account within the viewport and shows Save', () => {
        const { container } = renderRoute(
            <RenameAccountForm
                accountId="account-1"
                walletId="wallet-1"
                initialName="Everyday"
                onBack={vi.fn()}
                onRenamed={vi.fn()}
            />,
            { listAccounts: vi.fn().mockResolvedValue([]) },
        );

        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
        expectNoFixedWidthBeyondViewport(container);
    });

    it('keeps the missing-route recovery within the viewport and shows Back to Home', () => {
        const { container } = renderRoute(<RouteNotFound onHome={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Back to Home' })).toBeEnabled();
        expectNoFixedWidthBeyondViewport(container);
    });

    it('keeps Scan within the viewport and shows its paste action', () => {
        const { container } = renderRoute(
            <ScanRoute onBack={vi.fn()} onClassified={vi.fn()} />,
        );

        expect(screen.getByRole('button', { name: 'Use pasted text' })).toBeInTheDocument();
        expectNoFixedWidthBeyondViewport(container);
    });

    it('keeps Verify signature within the viewport and shows Verify signature', () => {
        const { container } = renderRoute(<VerifySignatureForm onBack={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Verify signature' })).toBeInTheDocument();
        expectNoFixedWidthBeyondViewport(container);
    });

    it('keeps View private key within the viewport and shows its continue action', () => {
        const { container } = renderRoute(
            <ViewPrivateKey
                walletId="wallet-1"
                address={{
                    id: 'address-1',
                    address: 'bc1qexampleexampleexampleexampleexampleexample',
                    source: 'hd',
                    chain: 'bitcoin',
                    network: 'mainnet',
                    derivationPath: "m/84'/0'/0'/0/0",
                    label: 'Savings',
                }}
                onBack={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: 'I understand, continue' })).toBeEnabled();
        expectNoFixedWidthBeyondViewport(container);
    });
});
