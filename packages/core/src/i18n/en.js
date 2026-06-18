// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Back-compat shim. The canonical English dictionary moved under
// `./locales/en/index.js` at v0.216.0 (§54 / G173). Existing imports of
// `./i18n/en.js` keep working through this re-export so we don't have
// to chase every consumer in one step. New code should import from
// `./i18n/locales/en/index.js` (or pull the `i18n` namespace from
// `@xchain-wallet/core`, which already routes through the new path).

export { en } from './locales/en/index.js';
