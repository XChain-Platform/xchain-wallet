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
import { Button } from './Button.jsx';
import { getNativeQrScanner } from './nativeQrScanner.js';

export const MAX_SCANNED_QR_CHARS = 8 * 1024;

const MALFORMED_QR_TEXT = 'That QR code could not be read. Try another code, or paste it instead.';
const OVERSIZED_QR_TEXT = 'That QR code is too large to read safely. Try another code, or paste it instead.';
const CAMERA_FAILURE_KEY = 'xchain.qr-camera-failure';

function terminalCameraFailure(e) {
    const name = e?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        return 'denied';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        return 'unavailable';
    }
    return null;
}

function rememberedCameraFailure() {
    try {
        const failure = globalThis.sessionStorage?.getItem(CAMERA_FAILURE_KEY);
        if (failure === 'denied') return { name: 'NotAllowedError' };
        if (failure === 'unavailable') return { name: 'NotFoundError' };
    } catch {
        // Storage can be unavailable in privacy-restricted or opaque contexts.
    }
    return null;
}

function rememberCameraFailure(e) {
    const failure = terminalCameraFailure(e);
    if (!failure) return false;
    try {
        globalThis.sessionStorage?.setItem(CAMERA_FAILURE_KEY, failure);
    } catch {
        // The current scanner still shows the failure when storage is unavailable.
    }
    return true;
}

/**
 * Validate camera input before a format-specific parser receives it.
 *
 * @param {unknown} text
 * @returns {string | null}
 */
export function scannedQrPayloadError(text) {
    if (typeof text !== 'string' || text.length === 0) return MALFORMED_QR_TEXT;
    if (text.length > MAX_SCANNED_QR_CHARS) return OVERSIZED_QR_TEXT;
    if (text.trim().length === 0) return MALFORMED_QR_TEXT;
    return null;
}

/**
 * Deliver one bounded payload and turn parser failures into user-facing copy.
 *
 * @param {unknown} text
 * @param {(value: string) => void} onFrame
 * @param {(error: string | null) => void} setError
 */
function deliverFrame(text, onFrame, setError) {
    const inputError = scannedQrPayloadError(text);
    if (inputError) {
        setError(inputError);
        return;
    }
    try {
        onFrame(text);
        setError(null);
    } catch {
        setError(MALFORMED_QR_TEXT);
    }
}

/**
 * Camera-based QR scanner. Wraps the browser's native
 * `BarcodeDetector` API against a live `<video>` + `MediaStream`,
 * available in Chromium-based browsers (Chrome, Edge, modern Opera,
 * Chromium-based Electron) since ~2020. The iPhone app's WebView has
 * no BarcodeDetector, so there the shell's native scanner (registered
 * through ./nativeQrScanner.js) takes over behind a "Scan with camera"
 * button. Everywhere else it falls back to a clear "Camera scanning not
 * supported on this browser" message so callers can prompt the user to
 * use the paste-chunk path.
 *
 * The component emits each bounded, non-empty scanned string through
 * `onFrame`; it deliberately does NOT de-duplicate across scans; callers that
 * feed a chunked transport (XCW `addChunkToCollector`) already
 * no-op on duplicate chunks, and the scanner has no opinion about
 * what payload shape is being transported. Invalid input and parser failures
 * stay on the scanner as plain error text so camera delivery cannot crash the
 * surrounding screen.
 *
 * Lifecycle (BarcodeDetector path):
 *   - in the Android app, explain the camera use and wait for a tap.
 *   - then, on mount (or `autoStart=true`): getUserMedia → attach
 *     to video → start `requestAnimationFrame` loop that runs
 *     `detector.detect(video)` on each frame.
 *   - a denied or absent camera stays remembered for the browsing session,
 *     so returning to a scanner shows the paste guidance without prompting.
 *   - an ended camera track stops the loop and becomes the same plain error.
 *   - on unmount: stop every track + cancel the RAF loop.
 *
 * Lifecycle (native path): nothing opens until the button is pressed,
 * whatever `autoStart` says; the native view covers the whole screen,
 * so it opens on a deliberate tap. Every accepted code the camera reads goes
 * to `onFrame`, and unmounting dismisses the native view.
 *
 * @param {object} props
 * @param {(text: string) => void} props.onFrame
 * @param {boolean} [props.autoStart]    default true
 * @param {number} [props.width]         video display width; default 320
 * @param {string} [props.alt]           aria-label for the scanner surface
 * @param {'unsupported' | 'denied'} [props.previewState] deterministic non-camera state for documentation and visual tests
 */
