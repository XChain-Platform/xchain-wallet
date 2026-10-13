// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Each entry identifies output that is an intentional part of one test.
// Keep messages specific so nearby React warnings still fail the test.
export const CONSOLE_ERROR_ALLOWLIST = [
    {
        file: 'test/unit/shared/messaging.test.js',
        test: 'throws when used outside MessagingProvider',
        message: /^Error: useMessaging must be used inside <MessagingProvider>\./,
    },
    {
        file: 'test/unit/shared/messaging.test.js',
        test: 'throws when used outside MessagingProvider',
        message: /^The above error occurred in the <TestComponent> component:/,
    },
    {
        file: 'test/unit/components/MarketChart.fallback.test.jsx',
        test: 'shows user-facing fallback copy with a valid theme token',
        message: /^\[MarketChart\] init failed: Error: \[vitest\] There was an error when mocking a module/,
    },
    // Lock teardown keeps going when a clear step fails and logs which step
    // failed. These tests make a step fail on purpose to prove the teardown.
    {
        file: 'test/unit/background/walletLock.test.js',
        test: 'still clears the signing secret and tears down when the session clear fails',
        message: /^\[xchain\] wallet\.lock: sessionBackend\.clear failed: Error: storage unavailable/,
    },
    {
        file: 'test/unit/background/walletLock.test.js',
        test: 'still tears down when the signing-secret clear fails',
        message: /^\[xchain\] wallet\.lock: clearSigningSecret failed: Error: storage unavailable/,
    },
    {
        file: 'test/unit/background/walletLock.test.js',
        test: 'still tears down when BOTH clears fail, and names both steps',
        message: /^\[xchain\] wallet\.lock: (?:sessionBackend\.clear|clearSigningSecret) failed: Error: storage unavailable/,
    },
    {
        file: 'test/unit/background/walletLock.test.js',
        test: 'reports a teardown failure instead of hiding it',
        message: /^\[xchain\] wallet\.lock: onLocked failed: Error: teardown blew up/,
    },
    {
        file: 'test/unit/background/walletLock.test.js',
        test: 'carries no secret material in the error it raises',
        message: /^\[xchain\] wallet\.lock: sessionBackend\.clear failed: Error: hunter2 at key xchain-wallet:session/,
    },
    {
        file: 'test/unit/background/autoLockRetryState.test.js',
        test: 'keeps the record through a failed clear and finishes on the next alarm',
        message: /^\[xchain\] wallet\.lock: sessionBackend\.clear failed: Error: storage clear failed/,
    },
    {
        file: 'test/unit/background/autoLockRetryState.test.js',
        test: 'propagates the rejection out of lockWalletNow so a rollback can catch it',
        message: /^\[xchain\] wallet\.lock: sessionBackend\.clear failed: Error: storage clear failed/,
    },
    {
        file: 'test/unit/background/autoLockRetryState.test.js',
        test: 're-unlocking stops the retry chase',
        message: /^\[xchain\] wallet\.lock: sessionBackend\.clear failed: Error: storage clear failed/,
    },
    {
        file: 'test/unit/background/autoLockRetryState.test.js',
        test: 'keeps the record when a popup-driven wallet.lock leaves a secret behind',
        message: /^\[xchain\] wallet\.lock: sessionBackend\.clear failed: Error: storage clear failed/,
    },
    {
        file: 'test/unit/background/autoLockRetryState.test.js',
        test: 'keeps the record when only the signing-secret clear fails',
        message: /^\[xchain\] wallet\.lock: clearSigningSecret failed: Error: storage clear failed/,
    },
    // The desktop launch gate logs when it cannot delete the cached key; the
    // test makes the delete fail to prove the wallet stays locked.
    {
        file: 'test/unit/desktop/autoLockLaunchGate.test.js',
        test: 'locks this launch and every relaunch while session.bin cannot be removed',
        message: /^\[xchain\] auto-lock could not clear the cached session key: Error: EPERM/,
    },
    // Label restore after an import is best effort and logs when it is
    // skipped; these tests fail the restore to prove the import still succeeds.
    {
        file: 'test/unit/background/walletCreateVaultClose.test.js',
        test: 'does not turn a background restore failure into an import failure',
        message: /^\[xchain-wallet\] label-sync restore skipped: Error: restore failed/,
    },
    {
        file: 'test/unit/web/hostBridgeOnboardingVaultClose.test.js',
        test: 'keeps a restore failure separate from the successful import',
        message: /^\[xchain-wallet\/web\] label-sync restore skipped: Error: explorer unavailable/,
    },
    // Confirm-lane forms log the raw failure for diagnosis while the screen
    // shows plain copy; these tests inject the failure to check that copy.
    {
        file: 'test/unit/routes/Send.flow.test.jsx',
        test: 'replaces an SDK send failure and its raw details with actionable copy',
        message: /^Send \(confirm\) failed: SDKWalletError: SDK wallet exploded/,
    },
    {
        file: 'test/unit/routes/Send.flow.test.jsx',
        test: 'shows a known node rejection plainly and retains the signed transaction without re-signing',
        message: /^Send \(confirm\) failed: BroadcastFailedPermanentError: broadcast failed \(phase1\): Transaction broadcast failed: bad-txns-inputs-missingorspent/,
    },
    {
        file: 'test/unit/action-forms-confirm.test.jsx',
        test: 'shows a boundary-crossed protocol refusal and can compose again',
        message: /^Create order \(confirm\) failed: SDKEncoderError: Encoder RPC error: This token symbol is already registered\./,
    },
    {
        file: 'test/unit/action-forms-confirm.test.jsx',
        test: "shows 'insufficient network fee', keeps values, and retries",
        message: /^Create order \(confirm\) failed: Error: broadcast failed \(commit\): Encoder RPC error: insufficient fee/,
    },
    {
        file: 'test/unit/action-forms-confirm.test.jsx',
        test: "shows 'network error', keeps values, and retries",
        message: /^Create order \(confirm\) failed: Error: Failed to fetch/,
    },
    {
        file: 'test/unit/action-forms-confirm.test.jsx',
        test: "shows 'signer cancellation', keeps values, and retries",
        message: /^Create order \(confirm\) failed: Error: User cancelled signing on the device\./,
    },
];
