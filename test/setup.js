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
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

afterEach(() => {
    cleanup();
    // Belt-and-suspenders: if a test leaves fake timers installed
    // (e.g. it timed out before its own `finally` could call
    // `useRealTimers()`), the next test would inherit them and any
    // setTimeout-based polling (waitFor, microtask drains) would hang
    // forever. Restore real timers between every test.
    vi.useRealTimers();
});
