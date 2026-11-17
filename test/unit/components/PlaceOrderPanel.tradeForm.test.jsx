// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Trade page's form (PlaceOrderPanel layout="trade"): the Expiration
// field is the wallet's IconSelect, the network fee is the Form Standard
// Network fee section with the protocol fee in its summary and its pick on the
// wire, the Limit / Fill now chips use the brand selected fill, the swap
// cards sit 8px apart, and the wide page is one card around one column.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { displayRateToSettingsCustom, estimateNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};
const QUOTE = Object.freeze({ xchainFee: '0.064', requiredFeeSats: 197 });

afterEach(() => { cleanup(); resetWalletModes(); });

function mount(props = {}, methods = {}) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'full' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        quoteProtocolFee: vi.fn().mockResolvedValue(QUOTE),
        composeForConfirm: vi.fn().mockResolvedValue({ ok: false, error: { message: 'stop here' } }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        ...methods,
    };
    const utils = render(
        <MessagingProvider shell="desktop" messaging={messaging}>
            <PlaceOrderPanel
                walletId="w"
                chainId={CHAIN}
                tick1="XCHAIN"
                tick2="BTC"
                layout="trade"
                view="market"
                bestBid="1.9"
                bestAsk="2.1"
                {...props}
            />
        </MessagingProvider>,
    );
    return { messaging, ...utils };
}

async function fillOrder() {
    fireEvent.change(await screen.findByLabelText('Price'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '2' } });
}

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Trade form: Expiration', () => {
    it('is the IconSelect dropdown, not a native select, and its Custom choice opens the date field', async () => {
        const { container } = mount();
        const trigger = await screen.findByRole('button', { name: 'Expiration: 1 week' });
        expect(container.querySelector('select')).toBeNull();
        expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');

        fireEvent.click(trigger);
        const list = screen.getByRole('listbox');
        expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
            '1 day', '1 week', '1 month', 'Default window', 'Custom…',
        ]);
        fireEvent.click(within(list).getByRole('option', { name: 'Custom…' }));
        expect(screen.getByRole('button', { name: 'Expiration: Custom…' })).toBeInTheDocument();
        expect(screen.getByLabelText('Custom expiration')).toBeInTheDocument();
    });

    it('sends the picked preset as the order EXPIRATION', async () => {
        const { messaging } = mount();
        await fillOrder();
        fireEvent.click(await screen.findByRole('button', { name: 'Expiration: 1 week' }));
        fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '1 day' }));
        const before = Math.floor(Date.now() / 1000);
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const expiration = Number(messaging.composeForConfirm.mock.calls[0][0].actionData.params.EXPIRATION);
        expect(expiration).toBeGreaterThanOrEqual(before + 86400);
        expect(expiration).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 86400);
    });
});

describe('Trade form: Speed and Fees section', () => {
    it('is one closed row whose summary carries the protocol fee, opening in place to the slider and the pay-in-coin switch', async () => {
        const { container } = mount();
        await fillOrder();
        const header = await screen.findByRole('button', { name: /^Speed and Fees/ });
        expect(header).toHaveAttribute('aria-expanded', 'false');
        // The protocol fee arrives from an async read; a loaded full-suite run
        // can take past the default 1 s.
        await waitFor(() => expect(header).toHaveTextContent('0.064 XCHAIN'), { timeout: 10_000 });
        expect(container.querySelectorAll('[data-form-section="fee"]')).toHaveLength(1);

        const body = document.getElementById(header.getAttribute('aria-controls'));
        expect(body).toHaveAttribute('hidden');
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(body).not.toHaveAttribute('hidden');
        expect(within(body).getByRole('slider', { name: 'Network fee' })).toBeInTheDocument();
        expect(within(body).getByRole('switch', { name: 'Pay protocol fee in BTC' })).toBeInTheDocument();
        // The fee lines (network, protocol) live inside the section only, as
        // plain lines with no nested fees card, and no Total in the form.
        expect(container.querySelector('[data-fees-card]')).toBeNull();
        const protocolRows = [...container.querySelectorAll('[data-fees-row="protocol"]')];
        expect(protocolRows).toHaveLength(1);
        expect(body.contains(protocolRows[0])).toBe(true);
        // Opening the section re-reads the fee, so the line can show
        // "Calculating" for a moment before the value settles.
        await waitFor(() => expect(container.querySelector('[data-fees-row="protocol"]'))
            .toHaveTextContent('0.064 XCHAIN'), { timeout: 10_000 });
        expect(container.querySelector('[data-fees-row="total"]')).toBeNull();
    });

    // G120: the forfeit warning is a static note under the pay-in-coin
    // switch, there whether it is on or off; flipping the switch changes no
    // notice on the form.
    it('keeps the forfeit note static and changes no notice when the pay-in-coin switch is flipped', async () => {
        const { container } = mount();
        await fillOrder();
        const header = await screen.findByRole('button', { name: /^Speed and Fees/ });
        fireEvent.click(header);
        const body = document.getElementById(header.getAttribute('aria-controls'));
        const toggle = within(body).getByRole('switch', { name: 'Pay protocol fee in BTC' });
        const note = within(body).getByTestId('native-fee-note');
        expect(note).toHaveTextContent('If you pay the protocol fee in BTC and the network rejects this transaction, that fee is forfeited');
        expect(note).not.toHaveAttribute('role');
        const notices = () => container.querySelectorAll('[data-tone], [data-field-note]').length;
        const before = notices();
        const wasOn = toggle.checked;
        fireEvent.click(toggle);
        expect(toggle.checked).toBe(!wasOn);
        expect(notices()).toBe(before);
        expect(within(body).getByTestId('native-fee-note')).toBe(note);
        fireEvent.click(toggle);
        expect(notices()).toBe(before);
        expect(within(body).getByTestId('native-fee-note')).toBe(note);
    });

    it('prices the broadcast at the picked speed', async () => {
        const tiers = estimateNativeSendFeeTiers({ chainId: CHAIN, chainRegistry: defaultRegistry() });
        const fastPerKb = displayRateToSettingsCustom(tiers.fast.unit, tiers.fast.rateValue);
        const { messaging } = mount();
        await fillOrder();
        fireEvent.click(await screen.findByRole('button', { name: /^Speed and Fees/ }));
        // Slow, Normal, Fast, Custom: the slider's third stop is Fast.
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '2' } });
        expect(screen.getByRole('slider', { name: 'Network fee' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Fast: /));
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(fastPerKb).toBeGreaterThan(0);
        expect(messaging.composeForConfirm.mock.calls[0][0].encoderOpts.feePerKb).toBe(fastPerKb);
    });

    it('leaves the standalone panel on its fixed estimate with no feePerKb', async () => {
        const { messaging } = mount({ layout: 'panel' });
        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '2' } });
        expect(screen.queryByRole('button', { name: /^Network fee/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Place Buy Order' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].encoderOpts?.feePerKb).toBeUndefined();
    });
});