// Android's WebView draws a large grey play button on a <video> with no
// poster until its first frame, which reads as a broken media player while
// the camera starts or the permission prompt is up. A transparent pixel
// leaves the dark box instead.
const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Plain words for a getUserMedia failure. The raw messages ("Permission
 * denied", "Could not start video source") say nothing about what to do.
 *
 * @param {any} e
 * @returns {string}
 */
export function cameraErrorText(e) {
    // The native scanner (iPhone app) rejects with a reason rather than a
    // DOMException name; its words point at Settings, where iOS keeps the
    // camera switch.
    const native = NATIVE_START_TEXT[e?.reason];
    if (native) return native;
    const name = e?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        return 'Camera access is turned off for XChain Wallet. To scan, allow the camera in your device settings, or paste the code instead.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        return 'No camera was found on this device. Paste the code instead.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
        return 'The camera is busy or could not start. Close other apps using it and try again, or paste the code instead.';
    }
    return 'The camera could not start. Paste the code instead.';
}

/** Plain words for each reason the native scanner can refuse to start. */
const NATIVE_START_TEXT = Object.freeze({
    denied: 'Camera access is turned off for XChain Wallet. Allow it in Settings, or paste the code instead.',
    unavailable: 'There is no camera on this device. Paste the code instead.',
    busy: 'The camera is already open for another scan. Close it and try again, or paste the code instead.',
    error: 'The camera could not start. Paste the code instead.',
});

/**
 * Plain words for a native scanner that closed by itself, or null when the
 * user closed it (Cancel needs no explanation).
 *
 * @param {string} reason
 * @returns {string | null}
 */
export function nativeScanClosedText(reason) {
    if (reason === 'cancelled') return null;
    if (reason === 'interrupted') {
        return 'Scanning stopped when the app was interrupted. Scan again, or paste the code instead.';
    }
    return 'The camera stopped unexpectedly. Scan again, or paste the code instead.';
}

/** True inside the Capacitor iOS or Android app rather than a browser. */
function isNativeApp() {
    try {
        return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
    } catch {
        return false;
    }
}

/**
 * The native-scanner surface: a "Scan with camera" button that opens the
 * shell's full-screen camera view, and plain words when it cannot.
 *
 * `onFrame` is read through a ref, so a caller that passes a new callback
 * on every render (most do) never reopens the camera view.
 *
 * @param {{ scanner: import('./nativeQrScanner.js').NativeQrScanner, onFrame: (text: string) => void, alt: string }} props
 */
function NativeCameraScan({ scanner, onFrame, alt }) {
    const onFrameRef = useRef(onFrame);
    onFrameRef.current = onFrame;
    const stopRef = useRef(/** @type {(() => void) | null} */ (null));
    const mountedRef = useRef(false);
    const [phase, setPhase] = useState(/** @type {'idle' | 'starting' | 'open'} */ ('idle'));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            const stop = stopRef.current;
            stopRef.current = null;
            if (stop) stop();
        };
    }, []);

    async function open() {
        if (phase !== 'idle') return;
        setError(null);
        setPhase('starting');
        let closedEarly = false;
        let stop;
        try {
            stop = await scanner.start(
                (text) => {
                    if (mountedRef.current) {
                        deliverFrame(text, onFrameRef.current, setError);
                    }
                },
                (reason) => {
                    closedEarly = true;
                    stopRef.current = null;
                    if (!mountedRef.current) return;
                    setPhase('idle');
                    setError(nativeScanClosedText(reason));
                },
            );
        } catch (e) {
            // 'stopped' means the view was told to close before it finished
            // opening; nothing went wrong, so nothing is said.
            if (mountedRef.current) {
                setPhase('idle');
                setError(e?.reason === 'stopped' ? null : cameraErrorText(e));
            }
            return;
        }
        // Unmounted while the view was opening (the caller finished, or the
        // user navigated away): close it now rather than leave a camera
        // covering a screen that no longer exists.
        if (!mountedRef.current) {
            stop();
            return;
        }
        if (closedEarly) return;
        stopRef.current = stop;
        setPhase('open');
    }

    return (
        <div
            role="region"
            aria-label={alt}
            data-testid="qr-scanner-native"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
            }}
        >
            <Button
                variant="secondary"
                size="sm"
                onClick={open}
                loading={phase === 'starting'}
                disabled={phase !== 'idle'}
            >
                Scan with camera
            </Button>
            {error ? (
                <p
                    role="alert"
                    style={{
                        margin: 0,
                        padding: '0.75rem',
                        fontSize: '0.85rem',
                        lineHeight: 1.4,
                        color: 'var(--xc-text)',
                        background: 'var(--xc-bg-muted)',
                        borderRadius: 'var(--xc-radius-sm)',
                    }}
                >
                    {error}
                </p>
            ) : (
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--xc-text-muted)' }}>
                    {phase === 'open'
                        ? 'Scanning… point the camera at a QR code.'
                        : 'Opens the camera to read a QR code.'}
                </p>
            )}
        </div>
    );
}

