// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A chain-gated action nested in a BATCH COMMAND is refused off Bitcoin the
// same way advancedAction refuses it at the top level.

import { describe, it, expect, vi } from 'vitest';
import { buildBatchCommand } from '../../../packages/core/src/flows/batchCommand.js';

function sdkFor(command) {
    const builder = { add: vi.fn(() => builder), build: vi.fn(async () => ({ actionString: `BATCH|0|${command}` })) };
    return { batch: vi.fn(() => builder) };
}

const sdkRegistry = (command) => ({ get: () => sdkFor(command) });
const chainRegistry = { get: (id) => ({ coin: id.split('-')[0] }) };

async function build(command, chainId, withRegistry = true) {
    return buildBatchCommand({
        sdkRegistry: sdkRegistry(command),
        ...(withRegistry && { chainRegistry }),
        chainId,
        subActions: [{ action: 'SEND', params: {} }],
    });
}

describe('buildBatchCommand chain gate for nested actions', () => {
    const REFUSED_OFF_BITCOIN = [
        ['COLLECT', 'COLLECT|0|x'],
        ['STAKE v1', 'STAKE|1|x'],
        ['STAKE v2', 'STAKE|2|x'],
        ['UNSTAKE v0', 'UNSTAKE|0|x'],
        ['DELEGATE v0', 'DELEGATE|0|x'],
        ['DELEGATE v2', 'DELEGATE|2|x'],
        ['XBRIDGE v0', 'XBRIDGE|0|x'],
    ];

    for (const [label, sub] of REFUSED_OFF_BITCOIN) {
        it(`refuses nested ${label} on a non-Bitcoin chain`, async () => {
            await expect(build(`SEND|0|a|1|;${sub}`, 'litecoin-mainnet'))
                .rejects.toThrow(/accepted on Bitcoin only, not on litecoin-mainnet/);
        });

        it(`accepts nested ${label} on Bitcoin`, async () => {
            const out = await build(`SEND|0|a|1|;${sub}`, 'bitcoin-mainnet');
            expect(out.subStrings).toHaveLength(2);
        });
    }

    it('refuses nested XBRIDGE v1 on Bitcoin', async () => {
        await expect(build('XBRIDGE|1|x', 'bitcoin-mainnet')).rejects.toThrow(/not accepted on Bitcoin/);
    });

    it('accepts nested XBRIDGE v1 off Bitcoin', async () => {
        const out = await build('XBRIDGE|1|x', 'litecoin-mainnet');
        expect(out.command).toBe('XBRIDGE|1|x');
    });

    it('refuses a gated action whose version is unreadable', async () => {
        await expect(build('STAKE||x', 'bitcoin-mainnet')).rejects.toThrow(/version is unreadable/);
    });

    it('leaves ungated actions alone on any chain', async () => {
        const out = await build('SEND|0|a|1|;MINT|1|P|5|', 'litecoin-mainnet');
        expect(out.subStrings).toHaveLength(2);
    });

    it('skips the gate when no chain registry is supplied', async () => {
        const out = await build('COLLECT|0|x', 'litecoin-mainnet', false);
        expect(out.command).toBe('COLLECT|0|x');
    });
});