describe('Trade form: swap chips and spacing', () => {
    it('keeps Limit and Fill now as pressed toggles with their icons', async () => {
        mount({ view: 'swap' });
        const limit = await screen.findByRole('button', { name: /^Limit / });
        const fill = screen.getByRole('button', { name: 'Fill now at 2.1 BTC' });
        expect(limit).toHaveAttribute('aria-pressed', 'true');
        expect(fill).toHaveAttribute('aria-pressed', 'false');
        expect(limit.querySelector('svg')).not.toBeNull();
        expect(fill.querySelector('svg')).not.toBeNull();
        fireEvent.click(fill);
        expect(fill).toHaveAttribute('aria-pressed', 'true');
        expect(limit).toHaveAttribute('aria-pressed', 'false');
    });

    it('draws the chosen chip in the brand selected fill, never the text colour', () => {
        const css = read('packages/core/src/shared/components/MarketTrading.module.css');
        const pressed = css.match(/\.priceChip\.priceChip\[aria-pressed='true'\],[^{]*\{([^}]*)\}/)[1];
        expect(pressed).toMatch(/background:\s*var\(--xc-control-selected\);/);
        expect(pressed).toMatch(/border-color:\s*var\(--xc-control-selected\);/);
        expect(pressed).toMatch(/color:\s*var\(--xc-control-selected-text\);/);
        expect(pressed).toMatch(/box-shadow:\s*none;/);
        expect(pressed).not.toMatch(/var\(--xc-text\)/);
        const base = css.match(/\.priceChip\.priceChip \{([^}]*)\}/)[1];
        expect(base).toMatch(/border:\s*1px solid var\(--xc-control-border\);/);
        expect(base).toMatch(/background:\s*var\(--xc-control-bg\);/);
    });

    it('pulls the zero-height flip row back so the You pay and You get cards sit 8px apart', () => {
        const css = read('packages/core/src/shared/components/giveGet/GiveGet.module.css');
        expect(css).toMatch(/\.pair \{[^}]*gap:\s*var\(--xc-space-2\);/);
        const flipRow = css.match(/\.flipRow \{([^}]*)\}/)[1];
        expect(flipRow).toMatch(/height:\s*0;/);
        expect(flipRow).toMatch(/margin-block:\s*calc\(var\(--xc-space-1\) \* -1\);/);
    });
});

describe('Trade page: wide layout', () => {
    it('lets FormPage draw the one form-width card from its breakpoint, and the Trade page draws none of its own', () => {
        // FormPage owns the wide card, so the Trade page CSS adds only the gap
        // under a load-failure notice: no second card, no wide-layout block.
        const css = read('packages/core/src/shared/routes/MarketTrade.module.css');
        expect(css).not.toMatch(/@media \(min-width: 600px\)/);
        expect(css).not.toMatch(/--xc-card-bg|--xc-card-border|--xc-form-card-max-width/);
        // The old floating 834px tiles-and-tabs rule is gone.
        expect(css).not.toMatch(/min-width: 834px/);
        const formPage = read('packages/core/src/ui/FormPage.module.css');
        const wide = formPage.slice(formPage.indexOf('@media (min-width: 600px)'));
        expect(wide.length).toBeGreaterThan(0);
        const card = wide.match(/\.form \{([^}]*)\}/)[1];
        expect(card).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(card).toMatch(/padding:\s*var\(--xc-card-pad\);/);
        expect(card).toMatch(/background:\s*var\(--xc-card-bg\);/);
        expect(card).toMatch(/border:\s*var\(--xc-card-border\);/);
        expect(card).toMatch(/border-radius:\s*var\(--xc-card-radius\);/);
        // A form nested inside the card draws no second card.
        const inner = wide.match(/form \.form \{([^}]*)\}/)[1];
        expect(inner).toMatch(/max-width:\s*none;/);
        expect(inner).toMatch(/padding:\s*0;/);
        expect(inner).toMatch(/background:\s*transparent;/);
        expect(inner).toMatch(/border:\s*0;/);
        expect(inner).toMatch(/box-shadow:\s*none;/);
    });
});
