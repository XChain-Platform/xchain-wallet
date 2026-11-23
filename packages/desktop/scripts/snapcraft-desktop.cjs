// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

'use strict';

const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const { basename, dirname, join, normalize, sep } = require('node:path');

const INSTALLATIONS = new WeakMap();

/**
 * Copy Core 24 desktop entries to the project-relative path Snapcraft validates.
 * Keep snap/gui intact because Snapcraft 8 copies that directory into the snap.
 */
function mirrorCore24DesktopFiles(computed, stageDirs) {
    const snap = computed?.snap;
    if (snap?.base !== 'core24' || !snap.apps) return;

    const desktopFiles = Object.values(snap.apps)
        .map((app) => app?.desktop)
        .filter(Boolean);
    if (desktopFiles.length === 0) return;

    for (const desktopFile of desktopFiles) {
        const relative = normalize(desktopFile);
        const metaGuiPrefix = `meta${sep}gui${sep}`;
        if (!relative.startsWith(metaGuiPrefix) || basename(relative) !== relative.slice(metaGuiPrefix.length)) {
            throw new Error(`unsupported Core 24 desktop path: ${desktopFile}`);
        }

        let generated = 0;
        for (const stageDir of stageDirs) {
            if (!existsSync(join(stageDir, 'snap', 'snapcraft.yaml'))) continue;
            generated += 1;
            const source = join(stageDir, 'snap', 'gui', basename(relative));
            if (!existsSync(source)) {
                throw new Error(`Core 24 desktop source was not generated at ${source}`);
            }
            const destination = join(stageDir, relative);
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(source, destination);
        }

        if (generated === 0) {
            throw new Error(`Core 24 snapcraft.yaml was not generated in ${stageDirs.join(', ')}`);
        }
    }
}

/**
 * Add the snap stage directory while Linux packaging still exposes its target.
 * Compose with electron-builder's callback so programmatic callers keep their behavior.
 */
function installSnapcraftDesktopCompatibility(context) {
    // Packaging runs that build no snap (AppImage, deb, test harnesses) may pass no target list.
    const snapTarget = (context.targets || []).find((target) => target.name === 'snap');
    if (!snapTarget) return;

    const options = context.packager.packagerOptions;
    let state = INSTALLATIONS.get(options);
    if (!state) {
        state = {
            previous: options.effectiveOptionComputed,
            stageDirs: [],
        };
        INSTALLATIONS.set(options, state);
        options.effectiveOptionComputed = async (computed) => {
            mirrorCore24DesktopFiles(computed, state.stageDirs);
            return state.previous ? Boolean(await state.previous(computed)) : false;
        };
    }

    const stageDir = context.packager.info.stageDirPathCustomizer(
        snapTarget,
        context.packager,
        context.arch,
    );
    if (!state.stageDirs.includes(stageDir)) state.stageDirs.push(stageDir);
}

module.exports = {
    installSnapcraftDesktopCompatibility,
    mirrorCore24DesktopFiles,
};
