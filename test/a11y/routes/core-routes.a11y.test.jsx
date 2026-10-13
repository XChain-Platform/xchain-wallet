// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=') },
}));

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
// A chain with a fee entry on the active network, so the routes render their
// forms instead of the no-networks state that empty default fees produce.
const SETTINGS = {
    ...createDefaultSettings(),
    fees: { [CHAIN]: { strategy: 'normal', rbfByDefault: false } },
};

function pending() {
    return new Promise(() => {});
}

function messaging(overrides = {}) {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'address-1',
                address: ADDRESS,
                addressType: 'p2wpkh',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: 'address-1', address: ADDRESS },
        }),
        getNewestAddress: vi.fn().mockResolvedValue({
            id: 'address-1',
            address: ADDRESS,
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: ADDRESS,
            description: 'A token used by the accessibility fixture.',
            supply: '1000',
        }),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function renderRoute(route, host = messaging()) {
    return render(
        <MessagingProvider shell="web" messaging={host}>
            <ToastHost>{route}</ToastHost>
        </MessagingProvider>,
    );
}

let originalResizeObserver;
beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        disconnect() {}
    };
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('high-use route accessibility', () => {
    it('scans the loaded Send form', async () => {
        const { container } = renderRoute(
            <Send walletId="wallet-1" onBack={() => {}} />,
        );
        await screen.findByLabelText('To');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded Receive request', async () => {
        const { container } = renderRoute(
            <Receive walletId="wallet-1" onBack={() => {}} />,
        );
        await screen.findByRole('textbox', { name: 'Copy payment request for receive address' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a confirmed History detail', async () => {
        const entry = {
            key: `${CHAIN}:42:${ADDRESS}`,
            chainId: CHAIN,
            address: ADDRESS,
            actionIndex: '42',
            action: 'SEND',
            blockIndex: 900000,
            timestamp: Date.now() - 60_000,
            txHash: 'a'.repeat(64),
            source: ADDRESS,
            destination: ADDRESS,
            quantity: '10000000',
            tick: 'BTC',
            raw: { source: ADDRESS, destination: ADDRESS },
            link: null,
        };
        const { container } = renderRoute(
            <ActionDetail entry={entry} walletId="wallet-1" onBack={() => {}} />,
        );
        await screen.findByRole('heading', { name: 'Send #42' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a loaded TokenDetail overview', async () => {
        const { container } = renderRoute(
            <TokenDetail
                walletId="wallet-1"
                chainId={CHAIN}
                tick="A11Y"
                kind="token"
                displayName="Accessibility Token"
                quantity="250"
                divisibility={0}
                onBack={() => {}}
                onSend={() => {}}
                onReceive={() => {}}
                onViewActivity={() => {}}
            />,
        );
        await screen.findByRole('heading', { name: 'Accessibility Token' });
        await screen.findByText('A token used by the accessibility fixture.');
        await expectNoSeriousAxeViolations(container);
    });
});

afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
});
