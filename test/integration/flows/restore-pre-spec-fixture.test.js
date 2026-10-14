// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The checked-in pre-spec envelope is the one backup in the tree that an OLD
// build wrote. Its own test only decodes it; this one restores it through
// importBackupFile, so a stricter restore pass that refuses an older backup
// fails here rather than on a user's device.

import { readFile } from 'node:fs/promises';

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

import { importBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import {
    PRE_SPEC_BACKUP_PASSWORD,
    PRE_SPEC_WALLET_PASSWORD,
} from '../../e2e/fixtures/make-pre-spec-passphrase-backup.mjs';

const ENVELOPE_URL = new URL('../../e2e/fixtures/pre-spec-passphrase-backup.json', import.meta.url);
const DEVICE_PASSWORD = 'restoring-device-password';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        delete: async (id) => { m.delete(id); },
    };
}

function memSettings() {
    let v = null;
    return {
        get: async () => (v ? structuredClone(v) : null),
        put: async (next) => { v = structuredClone(next); },
    };
}

function makeVault() {
    return {
        wallets: memCollection(),
        accounts: memCollection(),
        addresses: memCollection(),
        contacts: memCollection(),
        connectedSites: memCollection(),
        pendingTxs: memCollection(),
        settings: memSettings(),
    };
}

describe('integration/flows/restore-pre-spec-fixture', () => {
    for (const mode of ['fresh', 'add']) {
        it(`restores the envelope an older build wrote (${mode} mode)`, async () => {
            const fileContent = await readFile(ENVELOPE_URL, 'utf8');
            const vault = makeVault();

            const result = await importBackupFile({
                vault,
                fileContent,
                password: PRE_SPEC_BACKUP_PASSWORD,
                walletPassword: PRE_SPEC_WALLET_PASSWORD,
                devicePassword: DEVICE_PASSWORD,
                mode,
            });

            expect(result.writes.wallets).toBe(1);
            expect(result.writes.accounts).toBeGreaterThan(0);
            expect(result.writes.addresses).toBeGreaterThan(0);
            expect(result.rekeyed).toBe(true);
            const [wallet] = await vault.wallets.list();
            expect(wallet.id).toBe(result.walletId);
            const accounts = await vault.accounts.list();
            expect(accounts.every((a) => a.walletId === result.walletId)).toBe(true);
            const accountIds = new Set(accounts.map((a) => a.id));
            const addresses = await vault.addresses.list();
            expect(addresses.every((a) => accountIds.has(a.accountId))).toBe(true);
        });
    }
});
