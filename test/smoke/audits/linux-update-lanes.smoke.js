// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §5: which Linux formats auto-update, and which updater
// a Linux build actually gets.
//
// WHAT WENT WRONG, AND WHY A TEST IS THE RIGHT ANSWER. The claim "the .deb
// does not self-update; electron-updater's deb path needs privilege
// escalation" was written once from memory and then repeated in four
// places: this repo's rehearsal matrix, the electron-builder config's
// staging target set, the spec, and the public download page - where it
// told users, in a wallet, that installing the .deb means they are not
// being patched automatically.
//
// It is false, and it is checkable from the installed package. At the
// pinned electron-updater 6.8.9 `DebUpdater` is a complete updater: it
// picks the `.deb` out of the channel pointer, downloads it, and installs
// it with `dpkg -i` under `pkexec`. The escalation is not a missing
// feature, it IS the install step. Verified against a real two-arch
// packaged build (2026-08-02): both `stable-linux.yml` and
// `stable-linux-arm64.yml` list the `.deb`, and the `.deb` ships
// `resources/package-type` containing `deb`, which is precisely what makes
// upstream select that class.
//
// So the effect of the belief was that the ONE update path ending in a
// root-privileged install was the one path excluded from the staging
// rehearsal - the staging build emitted no `.deb` for a staging feed to
// serve - and the one path users were told did not exist.
//
// Coverage:
//
//   1. LINUX_FORMAT_UPDATE_SUPPORT matches the classes electron-updater
//      actually exports. A format that gains or loses an updater upstream
//      fails here rather than silently changing what users get.
//   2. Every shipped Linux format that HAS an updater is a rehearsal lane,
//      on every shipped arch.
//   3. The staging target set covers every lane format, so every lane is
//      rehearsable at all.
//   4. `selectUpdater` never lets an AppImage be driven by a package
//      manager's updater, whatever `package-type` inside it claims.
//   5. The mksquashfs wrapper strips the deb lane's leftovers out of the
//      AppImage stage tree, so the claim in (4) is also true of the bytes
//      we ship and not only of the runtime guard.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
    chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    LANES, LINUX_FORMAT_UPDATE_SUPPORT,
} from '../../../tools/release/rehearsal-matrix.mjs';
import { selectUpdater, readPackageType } from '../../../packages/desktop/main/updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const require = createRequire(import.meta.url);
const CONFIG = join(root, 'packages/desktop/electron-builder.config.cjs');

const SHIPPED_ARCHES = ['x64', 'arm64'];

// ------------------------------------------------ 1. upstream agreement

{
    // Resolved through packages/desktop, which is what actually depends on
    // it, rather than through the workspace root.
    const desktopRequire = createRequire(join(root, 'packages/desktop/package.json'));
    const updaterModule = desktopRequire('electron-updater');

    for (const [format, row] of Object.entries(LINUX_FORMAT_UPDATE_SUPPORT)) {
        assert.equal(typeof updaterModule[row.updater], 'function',
            `LINUX_FORMAT_UPDATE_SUPPORT says .${format} updates via ${row.updater}, but the `
            + 'installed electron-updater exports no such class. Either upstream dropped it '
            + '(and that format now strands its installs) or the table is wrong.');
    }

    // The other direction: an upstream that GAINS a Linux updater must not
    // pass unnoticed, because "we ship this format and it silently never
    // updates" is the failure this whole file exists about. Every exported
    // `*Updater` that is neither Windows nor macOS must be accounted for.
    const NON_LINUX = new Set(['NsisUpdater', 'MacUpdater', 'AppUpdater', 'BaseUpdater']);
    const accountedFor = new Set(Object.values(LINUX_FORMAT_UPDATE_SUPPORT).map((r) => r.updater));
    const exported = Object.keys(updaterModule)
        // Classes only: `autoUpdater` is the platform-picked singleton, not
        // a format's updater.
        .filter((k) => /^[A-Z]\w*Updater$/.test(k) && !NON_LINUX.has(k));
    for (const cls of exported) {
        assert.ok(accountedFor.has(cls),
            `electron-updater exports ${cls}, which LINUX_FORMAT_UPDATE_SUPPORT does not `
            + 'mention. If it covers a format we ship, that format is an unrehearsed update '
            + 'path; add a row (and a lane) rather than leaving it undeclared.');
    }
}

