// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 1 — recentDestinations helper.

import { strict as assert } from 'node:assert';
import {
    buildRecentDestinations,
    filterSuggestions,
} from '../../../packages/core/src/flows/recentDestinations.js';

// --- empty inputs ---------------------------------------------------------

assert.deepEqual(buildRecentDestinations(), [], 'no inputs → empty');
assert.deepEqual(buildRecentDestinations({}), [], 'empty inputs → empty');
assert.deepEqual(
    buildRecentDestinations({ contacts: [], historyRows: [], chainCoin: 'bitcoin' }),
    [],
    'empty arrays → empty',
);

// --- contact filtering by chain ------------------------------------------

const contacts = [
    {
        name: 'Alice',
        entries: [
            { chain: 'bitcoin', address: 'bc1qalice', label: 'main' },
            { chain: 'litecoin', address: 'ltc1qalice', label: 'main' },
        ],
    },
    {
        name: 'Bob',
        entries: [
            { chain: 'bitcoin', address: 'bc1qbob', label: '' },
        ],
    },
    {
        name: 'Carla',
        entries: [
            { chain: 'dogecoin', address: 'D7carla', label: 'wallet' },
        ],
    },
];

const btcContacts = buildRecentDestinations({ contacts, chainCoin: 'bitcoin' });
assert.equal(btcContacts.length, 2, 'two contacts have bitcoin entries');
assert.equal(btcContacts[0].source, 'contact');
assert.deepEqual(
    btcContacts.map((s) => s.address),
    ['bc1qalice', 'bc1qbob'],
    'contact suggestions in input order',
);
assert.equal(btcContacts[0].label, 'Alice', 'label = contact name');

const ltcContacts = buildRecentDestinations({ contacts, chainCoin: 'litecoin' });
assert.equal(ltcContacts.length, 1, 'only Alice has a litecoin entry');
assert.equal(ltcContacts[0].address, 'ltc1qalice');

assert.equal(
    buildRecentDestinations({ contacts, chainCoin: 'bitcoin-testnet' }).length,
    0,
    'unknown coin family → 0 contact rows',
);

// --- history aggregation: SEND only, dedup, recency ordering --------------

const historyRows = [
    { action: 'SEND', destination: 'bc1qold', timestamp: 1000 },
    { action: 'SEND', destination: 'bc1qnew', timestamp: 5000 },
    { action: 'SEND', destination: 'bc1qmid', timestamp: 3000 },
    { action: 'SEND', destination: 'bc1qold', timestamp: 1500 },
    { action: 'ISSUE', tick: 'XCP', timestamp: 9000 }, // ignored — not a send
    { action: 'SEND', DESTINATION: 'bc1qcaps', timestamp: 4000 }, // case variant
    { action: 'SEND', recipient: 'bc1qrecipient', timestamp: 2000 }, // alt field
];

const histOnly = buildRecentDestinations({ historyRows });
assert.equal(histOnly.length, 5, 'five distinct send destinations');
assert.deepEqual(
    histOnly.map((s) => s.address),
    ['bc1qnew', 'bc1qcaps', 'bc1qmid', 'bc1qrecipient', 'bc1qold'],
    'history sorted desc by lastSentAt',
);
assert.equal(histOnly.every((s) => s.source === 'history'), true);
const oldEntry = histOnly.find((s) => s.address === 'bc1qold');
assert.equal(oldEntry.count, 2, 'duplicate destination count aggregated');
assert.equal(oldEntry.sublabel, 'Sent 2 times');

// --- merge: contact takes precedence over history for same address --------

const merged = buildRecentDestinations({
    contacts: [
        {
            name: 'Alice',
            entries: [{ chain: 'bitcoin', address: 'bc1qmid', label: 'main' }],
        },
    ],
    chainCoin: 'bitcoin',
    historyRows,
});
const aliceRow = merged.find((s) => s.address === 'bc1qmid');
assert.equal(aliceRow.source, 'contact', 'contact wins dedup');
assert.equal(aliceRow.label, 'Alice', 'contact label preserved');
assert.equal(
    merged.filter((s) => s.address === 'bc1qmid').length,
    1,
    'no duplicates after merge',
);

// --- contact name vs entry label --------------------------------------------

const subSuggest = buildRecentDestinations({
    contacts: [
        {
            name: 'Carol',
            entries: [{ chain: 'bitcoin', address: 'bc1qcarol', label: 'cold storage' }],
        },
    ],
    chainCoin: 'bitcoin',
});
assert.equal(subSuggest[0].label, 'Carol');
assert.equal(subSuggest[0].sublabel, 'cold storage', 'entry label becomes sublabel');

// Same name + label → no redundant sublabel.
const sameNameLabel = buildRecentDestinations({
    contacts: [
        {
            name: 'main',
            entries: [{ chain: 'bitcoin', address: 'bc1qz', label: 'main' }],
        },
    ],
    chainCoin: 'bitcoin',
});
assert.equal(sameNameLabel[0].sublabel, undefined, 'redundant sublabel suppressed');

// --- filterSuggestions ---------------------------------------------------

const all = [
    { address: 'bc1qalice', label: 'Alice', source: 'contact' },
    { address: 'bc1qbob', label: 'Bob', source: 'contact' },
    { address: 'bc1qchar', label: 'bc1qch…rabc', source: 'history' },
];

assert.equal(filterSuggestions(all, '').length, 3, 'empty query passes all');
assert.equal(filterSuggestions(all, '   ').length, 3, 'whitespace query passes all');
assert.equal(filterSuggestions(all, 'ALICE').length, 1, 'case-insensitive name match');
assert.equal(filterSuggestions(all, 'bc1q').length, 3, 'address-prefix match');
assert.equal(filterSuggestions(all, 'zzz').length, 0, 'no match → empty');

console.log('recent-destinations smoke OK');
