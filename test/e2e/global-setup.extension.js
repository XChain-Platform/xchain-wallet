// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Global setup for the extension venue: prove the chain is reachable and
// build the extension ONCE, before any persistent context launches.
//
// The build is deliberately not part of `webServer`-style per-run tooling:
// a persistent context loads the unpacked directory at launch, so
// rebuilding mid-run would swap the extension underneath a live profile.
// Building here also means a stale `dist/` can never quietly serve
// yesterday's extension while the specs report on today's source.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertVenueReachable } from './fixtures/regtest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_PKG = path.resolve(HERE, '../../packages/extension');

export default async function globalSetup() {
    await assertVenueReachable();

    execFileSync('pnpm', ['build'], { cwd: EXT_PKG, stdio: 'inherit' });

    const manifest = path.join(EXT_PKG, 'dist', 'manifest.json');
    if (!fs.existsSync(manifest)) {
        throw new Error(`extension build produced no manifest at ${manifest}`);
    }
}
