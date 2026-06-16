// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §48.5 / G150 Log console. Pins the logConsole ring-buffer
// surface, the LogConsole component, and the DeveloperModeSection
// integration.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const utilSrc = read('packages/core/src/shared/utils/logConsole.js');
const compSrc = read('packages/core/src/shared/components/LogConsole.jsx');
const sectionSrc = read('packages/core/src/shared/components/settings/DeveloperModeSection.jsx');

// 1. Ring-buffer surface.
assert.ok(/export const logConsole = \{/.test(utilSrc),
    'logConsole exports its singleton');
for (const method of ['attach', 'detach', 'record', 'entries', 'subscribe', 'clear', 'setCapacity', 'isAttached']) {
    assert.ok(new RegExp(`\\b${method}\\b`).test(utilSrc), `logConsole exposes ${method}`);
}

// 2. Capacity bound enforced when the buffer overflows.
assert.ok(/buffer\.length > capacity/.test(utilSrc),
    'logConsole trims the buffer when it exceeds capacity');

// 3. Original console methods preserved + still invoked after attach.
assert.ok(/originals\[level\]\(\.\.\.args\)/.test(utilSrc),
    'logConsole calls the original console method after pushing');
assert.ok(/console\.log = originals\.log/.test(utilSrc),
    'logConsole.detach restores the original console.log');

// 4. Patch covers all four levels.
for (const level of ['log', 'info', 'warn', 'error']) {
    assert.ok(new RegExp(`'${level}'`).test(utilSrc), `logConsole patches console.${level}`);
}

// 5. LogConsole component imports the singleton and self-attaches on
//    mount. Subscribes to additions and tears down on unmount.
assert.ok(/import \{ logConsole \} from '\.\.\/utils\/logConsole\.js'/.test(compSrc),
    'LogConsole imports the logConsole singleton');
assert.ok(/logConsole\.isAttached\(\)/.test(compSrc) && /logConsole\.attach\(\)/.test(compSrc),
    'LogConsole idempotently attaches on mount');
assert.ok(/logConsole\.subscribe/.test(compSrc),
    'LogConsole subscribes to buffer additions');

// 6. UI exposes filter chips for all four levels + Clear / Copy.
for (const level of ['log', 'info', 'warn', 'error']) {
    assert.ok(new RegExp(`'${level}'`).test(compSrc), `LogConsole filter chips include ${level}`);
}
assert.ok(/Clear log buffer/.test(compSrc),
    'LogConsole Clear button is aria-labelled');
assert.ok(/Copy filtered log entries/.test(compSrc),
    'LogConsole Copy button is aria-labelled');

// 7. DeveloperModeSection mounts LogConsoleRow which renders LogConsole
//    behind a Show / Hide toggle, gated on Developer Mode.
assert.ok(/from '\.\.\/LogConsole\.jsx'/.test(sectionSrc),
    'DeveloperModeSection imports LogConsole');
assert.ok(/<LogConsole \/>/.test(sectionSrc),
    'DeveloperModeSection mounts the LogConsole panel');
assert.ok(/LogConsoleRow/.test(sectionSrc),
    'DeveloperModeSection wraps the panel in LogConsoleRow');
assert.ok(/disabled=\{!developerMode\}/.test(sectionSrc),
    'LogConsoleRow gates the Show/Hide button on Developer Mode');

console.log('OK — logConsole singleton + LogConsole component + DeveloperModeSection wiring smoke');
