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

// S5 (decision D5): the desktop updater's verification gate.
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
    channelPointerName,
    fetchChannelPointer,
    fetchReleaseManifest,
    parseChannelPointer,
    parseManifest,
    sha256File,
    sha512File,
    verifyChannelPointer,
    verifyDownloadedUpdate,
    verifyManifestSignature,
    UPDATE_PINNED_PUBKEY_ARMORED,
    UPDATE_PINNED_FINGERPRINT,
} from '../../../packages/desktop/main/updateVerify.js';

// --- fixtures ----------------------------------------------------------

const ARTIFACT = 'xchain-wallet-9.9.9-x86_64.AppImage';
const ARTIFACT_BYTES = Buffer.from('the real release\n');
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');
const ARTIFACT_SHA512 = createHash('sha512').update(ARTIFACT_BYTES).digest('hex');

// The other lane's artifact. Genuinely built, genuinely signed, and not
// for this install: the case the artifact gate alone cannot see.
const DEB = 'xchain-wallet_9.9.9_amd64.deb';
const DEB_BYTES = Buffer.from('the real deb\n');
const DEB_SHA = createHash('sha256').update(DEB_BYTES).digest('hex');
const DEB_SHA512 = createHash('sha512').update(DEB_BYTES).digest('hex');

/**
 * A channel pointer in electron-builder's shape. sha512 is emitted in
 * base64, which is the spelling a real `stable-linux.yml` carries, so a
 * gate that only understood hex would pass every test and refuse every
 * real update.
 */
function pointerFor({
    version = '9.9.9',
    files = [[ARTIFACT, ARTIFACT_SHA512]],
    topLevel = true,
} = {}) {
    const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');
    const lines = [`version: ${version}`, 'files:'];
    for (const [name, hex] of files) {
        lines.push(`  - url: ${name}`, `    sha512: ${b64(hex)}`, '    size: 17');
    }
    if (topLevel) lines.push(`path: ${files[0][0]}`, `sha512: ${b64(files[0][1])}`);
    lines.push("releaseDate: '2026-07-31T18:02:11.000Z'");
    return `${lines.join('\n')}\n`;
}

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
    lanes = null,
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
    // The two fields sign.sh --lane writes for a PARTIAL release.
    if (lanes) lines.push('# coverage: partial', `# lanes: ${lanes}`);
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
        artifactSha512: ARTIFACT_SHA512,
        pointerText: pointerFor(),
        pinned: PINNED,
        ...overrides,
    };
}

// --- the shipped default ------------------------------------------------

