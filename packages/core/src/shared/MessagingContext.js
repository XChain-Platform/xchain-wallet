// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
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
 * @property {(password: string, opts?: { bip39Passphrase?: string }) => Promise<{ unlocked: true, passphraseCaptureNeeded?: Array<{ id: string, name: string }>, poolUnavailable?: true }>} unlockWallet
 * @property {(opts: { walletId: string, password: string, bip39Passphrase: string }) => Promise<any>} [capturePassphrase]
 *   §15.6 one-time capture: stores a legacy wallet's passphrase under its own
 *   key. Rejects with `PassphraseMismatchError` when the passphrase does not
 *   own the wallet's stored addresses, and stores nothing in that case.
 * @property {() => Promise<any>} [lockWallet]
 * @property {() => Promise<any>} [listWallets]
 * @property {(walletId: string) => Promise<any>} [getWalletBalances]
 * @property {(walletId: string) => Promise<any>} [getAddressesByChain]
 * @property {(walletId: string, chainId: string) => Promise<any>} [getNewestAddress]
 * @property {(walletId: string, accountId?: string) => Promise<any>} [getActiveAddresses]
 * @property {(accountId: string, chainId: string, addressId: string) => Promise<any>} [setActiveAddress]
 * @property {(opts: any) => Promise<any>} [createWallet]
 * @property {(opts: any) => Promise<any>} [importMnemonic]
 * @property {(opts: any) => Promise<any>} [addImportedWallet]
 * @property {(walletId: string) => Promise<any>} [listAccounts]
 * @property {(opts: any) => Promise<any>} [createAccount]
 * @property {(opts: any) => Promise<any>} [sendToken]
 * @property {(opts: any) => Promise<any>} [generateReceiveAddress]
 * @property {(opts: any) => Promise<any>} [generateDispenserAddress]
 * @property {(opts: any) => Promise<any>} [verifyReceiveAddress]
 *
 * @typedef {object} MessagingContextValue
 * @property {Shell} shell
 * @property {MessagingModule} messaging
 */

export const MessagingContext = createContext(/** @type {MessagingContextValue | null} */ (null));
