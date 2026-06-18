// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster Q FOLLOWUP 5: logConsole.snapshot() integration with the
// §50 diagnostic dump. The previous wallet's About-panel "Copy
// diagnostics" button captured wallet metadata + chain registry +
// endpoint config + record counts + recent errors but NOT the
// process's recent log buffer. v0.321.0 wires the background's
// logConsole entries (vault / signer / encoder / bridge events from
// Cluster Q FOLLOWUP 4) into the dump under a `recent_logs` slot,
// behind the same redaction defaults the existing slots use.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const logSrc = read('packages/core/src/shared/utils/logConsole.js');
const dumpSrc = read('packages/core/src/flows/diagnosticDump.js');
const hostSrc = read('packages/extension/src/background/createBackgroundHost.js');

// 1. logConsole exposes a new `snapshot({ limit, messageLimit })`
//    method alongside the existing `entries()`.
assert.ok(/Cluster Q FOLLOWUP 5/.test(logSrc),
    'logConsole tags Cluster Q FOLLOWUP 5');
assert.ok(/function snapshot\(opts = \{\}\)/.test(logSrc),
    'logConsole defines a snapshot helper with the documented signature');
assert.ok(/snapshot,/.test(logSrc),
    'logConsole exports snapshot in its singleton');

// 2. The snapshot honors `limit` (returning at most N most-recent
//    entries) and `messageLimit` (truncating each message).
assert.ok(/buffer\.length > limit\s*\?\s*buffer\.slice\(buffer\.length - limit\)/.test(logSrc),
    'snapshot returns the trailing window when limit < buffer length');
assert.ok(/e\.message\.length > messageLimit\s*\?\s*e\.message\.slice\(0, messageLimit\)/.test(logSrc),
    'snapshot truncates per-entry message at messageLimit');

// 3. diagnosticDump accepts an optional `recentLogs` arg, surfaces
//    it under `recent_logs`, and runs it through a sanitizer that
//    bounds array length + per-line length defensively.
assert.ok(/recentLogs = \[\]/.test(dumpSrc),
    'diagnosticDump destructures recentLogs from its opts');
assert.ok(/recent_logs: sanitizeLogs\(recentLogs\)/.test(dumpSrc),
    'diagnosticDump emits recent_logs via sanitizeLogs');
assert.ok(/RECENT_LOGS_LIMIT = 200/.test(dumpSrc),
    'diagnosticDump caps recent_logs at 200 entries');
assert.ok(/LOG_MESSAGE_LIMIT = 500/.test(dumpSrc),
    'diagnosticDump caps each recent_log message at 500 chars');
assert.ok(/function sanitizeLogs\(arr\)/.test(dumpSrc),
    'diagnosticDump defines sanitizeLogs with an array param');
// Defensive level / source / id / timestamp coercion so a stale shell
// that fed in malformed entries doesn't break the dump shape.
assert.ok(/\['log', 'info', 'warn', 'error'\]\.includes\(e\?\.level\)/.test(dumpSrc),
    'sanitizeLogs validates the level field against the documented union');
assert.ok(/typeof e\?\.source === 'string' \? e\.source : 'console'/.test(dumpSrc),
    'sanitizeLogs coerces source to a string with a "console" fallback');

// 4. The DiagnosticDump typedef exposes the new slot.
assert.ok(/@property \{DiagnosticLogEntry\[\]\} recent_logs/.test(dumpSrc),
    'DiagnosticDump typedef declares recent_logs');
assert.ok(/@typedef \{Object\} DiagnosticLogEntry/.test(dumpSrc),
    'DiagnosticLogEntry typedef is defined');

// 5. The extension background host imports logConsole and threads
//    snapshot() into the diagnosticDump call. Failure path falls
//    back to an empty array so a logConsole load failure can't break
//    the dump.
assert.ok(/import \{ logConsole \} from '@xchain-wallet\/core\/shared\/utils\/logConsole\.js'/.test(hostSrc),
    'createBackgroundHost imports logConsole');
assert.ok(/logConsole\.snapshot\(\{ limit: 100, messageLimit: 500 \}\)/.test(hostSrc),
    'diagnostic.dump handler calls logConsole.snapshot with bounded params');
assert.ok(/let recentLogs = \[\];[\s\S]{0,300}try \{[\s\S]{0,200}recentLogs = logConsole\.snapshot/.test(hostSrc),
    'diagnostic.dump handler guards the snapshot call in a try/catch');
assert.ok(/diagnosticDump\(\{[\s\S]{0,500}recentLogs,[\s\S]{0,200}\}\)/.test(hostSrc),
    'diagnostic.dump handler passes recentLogs into diagnosticDump');

console.log('OK: logConsole.snapshot + diagnostic-dump integration');
