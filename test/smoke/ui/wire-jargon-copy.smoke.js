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
// copy says "the network" where a developer would say "mempool".

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
    { re: />\s*Txid\s*</, say: 'labels the id row "Txid"; say "Transaction ID"' },
    {
        re: /(?:label|hint|sub):\s*'[^']*\b(?:in|the) mempool\b/i,
        say: 'names the mempool; say "the network"',
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

assert.deepEqual(hits, [], 'user-facing copy carries wire jargon:\n' + hits.join('\n'));

// The en dictionary follows its own pending-block convention: "the network", never the mempool.
const { en } = await import(join(wsRoot, 'packages', 'core', 'src', 'i18n', 'en.js'));
assert.ok('pending.detail.seen' in en, 'the jargon sweep reads the pending block');
const mempoolKeys = Object.keys(en).filter((key) => /mempool/i.test(String(en[key])));
assert.deepEqual(mempoolKeys, [], 'en copy names the mempool; say "the network" instead');

console.log(`wire-jargon-copy: ${files.length} shared sources and ${Object.keys(en).length} en strings clean`);
