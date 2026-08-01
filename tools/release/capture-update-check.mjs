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
//   (default)  Drive a request through builder-util-runtime's own
//              `configureRequestOptions`, the function that decides
//              every header electron-updater sends, at the version this
//              repo pins. This answers the library-policy half today,
//              without a packaged app, and it is honest about being only
//              that half.
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
    } else {
        driveLibrary(out);
    }
}
