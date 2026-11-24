// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCS_ROOT, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = resolve(here, '..', '..', '..');
const canonicalPath = join(walletRoot, 'packages', 'connect', 'wallet-requests.json');
const copyPath = join(DOCS_ROOT, 'protocol', 'json', 'wallet-requests.json');

skipUnlessDocs('wallet requests copies smoke');

if (!existsSync(copyPath)) {
    console.error(`FAIL: documentation copy is missing: ${copyPath}`);
    process.exit(1);
}

function readJson(path) {
    let bytes;
    try {
        bytes = readFileSync(path);
    } catch (error) {
        console.error(`FAIL: cannot read ${path}: ${error.message}`);
        process.exit(1);
    }

    try {
        JSON.parse(bytes.toString('utf8'));
    } catch (error) {
        console.error(`FAIL: ${path} is not valid JSON: ${error.message}`);
        process.exit(1);
    }
    return bytes;
}

const canonical = readJson(canonicalPath);
const copy = readJson(copyPath);

if (!canonical.equals(copy)) {
    const canonicalLines = canonical.toString('utf8').split('\n');
    const copyLines = copy.toString('utf8').split('\n');
    const lineCount = Math.max(canonicalLines.length, copyLines.length);
    let firstDifferingLine = 1;
    for (let index = 0; index < lineCount; index += 1) {
        if (canonicalLines[index] !== copyLines[index]) {
            firstDifferingLine = index + 1;
            break;
        }
    }
    console.error(`FAIL: ${canonicalPath} and ${copyPath} are not byte-identical; `
        + `first differing line: ${firstDifferingLine}`);
    process.exit(1);
}

console.log(`OK: ${canonicalPath} and ${copyPath} are byte-identical (${canonical.length} bytes)`);
