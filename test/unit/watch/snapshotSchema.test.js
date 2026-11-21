// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const contractPath = 'packages/core/src/watch/contract';
const load = (name) => JSON.parse(readFileSync(`${contractPath}/${name}.schema.json`, 'utf8'));
const schema = load('snapshot');
const dependencies = ['row', 'receive', 'inbox', 'request', 'settings'];
const ajv = new Ajv2020({ allErrors: true });
ajv.addKeyword({ keyword: 'x-budgetBytes', schemaType: 'number' });
for (const name of dependencies) ajv.addSchema(load(name), `${name}.schema.json`);
const validate = ajv.compile(schema);

const row = (id = 'bitcoin-mainnet:BTC') => ({
    id,
    chainId: 'bitcoin-mainnet',
    tick: 'BTC',
    displayName: 'Bitcoin',
    amountText: '1.25 BTC',
    fiatText: '$125,000.00',
    noPrice: false,
    pendingText: '',
    unavailable: false,
    iconHash: 'sha256:abc123',
    tickerColor: '#1A74A8',
    hasDetail: true,
});

const receive = (chainId = 'bitcoin-mainnet') => ({
    chainId,
    label: 'Bitcoin',
    address: 'bc1qexample',
    qr: { size: 21, bits: `${'A'.repeat(74)}A=` },
});

const snapshot = (overrides = {}) => ({
    v: 1,
    builtAt: 1_700_000_000_000,
    balancesAt: 1_700_000_000_000,
    pricesAt: 1_700_000_000_000,
    session: 'unlocked',
    network: { kind: 'mainnet', isTest: false },
    fiatCode: 'USD',
    hidden: false,
    unitDefault: 'fiat',
    walletName: 'Daily wallet',
    totals: { fiatText: '$125,000.00', unitsText: '1 asset' },
    rows: [row()],
    capped: false,
    receive: [],
    inbox: [],
    request: {
        id: '0123456789abcdef0123456789abcdef',
        kind: 'request',
        iconHash: '',
        sentence: 'Confirm payment',
        amountText: '1.25 BTC',
    },
    settings: { showTotal: false, enabled: true },
    ...overrides,
});

const errors = (value) => {
    validate(value);
    return (validate.errors ?? []).map((error) => {
        if (error.keyword === 'required') return `${error.instancePath}/${error.params.missingProperty}`;
        if (error.keyword === 'additionalProperties') {
            return `${error.instancePath}/${error.params.additionalProperty}`;
        }
        return error.instancePath || '$';
    });
};

describe('watch snapshot schema', () => {
    it('accepts complete snapshots with either request variant', () => {
        expect(validate(snapshot())).toBe(true);
        expect(validate(snapshot({
            session: 'locked',
            unitDefault: 'units',
            request: {
                id: '0123456789abcdef0123456789abcdef',
                kind: 'paydue',
                iconHash: '',
                sentence: 'Payment due',
                amountText: '1.25 BTC',
                expiresAt: 1_700_000_060_000,
            },
        }))).toBe(true);
    });

    it('requires the complete envelope and rejects additions', () => {
        const withoutRequest = snapshot();
        delete withoutRequest.request;
        expect(errors(withoutRequest)).toContain('/request');
        for (const key of schema.required) {
            const value = snapshot();
            delete value[key];
            expect(errors(value), key).toContain(`/${key}`);
        }
        expect(errors(snapshot({ extra: true }))).toContain('/extra');
    });

    it('enforces row and receive caps at their boundaries', () => {
        expect(validate(snapshot({ rows: Array.from({ length: 50 }, (_, id) => row(String(id))) }))).toBe(true);
        expect(errors(snapshot({ rows: Array.from({ length: 51 }, (_, id) => row(String(id))) }))).toContain('/rows');
        expect(validate(snapshot({ receive: Array.from({ length: 12 }, (_, id) => receive(String(id))) }))).toBe(true);
        expect(errors(snapshot({ receive: Array.from({ length: 13 }, (_, id) => receive(String(id))) }))).toContain('/receive');
    });

    it('enforces the wallet name limit and timestamp types', () => {
        expect(validate(snapshot({ walletName: 'W'.repeat(40) }))).toBe(true);
        expect(errors(snapshot({ walletName: 'W'.repeat(41) }))).toContain('/walletName');
        for (const key of ['builtAt', 'balancesAt', 'pricesAt']) {
            expect(errors(snapshot({ [key]: -1 })), key).toContain(`/${key}`);
            expect(errors(snapshot({ [key]: 1.5 })), key).toContain(`/${key}`);
        }
    });

    it('references every dependent contract', () => {
        expect(errors(snapshot({ rows: [{ ...row(), displayName: 'X'.repeat(65) }] }))).toContain('/rows/0/displayName');
        expect(errors(snapshot({ receive: [{ ...receive(), label: '' }] }))).toContain('/receive/0/label');
        expect(errors(snapshot({ inbox: [{ id: 'alert' }] }))).toContain('/inbox/0/family');
        expect(errors(snapshot({ request: { kind: 'request' } }))).toContain('/request/id');
        expect(errors(snapshot({ settings: { enabled: true } }))).toContain('/settings/showTotal');
    });

    it('restricts state fields, totals, network and null values', () => {
        const value = snapshot({
            session: 'unknown',
            unitDefault: 'token',
            totals: { fiatText: '$1' },
            network: { kind: '', isTest: 'no' },
            fiatCode: null,
        });
        expect(validate(value)).toBe(false);
        expect(errors(value)).toEqual(expect.arrayContaining([
            '/session', '/unitDefault', '/totals/unitsText',
            '/network/kind', '/network/isTest', '/fiatCode',
        ]));
    });

    it('publishes the exact 60 KiB snapshot budget', () => {
        expect(schema['x-budgetBytes']).toBe(60 * 1024);
    });
});
