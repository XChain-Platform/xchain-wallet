// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: every displayed number groups its thousands (operator ruling
// 2026-11-15, seen on Edit order and Cancel order): 1,000; 250,000;
// 12,500,000.12345678. Full precision is kept, ids, heights and indexes stay
// as written, and a typed amount stays raw in the state the form signs.

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    formatDecimalAmount,
    formatWithThousands,
    groupDecodedAmounts,
} from '../../../packages/core/src/shared/utils/amountFormat.js';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';
import { sideAmountText } from '../../../packages/core/src/shared/utils/orderView.js';
import { ORDER_KIND } from '../../../packages/core/src/shared/routes/OrderActionPanel.jsx';
import { formatFeesTotal } from '../../../packages/core/src/flows/feesCard.js';
import { summarizeSendLegs } from '../../../packages/core/src/flows/sendLegs.js';
import { escrowLine } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';

afterEach(cleanup);

describe('the shared formatter groups by default', () => {
    it.each([
        ['1000', '1,000'],
        ['250000', '250,000'],
        ['12500000', '12,500,000'],
        ['250000000', '250,000,000'],
        ['12500000.12345678', '12,500,000.12345678'],
        ['1000000.000000000000000001', '1,000,000.000000000000000001'],
        ['999', '999'],
        ['0.00000001', '0.00000001'],
        ['-1234567.5', '-1,234,567.5'],
    ])('formatWithThousands(%s) is %s with every place kept', (raw, shown) => {
        expect(formatWithThousands(raw)).toBe(shown);
    });

    it('groups the Intl path the same way and never rounds', () => {
        expect(formatDecimalAmount('12500000.12345678')).toBe('12,500,000.12345678');
        expect(formatDecimalAmount('90000000.00000003')).toBe('90,000,000.00000003');
    });
});

describe('decoded review rows', () => {
    it('groups Give and Get on an order and the same figures in its summary', () => {
        const decoded = groupDecodedAmounts(decodeAction({
            action: 'ORDER',
            params: {
                GIVE_TICK: 'PEPE', GIVE_AMOUNT: '250000', GET_TICK: 'XCHAIN', GET_AMOUNT: '12500000.12345678',
                EXPIRATION: '1893456000', ALLOW_LIST: '1234',
            },
        }));
        const value = (label) => decoded.details.find((d) => d.label === label)?.value;
        expect(value('Give')).toBe('250,000 PEPE');
        expect(value('Get')).toBe('12,500,000.12345678 XCHAIN');
        expect(decoded.summary).toContain('give 250,000 PEPE for 12,500,000.12345678 XCHAIN');
        // An expiration and a list id are not quantities.
        expect(value('Expiration')).toBe('1893456000');
        expect(value('Allow list')).toBe('#1234');
    });

    it('leaves an action index untouched on Cancel and Edit order', () => {
        for (const version of ['1', '2']) {
            const raw = decodeAction({
                action: 'ORDER',
                params: { VERSION: version, ORDER_ACTION_INDEX: '1234567', ...(version === '2' ? { EXPIRATION: '1893456000' } : {}) },
            });
            const decoded = groupDecodedAmounts(raw);
            expect(decoded.details.find((d) => d.label === 'Order action index').value).toBe('1234567');
            expect(decoded.summary).toContain('#1234567');
            expect(decoded).toBe(raw);
        }
    });

    it('groups an issue supply but not its mint blocks', () => {
        const decoded = groupDecodedAmounts({
            summary: 'Create PEPE with a max supply of 21000000',
            details: [
                { label: 'Max supply', value: '21000000' },
                { label: 'Mint start block', value: '840000' },
                { label: 'Mint stop block', value: '1050000' },
                { label: 'Memo', value: '1000000' },
            ],
            warnings: ['Supply 21000000 is large.'],
        });
        expect(decoded.details.map((d) => d.value)).toEqual(['21,000,000', '840000', '1050000', '1000000']);
        expect(decoded.summary).toBe('Create PEPE with a max supply of 21,000,000');
        expect(decoded.warnings).toEqual(['Supply 21000000 is large.']);
    });

    it('is idempotent and passes a non-decoded value through', () => {
        const once = groupDecodedAmounts({ summary: 'Mint 5000 X', details: [{ label: 'Amount', value: '5000 X' }], warnings: [] });
        expect(groupDecodedAmounts(once)).toBe(once);
        expect(groupDecodedAmounts(null)).toBe(null);
    });
});

describe('Edit order and Cancel order facts', () => {
    it('show each side grouped', () => {
        const row = { give_tick: 'PEPE', give_amount: '250000', get_tick: 'XCHAIN', get_amount: '12500000.12345678' };
        expect(ORDER_KIND.sideText(row, 'give')).toBe('250,000 PEPE');
        expect(ORDER_KIND.sideText(row, 'get')).toBe('12,500,000.12345678 XCHAIN');
        expect(sideAmountText('PEPE', '', '1000', '0')).toBe('1,000 PEPE');
        expect(ORDER_KIND.sideText({ give_tick: 'NAME', give_ownership: 1 }, 'give')).toBe('ownership of NAME');
    });
});

describe('other read-only displays', () => {
    it('groups the fees total', () => {
        expect(formatFeesTotal({
            coinTicker: 'DOGE', networkFee: '1250.5', protocolXchain: '12500', payInNative: false,
        })).toBe('1,250.5 DOGE + 12,500 XCHAIN');
    });

    it('groups a send summary and its totals', () => {
        expect(summarizeSendLegs([{ to: 'addr', tick: 'PEPE', amount: '250000' }])).toBe('Send 250,000 PEPE to addr');
        expect(summarizeSendLegs([
            { to: 'a', tick: 'PEPE', amount: '600000' },
            { to: 'b', tick: 'PEPE', amount: '650000.5' },
        ])).toBe('Send 1,250,000.5 PEPE to 2 recipients');
    });

    it('groups a balance escrow line', () => {
        expect(escrowLine({ escrowed: '1250000.5' })).toBe('+ 1,250,000.5 in escrow');
        expect(escrowLine({ escrowed: '2000000', escrowClosing: '1500000' }))
            .toBe('+ 2,000,000 in escrow (1,500,000 in a closing dispenser)');
    });
});

function Harness({ onValue }) {
    const [amount, setAmount] = useState('');
    return (
        <AmountField
            amount={amount}
            tick="PEPE"
            onAmountFieldChange={(value) => { setAmount(value); onValue(value); }}
        />
    );
}

function type(input, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const character of text) {
        const next = input.value + character;
        setter.call(input, next);
        input.setSelectionRange(next.length, next.length);
        fireEvent(input, new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
    }
}

describe('typed amounts stay raw', () => {
    it('hands the form the plain digits after every keystroke', () => {
        const seen = [];
        render(<Harness onValue={(value) => { seen.push(value); }} />);
        type(screen.getByRole('textbox'), '12500000.5');
        expect(seen.at(-1)).toBe('12500000.5');
        expect(seen.every((value) => !value.includes(','))).toBe(true);
    });
});
