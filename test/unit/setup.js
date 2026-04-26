// Vitest setup for the unit test layer.
//
// Re-exports the workspace setup so unit tests don't have to know
// where the polyfills + matcher extensions live. Future per-layer
// setups (chaos has fault injectors, security has a stricter CSP
// shim, etc.) sit in their own setup files; unit stays minimal.

import '../setup.js';
