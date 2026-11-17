// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send form's Multi and Advanced recipient list: row checks, list edits,
// the address,asset,amount text both ways, the review totals, the
// one-transaction limits, and the wire. The last block encodes the legs with
// the real SDK serializer and decodes the string back with the SDK decoder, so
// what the form builds is checked against the protocol's SEND formats
// (xchain-documentation/protocol/actions/send.md, versions 1 and 2).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
    MAX_MULTI_RECIPIENTS,
    addRecipient,
    parseRecipientText,
    recipientAmountText,
    recipientLimitError,
    recipientListFitError,
    recipientSizeError,
    recipientTotalsText,
    recipientsToText,
    removeRecipient,
    sendActionBytes,
    sendActionString,
    splitCsvLine,
    updateRecipient,
    validateRecipient,
} from '../../../packages/core/src/flows/multiSendRecipients.js';
import { buildSendParams, MAX_SEND_LEGS } from '../../../packages/core/src/flows/sendLegs.js';
import { MAX_COMPILED_ACTION_BYTES } from '../../../packages/core/src/flows/fileSizeLimits.js';

const A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const B = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const C = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

// The form passes the chain's own checks; these stand in for them.
const RULES = {
    addressError: (address) => (address.startsWith('bc1q') && address.length >= 42 ? null : 'Enter a valid Bitcoin address.'),
    nativeTicker: 'BTC',
    isHeld: (tick) => ['XCHAIN', 'PEPE', 'DANK'].includes(tick),
    decimalsFor: (tick) => ({ XCHAIN: 8, PEPE: 0, DANK: 2 })[tick],
};

describe('validateRecipient', () => {
    it('passes a complete row on this network', () => {
        expect(validateRecipient({ to: A, tick: 'xchain', amount: '100,000' }, RULES)).toEqual({});
    });

    it('names every missing field', () => {
        expect(validateRecipient({ to: '', tick: '', amount: '' }, RULES)).toEqual({
            to: 'Enter the recipient address.',
            tick: 'Choose a token.',
            amount: 'Enter an amount.',
        });
    });

    it('refuses an address the chain refuses, the coin, an asset not held, and a zero amount', () => {
        expect(validateRecipient({ to: 'bc1qbad', tick: 'PEPE', amount: '1' }, RULES).to)
            .toBe('Enter a valid Bitcoin address.');
        expect(validateRecipient({ to: A, tick: 'BTC', amount: '1' }, RULES).tick)
            .toMatch(/^BTC is paid in its own output/);
        expect(validateRecipient({ to: A, tick: 'NOPE', amount: '1' }, RULES).tick)
            .toBe('NOPE is not a token this address holds.');
        expect(validateRecipient({ to: A, tick: 'PEPE', amount: '0' }, RULES).amount)
            .toBe('Amount must be a positive number.');
    });

    it('refuses an amount past the asset decimal places', () => {
        expect(validateRecipient({ to: A, tick: 'PEPE', amount: '1.5' }, RULES).amount)
            .toBe('PEPE has no decimal places, so the amount must be a whole number.');
        expect(validateRecipient({ to: A, tick: 'DANK', amount: '1.005' }, RULES).amount)
            .toBe('DANK amounts can have at most 2 decimal places.');
        expect(validateRecipient({ to: A, tick: 'DANK', amount: '1.05' }, RULES)).toEqual({});
    });

    it('skips the held check while the balances are unknown', () => {
        expect(validateRecipient({ to: A, tick: 'NOPE', amount: '1' }, { ...RULES, isHeld: null })).toEqual({});
    });
});

describe('adding, editing and removing recipients', () => {
    it('adds a normalized row with its own id', () => {
        const list = addRecipient([], { to: ` ${A} `, tick: 'xchain', amount: '100,000' });
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ to: A, tick: 'XCHAIN', amount: '100000' });
        expect(list[0].id).toMatch(/^rcpt-/);
    });

    it('gives two rows made at once different ids', () => {
        const list = addRecipient(addRecipient([], { to: A, tick: 'PEPE', amount: '1' }), { to: A, tick: 'PEPE', amount: '1' });
        expect(list[0].id).not.toBe(list[1].id);
    });

    it('edits a row in place, keeping its id and position', () => {
        let list = addRecipient([], { to: A, tick: 'PEPE', amount: '1' });
        list = addRecipient(list, { to: B, tick: 'PEPE', amount: '2' });
        const [first, second] = list;
        list = updateRecipient(list, first.id, { to: C, tick: 'dank', amount: '3.5' });
        expect(list).toEqual([
            { id: first.id, to: C, tick: 'DANK', amount: '3.5' },
            second,
        ]);
    });

    it('removes only the named row', () => {
        let list = addRecipient([], { to: A, tick: 'PEPE', amount: '1' });
        list = addRecipient(list, { to: B, tick: 'PEPE', amount: '2' });
        expect(removeRecipient(list, list[0].id).map((row) => row.to)).toEqual([B]);
        expect(removeRecipient(list, 'missing')).toHaveLength(2);
    });

    it('never grows a full list past the one-transaction limit', () => {
        let list = [];
        for (let i = 0; i < MAX_MULTI_RECIPIENTS + 3; i += 1) list = addRecipient(list, { to: A, tick: 'PEPE', amount: String(i + 1) });
        expect(list).toHaveLength(MAX_MULTI_RECIPIENTS);
    });
});

