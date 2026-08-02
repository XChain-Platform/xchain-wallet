// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/capture-update-check.mjs - what does an update check
// actually send? ( §7.6.)
//
// WHY THIS EXISTS. The download page is going to tell users what the
// wallet transmits when it checks for updates. §7.6 is explicit that the
// page may state only what a CAPTURE shows, not what we believe: a
// privacy claim written from reading the source is a claim nobody
// checked, and it is the kind of claim a regulator, a store reviewer, or
// a user with Wireshark checks for us.
//
// TWO MODES, because there are two questions:
//
//   --listen   Stand up a plain HTTP origin, record every request in
//              full, and write them to a capture file. Point a REAL
//              packaged build at it (build a rehearsal variant whose
//              staging feed URL is this server) and you have a capture
//              of the shipped app. This is the authoritative mode.
//
//   --drive    Stand up that same origin AND point the REAL
//              `electron-updater` at it, with a stub app adapter instead
//              of Electron. Records what the updater itself sends, which
//              is strictly more than the library mode below: headers the
//              UPDATER adds are invisible to `configureRequestOptions`.
//
//   (default)  Drive a request through builder-util-runtime's own
//              `configureRequestOptions`, the function that decides
//              every header electron-updater sends, at the version this
//              repo pins. This answers the library-policy half today,
//              without a packaged app, and it is honest about being only
//              that half.
//
// THE DEFAULT MODE MISSED A HEADER, AND IT WAS THE ONE THAT MATTERED
// (found 2026-08-02,  §7.6). `configureRequestOptions` sets the
// user agent and the cache header; `AppUpdater.getUpdateInfoAndProvider`
// then adds `x-user-staging-id`, a UUID generated once per install,
// persisted to `<userData>/.updaterId`, and sent on EVERY check. It is by
// definition an identifier that persists between checks, and the download
// page said in as many words that no such identifier existed. A capture
// that never ran the updater could not see it. `--drive` runs the
// updater.
//
// ATTEMPTED AND NOT YET ACHIEVED, 2026-08-01: taking the authoritative
// capture from a LOCALLY built bundle. Recorded here so the next attempt
// starts past these three, all of which were ruled out:
//
//   1. `dist:unpacked` (--dir) emits no `app-update.yml` at all, so the
//      app falls back to `resolveFeedBaseUrl`'s production constant and
//      would have quietly checked the REAL feed. Use a real target build,
//      or hand-write the file into Contents/Resources.
//   2. Not a signing problem. The bundle arrives already ad-hoc signed
//      (Identifier=Electron); re-signing with `codesign -s -` to fix the
//      identifier changed nothing.
//   3. With the feed correctly baked (verified by reading the packaged
//      `app-update.yml`), the app starts and stays running but emits ZERO
//      stdout - even under ELECTRON_ENABLE_LOGGING=1 - and issues no
//      update request. The listener was proven live by curl in the same
//      session, twice, so the harness is not the problem.
//
// So the remaining unknown is inside the app's own startup under a
// locally built bundle, not in this tool. The cheapest next probes: read
// the updater events the app already broadcasts to its windows
// (`broadcastToWindows('xchain:updater', ...)`) via devtools, or simply
// take the capture against a CI-produced, Developer-ID-signed build once
// ceremony A lands - which is the authoritative artifact anyway.
//
// THE DIFFERENCE BETWEEN THE MODES IS THE TRANSPORT, and it is stated in
// the capture itself rather than left for a reader to infer. In a
// packaged app electron-updater sends through Electron's `net` module,
// which is Chromium's network stack and adds its own headers (Accept,
// Accept-Encoding, Sec-* and so on). The default mode uses Node's http,
// which does not. So the default capture is a LOWER BOUND on what is
// sent: everything it shows is sent, and a packaged app may send more.
// A download page written from the default capture alone must not claim
// "and nothing else".

import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** Record one request exactly as it arrived. */
function record(req) {
    return {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        // rawHeaders preserves order and original casing; req.headers
        // lowercases and merges, which would hide a duplicate or a
        // header whose casing is itself a fingerprint.
        headers: req.rawHeaders.reduce((acc, v, i, arr) => {
            if (i % 2 === 0) acc.push([v, arr[i + 1]]);
            return acc;
        }, []),
        remoteAddressFamily: req.socket.remoteFamily,
    };
}

