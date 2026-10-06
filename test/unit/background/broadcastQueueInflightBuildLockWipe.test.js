// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A host build still awaiting the vault when a lock or wipe lands was overtaken
// and must not install its host, vault or signing keys over the teardown.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bg = readFileSync(join(here, '../../../packages/extension/src/background.js'), 'utf8');
const buildHost = bg.slice(bg.indexOf('async function buildHost()'), bg.indexOf('function tearDownHost()'));
const tearDown = bg.slice(bg.indexOf('function tearDownHost()'), bg.indexOf('function tearDownHost()') + 400);

describe('buildHost epoch fence', () => {
    it('bumps the epoch in every teardown', () => {
        expect(bg).toMatch(/let hostEpoch = 0;/);
        expect(tearDown).toMatch(/hostEpoch \+= 1;/);
    });

    it('captures the epoch and signer pool before the first await', () => {
        const firstAwait = buildHost.indexOf('await');
        expect(buildHost.indexOf('const epoch = hostEpoch;')).toBeGreaterThan(-1);
        expect(buildHost.indexOf('const epoch = hostEpoch;')).toBeLessThan(firstAwait);
        expect(buildHost.indexOf('const pool = signerPool;')).toBeLessThan(firstAwait);
    });

    it('re-checks after each await and before the host is created', () => {
        const checks = buildHost.split('epoch !== hostEpoch').length - 1;
        expect(checks).toBeGreaterThanOrEqual(4);
        const lastCheck = buildHost.lastIndexOf('epoch !== hostEpoch');
        expect(lastCheck).toBeLessThan(buildHost.indexOf('host = createBackgroundHost('));
    });

    it('zeroes the key and undoes the vault and pool when overtaken', () => {
        expect(buildHost).toMatch(/if \(epoch !== hostEpoch\) \{\s*masterKey\?\.fill\(0\);\s*return null;/);
        expect(buildHost).toMatch(/buildVault\.close\(\)/);
        expect(buildHost).toMatch(/pool\.lockAll\(\)/);
    });

    it('builds the host over the build-local vault, not the module slot', () => {
        expect(buildHost).toMatch(/host = createBackgroundHost\(\{\s*vault: buildVault,/);
    });
});
