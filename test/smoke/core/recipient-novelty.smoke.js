// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 3 — recipientNovelty helper.

import { strict as assert } from 'node:assert';
import { checkRecipientNovelty } from '../../../packages/core/src/flows/recipientNovelty.js';

// --- empty / invalid input ----------------------------------------------

const empty = checkRecipientNovelty({});
assert.deepEqual(empty, { everSentTo: false, knownAsContact: false, novel: false },
    'no inputs → all false (no address means no novelty signal)');

assert.deepEqual(
    checkRecipientNovelty({ address: '' }),
    { everSentTo: false, knownAsContact: false, novel: false },
);

const noChain = checkRecipientNovelty({
    address: 'bc1qcontact',
    contacts: [{ name: 'A', entries: [{ chain: 'bitcoin', address: 'bc1qcontact' }] }],
});
assert.equal(noChain.knownAsContact, false, 'no chainCoin → contact lookup skipped');
assert.equal(noChain.novel, true);

// --- contact match ------------------------------------------------------

const contactHit = checkRecipientNovelty({
    address: 'bc1qcontact',
    chainCoin: 'bitcoin',
    contacts: [
        { name: 'Alice', entries: [{ chain: 'bitcoin', address: 'bc1qcontact' }] },
        { name: 'Bob', entries: [{ chain: 'bitcoin', address: 'bc1qother' }] },
    ],
});
assert.equal(contactHit.knownAsContact, true);
assert.equal(contactHit.everSentTo, false);
assert.equal(contactHit.novel, false);

// Wrong chain → no contact hit
const wrongChain = checkRecipientNovelty({
    address: 'bc1qcontact',
    chainCoin: 'litecoin',
    contacts: [
        { name: 'Alice', entries: [{ chain: 'bitcoin', address: 'bc1qcontact' }] },
    ],
});
assert.equal(wrongChain.knownAsContact, false, 'contact entry on different chain → no match');

// --- history match ------------------------------------------------------

const histHit = checkRecipientNovelty({
    address: 'bc1qhistory',
    chainCoin: 'bitcoin',
    historyRows: [
        { action: 'SEND', destination: 'bc1qhistory', timestamp: 1000 },
        { action: 'ISSUE', tick: 'XCP' },
    ],
});
assert.equal(histHit.everSentTo, true);
assert.equal(histHit.knownAsContact, false);
assert.equal(histHit.novel, false);

// Non-SEND actions don't count
const onlyIssue = checkRecipientNovelty({
    address: 'bc1qbobissues',
    chainCoin: 'bitcoin',
    historyRows: [
        { action: 'ISSUE', tick: 'XCP', destination: 'bc1qbobissues' },
    ],
});
assert.equal(onlyIssue.everSentTo, false, 'ISSUE actions ignored');

// Alt destination field names
const altField = checkRecipientNovelty({
    address: 'bc1qrec',
    historyRows: [
        { action: 'SEND', recipient: 'bc1qrec' },
    ],
});
assert.equal(altField.everSentTo, true, 'recognizes "recipient" alt field');

const upperField = checkRecipientNovelty({
    address: 'bc1qcaps',
    historyRows: [
        { ACTION: 'SEND', DESTINATION: 'bc1qcaps' },
    ],
});
assert.equal(upperField.everSentTo, true, 'recognizes uppercase ACTION + DESTINATION');

// --- novel address ------------------------------------------------------

const novel = checkRecipientNovelty({
    address: 'bc1qbrandnew',
    chainCoin: 'bitcoin',
    contacts: [{ name: 'Alice', entries: [{ chain: 'bitcoin', address: 'bc1qother' }] }],
    historyRows: [{ action: 'SEND', destination: 'bc1qsomeoneelse' }],
});
assert.equal(novel.everSentTo, false);
assert.equal(novel.knownAsContact, false);
assert.equal(novel.novel, true);

console.log('recipient-novelty smoke OK');
