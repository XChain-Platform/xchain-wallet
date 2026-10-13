// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
    decodeBackupEnvelope,
    parseBackupEnvelope,
} from '../../../packages/core/src/crypto/backup.js';
import { validateSettings } from '../../../packages/core/src/schemas/settings.js';
import { PRE_SPEC_BACKUP_PASSWORD } from './make-pre-spec-passphrase-backup.mjs';

const ENVELOPE_URL = new URL('./pre-spec-passphrase-backup.json', import.meta.url);

async function readPayload() {
    const fileContent = await readFile(ENVELOPE_URL, 'utf8');
    return decodeBackupEnvelope({
        password: PRE_SPEC_BACKUP_PASSWORD,
        envelope: parseBackupEnvelope(fileContent),
    });
}

describe('pre-spec passphrase backup fixture', () => {
    it('keeps only the wallet record legacy while settings use the current contract', async () => {
        const payload = await readPayload();

        expect(payload.wallet.schemaVersion).toBe(2);
        expect(payload.wallet).not.toHaveProperty('encryptedPassphrase');

        expect(validateSettings(payload.settings)).toEqual({ ok: true, errors: [] });
        expect(payload.settings).toMatchObject({
            activeNetwork: 'mainnet',
            fees: { 'bitcoin-mainnet': {} },
            watchedTokens: [],
            pinnedTokens: [],
            pinnedTokensByWallet: {},
            notifications: { incomingPending: true },
        });
    });
});
