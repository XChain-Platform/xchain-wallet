// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setting or removing the duress passphrase while storage refuses the write
// leaves no half state. The row never reads Configured for a passphrase a
// restart drops, and never reads Not configured for one a restart brings
// back. A restart is modelled by forgetting the module's in-memory state and
// reading storage again.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const messaging = vi.hoisted(() => ({ unlockWallet: vi.fn() }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging }),
}));

const duress = await import('../../../packages/core/src/flows/duressPassphrase.js');
const { DuressPassphraseRow } = await import(
    '../../../packages/core/src/shared/components/settings/DuressPassphraseRow.jsx'
);

const PHRASE = 'fixture duress phrase';

function refuse(method) {
    return vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
    });
}

function restart() {
    duress.__resetDuressPersistenceForTests();
}

function setThroughRow() {
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: 'fixture wallet pw' } });
    fireEvent.change(screen.getByLabelText('Duress passphrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Confirm duress passphrase'), { target: { value: PHRASE } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

beforeEach(() => {
    localStorage.clear();
    restart();
    messaging.unlockWallet.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    restart();
});

describe('duress passphrase under storage refusal', () => {
    it('says a refused save is not kept, and Try again keeps it', async () => {
        const setItem = refuse('setItem');
        render(<DuressPassphraseRow />);
        setThroughRow();

        expect(await screen.findByText(/did not save the duress passphrase/)).toBeTruthy();
        expect(duress.isDuressMatch(PHRASE)).toBe(true);
        expect(duress.getDuressSaveStatus()).toBe('unsaved');

        setItem.mockRestore();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(screen.queryByText(/did not save the duress passphrase/)).toBeNull();
        expect(screen.getByText(/Configured\. Entering this passphrase/)).toBeTruthy();

        restart();
        expect(duress.isDuressMatch(PHRASE)).toBe(true);
    });

    it('keeps a passphrase whose removal storage refuses armed, on screen and in storage', () => {
        duress.setDuressPassphrase(PHRASE);
        render(<DuressPassphraseRow />);
        const removeItem = refuse('removeItem');

        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));

        // This session and the next one answer the same way.
        expect(duress.isDuressMatch(PHRASE)).toBe(true);
        expect(screen.getByText(/did not remove the duress passphrase/)).toBeTruthy();
        expect(screen.getByText(/Configured\. Entering this passphrase/)).toBeTruthy();
        expect(localStorage.getItem(duress.DURESS_STORAGE_KEY)).not.toBeNull();

        removeItem.mockRestore();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(duress.isDuressConfigured()).toBe(false);
        expect(screen.getByRole('button', { name: 'Set' })).toBeTruthy();
        restart();
        expect(duress.isDuressMatch(PHRASE)).toBe(false);
    });

    it('a saved passphrase shows no notice', async () => {
        render(<DuressPassphraseRow />);
        setThroughRow();
        expect(await screen.findByText(/Configured\. Entering this passphrase/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect(duress.getDuressSaveStatus()).toBe('saved');
    });
});
