// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { useTablistKeys } from '../../../packages/core/src/shared/keyboard/useTablistKeys.js';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const TICK = 'KEYPROBE';
const HOLDERS = [
    { address: 'bcrt1qholderone00000000000000000000000', amount: '8' },
    { address: 'bcrt1qholdertwo00000000000000000000000', amount: '5' },
];

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
    });
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function KeyboardRoot({ children }) {
    useTablistKeys();
    return children;
}

function messaging(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: 'bcrt1qcreator000000000000000000000000',
            marketPrice: '0.5',
            totalSupply: '1000',
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: HOLDERS }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function detailProps(overrides = {}) {
    return {
        walletId: 'demo-wallet',
        chainId: CHAIN,
        tick: TICK,
        kind: 'token',
        quantity: '10',
        divisibility: 0,
        onBack: vi.fn(),
        ...overrides,
    };
}

function mount(props = {}, messagingOverrides = {}) {
    render(
        <KeyboardRoot>
            <MessagingProvider shell="web" messaging={messaging(messagingOverrides)}>
                <TokenDetail {...detailProps(props)} />
            </MessagingProvider>
        </KeyboardRoot>,
    );
}

function keyboardActivate(control) {
    control.focus();
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.click(control, { detail: 0 });
}

describe('TokenDetail keyboard navigation', () => {
    it('reaches and activates quick actions in their visual order', async () => {
        const onSend = vi.fn();
        const onReceive = vi.fn();
        const onBuy = vi.fn();
        const onViewActivity = vi.fn();
        const onManageToken = vi.fn();
        const creator = 'bcrt1qcreator000000000000000000000000';
        mount(
            { onSend, onReceive, onBuy, onViewActivity, onManageToken },
            { getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: creator }] }) },
        );

        await screen.findByRole('button', { name: 'Manage' });
        const actions = within(screen.getByRole('group', { name: 'Quick actions' }))
            .getAllByRole('button');
        expect(actions.map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual([
            'Send',
            'Receive',
            'Trade',
            'History',
            'Manage',
        ]);
        expect(actions.map((button) => button.tabIndex)).toEqual([0, 0, 0, 0, 0]);
        expect(actions.every((button) => button.getAttribute('aria-busy') === 'false')).toBe(true);

        const handlers = [onSend, onReceive, onBuy, onViewActivity, onManageToken];
        actions.forEach((button, index) => {
            keyboardActivate(button);
            expect(document.activeElement).toBe(button);
            expect(handlers[index]).toHaveBeenCalledTimes(1);
        });
    });

    it('moves through chart ranges with arrows and keeps one range in the Tab order', async () => {
        mount();

        const ranges = await screen.findByRole('tablist', { name: 'Chart range' });
        const tabs = within(ranges).getAllByRole('tab');
        const selected = within(ranges).getByRole('tab', { name: '30d' });
        expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([selected]);

        selected.focus();
        fireEvent.keyDown(selected, { key: 'ArrowRight' });
        const next = within(ranges).getByRole('tab', { name: '90d' });
        expect(document.activeElement).toBe(next);
        expect(next).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByLabelText('90d price chart')).toBeTruthy();

        fireEvent.keyDown(next, { key: 'Home' });
        const first = within(ranges).getByRole('tab', { name: '24h' });
        expect(document.activeElement).toBe(first);
        expect(first).toHaveAttribute('aria-selected', 'true');
    });

    it('opens the holders list with arrows and reaches every holder control', async () => {
        mount();

        const about = await screen.findByRole('tab', { name: 'About' });
        about.focus();
        fireEvent.keyDown(about, { key: 'ArrowLeft' });
        const unlock = screen.getByRole('tab', { name: 'Unlock' });
        expect(document.activeElement).toBe(unlock);
        expect(unlock).toHaveAttribute('aria-selected', 'true');

        const holders = await screen.findByRole('region', { name: 'Holders' });
        const copyButtons = within(holders).getAllByRole('button', { name: /Copy holder address/ });
        expect(copyButtons.map((button) => button.tabIndex)).toEqual([0, 0]);
        copyButtons.forEach(keyboardActivate);
        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(1, HOLDERS[0].address);
            expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(2, HOLDERS[1].address);
        });
    });

    it('returns focus to the balance row that opened the detail page', async () => {
        function BackHarness() {
            const [open, setOpen] = useState(false);
            return (
                <MessagingProvider shell="web" messaging={messaging()}>
                    {open ? (
                        <TokenDetail {...detailProps({ walletId: 'wallet', onBack: () => setOpen(false) })} />
                    ) : (
                        <div data-balance-key={`${CHAIN}:${TICK}`}>
                            <button type="button" onClick={() => setOpen(true)}>Open KEYPROBE details</button>
                        </div>
                    )}
                </MessagingProvider>
            );
        }

        render(<BackHarness />);
        const opener = screen.getByRole('button', { name: 'Open KEYPROBE details' });
        keyboardActivate(opener);
        keyboardActivate(await screen.findByRole('button', { name: 'Back to previous screen' }));

        await waitFor(() => expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Open KEYPROBE details' }),
        ));
    });
});
