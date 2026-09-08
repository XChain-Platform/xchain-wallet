// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The rate-limit acceptance drive (rate-limits spec, AT6) runs the wallet
// against a regtest explorer that is deliberately throttled to a handful of
// requests a minute. That is the opposite of what every other regtest spec
// needs (the shared explorer is pinned at 5000 rpm so the campaign fits), so
// the drive gets its own config rather than a flag on the campaign's:
//
//   - only `*.ratelimit.regtest.spec.js` runs, and only when
//     XC_RATE_LIMIT_AT6=1 names the throttled venue on purpose;
//   - no global setup: the drive funds nothing, mines nothing and prices
//     nothing, so the venue clock, the price seed and the gas token are not
//     its business (and the seeding shells would themselves count against
//     the bucket it is trying to fill).
//
// Venue: a second explorer container serving EXPLORER_RATE_LIMIT_RPM=20,
// reached through the same localhost:18080 the wallet's regtest descriptors
// already name (tunnel the Mac's 18080 onto its port). See the spec header.

import { defineConfig } from '@playwright/test';
import regtestConfig from './playwright.regtest.config.js';

if (process.env.XC_RATE_LIMIT_AT6 !== '1') {
    throw new Error(
        'playwright.ratelimit.config.js drives a THROTTLED explorer; set XC_RATE_LIMIT_AT6=1 '
        + 'once localhost:18080 is that venue, never the shared 5000 rpm explorer.',
    );
}

export default defineConfig({
    ...regtestConfig,
    testMatch: '**/*.ratelimit.regtest.spec.js',
    globalSetup: undefined,
    outputDir: './test-results-ratelimit',
});
