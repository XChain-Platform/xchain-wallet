// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Password fields in the lock and safety flows carry their show and hide
// button inside the field. Only the Locked screen had one, built from its own
// CSS, so every Settings password field (change password, backup export,
// recovery phrase reveal, duress passphrase) had no way to check what was
// typed. The button now lives in the shared Input behind `revealable`.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../../../packages/core/src/ui/Input.jsx';

afterEach(cleanup);

const SETTINGS = 'packages/core/src/shared/components/settings';

describe('<Input revealable>', () => {
    it('puts a named show and hide button inside the field that switches the input type', () => {
        render(<Input type="password" revealable label="Current wallet password" defaultValue="secret-1" />);
        const field = screen.getByLabelText('Current wallet password');
        const show = screen.getByRole('button', { name: 'Show password' });

        expect(field).toHaveAttribute('type', 'password');
        expect(show.parentElement).toBe(field.parentElement);
        expect(show).toHaveAttribute('aria-controls', field.id);
        expect(show).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(show);
        expect(field).toHaveAttribute('type', 'text');
        expect(field).toHaveValue('secret-1');
        const hide = screen.getByRole('button', { name: 'Hide password' });
        expect(hide).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(hide);
        expect(field).toHaveAttribute('type', 'password');
    });

    it('names the button without the field label, so a label lookup finds only the field', () => {
        render(
            <>
                <Input type="password" revealable label="Current wallet password" />
                <Input type="password" revealable aria-label="BIP39 passphrase" />
            </>,
        );
        expect(screen.getAllByLabelText(/current wallet password/i)).toHaveLength(1);
        expect(screen.getAllByLabelText(/BIP39 passphrase/i)).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Show passphrase' }))
            .toHaveAttribute('aria-controls', screen.getByLabelText('BIP39 passphrase').id);
    });

    it('keeps the input first in its hit area so a tap beside it still focuses the field', () => {
        render(<Input type="password" revealable aria-label="Wallet password" />);
        const field = screen.getByLabelText('Wallet password');
        expect(field.parentElement.firstElementChild).toBe(field);
    });

    it('keeps the Caps Lock warning while the password is shown', () => {
        render(<Input type="password" revealable label="Password" />);
        const field = screen.getByLabelText('Password');
        fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
        fireEvent.focus(field);
        fireEvent.keyDown(field, { key: 'A', modifierCapsLock: true });
        expect(screen.getByRole('status')).toHaveTextContent('Caps Lock is on');
    });

    it('adds nothing to a plain password field or to a text field', () => {
        render(
            <>
                <Input type="password" aria-label="Plain" />
                <Input type="text" revealable aria-label="Text" />
            </>,
        );
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('reserves room for the button so typed text never runs under it', () => {
        const css = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
        expect(css).toMatch(/\.controlHitArea > \.revealableInput\s*\{\s*padding-inline-end:/);
        expect(css).toMatch(/\.revealToggle\s*\{[^}]*position: absolute;[^}]*top: 50%;/);
    });

    it.each([
        ['ThisWalletSection.jsx', 4],
        ['BackupSection.jsx', 6],
        ['DuressPassphraseRow.jsx', 3],
        ['BiometricRow.jsx', 1],
        ['../../routes/Locked.jsx', 2],
    ])('marks every password field in %s revealable', (file, count) => {
        const source = readFileSync(`${SETTINGS}/${file}`, 'utf8');
        const fields = source.split(/<Input\b/).slice(1)
            .map((tail) => tail.slice(0, tail.indexOf('/>')))
            .filter((props) => props.includes('type="password"'));
        expect(fields).toHaveLength(count);
        for (const field of fields) expect(field).toMatch(/\brevealable\b/);
    });
});
