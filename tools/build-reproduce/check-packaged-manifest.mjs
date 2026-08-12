// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// check-packaged-manifest.mjs - the reproducible build's packaged manifest
// covers every shipped Linux artifact, on every shipped architecture.
//
// WHY THIS IS A FILE RATHER THAN A grep IN build.sh (DD7).
//
// The manifest this checks is what a third party compares against the
// official release. A SHORT one is worse than none: `sha256sum -c` over
// three of four artifacts exits 0, and the verifier reads that as proof.
//
// The check itself is where the subtlety is, and a grep gets it wrong.
// electron-builder omits the arch token from the DEFAULT arch when the
// artifactName is not user-forced, which for the AppImage target it is
// not - so the x64 build is `xchain-wallet-<v>.AppImage`, with nothing in
// the name to match on. A pattern loose enough to match it also matches
// `xchain-wallet-<v>-arm64.AppImage`, so a build that produced only the
// arm64 artifact would satisfy an "is there an x64 AppImage?" grep. That
// is the same defect class the release gate hit from the other side
// (tools/release/lib.sh: xr_artifact_arch), so it is answered the same
// way: attribute each artifact to exactly one arch, then check coverage.
//
// Usage:  node check-packaged-manifest.mjs <manifest> [<arch>...]
//         arches default to tools/release/toolchain.json linuxArches.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The formats a Linux release ships. Extend with the release, not after. */
export const LINUX_FORMATS = ['AppImage', 'deb'];

/**
 * Attribute one artifact basename to an architecture, or to null.
 *
 * Mirrors `xr_artifact_arch` in tools/release/lib.sh, including the one
 * inference: an AppImage with no arch token is the default arch. Tokens
 * are electron-builder's own (`builder-util getArtifactArchName`): x64
 * becomes `amd64` for deb and `x86_64` for AppImage, and the arches we do
 * not ship are recognised by name so they cannot pass as x64.
 */
export function archOf(name) {
    if (/arm64|aarch64/.test(name)) return 'arm64';
    if (/armv7l|armhf/.test(name)) return 'armv7l';
    if (/i386|i686|ia32/.test(name)) return 'ia32';
    if (/x86_64|amd64|[-_]x64/.test(name)) return 'x64';
    if (name.endsWith('.AppImage')) return 'x64';
    return null;
}

/** Parse a `sha256sum`-style manifest into [{ hash, name }]. */
export function parseManifest(text) {
    return text.split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => {
            const m = /^([0-9a-f]{64})\s+\*?\.?\/?(.+)$/.exec(l.trim());
            if (!m) throw new Error(`unparseable manifest line: ${l}`);
            return { hash: m[1], name: m[2].replace(/^\.\//, '') };
        });
}

/**
 * @returns {string[]} problems, empty when the manifest covers everything.
 */
export function checkCoverage(entries, arches) {
    const problems = [];
    const artifacts = entries.filter((e) => LINUX_FORMATS.some((f) => e.name.endsWith(`.${f}`)));

    if (artifacts.length === 0) {
        problems.push('the manifest names no packaged Linux artifact at all.'
            + ' A --dir build emits none, which is what this check exists to catch.');
        return problems;
    }

    for (const format of LINUX_FORMATS) {
        const ofFormat = artifacts.filter((a) => a.name.endsWith(`.${format}`));
        const seen = new Map();
        for (const a of ofFormat) {
            const arch = archOf(a.name);
            if (arch === null) {
                problems.push(`'${a.name}' carries no architecture token, so nothing`
                    + ' can say which fleet it is for.');
                continue;
            }
            if (!arches.includes(arch)) {
                problems.push(`'${a.name}' is a ${arch} artifact, but this build ships`
                    + ` only: ${arches.join(', ')}`);
                continue;
            }
            if (seen.has(arch)) {
                problems.push(`two ${format} artifacts claim ${arch}:`
                    + ` '${seen.get(arch)}' and '${a.name}'. One of them is misnamed,`
                    + ' and a verifier cannot tell which.');
                continue;
            }
            seen.set(arch, a.name);
        }
        for (const arch of arches) {
            if (!seen.has(arch)) {
                problems.push(`no ${format} artifact for ${arch}.`
                    + ' A manifest missing an arch verifies CLEAN against the'
                    + " artifacts it does list, so the verifier's check passes"
                    + ' while covering half the release.');
            }
        }
    }
    return problems;
}

// --- CLI ---------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const [manifestPath, ...archArgs] = process.argv.slice(2);
    if (!manifestPath) {
        console.error('usage: check-packaged-manifest.mjs <manifest> [<arch>...]');
        process.exit(2);
    }
    let arches = archArgs;
    if (arches.length === 0) {
        const tc = JSON.parse(readFileSync(
            join(here, '..', 'release', 'toolchain.json'), 'utf8',
        ));
        arches = tc.linuxArches;
    }

    const entries = parseManifest(readFileSync(manifestPath, 'utf8'));
    const problems = checkCoverage(entries, arches);
    if (problems.length > 0) {
        console.error('packaged-manifest coverage FAILED:');
        for (const p of problems) console.error(`  - ${p}`);
        console.error('');
        console.error('This manifest is what a third party compares against the');
        console.error('official release. Publishing a short one is worse than');
        console.error('publishing none, because it verifies clean.');
        process.exit(1);
    }
    console.log(`OK - packaged manifest covers ${LINUX_FORMATS.join(' + ')}`
        + ` for ${arches.join(', ')}`);
}
