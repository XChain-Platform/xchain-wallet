// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const addr = (id, chainId) => ({
    id, address: `${chainId}-address`, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's',
});

afterEach(cleanup);

function mount(getActionByIndex) {
    const btc = addr('btc-1', BTC);
    const ltc = addr('ltc-1', LTC);
    const client = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getActionByIndex,
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        preflight: vi.fn(),
    };
    return render(
        <MessagingProvider shell="web" messaging={client}>
            <LinkForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('LinkForm cards', () => {
    it('gives From a help tip and the forward button the success style with an icon', async () => {
        mount(vi.fn());
        await screen.findByRole('heading', { level: 1, name: 'Link actions' });
        expect(await screen.findByRole('button', { name: /About From/i })).toBeInTheDocument();
        const submit = screen.getByRole('button', { name: 'Link actions' });
        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).not.toBeNull();
    });

    it('shows the found line green, a missing line muted, and nothing for an empty number', async () => {
        const getActionByIndex = vi.fn(({ actionIndex }) => (actionIndex === '10'
            ? Promise.resolve({ action: 'SEND', amount: '10', tick: 'PEPE', block_index: 902311 })
            : Promise.resolve(null)));
        mount(getActionByIndex);
        const cards = [
            (await screen.findByText('Action 1')).closest('fieldset'),
            screen.getByText('Action 2').closest('fieldset'),
        ];
        const inputs = screen.getAllByLabelText('Action number');
        expect(cards[0].querySelector('[class*="linkActionCheck"]')).toBeNull();

        fireEvent.change(inputs[0], { target: { value: '10' } });
        const found = await screen.findByText('Found: SEND 10 PEPE, block 902,311');
        expect(found.className).toMatch(/linkActionFound/);

        fireEvent.change(inputs[1], { target: { value: '77' } });
        const missing = await within(cards[1]).findByText('No action was found at that number.');
        expect(missing.className).not.toMatch(/linkActionFound/);
        await waitFor(() => expect(missing).toBeInTheDocument());
    });

    it('reports a number that is not whole (typed through paste of non digits is stripped)', async () => {
        mount(vi.fn());
        await screen.findByText('Action 1');
        const input = screen.getAllByLabelText('Action number')[0];
        fireEvent.change(input, { target: { value: '12ab' } });
        expect(input).toHaveValue('12');
    });

    it('keeps the heading inside the card and both fields on one two-column row', () => {
        const css = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        const fields = css.match(/\.linkActionFields\s*\{([^}]*)\}/)?.[1] || '';
        expect(fields).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        const title = css.match(/\.linkActionTitle\s*\{([^}]*)\}/)?.[1] || '';
        expect(title).toMatch(/float:\s*inline-start/);
        expect(title).toMatch(/inline-size:\s*100%/);
        // The label row, not the NetworkField wrapper, gets the shared height;
        // styling the wrapper centred the Network label above its field.
        expect(css).toMatch(/\.linkActionFields > :not\(\.linkActionNetwork\) > :first-child,\s*\.linkActionNetwork > \* > :first-child\s*\{[^}]*justify-content: flex-start;[^}]*min-block-size/);
        expect(css).not.toMatch(/\.linkActionCheck\s*\{[^}]*min-height/);
    });

    it('renders the network and number fields as two direct children of one row', async () => {
        mount(vi.fn());
        const card = (await screen.findByText('Action 1')).closest('fieldset');
        const row = card.querySelector('[class*="linkActionFields"]');
        expect(row.children).toHaveLength(2);
        expect(within(row.children[0]).getByRole('button', { name: /^Network:/ })).toBeInTheDocument();
        expect(within(row.children[1]).getByLabelText('Action number')).toBeInTheDocument();
    });
});
