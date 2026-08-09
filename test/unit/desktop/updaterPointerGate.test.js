/**
 * @vitest-environment node
 *
 * Node, not jsdom: openpgp's Uint8Array check rejects jsdom's TextEncoder
 * output, so key generation fails for reasons unrelated to this code.
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the channel pointer, checked by the real `downloadAndInstall()`.
//
// `updateVerify.test.js` holds the gate's own logic. This file holds the
// WIRING, because that is where this defect lived: every piece needed to
// check a pointer already existed, and `updater.js` simply never fetched
// one. A unit test of a verifier nobody calls passes forever.
//
// So every case here drives `attachUpdater` end to end against a fake
// electron-updater and a fake feed, with a real signed manifest and a
// real file on disk, and asserts on whether `quitAndInstall` was reached.
// The feed is hostile in the way  §7.2 describes: it serves
// whatever it likes, and every hash it publishes is correct.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as openpgp from 'openpgp';

import { attachUpdater } from '../../../packages/desktop/main/updater.js';

const FEED = 'https://feed.invalid/wallet/';
const VERSION = '9.9.9';
const ARTIFACT = 'xchain-wallet-9.9.9-x86_64.AppImage';
const ARTIFACT_BYTES = Buffer.from('the real release\n');
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');
const ARTIFACT_SHA512 = createHash('sha512').update(ARTIFACT_BYTES).digest('hex');

const DEB = 'xchain-wallet_9.9.9_amd64.deb';
const DEB_BYTES = Buffer.from('the real deb\n');
const DEB_SHA = createHash('sha256').update(DEB_BYTES).digest('hex');
const DEB_SHA512 = createHash('sha512').update(DEB_BYTES).digest('hex');

let signingKey;
let PINNED;
let dir;
let artifactPath;

beforeAll(async () => {
    const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'ed25519Legacy',
        userIDs: [{ name: 'XChain Release', email: 'release@test.invalid' }],
        subkeys: [{ sign: true }],
        format: 'armored',
    });
    signingKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
    PINNED = {
        armoredKey: publicKey,
        fingerprint: (await openpgp.readKey({ armoredKey: publicKey }))
            .getFingerprint().toUpperCase(),
    };

    dir = mkdtempSync(join(tmpdir(), 'xc-pointer-'));
    artifactPath = join(dir, ARTIFACT);
}, 30_000);

afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The manifest K1 signs: both lanes of one real release. */
const MANIFEST = Buffer.from([
    '# XChain Wallet release manifest',
    '# manifest-version: 1',
    `# tag: v${VERSION}`,
    '# tag-commit: 1e3188fc8ee7cb0b3f74ba3f21ec15b13fbcc516',
    '# built: 2026-07-31T18:02:11Z',
    '# dev-mock-gate: enforced',
    '# artifacts: 2',
    `${ARTIFACT_SHA}  ./${ARTIFACT}`,
    `${DEB_SHA}  ./${DEB}`,
    '',
].join('\n'));

function pointer({ version = VERSION, files = [[ARTIFACT, ARTIFACT_SHA512]] } = {}) {
    const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');
    const lines = [`version: ${version}`, 'files:'];
    for (const [name, hex] of files) {
        lines.push(`  - url: ${name}`, `    sha512: ${b64(hex)}`, '    size: 17');
    }
    lines.push(`path: ${files[0][0]}`, `sha512: ${b64(files[0][1])}`);
    return `${lines.join('\n')}\n`;
}

/**
 * A stand-in for electron-updater that behaves like the real one in the
 * two ways this gate depends on: the downloaded path arrives on the
 * `update-downloaded` event, and `quitAndInstall` is the install.
 */
