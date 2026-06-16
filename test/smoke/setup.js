// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// No setup file is needed for the Node-script smoke runner — each
// smoke is a self-contained Node script invoked via spawnSync, so
// imports / globals / matchers are managed in the smoke itself.
//
// This file exists so future setup-heavy smoke types (e.g. a
// vitest-driven smoke layer) have a conventional place to plug in
// without touching the runner.
