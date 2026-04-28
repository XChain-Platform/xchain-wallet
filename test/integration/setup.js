// Vitest setup for the integration test layer.
//
// Integration tests cross more boundaries than unit tests — they wire
// real Vaults to real (in-memory) storage backends, derive real HD
// keys, run real schema migrations. The KDF used in createWallet is
// dev-tunable but still wall-clock real (Argon2id), so this layer's
// per-test timeouts are bumped well past the unit suite's 5 s default.
// Vitest's `testTimeout` setting handles that — see
// `test/vitest/integration.config.js`.

import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}
