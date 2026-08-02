//*********************************************************************
//
// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
//*********************************************************************

// Builds a shimmed copy of electron-builder's AppImage toolset whose
// `mksquashfs` is scripts/mksquashfs-deterministic.cjs, and points
// electron-builder at it via APPIMAGE_TOOLS_PATH ( DD7).
//
// The one interesting design point is WHERE this runs. It is called from
// the `beforePack` hook in electron-builder.config.cjs, which
// app-builder-lib awaits inside `doPack`, and `doPack` completes before
// `packageInDistributableFormat` calls `AppImageTarget.build` - which is
// where `getAppImageTools` reads APPIMAGE_TOOLS_PATH. So the hook is early
// enough, and it is the only seam that is:
//
//   - automatic: no lane, Dockerfile or npm script has to remember a step,
//     and there is nothing to leave out of a NEW lane later;
//   - scoped: it fires only for the linux platform, so the macOS and
//     Windows lanes never touch the network for a toolset they cannot use;
//   - fail-closed: if the toolset cannot be shimmed the build stops here,
//     rather than producing an AppImage that merely looks fine.
//
// The toolset itself is NOT pinned here on purpose. It is downloaded by
// app-builder-lib's own `getAppImageTools`, so it stays exactly the archive
// and sha256 that the installed electron-builder pins (today:
// appimage-12.0.1.7z, d12ff7eb...). Duplicating that pin would create a
// second source of truth that drifts silently on an electron-builder bump.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TAG = '[appimage-toolset]';
const WRAPPER_SOURCE = path.join(__dirname, 'mksquashfs-deterministic.cjs');
const SHIM_SUFFIX = '-xchain-deterministic';
const SOURCE_MARKER = '.xchain-shim-source';

// One materialization per process. `beforePack` fires once per arch, and
// on a `--x64 --arm64` run those can overlap, so hand every caller the same
// promise instead of racing two builders over one directory.
let inFlight = null;

class AppImageToolsetError extends Error {}

function fail(message) {
    throw new AppImageToolsetError(`${TAG} ${message}`);
}

// app-builder-lib is electron-builder's own dependency, not ours. Resolve
// it THROUGH the package we actually declare, so that under pnpm's strict
// layout we are reading the same copy the build is using rather than
// whatever happens to be hoisted.
function loadLinuxToolsets() {
    let modulePath;
    try {
        const electronBuilderDir = path.dirname(require.resolve('electron-builder/package.json'));
        modulePath = require.resolve('app-builder-lib/out/toolsets/linux', {
            paths: [electronBuilderDir],
        });
    } catch {
        try {
            modulePath = require.resolve('app-builder-lib/out/toolsets/linux');
        } catch {
            fail(
                'cannot resolve app-builder-lib/out/toolsets/linux. electron-builder '
                    + 'moved or renamed it; the AppImage cannot be built reproducibly '
                    + 'until this shim is re-pointed. See REPRODUCIBLE_BUILDS.md.',
            );
        }
    }

    const toolsets = require(modulePath);
    if (typeof toolsets.getAppImageTools !== 'function') {
        fail(`${modulePath} no longer exports getAppImageTools`);
    }
    return toolsets;
}

function link(source, destination) {
    try {
        fs.symlinkSync(source, destination);
    } catch {
        // Filesystems without symlinks (or a Windows host building linux
        // targets) still get a working tree, just a fatter one.
        fs.cpSync(source, destination, { recursive: true });
    }
}

// Install the wrapper with the shebang pointing at THIS node, rather than
// at `/usr/bin/env node`. electron-builder spawns mksquashfs directly, so
// the kernel resolves the shebang, and the build environment is not
// obliged to have a `node` on PATH just because it is running one.
function installWrapper(destination) {
    const source = fs.readFileSync(WRAPPER_SOURCE, 'utf8');
    const newline = source.indexOf('\n');
    if (!source.startsWith('#!') || newline === -1) {
        fail(`${WRAPPER_SOURCE} does not start with a shebang line`);
    }
    fs.writeFileSync(destination, `#!${process.execPath}${source.slice(newline)}`, { mode: 0o755 });
    fs.chmodSync(destination, 0o755);
}