// ------------------------------------------------------- 2. every lane

{
    const shippedWithUpdater = Object.entries(LINUX_FORMAT_UPDATE_SUPPORT)
        .filter(([, row]) => row.shipped)
        .map(([format]) => format);

    for (const format of shippedWithUpdater) {
        for (const arch of SHIPPED_ARCHES) {
            const lane = LANES.find(
                (l) => l.os === 'linux' && l.arch === arch && l.format === format,
            );
            assert.ok(lane,
                `no rehearsal lane for linux ${arch} .${format}. It is a shipped format with `
                + `an updater (${LINUX_FORMAT_UPDATE_SUPPORT[format].updater}), so its update `
                + 'is a thing that happens to users whether or not we rehearse it.');
        }
    }

    // Lane ids stay unique: records are keyed by them, and two lanes
    // sharing an id would let one lane's rehearsal count as the other's.
    const ids = LANES.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, 'lane ids are unique');
}

// ------------------------------------------- 3. the staging set covers them

{
    const saved = process.env.XCHAIN_STAGING_FEED_URL;
    process.env.XCHAIN_STAGING_FEED_URL
        = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';
    let cfg;
    try {
        delete require.cache[require.resolve(CONFIG)];
        cfg = require(CONFIG);
    } finally {
        if (saved === undefined) delete process.env.XCHAIN_STAGING_FEED_URL;
        else process.env.XCHAIN_STAGING_FEED_URL = saved;
        delete require.cache[require.resolve(CONFIG)];
    }

    const staged = cfg.linux.target.map((t) => (typeof t === 'string' ? t : t.target));
    for (const lane of LANES.filter((l) => l.os === 'linux')) {
        assert.ok(staged.includes(lane.format),
            `lane ${lane.id} rehearses .${lane.format}, but a staging build emits `
            + `[${staged.join(', ')}]. A lane whose format is never built for the staging `
            + 'feed cannot be rehearsed at all - which is exactly how the deb path stayed '
            + 'unexercised while shipping.');
    }

    for (const t of cfg.linux.target) {
        assert.deepEqual([...t.arch].sort(), ['arm64', 'x64'],
            `staging builds .${t.target} for both shipped arches`);
    }
}

// ------------------------------- 4. an AppImage is never driven by DebUpdater

