// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { activeNetworkControl } from './regtest.js';

test('targets the settings network control by role and exact accessible name', () => {
    const control = {};
    let query;
    const page = {
        getByRole(...args) {
            query = args;
            return control;
        },
    };

    assert.equal(activeNetworkControl(page), control);
    assert.deepEqual(query, [
        'combobox',
        { name: 'Active network', exact: true },
    ]);
});
