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
// recovery-phrase scan and the backup-pointer scan on the import screen, the
// partner-pairing scan, the send-address scan. `QrScanner` wraps the browser's
// native `BarcodeDetector` over a `getUserMedia` stream, so none of them can be
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

/**
 * Renders `text` as a QR code into an I420 y4m video buffer.
 *
 * Black modules on a white field with a quiet zone, which is what a phone
 * camera would see of a printed code. The chroma planes are flat mid-grey: the
 * detector reads luma only, and a constant U/V keeps the file small.
 *
 * @param {string} text
 * @param {{ width?: number, height?: number, frames?: number, scale?: number }} [opts]
 * @returns {Buffer}
 */
export function qrToY4m(text, { width = 640, height = 480, frames = 8, scale = 8 } = {}) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const bits = qr.modules.data;
    const px = size * scale;
    if (px > width || px > height) {
        throw new Error(`qrToY4m: the code needs ${px}px at scale ${scale}, larger than the ${width}x${height} frame`);
    }
    const ox = (width - px) >> 1;
    const oy = (height - px) >> 1;

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

    const chroma = Buffer.alloc((width >> 1) * (height >> 1), 128);
    const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420mpeg2\n`, 'ascii');
    const frame = Buffer.concat([Buffer.from('FRAME\n', 'ascii'), luma, chroma, chroma]);
    return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}

/**
 * Launches a browser whose camera shows `text` as a QR code.
 *
 * The caller closes the returned browser. `launchArgs` mirrors what
 * `playwright.regtest.config.js` passes its project, since a browser launched
 * here does NOT inherit the config's `launchOptions`.
 *
 * @param {string} text
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
