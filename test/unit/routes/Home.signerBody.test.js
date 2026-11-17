// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Signer-mode Home follows the house button and note rules: the mode note is
// an info Notice (the Notice Standard, G120), the main action
// (Sign a Transaction) is green with an icon (U63), and every other button is
// the standard outlined one with its icon, never a custom grey ghost.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/Home.jsx'), 'utf8');
const body = src.slice(src.indexOf('function SignerHomeBody('));
const end = body.indexOf('\n}\n');
const signer = body.slice(0, end);

describe('Signer-mode Home body', () => {
    it('draws its mode note as an info Notice, never a card', () => {
        expect(signer).toMatch(/<Notice tone="info" title=/);
        expect(signer).not.toMatch(/<WarningCard\b/);
        expect(signer).not.toMatch(/cardStyles\.card/);
    });

    // G101 (2026-11-13): the signer's actions are one ActionList, Sign a
    // Transaction first, so the green main button and outlined stack are gone.
    it('puts Sign a Transaction first in the ActionList, with its key icon', () => {
        expect(signer).toMatch(/<ActionList>/);
        const sign = signer.slice(signer.indexOf('<ActionListItem'), signer.indexOf("t('home.signer.signTransaction')"));
        expect(sign).toMatch(/icon=\{<Icon\.KeyIcon \/>\}/);
        expect(signer).not.toMatch(/<Button\b/);
    });

    it('gives every row an icon, a description and the default tone', () => {
        const rows = signer.split('<ActionListItem').slice(1);
        expect(rows).toHaveLength(5);
        for (const row of rows) {
            const open = row.slice(0, row.indexOf('/>\n'));
            expect(open).toMatch(/icon=\{<Icon\.\w+ \/>\}/);
            expect(open).toMatch(/description=\{t\('home\.signer\.\w+Description'\)\}/);
            expect(open).not.toMatch(/tone="danger"/);
        }
    });
});
