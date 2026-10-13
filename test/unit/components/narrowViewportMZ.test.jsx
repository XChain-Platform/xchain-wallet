// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const haptic = vi.hoisted(() => ({
    error: vi.fn(),
    success: vi.fn(),
    tap: vi.fn(),
    warn: vi.fn(),
    vibrate: vi.fn(),
    supported: false,
    reducedMotion: false,
}));

vi.mock('../../../packages/core/src/shared/hooks/useHaptic.js', async () => {
    const React = await import('react');
    return {
        useHaptic: () => haptic,
        useHapticFeedback: () => haptic,
        HapticProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    };
});

import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { PlatformSwitcher } from '../../../packages/core/src/shared/components/PlatformSwitcher.jsx';
import { ToastHost, useToast } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { TokenField } from '../../../packages/core/src/shared/components/TokenField.jsx';
import { WatcherResultPanel } from '../../../packages/core/src/shared/components/WatcherResultPanel.jsx';

const css = (name) => readFileSync(
    `packages/core/src/shared/components/${name}.module.css`,
    'utf8',
);

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function renderAt320(component) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    return render(<div data-testid="narrow-viewport" style={{ width: 320 }}>{component}</div>);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

describe('shared M to Z components at a 320px viewport', () => {
    it('keeps the searchable NetworkFilter toolbar inside its container', () => {
        const families = ['bitcoin', 'litecoin', 'dogecoin', 'ethereum', 'solana', 'dash', 'cosmos'];
        const chainRegistry = {
            byCoin: (coin) => [{ id: `${coin}-mainnet`, displayName: `${coin} network` }],
        };
        renderAt320(
            <NetworkFilter
                chainRegistry={chainRegistry}
                coinFamilies={families}
                value="all"
                onChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /All networks/ }));
        expect(screen.getByRole('listbox')).toBeVisible();
        expect(screen.getByRole('searchbox', { name: 'Search networks' })).toBeVisible();

        const source = css('NetworkFilter');
        expect(source).toMatch(/\.wrap\s*\{[^}]*min-width:\s*0/s);
        expect(source).toMatch(/\.trigger\s*\{[^}]*box-sizing:\s*border-box/s);
        expect(source).toMatch(/\.search\s*\{[^}]*min-width:\s*0/s);
        expect(source).toMatch(/\.item\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0/s);
    });

    it('contains a NoticeModal card with long content and a reachable action', () => {
        const longText = 'confirmation'.repeat(30);
        renderAt320(
            <NoticeModal
                title={longText}
                message={longText}
                confirmLabel="Continue"
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByRole('dialog')).toHaveTextContent(longText);
        expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();

        const source = css('NoticeModal');
        expect(source).toMatch(/\.overlay\s*\{[^}]*box-sizing:\s*border-box/s);
        expect(source).toMatch(/\.panel\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0/s);
        expect(source).toMatch(/\.title\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });

    it('bounds the open PlatformSwitcher toolbar menu to the phone viewport', () => {
        renderAt320(<PlatformSwitcher current="wallet" />);
        fireEvent.click(screen.getByRole('button', { name: 'XChain platform sites' }));

        expect(screen.getByRole('menu')).toBeVisible();
        expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(1);

        const source = css('PlatformSwitcher');
        expect(source).toMatch(/\.menu\s*\{[^}]*box-sizing:\s*border-box[^}]*max-width:\s*calc\(100vw/s);
        expect(source).toMatch(/\.item,\s*\n\.here\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0/s);
        expect(source).toMatch(/\.item > span:first-child,\s*\n\.here > span:first-child\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });

    it('contains a TokenField row with an exceptionally long selection', () => {
        const ticker = 'ANEXCEPTIONALLYLONGTOKENNAME'.repeat(4);
        renderAt320(
            <TokenField
                label="Asset"
                value={{ chainId: 'bitcoin-regtest', tick: ticker }}
                onOpenPicker={vi.fn()}
                error="A validation message that must remain inside the field row."
            />,
        );

        expect(screen.getByRole('button', { name: new RegExp(ticker) })).toBeVisible();
        expect(screen.getByRole('alert')).toBeVisible();

        const source = css('TokenField');
        expect(source).toMatch(/\.field\s*\{[^}]*min-width:\s*0/s);
        expect(source).toMatch(/\.control\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0/s);
        expect(source).toMatch(/\.placeholder\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/s);
        expect(source).toMatch(/\.error\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });

    it('reflows a ToastHost card with a long message and action label', () => {
        let toastApi;
        function CaptureToastApi() {
            toastApi = useToast();
            return null;
        }
        renderAt320(
            <ToastHost>
                <CaptureToastApi />
            </ToastHost>,
        );
        act(() => {
            toastApi.showToast({
                id: 'narrow-toast',
                message: 'The notification message remains readable at phone width.',
                actionLabel: 'Review this notification action',
                onAction: vi.fn(),
                durationMs: 0,
            });
        });

        expect(screen.getByText(/notification message remains readable/)).toBeVisible();
        expect(screen.getByRole('button', { name: 'Review this notification action' })).toBeVisible();

        const source = css('ToastHost');
        expect(source).toMatch(/\.toast\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0/s);
        expect(source).toMatch(/@media \(max-width:\s*360px\)[\s\S]*\.toast\s*\{[^}]*flex-wrap:\s*wrap/s);
        expect(source).toMatch(/@media \(max-width:\s*360px\)[\s\S]*\.controls\s*\{[^}]*flex:\s*1 1 100%/s);
        expect(source).toMatch(/\.actionBtn\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });

    it('contains the WatcherResultPanel section, payload, and action row', () => {
        const title = 'Unsignedtransaction'.repeat(24);
        renderAt320(
            <WatcherResultPanel
                result={{
                    psbtHex: 'deadbeef'.repeat(40),
                    encoding: 'psbt'.repeat(30),
                    fromAddress: 'bc1q'.repeat(30),
                }}
                title={title}
                onBuildAnother={vi.fn()}
                onDone={vi.fn()}
            />,
        );

        expect(screen.getByRole('region', { name: title })).toBeVisible();
        expect(screen.getByRole('heading', { name: title }).className).toMatch(/title/);
        expect(screen.getByRole('textbox', { name: 'Unsigned transaction hex' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Build another' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();

        const source = css('WatcherResultPanel');
        expect(source).toMatch(/\.successTxidBlock textarea\s*\{[^}]*box-sizing:\s*border-box[^}]*max-width:\s*100%/s);
        expect(source).toMatch(/\.actions\s*\{[^}]*flex-wrap:\s*wrap[^}]*min-width:\s*0/s);
    });
});
