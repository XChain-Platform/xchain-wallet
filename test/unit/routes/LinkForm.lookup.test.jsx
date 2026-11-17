// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Link form's action lookup and the badge between its two cards: a number
// is read once it is complete (blur, or a pause in typing), never per
// keystroke; a found action is summarised in its card; and a round badge that
// names the pair overlaps both cards the way Swap's flip button does.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const SENDER = 'bc1qsenderaddressforthelinkformlookuptest0000';
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
    render(
        <MessagingProvider shell="web" messaging={client}>
            <LinkForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return client;
}

async function cards() {
    return [
        (await screen.findByText('Action 1')).closest('fieldset'),
        screen.getByText('Action 2').closest('fieldset'),
    ];
}

/** Types `digits` one keystroke at a time, the way a person fills the field. */
function typeDigits(input, digits) {
    for (let i = 1; i <= digits.length; i += 1) {
        fireEvent.change(input, { target: { value: digits.slice(0, i) } });
    }
}

describe('LinkForm action lookup', () => {
    it('reads a typed number once when typing pauses, never per keystroke, and the count does not grow with its length', async () => {
        const getActionByIndex = vi.fn().mockResolvedValue({ action: 'ISSUE', tick: 'PEPE', block_index: 7 });
        mount(getActionByIndex);
        const [card1] = await cards();
        const [input1, input2] = screen.getAllByLabelText('Action number');

        typeDigits(input1, '123');
        expect(getActionByIndex).not.toHaveBeenCalled();
        await waitFor(() => expect(getActionByIndex).toHaveBeenCalledTimes(1));
        expect(getActionByIndex).toHaveBeenLastCalledWith({ chainId: BTC, actionIndex: '123' });
        await within(card1).findByText('Token issuance');

        // Twice the digits, still one read.
        typeDigits(input2, '456789');
        expect(getActionByIndex).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(getActionByIndex).toHaveBeenCalledTimes(2));
        expect(getActionByIndex).toHaveBeenLastCalledWith({ chainId: LTC, actionIndex: '456789' });

        // Leaving fields whose numbers are already read reads nothing more.
        fireEvent.blur(input1);
        fireEvent.blur(input2);
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(getActionByIndex).toHaveBeenCalledTimes(2);
    });

    it('reads at once when the field loses focus, and the pending timer does not read again', async () => {
        const getActionByIndex = vi.fn().mockResolvedValue({ action: 'ISSUE', tick: 'PEPE', block_index: 7 });
        mount(getActionByIndex);
        await cards();
        const [input1] = screen.getAllByLabelText('Action number');

        typeDigits(input1, '55');
        fireEvent.blur(input1);
        expect(getActionByIndex).toHaveBeenCalledTimes(1);
        expect(getActionByIndex).toHaveBeenCalledWith({ chainId: BTC, actionIndex: '55' });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(getActionByIndex).toHaveBeenCalledTimes(1);
    });

    it('shows the field loading state while the read runs', async () => {
        mount(vi.fn(() => new Promise(() => {})));
        const [card1] = await cards();
        const [input1] = screen.getAllByLabelText('Action number');

        fireEvent.change(input1, { target: { value: '42' } });
        fireEvent.blur(input1);
        expect(within(card1).getByRole('status', { name: 'Looking up Action 1' })).toBeInTheDocument();
        expect(input1).toHaveAttribute('aria-busy', 'true');
        expect(card1.querySelector('[data-link-action-summary]')).toBeNull();
        expect(within(card1).queryByRole('alert')).toBeNull();
    });

    it('summarises an image upload linked to a token issuance: type, subject, block and sender', async () => {
        const getActionByIndex = vi.fn(({ chainId }) => Promise.resolve(chainId === BTC
            // The explorer may carry the action's own fields in a `details` object.
            ? { action: 'FILE', action_index: 10, block_index: 902311, timestamp: 1767225600, details: { name: 'pepe.png', type: 'image/png', source: SENDER } }
            : { action: 'ISSUE', action_index: 20, tick: 'PEPE', block_index: 5401220, source: SENDER }));
        mount(getActionByIndex);
        const [card1, card2] = await cards();
        const [input1, input2] = screen.getAllByLabelText('Action number');

        fireEvent.change(input1, { target: { value: '10' } });
        fireEvent.blur(input1);
        fireEvent.change(input2, { target: { value: '20' } });
        fireEvent.blur(input2);

        const summary1 = await waitFor(() => {
            const node = card1.querySelector('[data-link-action-summary]');
            expect(node).not.toBeNull();
            return node;
        });
        expect(summary1).toHaveAttribute('aria-label', 'Action 1 details');
        expect(within(summary1).getByText('Image upload')).toBeInTheDocument();
        expect(within(summary1).getByText('File')).toBeInTheDocument();
        expect(within(summary1).getByText('pepe.png')).toBeInTheDocument();
        expect(within(summary1).getByText('Block')).toBeInTheDocument();
        expect(within(summary1).getByText('902311')).toBeInTheDocument();
        expect(within(summary1).getByText('Sent by')).toBeInTheDocument();
        expect(summary1.querySelector(`[aria-label="${SENDER}"]`)).not.toBeNull();

        const summary2 = await waitFor(() => {
            const node = card2.querySelector('[data-link-action-summary]');
            expect(node).not.toBeNull();
            return node;
        });
        expect(within(summary2).getByText('Token issuance')).toBeInTheDocument();
        expect(within(summary2).getByText('Token')).toBeInTheDocument();
        expect(within(summary2).getByText('PEPE')).toBeInTheDocument();
        expect(within(summary2).getByText('5401220')).toBeInTheDocument();

        // G121: read-only facts carry no help icon.
        for (const summary of [summary1, summary2]) {
            expect(within(summary).queryByRole('button')).toBeNull();
            expect(summary.querySelector('dt').getAttribute('title')).toBe('Type');
        }
        // The labels stay Action 1 and Action 2.
        expect(within(card1).getByText('Action 1')).toBeInTheDocument();
        expect(within(card2).getByText('Action 2')).toBeInTheDocument();
    });

    it('calls a non-image file a file upload', async () => {
        mount(vi.fn().mockResolvedValue({ action: 'FILE', block_index: 3, name: 'terms.pdf', type: 'application/pdf' }));
        const [card1] = await cards();
        const [input1] = screen.getAllByLabelText('Action number');
        fireEvent.change(input1, { target: { value: '3' } });
        fireEvent.blur(input1);
        expect(await within(card1).findByText('File upload')).toBeInTheDocument();
        expect(within(card1).getByText('terms.pdf')).toBeInTheDocument();
    });
});

