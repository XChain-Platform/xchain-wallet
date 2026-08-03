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

/**
 * The same pool, halved, for a run carrying coverage instrumentation.
 *
 * Sizing the pool from the machine got `test` green and left `coverage`
 * failing on something that is not a test failure at all: all 393 files and
 * 5645 tests PASSED, and the run still exited 1 on two unhandled
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` errors (run 30839130702).
 *
 * That is a starvation symptom with a specific mechanism. Argon2id is
 * SYNCHRONOUS - it blocks the worker's event loop for its whole duration - so
 * while a derivation runs, that worker cannot answer the RPC vitest requires
 * of it. Instrumentation multiplies the derivation cost, several forks
 * multiply it again by contending for the same cores, and past some point the
 * blocking window is longer than birpc's own timeout. birpc's timeout is not
 * exposed through vitest config, so the only lever is the blocking window
 * itself, and fork count is what sets it.
 *
 * Halved rather than pinned to 1: the goal is to keep the window under the
 * RPC timeout, not to serialise a suite of 393 files. On a big box this is 4,
 * where an instrumented derivation already measures ~5s.
 */
export const instrumentedMaxForks = Math.max(1, Math.floor(maxForks / 2));
