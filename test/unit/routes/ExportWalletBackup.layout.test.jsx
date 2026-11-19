// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Export Backup layout: no card wrapper around the form on narrow widths, the
// explanation notice first, then the two password fields and the Export
// button. On wide widths the form's own card is capped by the shared form card
// width token and centred, never full width.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ExportWalletBackup } from '../../../packages/core/src/shared/routes/ExportWalletBackup.jsx';

afterEach(() => cleanup());

const read = (rel) => readFileSync(rel, 'utf8');

function mount() {
    return render(
        <MessagingProvider shell="web" messaging={{ exportBackupFile: async () => ({}) }}>
            <ExportWalletBackup walletId="w1" walletName="Savings" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('<ExportWalletBackup> layout', () => {
    it('puts the explanation notice first, then the two password fields, then the Export button', () => {
        mount();
        const note = screen.getByTestId('export-backup-note');
        expect(note.textContent).toContain('encrypted with this backup password');
        const pw = screen.getByLabelText('Backup password');
        const confirm = screen.getByLabelText('Confirm backup password');
        const button = screen.getByRole('button', { name: 'Export Backup' });
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(note, pw)).toBe(true);
        expect(follows(pw, confirm)).toBe(true);
        expect(follows(confirm, button)).toBe(true);
        // The notice is the shared info tone and lives in the form with the fields.
        expect(note.getAttribute('data-variant')).toBe('info');
        expect(note.closest('form')).toBe(pw.closest('form'));
    });

    it('draws no card wrapper of its own around the form', () => {
        const { container } = mount();
        const field = screen.getByLabelText('Backup password');
        for (let el = field.parentElement; el && el !== container; el = el.parentElement) {
            // FormPage's cardless classes say there is no card; a card or Settings surface fails.
            expect(el.className || '').not.toMatch(/card(?!less)|settingsSurface/i);
        }
        expect(container.querySelector('[data-settings-section="wallet-backup"]').style.display).toBe('contents');
    });

    it('takes its width from the shared form card token and centres it on wide screens', () => {
        const css = read('packages/core/src/ui/FormPage.module.css');
        const wide = css.match(/@media \(min-width: 600px\)\s*\{([\s\S]*?)\n\}\n/)[1];
        const form = wide.match(/\n    \.form\s*\{([^}]*)\}/)[1];
        expect(form).toMatch(/max-width:\s*var\(--xc-form-card-max-width\)/);
        expect(form).toMatch(/margin:\s*0 auto/);
        expect(read('packages/core/src/ui/tokens.css')).toMatch(/--xc-form-card-max-width:\s*560px/);
        // Below 600px the base form has no card paint at all.
        const base = css.match(/\n\.form\s*\{([^}]*)\}/)[1];
        expect(base).not.toMatch(/background|box-shadow|border:/);
        // The page route adds no card and no width of its own.
        const route = read('packages/core/src/shared/routes/ExportWalletBackup.jsx');
        expect(route).not.toMatch(/settingsSurface/);
        expect(route).not.toMatch(/max-width|maxWidth/);
    });
});

// The other Wallet Details pages take the same form width: Show recovery phrase
// and Rename sit on FormPage (FormFrame) directly, and the Remove page's own
// form class must not override FormPage's centring or width.
describe('Wallet Details own pages share the form width pattern', () => {
    it('Remove wallet class sets no width or margin that would defeat the centred form column', () => {
        const css = read('packages/core/src/shared/components/settings/ThisWalletSection.module.css');
        const rule = css.match(/\.removeDirect\s*\{([^}]*)\}/)[1];
        expect(rule).not.toMatch(/(^|[\s;])(width|margin|max-width)\s*:/);
    });

    it('Remove wallet draws the centred card at the form token width on wide screens, not a cardless column', () => {
        const src = read('packages/core/src/shared/components/settings/ThisWalletSection.jsx');
        const remove = src.slice(src.indexOf('function RemoveConfirm'));
        const page = remove.match(/<FormPage[^>]*>/)[0];
        expect(page).toMatch(/removeDirect/);
        expect(page).not.toMatch(/cardless|fullWidth/);
        const css = read('packages/core/src/ui/FormPage.module.css');
        const wide = css.match(/@media \(min-width: 600px\)\s*\{([\s\S]*?)\n\}\n/)[1];
        const form = wide.match(/\n    \.form\s*\{([^}]*)\}/)[1];
        expect(form).toMatch(/max-width:\s*var\(--xc-form-card-max-width\)/);
        expect(form).toMatch(/margin:\s*0 auto/);
        expect(form).toMatch(/background:\s*var\(--xc-card-bg\)/);
    });

    it('Show recovery phrase and Rename use the shared form components, with no Settings surface', () => {
        const phrase = read('packages/core/src/shared/routes/ViewRecoveryPhrase.jsx');
        const rename = read('packages/core/src/shared/routes/RenameWalletForm.jsx');
        expect(phrase).toMatch(/<FormPage/);
        expect(rename).toMatch(/<FormFrame/);
        expect(phrase + rename).not.toMatch(/settingsSurface|max-width|maxWidth/);
    });
});
