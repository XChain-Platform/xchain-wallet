// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { BalanceList } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { EntryRow } from '../../../packages/core/src/shared/routes/History.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { formatAtomicAmount } from '../../../packages/core/src/shared/utils/amountFormat.js';

const balanceCss = readFileSync('packages/core/src/shared/components/BalanceList.module.css', 'utf8');
const historyCss = readFileSync('packages/core/src/shared/routes/History.module.css', 'utf8');
const tokenDetailCss = readFileSync('packages/core/src/shared/routes/TokenDetail.module.css', 'utf8');
const walletPickerCss = readFileSync('packages/core/src/shared/routes/WalletPicker.module.css', 'utf8');
const pageHeaderCss = readFileSync('packages/core/src/ui/PageHeader.module.css', 'utf8');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('long content layout', () => {
    it('ellipsizes balance labels while fitting every digit of a huge amount', () => {
        const displayName = 'A token name long enough to occupy every narrow balance-row label lane';
        const quantity = '12345678901234567890123456789012345678901234567890';
        const formattedQuantity = formatAtomicAmount(quantity, 0);

        render(
            <BalanceList
                rows={[{
                    chainId: 'bitcoin-mainnet',
                    tick: 'EXTRAORDINARILYLONGTICKER',
                    kind: 'token',
                    displayName,
                    quantity,
                    divisibility: 0,
                    fiatRate: null,
                }]}
                onSelectToken={() => {}}
            />,
        );

        expect(screen.getByTitle(displayName)).toHaveTextContent(displayName);
        expect(screen.getByTitle('EXTRAORDINARILYLONGTICKER')).toBeInTheDocument();
        expect(screen.getByTitle(formattedQuantity)).toHaveTextContent(formattedQuantity);
        expect(rule(balanceCss, '.name')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(balanceCss, '.amountFitInner')).toMatch(/transform-origin:\s*right center/);
        expect(rule(balanceCss, '.qty')).not.toMatch(/text-overflow:\s*ellipsis/);
    });

    it('keeps a full history address and pending amount available without digit ellipsis', () => {
        const address = `bc1q${'addresssegment'.repeat(12)}`;
        const amount = '1234567890123456789012345678901234567890';
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <ul>
                    <EntryRow
                        entry={{
                            key: 'bitcoin-mainnet:pending-long',
                            action: 'SEND',
                            actionIndex: 'pending-long',
                            chainId: 'bitcoin-mainnet',
                            source: address,
                            status: 'pending',
                            pending: { direction: 'out' },
                            raw: { destination: 'bc1qdestination', amount, tick: 'BTC' },
                        }}
                        selected={false}
                        showConnector={false}
                        onClick={() => {}}
                        peerCache={{}}
                        walletId="wallet-long"
                    />
                </ul>
            </MessagingProvider>,
        );

        expect(screen.getByTitle(address)).toHaveTextContent(address);
        // The amount is shown digit-grouped; every digit must still be there.
        const pendingAmount = document.querySelector('[data-pending-amount]');
        expect(pendingAmount.getAttribute('title').replace(/,/g, '')).toContain(amount);
        expect(pendingAmount.textContent.replace(/,/g, '')).toContain(amount);
        expect(rule(historyCss, '.rowSourceAddress')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(historyCss, '.pendingAmount')).toMatch(/overflow-x:\s*auto/);
        expect(rule(historyCss, '.pendingAmount')).not.toMatch(/text-overflow:\s*ellipsis/);
    });

    it('exposes the complete TokenDetail title inside the shared header ellipsis lane', () => {
        const displayName = 'A token title that is much wider than a phone header can display without collision';
        const messaging = {
            getTokenInfo: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-regtest': [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };

        render(
            <MessagingProvider shell="popup" messaging={messaging}>
                <TokenDetail
                    walletId="wallet-long"
                    chainId="bitcoin-regtest"
                    tick="VERYLONGTICK"
                    kind="token"
                    displayName={displayName}
                    quantity="123456789012345678901234567890"
                    divisibility={0}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(screen.getByRole('heading', { name: displayName })).toBeInTheDocument();
        expect(screen.getByTitle(displayName)).toHaveTextContent(displayName);
        expect(rule(tokenDetailCss, '.headerTitle')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(pageHeaderCss, '.titleGroup')).toMatch(/overflow:\s*hidden/);
    });

    it('ellipsizes a wallet name but preserves its full accessible button name and tooltip', async () => {
        const walletName = 'A wallet name that remains identifiable even when the switcher is extremely narrow';
        await act(async () => {
            render(
                <MessagingProvider
                    shell="popup"
                    messaging={{ listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-long', name: walletName, format: 'bip39' }]) }}
                >
                    <WalletPicker
                        activeWalletId={null}
                        onSwitch={() => {}}
                        onAddWallet={() => {}}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );
        });

        expect(await screen.findByTitle(walletName)).toHaveTextContent(walletName);
        expect(screen.getByRole('button', { name: new RegExp(walletName) })).toBeInTheDocument();
        expect(rule(walletPickerCss, '.rowText > span')).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('retains a complete string title on a generic PageHeader', () => {
        const title = 'A page heading long enough to cross both fixed action lanes on a narrow viewport';
        render(<PageHeader title={title} onBack={() => {}} trailing={<button type="button">Action</button>} />);

        expect(screen.getByRole('heading', { name: title })).toHaveAttribute('title', title);
        expect(rule(pageHeaderCss, '.title')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(rule(pageHeaderCss, '.title')).not.toMatch(/text-overflow:\s*ellipsis/);
    });
});
