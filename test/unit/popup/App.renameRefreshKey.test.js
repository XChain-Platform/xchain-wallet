// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The popup and side panel count wallet and account record changes made in the
// other surface (recordRevision). The rename screens read the records again on
// each one, so an untouched name field shows the other surface's rename.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'packages/extension/src/popup/App.jsx'), 'utf8');

describe('extension rename screens follow record changes from the other surface', () => {
    it('hands the record revision to the wallet rename form', () => {
        expect(source).toMatch(/<RenameWalletForm[^>]*?refreshKey=\{recordRevision\}/s);
    });

    it('hands the record revision to the account rename form', () => {
        expect(source).toMatch(/<RenameAccountForm[^>]*?refreshKey=\{recordRevision\}/s);
    });
});
