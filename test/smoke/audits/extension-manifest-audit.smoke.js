// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch, user-initiated track, Step 1: Chrome
// Web Store manifest hardening gate. Catches drift in the extension
// manifest (stale version after a wallet bump, missing homepage_url,
// broken icon tile, broad host_permissions snuck in) before it reaches
// CI or the CWS submission queue.

import { strict as assert } from 'node:assert';
import { runExtensionManifestAudit } from '../../../packages/core/scripts/extension-manifest-audit.js';

const results = runExtensionManifestAudit();
const failed = results.filter((r) => !r.ok);
assert.equal(failed.length, 0,
    `extension-manifest audit: ${failed.length} rule(s) failed:\n${
        failed.map((r) => `  ✗ ${r.rule}: ${r.detail}`).join('\n')
    }`);

console.log(
    `OK: extension-manifest audit smoke (${results.length} rules pass: MV3 + CWS-valid version + version↔wallet sync + version_name mirror + extension-pkg sync + description ≤132 + homepage_url + 128 icon + action icon + content-scripts valid + permissions-minimal + manifest-freeze [permissions/host_permissions/content-script-matches] + web_accessible_resources match relationship)`,
);
