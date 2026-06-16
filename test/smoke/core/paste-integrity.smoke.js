// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 2 — pasteIntegrity helper.

import { strict as assert } from 'node:assert';
import {
    hashText,
    checkPasteIntegrity,
} from '../../../packages/core/src/shared/utils/pasteIntegrity.js';

// --- hashText -----------------------------------------------------------

assert.equal(hashText(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'SHA-256("") fixed value');
assert.equal(hashText('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA-256("abc") fixed value');
assert.equal(hashText(null), '', 'non-string → empty');
assert.equal(hashText(undefined), '', 'non-string → empty');

// Identical inputs → identical hash
const a = hashText('bc1qrealaddressonexamplecharsxx');
const b = hashText('bc1qrealaddressonexamplecharsxx');
assert.equal(a, b);

// Single-character change → different hash
const c = hashText('bc1qreaIaddressonexamplecharsxx');
assert.notEqual(a, c);

// --- checkPasteIntegrity ------------------------------------------------

// No clipboard at all → skipped
const noCb = await checkPasteIntegrity({ pastedText: 'foo' });
assert.equal(noCb.ok, true);
assert.equal(noCb.skipped, true);
assert.equal(typeof noCb.pastedHash, 'string');
assert.ok(noCb.pastedHash.length > 0);

// Non-string pastedText → skipped
const nonStr = await checkPasteIntegrity({ pastedText: undefined });
assert.equal(nonStr.skipped, true);

// Clipboard re-read returns the same value → ok
const same = await checkPasteIntegrity({
    pastedText: 'foo',
    clipboard: { readText: async () => 'foo' },
});
assert.equal(same.ok, true);
assert.equal(same.skipped, undefined);
assert.equal(same.pastedHash, same.rereadHash);

// Clipboard re-read returns a different value → mismatch
const diff = await checkPasteIntegrity({
    pastedText: 'foo',
    clipboard: { readText: async () => 'bar' },
});
assert.equal(diff.ok, false);
assert.equal(diff.reread, 'bar');
assert.notEqual(diff.pastedHash, diff.rereadHash);
assert.match(diff.reason, /clipboard/i);

// Clipboard read throws → skipped (silent)
const errClip = await checkPasteIntegrity({
    pastedText: 'foo',
    clipboard: {
        readText: async () => { throw new Error('permission denied'); },
    },
});
assert.equal(errClip.ok, true);
assert.equal(errClip.skipped, true);

// Clipboard read returns non-string → skipped
const nonStrRead = await checkPasteIntegrity({
    pastedText: 'foo',
    clipboard: { readText: async () => null },
});
assert.equal(nonStrRead.ok, true);
assert.equal(nonStrRead.skipped, true);

// Clipboard with no readText fn → skipped
const noFn = await checkPasteIntegrity({
    pastedText: 'foo',
    clipboard: {},
});
assert.equal(noFn.ok, true);
assert.equal(noFn.skipped, true);

console.log('paste-integrity smoke OK');
