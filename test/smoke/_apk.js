// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dependency-free zip/APK WRITER, enough to let a smoke hand a release tool
// a file that is really an APK.
//
// Written for, which put a check on the publish path that reads
// inside the .apk (tools/release/verify-apk-play-protection.mjs: does this
// artifact carry the licence check Google injects into the builds IT signs?).
// Until then every release fixture in the smoke tree wrote the four bytes
// `apk-bytes` under an .apk name, which was enough for tools that only ever
// hashed the file or looked at its extension.
//
// Kept as a helper rather than inlined so the two smokes that need one build
// the SAME artifact shape, and so a fixture stays a few lines at the call
// site: an APK the publish gate must accept, or one carrying Play's injection
// that it must refuse, differ here by one argument.
//
// Deliberately minimal and deliberately not a zip library: stored and
// deflated entries, local headers that carry extra fields the central
// directory does not (the offset trap a hand-rolled reader falls into), no
// zip64, no encryption, no directory entries.

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

export const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
};

/**
 * @param {{name: string, body: Buffer, store?: boolean, extra?: number}[]} files
 * @returns {Buffer} a zip archive
 */
export function buildZip(files) {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
        const method = f.store ? 0 : 8;
        const data = f.store ? f.body : deflateRawSync(f.body);
        const name = Buffer.from(f.name, 'utf8');
        const extra = Buffer.alloc(f.extra ?? 0);

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(method, 8);
        lh.writeUInt32LE(crc32(f.body), 14);
        lh.writeUInt32LE(data.length, 18);
        lh.writeUInt32LE(f.body.length, 22);
        lh.writeUInt16LE(name.length, 26);
        lh.writeUInt16LE(extra.length, 28);
        locals.push(lh, name, extra, data);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(method, 10);
        cd.writeUInt32LE(crc32(f.body), 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(f.body.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt32LE(offset, 42);
        central.push(cd, name);

        offset += 30 + name.length + extra.length + data.length;
    }

    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cdBuf, eocd]);
}

// A dex body that looks like compiled code rather than like the needle a
// scanner searches for, so a hit is a substring match inside real content.
export const dexBody = (classes = []) => Buffer.from(
    ['dex\n039\0', 'Lio/xchain/wallet/android/MainActivity;', 'Landroidx/core/app/ActivityCompat;',
        ...classes, 'Ljava/lang/Object;'].join('\0'),
    'latin1',
);

// The binary manifest keeps its string pool in UTF-16LE, with short strings
// sometimes arriving as UTF-8. Both encodings appear here on purpose: a
// scanner that searches one of them reports a clean manifest on an injected
// one.
export const manifestBody = (strings = []) => Buffer.concat([
    Buffer.from([0x03, 0x00, 0x08, 0x00]),
    Buffer.from('io.xchain.wallet.android', 'utf16le'),
    Buffer.from('android.permission.CAMERA', 'utf16le'),
    ...strings.map((s, i) => Buffer.from(s, i % 2 === 0 ? 'utf16le' : 'latin1')),
]);

/**
 * A minimal but structurally real APK.
 *
 * @param {{dexClasses?: string[], manifestStrings?: string[], extraEntries?: {name: string, body?: string}[]}} opts
 * @returns {Buffer}
 */
export function buildApk({ dexClasses = [], manifestStrings = [], extraEntries = [] } = {}) {
    return buildZip([
        { name: 'AndroidManifest.xml', body: manifestBody(manifestStrings), store: true },
        { name: 'classes.dex', body: dexBody(dexClasses), extra: 12 },
        { name: 'resources.arsc', body: Buffer.from('arsc'), store: true },
        { name: 'META-INF/XCHAIN-D.RSA', body: Buffer.from('signature'), extra: 4 },
        ...extraEntries.map((e) => ({
            name: e.name, body: Buffer.from(e.body ?? 'x'), store: true,
        })),
    ]);
}

/**
 * An APK carrying Google Play's injected licence check, in the shape the real
 * one has: the classes in the dex, the declarations in the manifest, the
 * source stamp as its own zip entry.
 */
export function buildPlayInjectedApk() {
    return buildApk({
        dexClasses: ['Lcom/pairip/licensecheck/LicenseClient;', 'Lcom/pairip/application/Application;'],
        manifestStrings: [
            'com.pairip.application.Application',
            'com.pairip.licensecheck.LicenseActivity',
            'com.android.vending.CHECK_LICENSE',
        ],
        extraEntries: [{ name: 'stamp-cert-sha256', body: '0123456789abcdef' }],
    });
}
