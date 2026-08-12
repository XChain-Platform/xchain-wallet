// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dependency-free PNG reader, enough to let a smoke look at PIXELS.
//
// a later change shipped the Capacitor template logo to both stores because every
// gate here checked wiring and identifiers, never image content. A guard
// against that has to decode the image, and it must do so with nothing but
// `node:zlib`: the smoke lane runs bare `node`, and the only image libraries
// on disk (pngjs, sharp) are hoisted transitives of one package's build
// script, so importing them would make the guard's survival depend on an
// unrelated dependency tree.
//
// Scope is exactly the icon corpus this repo ships (verified against every
// file under mipmap-*/ and Assets.xcassets/): bit depths 8 and 16, colour
// types 0/2/3/4/6, no interlacing. Anything outside that throws rather than
// guessing, because a guard that silently degrades is the failure mode the
// item is about.

import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Channel count per PNG colour type (index = colour type; holes are invalid).
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function readChunks(buf) {
    if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG (bad signature)');
    const out = [];
    let off = 8;
    while (off + 8 <= buf.length) {
        const length = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        out.push({ type, data: buf.subarray(off + 8, off + 8 + length) });
        off += 12 + length;
        if (type === 'IEND') break;
    }
    return out;
}

// Header fields only. Cheap enough to call on a 2732px splash, and it is what
// the alpha-channel assertions read.
export function readHeader(buf) {
    const ihdr = readChunks(buf).find((c) => c.type === 'IHDR');
    if (!ihdr) throw new Error('PNG has no IHDR');
    return {
        width: ihdr.data.readUInt32BE(0),
        height: ihdr.data.readUInt32BE(4),
        bitDepth: ihdr.data[8],
        colourType: ihdr.data[9],
        interlace: ihdr.data[12],
    };
}

// True when the encoded image can carry per-pixel transparency at all: an
// alpha channel (colour types 4 and 6) or a tRNS chunk. Apple rejects a 1024
// app icon that has either.
export function hasAlpha(buf) {
    const chunks = readChunks(buf);
    const colourType = chunks.find((c) => c.type === 'IHDR').data[9];
    return colourType === 4 || colourType === 6 || chunks.some((c) => c.type === 'tRNS');
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

// Decode to 8-bit RGBA. 16-bit samples are truncated to their high byte,
// which is lossless enough for a perceptual fingerprint.
export function decode(buf) {
    const chunks = readChunks(buf);
    const header = readHeader(buf);
    const { width, height, bitDepth, colourType, interlace } = header;

    if (interlace !== 0) throw new Error('interlaced PNG is not supported');
    if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`unsupported bit depth ${bitDepth}`);
    const channels = CHANNELS[colourType];
    if (!channels) throw new Error(`unsupported colour type ${colourType}`);
    if (colourType === 3 && bitDepth !== 8) throw new Error('unsupported palette bit depth');

    const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
    const raw = inflateSync(idat);

    const sampleBytes = bitDepth / 8;
    const bpp = channels * sampleBytes;                 // bytes per pixel, for the filters
    const stride = width * bpp;
    if (raw.length < height * (stride + 1)) throw new Error('truncated PNG image data');

    // Unfilter in place into one contiguous buffer of scanlines.
    const pixels = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
        const line = pixels.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x += 1) {
            const a = x >= bpp ? line[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            const c = prev && x >= bpp ? prev[x - bpp] : 0;
            let value = src[x];
            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) value += paeth(a, b, c);
            else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
            line[x] = value & 0xff;
        }
    }

    const plte = chunks.find((c) => c.type === 'PLTE')?.data;
    const trns = chunks.find((c) => c.type === 'tRNS')?.data;
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const at = (channel) => pixels[i * bpp + channel * sampleBytes];   // high byte when 16-bit
        let r;
        let g;
        let b;
        let a = 255;
        if (colourType === 0) { r = at(0); g = r; b = r; }
        else if (colourType === 2) { r = at(0); g = at(1); b = at(2); }
        else if (colourType === 4) { r = at(0); g = r; b = r; a = at(1); }
        else if (colourType === 6) { r = at(0); g = at(1); b = at(2); a = at(3); }
        else {
            const idx = pixels[i];
            r = plte[idx * 3];
            g = plte[idx * 3 + 1];
            b = plte[idx * 3 + 2];
            a = trns && idx < trns.length ? trns[idx] : 255;
        }
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = a;
    }
    return { ...header, data: rgba };
}