{
    class FakeAppImageUpdater { checkForUpdates() { return null; } }
    const singleton = { checkForUpdates() { return null; }, tag: 'singleton' };
    const mod = { autoUpdater: singleton, AppImageUpdater: FakeAppImageUpdater };

    const withPackageType = (value) => ({
        resourcesPath: '/fake/resources',
        readFile: () => {
            if (value === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return value;
        },
    });

    // Off Linux nothing is second-guessed: Windows and macOS select by
    // platform, and there is no package-type file in play.
    for (const platform of ['win32', 'darwin']) {
        const picked = selectUpdater(mod, {
            platform, env: { APPIMAGE: '/tmp/x.AppImage' }, ...withPackageType('deb'),
        });
        assert.equal(picked.updater, singleton, `${platform} takes the module singleton`);
        assert.equal(picked.mislabelledAs, null);
    }

    // The defect this exists for: an AppImage that captured the deb lane's
    // `package-type`. Upstream would hand it DebUpdater, which downloads
    // the `.deb` listed in the same pointer and installs it as root.
    const corrected = selectUpdater(mod, {
        platform: 'linux', env: { APPIMAGE: '/tmp/XChain Wallet.AppImage' },
        ...withPackageType('deb'),
    });
    assert.ok(corrected.updater instanceof FakeAppImageUpdater,
        'a running AppImage gets the AppImage updater even when the bundle says "deb"');
    assert.equal(corrected.mislabelledAs, 'deb',
        'and the mislabelling is reported rather than silently repaired');

    // Trailing newline is how the file is actually written.
    assert.equal(
        selectUpdater(mod, {
            platform: 'linux', env: { APPIMAGE: '/tmp/a.AppImage' },
            ...withPackageType('deb\n'),
        }).mislabelledAs,
        'deb',
        'the file is read trimmed, as electron-updater reads it');

    // A healthy AppImage: no package-type, so nothing to correct.
    const healthy = selectUpdater(mod, {
        platform: 'linux', env: { APPIMAGE: '/tmp/a.AppImage' }, ...withPackageType(null),
    });
    assert.equal(healthy.updater, singleton, 'an AppImage with no package-type is untouched');
    assert.equal(healthy.mislabelledAs, null);

    // A deb install. APPIMAGE is unset, so upstream's own reading is right
    // and must NOT be overridden - overriding it here would strand every
    // deb install on its installed version.
    const deb = selectUpdater(mod, {
        platform: 'linux', env: {}, ...withPackageType('deb'),
    });
    assert.equal(deb.updater, singleton, 'a deb install keeps electron-updater\'s own choice');
    assert.equal(deb.mislabelledAs, null);

    // Fail closed if the correction is impossible: no updater at all beats
    // a root-privileged install of an artifact this build does not use.
    const noClass = selectUpdater({ autoUpdater: singleton }, {
        platform: 'linux', env: { APPIMAGE: '/tmp/a.AppImage' }, ...withPackageType('deb'),
    });
    assert.equal(noClass.updater, null,
        'with no AppImageUpdater export, a mislabelled AppImage gets no updater at all');
    assert.equal(noClass.mislabelledAs, 'deb');

    // readPackageType's own unhappy paths.
    assert.equal(readPackageType({ resourcesPath: '', readFile: () => 'deb' }), null,
        'no resourcesPath (running from source) reads nothing');
    assert.equal(readPackageType({ resourcesPath: '/x', readFile: () => '   ' }), null,
        'a blank file is not a package type');
}

// ------------------- 5. the shipped AppImage cannot carry package-type

{
    const wrapper = join(root, 'packages/desktop/scripts/mksquashfs-deterministic.cjs');
    assert.ok(existsSync(wrapper), 'the mksquashfs wrapper is where the config expects it');

    const tmp = mkdtempSync(join(tmpdir(), 'xchain-lanes-'));
    try {
        // A fake toolset: the wrapper runs `mksquashfs.real` from beside
        // itself, so the drill needs a copy of the wrapper next to a stub.
        const toolDir = join(tmp, 'tools');
        mkdirSync(toolDir, { recursive: true });
        writeFileSync(join(toolDir, 'mksquashfs-deterministic.cjs'), readFileSync(wrapper));
        // The stub records the tree it was asked to pack, then writes a
        // minimal valid v4.0 superblock so the wrapper's clock-two patch
        // has something well-formed to work on.
        writeFileSync(join(toolDir, 'mksquashfs.real'), [
            '#!/usr/bin/env node',
            'const fs = require("node:fs");',
            'const path = require("node:path");',
            'const [src, out] = process.argv.slice(2);',
            'const seen = [];',
            '(function walk(d, rel) {',
            '  for (const e of fs.readdirSync(d)) {',
            '    const full = path.join(d, e);',
            '    if (fs.statSync(full).isDirectory()) walk(full, rel + e + "/");',
            '    else seen.push(rel + e);',
            '  }',
            '})(src, "");',
            'fs.writeFileSync(path.join(path.dirname(out), "packed.json"), JSON.stringify(seen));',
            'const sb = Buffer.alloc(96);',
            'sb.writeUInt32LE(0x73717368, 0);',
            'sb.writeUInt32LE(Math.floor(Date.now() / 1000), 8);',
            'sb.writeUInt32LE(131072, 12);',
            'sb.writeUInt16LE(17, 22);',
            'sb.writeUInt16LE(4, 28);',
            'sb.writeUInt16LE(0, 30);',
            'fs.writeFileSync(out, sb);',
        ].join('\n'));
        chmodSync(join(toolDir, 'mksquashfs.real'), 0o755);

        // A stage tree shaped like the one AppImageTarget hands over,
        // holding exactly what the deb lane writes into the shared
        // unpacked directory while the AppImage is being assembled.
        const stage = join(tmp, 'stage');
        mkdirSync(join(stage, 'resources'), { recursive: true });
        writeFileSync(join(stage, 'resources', 'app.asar'), 'not really an asar');
        writeFileSync(join(stage, 'resources', 'app-update.yml'), 'channel: stable\n');
        writeFileSync(join(stage, 'resources', 'package-type'), 'deb');
        writeFileSync(join(stage, 'resources', 'apparmor-profile'), 'abi <abi/4.0>,\n');

        const out = join(tmp, 'out.squashfs');
        const run = spawnSync(process.execPath,
            [join(toolDir, 'mksquashfs-deterministic.cjs'), stage, out, '-offset', '0'],
            { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' } });
        assert.equal(run.status, 0, `wrapper failed: ${run.stderr}`);

        const packed = JSON.parse(readFileSync(join(tmp, 'packed.json'), 'utf8'));
        assert.ok(packed.includes('resources/app.asar'), 'the app itself is still packed');
        assert.ok(packed.includes('resources/app-update.yml'),
            'and so is the feed pointer the AppImage updater reads');
        assert.ok(!packed.includes('resources/package-type'),
            'package-type NEVER reaches the image: it would hand every AppImage install to '
            + 'DebUpdater, which installs the .deb from the same pointer as root');
        assert.ok(!packed.includes('resources/apparmor-profile'),
            'nor does the deb lane\'s apparmor profile, whose presence is decided by the same '
            + 'race and would make the AppImage non-reproducible');
        assert.match(run.stderr, /removed package-type/,
            'and it says so, because a silent removal is how the inverse defect survived');

        // A stage tree that never had them is untouched and still succeeds.
        const clean = join(tmp, 'clean');
        mkdirSync(join(clean, 'resources'), { recursive: true });
        writeFileSync(join(clean, 'resources', 'app.asar'), 'not really an asar');
        const cleanOut = join(tmp, 'clean.squashfs');
        const cleanRun = spawnSync(process.execPath,
            [join(toolDir, 'mksquashfs-deterministic.cjs'), clean, cleanOut, '-offset', '0'],
            { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' } });
        assert.equal(cleanRun.status, 0, `wrapper failed on a clean tree: ${cleanRun.stderr}`);
        assert.ok(!/removed /.test(cleanRun.stderr), 'nothing is reported when nothing was there');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// ------------------------------------ 6. the deb swap drill's own guards

{
    // The drill (tools/release/drills/deb-update-swap.mjs) installs and then
    // UPGRADES a system package. It is the only thing in this repo that
    // does, so its refusals are load-bearing: run on a workstation by
    // mistake, it would install the wallet system-wide. Both refusals are
    // driven here rather than described.
    const drill = join(root, 'tools/release/drills/deb-update-swap.mjs');
    assert.ok(existsSync(drill), 'the deb-swap drill is where the docs say');

    const noArgs = spawnSync(process.execPath, [drill], { encoding: 'utf8' });
    assert.equal(noArgs.status, 1, 'no artifact directory is a refusal');
    assert.match(noArgs.stderr, /usage:/);

    // Off Linux, or outside a container without the explicit opt-in, it
    // must refuse before it touches dpkg. On a Linux CI runner the
    // container check answers first; on a developer Mac, the platform one.
    const runAnyway = spawnSync(process.execPath, [drill, tmpdir()], {
        encoding: 'utf8',
        env: { ...process.env, XCHAIN_DRILL_DISPOSABLE: '' },
    });
    assert.equal(runAnyway.status, 1, 'a real run outside a disposable host is refused');
    // The property that matters is that it stopped BEFORE dpkg, whichever
    // guard answered first (platform, container, or the artifact check -
    // which one fires depends on where this suite is running).
    assert.ok(!runAnyway.stdout.includes('installing the starting version'),
        'the drill must never reach dpkg on a host it was not pointed at deliberately');
}

console.log('linux-update-lanes smoke: ok');
