// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useWalletMode (§20 / Cluster W FOLLOWUP 5): single source of truth
// for the wallet's `walletMode` field; pulls from settings, falls back
// to `WALLET_MODE_DEFAULT` when settings are still loading or absent
// (older v2 records before the field was added), and exposes the three
// boolean shorthand flags every action surface needs.
//
// Why a hook (rather than each form re-deriving the same line):
//   - One place to coalesce the WALLET_MODE_DEFAULT fallback so the
//     three modes are exhaustive everywhere.
//   - One place to swap to a session-only override later (§20 spec
//     hint at a "temporary watcher mode" toggle for one-off PSBTs).
//   - Forms stay readable: `const { isWatcherMode } = useWalletMode()`
//     instead of `const walletMode = settings?.walletMode || WALLET_MODE_DEFAULT;`
//
// Shape:
//   { walletMode: 'full' | 'watcher' | 'signer',
//     isFullMode: boolean,
//     isWatcherMode: boolean,
//     isSignerMode: boolean }

import { WALLET_MODE_DEFAULT } from '../../schemas/settings.js';
import { useSettings } from './useSettings.js';

/**
 * @typedef {Object} WalletModeState
 * @property {'full' | 'watcher' | 'signer'} walletMode
 * @property {boolean} isFullMode
 * @property {boolean} isWatcherMode
 * @property {boolean} isSignerMode
 */

/**
 * @returns {WalletModeState}
 */
export function useWalletMode() {
    const { settings } = useSettings();
    const walletMode = /** @type {'full' | 'watcher' | 'signer'} */ (
        settings?.walletMode || WALLET_MODE_DEFAULT
    );
    return {
        walletMode,
        isFullMode: walletMode === 'full',
        isWatcherMode: walletMode === 'watcher',
        isSignerMode: walletMode === 'signer',
    };
}
