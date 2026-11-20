// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isInvokedDirectly(moduleUrl, entryPath = process.argv[1]) {
    if (!entryPath) return false;
    try {
        return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
    } catch {
        return false;
    }
}

const USAGE = `Usage: node tools/release/is-invoked-directly.mjs --help

is-invoked-directly.mjs is a library with no command of its own.
The release tools import isInvokedDirectly() from it to decide whether to
run their CLI, comparing their own module URL with the realpath of the
entry script, so a symlink or a renamed copy still runs the checks.
`;

// The release-tool audit types --help at every script in this directory, so
// the library answers it instead of exiting silently.
if (isInvokedDirectly(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    process.stderr.write(USAGE);
    process.exit(2);
}
