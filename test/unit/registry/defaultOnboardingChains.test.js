// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The chain set a new wallet starts with is ONE value derived from the
// bundled descriptors. A hand-copied literal in both the web and extension
// shells would let a new bundled chain reach no new wallet until both copies
// were edited, with nothing comparing the two.

import { describe, it, expect } from 'vitest';
import {
    BUNDLED_DESCRIPTORS,
    ChainRegistry,
    DEFAULT_ONBOARDING_CHAIN_IDS,
    defaultOnboardingChainIds,
} from '../../../packages/core/src/registry/index.js';
import { DEFAULT_ACTIVE_CHAIN_IDS as EXTENSION_DEFAULT } from '../../../packages/extension/src/background/walletCreate.js';

describe('default onboarding chain set', () => {
    it('is today\'s three mainnets, bitcoin first (the import flow opens on the first)', () => {
        expect(DEFAULT_ONBOARDING_CHAIN_IDS).toEqual(['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet']);
    });

    it('holds only ids the registry resolves to a mainnet descriptor', () => {
        const reg = new ChainRegistry();
        for (const id of DEFAULT_ONBOARDING_CHAIN_IDS) {
            expect(reg.descriptorFor(id).networkKind).toBe('mainnet');
        }
    });

    it('is the very binding the extension and desktop shells default to', () => {
        expect(EXTENSION_DEFAULT).toBe(DEFAULT_ONBOARDING_CHAIN_IDS);
    });

    it('picks up a new bundled mainnet descriptor with no shell edit', () => {
        const btcMain = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');
        const extra = { ...btcMain, id: 'newcoin-mainnet', coin: 'newcoin' };
        const regtest = { ...btcMain, id: 'newcoin-regtest', coin: 'newcoin', networkKind: 'regtest' };
        expect(defaultOnboardingChainIds([...BUNDLED_DESCRIPTORS, extra, regtest]))
            .toEqual([...DEFAULT_ONBOARDING_CHAIN_IDS, 'newcoin-mainnet']);
    });
});
