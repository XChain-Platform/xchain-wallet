// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { networkOption } from './regtest.js';

it('targets a Network page environment row by role and exact accessible name', () => {
    const control = {};
    const queries = [];
    const page = {
        getByRole(...args) {
            queries.push(args);
            return control;
        },
    };

    expect(networkOption(page, 'regtest')).toBe(control);
    expect(networkOption(page, 'testnet')).toBe(control);
    expect(queries).toEqual([
        ['button', { name: 'Select Regtest', exact: true }],
        ['button', { name: 'Select Testnet', exact: true }],
    ]);
});
