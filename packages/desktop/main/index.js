// @xchain-wallet/desktop — Electron main process.
//
// Owns keys, SDK instance, signers, OS keychain, native hardware transports,
// and URI handler registration. Renderer talks to main over contextBridge IPC.
// See SPEC.md §9.3.2 (process isolation).
//
// Implementation begins in Phase 1.