// Bounding box of everything that is not background, where background means
// transparent or within `tolerance` of the flat colour the canvas starts in.
//
// Fingerprints are taken over this box, not the whole canvas. Without it the
// 2732px splash is ~99% white in both the template and the XChain art, the
// two fingerprint nearly identically, and the guard would pass on the very
// asset the item found. Cropping to the mark also makes the fingerprint
// independent of how much padding a generator leaves around it.
//
// The background colour is read from the first OPAQUE corner, never from a
// transparent one: the RGB under a fully transparent pixel is arbitrary, and
// different encoders leave different values there. Reading it anyway made the
// round launcher icons (transparent corners around a white disc) crop one way
// before a resize and another way after, which is indistinguishable from the
// artwork having changed.
export function contentBox(image, tolerance = 12) {
    const { width, height, data } = image;
    const corners = [0, (width - 1) * 4, (height - 1) * width * 4, (height * width - 1) * 4];
    const opaqueCorner = corners.find((i) => data[i + 3] >= 16);
    const [br, bg, bb] = opaqueCorner === undefined
        ? [-1e3, -1e3, -1e3]                                        // no flat backdrop; only transparency is background
        : [data[opaqueCorner], data[opaqueCorner + 1], data[opaqueCorner + 2]];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            const transparent = data[i + 3] < 16;
            const background = Math.abs(data[i] - br) <= tolerance
                && Math.abs(data[i + 1] - bg) <= tolerance
                && Math.abs(data[i + 2] - bb) <= tolerance;
            if (transparent || background) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) return { x: 0, y: 0, width, height };            // blank canvas
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function crop(image, box) {
    const out = Buffer.alloc(box.width * box.height * 4);
    for (let y = 0; y < box.height; y += 1) {
        const src = ((box.y + y) * image.width + box.x) * 4;
        image.data.copy(out, y * box.width * 4, src, src + box.width * 4);
    }
    return { ...image, width: box.width, height: box.height, data: out };
}

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Which flat colour transparency is composited onto before the artwork is
// fingerprinted. White by default, because that is what a launcher or a
// springboard puts behind these assets, and because measured against the
// template corpus it separates artworks best.
//
// The exception is art that is mostly transparent AND light, which is the iOS
// dark-appearance icon: a white mark on nothing. Over white it disappears
// into the backdrop and the fingerprint is decided by anti-aliased edges,
// which is unstable enough to look like the artwork changing. Such art is
// composited onto black instead.
function backdropFor(image) {
    const { data } = image;
    let transparent = 0;
    let inkSum = 0;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) {
            transparent += 1;
            continue;
        }
        ink += 1;
        inkSum += luma(data[i], data[i + 1], data[i + 2]);
    }
    const mostlyTransparent = transparent / (data.length / 4) > 0.5;
    const lightInk = ink > 0 && inkSum / ink > 200;
    return mostlyTransparent && lightInk ? 0 : 255;
}

// Grayscale, composited onto that backdrop so that a transparent adaptive
// foreground and the opaque icon cut from the same art fingerprint alike.
function luminanceGrid(image, cells) {
    const { width, height, data } = image;
    const BACKDROP = backdropFor(image);
    const sums = new Float64Array(cells * cells);
    const counts = new Uint32Array(cells * cells);
    for (let y = 0; y < height; y += 1) {
        const cy = Math.min(cells - 1, Math.floor((y * cells) / height));
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            const alpha = data[i + 3] / 255;
            const r = data[i] * alpha + BACKDROP * (1 - alpha);
            const g = data[i + 1] * alpha + BACKDROP * (1 - alpha);
            const b = data[i + 2] * alpha + BACKDROP * (1 - alpha);
            const cell = cy * cells + Math.min(cells - 1, Math.floor((x * cells) / width));
            sums[cell] += luma(r, g, b);
            counts[cell] += 1;
        }
    }
    return Array.from(sums, (sum, i) => sum / counts[i]);
}

// Average hash of the artwork itself: `cells`^2 bits, one per cell of a box
// downsample of the content box, set when the cell is darker than the mean.
// Resolution- and re-encode-independent, which is the point: a byte-digest
// denylist only catches the template art returning byte-for-byte, and any
// regeneration or recompression of it would slip past.
export function markFingerprint(image, cells = 16) {
    const grid = luminanceGrid(crop(image, contentBox(image)), cells);
    const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
    return grid.map((v) => (v < mean ? 1 : 0));
}

export function hammingDistance(a, b) {
    if (a.length !== b.length) throw new Error('fingerprint length mismatch');
    let d = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
    return d;
}

// Share of pixels whose RGB sits within `tolerance` of a reference colour,
// ignoring anything transparent. Used to name the Capacitor blue directly.
export function colourShare(image, [tr, tg, tb], tolerance) {
    const { data } = image;
    let hits = 0;
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        opaque += 1;
        if (
            Math.abs(data[i] - tr) <= tolerance
            && Math.abs(data[i + 1] - tg) <= tolerance
            && Math.abs(data[i + 2] - tb) <= tolerance
        ) hits += 1;
    }
    return opaque === 0 ? 0 : hits / opaque;
}
