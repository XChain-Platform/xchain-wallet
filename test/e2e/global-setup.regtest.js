// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Global setup for the regtest venue: prove the chain is there before
// Playwright spends two minutes onboarding a wallet against nothing.
//
// A down SSH tunnel otherwise surfaces as a spec timing out deep in the
// send flow, which reads exactly like a wallet regression. Fail here
// instead, once, with the tunnel command in the message.

import { assertVenueReachable } from './fixtures/regtest.js';

export default async function globalSetup() {
    await assertVenueReachable();
}
