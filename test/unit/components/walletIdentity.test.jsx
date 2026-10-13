// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { MessageConfirmScreen } from '../../../packages/core/src/shared/components/MessageConfirmScreen.jsx';
import { WALLET_TONES, walletIdentityTone } from '../../../packages/core/src/shared/components/WalletIdentity.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { clearActiveWallet, writeActiveWallet } from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

afterEach(() => {
    cleanup();
    clearActiveWallet();
});

const wallets = [
    { id: 'wallet-main', name: 'Main Wallet', format: 'bip39' },
    { id: 'wallet-cold', name: 'Cold Reserve', format: 'bip39' },
];

function readyConfirm() {
    return {
        phase: 'ready',
        composed: null,
        report: null,
        acknowledged: new Set(),
        acknowledge: () => {},
        canApprove: true,
        approve: () => {},
        reject: () => {},
        error: null,
        source: null,
    };
}

describe('wallet identity surfaces', () => {
    it('keeps the same wallet tone and name in the header and switcher', async () => {
        const header = render(<AppHeader activeWallet={wallets[1]} />);
        const headerIdentity = screen.getByTestId('wallet-identity');
        expect(headerIdentity).toHaveTextContent('CR');
        expect(headerIdentity).toHaveTextContent('Cold Reserve');
        expect(headerIdentity).toHaveAttribute('data-wallet-tone', String(walletIdentityTone('wallet-cold')));
        header.unmount();

        render(
            <MessagingProvider shell="popup" messaging={{ listWallets: async () => wallets }}>
                <WalletPicker
                    activeWalletId="wallet-cold"
                    onSwitch={() => {}}
                    onAddWallet={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const activeRow = await screen.findByRole('button', { name: /Cold Reserve/ });
        const pickerIdentity = within(activeRow).getByTestId('wallet-identity');
        expect(pickerIdentity).toHaveAttribute('data-wallet-tone', headerIdentity.getAttribute('data-wallet-tone'));
        expect(activeRow).toHaveAttribute('aria-current', 'true');
    });

    it('names the signing wallet even when a confirmation has no source address', async () => {
        const messaging = { listWallets: async () => wallets };
        render(
            <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
                <ActionConfirmScreen
                    confirmAction={readyConfirm()}
                    walletId="wallet-cold"
                    chainLabel="Bitcoin"
                    signerReady
                    password=""
                    onPasswordChange={() => {}}
                />
            </MessagingContext.Provider>,
        );

        await waitFor(() => {
            const identity = screen.getByTestId('wallet-identity');
            expect(identity).toHaveTextContent('Signing with');
            expect(identity).toHaveTextContent('Cold Reserve');
            expect(identity).toHaveAttribute('data-wallet-tone', String(walletIdentityTone('wallet-cold')));
        });
    });

    it('resolves the active wallet when a confirm adapter does not supply identity', async () => {
        writeActiveWallet('wallet-main');
        const messaging = { listWallets: async () => wallets };
        render(
            <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
                <MessageConfirmScreen
                    confirmAction={readyConfirm()}
                    message="Authorize this session"
                    chainLabel="Bitcoin"
                    signingAddress="bc1qsigningaddress"
                    signerReady
                    password=""
                    onPasswordChange={() => {}}
                />
            </MessagingContext.Provider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('wallet-identity')).toHaveTextContent('Main Wallet');
        });
    });
});

// Reads one block of tokens.css (the block that opens at `selector {`) into a map.
function tokenBlock(css, selector) {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
    const body = css.slice(start, css.indexOf('}', start));
    const tokens = {};
    for (const [, name, value] of body.matchAll(/(--xc-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
        tokens[name] = value;
    }
    return tokens;
}

function rgb(hex) {
    return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(channels) {
    const [r, g, b] = channels.map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('wallet identity avatar contrast', () => {
    // The tone is picked by hashing a random wallet id, so an axe run only
    // meets whichever tone that run's wallet drew. Check every tone here.
    it('keeps the 10px initials at 4.5:1 on every tone tint in light and dark themes', () => {
        const css = readFileSync('packages/core/src/shared/components/WalletIdentity.module.css', 'utf8');
        const avatar = css.slice(css.indexOf('.avatar {'), css.indexOf('}', css.indexOf('.avatar {')));
        expect(avatar).toMatch(/background:\s*color-mix\(in srgb, var\(--xc-wallet-identity\) 14%, var\(--xc-surface\)\)/);
        const textToken = avatar.match(/\n\s*color:\s*var\((--xc-[\w-]+)\)/)?.[1];
        expect(textToken).toBe('--xc-text');

        const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        expect(WALLET_TONES.length).toBeGreaterThan(0);
        const light = tokenBlock(tokensCss, ':root');
        const dark = { ...light, ...tokenBlock(tokensCss, ':root[data-xc-theme="dark"]') };
        for (const [theme, tokens] of Object.entries({ light, dark })) {
            for (const entry of WALLET_TONES) {
                const tone = entry.match(/^var\((--xc-[\w-]+)\)$/)?.[1];
                expect(tokens[tone], `${theme} ${entry} resolves to a hex token`).toMatch(/^#[0-9a-fA-F]{6}$/);
                const tint = rgb(tokens[tone]).map((value, i) => 0.14 * value + 0.86 * rgb(tokens['--xc-surface'])[i]);
                const ratio = contrast(rgb(tokens[textToken]), tint);
                expect(ratio, `${theme} ${tone}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });
});
