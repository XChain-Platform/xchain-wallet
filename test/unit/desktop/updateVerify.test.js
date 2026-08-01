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
 * Node, not jsdom. This is main-process code, and jsdom substitutes a
 * TextEncoder whose output openpgp's `isUint8Array` check rejects
 * ("concatUint8Array: Data must be in the form of a Uint8Array"), so
 * every case here fails during key generation for a reason that has
 * nothing to do with the code under test.
 */

//  S5 (decision D5): the desktop updater's verification gate.
//
// The threat this is written against, stated once so every case below
// has a point: an attacker who owns downloads.xchain.io, or the
// Cloudflare account in front of it, can serve any binary they like
// AND a matching SHA512 in the channel pointer, because the yml is a checksum
// from the same party that served the file. On Windows and macOS the OS
// signature check catches that. On Linux nothing did.
//
// So the tests that matter are not "does a good update pass". They are
// the ones where the attacker controls everything the feed serves and
// still cannot get code installed.
//
// The fixtures use a key shaped like the real one: a certify-only
// primary with a separate signing subkey, per the ceremony runbook. A
// test that signed with the primary would pass while the real release,
// signed by a subkey, failed.

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as openpgp from 'openpgp';

import {
    fetchReleaseManifest,
    parseManifest,
    sha256File,
    verifyDownloadedUpdate,
    verifyManifestSignature,
    UPDATE_PINNED_PUBKEY_ARMORED,
    UPDATE_PINNED_FINGERPRINT,
} from '../../../packages/desktop/main/updateVerify.js';

// --- fixtures ----------------------------------------------------------

const ARTIFACT = 'XChain Wallet-9.9.9.AppImage';
const ARTIFACT_BYTES = Buffer.from('the real release\n');
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');

let signingKey;
let PINNED;          // { armoredKey, fingerprint }
let attackerKey;

beforeAll(async () => {
    const mk = async (name) => {
        const { privateKey, publicKey } = await openpgp.generateKey({
            type: 'ecc',
            curve: 'ed25519Legacy',
            userIDs: [{ name, email: `${name.replace(/\W/g, '')}@test.invalid` }],
            subkeys: [{ sign: true }],
            format: 'armored',
        });
        return {
            priv: await openpgp.readPrivateKey({ armoredKey: privateKey }),
            armoredKey: publicKey,
            pub: await openpgp.readKey({ armoredKey: publicKey }),
        };
    };
    const k1 = await mk('XChain Release');
    signingKey = k1.priv;
    PINNED = {
        armoredKey: k1.armoredKey,
        fingerprint: k1.pub.getFingerprint().toUpperCase(),
    };
    attackerKey = (await mk('Attacker')).priv;
}, 30_000);

function manifestFor({
    tag = 'v9.9.9',
    gate = 'enforced',
    entries = [[ARTIFACT, ARTIFACT_SHA]],
    count = null,
} = {}) {
    const lines = [
        '# XChain Wallet release manifest',
        '# manifest-version: 1',
        `# tag: ${tag}`,
        '# tag-commit: 1e3188fc8ee7cb0b3f74ba3f21ec15b13fbcc516',
        '# built: 2026-07-31T18:02:11Z',
        `# dev-mock-gate: ${gate}`,
        `# artifacts: ${count ?? entries.length}`,
    ];
    for (const [name, hash] of entries) lines.push(`${hash}  ./${name}`);
    return Buffer.from(`${lines.join('\n')}\n`);
}

// Detached, binary, armored: the same shape `gpg --detach-sign` emits.
async function signWith(bytes, key) {
    return openpgp.sign({
        message: await openpgp.createMessage({ binary: new Uint8Array(bytes) }),
        signingKeys: key ?? signingKey,
        detached: true,
        format: 'armored',
    });
}

async function good(overrides = {}) {
    const manifestBytes = manifestFor();
    return {
        manifestBytes,
        armoredSignature: await signWith(manifestBytes),
        expectedTag: 'v9.9.9',
        artifactPath: `/tmp/whatever/${ARTIFACT}`,
        artifactSha256: ARTIFACT_SHA,
        pinned: PINNED,
        ...overrides,
    };
}

// --- the shipped default ------------------------------------------------

describe('the pinned key as shipped', () => {
    it('is empty until the key ceremony runs', () => {
        // If either of these is non-empty without the ceremony having
        // happened, someone pinned a key from somewhere. This is the one
        // assertion in the file that must never be casually edited.
        expect(UPDATE_PINNED_PUBKEY_ARMORED).toBe('');
        expect(UPDATE_PINNED_FINGERPRINT).toBe('');
    });

    it('fails closed while empty rather than skipping the check', async () => {
        const params = await good();
        delete params.pinned;
        const result = await verifyDownloadedUpdate(params);
        expect(result).toEqual({ ok: false, reason: 'update-key-not-pinned' });
    });
});

// --- signature ----------------------------------------------------------

