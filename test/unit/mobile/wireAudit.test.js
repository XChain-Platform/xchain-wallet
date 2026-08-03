// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wire audit stays true, or this fails ( §2.6 / §5).
//
// Apple's privacy nutrition labels, Play's Data safety form and the published
// privacy policy all have to describe the same traffic. Getting them right
// once is easy; the hard part is that they are written months before someone
// adds a gateway constant to a flow module, and NOTHING about that edit looks
// like it touches a store listing. By the time it does, the label is wrong and
// a wrong label is a removal class, not a warning.
//
// These tests are the mechanism that makes the edit visible: they read the
// modules that actually reach the network, and fail when one of them names a
// host `packages/core/src/privacy/wireAudit.js` has not classified. The fix is
// never to widen the test - it is to register the host, which means deciding
// what the store forms now say.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    SHELLS,
    WIRE_AUDIT,
    egressHostsFor,
    registeredHosts,
} from '../../../packages/core/src/privacy/wireAudit.js';
import { directivesFor } from '../../../packages/web/src/csp.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Modules that reach the network with a literal host in them. A module absent
 * from this list is not exempt - it is unaudited, which is why the list is
 * short and every entry says why it is here.
 */
const EGRESS_MODULES = [
    'packages/core/src/flows/priceOracle.js',
    'packages/core/src/flows/priceLookup.js',
    'packages/core/src/flows/tokenInfo.js',
    'packages/core/src/registry/remote.js',
    'packages/core/src/registry/descriptors/bitcoin.js',
    'packages/core/src/registry/descriptors/litecoin.js',
    'packages/core/src/registry/descriptors/dogecoin.js',
    'packages/web/src/update/directUpdateCheck.js',
];

/**
 * `tokenInfo.js` carries the demo-token fixtures, whose media URLs point at a
 * dozen hosts that exist only so the demo wallet has something to render. They
 * are not egress on any shell that enforces the §51 CSP (no remote origin in
 * img-src, and no media-src at all, so audio and video fall back to
 * default-src 'self'), and registering them would drown the real list.
 *
 * The cut is made at the demo block's own declaration rather than a line
 * number, and the test below asserts the marker still exists: a rename that
 * silently moved the boundary would otherwise turn this scan into a no-op,
 * which is the failure mode a scanner like this dies of.
 */
const DEMO_BLOCK_MARKERS = {
    'packages/core/src/flows/tokenInfo.js': /^function demoRowFor\(/m,
};

/** Present in every file's licence header; never a request. */
const HEADER_HOSTS = new Set(['dankest.llc']);

/** A hostname, not a doc-comment ellipsis: labelled, with a real TLD. */
const HOST_RE = /https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})/gi;

/**
 * Hosts named in a module's non-demo region.
 * @param {string} relPath
 * @returns {{ hosts: Set<string>, scannedLines: number }}
 */
function hostsIn(relPath) {
    const full = readFileSync(resolve(REPO, relPath), 'utf8');
    const marker = DEMO_BLOCK_MARKERS[relPath];
    let text = full;
    if (marker) {
        const at = full.search(marker);
        expect(
            at,
            `${relPath}: the demo-fixture marker ${marker} is gone, so this scan `
            + 'would silently cover the wrong half of the file',
        ).toBeGreaterThan(0);
        text = full.slice(0, at);
    }
    const hosts = new Set();
    for (const [, host] of text.matchAll(HOST_RE)) {
        const h = host.toLowerCase();
        if (!HEADER_HOSTS.has(h)) hosts.add(h);
    }
    return { hosts, scannedLines: text.split('\n').length };
}

