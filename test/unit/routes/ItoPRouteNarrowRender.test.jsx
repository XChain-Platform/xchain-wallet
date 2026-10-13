// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const routeCss = (fileName) => readFileSync(
    resolve(process.cwd(), `packages/core/src/shared/routes/${fileName}`),
    'utf8',
);
const importWalletCss = routeCss('ImportWallet.module.css');
const issueTokenCss = routeCss('IssueTokenForm.module.css');
const myTokensCss = routeCss('MyTokens.module.css');
const pairSignerCss = routeCss('PairSignerForm.module.css');

const VIEWPORT_WIDTH = 320;
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qnarrowviewportexample',
    publicKey: `02${'a'.repeat(64)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mount(route, messaging = {}) {
    return render(
        <MessagingProvider
            shell="web"
            messaging={{ getSettings: vi.fn().mockResolvedValue({}), ...messaging }}
        >
            {route}
        </MessagingProvider>,
    );
}

function expectNoFixedWidthBeyondViewport(container, css) {
    const offenders = [];
    for (const element of container.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        for (const property of ['width', 'minWidth']) {
            const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(style[property]);
            const pixels = match && Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
            if (pixels && pixels > VIEWPORT_WIDTH) {
                offenders.push(`${element.tagName.toLowerCase()}.${element.className}:${property}=${match[0]}`);
            }
        }
    }
    for (const match of css.matchAll(/(?:^|[;{])\s*(?:width|min-width):\s*(\d+(?:\.\d+)?)(px|rem)/gi)) {
        const pixels = Number(match[1]) * (match[2].toLowerCase() === 'rem' ? 16 : 1);
        if (pixels > VIEWPORT_WIDTH) offenders.push(match[0].trim());
    }
    expect(offenders).toEqual([]);
}

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
    document.documentElement.style.width = `${VIEWPORT_WIDTH}px`;
    document.body.style.width = `${VIEWPORT_WIDTH}px`;
    Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    document.documentElement.style.width = '';
    document.body.style.width = '';
    Reflect.deleteProperty(navigator, 'hid');
});

describe('I through P route rendering at 320px', () => {
    it('keeps ImportWallet contained with its primary action present', () => {
        const { container } = mount(
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />,
        );

        expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
        expectNoFixedWidthBeyondViewport(container, importWalletCss);
    });

    it('keeps LinkForm contained with its primary action present', async () => {
        const addresses = {
            [CHAIN]: [ADDRESS],
            'litecoin-mainnet': [{ ...ADDRESS, id: 'address-2', address: 'ltc1qnarrowviewportexample' }],
        };
        const { container } = mount(
            <LinkForm walletId="wallet-1" onBack={() => {}} />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue(addresses),
                getActiveAddresses: vi.fn().mockResolvedValue({}),
                signerReady: vi.fn().mockResolvedValue({ ready: false }),
            },
        );

        expect(await screen.findByRole('button', { name: /^(Review|Link)$/ })).toBeInTheDocument();
        expectNoFixedWidthBeyondViewport(container, issueTokenCss);
    });

    it('keeps MintForm contained with its primary action present', async () => {
        const { container } = mount(
            <MintForm
                walletId="wallet-1"
                initialChainId={CHAIN}
                initialTick="NARROW"
                onBack={() => {}}
            />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
                getActiveAddresses: vi.fn().mockResolvedValue({}),
                getTokenInfo: vi.fn().mockResolvedValue({
                    chainId: CHAIN,
                    tick: 'NARROW',
                    maxSupply: '1000',
                    totalSupply: '100',
                    divisibility: 0,
                    locks: {},
                }),
                listContacts: vi.fn().mockResolvedValue([]),
            },
        );

        expect(await screen.findByRole('button', { name: 'Mint' })).toBeInTheDocument();
        expectNoFixedWidthBeyondViewport(container, issueTokenCss);
    });

    it('keeps MyTokens contained with its primary action present', async () => {
        const { container } = mount(
            <MyTokens
                walletId="wallet-1"
                onBack={() => {}}
                onIssue={() => {}}
                onSelectTick={() => {}}
            />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
                getOwnedTokens: vi.fn().mockResolvedValue([]),
            },
        );

        expect(await screen.findByRole('button', { name: 'Issue new token' })).toBeInTheDocument();
        expectNoFixedWidthBeyondViewport(container, myTokensCss);
    });

    it('keeps PairSignerForm contained with its primary action and long labels present', async () => {
        const label = 'S'.repeat(40);
        const { container } = mount(
            <PairSignerForm
                walletId="wallet-1"
                pairTrezor={vi.fn()}
                pairLedger={vi.fn()}
                onBack={() => {}}
            />,
            {
                listSigners: vi.fn().mockResolvedValue([{
                    id: 'signer-1',
                    vendor: 'trezor',
                    model: 'safe-3',
                    label,
                }]),
            },
        );

        expect(screen.getByRole('button', { name: /Trezor/ })).toBeInTheDocument();
        await screen.findByText(label);
        const identityRule = pairSignerCss.match(/\.pairedIdentity\s*\{[^}]*\}/s)?.[0] || '';
        expect(identityRule).toMatch(/overflow-wrap:\s*anywhere/);
        expectNoFixedWidthBeyondViewport(container, pairSignerCss);
    });
});
