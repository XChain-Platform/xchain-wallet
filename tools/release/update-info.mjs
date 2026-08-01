// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/update-info.mjs - what is a channel pointer, and what did
// this build actually emit? ( §7.1, stage 1.)
//
// WHY THIS EXISTS. electron-builder names its update-info files after the
// CHANNEL, not after the word "latest". `packages/desktop` sets
// `channel: 'stable'`, so a real build emits `stable-mac.yml`, and the
// release tooling that went looking for `latest*.yml` found nothing at
// all. That failure is silent in both directions: nothing errors, the
// pointer never reaches the feed, and every installed wallet quietly
// stops being offered updates forever. So the tooling stopped guessing
// names. It asks a build what it emitted.
//
// NAME-GLOBBING IS NOT ENOUGH, AND A REAL BUILD PROVED IT. A macOS lane
// run on 2026-07-31 emitted `stable-mac.yml` next to `builder-debug.yml`
// in the same `dist/` root. Both end in `.yml`; only one is a channel
// pointer. A `*.yml` glob would have uploaded electron-builder's debug
// dump to the public feed and, worse, counted it as the pointer. So the
// test below is on CONTENT: an electron-updater update-info file is the
// one carrying `version:`, `path:` and `sha512:` at column 0. That is
// the shape electron-updater itself parses, and it is channel-agnostic,
// so renaming the channel or adding `beta` never has to touch this file.
//
// THE NAMING RULE, for reference only - never for deciding (that is what
// `classify` is for). From app-builder-lib@25.1.8
// `out/publish/updateInfoBuilder.js`, `getUpdateInfoFileName()`:
//
//     <channel><osSuffix><archSuffix>.yml
//     osSuffix   : ''  on Windows, '-mac' on macOS, '-linux' on Linux
//     archSuffix : '' unless LINUX and not x64;
//                  armv7l -> '-arm', everything else -> '-<arch>'
//
// So at channel `stable`, the shipped §2 matrix is FOUR pointers, not
// three: `stable.yml` (Windows, both arches in one file), `stable-mac.yml`
// (macOS, both arches in one file), `stable-linux.yml` (x64) and
// `stable-linux-arm64.yml` (arm64). Note the armv7l form is
// `stable-linux-arm.yml`, NOT `-armv7l`; if the DD1 lane is ever picked
// up, that is the name.
//
// Re-verify that rule on every electron-builder major bump: it lives in
// upstream's source, not in ours. `pnpm test:smoke` pins it against the
// installed app-builder-lib so the bump fails loudly instead of shipping
// a feed whose pointers nothing fetches.

import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, basename, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

/** Files the release tooling owns, which are never build artifacts. */
const MANIFEST_FILES = new Set(['RELEASE_HASHES.txt', 'RELEASE_HASHES.txt.asc']);

/**
 * Build byproducts electron-builder drops in `dist/` that are neither
 * artifacts nor pointers. Listed so `classify` can call them out by name
 * instead of lumping them in with real output and making a reader guess.
 */
const BUILD_BYPRODUCTS = [
    /^builder-debug\.yml$/,
    /^builder-effective-config\.yaml$/,
];

/**
 * True if these bytes are an electron-updater update-info file.
 *
 * Content, not name: see the header. All three keys must appear at
 * column 0, which is where electron-builder writes the top-level mapping
 * and where a nested key never appears.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isUpdateInfoContent(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    return /^version:/m.test(text)
        && /^path:/m.test(text)
        && /^sha512:/m.test(text);
}

/**
 * Classify every top-level file in a build or staging directory.
 *
 * @param {string} dir
 * @returns {{pointers: string[], artifacts: string[], byproducts: string[], manifest: string[]}}
 */
export function classify(dir) {
    const out = { pointers: [], artifacts: [], byproducts: [], manifest: [] };

    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (!statSync(full).isFile()) continue;

        if (MANIFEST_FILES.has(name)) { out.manifest.push(name); continue; }
        if (BUILD_BYPRODUCTS.some((re) => re.test(name))) {
            out.byproducts.push(name);
            continue;
        }
        // Only `.yml` files are candidates, and only then on content.
        // Reading every artifact in the directory to sniff it would mean
        // slurping a 140 MB dmg to learn it is not YAML.
        if (name.endsWith('.yml') && isUpdateInfoContent(readFileSync(full, 'utf8'))) {
            out.pointers.push(name);
            continue;
        }
        out.artifacts.push(name);
    }
    return out;
}

