// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The core barrel's `registry` namespace: the chain registry plus the signed
// hub sync (§9.7 / G007). The sync lives here rather than in ./index.js because
// first-paint web modules import ./index.js, and the sync's Ed25519 verifier is
// not needed until after the first screen; web/src/main.jsx loads ./remote.js
// on its own once the shell has painted. Every shell that reads the namespace
// (extension worker, popup, approval window, desktop main) sees both halves.

export * from './index.js';
export {
    verifyChainRegistry,
    syncChainRegistryFromHub,
    REGISTRY_SIGNING_DOMAIN,
    REGISTRY_PINNED_PUBKEY_HEX,
    REGISTRY_DEFAULT_URL,
} from './remote.js';
