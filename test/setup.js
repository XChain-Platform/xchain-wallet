// Vitest setup file — loaded before each test file, once per worker.
//
// Two things happen here:
//   1. `@testing-library/jest-dom` extends the Vitest matcher API
//      with jest-dom's DOM helpers (toBeInTheDocument, toHaveAttribute, …).
//   2. Node 18 exposes WebCrypto only under `globalThis.crypto`, but
//      `@noble/hashes` and the core crypto module reach for the bare
//      `crypto` global. Install it here so test files that touch KDF /
//      AES-GCM (even transitively) don't need the polyfill themselves.

import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}