/**
 * The channel a pointer filename belongs to.
 *
 * From the naming rule in this file's header: `<channel><osSuffix><archSuffix>.yml`,
 * where every suffix begins with `-`. So the channel is the stem up to the
 * first `-`, and `stable.yml`, `stable-mac.yml` and `stable-linux-arm64.yml`
 * all answer `stable`.
 *
 * WHY THIS IS WORTH A FUNCTION. It is what tells a PROD publish from a
 * REHEARSAL one (§7.5). Both build the same version from the same commit,
 * so electron-builder names their installers identically - byte-different
 * twins under one name - and the ONLY thing in either directory that says
 * which feed the bytes were built for is the channel stem on the pointer.
 * Publishing a rehearsal build to the live feed is therefore not a typo
 * anyone would catch by looking: the file listing is identical.
 *
 * The one assumption, stated because it is invisible otherwise: a channel
 * name may not contain `-`. Ours are `stable` and `staging`. A future
 * `beta-2` would silently read as channel `beta`, so name channels
 * without dashes or revisit this.
 *
 * @param {string} filename
 * @returns {string}
 */
export function pointerChannel(filename) {
    return basename(filename).replace(/\.yml$/, '').split('-')[0];
}

/**
 * The pointer filename a given channel/OS/arch resolves to.
 *
 * The rule is in this file's header, read out of app-builder-lib's
 * `getUpdateInfoFileName()`. It lived there as prose only, which is one
 * transcription error away from being wrong in a way nothing catches: a
 * pointer name that no client fetches produces no error anywhere, it
 * produces a fleet that is never offered an update.
 *
 * `os` is the electron/node platform ('win32' | 'darwin' | 'linux'), and
 * `arch` a `process.arch` value. Arch only affects the name on Linux,
 * where each arch gets its own file; Windows and macOS put every arch in
 * one pointer, which is why `selectFileForArch` (rehearse.mjs) exists.
 *
 * @param {{channel: string, os: string, arch?: string}} lane
 * @returns {string}
 */
export function pointerNameFor({ channel, os, arch = 'x64' }) {
    if (!channel) throw new Error('pointerNameFor: channel is required');
    if (os === 'win32') return `${channel}.yml`;
    if (os === 'darwin') return `${channel}-mac.yml`;
    if (os !== 'linux') throw new Error(`pointerNameFor: unknown os "${os}"`);
    // armv7l is special-cased upstream to `-arm`, NOT `-armv7l`. If the
    // DD1 lane is ever picked up, this line is why its pointer resolves.
    if (arch === 'x64') return `${channel}-linux.yml`;
    const suffix = arch === 'armv7l' ? 'arm' : arch;
    return `${channel}-linux-${suffix}.yml`;
}

/**
 * Read the `app-update.yml` electron-builder baked into a packaged app.
 *
 * This is the file the SHIPPED binary reads to decide which feed and
 * which channel it talks to, so it is the only copy worth asserting on:
 * the config could say one thing and the bundle carry another (a stale
 * `dist/` from a previous config, most obviously).
 *
 * @param {string} dir  a `dist/` directory to search
 * @returns {Array<{path: string, config: Record<string,string>}>}
 */
export function readBundledFeedConfigs(dir) {
    const found = [];

    const walk = (current, depth) => {
        // The bundled copy sits at a known-ish depth
        // (`dist/mac-arm64/XChain Wallet.app/Contents/Resources/`,
        // `dist/win-unpacked/resources/`), so the walk is bounded rather
        // than descending into every node_modules in an unpacked app.
        if (depth > 6) return;
        let entries;
        try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) { walk(full, depth + 1); continue; }
            if (entry.name !== 'app-update.yml') continue;
            found.push({ path: full, config: parseFlatYaml(readFileSync(full, 'utf8')) });
        }
    };

    if (existsSync(dir)) walk(dir, 0);
    return found;
}

/**
 * Read the feed URL + channel out of the electron-builder config.
 *
 * The workflow that runs `assert-feed` deliberately does NOT name the
 * feed URL. A repo-wide guard (test/smoke/audits/release-ci.smoke.js)
 * refuses any executable line in release.yml mentioning
 * downloads.xchain.io, because a release workflow that can name the feed
 * is one edit away from uploading to it, and "humans push the final
 * button in v1" is the whole posture. So the expected values come from
 * the config, and update-info.smoke.js pins the config to the real URL
 * and channel. Together those two say what one hardcoded CI argument
 * would have said, without putting the feed inside the release workflow.
 *
 * @param {string} configPath
 * @returns {{url: string, channel: string}}
 */
