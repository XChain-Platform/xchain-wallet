// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FILES = {
    rawPsbtViewer: 'packages/core/src/shared/components/RawPsbtViewer.jsx',
    broadcastForm: 'packages/core/src/shared/routes/BroadcastForm.jsx',
    psbtSignForm: 'packages/core/src/shared/routes/PsbtSignForm.jsx',
};

const HEX_WORD = /(?<![A-Za-z0-9_])(?:hex|hexadecimal)(?![A-Za-z0-9_])/i;

// Only the strings a person reads: JSX label-like attributes, copy button
// labels, and error text. Identifiers, test ids and comments stay out, since
// names such as psbtHex or signed-psbt-hex are code, not copy.
const EXTRACTORS = [
    /\b(?:label|hint|placeholder|aria-label|copyLabel)="([^"]*)"/g,
    /\bcopyLabel\(\s*'[^']*'\s*,\s*'([^']*)'\s*\)/g,
    /\b(?:setError|new Error)\(\s*'([^']*)'/g,
    /\b(?:setError|new Error)\(\s*`([^`]*)`/g,
    /\breturn\s+'([^']*)'/g,
    /\breturn\s+`([^`]*)`/g,
    /[?:]\s*\n?\s*'([^'\n]*\s[^'\n]*)'/g,
];

export function userFacingStrings(source) {
    const out = [];
    for (const pattern of EXTRACTORS) {
        for (const match of source.matchAll(pattern)) {
            out.push(match[1].replace(/\$\{[^}]*\}/g, ''));
        }
    }
    return out;
}

function expectSource(source, text) {
    expect(source.includes(text), `missing: ${text}`).toBe(true);
}

function read(file) {
    return readFileSync(resolve(ROOT, file), 'utf8');
}

describe('plain-language transaction labels in signing and broadcast screens', () => {
    it('extracts copy text and ignores identifiers and test ids', () => {
        const sample = [
            '<Input label="Copy hex" testId="signed-psbt-hex" />',
            "const psbtHex = HEX_RE.test(x) ? 'a' : 'b';",
            "throw new Error('Only hexadecimal bytes.');",
            'return `This hex at ${PSBT_MAGIC_HEX} fails.`;',
        ].join('\n');
        const strings = userFacingStrings(sample);
        expect(strings.filter((text) => HEX_WORD.test(text)))
            .toEqual(['Copy hex', 'Only hexadecimal bytes.', 'This hex at  fails.']);
    });

    it.each(Object.entries(FILES))('%s shows no hex wording to the user', (_name, file) => {
        const found = userFacingStrings(read(file)).filter((text) => HEX_WORD.test(text));
        expect(found).toEqual([]);
    });

    it('names the transaction data as code', () => {
        expectSource(read(FILES.rawPsbtViewer), "copyLabel('psbt', 'unsigned transaction code')");
        const broadcast = read(FILES.broadcastForm);
        expectSource(broadcast, 'label="Signed transaction code"');
        const sign = read(FILES.psbtSignForm);
        expectSource(sign, 'label="Unsigned transaction code"');
        expectSource(sign, 'aria-label="Unsigned transaction code"');
        expectSource(sign, 'label="Signed PSBT (code)"');
        expectSource(sign, 'label="Signed transaction (code)"');
    });

    it('leaves code identifiers and test ids untouched', () => {
        expectSource(read(FILES.rawPsbtViewer), 'psbtHex');
        const broadcast = read(FILES.broadcastForm);
        expectSource(broadcast, 'HEX_ONLY');
        expectSource(broadcast, 'txHex');
        const sign = read(FILES.psbtSignForm);
        for (const name of ['psbtHex', 'HEX_RE', 'signedPsbtHex', 'testId="signed-psbt-hex"', 'testId="signed-tx-hex"']) {
            expectSource(sign, name);
        }
    });
});