describe('manifest signature', () => {
    it('accepts a detached signature from the pinned key, made by its subkey', async () => {
        const m = manifestFor();
        const result = await verifyManifestSignature(m, await signWith(m), PINNED);
        expect(result).toEqual({ ok: true });
    });

    it('rejects a signature from any other key', async () => {
        const m = manifestFor();
        const result = await verifyManifestSignature(m, await signWith(m, attackerKey), PINNED);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/signature does not verify/);
    });

    it('rejects a manifest edited after signing, by one byte', async () => {
        const m = manifestFor();
        const sig = await signWith(m);
        const tampered = Buffer.concat([m, Buffer.from('#')]);
        const result = await verifyManifestSignature(tampered, sig, PINNED);
        expect(result.ok).toBe(false);
    });

    it('rejects a malformed or absent signature', async () => {
        const m = manifestFor();
        for (const sig of ['', 'nope', null, undefined]) {
            const r = await verifyManifestSignature(m, sig, PINNED);
            expect(r).toEqual({ ok: false, reason: 'missing or malformed signature' });
        }
    });

    it('rejects an armored block that is not a key', async () => {
        const m = manifestFor();
        const r = await verifyManifestSignature(m, await signWith(m), {
            armoredKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nnope\n-----END PGP PUBLIC KEY BLOCK-----',
            fingerprint: PINNED.fingerprint,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('pinned key is not a valid OpenPGP key');
    });

    it('rejects a pinned key whose fingerprint is not the pinned fingerprint', async () => {
        // The cross-check that catches a swapped armored block: the
        // signature would verify perfectly against the swapped key.
        const m = manifestFor();
        const r = await verifyManifestSignature(m, await signWith(m), {
            armoredKey: PINNED.armoredKey,
            fingerprint: 'DEADBEEF'.repeat(5),
        });
        expect(r).toEqual({
            ok: false, reason: 'pinned key does not match the pinned fingerprint',
        });
    });

    it('tolerates a fingerprint written with spaces and in lower case', async () => {
        const m = manifestFor();
        const spaced = PINNED.fingerprint.toLowerCase().replace(/(.{4})/g, '$1 ');
        const r = await verifyManifestSignature(m, await signWith(m), {
            armoredKey: PINNED.armoredKey, fingerprint: spaced,
        });
        expect(r).toEqual({ ok: true });
    });
});

// --- manifest parsing ---------------------------------------------------

describe('manifest parsing', () => {
    const text = (buf) => buf.toString('utf8');

    it('reads the header and the entries', () => {
        const parsed = parseManifest(text(manifestFor()));
        expect(parsed.ok).toBe(true);
        expect(parsed.header.tag).toBe('v9.9.9');
        expect(parsed.entries.get(ARTIFACT)).toBe(ARTIFACT_SHA);
    });

    it('refuses a manifest whose header count disagrees with its body', () => {
        // Truncation: drop a line, leave the header. Every remaining hash
        // is correct, so nothing else would notice.
        const parsed = parseManifest(text(manifestFor({ count: 4 })));
        expect(parsed.ok).toBe(false);
        expect(parsed.reason).toMatch(/claims 4 artifacts but carries 1/);
    });

    it('refuses a malformed hash line instead of skipping it', () => {
        // A checksum tool would skip this and still exit 0. That is how a
        // manifest gets to look checked without being checked.
        const broken = text(manifestFor()).replace(ARTIFACT_SHA, 'deadbeef');
        expect(parseManifest(broken)).toEqual({
            ok: false, reason: 'malformed manifest line',
        });
    });

    it('refuses a manifest with no header', () => {
        expect(parseManifest(`${ARTIFACT_SHA}  ./${ARTIFACT}\n`).ok).toBe(false);
    });
});

// --- the gate -----------------------------------------------------------

describe('verifyDownloadedUpdate', () => {
    it('accepts the artifact the maintainer signed for this version', async () => {
        expect(await verifyDownloadedUpdate(await good())).toEqual({ ok: true });
    });

    it('matches the artifact by name regardless of where it was downloaded', async () => {
        expect(await verifyDownloadedUpdate(await good({
            artifactPath: `/home/someone/.cache/xchain-updater/${ARTIFACT}`,
        }))).toEqual({ ok: true });
    });

    it('REFUSES A DOWNGRADE: a genuinely signed manifest from another release', async () => {
        // The whole attack: serve the real v9.9.8 binary and its real,
        // correctly signed manifest to a user on v9.9.9, moving them back
        // onto a version whose vulnerabilities are published. Every
        // signature is valid. Only the tag says no.
        const old = manifestFor({ tag: 'v9.9.8' });
        const result = await verifyDownloadedUpdate(await good({
            manifestBytes: old,
            armoredSignature: await signWith(old),
            expectedTag: 'v9.9.9',
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/describes v9\.9\.8, not v9\.9\.9/);
    });

    it('refuses an artifact the manifest does not cover', async () => {
        const result = await verifyDownloadedUpdate(await good({
            artifactPath: '/tmp/whatever/something-else.AppImage',
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/not covered by the signed manifest/);
    });

    it('refuses an artifact whose bytes do not match the signed hash', async () => {
        const result = await verifyDownloadedUpdate(await good({
            artifactSha256: createHash('sha256').update('malware').digest('hex'),
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/does not match the signed hash/);
    });

    it('refuses a release signed with the dev-mock gate skipped', async () => {
        // A build that fell back to the fabricated-address dev SDK is not
        // one to inherit just because the signature is good.
        const skipped = manifestFor({ gate: 'SKIPPED' });
        const result = await verifyDownloadedUpdate(await good({
            manifestBytes: skipped,
            armoredSignature: await signWith(skipped),
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/dev-mock gate SKIPPED/);
    });

    it('refuses when there is no version to check against', async () => {
        expect((await verifyDownloadedUpdate(await good({ expectedTag: '' }))).ok).toBe(false);
    });

    it('checks the signature before trusting anything in the manifest', async () => {
        // An unsigned manifest claiming the right tag and hash must not
        // get as far as being parsed for its own error messages.
        const result = await verifyDownloadedUpdate(await good({ armoredSignature: 'garbage' }));
        expect(result).toEqual({ ok: false, reason: 'missing or malformed signature' });
    });
});

// --- the end-to-end shape ----------------------------------------------

describe('a compromised update feed', () => {
    it('cannot get its binary installed even while serving everything', async () => {
        // The attacker owns the host: they choose the binary, its hash in
        // the yml, and the manifest they serve. The one thing they cannot
        // do is sign as the maintainer, so the update is refused.
        const evilBytes = Buffer.from('attacker code\n');
        const evilSha = createHash('sha256').update(evilBytes).digest('hex');
        const evilManifest = manifestFor({ entries: [[ARTIFACT, evilSha]] });

        const result = await verifyDownloadedUpdate({
            manifestBytes: evilManifest,
            armoredSignature: await signWith(evilManifest, attackerKey),
            expectedTag: 'v9.9.9',
            artifactPath: `/tmp/${ARTIFACT}`,
            artifactSha256: evilSha,
            pinned: PINNED,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/signature does not verify/);
    });

    it('cannot strip the signature to fall back to an unchecked path', async () => {
        for (const sig of ['', null, undefined]) {
            const r = await verifyDownloadedUpdate(await good({ armoredSignature: sig }));
            expect(r.ok).toBe(false);
        }
    });

    it('rejects a bad signature by refusing, not by crashing the main process', async () => {
        // openpgp reports a bad signature by REJECTING a promise. Awaited
        // in the wrong place that is an unhandled rejection, which in the
        // Electron main process is a crash rather than a refusal.
        const m = manifestFor();
        const sig = await signWith(m, attackerKey);
        await expect(verifyManifestSignature(m, sig, PINNED)).resolves.toMatchObject({ ok: false });
    });
});

// --- hashing + fetching -------------------------------------------------

describe('sha256File', () => {
    it('hashes the bytes on disk', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xc-upd-'));
        try {
            const p = join(dir, ARTIFACT);
            writeFileSync(p, ARTIFACT_BYTES);
            expect(await sha256File(p)).toBe(ARTIFACT_SHA);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('fetchReleaseManifest', () => {
    const okRes = (body) => ({
        ok: true,
        status: 200,
        text: async () => body,
        arrayBuffer: async () => Buffer.from(body),
    });

    it('fetches the manifest and its .asc for a tag', async () => {
        const seen = [];
        const result = await fetchReleaseManifest({
            feedBaseUrl: 'https://downloads.xchain.io/wallet/',
            tag: 'v9.9.9',
            fetch: async (url) => {
                seen.push(url);
                return okRes(url.endsWith('.asc') ? 'SIGNATURE' : 'manifest');
            },
        });
        expect(result.ok).toBe(true);
        expect(seen).toContain('https://downloads.xchain.io/wallet/RELEASE_HASHES/v9.9.9.txt');
        expect(seen).toContain('https://downloads.xchain.io/wallet/RELEASE_HASHES/v9.9.9.txt.asc');
        // Bytes, not a string: what gets verified must be what was served.
        expect(result.manifestBytes).toBeInstanceOf(Uint8Array);
    });

    it('refuses a non-https feed', async () => {
        const result = await fetchReleaseManifest({
            feedBaseUrl: 'http://downloads.xchain.io/wallet/',
            tag: 'v9.9.9',
            fetch: async () => okRes('nope'),
        });
        expect(result).toEqual({ ok: false, reason: 'update feed must be https' });
    });

    it('reports a missing signature rather than proceeding without one', async () => {
        const result = await fetchReleaseManifest({
            feedBaseUrl: 'https://downloads.xchain.io/wallet/',
            tag: 'v9.9.9',
            fetch: async (url) => (url.endsWith('.asc')
                ? { ok: false, status: 404 }
                : okRes('manifest')),
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/signature fetch failed \(404\)/);
    });

    it('survives a network error without throwing', async () => {
        const result = await fetchReleaseManifest({
            feedBaseUrl: 'https://downloads.xchain.io/wallet/',
            tag: 'v9.9.9',
            fetch: async () => { throw new Error('ENOTFOUND'); },
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/unreachable/);
    });
});
