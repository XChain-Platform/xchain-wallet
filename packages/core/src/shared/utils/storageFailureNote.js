// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One storage-failure line for the records a failed unlock writes. A wrong
// password writes the lockout record; the duress passphrase writes the lockout
// record and arms the panic freeze. With storage refusing writes, a line that
// named panic mode, or one that appeared only when the freeze was armed, would
// tell anyone reading the Developer Mode log that the password typed was the
// duress passphrase. So the lockout, panic and duress records share one line,
// one source and one once-per-session flag: whatever is written, and in
// whatever order, the log reads the same.

import { logConsole } from './logConsole.js';

export const STORAGE_FAILURE_SOURCE = 'storage';
export const STORAGE_FAILURE_MESSAGE = 'local storage write failed; using in-memory state';

let noted = false;

/** Record the storage-failure line once per session. */
export function noteGuardStorageFailure() {
    if (noted) return;
    noted = true;
    logConsole.record({ source: STORAGE_FAILURE_SOURCE, level: 'warn', message: STORAGE_FAILURE_MESSAGE });
}

/** Test seam: let the next failure log again. */
export function __resetGuardStorageFailureForTests() {
    noted = false;
}
