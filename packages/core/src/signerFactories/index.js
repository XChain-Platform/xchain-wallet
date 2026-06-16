// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shell-agnostic hardware-signer pair factories. Each shell binds its
// own HW SDK imports (`@trezor/connect-web`, `@ledgerhq/hw-transport-*`,
// `@ledgerhq/hw-app-btc`) and feeds them to these builders via DI so
// core stays free of native HW dependencies.
//
// Intended call-sites: `packages/{extension,web,desktop}/…/signerFactories/`.

export { makeTrezorFactory } from './trezor.js';
export { makeLedgerFactory } from './ledger.js';