describe('parseRecipientText (Advanced and CSV)', () => {
    it('reads valid lines, mixing assets and amounts', () => {
        const { recipients, errors, header } = parseRecipientText(
            `${A},XCHAIN,100000\n${B},pepe,25\n${C},DANK,0.5`,
            RULES,
        );
        expect(errors).toEqual([]);
        expect(header).toBe(false);
        expect(recipients.map(({ to, tick, amount }) => ({ to, tick, amount }))).toEqual([
            { to: A, tick: 'XCHAIN', amount: '100000' },
            { to: B, tick: 'PEPE', amount: '25' },
            { to: C, tick: 'DANK', amount: '0.5' },
        ]);
    });

    it('tolerates a header row and a byte-order mark', () => {
        const bom = String.fromCharCode(0xfeff);
        const parsed = parseRecipientText(`${bom}address,asset,amount\n${A},XCHAIN,1`, RULES);
        expect(parsed.header).toBe(true);
        expect(parsed.errors).toEqual([]);
        expect(parsed.recipients).toHaveLength(1);
        expect(parseRecipientText(`Address,Token,Quantity\n${A},XCHAIN,1`, RULES).header).toBe(true);
    });

    it('skips empty lines and keeps the real line numbers', () => {
        const { recipients, errors } = parseRecipientText(`\n${A},XCHAIN,1\n\n   \n${B},XCHAIN,oops\n`, RULES);
        expect(recipients).toHaveLength(1);
        expect(errors).toEqual([{ line: 5, message: 'Line 5: Amount must be a positive number.' }]);
    });

    it('reports a bad address, an unknown asset and a bad amount by line', () => {
        const { recipients, errors } = parseRecipientText(
            `${A},XCHAIN,1\nbc1qbad,XCHAIN,1\n${B},NOPE,1\n${C},PEPE,-4`,
            RULES,
        );
        expect(recipients).toHaveLength(1);
        expect(errors).toEqual([
            { line: 2, message: 'Line 2: Enter a valid Bitcoin address.' },
            { line: 3, message: 'Line 3: NOPE is not a token this address holds.' },
            { line: 4, message: 'Line 4: Amount must be a positive number.' },
        ]);
    });

    it('reports a line with the wrong number of values', () => {
        expect(parseRecipientText(`${A},XCHAIN`, RULES).errors)
            .toEqual([{ line: 1, message: 'Line 1: expected three values (address,asset,amount), found 2.' }]);
        // An unquoted grouped amount splits into a fourth value.
        expect(parseRecipientText(`${A},XCHAIN,100,000`, RULES).errors[0].message).toMatch(/found 4/);
    });

    it('reads a quoted grouped amount', () => {
        expect(splitCsvLine(`${A},XCHAIN,"100,000"`)).toEqual([A, 'XCHAIN', '100,000']);
        const { recipients } = parseRecipientText(`${A},XCHAIN,"100,000"`, RULES);
        expect(recipients[0].amount).toBe('100000');
    });

    it('a header that is not on the first content line is just a bad line', () => {
        expect(parseRecipientText(`${A},XCHAIN,1\naddress,asset,amount`, RULES).errors[0].line).toBe(2);
    });
});

describe('Multi to Advanced and back', () => {
    it('round-trips the list through the text', () => {
        let list = addRecipient([], { to: A, tick: 'XCHAIN', amount: '100,000' });
        list = addRecipient(list, { to: B, tick: 'PEPE', amount: '25' });
        const text = recipientsToText(list);
        expect(text).toBe(`${A},XCHAIN,100000\n${B},PEPE,25`);
        const back = parseRecipientText(text, RULES);
        expect(back.errors).toEqual([]);
        expect(back.recipients.map(({ to, tick, amount }) => ({ to, tick, amount })))
            .toEqual(list.map(({ to, tick, amount }) => ({ to, tick, amount })));
    });
});

describe('review totals', () => {
    it('totals each asset across its recipients, grouped and exact', () => {
        const list = [
            { to: A, tick: 'XCHAIN', amount: '100000' },
            { to: B, tick: 'PEPE', amount: '25' },
            { to: C, tick: 'XCHAIN', amount: '250.12345678' },
        ];
        expect(recipientTotalsText(list)).toEqual(['100,250.12345678 XCHAIN', '25 PEPE']);
        expect(recipientAmountText(list[0])).toBe('100,000 XCHAIN');
    });
});

