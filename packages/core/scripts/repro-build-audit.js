// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §56.3 Pre-launch Step 6: static audit of the desktop reproducible-
// build scaffolding. Asserts that every ingredient required for
// Level-2 reproducibility is in place. The actual run-twice-and-
// compare verification has to happen on a fresh dev machine before
// v1.0.0 GA.
//
// Rules checked:
//   1. Dockerfile pins the base image by sha256 digest (not just tag).
//   2. Dockerfile sets NODE_VERSION explicitly.
//   3. Dockerfile pins TZ + LC_ALL + LANG to deterministic values.
//   4. build.sh asserts SOURCE_DATE_EPOCH is set.
//   5. build.sh uses --frozen-lockfile on pnpm install.
//   6. build.sh emits a SHA256 manifest (RELEASE_HASHES.txt).
//   7. reproduce.sh derives SOURCE_DATE_EPOCH from the commit date.
//   8. reproduce.sh builds from a worktree, so a verifier's local edits are
//      not an input. XCHAIN_REPRODUCE_IN_PLACE=1 is the one exception and it
//      belongs to the release lane alone (rule 12); it re-earns what the
//      worktree gave by refusing a dirty tree and any ref but HEAD.
//   9. electron-builder.config.cjs sets `asar: true` (deterministic packing).
//  10. electron-builder.config.cjs documents SOURCE_DATE_EPOCH usage.
//  11. electron-builder.config.cjs pins AppImage compression + reproducible flags.
//  12. The release lane cuts its Linux artifacts through that same script and
//      therefore that same image, and installs nothing on the runner first.
//      Node was pinned for both sides and the C compiler was not, so the
//      native addon and the asar embedding its hash could never reproduce
// (measured: 186 of 188 files matched). The compile
//      happens during `pnpm install`, not during packaging, which is why a
//      host install in that job is a rule here rather than a style note.
//  13. The reproducible-builds doc documents the verification protocol.
// That doc left this repo in and now lives in the sibling
//      xchain-documentation checkout, published at
//      https://docs.xchain.io/components/wallet/reproducible-builds. When the
//      sibling is absent (an isolated single-repo CI checkout) the three doc
//      rules are OMITTED rather than failed: they guard documentation parity,
//      not shipped build behavior.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = join(here, '..');
const wsRoot = join(corePkg, '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');
const releaseWorkflow = join(wsRoot, '.github', 'workflows', 'release.yml');
// Overridable so a checkout with the sibling somewhere else can still gate.
const docsRoot = process.env.XCHAIN_DOCS_ROOT || join(wsRoot, '..', 'xchain-documentation');
const reproDocPath = join(docsRoot, 'components', 'wallet', 'reproducible-builds.md');

/**
 * @typedef {Object} ReproRuleResult
 * @property {string} rule
 * @property {boolean} ok
 * @property {string} detail
 */

/**
 * @returns {ReproRuleResult[]}
 */
