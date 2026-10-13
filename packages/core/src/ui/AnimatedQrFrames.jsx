// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useReducedMotion } from './reducedMotion.js';

/**
 * Render a sequence of strings as animated QR codes; frames advance
 * at `fps` per second. Used for §20.3 chunked PSBT-over-QR transport
 * (encoded by `encodeXcwChunks`) and for §22.3 multisig PSBT
 * round-trip envelopes wrapped in the same chunk format.
 *
 * Hidden complexity: `qrcode.toDataURL` is async, so we render each
 * frame to a data URL on demand and cache it by size and content. The
 * placeholder remains visible until its matching QR is ready, keeping
 * the image and frame counter in sync.
 *
 * Honors reduced motion (`prefers-reduced-motion: reduce`, or the in-app
 * Settings → Appearance override): when set, the auto-advance
 * interval is suspended and the user steps through frames manually
 * via Prev / Next buttons. Hardware scanners / cosigner phones are not
 * inconvenienced; the QR content is the same, only the cadence changes.
 *
 * @param {object} props
 * @param {string[]} props.frames        non-empty array of strings (one QR per frame)
 * @param {number} [props.fps]           default 3 fps, per §20.3
 * @param {number} [props.size]          QR pixel size; default 240
 * @param {string} [props.alt]           alt text for the rendered <img>
 */
export function AnimatedQrFrames({ frames, fps = 3, size = 240, alt = 'Animated QR' }) {
    const [index, setIndex] = useState(0);
    const [urls, setUrls] = useState(/** @type {Record<string, string>} */ ({}));
    const urlsRef = useRef(/** @type {Record<string, string>} */ ({}));
    const [paused, setPaused] = useState(false);
    // The OS media query AND the in-app Settings → Appearance
    // override, resolved in one place. The auto-advance below is a JS timer,
    // so no CSS rule can stop it on the user's behalf.
    const reducedMotion = useReducedMotion();
    const frameList = Array.isArray(frames) ? frames : [];
    const frameCount = frameList.length;
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.round(size) : 240;
    const normalizedFps = Number.isFinite(fps) && fps > 0 ? Math.min(fps, 20) : 3;
    const safeIndex = index < frameCount ? index : 0;
    const frameSetKey = JSON.stringify(frameList);
    const currentKey = frameCount > 0
        ? `${normalizedSize}\u0000${frameList[safeIndex]}`
        : null;
    const nextIndex = frameCount > 0 ? (safeIndex + 1) % frameCount : 0;
    const nextKey = frameCount > 0
        ? `${normalizedSize}\u0000${frameList[nextIndex]}`
        : null;
    const currentReady = Boolean(currentKey && urls[currentKey]);
    const nextReady = Boolean(nextKey && urls[nextKey]);

    useEffect(() => {
        setIndex(0);
    }, [frameSetKey]);

    useEffect(() => {
        let cancelled = false;
        async function renderFrame(i) {
            if (i < 0 || i >= frameCount) return;
            const key = `${normalizedSize}\u0000${frameList[i]}`;
            if (urlsRef.current[key]) return;
            try {
                const dataUrl = await QRCode.toDataURL(frameList[i], {
                    errorCorrectionLevel: 'M',
                    margin: 4,
                    width: normalizedSize,
                    color: { dark: '#000000', light: '#FFFFFF' },
                });
                if (!cancelled) {
                    urlsRef.current[key] = dataUrl;
                    setUrls((prev) => (prev[key] ? prev : { ...prev, [key]: dataUrl }));
                }
            } catch {
                // Leave the slot empty so the counter never labels a different QR as this frame.
            }
        }
        if (frameCount > 0) {
            const nearby = frameCount > 1
                ? [safeIndex, nextIndex, (safeIndex - 1 + frameCount) % frameCount]
                : [safeIndex];
            for (const i of new Set(nearby)) {
                renderFrame(i);
            }
        }
        return () => { cancelled = true; };
    }, [frameSetKey, frameCount, nextIndex, normalizedSize, safeIndex]);

    useEffect(() => {
        if (reducedMotion) return undefined;
        if (frameCount <= 1 || paused || !currentReady || !nextReady) {
            return undefined;
        }
        const intervalMs = Math.max(50, Math.round(1000 / normalizedFps));
        const id = setInterval(() => {
            setIndex((i) => (i + 1) % frameCount);
        }, intervalMs);
        return () => clearInterval(id);
    }, [currentReady, frameCount, nextReady, normalizedFps, paused, reducedMotion]);

    if (frameCount === 0) return null;

    const dataUrl = currentKey ? urls[currentKey] || null : null;
    const multiFrame = frameCount > 1;
    const manual = reducedMotion || paused;
    const cadenceLabel = !multiFrame
        ? null
        : manual
            ? 'manual'
            : `${normalizedFps} fps`;
    const step = (offset) => {
        setIndex((i) => (i + offset + frameCount) % frameCount);
    };
    const qrAlt = `${alt}, frame ${safeIndex + 1} of ${frameCount}`;
    const controlStyle = {
        minWidth: 44,
        minHeight: 44,
        padding: '0.5rem 0.75rem',
        fontSize: '0.875rem',
        color: 'var(--xc-text)',
        border: '1px solid var(--xc-border-strong)',
        borderRadius: 4,
        background: 'var(--xc-surface)',
        cursor: 'pointer',
    };

    return (
        <div
            data-testid="animated-qr-frames"
            data-reduced-motion={reducedMotion ? 'true' : 'false'}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                width: '100%',
                maxWidth: normalizedSize,
            }}
        >
            {dataUrl ? (
                <img
                    src={dataUrl}
                    alt={qrAlt}
                    width={normalizedSize}
                    height={normalizedSize}
                    style={{
                        display: 'block',
                        width: '100%',
                        maxWidth: normalizedSize,
                        height: 'auto',
                        aspectRatio: '1 / 1',
                        background: '#FFFFFF',
                        borderRadius: 4,
                    }}
                />
            ) : (
                <div
                    role="status"
                    aria-label={`Preparing ${qrAlt}`}
                    style={{
                        width: '100%',
                        maxWidth: normalizedSize,
                        aspectRatio: '1 / 1',
                        background: 'var(--xc-bg-muted)',
                        borderRadius: 4,
                    }}
                />
            )}
            <span style={{ fontSize: '0.875rem', color: 'var(--xc-text)' }}>
                Frame {safeIndex + 1} / {frameCount}
                {cadenceLabel ? ` · ${cadenceLabel}` : ''}
            </span>
            {multiFrame ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem' }}>
                    {!reducedMotion ? (
                        <button
                            type="button"
                            aria-label={paused ? 'Resume animation' : 'Pause animation'}
                            aria-pressed={paused}
                            onClick={() => setPaused((value) => !value)}
                            style={controlStyle}
                        >
                            {paused ? 'Resume' : 'Pause'}
                        </button>
                    ) : null}
                    {manual ? (
                        <>
                            <button
                                type="button"
                                aria-label="Previous frame"
                                onClick={() => step(-1)}
                                style={controlStyle}
                            >
                                Prev
                            </button>
                            <button
                                type="button"
                                aria-label="Next frame"
                                onClick={() => step(1)}
                                style={controlStyle}
                            >
                                Next
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
