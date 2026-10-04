// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { readLedgerAppInfo } from '../../../packages/signers-ledger/src/appInfo.js';

function appInfoResponse(name, version, flags) {
    const ascii = (value) => Array.from(value, (character) => character.charCodeAt(0));
    return Uint8Array.from([
        1,
        name.length,
        ...ascii(name),
        version.length,
        ...ascii(version),
        flags.length,
        ...flags,
    ]);
}

describe('readLedgerAppInfo', () => {
    it('reads the app name, version, and flags from the BOLOS reply', async () => {
        const reply = appInfoResponse('Bitcoin Test', '2.5.0', [0x01, 0x02]);
        const transport = { send: vi.fn().mockResolvedValue(reply) };

        await expect(readLedgerAppInfo(transport)).resolves.toEqual({
            name: 'Bitcoin Test',
            version: '2.5.0',
            flags: Uint8Array.from([0x01, 0x02]),
        });
        expect(transport.send).toHaveBeenCalledOnce();
        expect(transport.send).toHaveBeenCalledWith(0xb0, 0x01, 0x00, 0x00);
    });

    it('rejects a resolved non-success status reply', async () => {
        const reply = Uint8Array.from([0x6a, 0x80]);
        const transport = { send: vi.fn().mockResolvedValue(reply) };

        await expect(readLedgerAppInfo(transport)).rejects.toThrow(
            'readLedgerAppInfo: unsupported response format 106',
        );
        expect(transport.send).toHaveBeenCalledWith(0xb0, 0x01, 0x00, 0x00);
    });

    it('returns the available flag bytes from a truncated reply', async () => {
        const complete = appInfoResponse('Bitcoin', '2.5.0', [0x01, 0x02]);
        const transport = { send: vi.fn().mockResolvedValue(complete.slice(0, -1)) };

        await expect(readLedgerAppInfo(transport)).resolves.toEqual({
            name: 'Bitcoin',
            version: '2.5.0',
            flags: Uint8Array.from([0x01]),
        });
    });
});
