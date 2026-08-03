// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A REAL CAMERA FOR THE E2E VENUE, so the wallet's QR lanes can be driven.
//
// Several surfaces in this wallet only accept input through a camera: the
// recovery-phrase and backup-pointer scans on the import screen, the
// scan-and-classify route, the partner-pairing scan, and the Sign panel's
// multi-frame transaction capture. `QrScanner` wraps the browser's native
// `BarcodeDetector` over a `getUserMedia` stream, so none of them can be
// reached by typing.
//
// Chromium can replay a raw video file as a camera device. This module renders
// a QR code to one, so a spec can put an arbitrary string in front of the
// wallet's lens and let the wallet's OWN decoder read it - no stubbing of
// `BarcodeDetector`, no shortcut into the frame handler, nothing about the scan
// path faked.
//
// TWO FACTS THAT DECIDE WHETHER THIS WORKS AT ALL, both measured rather than
// assumed:
//
//   1. `BarcodeDetector` IS present in Playwright's bundled Chromium, and it
//      supports `qr_code`. An early probe said `undefined` and nearly cost this
//      lane: the Shape Detection API is SECURE-CONTEXT ONLY, and the probe ran
//      on `about:blank`. Re-probed against a localhost origin it is a function
//      in both bundled Chromium and installed Chrome. If you ever need to
//      re-check, check it on a real origin.
//   2. The fake device decodes on the FIRST detect() call at 640x480 with 8px
//      modules, so a spec does not need to nurse the camera.
//
// THE FLAGS MUST BE SET AT LAUNCH, which is why this exports a launcher rather
// than a page helper: `--use-file-for-fake-video-capture` is read when the
// browser process starts, so the video has to exist first and a spec that needs
// two different QRs needs two browsers (or a rewrite between launches).

import { chromium } from '@playwright/test';
import QRCode from 'qrcode';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const y4mHeader = (width, height) =>
    Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420mpeg2\n`, 'ascii');
const FRAME_MARKER = Buffer.from('FRAME\n', 'ascii');

/**
 * Renders one QR code into a luma plane: black modules on a white field with a
 * quiet zone, centred, which is what a phone camera would see of a printed
 * code.
 *
 * @param {string} text
 * @param {{ width: number, height: number, scale: number }} opts
 * @returns {Buffer}
 */
function qrLuma(text, { width, height, scale }) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const bits = qr.modules.data;

    // Shrink to fit rather than refusing: a longer payload means more modules,
    // and the caller should not have to know how many. `scale` is a CEILING, not
    // a demand. The floor of 3 is where a 640x480 capture stops decoding
    // reliably - below that the right answer is a bigger frame or fewer bytes
    // per code, and failing loudly is better than emitting a video nothing can
    // read (which presents as a capture that silently never completes).
    let px = size * scale;
    let effective = scale;
    while (effective > 3 && (px > width || px > height)) {
        effective -= 1;
        px = size * effective;
    }
    if (px > width || px > height) {
        throw new Error(
            `qrToY4m: a ${size}-module code needs ${px}px even at scale ${effective}, `
            + `larger than the ${width}x${height} frame - use a bigger frame or shorter payloads`,
        );
    }
    const ox = (width - px) >> 1;
    const oy = (height - px) >> 1;
    scale = effective;

    const luma = Buffer.alloc(width * height, 255);
    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            if (!bits[row * size + col]) continue;
            for (let dy = 0; dy < scale; dy += 1) {
                const start = (oy + row * scale + dy) * width + ox + col * scale;
                luma.fill(0, start, start + scale);
            }
        }
    }
    return luma;
}

/**
 * Renders `text` as an I420 y4m video buffer the browser can replay as a
 * camera.
 *
 * An ARRAY plays as an ANIMATED code: one QR per group of video frames, in
 * order, and Chromium loops the file - which is exactly what a receiving device
 * sees when it points a camera at an animated QR display. That is the only way
 * to drive the multi-frame `XCW:` transport (§20.3), where the receiver has to
 * collect every frame before it can reassemble anything.
 *
 * `holdFrames` is why the animated path works at all: the detector runs on a
 * requestAnimationFrame loop, and a code shown for a single video frame is easy
 * to miss - which presents as a capture that simply never completes.
 *
 * The chroma planes are flat mid-grey; the detector reads luma only, and a
 * constant U/V keeps the file small.
 *
 * @param {string | string[]} text   one code, or an ordered set played as an animated code
 * @param {{ width?: number, height?: number, frames?: number, scale?: number, holdFrames?: number }} [opts]
 * @returns {Buffer}
 */
export function qrToY4m(text, {
    width = 640, height = 480, frames = 8, scale = 8, holdFrames = 8,
} = {}) {
    const codes = Array.isArray(text) ? text : [text];
    if (codes.length === 0) throw new Error('qrToY4m: no frames to render');
    // A single code is held for `frames`; an animated set holds each for
    // `holdFrames` and relies on the file looping for repeats.
    const repeats = Array.isArray(text) ? holdFrames : frames;

    const chroma = Buffer.alloc((width >> 1) * (height >> 1), 128);
    const out = [y4mHeader(width, height)];
    for (const code of codes) {
        const frame = Buffer.concat([FRAME_MARKER, qrLuma(code, { width, height, scale }), chroma, chroma]);
        for (let i = 0; i < repeats; i += 1) out.push(frame);
    }
    return Buffer.concat(out);
}

/**
 * Launches a browser whose camera shows `text` as a QR code (or, for an array,
 * as an animated sequence).
 *
 * The caller closes the returned browser. `launchArgs` mirrors what
 * `playwright.regtest.config.js` passes its project, since a browser launched
 * here does NOT inherit the config's `launchOptions`.
 *
 * @param {string | string[]} text
 * @param {{ launchArgs?: string[] }} [opts]
 * @returns {Promise<import('@playwright/test').Browser>}
 */
export async function launchWithQrCamera(text, { launchArgs = [] } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'xc-qr-'));
    const video = join(dir, 'qr.y4m');
    writeFileSync(video, qrToY4m(text));
    return chromium.launch({
        args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${video}`,
            ...launchArgs,
        ],
    });
}