export function readPublishConfig(configPath) {
    // EVALUATED, not pattern-matched. The config picks its feed and channel
    // at build time (prod by default, staging when XCHAIN_STAGING_FEED_URL
    // is set, §7.5), so a regex over the source would have to guess which
    // branch a given build took, and would silently report the prod feed
    // for a staging build. Evaluating under the SAME environment the build
    // used gives the answer the build actually reached.
    //
    // What this comparison catches is a STALE artifact directory: a `dist`
    // left over from an earlier config. What it deliberately does not catch
    // is a wrong literal in the config itself, since both sides would come
    // from it. That half is pinned separately, against hardcoded expected
    // values, in test/smoke/audits/desktop-build-config.smoke.js.
    // Resolved against the CWD, not against this module: callers pass the
    // path they typed on the command line. `require.resolve` alone would
    // look next to update-info.mjs and fail on every relative path.
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(resolvePath(configPath));
    delete require.cache[resolved];
    const config = require(resolved);
    delete require.cache[resolved];

    const publish = Array.isArray(config.publish) ? config.publish[0] : config.publish;
    if (!publish || !publish.url || !publish.channel) {
        throw new Error(`${configPath}: no publish url/channel found`);
    }
    return { url: publish.url, channel: publish.channel };
}

/**
 * Parse the flat `key: value` mapping electron-builder writes into
 * `app-update.yml`. Deliberately not a YAML parser: the file has no
 * nesting, and a dependency here would be a dependency in the release
 * path. Quotes are stripped because electron-builder quotes values that
 * begin with `@`.
 *
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseFlatYaml(text) {
    const out = {};
    for (const line of text.split('\n')) {
        const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
        if (!m) continue;
        out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return out;
}

// ------------------------------------------------------------------ CLI

const USAGE = `usage: update-info.mjs <command> [args]

  classify <dir>
      Print what a build or staging directory actually holds, split into
      channel pointers, artifacts, manifest files and build byproducts.
      Exits 0 always; this reports, it does not judge.

  pointers <dir>
      Print only the channel-pointer filenames, one per line, sorted.
      This is what publish.sh uploads LAST. Exits 1 if there are none,
      because a desktop release with no pointer updates nobody.

  artifacts <dir>
      Print only the artifact filenames, one per line, sorted.

  checklist <dir> [--tag <tag>]
      Print the generated publish checklist ( §7.1). Derived from
      what is on disk, never hand-written.

  assert-feed <dir> --url <url> --channel <channel>
      Assert every app-update.yml packaged under <dir> names exactly this
      feed URL and channel ( §7.5). Exits 1 on any mismatch, and 1
      if the directory holds no packaged app at all - a silent pass on an
      empty search is how this check would rot.

  assert-channel <dir> --channel <channel>
      Assert every channel pointer in <dir> belongs to this channel, so a
      rehearsal build cannot be published to the live feed (§7.5). Exits 1
      on any foreign or mixed channel, and 1 if there are no pointers.
`;

function fail(msg) {
    process.stderr.write(`update-info.mjs: ${msg}\n`);
    process.exit(1);
}

function flag(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
    const [command, dir] = argv;

    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(USAGE);
        return 0;
    }
    if (!dir) fail(`${command} needs a directory\n\n${USAGE}`);
    if (!existsSync(dir)) fail(`no such directory: ${dir}`);

    if (command === 'classify') {
        const c = classify(dir);
        const section = (label, items) => {
            process.stdout.write(`${label} (${items.length})\n`);
            for (const n of items) process.stdout.write(`  ${n}\n`);
        };
        section('channel pointers', c.pointers);
        section('artifacts', c.artifacts);
        section('manifest', c.manifest);
        section('build byproducts (never published)', c.byproducts);
        return 0;
    }

    if (command === 'pointers') {
        const { pointers } = classify(dir);
        if (pointers.length === 0) {
            fail(`no channel pointers in ${dir}.\n`
                + '  A desktop release whose update-info yml never reaches the feed\n'
                + '  leaves every installed wallet on its current version, forever,\n'
                + '  with nothing logged and nothing failing. Check that the desktop\n'
                + '  lanes ran and that their *.yml files were collected.');
        }
        for (const n of pointers) process.stdout.write(`${n}\n`);
        return 0;
    }

    if (command === 'artifacts') {
        for (const n of classify(dir).artifacts) process.stdout.write(`${n}\n`);
        return 0;
    }

    if (command === 'checklist') {
        const tag = flag(argv, '--tag') || '(untagged)';
        const c = classify(dir);
        const lines = [
            `# Publish checklist for ${tag}`,
            `# GENERATED from ${dir} by tools/release/update-info.mjs.`,
            '# Do not hand-edit: a hand-written list that omits one arch-suffixed',
            '# yml strands that arch\'s entire fleet on its current version, and',
            '# nothing errors ( §7.1).',
            '',
            `# 1. artifacts first (${c.artifacts.length})`,
            ...c.artifacts.map((n) => `⬜ upload  ${n}`),
            '',
            '# 2. signed manifest',
            ...c.manifest.map((n) => `⬜ upload  ${n}`),
            '',
            `# 3. channel pointers LAST (${c.pointers.length}) - each one only`,
            '#    after every artifact it names returns 200 THROUGH the edge',
            ...c.pointers.map((n) => `⬜ upload  ${n}`),
            '',
            '⬜ purge the edge cache for every pointer path above',
        ];
        process.stdout.write(`${lines.join('\n')}\n`);
        return c.pointers.length === 0 ? 1 : 0;
    }

    if (command === 'assert-channel') {
        const channel = flag(argv, '--channel');
        if (!channel) fail('assert-channel needs --channel <name>');

        const { pointers } = classify(dir);
        if (pointers.length === 0) {
            fail(`no channel pointers in ${dir}.\n`
                + '  With none, this assertion has nothing to check and would pass\n'
                + '  an empty or wrong directory straight through to the feed.');
        }

        const foreign = pointers.filter((n) => pointerChannel(n) !== channel);
        if (foreign.length > 0) {
            const seen = [...new Set(pointers.map(pointerChannel))].sort().join(', ');
            fail(`${dir} holds channel pointer(s) for [${seen}], expected only "${channel}":\n`
                + foreign.map((n) => `    ${n}`).join('\n')
                + '\n\n  A prod and a rehearsal build of the same version produce\n'
                + '  IDENTICALLY NAMED installers (electron-builder names by version,\n'
                + '  not channel), so the pointer stem is the only thing in the\n'
                + '  directory that says which feed these bytes were built for.\n'
                + '  Publishing the wrong one is invisible in a file listing.');
        }
        process.stdout.write(`ok   ${pointers.length} pointer(s), all channel "${channel}"\n`);
        return 0;
    }

    if (command === 'assert-feed') {
        let url = flag(argv, '--url');
        let channel = flag(argv, '--channel');
        const fromConfig = flag(argv, '--from-config');

        if (fromConfig) {
            if (!existsSync(fromConfig)) fail(`no such config: ${fromConfig}`);
            try {
                ({ url, channel } = readPublishConfig(fromConfig));
            } catch (err) {
                fail(String(err.message));
            }
        }
        if (!url || !channel) {
            fail('assert-feed needs --from-config, or both --url and --channel');
        }

        const found = readBundledFeedConfigs(dir);
        if (found.length === 0) {
            fail(`no packaged app-update.yml under ${dir}.\n`
                + '  This assertion is the only thing standing between a build and a\n'
                + '  fleet pointed at the wrong feed, so finding nothing to check is a\n'
                + '  failure, not a pass.');
        }

        let bad = 0;
        for (const { path, config } of found) {
            const problems = [];
            if (config.url !== url) problems.push(`url is "${config.url}", expected "${url}"`);
            if (config.channel !== channel) {
                problems.push(`channel is "${config.channel}", expected "${channel}"`);
            }
            if (problems.length) {
                bad += 1;
                process.stderr.write(`FAIL ${path}\n`);
                for (const p of problems) process.stderr.write(`       ${p}\n`);
            } else {
                process.stdout.write(`ok   ${basename(dir)} -> ${config.channel} @ ${config.url}\n`);
            }
        }
        return bad === 0 ? 0 : 1;
    }

    fail(`unknown command "${command}"\n\n${USAGE}`);
    return 1;
}

// "Was this run as a script, or imported?" - via realpath and
// pathToFileURL, not string concatenation. `import.meta.url` is always
// the RESOLVED path while `process.argv[1]` is whatever was typed, so on
// macOS (`/var` -> `/private/var`), on any symlinked checkout, or on a
// path containing a space, the naive `file://${argv[1]}` comparison is
// false and the CLI silently produces NO OUTPUT. Callers then see an
// empty artifact list, which reads as "the staging directory is empty"
// rather than "the tool never ran" - and an empty artifact list is one
// `|| true` away from a release that quietly covers nothing.
const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    process.exit(main(process.argv.slice(2)));
}
