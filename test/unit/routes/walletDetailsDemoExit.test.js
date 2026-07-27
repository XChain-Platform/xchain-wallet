// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the demo exit decides whether to clear the vault store by asking
// whether any wallet is left. Removing the demo record alone leaves the
// vault meta behind, which boots the next session into an unlock screen
// for an empty vault whose throwaway password the exit just deleted
// (wallet E2E session 16, D-61). Wiping is right ONLY when nothing else
// is in the vault, so this predicate has to fail closed.

import { describe, it, expect } from 'vitest';
import { isVaultEmpty } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';

describe('isVaultEmpty', () => {
    it('is true when the wallet list comes back empty', async () => {
        expect(await isVaultEmpty({ listWallets: async () => [] })).toBe(true);
    });

    it('accepts the { wallets: [] } envelope shape', async () => {
        expect(await isVaultEmpty({ listWallets: async () => ({ wallets: [] }) })).toBe(true);
    });

    it('is false while any wallet remains, so a real wallet is never wiped', async () => {
        expect(await isVaultEmpty({ listWallets: async () => [{ id: 'w1' }] })).toBe(false);
        expect(await isVaultEmpty({ listWallets: async () => ({ wallets: [{ id: 'w1' }] }) })).toBe(false);
    });

    it('fails closed when the list cannot be read', async () => {
        expect(await isVaultEmpty({ listWallets: async () => { throw new Error('vault locked'); } })).toBe(false);
        expect(await isVaultEmpty({})).toBe(false);
        expect(await isVaultEmpty(null)).toBe(false);
    });

    it('fails closed on a shape it does not recognise', async () => {
        expect(await isVaultEmpty({ listWallets: async () => undefined })).toBe(false);
        expect(await isVaultEmpty({ listWallets: async () => 'nope' })).toBe(false);
    });
});