describe('wire audit: the egress modules name no unregistered host', () => {
    const known = registeredHosts();

    for (const relPath of EGRESS_MODULES) {
        it(`${relPath} names only registered hosts`, () => {
            const { hosts, scannedLines } = hostsIn(relPath);
            // A scan that covers nothing passes vacuously, which is worse than
            // failing: assert there was something to read.
            expect(scannedLines).toBeGreaterThan(10);
            const unregistered = [...hosts].filter((h) => !known.has(h));
            expect(
                unregistered,
                `${relPath} contacts ${unregistered.join(', ')}, which is not in `
                + 'packages/core/src/privacy/wireAudit.js. Register it there and update '
                + 'the store forms and the privacy policy in the sibling xchain-documentation '
                + 'checkout (components/wallet/privacy/: privacy-nutrition-labels.md, '
                + 'data-safety.md, privacy-policy.md) before widening this test.',
            ).toEqual([]);
        });
    }

    it('scans at least one host per module, so a broken regex cannot pass', () => {
        const found = EGRESS_MODULES.flatMap((p) => [...hostsIn(p).hosts]);
        expect(found.length).toBeGreaterThan(EGRESS_MODULES.length);
    });
});

describe('wire audit: the mobile egress set is pinned', () => {
    // Pinned literally, because this list IS the iOS privacy nutrition labels
    // and the Play Data safety answers. Changing it here without changing them
    // there is exactly the drift that gets an app pulled.
    const EXPECTED_MOBILE = [
        '*',
        'api.coingecko.com',
        'arweave.net',
        // Reachable on ONE lane of one mobile shell: a sideloaded Android APK
        // ( D4, wired 2026-08-02). Listed here rather than lane-scoped
        // away, because a store form is safer describing a request the store
        // build does not make than omitting one it might. The lane gate itself
        // is pinned by the `has no path into a store build` block above.
        'downloads.xchain.io',
        'encoder.xchain.io',
        'explorer.xchain.io',
        'hub.xchain.io',
        'ipfs.io',
    ];

    it('contacts exactly the hosts the store forms disclose', () => {
        expect(egressHostsFor('mobile')).toEqual(EXPECTED_MOBILE);
    });

    it('does not contact the block-explorer icon hosts, which the extension does', () => {
        const mobile = egressHostsFor('mobile');
        for (const host of ['mempool.space', 'blockstream.info', 'litecoinspace.org', 'blockchair.com', 'www.blockcypher.com']) {
            expect(mobile, `${host} must not egress on mobile: the CSP img-src blocks it`).not.toContain(host);
            expect(egressHostsFor('extension')).toContain(host);
        }
    });

    it('the update feed is registered against the shells that can reach it', () => {
        // It used to be registered against `desktop` alone, with `mobile`
        // asserted absent, because D4 was unwired. Now the row has to name
        // both, and the row's own `control` field is what carries the fact
        // that a Play-installed build never makes the request.
        expect(egressHostsFor('desktop')).toContain('downloads.xchain.io');
        expect(egressHostsFor('mobile')).toContain('downloads.xchain.io');
        const row = WIRE_AUDIT.find((e) => e.host === 'downloads.xchain.io');
        expect(row.party).toBe('first');
        expect(
            row.control,
            'the store forms are filled from this field; it must say which lane',
        ).toMatch(/Never requested by a Play-installed or App Store build/);
        // The one claim the privacy policy leans on: this request is the only
        // first-party endpoint that carries no wallet address, which is why it
        // can be described as anonymous where the balance queries cannot.
        expect(row.carries).toMatch(/no addresses/i);
    });

    it('rejects an unknown shell rather than answering for one', () => {
        expect(() => egressHostsFor('ios')).toThrow(/unknown shell/);
        expect(SHELLS).toContain('mobile');
    });

    it('every entry states what leaves the device and how to stop it', () => {
        for (const entry of WIRE_AUDIT) {
            expect(entry.carries, `${entry.host} does not say what it carries`).toBeTruthy();
            expect(entry.control, `${entry.host} does not say how a user stops it`).toBeTruthy();
            expect(entry.source, `${entry.host} does not say where it comes from`).toBeTruthy();
        }
    });
});

