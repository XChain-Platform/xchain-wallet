// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Crash hook for this shell (§50.4). Registers the global 'error' and
// 'unhandledrejection' listeners and feeds a ring buffer that
// `getRecentShellErrors()` exposes to the diagnostic dump.

import {
    createErrorRingBuffer,
    installShellErrorCapture as installCapture,
    redactDiagnosticText,
} from '@xchain-wallet/core/flows/diagnosticDump.js';

const buffer = createErrorRingBuffer();
let uninstall = null;

/** Idempotent; returns the uninstall function. */
export function installShellErrorCapture(target = globalThis) {
    if (!uninstall) uninstall = installCapture(target, buffer);
    const installedUninstall = uninstall;
    return () => {
        if (uninstall !== installedUninstall) return;
        installedUninstall();
        uninstall = null;
    };
}

/** @returns {import('@xchain-wallet/core/flows/diagnosticDump.js').DiagnosticError[]} */
export function getRecentShellErrors() {
    return buffer.list().map((entry) => ({
        ...entry,
        kind: redactDiagnosticText(entry.kind),
        message: redactDiagnosticText(entry.message),
        ...(entry.phase ? { phase: redactDiagnosticText(entry.phase) } : {}),
    }));
}
