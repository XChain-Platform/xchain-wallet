// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    activeNetworkLabel,
    activeNetworkOptions,
    confirmActiveNetworkSwitch,
    normalizeActiveNetwork,
    persistActiveNetwork,
} from '../../../../packages/core/src/shared/utils/activeNetworkSwitch.js';
import {
    csvField,
    parseCsvRecords,
} from '../../../../packages/core/src/shared/utils/csv.js';

const HUGE_TEXT = '💰'.repeat(500_000);

describe('active network helpers', () => {
    it.each([
        { value: 'mainnet', normalized: 'mainnet', label: 'Mainnet' },
        { value: 'testnet', normalized: 'testnet', label: 'Testnet' },
        { value: 'regtest', normalized: 'regtest', label: 'Regtest' },
        { value: '', normalized: 'mainnet', label: 'Mainnet' },
        { value: null, normalized: 'mainnet', label: 'Mainnet' },
        { value: HUGE_TEXT, normalized: 'mainnet', label: 'Mainnet' },
        { value: '主网', normalized: 'mainnet', label: 'Mainnet' },
    ])('normalizes and labels $value', ({ value, normalized, label }) => {
        expect(normalizeActiveNetwork(value)).toBe(normalized);
        expect(activeNetworkLabel(value)).toBe(label);
    });

    it.each([
        { options: undefined, values: ['mainnet', 'testnet'] },
        { options: {}, values: ['mainnet', 'testnet'] },
        { options: { current: 'regtest' }, values: ['mainnet', 'testnet', 'regtest'] },
        { options: { developerMode: true }, values: ['mainnet', 'testnet', 'regtest'] },
        { options: { developerMode: false, current: 'リグテスト' }, values: ['mainnet', 'testnet'] },
    ])('offers the expected choices for $options', ({ options, values }) => {
        expect(activeNetworkOptions(options).map(({ value }) => value)).toEqual(values);
    });

    it.each([
        { current: 'mainnet', next: 'mainnet', expected: false, calls: 0 },
        { current: 'testnet', next: '', expected: false, calls: 0 },
        { current: 'testnet', next: null, expected: false, calls: 0 },
        { current: 'testnet', next: HUGE_TEXT, expected: false, calls: 0 },
        { current: 'testnet', next: '主网', expected: false, calls: 0 },
        { current: null, next: 'testnet', expected: true, calls: 1 },
        { current: 'mainnet', next: 'testnet', expected: true, calls: 1 },
    ])('confirms $current to $next only when labels differ', ({ current, next, expected, calls }) => {
        const confirm = vi.fn(() => true);

        expect(confirmActiveNetworkSwitch(current, next, confirm)).toBe(expected);
        expect(confirm).toHaveBeenCalledTimes(calls);
    });

    it('describes both network data boundaries in the confirmation', () => {
        const confirm = vi.fn(() => false);

        expect(confirmActiveNetworkSwitch('mainnet', 'regtest', confirm)).toBe(false);
        expect(confirm).toHaveBeenCalledWith(
            'Switch from Mainnet to Regtest? The wallet will reload and refresh balances and history for Regtest. Mainnet data stays saved and hidden until you switch back.',
        );
    });

    it.each([
        { network: '', message: 'A valid active network is required.' },
        { network: null, message: 'A valid active network is required.' },
        { network: HUGE_TEXT, message: 'A valid active network is required.' },
        { network: 'テストネット', message: 'A valid active network is required.' },
    ])('rejects invalid persisted network $network', async ({ network, message }) => {
        await expect(persistActiveNetwork({ network })).rejects.toThrow(message);
    });

    it.each([
        {
            name: 'host messaging',
            input: () => {
                const setActiveNetwork = vi.fn(async (request) => ({ request }));
                return {
                    options: { messaging: { setActiveNetwork }, walletId: 'wallet-🐳', network: 'regtest' },
                    expected: { request: { walletId: 'wallet-🐳', network: 'regtest' } },
                    called: setActiveNetwork,
                    argument: { walletId: 'wallet-🐳', network: 'regtest' },
                };
            },
        },
        {
            name: 'settings update',
            input: () => {
                const update = vi.fn(async (patch) => ({ ...patch, saved: true }));
                return {
                    options: { update, network: 'testnet' },
                    expected: { settings: { activeNetwork: 'testnet', saved: true } },
                    called: update,
                    argument: { activeNetwork: 'testnet' },
                };
            },
        },
    ])('persists through $name', async ({ input }) => {
        const { options, expected, called, argument } = input();

        await expect(persistActiveNetwork(options)).resolves.toEqual(expected);
        expect(called).toHaveBeenCalledWith(argument);
    });

    it('rejects when no persistence route is available', async () => {
        await expect(persistActiveNetwork({ network: 'mainnet' }))
            .rejects.toThrow('Active network switching is not available in this shell.');
    });
});

describe('CSV helpers', () => {
    it.each([
        { text: '', rows: [] },
        { text: null, rows: [] },
        { text: 'name,value\r\n"雪,🌨️","say ""hello"""', rows: [
            { cells: ['name', 'value'], line: 1 },
            { cells: ['雪,🌨️', 'say "hello"'], line: 2 },
        ] },
        { text: 'first,"line one\r\nline two"\nlast,row', rows: [
            { cells: ['first', 'line one\nline two'], line: 1 },
            { cells: ['last', 'row'], line: 3 },
        ] },
        { text: HUGE_TEXT, rows: [{ cells: [HUGE_TEXT], line: 1 }] },
    ])('parses records from %#', ({ text, rows }) => {
        expect(parseCsvRecords(text)).toEqual(rows);
    });

    it.each([
        { text: 'plain"quote', error: 'Line 1: unexpected quote in unquoted field.' },
        { text: '"closed"tail', error: 'Line 1: unexpected character after closing quote.' },
        { text: 'ok\n"unterminated', error: 'Line 2: unterminated quoted field.' },
    ])('rejects malformed strict CSV: $text', ({ text, error }) => {
        expect(() => parseCsvRecords(text, { strict: true })).toThrow(error);
    });

    it.each([
        { value: '', encoded: '' },
        { value: null, encoded: '' },
        { value: '東京🍣', encoded: '東京🍣' },
        { value: 'comma,value', encoded: '"comma,value"' },
        { value: 'say "hello"', encoded: '"say ""hello"""' },
        { value: 'line one\nline two', encoded: '"line one\nline two"' },
        { value: HUGE_TEXT, encoded: HUGE_TEXT },
    ])('encodes and parses %#', ({ value, encoded }) => {
        expect(csvField(value)).toBe(encoded);
        expect(parseCsvRecords(encoded)).toEqual(encoded === ''
            ? []
            : [{ cells: [String(value)], line: 1 }]);
    });
});
