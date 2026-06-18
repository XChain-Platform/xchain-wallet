// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the fileAction flow's input gate. Every rejection
// fires BEFORE the vault/signer path, so these run without mocks;
// the validation contract is what the AttachContentForm relies on to
// fail early instead of mid-sign.

import { describe, it, expect } from 'vitest';
import { fileAction } from '../../../packages/core/src/flows/fileAction.js';

const VALID = {
    name: 'art.png',
    type: 'image/png',
    rawData: '\x89PNG fake bytes',
};

describe('fileAction input validation', () => {
    it('rejects missing opts', async () => {
        await expect(fileAction()).rejects.toThrow(/opts is required/);
    });

    it('rejects a missing or empty name', async () => {
        await expect(fileAction({ ...VALID, name: undefined })).rejects.toThrow(/name is required/);
        await expect(fileAction({ ...VALID, name: '' })).rejects.toThrow(/name is required/);
    });

    it('rejects a missing MIME type', async () => {
        await expect(fileAction({ ...VALID, type: undefined })).rejects.toThrow(/type \(MIME\) is required/);
    });

    it('rejects missing or empty rawData', async () => {
        await expect(fileAction({ ...VALID, rawData: undefined })).rejects.toThrow(/rawData/);
        await expect(fileAction({ ...VALID, rawData: '' })).rejects.toThrow(/rawData/);
    });

    it('rejects | and ; in serialized text fields', async () => {
        await expect(fileAction({ ...VALID, name: 'a|b.png' })).rejects.toThrow(/cannot contain/);
        await expect(fileAction({ ...VALID, title: 'nice;title' })).rejects.toThrow(/cannot contain/);
        await expect(fileAction({ ...VALID, memo: 'm|m' })).rejects.toThrow(/cannot contain/);
    });

    it('rejects a missing source address', async () => {
        // Passes the field gate, then normalizeSource throws on `from`.
        await expect(fileAction({ ...VALID })).rejects.toThrow(/from/);
    });
});