function fakeModule({ name = ARTIFACT, bytes = ARTIFACT_BYTES, version = VERSION } = {}) {
    const calls = [];
    const handlers = new Map();
    // Whatever the pointer names is what lands on disk, because that is
    // what electron-updater does. A fake that always downloaded the
    // genuine artifact would refuse the attacker's pointer for a reason
    // the real code would never reach.
    const path = join(dir, name);
    const autoUpdater = {
        autoDownload: true,
        autoInstallOnAppQuit: true,
        isUpdaterActive: () => true,
        on(event, fn) { handlers.set(event, fn); },
        checkForUpdates: async () => { calls.push('checkForUpdates'); },
        async downloadUpdate() {
            calls.push('downloadUpdate');
            writeFileSync(path, bytes);
            handlers.get('update-downloaded')?.({ version, downloadedFile: path });
            return [path];
        },
        quitAndInstall() { calls.push('quitAndInstall'); },
    };
    return { mod: { autoUpdater }, autoUpdater, calls, path };
}

/** A feed that serves exactly what the case tells it to. */
function feed({ pointerText = pointer(), signWithKey = null, manifest = MANIFEST } = {}) {
    return async (url) => {
        if (url.endsWith('.yml')) {
            return pointerText === null
                ? { ok: false, status: 404 }
                : { ok: true, status: 200, text: async () => pointerText };
        }
        if (url.endsWith('.asc')) {
            const sig = await openpgp.sign({
                message: await openpgp.createMessage({ binary: new Uint8Array(manifest) }),
                signingKeys: signWithKey ?? signingKey,
                detached: true,
                format: 'armored',
            });
            return { ok: true, status: 200, text: async () => sig };
        }
        return {
            ok: true,
            status: 200,
            text: async () => manifest.toString('utf8'),
            arrayBuffer: async () => manifest,
        };
    };
}

const attach = (mod, extra = {}) => attachUpdater({
    loader: async () => mod,
    onEvent: () => {},
    feedBaseUrl: FEED,
    pinned: PINNED,
    pointerName: 'stable-linux.yml',
    ...extra,
});

describe('the channel pointer is fetched at all', () => {
    it('asks the feed for THIS build\'s pointer, not for whatever it offers', async () => {
        const { mod } = fakeModule();
        const seen = [];
        const base = feed();
        await (await attach(mod, {
            fetchImpl: async (url, opts) => { seen.push(url); return base(url, opts); },
        })).downloadAndInstall();

        expect(seen).toContain(`${FEED}desktop/stable-linux.yml`);
        // And the pointer name came from the build, never from the feed:
        // nothing the feed returned could have chosen a different one.
        expect(seen.filter((u) => u.endsWith('.yml'))).toEqual([`${FEED}desktop/stable-linux.yml`]);
    });

    it('installs the release whose pointer and artifact K1 both cover', async () => {
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, { fetchImpl: feed() })).downloadAndInstall();

        expect(result).toEqual({ ok: true });
        expect(calls).toContain('quitAndInstall');
    });
});

// The attacker's own AppImage: real bytes, real sha512 in their pointer,
// so electron-updater's own check passes on it.
const EVIL = 'evil.AppImage';
const EVIL_BYTES = Buffer.from('attacker code\n');
const EVIL_SHA512 = createHash('sha512').update(EVIL_BYTES).digest('hex');

