// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Quick Give/Get cards have no Network field: the picked asset decides the
// network, and on the cards the asset icon's network badge is the only place
// it shows (no "on Bitcoin" text, no separate network control). The From
// section's network follows the picked asset, so picking an asset on another
// network moves the form and its From address to that network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { GiveGetQuick } from '../../../packages/core/src/shared/components/giveGet/GiveGetQuick.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const BTC_SOURCE = { id: 'btc-0', address: 'bc1qbtcsourcebtcsourcebtcsourcebtcsource0', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's' };
const LTC_SOURCE = { id: 'ltc-0', address: 'ltc1qltcsourceltcsourceltcsourceltcsourc0', publicKey: '02bb', derivationPath: "m/84'/2'/0'/0/0", source: 'hd', signerId: 's' };
const NETWORK_WORDS = /\b(Bitcoin|Litecoin|Dogecoin)\b/;


beforeEach(() => {
    try { localStorage.clear(); } catch { /* storage is optional */ }
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

async function drain(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

// The Network field is named "Network: <chain>"; the fee row's own controls
// ("Network fee ...") are not a network field.
function networkControls(root) {
    return [...root.querySelectorAll('[aria-label]')]
        .filter((el) => /^Network(:|$)/.test(el.getAttribute('aria-label') || ''));
}

describe('<GiveGetQuick> asset chips', () => {
    it('show the asset icon and ticker with no network text or network control', () => {
        const side = (label, tick) => ({
            label,
            asset: { chainId: LTC, tick },
            assetLabel: 'Token',
            onOpenAsset: () => {},
            amount: '',
            onAmountChange: () => {},
            amountLabel: `${label} amount`,
        });
        const { container } = render(<GiveGetQuick give={side('You give', 'PEPE')} get={side('You get', 'XCP')} />);

        // The visible card text names no network; the accessible name still says it.
        expect(container.textContent).not.toMatch(NETWORK_WORDS);
        expect(screen.getByRole('button', { name: 'Token: PEPE on Litecoin' })).toBeTruthy();
        expect(networkControls(container)).toHaveLength(0);
    });
});

function dispenserMessaging() {
    return {
        getAddressesByChain: () => Promise.resolve({ [BTC]: [BTC_SOURCE], [LTC]: [LTC_SOURCE] }),
        getActiveAddresses: () => Promise.resolve({
            [BTC]: { id: BTC_SOURCE.id, address: BTC_SOURCE.address },
            [LTC]: { id: LTC_SOURCE.id, address: LTC_SOURCE.address },
        }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({
            [BTC]: [{ address: BTC_SOURCE.address, balances: { tokens: [{ tick: 'JDOG', quantity: '1000', divisibility: 0 }] } }],
            [LTC]: [{ address: LTC_SOURCE.address, balances: { tokens: [{ tick: 'LTOK', quantity: '1000', divisibility: 0 }] } }],
        }),
        getListByActionIndex: () => Promise.resolve(null),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
    };
}

describe('Quick Dispenser', () => {
    it('has no Network field on its cards, and a token on another network moves the form and its From there', async () => {
        const base = dispenserMessaging();
        const messaging = new Proxy(base, {
            get(target, prop) {
                return prop in target ? target[prop] : () => Promise.resolve(undefined);
            },
        });
        let utils;
        await act(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <DispenserForm walletId="w" initialChainId={BTC} onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });

        const fromSection = () => utils.container.querySelector('[data-form-section="from"]');
        const cards = () => [...utils.container.querySelectorAll('section[aria-label^="You "]')];
        const fromNetwork = () => networkControls(fromSection())[0];
        await waitFor(() => expect(fromSection().textContent).toContain('bc1q...rce0'));
        // The From section's Network field is the token's, locked to it.
        expect(fromNetwork().getAttribute('aria-label')).toBe('Network: Bitcoin');
        expect(fromNetwork()).toBeDisabled();
        expect(cards()).toHaveLength(2);
        for (const card of cards()) expect(networkControls(card)).toHaveLength(0);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Token: / }));
            await drain();
        });
        const ltok = await screen.findByRole('button', { name: (name) => name.startsWith('Select LTOK on Litecoin') });
        await act(async () => {
            fireEvent.click(ltok);
            await drain();
        });

        // The give chip now holds the Litecoin token, and From moved with it.
        expect(screen.getByRole('button', { name: 'Token: LTOK on Litecoin' })).toBeTruthy();
        await waitFor(() => expect(fromSection().textContent).toContain('ltc1...urc0'));
        expect(fromNetwork().getAttribute('aria-label')).toBe('Network: Litecoin');
        // The cards still show the network only as the icon badge.
        for (const card of cards()) {
            expect(networkControls(card)).toHaveLength(0);
            expect(within(card).queryByText(NETWORK_WORDS)).toBeNull();
        }
    });
});

// No Give/Get form passes a network control into its Quick cards.
describe.each([
    'CreateOrderForm', 'DispenserForm', 'SwapForm', 'CrossChainSwapForm', 'CrossChainOrderForm',
])('%s', (form) => {
    it('gives its Quick cards no network', () => {
        const src = readFileSync(`packages/core/src/shared/routes/${form}.jsx`, 'utf8');
        const quick = src.slice(src.indexOf('<GiveGetQuick'));
        expect(quick).not.toMatch(/^\s*network:/m);
    });
});
