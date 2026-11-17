// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Create Wallet's Extra passphrase section (operator note, then the Notice
// Standard of 2026-11-15): the warning is the shared danger Notice, a light
// red tint with a thin red border and no edge bar, drawn flush (no margin of
// its own), and the warning, the switch row and both fields sit exactly one
// 8px token apart, with no stacked margin on top of the section body's gap.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WarningCard, WarningLine } from '../../../packages/core/src/shared/components/WarningCard.jsx';
import noticeStyles from '../../../packages/core/src/ui/StatusMessage.module.css';

const read = (path) => readFileSync(path, 'utf8');
const rule = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
};
const noticeCss = read('packages/core/src/ui/StatusMessage.module.css');
const sectionCss = read('packages/core/src/shared/components/formStandard/formStandard.module.css');
const source = read('packages/core/src/shared/routes/CreateWallet.jsx');

afterEach(cleanup);

describe('Create Wallet extra passphrase section', () => {
    it('draws the warning as a flush static danger Notice with no edge bar', () => {
        expect(rule(noticeCss, '.row.flush')).toMatch(/margin:\s*0/);
        expect(rule(noticeCss, '.row.warning,\n.row.error')).toMatch(/background:\s*var\(--xc-danger-bg\)/);
        expect(noticeCss).not.toMatch(/border-inline-start:\s*\d+px solid/);
        const block = /<Notice tone="danger" role="note" flush>\s*\{t\('createWallet\.saveThisPassphraseSeparatelyFrom'\)\}/;
        expect(source).toMatch(block);
    });

    it('keeps the older WarningLine critical edge={false} as a flush danger Notice', () => {
        render(
            <WarningCard>
                <WarningLine critical>Spaced.</WarningLine>
                <WarningLine critical edge={false}>Flat.</WarningLine>
            </WarningCard>,
        );
        const spaced = screen.getByText('Spaced.').closest('[data-warning-line]');
        const flat = screen.getByText('Flat.').closest('[data-warning-line]');
        expect(spaced).toHaveAttribute('data-tone', 'danger');
        expect(spaced).not.toHaveClass(noticeStyles.flush);
        expect(flat).toHaveClass(noticeStyles.flush);
        expect(flat).toHaveAttribute('data-warning-line', 'critical');
    });

    it('spaces every item in the section by the single 8px token', () => {
        const body = rule(sectionCss, '.sectionBody');
        expect(body).toMatch(/--xc-form-gap:\s*var\(--xc-space-2\)/);
        expect(body).toMatch(/gap:\s*var\(--xc-form-gap\)/);
        expect(body).toMatch(/padding:\s*var\(--xc-space-2\)/);
        // The section body is a stack with no per-item margin: the warning is
        // a flush notice with no card around it, and the fields carry no
        // wrapper class that could add one.
        const start = source.indexOf('id="extra-passphrase"');
        const end = source.indexOf('</FormSection>', start);
        const section = source.slice(start, end);
        expect(section).not.toMatch(/className=|style=/);
        expect(section).not.toMatch(/<WarningCard>/);
        expect(section).toMatch(/<Notice tone="danger" role="note" flush>/);
    });
});
