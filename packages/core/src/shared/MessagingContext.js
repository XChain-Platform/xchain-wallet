// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { createContext } from 'react';

/**
 * @typedef {'popup' | 'web' | 'desktop'} Shell
 *
 * @typedef {object} MessagingModule
 * Each shell implements the same messaging surface (unlock / create /
 * import / list / balances / addresses / send / …). Function names and
 * signatures match across popup + web; MessagingProvider receives the
 * shell's module verbatim so shared routes call e.g.
 * `messaging.unlockWallet(password)` without caring which transport
 * (chrome.runtime vs in-page host) fulfils it.
 *
 * @property {(password: string) => Promise<any>} unlockWallet
 * @property {() => Promise<any>} [lockWallet]
 * @property {() => Promise<any>} [listWallets]
 * @property {(walletId: string) => Promise<any>} [getWalletBalances]
 * @property {(walletId: string) => Promise<any>} [getAddressesByChain]
 * @property {(walletId: string, chainId: string) => Promise<any>} [getNewestAddress]
 * @property {(opts: any) => Promise<any>} [createWallet]
 * @property {(opts: any) => Promise<any>} [importMnemonic]
 * @property {(opts: any) => Promise<any>} [addImportedWallet]
 * @property {(walletId: string) => Promise<any>} [listAccounts]
 * @property {(opts: any) => Promise<any>} [createAccount]
 * @property {(opts: any) => Promise<any>} [sendToken]
 * @property {(opts: any) => Promise<any>} [generateReceiveAddress]
 *
 * @typedef {object} MessagingContextValue
 * @property {Shell} shell
 * @property {MessagingModule} messaging
 */

export const MessagingContext = createContext(/** @type {MessagingContextValue | null} */ (null));
