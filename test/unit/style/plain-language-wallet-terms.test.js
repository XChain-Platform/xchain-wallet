// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAIN_LANGUAGE_TERM_PATTERN } from './plain-language-jargon.js';

const ROOT = process.cwd();
const EN_DIR = resolve(ROOT, 'packages/core/src/i18n/locales/en');

// Keys shown only in Developer mode. The Test Networks pages (custom networks
// and the regtest faucet) are Developer mode tools split out of
// settings.developer.* on 2026-11-14; a network descriptor is what they take.
const DEVELOPER_KEY = /^settings\.(?:developer|testNetworks)\./;

// The wallet list names a recovery-phrase wallet's type BIP39 beside its account count, matching the Wallet details card.
const ALLOWED = new Set(['walletPicker.js walletPicker.bip39']);

export function jargonLabels(messages, file = 'fixture') {
    return Object.entries(messages)
        .filter(([key, text]) => typeof text === 'string' && !DEVELOPER_KEY.test(key) && !ALLOWED.has(`${file} ${key}`) && PLAIN_LANGUAGE_TERM_PATTERN.test(text))
        .map(([key, text]) => `${file} ${key}: ${text.match(PLAIN_LANGUAGE_TERM_PATTERN)[0]}`);
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
    it('names a recovery-phrase wallet BIP39 in its one badge and nowhere else in the picker copy', async () => {
        const mod = await import(pathToFileURL(resolve(EN_DIR, 'walletPicker.js')).href);
        const messages = mod.default ?? mod;
        expect(messages['walletPicker.bip39']).toBe('BIP39');
        expect(messages['walletPicker.bip39']).not.toBe(messages['walletPicker.importedKey']);
        expect(messages['walletPicker.bip39']).not.toBe(messages['walletPicker.legacy']);
        const strings = Object.entries(messages)
            .filter(([key, text]) => key !== 'walletPicker.bip39' && typeof text === 'string');
        expect(strings.filter(([, text]) => /\bBIP39\b/i.test(text))).toEqual([]);
    });
});

describe('derivation path cross-check copy', () => {
    // G121 (2026-11-15): the read-only account path carries no help tip, so
    // only the comparison text is left to name it.
    it('labels the comparison text with account path, never derivation path', async () => {
        const mod = await import(pathToFileURL(resolve(EN_DIR, 'components.js')).href);
        const messages = mod.default ?? mod;
        const prefix = 'components.derivationPathCrossCheck.';
        expect(messages[`${prefix}derivationPathHelpLabel`]).toBeUndefined();
        expect(messages[`${prefix}theDerivationPathAndAddress`]).toContain('account path');
        expect(messages[`${prefix}trezorDisplaysTheAddressAnd`]).toContain('account path');
        const jargon = Object.entries(messages)
            .filter(([key, text]) => key.startsWith(prefix) && typeof text === 'string' && /derivation path/i.test(text))
            .map(([key]) => key);
        expect(jargon).toEqual([]);
    });
});
