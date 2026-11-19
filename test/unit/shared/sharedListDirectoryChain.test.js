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
    // The Shared lists page is retired; My Lists reads the directory now.
    it('My Lists derives the directory chain from the wallet network', () => {
        const source = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/MyLists.jsx'), 'utf8');
        expect(source).toContain('sharedListDirectoryChainId(null, chainRegistry.get(firstChain)?.networkKind)');
        expect(source).not.toContain("listRef?.chainId || 'bitcoin-mainnet'");
    });
});
