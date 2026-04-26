// No setup file is needed for the Node-script smoke runner — each
// smoke is a self-contained Node script invoked via spawnSync, so
// imports / globals / matchers are managed in the smoke itself.
//
// This file exists so future setup-heavy smoke types (e.g. a
// vitest-driven smoke layer) have a conventional place to plug in
// without touching the runner.
