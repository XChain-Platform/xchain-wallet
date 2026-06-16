// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest setup for the unit test layer.
//
// Re-exports the workspace setup so unit tests don't have to know
// where the polyfills + matcher extensions live. Future per-layer
// setups (chaos has fault injectors, security has a stricter CSP
// shim, etc.) sit in their own setup files; unit stays minimal.

import '../setup.js';
