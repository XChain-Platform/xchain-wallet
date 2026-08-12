// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the desktop shell ships ITS OWN app icon.
//
// WHAT THIS IS DEFENDING. Until 2026-08-01 `packages/desktop/build/` held
// no icon at all. electron-builder's response to that is a log line -
// "default Electron icon is used" - and then a perfectly successful build,
// so the first real macOS lane run produced an app whose Info.plist read
// `CFBundleIconFile = electron.icns`. Shipping the framework's own logo is
// the same defect found on both mobile shells, and no gate caught
// it there either, because every check in this area verifies wiring and
// identifiers rather than pixels.
//
// Coverage:
//
//   1. All three assets exist and are non-trivial.
//   2. The config names each one EXPLICITLY per platform, rather than
//      relying on the implicit build/icon.* lookup that fails silently.
//   3. The PNG master is a 1024x1024 RGBA image with real transparency -
//      an opaque square would show as a white tile in the Dock.
//   4. The artwork is the XChain mark: both brand colours present, in
//      the approved iOS geometry (~78% of canvas width, centred).
//   5. The .icns and .ico are real containers carrying the sizes each OS
//      actually asks for, including the 16px the Windows title bar and
//      the macOS menu bar use.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const buildDir = join(desktop, 'build');
const requireCjs = createRequire(import.meta.url);

const BRAND_BLUE = [0, 124, 181];
const BRAND_PURPLE = [112, 48, 119];

// --- 1. The assets exist ----------------------------------------------

for (const [file, minBytes] of [['icon.png', 5000], ['icon.icns', 20000], ['icon.ico', 2000]]) {
    const path = join(buildDir, file);
    assert.ok(existsSync(path), `build/${file} exists (absent = the app ships Electron's logo)`);
    assert.ok(
        statSync(path).size >= minBytes,
        `build/${file} is a real icon, not a stub (${statSync(path).size} bytes)`,
    );
}

// --- 2. Named explicitly, per platform --------------------------------

const config = requireCjs(join(desktop, 'electron-builder.config.cjs'));
for (const [platform, expected] of [
    ['mac', 'build/icon.icns'],
    ['win', 'build/icon.ico'],
    ['linux', 'build/icon.png'],
]) {
    assert.equal(
        config[platform].icon,
        expected,
        `${platform}.icon is named explicitly; the implicit lookup is silent when it finds nothing`,
    );
}

// --- 3/4. The PNG master ----------------------------------------------

