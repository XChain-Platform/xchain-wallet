// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The pixel gate for the mobile shells' brand art.
//
// Both shells shipped the Capacitor TEMPLATE logo as their app icon, and both
// shipped its launch art, all the way to a store-ready build. Nothing caught
// it because every mobile gate in this repo checks wiring and identifiers:
// file present, id correct, manifest wired. None of them had ever looked at a
// pixel, so stock framework art passed every one of them.
//
// This smoke looks at pixels. It has three jobs:
//
//   1. INVENTORY. All 15 Android density assets (legacy square + round +
//      adaptive foreground across 5 densities), all 11 launch drawables, and
//      the iOS icon set with its light/dark/tinted appearances. A missing
//      density silently degrades to an upscaled smaller one on device.
//   2. NOT THE TEMPLATE. Every shipped PNG under packages/mobile is checked
//      against the template's byte digests, and every branded asset is also
//      checked PERCEPTUALLY, so re-exported or resized template art is caught
//      too. `cap sync`, a Capacitor upgrade or a fresh `npx cap add` all
//      restore the stock files; the byte list alone would only catch the
//      first of those.
//   3. OURS, AND USABLE. The XChain mark's two link colours are present and
//      balanced (one link blue, one purple), Apple's no-alpha rule holds for
//      the 1024 icon, and the adaptive foreground sits inside the mask's safe
//      zone so no launcher shape can clip it.
//
// The template reference is frozen from commit 0b3239b7, the scaffold commit
// that generated both shells from the Capacitor template: digests and
// fingerprints of the exact art the operator found on the simulators.

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { colourShare, contentBox, decode, hasAlpha, hammingDistance, markFingerprint, readHeader } from '../_png.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const mobile = join(wsRoot, 'packages', 'mobile');
const res = join(mobile, 'android', 'app', 'src', 'main', 'res');
const xcassets = join(mobile, 'ios', 'App', 'App', 'Assets.xcassets');
const appIcon = join(xcassets, 'AppIcon.appiconset');
const iosSplash = join(xcassets, 'Splash.imageset');

const fail = (message) => {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
};

// --- the template reference (frozen from 0b3239b7) ---------------------

