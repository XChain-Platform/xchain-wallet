// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keyboard use of the inline forms on a Settings sub-page: a form that
// replaces its opener takes focus on its first field, Escape closes the form
// (not the sub-page behind it) and focus returns to the opener, and a row
// whose button is replaced by another keeps the cursor on the replacement.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { clearPanicModeState } from '../../../packages/core/src/flows/panicMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { PanicModeRow } from '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx';
import { SettingsInlineForm } from '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx';
import { useBackHandler } from '../../../packages/core/src/ui/backStack.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,cXI=') },
}));

afterEach(() => {
    cleanup();
    clearPanicModeState();
    vi.restoreAllMocks();
});

const pressEscape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });

// Focus the opener the way Tab does, then activate it.
function activate(button) {
    act(() => button.focus());
    fireEvent.click(button);
}

function Harness({ onPageClose }) {
    const [open, setOpen] = useState(false);
    // The sub-page's own Back action, registered before any form.
    useBackHandler(onPageClose, false, 'screen');
    return (
        <main>
            {open ? (
                <SettingsInlineForm onCancel={() => setOpen(false)}>
                    <form>
                        <input aria-label="Name" />
                        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                    </form>
                </SettingsInlineForm>
            ) : (
                <button type="button" onClick={() => setOpen(true)}>Edit…</button>
            )}
        </main>
    );
}

describe('SettingsInlineForm keyboard use', () => {
    it('takes focus on its first field, closes on Escape before the page and hands focus back', () => {
        const onPageClose = vi.fn();
        render(<Harness onPageClose={onPageClose} />);
        activate(screen.getByRole('button', { name: 'Edit…' }));
        expect(screen.getByLabelText('Name'), 'focus does not fall to the page body').toHaveFocus();

        pressEscape();
        expect(screen.queryByLabelText('Name')).toBeNull();
        expect(onPageClose, 'Escape closes the form, not the sub-page').not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Edit…' }), 'focus returns to the opener').toHaveFocus();

        pressEscape();
        expect(onPageClose, 'the next Escape closes the sub-page').toHaveBeenCalledTimes(1);
    });
});

describe('Backup forms keyboard use', () => {
    const mount = () => render(
        <MessagingProvider shell="web" messaging={{}}>
            <main>
                <BackupSection activeWallet={{ id: 'wallet-1', name: 'Key Wallet' }} />
            </main>
        </MessagingProvider>,
    );

    it('moves focus into the test-backup form and back to its opener on Escape', () => {
        mount();
        activate(screen.getByRole('button', { name: 'Test…' }));
        expect(screen.getByLabelText('Recovery phrase to test')).toHaveFocus();
        pressEscape();
        expect(screen.getByRole('button', { name: 'Test…' })).toHaveFocus();
    });

    it('returns focus to Show when the reveal prompt closes on Escape', () => {
        mount();
        activate(screen.getByRole('button', { name: 'Show…' }));
        expect(screen.getByLabelText('Wallet password')).toHaveFocus();
        pressEscape();
        expect(screen.getByRole('button', { name: 'Show…' })).toHaveFocus();
    });
});

describe('PanicModeRow keyboard use', () => {
    it('focuses Cancel in the confirmation, returns to Activate on Escape and follows the swap to Deactivate and back', () => {
        render(<main><PanicModeRow /></main>);
        activate(screen.getByRole('button', { name: 'Activate' }));
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

        pressEscape();
        expect(screen.getByRole('button', { name: 'Activate' })).toHaveFocus();

        activate(screen.getByRole('button', { name: 'Activate' }));
        activate(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
        expect(screen.getByRole('button', { name: 'Deactivate' }), 'the cursor follows the swap').toHaveFocus();

        activate(screen.getByRole('button', { name: 'Deactivate' }));
        expect(screen.getByRole('button', { name: 'Activate' })).toHaveFocus();
    });
});
