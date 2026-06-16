// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @xchain-wallet/core
//
// Platform-agnostic components, state, SDK integration, signers, schemas.
// See SPEC.md §9.2 (package roles) and §11 (data model).
//
// Implementation begins in Phase 1.

export * as schemas from './schemas/index.js';
export * as registry from './registry/index.js';
export * as signers from './signers/index.js';
export * as signerFactories from './signerFactories/index.js';
export * as crypto from './crypto/index.js';
export * as storage from './storage/index.js';
export * as sdk from './sdk/index.js';
export * as flows from './flows/index.js';
export * as uri from './uri/index.js';
export * as branding from './branding/index.js';
export * as decoder from './decoder/index.js';
export * as i18n from './i18n/index.js';
export * as airdrop from './airdrop/index.js';
export * as notifications from './notifications/index.js';

// NOTE: the `shared` surface (React routes, provider, hooks) is
// deliberately NOT re-exported here. Its entry pulls `.jsx` files
// which Node's native ESM loader can't parse; bundlers (Vite) handle
// the extension, but the core Node smoke scripts — which resolve this
// module directly — would break. Consumers reach shared via its
// subpath export instead:
//     import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
