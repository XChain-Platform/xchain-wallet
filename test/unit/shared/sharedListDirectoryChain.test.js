// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Shared lists screen reads the directory of the selected network.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sharedListDirectoryChainId } from '../../../packages/core/src/shared/chainSelection.js';

describe('sharedListDirectoryChainId', () => {
    it('opens on the selected network when no list has been opened', () => {
        expect(sharedListDirectoryChainId(null, 'testnet')).toBe('bitcoin-testnet');
        expect(sharedListDirectoryChainId(null, 'mainnet')).toBe('bitcoin-mainnet');
        expect(sharedListDirectoryChainId(null, undefined)).toBe('bitcoin-mainnet');
    });

    it('keeps the network of the list the user opened there', () => {
        expect(sharedListDirectoryChainId({ chainId: 'litecoin-testnet' }, 'testnet')).toBe('litecoin-testnet');
        expect(sharedListDirectoryChainId(
            { chainId: 'dogecoin-testnet', directoryChainId: 'bitcoin-testnet' },
            'testnet',
        )).toBe('bitcoin-testnet');
    });
});

describe('shell wiring', () => {
    for (const file of [
        'packages/web/src/App.jsx',
        'packages/extension/src/popup/App.jsx',
        'packages/desktop/renderer/App.jsx',
    ]) {
        it(`${file} derives the directory chain from the selected network`, () => {
            const source = readFileSync(join(process.cwd(), file), 'utf8');
            expect(source).toContain('sharedListDirectoryChainId(listRef, settings?.activeNetwork)');
            expect(source).not.toContain("listRef?.chainId || 'bitcoin-mainnet'");
        });
    }
});
