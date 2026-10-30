// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every screen where the user types or sees a password, passphrase,
// recovery phrase or private key holds the mobile screen guard (FLAG_SECURE
// on Android) while that field is on screen.
//
// Password and passphrase fields get it from the shared Input, which holds
// the guard for each `type="password"` field it renders. That covers the
// Backup export password step and every sign step (SignCredentials, which
// the Publish form and the other signing forms share) without a per-screen
// call that a new form can forget. The scan below keeps every password
// field on that Input, and every phrase or key text field (which has no
// password type) in a file that calls the guard itself.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { MnemonicGrid } from '../../../packages/core/src/shared/components/MnemonicGrid.jsx';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    __resetScreenGuardForTests,
    installScreenGuard,
} from '../../../packages/core/src/shared/utils/screenGuard.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { t } from '../../../packages/core/src/i18n/index.js';

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    __resetScreenGuardForTests();
});

describe('password fields hold the screen guard', () => {
    it('protects while a password Input is mounted, through a reveal, and releases on unmount', () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        const { unmount } = render(<Input type="password" revealable label="Wallet password" />);
        expect(guard).toHaveBeenLastCalledWith(true);

        fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
        expect(screen.getByLabelText('Wallet password')).toHaveAttribute('type', 'text');
        expect(guard).not.toHaveBeenCalledWith(false);

        unmount();
        expect(guard).toHaveBeenLastCalledWith(false);
    });

    it('leaves the screen alone for an ordinary text field', () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        render(<Input type="text" label="Memo" />);
        expect(guard).not.toHaveBeenCalled();
    });

    it('protects the sign step password that the Publish form and the other signing forms share', () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        render(
            <SignCredentials
                unlocked={false}
                fromAddress={{ address: 'bc1qexample', source: 'hd' }}
                chainId="bitcoin-mainnet"
                password=""
                onPasswordChange={() => {}}
            />,
        );
        expect(document.querySelector('input[type="password"]')).not.toBeNull();
        expect(guard).toHaveBeenLastCalledWith(true);
    });

    it('protects the Backup export password step while it is open', () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        render(
            <MessagingProvider shell="popup" messaging={{}}>
                <BackupSection activeWallet={{ id: 'w1', name: 'Cold' }} />
            </MessagingProvider>,
        );
        expect(guard).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: t('history.export.open') }));
        expect(screen.getByLabelText(t('settings.backup.confirmBackupPassword'))).toBeInTheDocument();
        expect(guard).toHaveBeenLastCalledWith(true);

        fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }));
        expect(screen.queryByLabelText(t('settings.backup.confirmBackupPassword'))).not.toBeInTheDocument();
        expect(guard).toHaveBeenLastCalledWith(false);
    });

    it('protects a recovery phrase grid wherever it is shown', () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        const { unmount } = render(<MnemonicGrid mnemonic="abandon ability able about above absent" />);
        expect(guard).toHaveBeenLastCalledWith(true);
        unmount();
        expect(guard).toHaveBeenLastCalledWith(false);
    });
});

// --- source scan ------------------------------------------------------------

const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['packages/core/src', 'packages/desktop/renderer', 'packages/extension/src', 'packages/web/src'];
// Words in a field's label, id, name or bound value that mark it as holding
// key material even though it is not a password field.
const SECRET_TEXT = /(recovery phrase|mnemonic|private key|seed phrase|\bwif\b|passphrase)/i;
const SECRET_NAME = /(mnemonic|phrase|seed|wif|privkey|privateKey)/i;

function jsxFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === 'style-guide') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...jsxFiles(full));
        else if (name.endsWith('.jsx') && !name.includes('.test.')) out.push(full);
    }
    return out;
}

/** The attribute text of the JSX tag that opens at `start`, braces and strings skipped. */
function tagAttributes(src, start) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === '\\') i += 1;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return src.slice(start, i);
    }
    return src.slice(start);
}

function scanFields() {
    const fields = [];
    for (const root of ROOTS) {
        for (const file of jsxFiles(join(REPO, root))) {
            const src = readFileSync(file, 'utf8');
            const guarded = /useProtectedScreen\(/.test(src);
            const opener = /<(Input|Textarea|textarea|input)\b/g;
            let m;
            while ((m = opener.exec(src))) {
                const attrs = tagAttributes(src, m.index + m[0].length);
                const english = attrs.replace(/\bt\('([^']+)'[^)]*\)/g, (_, key) => ` ${t(key)} `);
                const labels = [...english.matchAll(/(?:\blabel|aria-label|placeholder)=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|'[^']*')/g)]
                    .map((x) => x[1]).join(' ');
                const names = [...attrs.matchAll(/\b(?:id|name)="([^"]*)"|\bvalue=\{([A-Za-z_.]+)\}/g)]
                    .map((x) => x[1] || x[2]).join(' ');
                fields.push({
                    file: relative(REPO, file),
                    tag: m[1],
                    password: /\btype=(?:"password"|\{[^}]*'password')/.test(attrs),
                    secret: SECRET_TEXT.test(labels) || SECRET_NAME.test(names),
                    guarded,
                });
            }
        }
    }
    return fields;
}

describe('secret field source scan', () => {
    const fields = scanFields();

    it('finds the fields it is meant to police', () => {
        expect(fields.filter((f) => f.password).length).toBeGreaterThan(20);
        expect(fields.some((f) => f.secret && f.file.endsWith('ImportWallet.jsx'))).toBe(true);
    });

    it('renders every password field through the shared Input, which holds the guard', () => {
        const raw = fields.filter((f) => f.password && f.tag !== 'Input').map((f) => `${f.file} <${f.tag}>`);
        expect(raw).toEqual([]);
    });

    it('guards every screen with a recovery phrase or private key text field', () => {
        const open = fields.filter((f) => f.secret && !f.password && !f.guarded).map((f) => `${f.file} <${f.tag}>`);
        expect(open).toEqual([]);
    });
});
