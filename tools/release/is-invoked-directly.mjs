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