describe('the pinned key as shipped', () => {
    // These two used to assert the constants were EMPTY, on the reasoning
    // that a non-empty pin before the ceremony meant someone had pinned a
    // key from somewhere. That was right until 2026-08-06, when the
    // ceremony ran - and then it was a guard that failed the moment the
    // thing it guarded actually happened, which is the same shape the
    // release-key mutation harness was caught in on the same day. The
    // check that survives the ceremony is not "is it empty" but "do the
    // two constants describe the same real key", so that is what this
    // asserts now.
    it('ships a real key whose fingerprint matches the pinned one', async () => {
        expect(UPDATE_PINNED_PUBKEY_ARMORED).toMatch(/BEGIN PGP PUBLIC KEY BLOCK/);
        expect(UPDATE_PINNED_FINGERPRINT).toMatch(/^[0-9A-F]{40}$/);

        // Parsed, not pattern-matched. A swapped armored block that merely
        // looks plausible is the failure the fingerprint constant exists to
        // catch, and only openpgp can say whether the two agree.
        const key = await openpgp.readKey({ armoredKey: UPDATE_PINNED_PUBKEY_ARMORED });
        expect(key.getFingerprint().toUpperCase()).toBe(UPDATE_PINNED_FINGERPRINT);

        // The primary is certify-only and offline; every manifest signature
        // is made by a subkey, so a pin carrying only the primary would
        // verify nothing the app will ever actually see.
        expect(key.getSubkeys().length).toBeGreaterThan(0);
    });

    it('fails closed when nothing is pinned rather than skipping the check', async () => {
        // Passed explicitly rather than relying on the shipped constants
        // being empty. That reliance is exactly what broke this block when
        // the ceremony ran: the behaviour under test is "no key pinned",
        // not "no key exists yet".
        const result = await verifyDownloadedUpdate(await good({
            pinned: { armoredKey: '', fingerprint: '' },
        }));
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

    it('refuses a PARTIAL manifest, which never covered the desktop lane', async () => {
        // sign.sh --lane signs one lane's artifacts on their own,
        // so an Android manifest can be perfectly signed, name the right
        // tag, and have been gated against the Android pair alone. It is
        // not wrong; it is simply not about this artifact.
        //
        // The entry is DELIBERATELY present here. Without the coverage
        // check a partial manifest that happened to hash a same-named file
        // would authorize the install, and with the check the refusal has
        // to come from the coverage field rather than from a hash miss -
        // which is what makes this test able to tell the two apart.
        const partial = manifestFor({ lanes: 'android' });
        const result = await verifyDownloadedUpdate(await good({
            manifestBytes: partial,
            armoredSignature: await signWith(partial),
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/covers only the android lane, not a full release/);
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

// --- the channel pointer -------------------------------------
//
// Everything above authenticates the BYTES. Nothing above authenticated
// the file that chose them. §7.2 accepted that residual in
// writing for launch; these are the tests for the deferred half.

describe('channelPointerName', () => {
    it('names the pointer electron-builder actually emits, per lane', () => {
        const at = (platform, arch) => channelPointerName({ channel: 'stable', platform, arch });
        // The §7.1 matrix, confirmed against a real build 2026-07-31.
        expect(at('win32', 'x64')).toBe('stable.yml');
        expect(at('win32', 'arm64')).toBe('stable.yml');
        expect(at('darwin', 'arm64')).toBe('stable-mac.yml');
        expect(at('linux', 'x64')).toBe('stable-linux.yml');
        expect(at('linux', 'arm64')).toBe('stable-linux-arm64.yml');
        // armv7l is `-arm`, NOT `-armv7l`, and Node spells it `arm` too.
        expect(at('linux', 'arm')).toBe('stable-linux-arm.yml');
    });

    it('follows the baked channel, so a staging rehearsal checks staging', () => {
        expect(channelPointerName({ channel: 'staging', platform: 'linux', arch: 'x64' }))
            .toBe('staging-linux.yml');
    });

    it('refuses to build a name out of a channel that could escape the feed dir', () => {
        for (const channel of ['', '../stable', 'sta/ble', '..']) {
            expect(channelPointerName({ channel, platform: 'linux', arch: 'x64' })).toBeNull();
        }
    });
});

describe('parseChannelPointer', () => {
    it('reads the version and every file the pointer names', () => {
        const parsed = parseChannelPointer(pointerFor({
            files: [[ARTIFACT, ARTIFACT_SHA512], [DEB, DEB_SHA512]],
        }));
        expect(parsed.ok).toBe(true);
        expect(parsed.version).toBe('9.9.9');
        expect(parsed.files.map((f) => f.url)).toEqual([ARTIFACT, DEB]);
    });

    it('records a top-level path: that files: did not already name', () => {
        // Editing only the legacy pair is the cheapest tamper available,
        // and a walk over `files:` alone would never look at it.
        const text = `${pointerFor({ topLevel: false })}path: ${DEB}\nsha512: ${
            Buffer.from(DEB_SHA512, 'hex').toString('base64')}\n`;
        const parsed = parseChannelPointer(text);
        expect(parsed.files.map((f) => f.url)).toContain(DEB);
    });

    it('refuses a pointer with no version or no files rather than reading it as empty', () => {
        expect(parseChannelPointer('files:\n  - url: x\n').ok).toBe(false);
        expect(parseChannelPointer('version: 9.9.9\n').ok).toBe(false);
        expect(parseChannelPointer('').ok).toBe(false);
        expect(parseChannelPointer(null).ok).toBe(false);
    });

    it('reads a CRLF pointer the same as an LF one', () => {
        const crlf = pointerFor().replace(/\n/g, '\r\n');
        expect(parseChannelPointer(crlf).files[0].url).toBe(ARTIFACT);
    });
});

describe('verifyChannelPointer', () => {
    const entries = () => new Map([[ARTIFACT, ARTIFACT_SHA], [DEB, DEB_SHA]]);
    const args = (o = {}) => ({
        pointerText: pointerFor(),
        expectedVersion: '9.9.9',
        artifactName: ARTIFACT,
        artifactSha512: ARTIFACT_SHA512,
        entries: entries(),
        ...o,
    });

    it('accepts the pointer the release actually published', () => {
        expect(verifyChannelPointer(args())).toEqual({ ok: true });
    });

    it('accepts a tag with its leading v, since that is how the manifest spells it', () => {
        expect(verifyChannelPointer(args({ expectedVersion: 'v9.9.9' }))).toEqual({ ok: true });
    });

    it('reads the sha512 as base64, which is how a real pointer writes it', () => {
        // Guard against a gate that only compared hex: it would pass every
        // fixture written in hex and refuse every real update.
        expect(pointerFor()).toContain(Buffer.from(ARTIFACT_SHA512, 'hex').toString('base64'));
        expect(verifyChannelPointer(args())).toEqual({ ok: true });
    });

    it('REFUSES A VALIDLY-HASHED POINTER NAMING ANYTHING K1 DID NOT SIGN', () => {
        // The whole item. The attacker owns the feed, so their pointer is
        // internally perfect: it names their AppImage and carries its real
        // sha512. What they cannot do is get that name into a manifest K1
        // signed, and this is the line that notices.
        const evilBytes = Buffer.from('attacker code\n');
        const evilSha512 = createHash('sha512').update(evilBytes).digest('hex');
        const result = verifyChannelPointer(args({
            pointerText: pointerFor({ files: [['evil.AppImage', evilSha512]] }),
            artifactName: 'evil.AppImage',
            artifactSha512: evilSha512,
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/evil\.AppImage, which the signed manifest does not cover/);
    });

    it('refuses an uncovered file listed BESIDE a covered one', () => {
        // Only the covered entry is downloaded, so a check that looked at
        // the downloaded file alone would pass. The other entry is another
        // lane's install, being handed an artifact nothing signed.
        const evilSha512 = createHash('sha512').update('other lane').digest('hex');
        const result = verifyChannelPointer(args({
            pointerText: pointerFor({
                files: [[ARTIFACT, ARTIFACT_SHA512], ['evil.deb', evilSha512]],
            }),
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/evil\.deb/);
    });

    it('refuses a pointer for a different version than the one being installed', () => {
        // This is what makes re-fetching the pointer safe. A feed that
        // serves the checker one pointer and the verifier another gets a
        // refusal rather than a second opinion.
        const result = verifyChannelPointer(args({ pointerText: pointerFor({ version: '9.9.8' }) }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/describes 9\.9\.8, not 9\.9\.9/);
    });

    it('refuses a pointer that does not name the file that arrived', () => {
        const result = verifyChannelPointer(args({
            pointerText: pointerFor({ files: [[DEB, DEB_SHA512]] }),
        }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/does not name xchain-wallet-9\.9\.9-x86_64\.AppImage/);
    });

    it('refuses when the pointer sha512 is not the bytes that arrived', () => {
        const result = verifyChannelPointer(args({ artifactSha512: DEB_SHA512 }));
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/is not the file that arrived/);
    });

    it('refuses a pointer carrying no usable sha512 at all', () => {
        for (const junk of ['', 'not-a-hash!!', 'aGk=']) {
            const text = pointerFor().replace(/sha512: .*/g, `sha512: ${junk}`);
            expect(verifyChannelPointer(args({ pointerText: text })).ok).toBe(false);
        }
    });

    it('refuses a malformed downloaded-artifact hash instead of comparing junk', () => {
        expect(verifyChannelPointer(args({ artifactSha512: 'deadbeef' })).ok).toBe(false);
    });

    it('has no missing-pointer branch to fall through', () => {
        for (const pointerText of ['', null, undefined]) {
            expect(verifyChannelPointer(args({ pointerText })).ok).toBe(false);
        }
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

    it('cannot smuggle an uncovered artifact through a pointer that is otherwise honest', async () => {
        // The residual names. Every check the artifact gate owns
        // says yes: the downloaded file is the genuine AppImage, K1
        // signed its hash, the tag matches. The tampering is in the
        // pointer's OTHER entry, which hands a different lane a file
        // nothing signed, and which nothing read before this change.
        const manifestBytes = manifestFor({
            entries: [[ARTIFACT, ARTIFACT_SHA], [DEB, DEB_SHA]],
        });
        const evilSha512 = createHash('sha512').update('attacker code\n').digest('hex');
        const result = await verifyDownloadedUpdate({
            manifestBytes,
            armoredSignature: await signWith(manifestBytes),
            expectedTag: 'v9.9.9',
            artifactPath: `/tmp/${ARTIFACT}`,
            artifactSha256: ARTIFACT_SHA,
            artifactSha512: ARTIFACT_SHA512,
            pointerText: pointerFor({
                files: [[ARTIFACT, ARTIFACT_SHA512], ['evil.AppImage', evilSha512]],
            }),
            pinned: PINNED,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/evil\.AppImage, which the signed manifest does not cover/);
    });

    it('cannot strip the pointer to fall back to an unchecked path', async () => {
        for (const pointerText of ['', null, undefined]) {
            const r = await verifyDownloadedUpdate(await good({ pointerText }));
            expect(r.ok).toBe(false);
        }
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

describe('sha256File / sha512File', () => {
    it('hashes the bytes on disk', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xc-upd-'));
        try {
            const p = join(dir, ARTIFACT);
            writeFileSync(p, ARTIFACT_BYTES);
            expect(await sha256File(p)).toBe(ARTIFACT_SHA);
            // The pointer speaks sha512, the manifest speaks sha256, and
            // both must be taken from the file rather than from the feed.
            expect(await sha512File(p)).toBe(ARTIFACT_SHA512);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('fetchChannelPointer', () => {
    const okRes = (body) => ({ ok: true, status: 200, text: async () => body });

    it('fetches this build\'s pointer from the desktop feed', async () => {
        const seen = [];
        const result = await fetchChannelPointer({
            feedBaseUrl: 'https://downloads.xchain.io/wallet/',
            pointerName: 'stable-linux.yml',
            fetch: async (url, opts) => { seen.push([url, opts]); return okRes('version: 9.9.9\n'); },
        });
        expect(result.ok).toBe(true);
        expect(seen[0][0]).toBe('https://downloads.xchain.io/wallet/desktop/stable-linux.yml');
        // The feed serves pointers no-store (§7.3); a cached copy here
        // would be a second answer to a question that must have one.
        expect(seen[0][1]).toMatchObject({ cache: 'no-store' });
    });

    it('refuses a non-https feed, exactly as the manifest fetch does', async () => {
        const r = await fetchChannelPointer({
            feedBaseUrl: 'http://downloads.xchain.io/wallet/',
            pointerName: 'stable-linux.yml',
            fetch: async () => okRes(''),
        });
        expect(r).toEqual({ ok: false, reason: 'update feed must be https' });
    });

    it('refuses a pointer name that could walk out of the feed directory', async () => {
        for (const pointerName of ['../RELEASE_HASHES/v1.txt', 'a/b.yml', 'stable.txt', '', null]) {
            const r = await fetchChannelPointer({
                feedBaseUrl: 'https://downloads.xchain.io/wallet/',
                pointerName,
                fetch: async () => okRes(''),
            });
            expect(r.ok).toBe(false);
        }
    });

    it('fails closed when the pointer is missing or the fetch throws', async () => {
        const missing = await fetchChannelPointer({
            feedBaseUrl: 'https://downloads.xchain.io/wallet/',
            pointerName: 'stable-linux.yml',
            fetch: async () => ({ ok: false, status: 404 }),
        });
        expect(missing).toMatchObject({ ok: false });
        expect(missing.reason).toMatch(/404/);

        const thrown = await fetchChannelPointer({
            feedBaseUrl: 'https://downloads.xchain.io/wallet/',
            pointerName: 'stable-linux.yml',
            fetch: async () => { throw new Error('ECONNRESET'); },
        });
        expect(thrown).toMatchObject({ ok: false });
        expect(thrown.reason).toMatch(/ECONNRESET/);
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
