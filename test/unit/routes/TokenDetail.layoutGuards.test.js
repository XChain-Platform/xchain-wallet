// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Issuer text has no length or word-break limits, and holder rows meet large
// text at 320 px. These rules keep both inside the card and off each other.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'),
    'utf8',
);

/** The declaration block of the first rule whose selector list is exactly `selector`. */
function block(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!match) throw new Error(`no rule for ${selector}`);
    return match[1];
}

describe('TokenDetail layout guards', () => {
    it('keeps metadata tables to the card width and wraps any unbroken text', () => {
        expect(block('.metaTable')).toMatch(/table-layout:\s*fixed/);
        expect(block('.metaRow td')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(block('.metaRow th')).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('aligns detail rows and metadata cells to the card padding edge', () => {
        expect(block('.detailRow')).toMatch(/padding-inline:\s*0/);
        expect(block('.metaRow th,\n.metaRow td')).toMatch(/padding-inline:\s*0/);
    });

    it('contains the PGP signature overflow inside its own box', () => {
        const pgp = block('.pgpsigBlock');
        expect(pgp).toMatch(/min-width:\s*0/);
        expect(pgp).toMatch(/max-width:\s*100%/);
        expect(pgp).toMatch(/box-sizing:\s*border-box/);
        expect(pgp).toMatch(/overflow-x:\s*auto/);
    });

    it('lets a link chip with a long host wrap inside the content width', () => {
        const chip = block('.socialChip');
        expect(chip).toMatch(/max-width:\s*100%/);
        expect(chip).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('drops a holder balance under its address instead of overlapping it', () => {
        expect(block('.holdersRow')).toMatch(/flex-wrap:\s*wrap/);
        expect(block('.holdersTrailing')).toMatch(/max-width:\s*none/);
    });
});