describe('wire audit: the structural claims the labels rest on', () => {
    // The iOS labels claim no third-party media is ever fetched. That is not a
    // code path anyone can read - it is these two directives.
    for (const profile of ['default', 'store']) {
        it(`${profile} profile: img-src admits no remote origin`, () => {
            const imgSrc = directivesFor(profile)['img-src'];
            const remote = imgSrc.filter((v) => /^https?:/i.test(v));
            expect(remote, `img-src admits ${remote.join(', ')}, so remote token media becomes an IP beacon`).toEqual([]);
        });

        it(`${profile} profile: no media-src, so audio and video fall back to default-src 'self'`, () => {
            const directives = directivesFor(profile);
            expect(Object.keys(directives)).not.toContain('media-src');
            expect(directives['default-src']).toEqual(["'self'"]);
        });
    }
});

describe('wire audit: the update feed has no path into a store build', () => {
    // This used to assert that NOTHING imported the feed client, which was the
    // right guard while D4 was unwired and the wrong one the moment it was
    // built ( §6: the direct APK's only update path). The guard did not
    // relax, it moved: the feed still has exactly one caller, and that caller
    // is still unreachable from any store build - but now the enforcement is a
    // runtime gate rather than an absence, so these tests pin the gate.
    it('exactly one module imports directUpdateCheck, and it is the gated one', () => {
        // An IMPORT, not a mention: the audit module and the docs name the
        // file as provenance and must not read as callers.
        const out = execSync(
            String.raw`grep -rlE "(from|import\()\s*['\"][^'\"]*directUpdateCheck" packages/*/src 2>/dev/null || true`,
            { cwd: REPO, encoding: 'utf8' },
        ).trim();
        const importers = out ? out.split('\n').sort() : [];
        expect(
            importers,
            'the feed client must have exactly one caller, so the "not in a store build" rule '
            + 'lives on one line instead of at four call sites',
        ).toEqual(['packages/web/src/update/directUpdateProvider.js']);
    });

    it('the only caller installs the provider ONLY on an explicit direct lane', () => {
        const src = readFileSync(
            resolve(REPO, 'packages/web/src/update/directUpdateProvider.js'), 'utf8',
        );
        // The guard is a positive test on the lane, then an early return. A
        // future edit that inverts it (bail only when channel === 'store')
        // would silently turn every `unknown` into a direct install, which is
        // every browser and the whole iOS shell.
        expect(src).toMatch(/if \(!isSelfUpdatingLane\(origin\)\)/);
        expect(src).toMatch(/setDirectUpdateProvider\(null\)/);
    });

    it("'unknown' is silent: only a native 'direct' turns the notice on", () => {
        const src = readFileSync(
            resolve(REPO, 'packages/web/src/update/installOrigin.js'), 'utf8',
        );
        expect(src).toMatch(/return origin\?\.channel === 'direct'/);
        // Every other path in that module must land on 'unknown': no plugin,
        // no method, an unrecognised channel, a thrown call.
        const unknowns = src.match(/channel: 'unknown'/g) || [];
        expect(unknowns.length, 'no plugin / no method / bad channel / throw').toBeGreaterThanOrEqual(3);
    });

    it('core ships no knowledge of any feed: the provider defaults to null', async () => {
        const mod = await import('../../../packages/core/src/flows/directUpdate.js');
        expect(mod.hasDirectUpdateLane()).toBe(false);
        expect(mod.isUpdateNoticeEnabled()).toBe(false);
        expect(await mod.checkForUpdateNotice()).toBeNull();
        expect(mod.directUpdateFeedUrl()).toBeNull();
        const src = readFileSync(
            resolve(REPO, 'packages/core/src/flows/directUpdate.js'), 'utf8',
        );
        expect(src, 'core must not name the feed host').not.toMatch(/downloads\.xchain\.io/);
    });

    it('the iOS plugin implements no install-origin method, so it can never have a lane', () => {
        const swift = readFileSync(
            resolve(REPO, 'packages/mobile/ios/App/App/vault/XChainVaultPlugin.swift'), 'utf8',
        );
        expect(
            swift,
            'an in-app "download a new version" notice is an App Store review problem; '
            + 'the iOS shell stays unable to answer the lane question at all',
        ).not.toMatch(/getInstallOrigin/);
    });
});
