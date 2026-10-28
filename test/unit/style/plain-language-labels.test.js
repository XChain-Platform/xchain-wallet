// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const EN_DIR = resolve(ROOT, 'packages/core/src/i18n/locales/en');

// Protocol terms a non-technical user does not know. Whole-word, case-insensitive.
const JARGON = ['PSBT', 'txid', 'payload', 'hex', 'UTXO', 'nonce', 'scriptPubKey', 'vout', 'RPC', 'opcode', 'calldata', 'ABI', 'Spec'];
const JARGON_PATTERN = new RegExp(`(?<![A-Za-z0-9_])(?:${JARGON.join('|')})(?![A-Za-z0-9_])`, 'i');

function walkStrings(value, path, out) {
    if (typeof value === 'string') out.push([path, value]);
    else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, out));
    else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) walkStrings(item, path ? `${path}.${key}` : key, out);
    }
}

export function jargonIn(messages, file = 'fixture') {
    const strings = [];
    walkStrings(messages, '', strings);
    return strings
        .filter(([, text]) => JARGON_PATTERN.test(text))
        .map(([key, text]) => `${file} ${key}: ${text.match(JARGON_PATTERN)[0]}`);
}

describe('plain-language English labels', () => {
    it('flags whole-word jargon in string values and ignores keys and substrings', () => {
        expect(jargonIn({ 'send.txid': 'Transaction ID', a: 'Copy hex', b: 'Share payload' }))
            .toEqual(['fixture a: hex', 'fixture b: payload']);
        expect(jargonIn({ a: 'Hexagon grid', b: 'Spectrum', c: 'Aborted' })).toEqual([]);
    });

    it('finds no protocol jargon in any English locale string', async () => {
        // index.js only aggregates the namespace modules scanned here.
        const files = readdirSync(EN_DIR).filter((name) => name.endsWith('.js') && name !== 'index.js').sort();
        const found = [];
        for (const name of files) {
            const mod = await import(pathToFileURL(resolve(EN_DIR, name)).href);
            found.push(...jargonIn(mod.default ?? mod, name));
        }
        expect(found).toEqual([]);
    });
});

describe('plain-language transaction and share labels', () => {
    // Each label names the thing a person copies or pastes as a "code" or as
    // "details", never by its encoding or protocol name.
    const EXPECTED = {
        components: {
            'components.watcherResultPanel.unsignedTransactionHex2': 'Unsigned transaction code',
            'components.watcherResultPanel.copyHex': 'Copy code',
            'components.watcherResultPanel.copyUnsignedTransactionHex': 'Copy unsigned transaction code',
            'components.rawPsbtViewer.parserNotWiredYetSee':
                '(parser not wired yet; see the signing request code above for the raw data)',
        },
        multisig: {
            'multisig.share.payload': 'Share details',
            'multisig.share.qrAlt': 'QR code for multisig cosigner share details',
            'multisig.share.copyPayload': 'Copy cosigner share details',
        },
        scan: {
            'scan.pastePlaceholder': 'xchain:… / bitcoin:… / address / transaction code',
            'scan.error.xcwChunk':
                'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
            'scan.error.backupPointer':
                'This is an encrypted-backup code. Open Import wallet, choose Encrypted backup, and scan it there.',
            'scan.error.pairingCode':
                'This is a wallet pairing code. Open Pair a watcher or signer and scan it there.',
        },
    };
    const ENCODING_WORD = /\b(hex|payload|psbt)\b/i;

    it.each(Object.keys(EXPECTED))('%s labels use code and details wording', async (namespace) => {
        const mod = await import(pathToFileURL(resolve(EN_DIR, `${namespace}.js`)).href);
        const messages = mod.default ?? mod;
        for (const [key, text] of Object.entries(EXPECTED[namespace])) {
            expect(messages[key], key).toBe(text);
            expect(messages[key], key).not.toMatch(ENCODING_WORD);
        }
    });

    it('covers the eleven named labels', () => {
        const count = Object.values(EXPECTED).reduce((sum, group) => sum + Object.keys(group).length, 0);
        expect(count).toBe(11);
    });
});
