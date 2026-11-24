// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';

import {
    pngHeader,
    wearListingProblems,
} from '../../../tools/release/verify-listing-assets.mjs';

const directory = new URL('../../../packages/mobile/store-assets/play/wear/', import.meta.url);
const readmeUrl = new URL('README.md', directory);
const readme = fs.existsSync(readmeUrl) ? fs.readFileSync(readmeUrl, 'utf8') : null;
const shortDescription = 'Your balances and wallet alerts on your wrist. '
    + 'Your phone keeps your keys and signs everything.\n';
const fullDescription = [
    'The Wear OS Tile and complication show wallet balances and alerts at a glance.',
    'Open the receive QR on your watch when someone needs your address, and use Hide amounts',
    'when you want to keep balances private. The XChain Wallet Android app is required because',
    'the phone keeps the keys and signs every transaction.\n',
].join(' ');
const listingCopy = new Map([
    ['short-description.txt', shortDescription],
    ['full-description.txt', fullDescription],
]);
const screenshots = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => ({ name, header: pngHeader(fs.readFileSync(new URL(name, directory))) }));
const problems = wearListingProblems({ readme, screenshots });
for (const [name, expected] of listingCopy) {
    const url = new URL(name, directory);
    if (!fs.existsSync(url)) problems.push(`${name} missing`);
    else if (fs.readFileSync(url, 'utf8') !== expected) {
        problems.push(`${name} does not match required copy`);
    }
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}

console.log(`ok: ${screenshots.length} Wear Play screenshots and listing copy passed`);
