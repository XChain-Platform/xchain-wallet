// §56.3 Pre-launch Step 6 — static audit of the desktop reproducible-
// build scaffolding. Asserts that every ingredient required for
// Level-2 reproducibility is in place. The actual run-twice-and-
// compare verification has to happen on a fresh dev machine before
// v1.0.0 GA — see claude/reports/specs/2026-04-24_repro-build.md.
//
// Rules checked:
//   1. Dockerfile pins the base image by sha256 digest (not just tag).
//   2. Dockerfile sets NODE_VERSION explicitly.
//   3. Dockerfile pins TZ + LC_ALL + LANG to deterministic values.
//   4. build.sh asserts SOURCE_DATE_EPOCH is set.
//   5. build.sh uses --frozen-lockfile on pnpm install.
//   6. build.sh emits a SHA256 manifest (RELEASE_HASHES.txt).
//   7. reproduce.sh derives SOURCE_DATE_EPOCH from the commit date.
//   8. reproduce.sh uses a worktree (no in-place builds).
//   9. electron-builder.config.cjs sets `asar: true` (deterministic packing).
//  10. electron-builder.config.cjs documents SOURCE_DATE_EPOCH usage.
//  11. electron-builder.config.cjs pins AppImage compression + reproducible flags.
//  12. REPRODUCIBLE_BUILDS.md documents the verification protocol.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = join(here, '..');
const wsRoot = join(corePkg, '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');

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
    const docs = readIfExists(join(desktop, 'REPRODUCIBLE_BUILDS.md'));

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
    out.push(rule('reproduce.sh-derives-source-date-epoch-from-git',
        reproSh !== null && /git log -1 --pretty=%ct/.test(reproSh),
        'reproduce.sh must derive SOURCE_DATE_EPOCH from the commit date (git log -1 --pretty=%ct)'));
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

    out.push(rule('docs-exist',
        docs !== null,
        'packages/desktop/REPRODUCIBLE_BUILDS.md must exist'));
    out.push(rule('docs-mentions-level-2',
        docs !== null && /Level-2/i.test(docs),
        'REPRODUCIBLE_BUILDS.md must reference Level-2 reproducibility (the protocol level we target)'));
    out.push(rule('docs-mentions-release-hashes',
        docs !== null && /RELEASE_HASHES/.test(docs),
        'REPRODUCIBLE_BUILDS.md must reference the RELEASE_HASHES manifest (the verification anchor)'));

    return out;
}

function rule(name, ok, detail) {
    return { rule: name, ok, detail };
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
