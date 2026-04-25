// Smoke for §56.3 Pre-launch, user-initiated track, Step 1 — Chrome
// Web Store manifest hardening gate. Catches drift in the extension
// manifest (stale version after a wallet bump, missing homepage_url,
// broken icon tile, broad host_permissions snuck in) before it reaches
// CI or the CWS submission queue.

import { strict as assert } from 'node:assert';
import { runExtensionManifestAudit } from '../scripts/extension-manifest-audit.js';

const results = runExtensionManifestAudit();
const failed = results.filter((r) => !r.ok);
assert.equal(failed.length, 0,
    `extension-manifest audit: ${failed.length} rule(s) failed:\n${
        failed.map((r) => `  ✗ ${r.rule} — ${r.detail}`).join('\n')
    }`);

console.log(
    `OK — extension-manifest audit smoke (${results.length} rules pass: MV3 + CWS-valid version + version↔wallet sync + version_name mirror + extension-pkg sync + description ≤132 + homepage_url + 128 icon + action icon + content-scripts valid + permissions-minimal)`,
);
