// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke: shared surfaces name actions and fields in plain words.
//
// A thrown "LIST broadcast did not return a txid." reaches the screen, because
// submitFailureMessage falls back to the error's own text. So an all-caps wire
// verb that opens a sentence literal, or the phrase "LIST action index", is
// copy a holder reads. Code values ('LIST' as an action name) are not matched:
// only a verb followed by a word inside the same literal is. Done screens
// label the id row "Transaction ID", never the shorthand "Txid", and pending
// copy says "the network" where a developer would say "mempool". The deploy
// wait messages and the transaction simulator notes are read the same way.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const SHARED = join(wsRoot, 'packages', 'core', 'src', 'shared');

// Walk a tree and collect JS/JSX sources.
function sources(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) sources(full, out);
        else if (/\.jsx?$/.test(name)) out.push(full);
    }
    return out;
}

const RULES = [
    {
        re: /['"`](?:LIST|AIRDROP|LINK) broadcast\b/,
        say: 'a wire opcode opens a sentence; say "Recipient list", "Airdrop" or "Cross-chain link"',
    },
    { re: /LIST action index/, say: 'names the LIST opcode; say "list number"' },
    { re: /['"`]Copy txid['"`]/i, say: 'labels a button "Copy txid"; say "Copy transaction ID"' },
    { re: />\s*Txid\s*</, say: 'labels the id row "Txid"; say "Transaction ID"' },
    {
        re: /['"`][^'"`]*\bderivation index\b/i,
        say: 'names the derivation index in a literal; say "address number"',
    },
    {
        re: /(?:label|placeholder)=["'][^"']*\b(?:xpub|hex|\d+-byte|\d+ bytes)\b/i,
        say: 'names a key encoding in a field label; say "Account public key" or "Public key"',
    },
    {
        re: /(?:<option[^>]*>|<dt[^>]*>)\s*(?:External )?xpub\s*</i,
        say: 'labels an option or row "xpub"; say "Account public key" or "Another wallet"',
    },
    {
        re: /(?:label|hint|sub):\s*'[^']*\b(?:in|the) mempool\b/i,
        say: 'names the mempool; say "the network"',
    },
];

const COPY_FILES = [
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'deployLegWait.js'),
    join(wsRoot, 'packages', 'core', 'src', 'decoder', 'txSimulator.js'),
];
const COPY_RULES = [
    { re: /\b(?:the|in) mempool\b/i, say: 'names the mempool; say "the network"' },
    { re: /['"`][^'"`]*\bsnapshot block\b/i, say: 'names the snapshot block; say "when this transaction confirms"' },
    { re: /['"`][^'"`]*\bpre-?fetch/i, say: 'says "pre-fetch"; say "work it out ahead of time"' },
];

// Validation messages on the multisig and agent account forms show under the
// field a holder just filled, so they name the key in plain words too. The
// message literal handed to add(), return or an Error is read; the code value
// 'external-xpub' and a sample key in a placeholder are not messages.
const VALIDATION_FILES = [
    join(SHARED, 'routes', 'MultisigCreate.jsx'),
    join(SHARED, 'routes', 'CoSignerProvision.jsx'),
];
const VALIDATION_RULES = [
    {
        re: /(?:\badd\([^,]+,\s*|\breturn\s+|Error\(\s*)['"`][^'"`]*\b(?:xpub|hex|\d+-byte|\d+ bytes)\b/i,
        say: 'names a key encoding in a validation message; say "account public key" or give the length and first characters',
    },
];

const files = sources(SHARED);
assert.ok(files.length > 100, `expected the shared tree to hold >100 sources, found ${files.length}`);

const hits = [];
for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const { re, say } of RULES) {
            if (re.test(line)) hits.push(`${relative(wsRoot, file)}:${i + 1}: ${say}: ${line.trim()}`);
        }
    });
}

for (const file of COPY_FILES) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const { re, say } of COPY_RULES) {
            if (re.test(line)) hits.push(`${relative(wsRoot, file)}:${i + 1}: ${say}: ${line.trim()}`);
        }
    });
}

for (const file of VALIDATION_FILES) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const { re, say } of VALIDATION_RULES) {
            if (re.test(line)) hits.push(`${relative(wsRoot, file)}:${i + 1}: ${say}: ${line.trim()}`);
        }
    });
}

assert.deepEqual(hits, [], 'user-facing copy carries wire jargon:\n' + hits.join('\n'));

const multisigCreate = readFileSync(join(SHARED, 'routes', 'MultisigCreate.jsx'), 'utf8');
assert.doesNotMatch(multisigCreate, /Classic multi-signature|SegWit multi-signature|Taproot multi-signature/,
    'the Type dropdown uses the short Classic, SegWit and Taproot labels');
assert.match(multisigCreate, /Joining someone else's multisig\? Share this wallet as a cosigner/,
    'the cosigner sharing path uses plain link copy');

// The en dictionary follows its own pending-block convention: "the network", never the mempool.
const { en } = await import(join(wsRoot, 'packages', 'core', 'src', 'i18n', 'locales', 'en', 'index.js'));
assert.ok('pending.detail.seen' in en, 'the jargon sweep reads the pending block');
const mempoolKeys = Object.keys(en).filter((key) => /mempool/i.test(String(en[key])));
assert.deepEqual(mempoolKeys, [], 'en copy names the mempool; say "the network" instead');

// Labels in the en dictionary say "transaction ID" and "address number", never the developer shorthand.
const shorthandKeys = Object.keys(en).filter((key) => /\btxid\b|derivation index/i.test(String(en[key])));
assert.deepEqual(shorthandKeys, [], 'en copy carries "txid" or "derivation index"; say "transaction ID" or "address number"');

// The cosigner share labels and instructions say "account public key" and "Another wallet", never "xpub".
const xpubKeys = Object.keys(en).filter((key) => /\bxpub\b/i.test(String(en[key])));
assert.deepEqual(xpubKeys, [], 'en copy says "xpub"; say "account public key" or "Another wallet"');

console.log(`wire-jargon-copy: ${files.length} shared sources and ${Object.keys(en).length} en strings clean`);