async function listen(out, port) {
    const captured = [];
    const server = createServer((req, res) => {
        captured.push(record(req));
        process.stderr.write(`captured ${req.method} ${req.url}\n`);
        writeFileSync(out, `${JSON.stringify({
            mode: 'listen',
            note: 'Requests from a real client. If the client was a packaged '
                + 'build, this is the authoritative capture.',
            capturedAt: new Date().toISOString(),
            requests: captured,
        }, null, 2)}\n`);
        res.writeHead(404).end('capture server: nothing is served here\n');
    });
    await new Promise((r) => server.listen(port, '127.0.0.1', r));
    const { port: actual } = server.address();
    process.stderr.write(
        `capture-update-check: listening on http://127.0.0.1:${actual}/\n`
        + '  Build a rehearsal variant with XCHAIN_STAGING_FEED_URL pointed here,\n'
        + `  install it, and let it check for updates. Writing to ${out}.\n`
        + '  Ctrl-C when done.\n',
    );
}

/**
 * Stand up an origin, point the real updater at it, and record what
 * arrives.
 *
 * Three checks, because the interesting property is not "which headers"
 * but "does anything persist":
 *
 *   1 and 2 share one userData directory, as two checks by one install do.
 *   3 uses a fresh one, as a different install does.
 *
 * If a value repeats across 1 and 2 and differs in 3, it identifies the
 * install. That is the test the page's privacy claim needed and never got.
 */
