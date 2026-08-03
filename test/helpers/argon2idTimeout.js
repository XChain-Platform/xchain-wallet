// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One ceiling, one explanation, for every test that pays a real Argon2id
// derivation.
//
// Argon2id at the production floor (64 MiB, 3 passes) costs about 1.7s per
// derivation on a fast dev box, BY DESIGN: slowness is the security property.
// The suite ceilings were all sized for tests that finish in milliseconds
// (unit 20s, integration 30s, security 15s), and a 2-core hosted runner is
// several times slower again while sharing itself with 8 vitest forks. That
// combination is what made `test` and `coverage` fail the three crypto unit
// files on every push while they passed locally.
//
// The measurements behind the number, taken on 2026-08-03:
//
//   unit        crypto/kdf.test.js          13.4s file / 3.3s slowest test
//               the same under v8 coverage  45.7s file / 10.2s slowest test
//   security    backup-tamper                9.0s file / 3.0s slowest test
//                                            against a 15s ceiling
//   integration backup-add-mode             28.0s file / 5.0s slowest test
//                                            against a 30s ceiling
//
// The security and integration numbers matter because CI has never actually
// reached those stages: `pnpm run ci` runs unit first and dies there, so
// fixing the unit stage is what will expose them for the first time. The two
// files above sit at 20% and 17% of their ceilings on hardware several times
// faster than the runner, which is the same margin the unit files already
// fail on.
//
// 120s is roughly 12x the slowest measured case, so a genuine hang is still
// caught: no honest derivation at these parameters takes two minutes.
export const ARGON2ID_TEST_TIMEOUT_MS = 120_000;
