// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How many vitest forks this machine should run.
//
// Every config in this directory used to carry the literal `8`. That number
// was chosen as a good-citizen cap on a 32-core dev box shared by many agent
// sessions: vitest defaults to one worker per core, so an uncapped run
// claimed the whole machine, and an abruptly killed run left its pool
// orphaned busy-spinning at roughly a core each.
//
// On a hosted runner the same 8 is the opposite of a cap - it is
// oversubscription, by a factor of two to four, with each fork running
// memory-hard work (Argon2id at 64 MiB, jsdom, Babel walks over the whole
// source tree). Measured on ubuntu-latest under coverage, run 30827175941 on
// 2026-08-03: ONE Argon2id derivation took 104s, against 5.0s for the same
// derivation instrumented on the dev box. That 20x is not core speed. It is
// what made a pool-sizing problem present as seven failing tests, and it kept
// `ci.yml` red - which, since `verify-validated-commit.mjs` refuses to cut a
// signed release on a commit without a green run, is a release blocker rather
// than a test-health nuisance.
//
// `-1` leaves a core for the parent process. The cap preserves the original
// good-citizen behaviour on a big box, where this still resolves to 8.
import { availableParallelism } from 'node:os';

export const maxForks = Math.max(1, Math.min(8, availableParallelism() - 1));