async function materialize(arch, log) {
    const { getAppImageTools } = loadLinuxToolsets();

    // An APPIMAGE_TOOLS_PATH the operator set is a legitimate SOURCE
    // toolset and gets shimmed like a downloaded one. A path WE produced
    // is different: shimming it would stack a wrapper on a wrapper, and
    // every layer would re-run the one below it. Each shim records the
    // toolset it was built from, so that case resolves back to the
    // original rather than throwing the pointer away and re-downloading.
    const previous = process.env.APPIMAGE_TOOLS_PATH;
    const isOurs = typeof previous === 'string' && previous.endsWith(SHIM_SUFFIX);
    if (isOurs) {
        const marker = path.join(previous, SOURCE_MARKER);
        if (!fs.existsSync(marker)) {
            fail(`${previous} looks like one of our shims but has no ${SOURCE_MARKER}`);
        }
        process.env.APPIMAGE_TOOLS_PATH = fs.readFileSync(marker, 'utf8').trim();
    }
    let tools;
    try {
        // `null` selects the legacy FUSE2 toolset, which is what this config
        // builds with (it sets no `toolsets.appimage`). If that ever changes,
        // the layout changes with it and the assertions below will say so.
        tools = await getAppImageTools(null, arch);
    } finally {
        if (isOurs) {
            process.env.APPIMAGE_TOOLS_PATH = previous;
        }
    }

    const realRoot = path.dirname(tools.runtime);
    if (!fs.existsSync(path.join(realRoot, path.basename(tools.mksquashfs)))
        && !fs.existsSync(tools.mksquashfs)) {
        fail(`resolved toolset at ${realRoot} has no mksquashfs`);
    }

    const shimRoot = path.join(
        path.dirname(realRoot),
        `${path.basename(realRoot)}${SHIM_SUFFIX}`,
    );
    fs.rmSync(shimRoot, { recursive: true, force: true });
    fs.mkdirSync(shimRoot, { recursive: true });

    // Shim every directory that directly holds an mksquashfs, rather than
    // recomputing app-builder-lib's host-arch -> subdirectory rule here.
    // That rule is theirs to change; "the directory with the binary in it"
    // is a property of the tree we can see.
    let shimmed = 0;
    for (const entry of fs.readdirSync(realRoot, { withFileTypes: true })) {
        const source = path.join(realRoot, entry.name);
        const destination = path.join(shimRoot, entry.name);
        const holdsTool = entry.isDirectory() && fs.existsSync(path.join(source, 'mksquashfs'));
        if (!holdsTool) {
            link(source, destination);
            continue;
        }
        fs.mkdirSync(destination);
        for (const tool of fs.readdirSync(source)) {
            link(path.join(source, tool), path.join(destination, tool === 'mksquashfs' ? 'mksquashfs.real' : tool));
        }
        installWrapper(path.join(destination, 'mksquashfs'));
        shimmed += 1;
    }

    if (shimmed === 0) {
        fail(
            `no mksquashfs found in any subdirectory of ${realRoot}. The AppImage `
                + 'toolset layout changed; re-point this shim before releasing.',
        );
    }

    fs.writeFileSync(path.join(shimRoot, SOURCE_MARKER), `${realRoot}\n`);

    log(`${TAG} deterministic mksquashfs installed for ${shimmed} host arch(es): ${shimRoot}`);
    return shimRoot;
}

/**
 * Point electron-builder at a toolset whose mksquashfs pins the squashfs
 * `mkfs_time` to SOURCE_DATE_EPOCH. Idempotent; safe to call per arch.
 *
 * @param {number} arch app-builder-lib Arch enum value for the target
 * @param {(message: string) => void} [log]
 * @returns {Promise<string>} the shimmed toolset directory
 */
function prepareDeterministicAppImageToolset(arch, log = (m) => process.stdout.write(`${m}\n`)) {
    if (inFlight === null) {
        inFlight = materialize(arch, log).then((shimRoot) => {
            process.env.APPIMAGE_TOOLS_PATH = shimRoot;
            return shimRoot;
        });
    }
    return inFlight;
}

module.exports = { prepareDeterministicAppImageToolset, AppImageToolsetError };
