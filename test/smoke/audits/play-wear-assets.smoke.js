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
const requiredCopy = [
    'Your balances and wallet alerts on your wrist. Your phone keeps your keys and signs everything.',
    'Wear OS Tile',
    'complication',
    'receive QR',
    'Hide amounts',
    'XChain Wallet Android app is required',
];
const screenshots = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => ({ name, header: pngHeader(fs.readFileSync(new URL(name, directory))) }));
const problems = wearListingProblems({ readme, screenshots });
for (const phrase of requiredCopy) {
    if (!readme?.includes(phrase)) problems.push(`README.md lacks listing copy: ${phrase}`);
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}

console.log(`ok: ${screenshots.length} Wear Play screenshots and listing copy passed`);
