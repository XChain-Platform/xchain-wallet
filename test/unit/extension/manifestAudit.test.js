// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runExtensionManifestAudit } from '../../../packages/core/scripts/extension-manifest-audit.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(
    resolve(repo, 'packages/extension/manifest.json'),
    'utf8',
));

function resultFor(candidate, rule) {
    return runExtensionManifestAudit({ manifest: candidate })
        .find((result) => result.rule === rule);
}

describe('extension manifest audit', () => {
    it('accepts the complete MV3 manifest', () => {
        expect(runExtensionManifestAudit().filter((result) => !result.ok)).toEqual([]);
    });

    it('rejects a missing generated icon size', () => {
        const candidate = structuredClone(manifest);
        delete candidate.icons['32'];

        expect(resultFor(candidate, 'icons-all-sizes-declared')?.ok).toBe(false);
    });

    it('rejects executable-string CSP tokens', () => {
        const candidate = structuredClone(manifest);
        candidate.content_security_policy.extension_pages += " 'unsafe-eval'";

        expect(resultFor(candidate, 'csp-mv3-safe')?.ok).toBe(false);
    });

    it('rejects an MV2-style background page', () => {
        const candidate = structuredClone(manifest);
        candidate.background = { scripts: ['background.js'], persistent: true };

        expect(resultFor(candidate, 'background-service-worker-mv3')?.ok).toBe(false);
    });
});
