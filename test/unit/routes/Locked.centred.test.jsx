// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The unlock form was centred across the width but pinned to the top of the
// screen, so a tablet or desktop showed a small card under a large empty
// area and a phone showed the form in its top third. The screen body now
// centres it in the height too, without cutting off a form taller than the
// screen and without moving it while the on-screen keyboard is open.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { clearLockoutState } from '../../../packages/core/src/flows/index.js';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Locked.module.css'),
    'utf8',
);

afterEach(() => {
    cleanup();
    clearLockoutState();
});

describe('Locked screen centring', () => {
    it('wraps the unlock form in a full-height column that centres it with auto margins', () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: { unlockWallet: vi.fn() } },
            React.createElement(Locked, { onUnlocked: vi.fn() }),
        ));
        const form = screen.getByRole('form', { name: 'Unlock wallet' });
        // The form template's page column (its notice slot, then the form) is
        // the one child the centre column centres.
        const column = form.parentElement;
        expect(column.parentElement.className).toMatch(/centre/);
        expect(column.parentElement.children).toHaveLength(1);

        expect(css).toMatch(/\.centre\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100%;/);
        // Auto margins, not justify-content: center, which would push the top
        // of a taller form out of reach of the scroller.
        expect(css).toMatch(/\.centre > \*\s*\{\s*margin-block: auto;\s*\}/);
        expect(css).not.toMatch(/\.centre\s*\{[^}]*justify-content:\s*center/);
    });

    it('keeps the form at the top while the keyboard is open', () => {
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.centre > \*\s*\{\s*margin-block: 0;\s*\}/,
        );
    });
});
