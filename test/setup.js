// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest setup file. Loaded before each test file, once per worker.
//
// Three things happen here:
//   1. `@testing-library/jest-dom` extends the Vitest matcher API
//      with jest-dom's DOM helpers (toBeInTheDocument, toHaveAttribute, …).
//   2. Node 18 exposes WebCrypto only under `globalThis.crypto`, but
//      `@noble/hashes` and the core crypto module reach for the bare
//      `crypto` global. Install it here so test files that touch KDF /
//      AES-GCM (even transitively) don't need the polyfill themselves.
//   3. React Testing Library's auto-cleanup hooks into the global
//      `afterEach`, but vitest is configured with `globals: false`,
//      so the cleanup never registers on its own. Wire it explicitly
//      so rendered components are torn down between tests; otherwise
//      successive render() calls accumulate in the same jsdom and
//      `getByRole` finds duplicates across test boundaries.

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

import { slowTimeout } from './helpers/testEnvSpeed.js';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

// How long `findBy*` / `waitFor` wait before giving up.
//
// The library default is 1000ms, which is a statement about how fast the
// machine is, not about what the component does. On the `coverage` job it
// expired while a mocked balance lookup was still resolving, and the failure
// reads as a product bug - "Unable to find an element with the text: /250
// MEMEVALID available/" - rather than as the machine being busy. A component
// that legitimately needs longer than this base has a defect worth failing
// on; an instrumented run just needs more wall-clock to prove the same thing.
// Only failing assertions pay the ceiling, so raising it costs a green run
// nothing. See test/helpers/testEnvSpeed.js.
configure({ asyncUtilTimeout: slowTimeout(5000) });

afterEach(() => {
    cleanup();
    // Belt-and-suspenders: if a test leaves fake timers installed
    // (e.g. it timed out before its own `finally` could call
    // `useRealTimers()`), the next test would inherit them and any
    // setTimeout-based polling (waitFor, microtask drains) would hang
    // forever. Restore real timers between every test.
    vi.useRealTimers();
});
