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

// 3. Original console methods preserved and receive only redacted arguments.
assert.ok(/originals\[level\]\(\.\.\.safeArgs\)/.test(utilSrc),
    'logConsole calls the original console method with redacted arguments');
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
// The Clear label comes from the dictionary (components.logConsole.clearLogBuffer,
// "Clear log buffer"), so the source carries the key, not the English text.
assert.ok(/aria-label=(?:\{t\('components\.logConsole\.clearLogBuffer'\)\}|\{?["'`]Clear log buffer["'`]\}?)/.test(compSrc)
    && /'components\.logConsole\.clearLogBuffer': 'Clear log buffer'/.test(read('packages/core/src/i18n/locales/en/components.js')),
    'LogConsole Clear button is aria-labelled');
// Copy takes every entry (the filters only change the view), labelled
// "Copy all log entries" from the dictionary.
assert.ok(/aria-label=(?:\{t\('components\.logConsole\.copyAllLogEntries'\)\}|\{?["'`]Copy all log entries["'`]\}?)/.test(compSrc),
    'LogConsole Copy button is aria-labelled');

// 7. DeveloperModeSection's LogConsoleRow is a drill-in row; the LogConsole
//    mounts on its own page (DeveloperLogsPage), gated on Developer Mode,
//    never behind a Show / Hide toggle (operator ruling 2026-11-13).
assert.ok(/from '\.\.\/LogConsole\.jsx'/.test(sectionSrc),
    'DeveloperModeSection imports LogConsole');
// The console (and its buffer attach) mounts only past the Developer Mode
// check; its filters sit in the title-bar filter panel (operator walk
// 2026-11-15), so the body holds only the note and the list.
assert.ok(/export function DeveloperLogsPage\([\s\S]+?if \(!settings\?\.developerMode\)[\s\S]+?return <LiveLogsScreen/.test(sectionSrc),
    'DeveloperLogsPage mounts the LogConsole panel only with Developer Mode on');
assert.ok(/function LiveLogsScreen\([\s\S]+?useLogConsole\(\)[\s\S]+?<ListFilterMenu[\s\S]+?<LogConsoleControls state=\{state\} \/>[\s\S]+?<div id="settings-log-console"><LogConsole state=\{state\} \/><\/div>/.test(sectionSrc),
    'the log filters live in the title-bar filter panel and the body holds the list');
assert.ok(/function LogConsoleRow\(\{ onOpen \}\)[\s\S]+?<ListRow[\s\S]+?chevron/.test(sectionSrc),
    'LogConsoleRow is a drill-in row');
assert.ok(!/aria-controls="settings-log-console"/.test(sectionSrc),
    'the console never expands in place');

console.log('OK: logConsole singleton + LogConsole component + DeveloperModeSection wiring smoke');