describe('one-transaction limits', () => {
    it('uses the send guardrail of ten recipients', () => {
        expect(MAX_MULTI_RECIPIENTS).toBe(MAX_SEND_LEGS);
        expect(MAX_MULTI_RECIPIENTS).toBe(10);
    });

    it('names both numbers when the list is too long, and never cuts it', () => {
        expect(recipientLimitError(10)).toBeNull();
        expect(recipientLimitError(11)).toBe(
            'One transaction carries at most 10 recipients, and this list has 11. '
            + 'Remove 1 recipient, or send the rest in another payment.',
        );
        expect(recipientLimitError(14)).toMatch(/has 14\. Remove 4 recipients/);
        const fourteen = Array.from({ length: 14 }, (_, i) => ({ to: A, tick: 'PEPE', amount: String(i + 1) }));
        expect(recipientListFitError(fourteen)).toMatch(/at most 10 recipients/);
        // The parser keeps every valid line; the limit is the form's refusal.
        expect(parseRecipientText(fourteen.map((r) => `${r.to},${r.tick},${r.amount}`).join('\n'), RULES).recipients)
            .toHaveLength(14);
    });

    it('measures the compiled action against the 8,192-byte push', () => {
        const legs = [{ to: A, tick: 'PEPE', amount: '1' }, { to: B, tick: 'PEPE', amount: '2' }];
        expect(sendActionBytes(legs)).toBe(sendActionString(legs).length + 2);
        expect(recipientSizeError(legs)).toBeNull();
        const huge = [{ to: A, tick: 'PEPE', amount: '1' }, { to: B, tick: 'PEPE', amount: '2' }];
        const longMemo = 'm'.repeat(MAX_COMPILED_ACTION_BYTES);
        expect(recipientSizeError(huge, longMemo)).toMatch(/one transaction carries at most 8,192/);
    });

    it('ten recipients with long addresses and ticks still fit one transaction', () => {
        const ten = Array.from({ length: 10 }, (_, i) => ({ to: B, tick: `TOKEN${i}`.padEnd(20, 'X'), amount: '123456789.12345678' }));
        expect(recipientListFitError(ten)).toBeNull();
    });
});

// Encode with the real SDK serializer, decode with the real SDK decoder.
const require_ = createRequire(import.meta.url);
function sdkModule(path) {
    for (const specifier of [`xchain-sdk/src/${path}`, `../../../../xchain-sdk/src/${path}`]) {
        try { return require_(specifier); } catch { /* next */ }
    }
    return null;
}
const FormatSelector = sdkModule('formatSelector.js');
const Decoder = sdkModule('decoder/index.js');

describe.skipIf(!FormatSelector || !Decoder)('the wire: SEND legs through the SDK', () => {
    function encode(list, memo) {
        const params = buildSendParams(list.map(({ to, tick, amount }) => ({ to, tick, amount, ...(memo ? { memo } : {}) })));
        const { version } = FormatSelector.select('SEND', params);
        return { version, action: FormatSelector.serialize('SEND', version, params) };
    }

    it('several assets encode as SEND v2 (Multi-Send Full) and decode to the same legs', () => {
        const list = parseRecipientText(`${A},XCHAIN,100000\n${B},PEPE,25\n${C},XCHAIN,250`, RULES).recipients;
        const { version, action } = encode(list);
        expect(version).toBe(2);
        expect(action).toBe(`SEND|2|XCHAIN|100000|${A}|PEPE|25|${B}|XCHAIN|250|${C}`);
        // The form's own measure is the action the SDK writes.
        expect(sendActionString(list)).toBe(action);
        const decoded = Decoder.parse(action, { validate: false });
        expect(decoded.ok).toBe(true);
        expect(decoded.action).toBe('SEND');
        expect(decoded.version).toBe(2);
        expect(decoded.legs.map((leg) => ({ to: leg.DESTINATION, tick: leg.TICK, amount: leg.AMOUNT })))
            .toEqual(list.map(({ to, tick, amount }) => ({ to, tick, amount })));
    });

    it('one asset encodes as SEND v1 (Multi-Send Brief) and decodes to the same legs', () => {
        let list = addRecipient([], { to: A, tick: 'XCHAIN', amount: '100' });
        list = addRecipient(list, { to: B, tick: 'XCHAIN', amount: '250' });
        list = addRecipient(list, { to: C, tick: 'XCHAIN', amount: '1250' });
        const { version, action } = encode(list, 'payroll');
        expect(version).toBe(1);
        expect(action).toBe(`SEND|1|XCHAIN|100|${A}|250|${B}|1250|${C}|payroll`);
        expect(sendActionString(list, 'payroll')).toBe(action);
        const decoded = Decoder.parse(action, { validate: false });
        expect(decoded.ok).toBe(true);
        // v1 carries the one TICK once, ahead of the legs.
        expect(decoded.params.TICK).toBe('XCHAIN');
        expect(decoded.params.MEMO).toBe('payroll');
        expect(decoded.legs.map((leg) => [leg.DESTINATION, leg.TICK ?? decoded.params.TICK, leg.AMOUNT]))
            .toEqual([[A, 'XCHAIN', '100'], [B, 'XCHAIN', '250'], [C, 'XCHAIN', '1250']]);
    });

    it('a list of one stays the plain v0 single send', () => {
        const { version, action } = encode([{ to: A, tick: 'PEPE', amount: '5' }]);
        expect(version).toBe(0);
        expect(sendActionString([{ to: A, tick: 'PEPE', amount: '5' }])).toBe(action);
    });
});