describe('LinkForm linked-cards badge', () => {
    it('sits between the two cards as a named image, not a button', async () => {
        mount(vi.fn());
        const [card1, card2] = await cards();
        const badge = screen.getByRole('img', { name: 'Action 1 is linked to Action 2' });
        const row = badge.parentElement;
        expect(row.previousElementSibling).toBe(card1);
        expect(row.nextElementSibling).toBe(card2);
        expect(badge.tagName).not.toBe('BUTTON');
        expect(badge.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Action 1 is linked to Action 2' })).toBeNull();
    });

    it('reuses the Swap flip geometry, which overlaps the bottom of one card and the top of the next', () => {
        const badgeCss = readFileSync('packages/core/src/shared/components/LinkedCardsBadge.module.css', 'utf8');
        expect(badgeCss).toMatch(/\.row\s*\{[^}]*composes:\s*flipRow from '\.\/giveGet\/GiveGet\.module\.css'/);
        expect(badgeCss).toMatch(/\.badge\s*\{[^}]*composes:\s*flip from '\.\/giveGet\/GiveGet\.module\.css'/);
        // The badge keeps its arrows upright and does not light up like a button.
        expect(badgeCss).toMatch(/\.row \.badge svg\s*\{[^}]*transform:\s*none/);
        expect(badgeCss).toMatch(/cursor:\s*default/);

        // The Swap geometry it composes: a zero-height row pulled into the gap,
        // and a circle lifted by half its height so it spans both cards.
        const giveGet = readFileSync('packages/core/src/shared/components/giveGet/GiveGet.module.css', 'utf8');
        const flipRow = giveGet.match(/\.flipRow\s*\{([^}]*)\}/)?.[1] || '';
        expect(flipRow).toMatch(/height:\s*0/);
        expect(flipRow).toMatch(/margin-block:\s*calc\(var\(--xc-space-1\) \* -1\)/);
        const flip = giveGet.match(/\.flip\s*\{([^}]*)\}/)?.[1] || '';
        expect(flip).toMatch(/height:\s*44px/);
        expect(flip).toMatch(/margin-top:\s*-22px/);

        // The cards stack in the flex column with the 8px gap that geometry assumes.
        const formCss = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        const actions = formCss.match(/\.linkActions\s*\{([^}]*)\}/)?.[1] || '';
        expect(actions).toMatch(/flex-direction:\s*column/);
        expect(actions).toMatch(/gap:\s*var\(--xc-space-2\)/);
    });
});