export function QrScanner({
    onFrame: onFrameHandler,
    autoStart = true,
    width = 320,
    alt = 'QR scanner',
    previewState,
}) {
    const videoRef = useRef(/** @type {HTMLVideoElement | null} */ (null));
    const onFrameRef = useRef(onFrameHandler);
    onFrameRef.current = onFrameHandler;
    const onFrame = useRef((value) => onFrameRef.current(value)).current;
    const rememberedFailureRef = useRef(previewState ? null : rememberedCameraFailure());
    const terminalFailureRef = useRef(Boolean(rememberedFailureRef.current));
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(
        /** @type {string | null} */ (
            rememberedFailureRef.current ? cameraErrorText(rememberedFailureRef.current) : null
        ),
    );
    const [cameraRationaleAccepted, setCameraRationaleAccepted] = useState(
        () => Boolean(previewState) || terminalFailureRef.current || !isNativeApp(),
    );
    const hasBarcodeDetector = previewState === 'denied'
        || (previewState !== 'unsupported'
            && typeof window !== 'undefined'
            && typeof window.BarcodeDetector === 'function');
    const hasGetUserMedia = previewState === 'unsupported'
        || (typeof navigator !== 'undefined'
            && typeof navigator.mediaDevices?.getUserMedia === 'function');
    const isSecureContext = Boolean(previewState) || (typeof window !== 'undefined'
        && (window.isSecureContext === true
            || ['localhost', '127.0.0.1', '[::1]'].includes(window.location?.hostname)));
    const supported = previewState !== 'unsupported'
        && hasBarcodeDetector
        && (previewState === 'denied' || hasGetUserMedia)
        && isSecureContext;

    useEffect(() => {
        if (!supported || !autoStart || !cameraRationaleAccepted || terminalFailureRef.current) {
            return undefined;
        }
        if (previewState === 'denied') {
            setError(cameraErrorText({ name: 'NotAllowedError' }));
            return undefined;
        }
        let cancelled = false;
        /** @type {MediaStream | null} */
        let stream = null;
        /** @type {number | null} */
        let rafId = null;
        /** @type {any} */
        let detector = null;

        function stopBrowserCamera() {
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (stream) {
                stream.getTracks().forEach((track) => {
                    track.removeEventListener?.('ended', handleTrackEnded);
                    track.stop();
                });
                stream = null;
            }
            const video = videoRef.current;
            if (video) video.srcObject = null;
            setRunning(false);
        }

        function showCameraFailure(e) {
            if (cancelled) return;
            terminalFailureRef.current = rememberCameraFailure(e);
            stopBrowserCamera();
            setError(cameraErrorText(e));
        }

        function handleTrackEnded() {
            showCameraFailure({ name: 'NotAllowedError' });
        }

        async function start() {
            try {
                // Native types: populated via the BarcodeDetector
                // constructor. Empty formats array means "detect any
                // format the UA supports"; Chromium supports `qr_code`
                // universally which is what we care about.
                detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {
                if (!cancelled) setError(cameraErrorText(e));
                return;
            }

            try {
                let cameraPermission = null;
                const queryPermission = navigator.permissions?.query;
                if (typeof queryPermission === 'function') {
                    try {
                        cameraPermission = await queryPermission.call(
                            navigator.permissions,
                            { name: 'camera' },
                        );
                    } catch {
                        // Some WebViews expose Permissions.query but do not accept
                        // the camera descriptor. getUserMedia remains the source
                        // of truth in that case.
                    }
                }
                if (cameraPermission?.state === 'denied') {
                    if (!cancelled) setError(cameraErrorText({ name: 'NotAllowedError' }));
                    return;
                }
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                });
            } catch (e) {
                showCameraFailure(e);
                return;
            }

            const video = videoRef.current;
            if (!video) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            video.srcObject = stream;
            stream.getTracks().forEach((track) => {
                track.addEventListener?.('ended', handleTrackEnded, { once: true });
            });
            try {
                await video.play();
            } catch (e) {
                showCameraFailure(e);
                return;
            }
            if (cancelled) return;
            setRunning(true);

            const tick = async () => {
                if (cancelled || !video || !detector) return;
                try {
                    const results = await detector.detect(video);
                    for (const r of results || []) {
                        if (!cancelled && r) {
                            const inputError = scannedQrPayloadError(r.rawValue);
                            if (inputError) {
                                setError(inputError);
                            } else {
                                try {
                                    onFrameRef.current(r.rawValue);
                                    setError(null);
                                } catch {
                                    setError(MALFORMED_QR_TEXT);
                                }
                            }
                        }
                    }
                } catch {
                    // Intermittent detector errors are non-fatal; try
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
            stopBrowserCamera();
        };
    }, [supported, autoStart, previewState, cameraRationaleAccepted]);

    // The iPhone app: no BarcodeDetector in its WebView, but a native
    // scanner registered by the shell. Android's WebView has BarcodeDetector
    // and never reaches this branch.
    const nativeScanner = previewState || hasBarcodeDetector ? null : getNativeQrScanner();
    if (nativeScanner) {
        return <NativeCameraScan scanner={nativeScanner} onFrame={onFrame} alt={alt} />;
    }

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
            // Inside the app there is no other browser to switch to. This is a
            // shell build with no native scanner (an iPhone build from before
            // it, or an Android WebView without BarcodeDetector), so the
            // advice is to paste.
            reason = isNativeApp() ? (
                <>
                    Scanning with the camera is not available on this device yet.
                    Paste the code below instead.
                </>
            ) : (
                <>
                    This browser cannot scan QR codes with the camera. Chrome, Edge
                    and other Chromium browsers can; here, paste the code below
                    instead.
                </>
            );
        } else {
            reason = (
                <>
                    Camera access is not available in this browser. Paste the code
                    below instead.
                </>
            );
        }
        return (
            <div
                role="status"
                aria-label={`${alt} (unsupported)`}
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

    if (!cameraRationaleAccepted) {
        return (
            <div
                role="region"
                aria-label={alt}
                data-testid="qr-scanner-camera-rationale"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem',
                    fontSize: '0.85rem',
                    color: 'var(--xc-text)',
                    lineHeight: 1.4,
                    background: 'var(--xc-bg-muted)',
                    borderRadius: 'var(--xc-radius-sm)',
                }}
            >
                <p style={{ margin: 0 }}>
                    XChain Wallet uses the camera only to scan QR codes while this scanner is open.
                    You can paste the code instead.
                </p>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCameraRationaleAccepted(true)}
                >
                    Continue to camera
                </Button>
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
            {/* A camera surface appears only after playback starts. Permission
                prompts and failed starts keep the actionable text visible
                without leaving an empty dark rectangle on any shell. */}
            <video
                ref={videoRef}
                width={width}
                height={Math.round((width * 3) / 4)}
                playsInline
                muted
                poster={BLANK_POSTER}
                style={{
                    display: running && !error ? 'block' : 'none',
                    maxWidth: '100%',
                    height: 'auto',
                    aspectRatio: '4 / 3',
                    background: '#0F172A',
                    borderRadius: 4,
                }}
            />
            {error ? (
                <p
                    role="alert"
                    style={{
                        margin: 0,
                        padding: '0.75rem',
                        fontSize: '0.85rem',
                        lineHeight: 1.4,
                        color: 'var(--xc-text)',
                        background: 'var(--xc-bg-muted)',
                        borderRadius: 'var(--xc-radius-sm)',
                    }}
                >
                    {error}
                </p>
            ) : (
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--xc-text-muted)' }}>
                    {running ? 'Scanning… point the camera at a QR code.' : 'Starting camera…'}
                </p>
            )}
        </div>
    );
}