describe('a validly-hashed but unsigned pointer', () => {
    it('IS REFUSED BEFORE INSTALL, which is the whole item', async () => {
        // The feed serves an entirely coherent update: a pointer naming
        // the attacker's binary at that binary's true hash, and the
        // binary itself. Nothing internal to the feed disagrees. The
        // refusal comes from the one fact the feed cannot author, which
        // is what K1 signed for this version.
        const { mod, calls } = fakeModule({ name: EVIL, bytes: EVIL_BYTES });
        const result = await (await attach(mod, {
            fetchImpl: feed({ pointerText: pointer({ files: [[EVIL, EVIL_SHA512]] }) }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/not covered by the signed manifest/);
        expect(calls).toContain('downloadUpdate');
        expect(calls).not.toContain('quitAndInstall');
    });

    it('REFUSES AN UNCOVERED ENTRY LISTED BESIDE A COVERED ONE, which nothing caught before', async () => {
        // This is the case the artifact gate alone cannot see, and the
        // reason this item was not already closed by  S5. This
        // install downloads the genuine artifact, so hashing what arrived
        // says yes to everything. The tampering is in the OTHER entry:
        // the same pointer hands a different lane a file K1 never signed.
        // Before this change nothing here read the pointer at all, so
        // this update installed.
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            fetchImpl: feed({
                pointerText: pointer({
                    files: [[ARTIFACT, ARTIFACT_SHA512], [EVIL, EVIL_SHA512]],
                }),
            }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/evil\.AppImage, which the signed manifest does not cover/);
        expect(calls).not.toContain('quitAndInstall');
    });

    it('deletes the rejected download rather than leaving it cached', async () => {
        const { mod, path } = fakeModule({ name: EVIL, bytes: EVIL_BYTES });
        await (await attach(mod, {
            fetchImpl: feed({ pointerText: pointer({ files: [[EVIL, EVIL_SHA512]] }) }),
        })).downloadAndInstall();

        expect(existsSync(path)).toBe(false);
    });

    it('says so on the event stream instead of failing silently', async () => {
        const events = [];
        const { mod } = fakeModule({ name: EVIL, bytes: EVIL_BYTES });
        await (await attach(mod, {
            onEvent: (e) => events.push(e.type),
            fetchImpl: feed({ pointerText: pointer({ files: [[EVIL, EVIL_SHA512]] }) }),
        })).downloadAndInstall();

        expect(events).toContain('verifying');
        expect(events).toContain('rejected');
    });
});

// The pointer is re-fetched rather than remembered, so a feed gets a
// second chance to answer. These are the two ways it can answer
// differently, and both are refusals rather than second opinions.
//
// WHAT THIS DOES NOT CLOSE, said here so nobody reads a broader claim
// into the file: a pointer naming another LANE's artifact of the same
// release (the .deb served to an AppImage install) is covered by the
// signed manifest, because the manifest covers every lane of a release.
// Anchoring the pointer cannot see that one. `selectUpdater` and 
// §5 own it, and version FREEZE (replaying an older, genuinely signed
// pointer) is open under both.
describe('a feed that answers the verifier differently', () => {
    it('refuses a pointer that does not name the file that arrived', async () => {
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            fetchImpl: feed({ pointerText: pointer({ files: [[DEB, DEB_SHA512]] }) }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/does not name xchain-wallet-9\.9\.9-x86_64\.AppImage/);
        expect(calls).not.toContain('quitAndInstall');
    });

    it('refuses a pointer describing a different version than the one downloaded', async () => {
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            fetchImpl: feed({ pointerText: pointer({ version: '9.9.8' }) }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/channel pointer describes 9\.9\.8/);
        expect(calls).not.toContain('quitAndInstall');
    });

    it('refuses a pointer whose sha512 is not the bytes that arrived', async () => {
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            fetchImpl: feed({ pointerText: pointer({ files: [[ARTIFACT, DEB_SHA512]] }) }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/is not the file that arrived/);
        expect(calls).not.toContain('quitAndInstall');
    });
});

describe('fail closed', () => {
    it('never installs when the pointer cannot be fetched', async () => {
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            fetchImpl: feed({ pointerText: null }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/channel pointer fetch failed \(404\)/);
        expect(calls).not.toContain('quitAndInstall');
    });

    it('never installs when this build cannot name its own pointer', async () => {
        // A platform with no pointer in the §7.1 matrix resolves to null.
        // Refusing is the only safe answer: an install nothing anchored
        // is the state this item exists to end.
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            pointerName: null, fetchImpl: feed(),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(calls).not.toContain('quitAndInstall');
    });

    it('still refuses an unsigned manifest even when the pointer is perfect', async () => {
        // The two checks are independent, and neither substitutes for the
        // other. Order is not a fallback.
        const { privateKey } = await openpgp.generateKey({
            type: 'ecc',
            curve: 'ed25519Legacy',
            userIDs: [{ name: 'Attacker', email: 'a@test.invalid' }],
            subkeys: [{ sign: true }],
            format: 'armored',
        });
        const { mod, calls } = fakeModule();
        const result = await (await attach(mod, {
            fetchImpl: feed({ signWithKey: await openpgp.readPrivateKey({ armoredKey: privateKey }) }),
        })).downloadAndInstall();

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/signature does not verify/);
        expect(calls).not.toContain('quitAndInstall');
    });
});
