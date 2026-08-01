// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * @vitest-environment node
 *
 * Main-process code. Required, not cosmetic: importing updater.js pulls in
 * updateVerify.js and therefore openpgp, whose node build throws at import
 * time under the suite's default jsdom environment. The failure looks like
 * a broken openpgp rather than a wrong environment, and it only appears in
 * a full-suite run, never when this file is run on its own.
 */

//  stage 3: where does an installed build look for the SIGNED
// manifest that authorises its update?
//
// THE SEAM THIS CLOSES. electron-updater follows the feed URL baked into
// the app's own `app-update.yml`. `fetchReleaseManifest` used a hardcoded
// production constant instead. For a production build the two agree and
// nothing is visibly wrong, which is why it survived review. For a §7.5
// rehearsal build they do not: the update would be downloaded from the
// staging feed and its proof demanded from production, where staging
// artifacts are deliberately absent (§7.5 excludes them from
// RELEASE_HASHES). The hash lookup could never match, so every rehearsal
// would fail closed and read as a broken updater rather than a misrouted
// lookup. The rehearsal is the only thing that exercises the updater
// before a release reaches users, so a rehearsal that cannot pass is worse
// than none: it trains everyone to ignore it.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
    UPDATE_FEED_BASE_URL,
    manifestBaseFromFeedUrl,
    resolveFeedBaseUrl,
} from '../../../packages/desktop/main/updater.js';

const PROD_FEED = 'https://downloads.xchain.io/wallet/desktop/';
const STAGING_FEED = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';

/** A readFile stub that serves one app-update.yml and nothing else. */
const bundleWith = (body, resourcesPath = '/app/Resources') => (path, enc) => {
    expect(enc).toBe('utf8');
    if (path !== join(resourcesPath, 'app-update.yml')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return body;
};

describe('manifestBaseFromFeedUrl', () => {
    it('strips the desktop/ segment: the feed is <base>desktop/, manifests are <base>RELEASE_HASHES/', () => {
        expect(manifestBaseFromFeedUrl(PROD_FEED))
            .toBe('https://downloads.xchain.io/wallet/');
    });

    it('keeps a staging feed on its own base rather than collapsing to prod', () => {
        expect(manifestBaseFromFeedUrl(STAGING_FEED))
            .toBe('https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/');
    });

    it('tolerates a missing trailing slash', () => {
        expect(manifestBaseFromFeedUrl('https://downloads.xchain.io/wallet/desktop'))
            .toBe('https://downloads.xchain.io/wallet/');
    });

    it('leaves a URL that does not end in desktop/ alone', () => {
        expect(manifestBaseFromFeedUrl('https://example.test/feed/'))
            .toBe('https://example.test/feed/');
    });

    it('does not strip a mid-path desktop segment', () => {
        expect(manifestBaseFromFeedUrl('https://example.test/desktop/x/'))
            .toBe('https://example.test/desktop/x/');
    });
});

describe('resolveFeedBaseUrl', () => {
    it('reads the feed the build actually baked in', () => {
        const readFile = bundleWith(
            `provider: generic\nurl: ${PROD_FEED}\nchannel: stable\n`,
        );
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe('https://downloads.xchain.io/wallet/');
    });

    it('follows a REHEARSAL build to the staging base', () => {
        const readFile = bundleWith(
            `provider: generic\nurl: ${STAGING_FEED}\nchannel: staging\n`,
        );
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe('https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/');
    });

    it('strips quotes electron-builder may add around the value', () => {
        const readFile = bundleWith(`url: '${PROD_FEED}'\nchannel: stable\n`);
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe('https://downloads.xchain.io/wallet/');
    });

    // Dev runs from source, where no app-update.yml is packaged. The
    // updater no-ops there anyway; falling back beats throwing on startup
    // in the Electron main process.
    it('falls back to the production constant when nothing is packaged', () => {
        const readFile = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe(UPDATE_FEED_BASE_URL);
    });

    it('falls back when resourcesPath is undefined (non-Electron context)', () => {
        expect(resolveFeedBaseUrl({ resourcesPath: undefined, readFile: () => '' }))
            .toBe(UPDATE_FEED_BASE_URL);
    });

    it('falls back on an app-update.yml with no url line rather than returning empty', () => {
        const readFile = bundleWith('provider: generic\nchannel: stable\n');
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe(UPDATE_FEED_BASE_URL);
    });

    it('falls back on an empty url value', () => {
        const readFile = bundleWith('url:   \nchannel: stable\n');
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe(UPDATE_FEED_BASE_URL);
    });

    // `updaterCacheDirName` also ends in a name; only a column-0 `url:` counts.
    it('is not fooled by an indented url key', () => {
        const readFile = bundleWith('provider: generic\n  url: https://evil.test/\nchannel: stable\n');
        expect(resolveFeedBaseUrl({ resourcesPath: '/app/Resources', readFile }))
            .toBe(UPDATE_FEED_BASE_URL);
    });
});
