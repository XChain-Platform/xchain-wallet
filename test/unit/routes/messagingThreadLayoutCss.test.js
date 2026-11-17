// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/MessagingInbox.module.css', 'utf8');
const jsx = readFileSync('packages/core/src/shared/routes/MessagingInbox.jsx', 'utf8');

function rule(selector) {
    const escaped = selector.replace(/[.>]/g, '\\$&').replace(/\s+/g, '\\s*');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

describe('messaging thread composer layout', () => {
    it('is a flex row with no gap left over for a button', () => {
        const composer = rule('.composer');
        expect(composer).toMatch(/display:\s*flex/);
        expect(composer).toMatch(/flex-direction:\s*row/);
        expect(composer).not.toMatch(/gap:/);
    });

    it('spans the input at 100% width and has no button rule', () => {
        expect(rule('.composer > div')).toMatch(/flex:\s*1 1 0/);
        expect(rule('.composer > div')).toMatch(/width:\s*100%/);
        expect(rule('.composer > div')).toMatch(/min-width:\s*0/);
        expect(rule('.composerInput')).toMatch(/width:\s*100%/);
        expect(rule('.composerInput')).toMatch(/min-width:\s*0/);
        expect(css).not.toMatch(/\.composer > button/);
        expect(rule('.composer')).not.toMatch(/position:\s*absolute/);
    });

    it('has no Send button; Enter submits and phone keyboards show Send', () => {
        const start = jsx.indexOf('function ThreadComposer');
        const end = jsx.indexOf('\n}\n', start);
        const body = jsx.slice(start, end);
        expect(body).not.toMatch(/<Button/);
        expect(body).not.toMatch(/Send message/);
        expect(body).toMatch(/enterKeyHint="send"/);
        expect(body).toMatch(/aria-label="Reply, press Enter to send"/);
        expect(body).toMatch(/<form className=\{local\.composer\} onSubmit=/);
    });
});

describe('messaging thread copy actions', () => {
    it('draws no CopyButton in the thread; copy lives in menus', () => {
        expect(jsx).not.toMatch(/<CopyButton/);
        // The same tools fill the narrow header and the wide detail header.
        expect(jsx).toMatch(/const threadTools = \([\s\S]*?<span className=\{local\.headerActions\}>[\s\S]*?<ThreadMenu\b/);
        expect(jsx).toMatch(/trailing=\{threadTools\}/);
        expect(jsx).toMatch(/onContextMenu/);
    });
});

describe('messaging thread filter', () => {
    it('uses the standard header ListFilterMenu for message search', () => {
        const start = jsx.indexOf('const threadTools = (');
        const end = jsx.indexOf('const threadTitle = (', start);
        const body = jsx.slice(start, end);

        expect(body).toMatch(/<ListFilterMenu\b/);
        expect(body).toMatch(/searchLabel="Search messages"/);
        expect(body).not.toMatch(/<ListFilterPopover\b/);
        expect(body).not.toMatch(/<ListSearchField\b/);
    });
});
