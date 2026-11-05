// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const EN_DIR = resolve(ROOT, 'packages/core/src/i18n/locales/en');

// Wallet and protocol terms a non-technical person does not know. Whole-word,
// case-insensitive, matched against the visible string values.
const TERMS = [
    'Token Spec', 'UTXO', 'UTXOs', 'sat/vB', 'vbyte', 'vbytes', 'nonce', 'scriptPubKey', 'xpub', 'descriptor',
    'derivation path', 'BIP39', 'BIP32', 'OP_RETURN', 'payload', 'envelope', 'witness', 'mempool', 'RBF',
    'CPFP', 'pubkey', 'sighash', 'txid', 'ABI', 'calldata', 'hex',
];
const TERM_PATTERN = new RegExp(
    `(?<![A-Za-z0-9_])(?:${TERMS.map((t) => t.replace(/[/_]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![A-Za-z0-9_])`,
    'i',
);

// Keys shown only in Developer mode.
const DEVELOPER_KEY = /^settings\.developer\./;

export function jargonLabels(messages, file = 'fixture') {
    return Object.entries(messages)
        .filter(([key, text]) => typeof text === 'string' && !DEVELOPER_KEY.test(key) && TERM_PATTERN.test(text))
        .map(([key, text]) => `${file} ${key}: ${text.match(TERM_PATTERN)[0]}`);
}

describe('plain-language labels (jargon scan of visible strings)', () => {
    it('flags whole-word jargon outside Developer mode and ignores substrings', () => {
        expect(jargonLabels({ a: 'Use a BIP39 passphrase', b: 'Derivation path', 'settings.developer.x': 'descriptor' }))
            .toEqual(['fixture a: BIP39', 'fixture b: Derivation path']);
        expect(jargonLabels({ a: 'Details', b: 'Reachability', c: 'Hexagon' })).toEqual([]);
    });

    it('finds no wallet or protocol jargon in any visible English string', async () => {
        const files = readdirSync(EN_DIR).filter((name) => name.endsWith('.js') && name !== 'index.js').sort();
        const found = [];
        for (const name of files) {
            const mod = await import(pathToFileURL(resolve(EN_DIR, name)).href);
            found.push(...jargonLabels(mod.default ?? mod, name));
        }
        expect(found).toEqual([]);
    });
});

describe('wallet picker format badge', () => {
    it('names a recovery-phrase wallet Standard and never shows BIP39', async () => {
        const mod = await import(pathToFileURL(resolve(EN_DIR, 'walletPicker.js')).href);
        const messages = mod.default ?? mod;
        expect(messages['walletPicker.bip39']).toBe('Standard');
        expect(messages['walletPicker.bip39']).not.toBe(messages['walletPicker.importedKey']);
        expect(messages['walletPicker.bip39']).not.toBe(messages['walletPicker.legacy']);
        const strings = Object.values(messages).filter((text) => typeof text === 'string');
        expect(strings.filter((text) => /\bBIP39\b/i.test(text))).toEqual([]);
    });
});

describe('derivation path cross-check copy', () => {
    it('labels the help tip and the comparison text with account path, never derivation path', async () => {
        const mod = await import(pathToFileURL(resolve(EN_DIR, 'components.js')).href);
        const messages = mod.default ?? mod;
        const prefix = 'components.derivationPathCrossCheck.';
        expect(messages[`${prefix}derivationPathHelpLabel`]).toBe('Account path help');
        expect(messages[`${prefix}theDerivationPathAndAddress`]).toContain('account path');
        expect(messages[`${prefix}trezorDisplaysTheAddressAnd`]).toContain('account path');
        const jargon = Object.entries(messages)
            .filter(([key, text]) => key.startsWith(prefix) && typeof text === 'string' && /derivation path/i.test(text))
            .map(([key]) => key);
        expect(jargon).toEqual([]);
    });
});