// Minimal RGBA8 PNG reader: enough to assert on pixels, which is the only
// kind of check that would have caught the placeholder.
function readRgbaPng(file) {
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file} is a PNG`);
    let pos = 8;
    let width = 0, height = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            assert.equal(data[8], 8, 'icon.png is 8 bits per channel');
            assert.equal(data[9], 6, 'icon.png is RGBA (colour type 6): it must carry an alpha channel');
            assert.equal(data[12], 0, 'icon.png is not interlaced');
        } else if (type === 'IDAT') idat.push(Buffer.from(data));
        else if (type === 'IEND') break;
        pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const out = Buffer.alloc(height * stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
        for (let i = 0; i < stride; i++) {
            const a = i >= 4 ? cur[i - 4] : 0;
            const b = prev[i];
            const c = i >= 4 ? prev[i - 4] : 0;
            let v = cur[i];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[i] = v & 0xff;
        }
        cur.copy(out, y * stride);
        prev = cur;
    }
    return { width, height, rgba: out };
}

const master = readRgbaPng(join(buildDir, 'icon.png'));
assert.equal(master.width, 1024, 'icon.png master is 1024 wide (macOS asks for 1024)');
assert.equal(master.height, 1024, 'icon.png master is square');

const alphaAt = (x, y) => master.rgba[(y * master.width + x) * 4 + 3];
for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023], [512, 20]]) {
    assert.equal(alphaAt(x, y), 0, `icon.png is transparent at (${x},${y}), not a white tile`);
}

let opaque = 0;
let blue = 0;
let purple = 0;
let minX = master.width, maxX = -1, minY = master.height, maxY = -1;
for (let y = 0; y < master.height; y++) {
    for (let x = 0; x < master.width; x++) {
        const i = (y * master.width + x) * 4;
        if (master.rgba[i + 3] <= 8) continue;
        opaque += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const near = (c) => Math.abs(master.rgba[i] - c[0]) < 12
            && Math.abs(master.rgba[i + 1] - c[1]) < 12
            && Math.abs(master.rgba[i + 2] - c[2]) < 12;
        if (near(BRAND_BLUE)) blue += 1;
        if (near(BRAND_PURPLE)) purple += 1;
    }
}

assert.ok(opaque > 50000, `icon.png has real artwork (${opaque} opaque pixels)`);
assert.ok(blue > 20000, `the XChain blue link is present (${blue} px)`);
assert.ok(purple > 20000, `the XChain purple link is present (${purple} px)`);

// The approved iOS geometry: mark at ~78% of canvas width,
// centred both ways. A wordmark creeping back in would break the aspect.
const contentWidth = maxX - minX + 1;
const contentHeight = maxY - minY + 1;
assert.ok(
    Math.abs(contentWidth / master.width - 0.78) < 0.03,
    `the mark spans ~78% of the canvas, matching the approved iOS icon (got ${(contentWidth / master.width).toFixed(3)})`,
);
assert.ok(
    Math.abs(contentWidth / contentHeight - 2.45) < 0.15,
    `the artwork is the mark alone at its natural 2.45:1, so no wordmark crept in (got ${(contentWidth / contentHeight).toFixed(2)}:1)`,
);
assert.ok(
    Math.abs(minY - (master.height - 1 - maxY)) <= 2 && Math.abs(minX - (master.width - 1 - maxX)) <= 2,
    'the mark is centred on both axes',
);

// --- 5. The platform containers ---------------------------------------

const icns = readFileSync(join(buildDir, 'icon.icns'));
assert.equal(icns.toString('ascii', 0, 4), 'icns', 'icon.icns carries the icns magic');
assert.equal(icns.readUInt32BE(4), icns.length, 'the icns length field matches the file');
const icnsTypes = new Set();
for (let pos = 8; pos < icns.length - 8;) {
    const type = icns.toString('ascii', pos, pos + 4);
    const len = icns.readUInt32BE(pos + 4);
    if (len < 8) break;
    icnsTypes.add(type);
    pos += len;
}
// ic04/ic05 are the 16pt and 32pt entries the menu bar and Finder use;
// ic10 is the 512@2x (1024) entry the Dock uses at its largest.
for (const type of ['ic04', 'ic05', 'ic10']) {
    assert.ok(icnsTypes.has(type), `icon.icns carries the ${type} entry`);
}

const ico = readFileSync(join(buildDir, 'icon.ico'));
assert.equal(ico.readUInt16LE(0), 0, 'icon.ico reserved field is 0');
assert.equal(ico.readUInt16LE(2), 1, 'icon.ico type field says icon');
const icoCount = ico.readUInt16LE(4);
assert.ok(icoCount >= 5, `icon.ico carries several sizes (${icoCount})`);
const icoSizes = new Set();
for (let i = 0; i < icoCount; i++) {
    const e = 6 + i * 16;
    const declared = ico[e] === 0 ? 256 : ico[e];
    icoSizes.add(declared);
    const size = ico.readUInt32LE(e + 8);
    const offset = ico.readUInt32LE(e + 12);
    assert.ok(offset + size <= ico.length, `icon.ico entry ${i} points inside the file`);
    assert.equal(
        ico.readUInt32BE(offset),
        0x89504e47,
        `icon.ico entry ${i} is a PNG-compressed image`,
    );
}
for (const size of [16, 32, 256]) {
    assert.ok(icoSizes.has(size), `icon.ico carries the ${size}px entry Windows asks for`);
}

console.log(
    'OK: desktop icons smoke (build/icon.{png,icns,ico} exist and are named explicitly as'
        + 'mac.icon/win.icon/linux.icon rather than left to the silent implicit lookup; the PNG master is '
        + '1024x1024 RGBA with transparent corners, carries both brand colours, and holds the mark alone '
        + 'at the approved iOS geometry - ~78% of canvas width, 2.45:1, centred on both axes, so no '
        + 'wordmark creeps back in; the icns is a valid container with the 16pt/32pt/1024 entries macOS '
        + 'uses; the ico is a valid container whose entries are PNG-compressed and include 16/32/256)',
);
