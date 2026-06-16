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

/**
 * Camera-based QR scanner. Wraps the browser's native
 * `BarcodeDetector` API against a live `<video>` + `MediaStream` —
 * available in Chromium-based browsers (Chrome, Edge, modern Opera,
 * Chromium-based Electron) since ~2020. Falls back to a clear
 * "Camera scanning not supported on this browser" message elsewhere
 * so callers can prompt the user to use the paste-chunk path.
 *
 * The component emits each scanned string through `onFrame`; it
 * deliberately does NOT de-duplicate across scans — callers that
 * feed a chunked transport (XCW `addChunkToCollector`) already
 * no-op on duplicate chunks, and the scanner has no opinion about
 * what payload shape is being transported.
 *
 * Lifecycle:
 *   - on mount (or `autoStart=true`): getUserMedia → attach to
 *     video → start `requestAnimationFrame` loop that runs
 *     `detector.detect(video)` on each frame.
 *   - on unmount: stop every track + cancel the RAF loop.
 *
 * @param {object} props
 * @param {(text: string) => void} props.onFrame
 * @param {boolean} [props.autoStart]    default true
 * @param {number} [props.width]         video display width; default 320
 * @param {string} [props.alt]           aria-label for the scanner surface
 */
export function QrScanner({ onFrame, autoStart = true, width = 320, alt = 'QR scanner' }) {
    const videoRef = useRef(/** @type {HTMLVideoElement | null} */ (null));
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const hasBarcodeDetector = typeof window !== 'undefined'
        && typeof window.BarcodeDetector === 'function';
    const hasGetUserMedia = typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.getUserMedia === 'function';
    const isSecureContext = typeof window !== 'undefined'
        && (window.isSecureContext === true
            || ['localhost', '127.0.0.1', '[::1]'].includes(window.location?.hostname));
    const supported = hasBarcodeDetector && hasGetUserMedia && isSecureContext;

    useEffect(() => {
        if (!supported || !autoStart) return undefined;
        let cancelled = false;
        /** @type {MediaStream | null} */
        let stream = null;
        /** @type {number | null} */
        let rafId = null;
        /** @type {any} */
        let detector = null;

        async function start() {
            try {
                // Native types — populated via the BarcodeDetector
                // constructor. Empty formats array means "detect any
                // format the UA supports"; Chromium supports `qr_code`
                // universally which is what we care about.
                detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {
                if (!cancelled) setError(e?.message || 'BarcodeDetector construction failed.');
                return;
            }

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                });
            } catch (e) {
                if (!cancelled) setError(e?.message || 'Camera permission denied.');
                return;
            }

            const video = videoRef.current;
            if (!video) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            video.srcObject = stream;
            try {
                await video.play();
            } catch (e) {
                if (!cancelled) setError(e?.message || 'Video playback failed.');
                return;
            }
            if (cancelled) return;
            setRunning(true);

            const tick = async () => {
                if (cancelled || !video || !detector) return;
                try {
                    const results = await detector.detect(video);
                    for (const r of results || []) {
                        if (!cancelled && r && typeof r.rawValue === 'string' && r.rawValue.length > 0) {
                            onFrame(r.rawValue);
                        }
                    }
                } catch {
                    // Intermittent detector errors are non-fatal — try
                    // again next frame. The video may not be ready.
                }
                if (!cancelled) {
                    rafId = window.requestAnimationFrame(tick);
                }
            };
            rafId = window.requestAnimationFrame(tick);
        }

        start();

        return () => {
            cancelled = true;
            if (rafId !== null) window.cancelAnimationFrame(rafId);
            if (stream) stream.getTracks().forEach((t) => t.stop());
            const video = videoRef.current;
            if (video) video.srcObject = null;
            setRunning(false);
        };
    }, [supported, autoStart, onFrame]);

    if (!supported) {
        let reason;
        if (!isSecureContext) {
            const origin = typeof window !== 'undefined' ? window.location?.origin : '';
            reason = (
                <>
                    Camera scanning requires a <strong>secure context</strong>{' '}
                    (HTTPS, or <code>localhost</code>). This page is loaded from{' '}
                    <code>{origin}</code> which browsers treat as insecure, so
                    <code>getUserMedia</code> and <code>BarcodeDetector</code> are
                    blocked. Either open the wallet via <code>https://</code> or
                    <code>http://localhost</code>, or add this origin to Chrome's
                    {' '}<code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>.
                </>
            );
        } else if (!hasBarcodeDetector) {
            reason = (
                <>
                    Camera scanning needs the <code>BarcodeDetector</code> API. Use a
                    Chromium-based browser (Chrome, Edge, modern Opera) or paste the
                    payload below instead.
                </>
            );
        } else {
            reason = (
                <>
                    Camera access isn't available on this browser. Paste the QR
                    contents below instead.
                </>
            );
        }
        return (
            <div
                role="status"
                aria-label={`${alt} — unsupported`}
                data-testid="qr-scanner-unsupported"
                style={{
                    padding: '0.75rem',
                    fontSize: '0.85rem',
                    color: 'var(--xc-text)',
                    lineHeight: 1.4,
                    background: 'var(--xc-bg-muted)',
                    borderRadius: 'var(--xc-radius-sm)',
                }}
            >
                {reason}
            </div>
        );
    }

    return (
        <div
            role="region"
            aria-label={alt}
            data-testid="qr-scanner"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
            }}
        >
            <video
                ref={videoRef}
                width={width}
                height={Math.round((width * 3) / 4)}
                playsInline
                muted
                style={{ background: '#0F172A', borderRadius: 4 }}
            />
            {error ? (
                <p role="alert" style={{ color: '#B91C1C', fontSize: '0.8rem' }}>{error}</p>
            ) : (
                <p style={{ fontSize: '0.75rem', color: '#64748B' }}>
                    {running ? 'Scanning… point camera at an animated QR.' : 'Starting camera…'}
                </p>
            )}
        </div>
    );
}
