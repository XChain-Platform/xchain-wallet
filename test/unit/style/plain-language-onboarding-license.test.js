// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ONBOARDING = resolve(ROOT, 'packages/core/src/shared/routes/Onboarding.jsx');

// The license summary on first launch is plain source text, not a locale
// module, so the locale jargon scan does not see it. Same term list as that
// scan: wallet and protocol words a non-technical person does not know.
const TERMS = [
    'Token Spec', 'UTXO', 'UTXOs', 'sat/vB', 'vbyte', 'vbytes', 'nonce', 'scriptPubKey', 'xpub', 'descriptor',
    'derivation path', 'BIP39', 'BIP32', 'OP_RETURN', 'payload', 'envelope', 'witness', 'mempool', 'RBF',
    'CPFP', 'pubkey', 'sighash', 'txid', 'ABI', 'calldata', 'hex',
];
const TERM_PATTERN = new RegExp(
    `(?<![A-Za-z0-9_])(?:${TERMS.map((t) => t.replace(/[/_]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![A-Za-z0-9_])`,
    'i',
);

// Pulls each `text:` entry of the LICENSE_SUMMARY array; comments elsewhere in
// the file (which name BIP39 test vectors) stay out of the scan.
export function licenseSummaryTexts(source) {
    const start = source.indexOf('const LICENSE_SUMMARY = [');
    if (start < 0) return null;
    const end = source.indexOf('\n];', start);
    const block = source.slice(start, end);
    return [...block.matchAll(/\btext:\s*(['`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]);
}

describe('plain-language onboarding license summary', () => {
    it('extracts every summary entry and skips comments', () => {
        const sample = [
            '// a BIP39 test vector',
            'const LICENSE_SUMMARY = [',
            "    { text: 'Keep access to any BIP39 passphrase.' },",
            '    { text: `Keep ${x} safe.`, critical: true },',
            '];',
        ].join('\n');
        expect(licenseSummaryTexts(sample)).toEqual(['Keep access to any BIP39 passphrase.', 'Keep ${x} safe.']);
    });

    it('shows no wallet or protocol jargon in the license summary', () => {
        const texts = licenseSummaryTexts(readFileSync(ONBOARDING, 'utf8'));
        expect(texts?.length).toBeGreaterThan(1);
        const found = texts.filter((text) => TERM_PATTERN.test(text)).map((text) => text.match(TERM_PATTERN)[0]);
        expect(found).toEqual([]);
    });

    it('names the passphrase in plain words', () => {
        const texts = licenseSummaryTexts(readFileSync(ONBOARDING, 'utf8'));
        expect(texts.some((text) => text.includes('any extra passphrase'))).toBe(true);
    });
});
