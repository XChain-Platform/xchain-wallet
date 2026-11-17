// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Choosing a backup file on Import Wallet's Backup tab, for screen tests.
//
// The tab reads a chosen file's plaintext header the moment it is picked, so a
// stub that only names the magic is refused before any password is typed. The
// envelope here has the full header shape (its ciphertext is not a real one,
// so a test that lets it reach core gets a wrong-password refusal, which is
// what the screen tests stub anyway).

import { fireEvent, screen, waitFor } from '@testing-library/react';

/**
 * @param {{ walletName?: string, createdAt?: string }} [header]
 * @returns {string} a backup file's contents with a well-formed header
 */
export function backupEnvelopeText({ walletName = 'Daily Driver', createdAt = '2026-11-12T10:00:00.000Z' } = {}) {
    return JSON.stringify({
        magic: 'XCHAIN-WALLET-BACKUP',
        formatVersion: 1,
        createdAt,
        walletName,
        encryption: {
            algorithm: 'aes-256-gcm',
            kdf: {
                algorithm: 'argon2id',
                salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
                iterations: 2,
                memory: 8192,
                parallelism: 1,
            },
            iv: 'AAAAAAAAAAAAAAAA',
            tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
        },
        payload: 'AAAA',
    });
}

/** Opens the Backup tab of a rendered ImportWallet. */
export function openBackupTab() {
    fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
}

/**
 * Picks a file through the tab's hidden file input, the way the Choose File
 * button's dialog hands one over, and waits for the summary card to show it.
 *
 * @param {{ content?: string, name?: string, walletName?: string }} [file]
 * @returns {Promise<File>}
 */
export async function chooseBackupFile({
    content,
    name = 'daily-driver.xchain-wallet',
    walletName = 'Daily Driver',
} = {}) {
    const text = content ?? backupEnvelopeText({ walletName });
    const file = new File([text], name, { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
    // Wait for THIS file's card: a card for an earlier file may already show.
    await waitFor(() => {
        const card = screen.getByRole('region', { name: 'Chosen backup file' });
        if (!card.textContent.includes(name)) throw new Error(`the card does not show ${name} yet`);
    });
    return file;
}

/**
 * Picks a file the tab should refuse, and waits for its refusal.
 *
 * @param {string} content
 * @param {string} [name]
 * @returns {Promise<HTMLElement>} the refusal's alert
 */
export async function chooseRefusedBackupFile(content, name = 'notes.txt') {
    const file = new File([content], name, { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
    // The file is read asynchronously, so wait for the area's own refusal
    // rather than whichever alert was already on the page.
    return waitFor(() => {
        const alert = document.querySelector('[data-file-field="area"] [role="alert"]');
        if (!alert) throw new Error('the drop area shows no refusal yet');
        return alert;
    });
}

/** Types into a labelled field. */
export function typeInto(label, value) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