// Byte digests of every icon and launch image the Capacitor template put in
// the two shells. Anything under packages/mobile hashing to one of these is
// stock art, wherever it turns up.
const TEMPLATE_DIGESTS = new Set([
    '08cc34ad7713fe7ed58bceaa37b2387b670c53cd60264b4bd6442db3098e75dc',   // drawable-land-hdpi/splash.png
    '5cf98b4451bd99b20df26f9e608a46946118be6b0ae90762f9ca1786a30c76ff',   // drawable-land-mdpi/splash.png + drawable/splash.png
    '22f87e1e3bc89aa01a7dbc39c9a4db058cd0bf4ad3fe9f55712bf69eb997f4bf',   // drawable-land-xhdpi/splash.png
    '42aa26392546fcdee1b8d3ac6d4b41bfcceb41dc6a4f3a3c30c24a8a8f4db862',   // drawable-land-xxhdpi/splash.png
    '60393ce8636fd263e4e1fea3fd4ab2de948c6295e898fda9b50ac4e5283be809',   // drawable-land-xxxhdpi/splash.png
    'c5015f4ba3628392b538386c5e210f0b94f352a3160adab934fd0311972137ca',   // drawable-port-hdpi/splash.png
    '07fa579e1c83e04ba7f9cbcbfcf41b68e15fe3638f2c44a04e58b809103e6b69',   // drawable-port-mdpi/splash.png
    'b73049cb37fe76d6c11b87a796766bf6af0c85483b31eb6a921657b0d764a4b9',   // drawable-port-xhdpi/splash.png
    '0c7f1212f25b7b90e9a6e1d320013e4ff3d3e03e634cbb07b7b7981cac51627f',   // drawable-port-xxhdpi/splash.png
    '3db071a03b2f8ffe0dfd4170fc59842d53cd15bba5e88af59401d58efabf7827',   // drawable-port-xxxhdpi/splash.png
    '72b71c3581ca3b5a23b1c168d69b9d855b3f184fa079902a01f088eb4f0607d5',   // mipmap-hdpi/ic_launcher.png
    '32baa10d2632a4417454a579f992bd640e0a3cec79321423559b2c9940de58a9',   // mipmap-hdpi/ic_launcher_foreground.png
    'bfcc1b0fa931b14bb241372c76ab4f04374b67d02363c98d9cb12edfdacdf5f3',   // mipmap-hdpi/ic_launcher_round.png
    '27ed3603010ebc278f64f8645741ab132ff517abb5308eb9df6c8e42a48956b2',   // mipmap-mdpi/ic_launcher.png
    '58e78a618778926b1f6d9472a6468de878de8530970934e94aab5ba4ba08cc00',   // mipmap-mdpi/ic_launcher_foreground.png
    '0166fc333074c373fbd0ce6b5defd71552166165ac778121ca9c9dff6b83f0fc',   // mipmap-mdpi/ic_launcher_round.png
    'd35dbfff175b83c13ef59cf924abfc810f7b6a158595d7417c5498ea8c7c7ed1',   // mipmap-xhdpi/ic_launcher.png
    '6f88083b8166cc559102f7044688de7525287632ebe09ac45d001ac8bf4b3eae',   // mipmap-xhdpi/ic_launcher_foreground.png
    '40911a00922868686854a4804b93fd6e56b503664696de03f450bff690affb6d',   // mipmap-xhdpi/ic_launcher_round.png
    'ed346eb1e3f0280f15709393705899b3ff55c20b88f4e0308006b3c33cf5fe14',   // mipmap-xxhdpi/ic_launcher.png
    '4a82bc1e9923576275869998925ce0ae021a79aa18b24a0dd87ad6b61ca85053',   // mipmap-xxhdpi/ic_launcher_foreground.png
    '1ee4cd9ff371dcb2e3938097e434f6fb8731688ed7165e61fc63693ad5b2f455',   // mipmap-xxhdpi/ic_launcher_round.png
    '87cb2f2ffe992652bb4fa768c73719a37b5852ab17fbf8e170e888f7a42b0761',   // mipmap-xxxhdpi/ic_launcher.png
    'bd24fd383253bf8d43f0a81f11c071d76d1d555114376dd647cd9fb38fa0a9da',   // mipmap-xxxhdpi/ic_launcher_foreground.png
    'ab93096331e7cd8ec379f73f1e9adcaaa9ee1115c9f4ff10411a811fb9700174',   // mipmap-xxxhdpi/ic_launcher_round.png
    '29e4777e319de3ee5a52c3a8004ec19d0568414004257e36d7c94a077d71c93b',   // AppIcon.appiconset/AppIcon-512@2x.png
    '1b5002b74a5500e697298ced06ca2811ac33f2771f236f3c720ff23243890530',   // Splash.imageset/splash-2732x2732{,-1,-2}.png
]);

// 16x16 average-hash fingerprints of that same art, taken over the content
// box so the mark is compared, not the whitespace around it. Deduplicated:
// every density of the template splash fingerprints identically.
const TEMPLATE_FINGERPRINTS = [
    '06060f0f0f9f07fe63fcf1f878f83c7c1e3e0f1f0f8f1fc639e070f060700020',   // every template splash, both shells
    '000000000000021003300bf01de00ee007700fb01dc008c0000000000001fffe',   // mipmap-hdpi/ic_launcher
    '0000000000000210033003f01de00ee0077007b00fc01cc00000000000000000',   // mipmap-{hdpi,mdpi}/ic_launcher_foreground
    '0000000000000010033803f00de00ee0077007b00fc10cc24006200c181807e0',   // mipmap-hdpi/ic_launcher_round
    '0000000000000001033003f00de10ee0077003b80fd10ce0004100000001fffe',   // mipmap-mdpi/ic_launcher
    '0000000000000000033003f00de00ee0077107b10fc00cc24004200c183007e0',   // mipmap-mdpi/ic_launcher_round
    '0000000000000010033003f00de00ee0077007b00fc00cc0000000000001ffff',   // mipmap-xhdpi/ic_launcher
    '0000000000000210033003f00de00ee0077007b00fc00cc00000000000000000',   // mipmap-xhdpi/ic_launcher_foreground
    '0000000000000210033003f00de00ee0077007b10fc10cc24002200c181807e0',   // mipmap-xhdpi/ic_launcher_round
    '0000000000000010033803f00de00ee0077007b00fc00cc0000000000000ffff',   // mipmap-xxhdpi/ic_launcher
    '0000000000000210033803f00de00ee0077007b00fc00cc00000000000000000',   // mipmap-{xxhdpi,xxxhdpi}/ic_launcher_foreground
    '000000000000021003300bf01de00ee0077007b00fc10cc240022004181807e0',   // mipmap-xxhdpi/ic_launcher_round
    '000000000000021003300bf01de00ee0077007b00dc008c0000000000001ffff',   // mipmap-xxxhdpi/ic_launcher
    '000000000000021003380bf01de00ee0077007b00fc10cc040022004181807e0',   // mipmap-xxxhdpi/ic_launcher_round
    '0000000000000010033803f00de00ee0077007b00fc00cc00000000000000000',   // AppIcon-512@2x
].map((hex) => [...hex].flatMap((c) => [...parseInt(c, 16).toString(2).padStart(4, '0')].map(Number)));

