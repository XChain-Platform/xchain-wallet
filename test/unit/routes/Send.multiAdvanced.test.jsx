// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send form's Advanced tab: one recipient per line (address,asset,amount),
// typed or filled from a CSV file through the standard file field. Bad lines
// are named by line number when Send is pressed, a file loads only when every
// line is a recipient, the one-transaction limit is said before review, and
// switching to Multi and back carries the recipients without dropping a line.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            {['PEPE', 'DANK'].map((tick) => (
                <button key={tick} type="button" onClick={() => onSelect({ chainId: CHAIN, tick })}>
                    {`Pick ${tick}`}
                </button>
            ))}
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const ALICE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BOB = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const CAROL = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [
                { tick: 'PEPE', quantity: '100000000', divisibility: 0 },
                { tick: 'DANK', quantity: '100000', divisibility: 2 },
            ],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|2|…', version: 2,
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

const box = () => screen.getByLabelText('Recipients');
const send = () => fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

/** Open Advanced once the balances (which say which assets are held) have loaded. */
async function openAdvanced() {
    await screen.findByText(/BTC available/);
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    return box();
}

function type(text) {
    fireEvent.change(box(), { target: { value: text } });
}

async function upload(name, text) {
    const file = new File([text], name, { type: 'text/csv' });
    await act(async () => {
        fireEvent.change(screen.getByLabelText('Choose a CSV file of recipients'), { target: { files: [file] } });
    });
    // FileReader settles on a later tick.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const legsOf = (messaging) => messaging.composeForConfirm.mock.calls[0][0].legs;

describe('Send: Advanced tab', () => {
    it('shows the line format as its placeholder, with example lines', async () => {
        mount();
        const textarea = await openAdvanced();
        const lines = textarea.getAttribute('placeholder').split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(2);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (const line of lines) expect(line.split(',')).toHaveLength(3);
        expect(screen.getByText('Upload CSV (up to 2 MB)')).toBeInTheDocument();
    });

    it('keeps every recipient on one visual line with horizontal scrolling', async () => {
        mount();
        const textarea = await openAdvanced();
        expect(textarea).toHaveAttribute('wrap', 'off');
        const style = getComputedStyle(textarea);
        expect(style.whiteSpace).toBe('pre');
        expect(style.overflowX).toBe('auto');
        expect(style.width).toBe('100%');
        expect(style.fontFamily).toMatch(/mono|Menlo|Monaco|Consolas/i);
    });

    it('sends one leg per line, mixing assets and amounts', async () => {
        const messaging = mount();
        await openAdvanced();
        type(`${ALICE},PEPE,100000\n${BOB},DANK,25.5\n${CAROL},PEPE,250`);
        const hint = document.getElementById('send-advanced-text-hint');
        expect(hint).toHaveTextContent('3 of 10 recipients: 100,250 PEPE + 25.5 DANK.');
        expect(box()).toHaveAttribute('aria-describedby', expect.stringContaining(hint.id));
        expect(screen.queryByTestId('send-advanced-note')).toBeNull();
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(legsOf(messaging)).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '100000' },
            { to: BOB, tick: 'DANK', amount: '25.5' },
            { to: CAROL, tick: 'PEPE', amount: '250' },
        ]);
    });

    it('skips a header row and empty lines', async () => {
        const messaging = mount();
        await openAdvanced();
        type(`address,asset,amount\n\n${ALICE},PEPE,1\n\n${BOB},PEPE,2\n`);
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(legsOf(messaging)).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '1' },
            { to: BOB, tick: 'PEPE', amount: '2' },
        ]);
    });

    it('names each bad line by number when Send is pressed, and composes nothing', async () => {
        const messaging = mount();
        await openAdvanced();
        type(`${ALICE},PEPE,1\nbc1qnotarealaddress,PEPE,1\n${BOB},NOPE,1\n${CAROL},DANK,abc`);
        // Typing alone shows no error.
        expect(screen.queryByText(/^Line 2:/)).toBeNull();
        send();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        // The form's notice lists each line, and the box carries all of them.
        const notice = screen.getByRole('alert', { name: 'Form errors' });
        expect(notice).toHaveTextContent('Fix 3 things to continue');
        expect(within(notice).getByText(/^Line 2:/)).toBeInTheDocument();
        expect(within(notice).getByText('Line 3: NOPE is not a token this address holds.')).toBeInTheDocument();
        expect(within(notice).getByText('Line 4: Amount must be a positive number.')).toBeInTheDocument();
        expect(box()).toHaveAttribute('aria-invalid', 'true');
        expect(document.getElementById('send-advanced-text-error').textContent)
            .toMatch(/Line 2: .*Line 3: NOPE is not a token this address holds\. Line 4: Amount must be a positive number\./);
        // Editing the box takes the line errors away, from the box and from
        // the notice, until the next Send.
        type(`${ALICE},PEPE,1`);
        expect(document.getElementById('send-advanced-text-error')).toBeNull();
        expect(screen.queryByText(/^Line [234]:/)).toBeNull();
    });

    it('a tab switch takes the line errors out of the notice too', async () => {
        mount();
        await openAdvanced();
        type(`${ALICE},PEPE,1\n${BOB},NOPE,1\n${CAROL},DANK,abc`);
        send();
        expect(screen.getAllByText(/^Line 3:/).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
        expect(screen.queryByText(/^Line [23]:/)).toBeNull();
        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();
    });

    it('says the one-transaction limit before review and refuses to send past it', async () => {
        const messaging = mount();
        await openAdvanced();
        const eleven = Array.from({ length: 11 }, (_, i) => `${i % 2 ? ALICE : BOB},PEPE,${i + 1}`).join('\n');
        type(eleven);
        expect(document.getElementById('send-advanced-text-error')).toHaveTextContent(
            'One transaction carries at most 10 recipients, and this list has 11. Remove 1 recipient, or send the rest in another payment.',
        );
        expect(box()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByTestId('send-advanced-note')).toBeNull();
        send();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(screen.getAllByText(/at most 10 recipients, and this list has 11/).length).toBeGreaterThan(1);
    });

    it('fills the box from a valid CSV file, header row and quoted amount included', async () => {
        const messaging = mount();
        await openAdvanced();
        await upload('payroll.csv', `address,asset,amount\r\n${ALICE},PEPE,"1,000"\r\n${BOB},DANK,2.5\r\n`);
        expect(box().value).toBe(`address,asset,amount\n${ALICE},PEPE,"1,000"\n${BOB},DANK,2.5`);
        expect(screen.getByLabelText(/^Upload CSV/)).toHaveValue('payroll.csv');
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(legsOf(messaging)).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '1000' },
            { to: BOB, tick: 'DANK', amount: '2.5' },
        ]);
    });

    it('does not load a CSV file with a bad line, and names the line', async () => {
        mount();
        await openAdvanced();
        type(`${CAROL},PEPE,9`);
        await upload('bad.csv', `${ALICE},PEPE,1\n${BOB},PEPE,`);
        expect(box().value).toBe(`${CAROL},PEPE,9`);
        expect(screen.getByText(/bad\.csv was not loaded: one line is not a recipient\. Line 2: Enter an amount\./))
            .toBeInTheDocument();
    });

    it('carries the recipients from Multi to Advanced and back', async () => {
        const messaging = mount();
        await screen.findByText(/BTC available/);
        fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
        for (const [to, tick, amount] of [[ALICE, 'PEPE', '7'], [BOB, 'DANK', '3']]) {
            fireEvent.click(await screen.findByRole('button', { name: /Add Recipient/ }));
            fireEvent.change(screen.getByLabelText(/^To$/), { target: { value: to } });
            fireEvent.click(screen.getByRole('button', { name: /^Token/ }));
            fireEvent.click(await screen.findByRole('button', { name: `Pick ${tick}` }));
            fireEvent.change(await screen.findByLabelText(/^Amount/, { selector: 'input' }), { target: { value: amount } });
            fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        }
        fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
        expect(box().value).toBe(`${ALICE},PEPE,7\n${BOB},DANK,3`);
        type(`${box().value}\n${CAROL},PEPE,9`);
        fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(3);
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(legsOf(messaging)).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '7' },
            { to: BOB, tick: 'DANK', amount: '3' },
            { to: CAROL, tick: 'PEPE', amount: '9' },
        ]);
    });

    it('keeps lines Multi cannot take when switching there and back unedited', async () => {
        mount();
        await openAdvanced();
        const text = `${ALICE},PEPE,7\nnot a recipient line\n${BOB},DANK,3`;
        type(text);
        fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(2);
        fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
        expect(box().value).toBe(text);
    });
});
