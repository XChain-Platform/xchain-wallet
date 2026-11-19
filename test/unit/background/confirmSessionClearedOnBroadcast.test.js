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

const host = readFileSync('packages/extension/src/background/createBackgroundHost.js', 'utf8');
const safetyStore = readFileSync(
    'packages/extension/src/background/actionSafetySessionStorage.js',
    'utf8',
);

describe('retired confirm-session host surface', () => {
    it('registers no confirm-session routes or broadcast cleanup', () => {
        expect(host).not.toContain('action.confirmSession.');
        expect(host).not.toContain('finishStoredConfirm');
        expect(host).not.toContain('dropConfirmSessionsForPsbt');
    });

    it('keeps reservation and own-spend persistence independent of confirms', () => {
        expect(host).toContain("from './actionSafetySessionStorage.js'");
        expect(host).toContain('reservationStoreFrom(actionSafetyStorage)');
        expect(host).toContain('ownSpendStoreFrom(actionSafetyStorage)');
        expect(safetyStore).toContain("const RESERVATION_KEY = 'xchain.reservationLedger'");
        expect(safetyStore).toContain("const OWN_SPENDS_KEY = 'xchain.ownSpends'");
        expect(safetyStore).not.toContain('confirmSession');
    });
});