// Bits (of 256) two fingerprints may differ by and still count as the same
// artwork. Bracketed by measurement, not taste: the template's own art
// fingerprints 0-19 bits apart across its densities and variants, while the
// XChain art sits at least 45 bits from every template entry. The
// resize-stability check below re-proves the lower bound on each run.
const MAX_TEMPLATE_SIMILARITY = 28;

// --- the XChain mark ---------------------------------------------------

// The two interlocked links, sampled from the vector source's own colours.
const BRAND_BLUE = [0x0b, 0x7a, 0xb5];
const BRAND_PURPLE = [0x7a, 0x3a, 0x7c];
const BRAND_TOLERANCE = 36;                    // covers anti-aliasing and the darker overlap shade, excludes grey
const MIN_LINK_SHARE = 0.003;                  // of opaque pixels; the thinnest case, a launch drawable, measures 0.40%

const DENSITY_ICON_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const DENSITY_FOREGROUND_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const LAUNCH_DRAWABLES = {
    'drawable/splash.png': [480, 320],
    'drawable-land-mdpi/splash.png': [480, 320],
    'drawable-land-hdpi/splash.png': [800, 480],
    'drawable-land-xhdpi/splash.png': [1280, 720],
    'drawable-land-xxhdpi/splash.png': [1600, 960],
    'drawable-land-xxxhdpi/splash.png': [1920, 1280],
    'drawable-port-mdpi/splash.png': [320, 480],
    'drawable-port-hdpi/splash.png': [480, 800],
    'drawable-port-xhdpi/splash.png': [720, 1280],
    'drawable-port-xxhdpi/splash.png': [960, 1600],
    'drawable-port-xxxhdpi/splash.png': [1280, 1920],
};

// --- 1. Inventory ------------------------------------------------------

const branded = [];                            // { label, path, image } for the pixel checks

function load(label, path, expect) {
    if (!existsSync(path)) {
        fail(`${label}: missing (${relative(wsRoot, path)})`);
        return null;
    }
    const buf = readFileSync(path);
    const header = readHeader(buf);
    if (expect && (header.width !== expect[0] || header.height !== expect[1])) {
        fail(`${label}: is ${header.width}x${header.height}, expected ${expect[0]}x${expect[1]}`);
    }
    const image = decode(buf);
    const asset = { label, path, image, buf, header };
    branded.push(asset);
    return asset;
}

// All 15 Android density assets. The count is the point: Android picks the
// nearest density and upscales, so one missing file ships a blurry icon on a
// whole class of devices without any build error.
for (const [density, px] of Object.entries(DENSITY_ICON_PX)) {
    load(`android ${density} ic_launcher`, join(res, `mipmap-${density}`, 'ic_launcher.png'), [px, px]);
    load(`android ${density} ic_launcher_round`, join(res, `mipmap-${density}`, 'ic_launcher_round.png'), [px, px]);
    const fg = DENSITY_FOREGROUND_PX[density];
    load(`android ${density} ic_launcher_foreground`, join(res, `mipmap-${density}`, 'ic_launcher_foreground.png'), [fg, fg]);
}
assert.equal(branded.length, 15, 'expected exactly 15 Android density icon assets');

for (const [rel, size] of Object.entries(LAUNCH_DRAWABLES)) {
    load(`android ${rel}`, join(res, rel), size);
}

const iosIcon = load('ios AppIcon 1024', join(appIcon, 'AppIcon-512@2x.png'), [1024, 1024]);
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    load(`ios ${name}`, join(iosSplash, name), [2732, 2732]);
}

// The dark and tinted appearances are deliberate, not decoration: iOS 18+
// derives them itself when they are absent, and its derivation of a
// white-background icon came out muddy on the simulator.
const iosDark = load('ios AppIcon dark', join(appIcon, 'AppIcon-dark-1024.png'), [1024, 1024]);
const iosTinted = load('ios AppIcon tinted', join(appIcon, 'AppIcon-tinted-1024.png'), [1024, 1024]);

