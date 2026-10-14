// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { activeNetworkControl } from './regtest.js';

it('targets the settings network control by role and exact accessible name', () => {
    const control = {};
    let query;
    const page = {
        getByRole(...args) {
            query = args;
            return control;
        },
    };

    expect(activeNetworkControl(page)).toBe(control);
    expect(query).toEqual([
        'combobox',
        { name: 'Active network', exact: true },
    ]);
});
