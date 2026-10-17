// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunInput, TESTNET_ADDRESS_RE } from './testnet.js';

const USAGE = 'usage: node test/e2e/fixtures/testnet_run_input.js <treasury.json> <claimant.json>';

function parseWallet(text, role) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`${role} file is not valid JSON`);
    }

    if (typeof parsed?.wif !== 'string') {
        throw new Error(`${role} file field wif must be a string`);
    }
    const address = parsed?.address ?? parsed?.segwitAddress;
    if (typeof address !== 'string') {
        throw new Error(`${role} file field address must be a string`);
    }
    if (!TESTNET_ADDRESS_RE.test(address)) {
        throw new Error(`${role} file field address must be a Bitcoin testnet address`);
    }
    return { wif: parsed.wif, address };
}

export function assembleRunInput(treasuryText, claimantText) {
    const treasury = parseWallet(treasuryText, 'treasury');
    const claimant = parseWallet(claimantText, 'claimant');
    const result = JSON.stringify({
        wif: treasury.wif,
        address: treasury.address,
        claimant,
    });
    parseRunInput(result);
    return result;
}

function readPrivateWallet(file, role) {
    if ((fs.statSync(file).mode & 0o077) !== 0) {
        throw new Error(`${role} file grants group or other access`);
    }
    return fs.readFileSync(file, 'utf8');
}

export function main(argv = process.argv.slice(2), {
    stdout = process.stdout,
    stderr = process.stderr,
} = {}) {
    if (argv.length < 2) {
        stderr.write(`${USAGE}\n`);
        return 2;
    }
    if (stdout.isTTY) {
        throw new Error('stdout is a TTY; pipe the run input to the testnet test command');
    }

    const treasuryText = readPrivateWallet(argv[0], 'treasury');
    const claimantText = readPrivateWallet(argv[1], 'claimant');
    stdout.write(`${assembleRunInput(treasuryText, claimantText)}\n`);
    return 0;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`testnet run input: ${error.message}\n`);
        process.exitCode = 1;
    }
}