const iconContents = JSON.parse(readFileSync(join(appIcon, 'Contents.json'), 'utf8'));
const appearanceOf = (entry) => (entry.appearances ?? []).map((a) => a.value).join('+') || 'light';
const declared = Object.fromEntries(iconContents.images.map((i) => [appearanceOf(i), i]));
for (const appearance of ['light', 'dark', 'tinted']) {
    assert.ok(declared[appearance], `AppIcon Contents.json declares no ${appearance} appearance`);
    assert.equal(declared[appearance].size, '1024x1024', `${appearance} appearance is not the 1024 slot`);
    assert.ok(
        existsSync(join(appIcon, declared[appearance].filename)),
        `AppIcon Contents.json points at a missing file for ${appearance}`,
    );
}

const splashContents = JSON.parse(readFileSync(join(iosSplash, 'Contents.json'), 'utf8'));
assert.equal(splashContents.images.length, 3, 'Splash.imageset should fill all three scale slots');
for (const entry of splashContents.images) {
    assert.ok(existsSync(join(iosSplash, entry.filename)), `Splash.imageset ${entry.scale} points at a missing file`);
}

// --- 2. Not the template ----------------------------------------------

// Byte sweep: any PNG anywhere in the shells, not just the ones this smoke
// knows by name. Cheap, and it catches template art re-added under a new path.
const SKIP_DIRS = new Set(['node_modules', 'www', 'build', 'DerivedData', '.gradle', 'Pods', 'dist']);
function* walkPngs(dir) {
    for (const name of readdirSync(dir).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) yield* walkPngs(full);
        else if (name.endsWith('.png')) yield full;
    }
}
let swept = 0;
for (const png of walkPngs(mobile)) {
    swept += 1;
    const digest = createHash('sha256').update(readFileSync(png)).digest('hex');
    if (TEMPLATE_DIGESTS.has(digest)) {
        fail(`${relative(wsRoot, png)} is the Capacitor template art, byte for byte`);
    }
}
assert.ok(swept >= 30, `PNG sweep found only ${swept} files; the walk is probably pointed at the wrong tree`);

// Perceptual sweep over the branded assets: same art, re-exported or resized,
// still trips this. Reported with the distance so a near miss is legible.
for (const asset of branded) {
    const fingerprint = markFingerprint(asset.image, 16);
    let nearest = Infinity;
    for (const template of TEMPLATE_FINGERPRINTS) {
        nearest = Math.min(nearest, hammingDistance(fingerprint, template));
    }
    if (nearest <= MAX_TEMPLATE_SIMILARITY) {
        fail(`${asset.label}: artwork matches the Capacitor template (${nearest}/256 bits differ)`);
    }
}

// Calibration, always on: halve an asset and it must still read as the same
// artwork, or the threshold above is too tight to catch template art that
// comes back at another size. This is the lower bracket on
// MAX_TEMPLATE_SIMILARITY; the distances to the frozen template fingerprints
// above are the upper one.
//
// Area-average on PREMULTIPLIED colour, because that is what an exporter
// does; averaging raw RGB across a transparent edge drags the mark towards
// whatever colour happens to sit under the transparency. Only assets of 400px
// and up take part: below that, halving genuinely destroys the mark's thin
// strokes, and the small densities are covered by their own frozen
// fingerprints rather than by this stability argument.
function halve(image) {
    const width = Math.max(8, Math.round(image.width / 2));
    const height = Math.max(8, Math.round(image.height / 2));
    const colour = new Float64Array(width * height * 3);
    const alpha = new Float64Array(width * height);
    const counts = new Float64Array(width * height);
    for (let y = 0; y < image.height; y += 1) {
        const ty = Math.min(height - 1, Math.floor((y * height) / image.height));
        for (let x = 0; x < image.width; x += 1) {
            const s = (y * image.width + x) * 4;
            const t = ty * width + Math.min(width - 1, Math.floor((x * width) / image.width));
            const a = image.data[s + 3] / 255;
            for (let c = 0; c < 3; c += 1) colour[t * 3 + c] += image.data[s + c] * a;
            alpha[t] += image.data[s + 3];
            counts[t] += 1;
        }
    }
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const n = counts[i] || 1;
        const meanAlpha = alpha[i] / n;
        for (let c = 0; c < 3; c += 1) {
            data[i * 4 + c] = meanAlpha === 0 ? 0 : Math.round((colour[i * 3 + c] / n) * (255 / meanAlpha));
        }
        data[i * 4 + 3] = Math.round(meanAlpha);
    }
    return { ...image, width, height, data };
}
for (const asset of branded.filter((a) => Math.min(a.image.width, a.image.height) >= 400)) {
    const drift = hammingDistance(markFingerprint(asset.image, 16), markFingerprint(halve(asset.image), 16));
    if (drift > MAX_TEMPLATE_SIMILARITY) {
        fail(`fingerprint is unstable under resize (${asset.label} drifted ${drift}/256 bits > ${MAX_TEMPLATE_SIMILARITY}); the template guard would no longer catch a resized copy`);
    }
}

