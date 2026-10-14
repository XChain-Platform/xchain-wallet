// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
    settings: {},
    variantState: { variant: 'full', source: 'auto', viewportPx: 1200 },
}));

vi.mock('@xchain-wallet/core/shared/MessagingProvider.jsx', () => ({
    MessagingProvider: ({ shell, children }) => <section data-testid="shell" data-shell={shell}>{children}</section>,
}));

vi.mock('@xchain-wallet/core/shared/components/ToastHost.jsx', () => ({
    ToastHost: ({ children }) => children,
    useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx', () => ({
    RouteErrorBoundary: () => null,
}));

vi.mock('@xchain-wallet/core/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: controls.settings }),
}));

vi.mock('../../../packages/web/src/components/ExtensionBanner.jsx', () => ({
    ExtensionBanner: () => <div data-testid="extension-banner" />,
}));

vi.mock('../../../packages/web/src/DevVariantBadge.jsx', () => ({
    DevVariantBadge: ({ state }) => <div data-testid="variant-badge">{state.variant}</div>,
}));

vi.mock('../../../packages/web/src/devVariant.js', () => ({
    useActiveVariant: () => controls.variantState,
    shellForVariant: (variant) => variant === 'full' ? 'web' : 'popup',
}));

import { App } from '../../../packages/web/src/App.jsx';

function wrapperClasses() {
    const shell = screen.getByTestId('shell');
    const page = shell.firstElementChild;
    return [page.className, page.firstElementChild.className];
}

afterEach(() => {
    cleanup();
    controls.settings = {};
    controls.variantState = { variant: 'full', source: 'auto', viewportPx: 1200 };
});

describe('web app variant branches', () => {
    it('selects each preview wrapper and messaging shell', () => {
        const { rerender } = render(<App />);
        const full = wrapperClasses();
        expect(screen.getByTestId('shell')).toHaveAttribute('data-shell', 'web');

        controls.variantState = { variant: 'small', source: 'auto', viewportPx: 390 };
        rerender(<App />);
        expect(wrapperClasses()).toEqual(full);
        expect(screen.getByTestId('shell')).toHaveAttribute('data-shell', 'popup');

        controls.variantState = { variant: 'small', source: 'url', viewportPx: 1200 };
        rerender(<App />);
        const small = wrapperClasses();
        expect(small).not.toEqual(full);

        controls.variantState = { variant: 'sidebar', source: 'url', viewportPx: 1200 };
        rerender(<App />);
        const sidebar = wrapperClasses();
        expect(sidebar).not.toEqual(full);
        expect(sidebar).not.toEqual(small);

        controls.variantState = { variant: 'extension', source: 'url', viewportPx: 1200 };
        rerender(<App />);
        const extension = wrapperClasses();
        expect(extension).not.toEqual(full);
        expect(extension).not.toEqual(sidebar);
    });

    it('shows the variant badge only when both developer settings allow it', async () => {
        const { rerender } = render(<App />);
        expect(screen.queryByTestId('variant-badge')).toBeNull();

        controls.settings = { developerMode: true, showVariantBadge: false };
        rerender(<App />);
        expect(screen.queryByTestId('variant-badge')).toBeNull();

        controls.settings = { developerMode: true, showVariantBadge: true };
        rerender(<App />);
        // The badge is a lazy chunk, loaded only once both settings allow it.
        expect(await screen.findByTestId('variant-badge')).toHaveTextContent('full');
    });
});