async function drive(out) {
    const { mkdtempSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');

    const captured = [];
    const server = createServer((req, res) => {
        captured.push(record(req));
        // A minimal well-formed pointer, so the updater completes its check
        // rather than erroring before it has sent everything it sends.
        res.writeHead(200, { 'content-type': 'text/yaml' });
        res.end('version: 9.9.9\nfiles:\n  - url: nothing.bin\n    sha512: AA==\n    size: 1\n'
            + 'path: nothing.bin\nsha512: AA==\nreleaseDate: \'2026-01-01T00:00:00.000Z\'\n');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/`;

    const desktopRequire = createRequire(
        new URL('../../packages/desktop/package.json', import.meta.url),
    );
    // NsisUpdater purely because its constructor needs nothing from
    // Electron; the pointer FILENAME still follows the host platform
    // (Provider.getChannelFilePrefix reads runtimeOptions.platform), so the
    // capture is honest about what this OS would request.
    const { NsisUpdater } = desktopRequire('electron-updater');
    const { NodeHttpExecutor } = desktopRequire('builder-util');

    const dirs = [];
    async function checkOnce(userDataPath, requestHeaders) {
        // electron-updater reads the bundled config off disk during a
        // check, so the stub needs one. Pointed at the local origin, never
        // at the production feed.
        writeFileSync(join(userDataPath, 'app-update.yml'),
            `provider: generic\nurl: ${url}\nchannel: stable\n`);
        const updater = new NsisUpdater(null, {
            version: '0.0.1',
            name: 'XChain Wallet',
            isPackaged: true,
            appUpdateConfigPath: join(userDataPath, 'app-update.yml'),
            userDataPath,
            baseCachePath: userDataPath,
            whenReady: async () => {},
            relaunch: () => {},
            quit: () => {},
            onQuit: () => {},
        });
        updater.httpExecutor = new NodeHttpExecutor();
        // Upstream auto-downloads by default (the shipped app turns this
        // off; see main/updater.js). Leaving it on here would make the
        // capture fetch a fake artifact instead of just checking.
        updater.autoDownload = false;
        if (requestHeaders) updater.requestHeaders = { ...requestHeaders };
        updater.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
        updater.setFeedURL({ provider: 'generic', url, channel: 'stable' });
        await updater.checkForUpdates();
    }

    // The shipped app's own header policy, imported rather than restated:
    // a capture that described a policy of its own would be the same class
    // of mistake as a page that described a request nobody captured.
    const { UPDATE_REQUEST_HEADERS } = await import(
        new URL('../../packages/desktop/main/updater.js', import.meta.url)
    );

    const shared = mkdtempSync(join(tmpdir(), 'xchain-capture-a-'));
    const fresh = mkdtempSync(join(tmpdir(), 'xchain-capture-b-'));
    const shipped = mkdtempSync(join(tmpdir(), 'xchain-capture-c-'));
    dirs.push(shared, fresh, shipped);
    try {
        // Upstream defaults, twice from one install and once from another.
        await checkOnce(shared);
        await checkOnce(shared);
        await checkOnce(fresh);
        // Then the same thing as the wallet configures it.
        await checkOnce(shipped, UPDATE_REQUEST_HEADERS);
        await checkOnce(shipped, UPDATE_REQUEST_HEADERS);
    } finally {
        server.close();
        for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }

    const idOf = (r) => (r.headers.find(([k]) => k.toLowerCase() === 'x-user-staging-id') || [])[1];
    const [first, second, other, shippedFirst, shippedSecond] = captured.map(idOf);

    writeFileSync(out, `${JSON.stringify({
        mode: 'drive',
        note: 'The REAL electron-updater, driven against a local origin with a stub app '
            + 'adapter. Transport is Node rather than Chromium, so a packaged app may add '
            + 'headers of its own on top of these - but every header the UPDATER sets is '
            + 'here, which the library mode could not show.',
        'electron-updater': desktopRequire('electron-updater/package.json').version,
        capturedAt: new Date().toISOString(),
        persistentIdentifier: {
            header: 'x-user-staging-id',
            upstreamDefault: {
                sameInstallRepeatsIt: first != null && first === second,
                differentInstallDiffers: other != null && other !== first,
                storedAt: '<userData>/.updaterId',
                what: 'A UUID electron-updater generates on first check and reuses forever. '
                    + 'It is sent on every update check, so the feed could count and follow '
                    + 'an install across IP changes.',
            },
            asShipped: {
                value: shippedFirst,
                constantAcrossChecks: shippedFirst != null && shippedFirst === shippedSecond,
                differsFromUpstreamValue: shippedFirst !== first,
                how: 'main/updater.js pins UPDATE_REQUEST_HEADERS, and computeFinalHeaders '
                    + 'merges requestHeaders last, so the generated UUID never leaves the '
                    + 'machine. The local .updaterId file is still written; it is simply '
                    + 'not sent.',
            },
        },
        requests: captured,
    }, null, 2)}\n`);
    process.stderr.write(`capture-update-check: wrote ${out} (${captured.length} requests)\n`);
    process.stderr.write(`  x-user-staging-id, check 1: ${first}\n`);
    process.stderr.write(`  x-user-staging-id, check 2 (same install): ${second}\n`);
    process.stderr.write(`  x-user-staging-id, check 3 (fresh install): ${other}\n`);
}

function driveLibrary(out) {
    // The real function. Resolved from the installed tree rather than
    // copied, so a dependency bump changes the capture instead of
    // silently invalidating it.
    const httpExecutorPath = require.resolve('builder-util-runtime/out/httpExecutor.js', {
        paths: [require.resolve('electron-updater/package.json', {
            paths: ['packages/desktop'],
        })],
    });
    const { configureRequestOptions } = require(httpExecutorPath);
    const version = require(require.resolve('builder-util-runtime/package.json', {
        paths: [httpExecutorPath],
    })).version;

    const options = configureRequestOptions({});

    // The URL shape matters as much as the headers. `isAddRandomQuery` is
    // true whenever no auth header is set - which is us - so every check
    // appends `?noCache=<Date.now() base32>`. That is not a persistent
    // identifier, but it IS a reading of the client's clock on every
    // request, and a page claiming "nothing but IP and user agent" would
    // be wrong about it.
    const utilPath = require.resolve('electron-updater/out/util.js', {
        paths: ['packages/desktop'],
    });
    const { newUrlFromBase, getChannelFilename } = require(utilPath);
    const exampleUrl = newUrlFromBase(
        getChannelFilename('stable-mac'), new URL('https://example.invalid/wallet/desktop/'), true,
    ).href;

    writeFileSync(out, `${JSON.stringify({
        mode: 'library',
        note: 'Headers builder-util-runtime sets for an update check. A LOWER '
            + 'BOUND: a packaged app sends these through Electron net, which '
            + 'adds Chromium headers of its own. Use --listen against a real '
            + 'build for the authoritative capture.',
        'builder-util-runtime': version,
        capturedAt: new Date().toISOString(),
        headers: options.headers,
        requestUrlShape: exampleUrl,
        requestUrlNote: 'The OS and architecture are disclosed by WHICH pointer '
            + 'is requested, not by any header. The noCache value is Date.now() '
            + 'in base 32, so each check discloses the client clock to ~ms.',
    }, null, 2)}\n`);
    process.stderr.write(`capture-update-check: wrote ${out}\n`);
    for (const [k, v] of Object.entries(options.headers || {})) {
        process.stderr.write(`  ${k}: ${v}\n`);
    }
}

const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    const argv = process.argv.slice(2);
    const at = (n) => (argv.indexOf(n) === -1 ? undefined : argv[argv.indexOf(n) + 1]);
    const out = at('--out') || 'update-check-capture.json';
    if (argv.includes('--listen')) {
        await listen(out, Number(at('--port') || 0));
    } else if (argv.includes('--drive')) {
        await drive(out);
    } else {
        driveLibrary(out);
    }
}
