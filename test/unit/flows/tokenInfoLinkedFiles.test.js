// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { tokenInfoFor } from '../../../packages/core/src/flows/tokenInfo.js';

function fileRow(index) {
    return {
        action_index: index,
        name: `file-${index}.pdf`,
        title: `File ${index}`,
        type: 'application/pdf',
        block_index: 1000 + index,
        gated: 0,
    };
}

async function readFiles(count) {
    const getFiles = vi.fn().mockResolvedValue({ data: Array.from({ length: count }, (_, index) => fileRow(index + 1)) });
    const sdk = {
        getToken: vi.fn().mockResolvedValue({ info: { tick: 'FILES', owner: 'issuer' }, linked_files: [] }),
        getFiles,
        fileRawUrl: (index) => `https://explorer.example/RBTC/api/file/${index}/raw`,
    };
    const info = await tokenInfoFor({
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-regtest',
        tick: 'FILES',
        metadataFetchEnabled: false,
    });
    return { info, getFiles };
}

describe('tokenInfoFor linked FILE content', () => {
    it.each([1, 25])('reads %i linked files with one bulk explorer call', async (count) => {
        const { info, getFiles } = await readFiles(count);

        expect(getFiles).toHaveBeenCalledTimes(1);
        expect(getFiles).toHaveBeenCalledWith('FILES', 'token', { limit: 100 });
        expect(info.linkedFiles).toHaveLength(count);
        expect(info.linkedFiles.at(-1)).toEqual(expect.objectContaining({
            actionIndex: String(count),
            title: `File ${count}`,
            url: `https://explorer.example/RBTC/api/file/${count}/raw`,
        }));
    });
});
