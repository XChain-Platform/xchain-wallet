// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(process.cwd(), 'packages');
const EXEMPT = new Set([
    'packages/core/src/schemas/constants.js',
    'packages/core/src/schemas/signer.js',
]);
const FORBIDDEN = [
    /===\s*['"]trezor['"]\s*\|\|[^;{}]{0,160}?===\s*['"]ledger['"]/,
    /===\s*['"]ledger['"]\s*\|\|[^;{}]{0,160}?===\s*['"]trezor['"]/,
    /!==\s*['"]trezor['"]\s*&&[^;{}]{0,160}?!==\s*['"]ledger['"]/,
    /!==\s*['"]ledger['"]\s*&&[^;{}]{0,160}?!==\s*['"]trezor['"]/,
    /case\s*['"]trezor['"]\s*:\s*case\s*['"]ledger['"]\s*:/,
    /case\s*['"]ledger['"]\s*:\s*case\s*['"]trezor['"]\s*:/,
    /\[\s*['"]trezor['"]\s*,\s*['"]ledger['"]\s*,?\s*\]/,
    /\[\s*['"]ledger['"]\s*,\s*['"]trezor['"]\s*,?\s*\]/,
];

function sourceFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(path));
        else if (/\.(?:js|jsx)$/.test(entry.name)) out.push(path);
    }
    return out;
}

function forbiddenPattern(source) {
    return FORBIDDEN.find((pattern) => pattern.test(source)) ?? null;
}

describe('device source decisions stay centralized', () => {
    it('scans production sources and rejects hand-written device pairs', () => {
        const files = readdirSync(PACKAGES, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .flatMap((entry) => {
                const src = join(PACKAGES, entry.name, 'src');
                try { return sourceFiles(src); } catch { return []; }
            });
        const violations = files.flatMap((path) => {
            const name = relative(process.cwd(), path);
            if (EXEMPT.has(name)) return [];
            const pattern = forbiddenPattern(readFileSync(path, 'utf8'));
            return pattern ? [`${name}: ${pattern}`] : [];
        });
        expect(files.length).toBeGreaterThan(100);
        expect(violations).toEqual([]);
    });

    it('has a negative control that catches a copied pair', () => {
        expect(forbiddenPattern("value === 'trezor' || value === 'ledger'")).not.toBeNull();
        expect(forbiddenPattern("value !== 'trezor' && value !== 'ledger'")).not.toBeNull();
    });

    it('catches switch fallthrough, line-split pairs and array literals', () => {
        const copies = [
            "switch (s) {\n    case 'trezor':\n    case 'ledger':\n        return true;\n}",
            "switch (s) { case 'ledger': case 'trezor': return 1; }",
            "x === 'trezor' ||\n    x === 'ledger'",
            "x === 'ledger' ||\n    other.value === 'trezor'",
            "x !== 'trezor' &&\n    x !== 'ledger'",
            "x !== 'ledger'\n    && x !== 'trezor'",
            "const HW = [\n    'ledger',\n    'trezor',\n];",
            "['trezor', 'ledger'].includes(x)",
        ];
        for (const copy of copies) expect(forbiddenPattern(copy), copy).not.toBeNull();
    });

    it('leaves vendor-specific branches alone', () => {
        const allowed = [
            "case 'trezor': return { label: 'Trezor' };\ncase 'ledger': return { label: 'Ledger' };",
            "v === 'trezor' ? pairTrezor : pairLedger",
            "if (a === 'trezor') { go(); }\nif (b === 'ledger') { stop(); }",
            "x === 'trezor' || y;\nz === 'ledger'",
        ];
        for (const code of allowed) expect(forbiddenPattern(code), code).toBeNull();
    });
});
