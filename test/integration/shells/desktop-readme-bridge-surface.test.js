// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop README states the renderer's privileged surface in prose. It is
// pinned to the preload source the way the preload header is pinned to
// BRIDGE_WORLDS, so a world or bridge method added without a README line
// fails here instead of leaving a reviewer with an incomplete boundary.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = readFileSync(resolve(HERE, '../../../packages/desktop/preload.cjs'), 'utf8');
const README = readFileSync(resolve(HERE, '../../../packages/desktop/README.md'), 'utf8');

function exposedWorlds(source) {
    return Array.from(source.matchAll(/exposeInMainWorld\(\s*'([A-Za-z]+)'/g), (m) => m[1]);
}

describe('desktop README names the renderer bridge surface', () => {
    it('finds the worlds the preload exposes', () => {
        expect(exposedWorlds(PRELOAD)).toContain('xchainWalletBridge');
        expect(exposedWorlds(PRELOAD).length).toBeGreaterThan(1);
    });

    it('names every exposed world', () => {
        for (const world of exposedWorlds(PRELOAD)) {
            expect(README, `README.md must name ${world}`).toContain(world);
        }
    });

    it('names every method of the main bridge world', () => {
        const body = PRELOAD.split("exposeInMainWorld('xchainWalletBridge'")[1].split('\ncontextBridge.')[0];
        const methods = Array.from(body.matchAll(/^    (\w+)\(/gm), (m) => m[1]);
        expect(methods).toEqual(expect.arrayContaining(['sendMessage', 'wipeStorage', 'saveBackupFile']));
        for (const method of methods) {
            expect(README, `README.md must name xchainWalletBridge.${method}`).toContain(method);
        }
    });
});