// --- 3. Ours, and usable ----------------------------------------------

// Apple rejects a 1024 app icon carrying an alpha channel. The dark
// appearance is the exception: it is supposed to be transparent, because the
// system draws the dark backdrop behind it.
if (iosIcon) {
    assert.ok(!hasAlpha(iosIcon.buf), 'ios AppIcon 1024 carries an alpha channel; App Store Connect rejects that');
}
if (iosDark) {
    assert.ok(hasAlpha(iosDark.buf), 'ios dark AppIcon should be the white mark on transparency');
    assert.deepEqual(
        contentBox(iosDark.image),
        contentBox(iosIcon.image),
        'the dark appearance is composed differently from the light one',
    );
}
if (iosTinted) {
    const { colourType } = readHeader(iosTinted.buf);
    assert.ok([0, 4].includes(colourType), 'ios tinted AppIcon should be greyscale; iOS applies the tint');
}

// The mark is two interlocked links, one blue and one purple, in every
// full-colour asset. Template art scores zero here, and so does a blank
// canvas or a half-rendered export.
const monochrome = new Set([iosDark?.path, iosTinted?.path]);
for (const asset of branded.filter((a) => !monochrome.has(a.path))) {
    const blue = colourShare(asset.image, BRAND_BLUE, BRAND_TOLERANCE);
    const purple = colourShare(asset.image, BRAND_PURPLE, BRAND_TOLERANCE);
    if (blue < MIN_LINK_SHARE || purple < MIN_LINK_SHARE) {
        fail(`${asset.label}: XChain link colours missing (blue ${(blue * 100).toFixed(2)}%, purple ${(purple * 100).toFixed(2)}%)`);
    } else if (blue / purple > 2.2 || purple / blue > 2.2) {
        fail(`${asset.label}: the two links are lopsided (blue ${(blue * 100).toFixed(2)}%, purple ${(purple * 100).toFixed(2)}%); the mark is probably cropped`);
    }
}

// The adaptive foreground is masked to whatever shape the launcher wants, so
// the mark has to live in the inner 66% of the canvas or a circular mask
// clips it. It also has to be big enough to read.
for (const density of Object.keys(DENSITY_FOREGROUND_PX)) {
    const asset = branded.find((a) => a.label === `android ${density} ic_launcher_foreground`);
    if (!asset) continue;
    const box = contentBox(asset.image);
    const size = asset.image.width;
    const margin = size * 0.17;
    const fitsSafeZone = box.x >= margin && box.y >= margin
        && box.x + box.width <= size - margin && box.y + box.height <= size - margin;
    if (!fitsSafeZone) {
        fail(`android ${density} adaptive foreground reaches outside the mask safe zone (${JSON.stringify(box)} in ${size}px)`);
    }
    if (box.width / size < 0.4) {
        fail(`android ${density} adaptive foreground mark is only ${(box.width / size * 100).toFixed(0)}% wide; too small to read`);
    }
}

// The adaptive icon must keep pointing at the mipmap foreground and the flat
// background colour. The template's vector drawables were deleted for exactly
// this reason: unreferenced, but still stock art inside the APK.
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const xml = readFileSync(join(res, 'mipmap-anydpi-v26', name), 'utf8');
    assert.match(xml, /android:drawable="@mipmap\/ic_launcher_foreground"/, `${name} does not point at the mipmap foreground`);
    assert.match(xml, /android:drawable="@color\/ic_launcher_background"/, `${name} does not point at the background colour`);
}
assert.match(
    readFileSync(join(res, 'values', 'ic_launcher_background.xml'), 'utf8'),
    /<color name="ic_launcher_background">#FFFFFF<\/color>/i,
    'the adaptive background colour is no longer the brand white',
);
for (const stale of ['drawable-v24/ic_launcher_foreground.xml', 'drawable/ic_launcher_background.xml']) {
    assert.ok(!existsSync(join(res, stale)), `${stale} is back; that is Capacitor template vector art shipping inside the APK`);
}

if (process.exitCode) {
    console.error('mobile-brand-art: FAILED');
} else {
    console.log(`mobile-brand-art: OK (${branded.length} branded assets, ${swept} PNGs swept for template bytes)`);
}