export function runReproBuildAudit() {
    const dockerfile = readIfExists(join(desktop, 'Dockerfile'));
    const buildSh = readIfExists(join(desktop, 'scripts', 'build.sh'));
    const reproSh = readIfExists(join(desktop, 'scripts', 'reproduce.sh'));
    const ebCfg = readIfExists(join(desktop, 'electron-builder.config.cjs'));
    const docs = readIfExists(reproDocPath);

    /** @type {ReproRuleResult[]} */
    const out = [];

    out.push(rule('dockerfile-exists',
        dockerfile !== null,
        'packages/desktop/Dockerfile must exist'));
    out.push(rule('dockerfile-digest-pinned-base',
        dockerfile !== null && /FROM\s+\S+@sha256:[0-9a-f]{64}/.test(dockerfile),
        'Dockerfile must pin its base image by sha256: digest, not just by tag'));
    out.push(rule('dockerfile-pins-node',
        dockerfile !== null && /NODE_VERSION=\d+\.\d+\.\d+/.test(dockerfile),
        'Dockerfile must declare NODE_VERSION explicitly (NODE_VERSION=X.Y.Z)'));
    out.push(rule('dockerfile-pins-locale',
        dockerfile !== null
            && /LC_ALL=C\.UTF-8/.test(dockerfile)
            && /LANG=C\.UTF-8/.test(dockerfile)
            && /TZ=UTC/.test(dockerfile),
        'Dockerfile must pin LC_ALL=C.UTF-8 + LANG=C.UTF-8 + TZ=UTC'));

    out.push(rule('build.sh-exists',
        buildSh !== null,
        'packages/desktop/scripts/build.sh must exist'));
    out.push(rule('build.sh-asserts-source-date-epoch',
        buildSh !== null && /SOURCE_DATE_EPOCH:\?/.test(buildSh),
        'build.sh must assert SOURCE_DATE_EPOCH is set (\`: "\${SOURCE_DATE_EPOCH:?...}"\`)'));
    out.push(rule('build.sh-frozen-lockfile',
        buildSh !== null && /pnpm install --frozen-lockfile/.test(buildSh),
        'build.sh must run pnpm install with --frozen-lockfile'));
    out.push(rule('build.sh-emits-manifest',
        buildSh !== null && /RELEASE_HASHES\.txt/.test(buildSh) && /sha256sum/.test(buildSh),
        'build.sh must emit a sha256 manifest (RELEASE_HASHES.txt)'));

    out.push(rule('reproduce.sh-exists',
        reproSh !== null,
        'packages/desktop/scripts/reproduce.sh must exist'));
    // %at (AUTHOR date), not %ct. This rule pinned %ct, and so did the
    // desktop-packaging smoke, so the two places that could have caught
    // the mismatch were both holding it in place. The release lane injects
    // %at; committer date differs from author date on any rebase or amend
    // (10 of the last 200 commits here), and the two sides then stamp
    // different mtimes into the asar, so the reproduction cannot match and
    // the published protocol reads that as possible tampering.
    out.push(rule('reproduce.sh-derives-source-date-epoch-from-git',
        reproSh !== null && /git log -1 --pretty=%at/.test(reproSh),
        'reproduce.sh must derive SOURCE_DATE_EPOCH from the commit AUTHOR date '
        + '(git log -1 --pretty=%at), the same field .github/workflows/release.yml uses'));
    out.push(rule('reproduce.sh-uses-worktree',
        reproSh !== null && /git worktree (?:add|remove)/.test(reproSh),
        'reproduce.sh must build from a fresh worktree (isolates from local changes)'));

    out.push(rule('electron-builder.cfg-exists',
        ebCfg !== null,
        'packages/desktop/electron-builder.config.cjs must exist'));
    out.push(rule('electron-builder.cfg-asar',
        ebCfg !== null && /\basar:\s*true\b/.test(ebCfg),
        'electron-builder config must enable asar packaging (asar: true)'));
    out.push(rule('electron-builder.cfg-source-date-epoch',
        ebCfg !== null && /SOURCE_DATE_EPOCH/.test(ebCfg),
        'electron-builder config must reference SOURCE_DATE_EPOCH (Reproducible Builds spec)'));
    out.push(rule('electron-builder.cfg-appimage-compression',
        ebCfg !== null && /compression:\s*['"]xz['"]/.test(ebCfg),
        'electron-builder config must pin AppImage compression to a deterministic algorithm'));

    // The lane that CUTS the release, which was the side nothing checked.
    // Comment lines are dropped first: the job documents this rule at
    // length, and a substring search over its own explanation is a green
    // that means nothing.
    const linuxLane = desktopLinuxJob(readIfExists(releaseWorkflow));
    out.push(rule('release-lane-builds-in-container',
        linuxLane !== null && /bash packages\/desktop\/scripts\/reproduce\.sh/.test(linuxLane)
            && /XCHAIN_REPRODUCE_IN_PLACE:\s*'1'/.test(linuxLane),
        'the release workflow\'s desktop-linux job must build through '
        + 'packages/desktop/scripts/reproduce.sh with XCHAIN_REPRODUCE_IN_PLACE=1, so the '
        + 'release and the reproduction share one C toolchain and not merely one Node'));
    out.push(rule('release-lane-installs-only-in-container',
        linuxLane !== null && !/pnpm install/.test(linuxLane),
        'the release workflow\'s desktop-linux job must not run pnpm install on the runner: '
        + 'node-gyp compiles the native addon during INSTALL, so a host install hands the '
        + 'container host-compiled bytes to package and the reproduction fails on exactly '
        + 'the files it failed on before'));

    if (docs !== null) {
        out.push(rule('docs-mentions-level-2',
            /Level-2/i.test(docs),
            'the reproducible-builds doc must reference Level-2 reproducibility (the protocol level we target)'));
        out.push(rule('docs-mentions-release-hashes',
            /RELEASE_HASHES/.test(docs),
            'the reproducible-builds doc must reference the RELEASE_HASHES manifest (the verification anchor)'));
    }

    return out;
}

function rule(name, ok, detail) {
    return { rule: name, ok, detail };
}

/**
 * The `desktop-linux` job of release.yml, comment lines removed.
 *
 * @param {string|null} workflow
 * @returns {string|null} null when the workflow or the job is absent, which
 *   the rules above report as a failure rather than skipping.
 */
function desktopLinuxJob(workflow) {
    if (workflow === null) return null;
    const lines = workflow.split('\n');
    const start = lines.indexOf('  desktop-linux:');
    if (start === -1) return null;
    const out = [];
    for (const line of lines.slice(start + 1)) {
        if (/^ {2}\S/.test(line)) break;
        if (/^\s*#/.test(line)) continue;
        out.push(line);
    }
    return out.join('\n');
}

function readIfExists(path) {
    try {
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
        return null;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const results = runReproBuildAudit();
    let failed = 0;
    for (const r of results) {
        const status = r.ok ? '✓' : '✗';
        console.log(`${status} ${r.rule}`);
        if (!r.ok) {
            console.log(`    ${r.detail}`);
            failed += 1;
        }
    }
    if (failed === 0) {
        console.log(`\nrepro-build-audit: ${results.length} / ${results.length} rules pass.`);
        process.exit(0);
    }
    console.error(`\nrepro-build-audit: ${failed} of ${results.length} rules failed.`);
    process.exit(1);
}
