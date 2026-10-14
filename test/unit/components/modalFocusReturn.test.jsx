// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Closing a ConfirmModal or NoticeModal hands focus back to the control that
// opened it. Browsers refuse focus inside an inert subtree, and both modals
// once inerted the background twice (the focus trap and a second hook), so
// the trap's restore ran while the second lock still held and focus fell to
// the page body. jsdom ignores inert, so this test refuses focus the way a
// browser does.

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';

const nativeFocus = HTMLElement.prototype.focus;

beforeEach(() => {
    HTMLElement.prototype.focus = function focusUnlessInert(...args) {
        if (this.closest('[inert]')) return;
        nativeFocus.apply(this, args);
    };
});

afterEach(() => {
    HTMLElement.prototype.focus = nativeFocus;
    cleanup();
    document.body.style.overflow = '';
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

function Opener({ kind }) {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            {open && kind === 'confirm' ? (
                <ConfirmModal title="Reset?" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
            ) : null}
            {open && kind === 'notice' ? <NoticeModal title="Done" onClose={() => setOpen(false)} /> : null}
        </div>
    );
}

describe('modal focus return', () => {
    it.each([
        ['confirm', 'Cancel'],
        ['notice', 'OK'],
    ])('%s modal returns focus to its opener when dismissed', async (kind, dismiss) => {
        render(<Opener kind={kind} />);
        const opener = screen.getByRole('button', { name: 'Open' });
        opener.focus();
        fireEvent.click(opener);
        await flush();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: dismiss }));
        await flush();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.querySelector('[inert]')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });
});
