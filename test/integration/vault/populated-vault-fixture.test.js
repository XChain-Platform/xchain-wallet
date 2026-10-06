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
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const fixture = JSON.parse(
    readFileSync(resolve('test/fixtures/vault/populated-vault.json'), 'utf8'),
);

describe('integration/vault/populated fixture', () => {
    it('opens the committed vault and reads its populated records', async () => {
        const masterKey = new Uint8Array(32).fill(fixture.masterKeyFill);
        const blob = Uint8Array.from(Buffer.from(fixture.blob, 'base64'));
        const vault = new Vault({
            backend: new InMemoryBackend(blob),
            masterKey,
        });

        await vault.open();

        expect(await vault.wallets.get(fixture.walletId)).toMatchObject({
            id: fixture.walletId,
            origin: 'imported-mnemonic',
        });
        expect(await vault.pendingTxs.get(fixture.pendingTxId)).toMatchObject({
            id: fixture.pendingTxId,
        });
        expect(await vault.settings.get()).toMatchObject({
            theme: 'dark',
            fiatCurrency: 'EUR',
            autolockMinutes: 30,
        });

        vault.close();
    });
});
