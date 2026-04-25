import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Render a sequence of strings as animated QR codes — frames advance
 * at `fps` per second. Used for §20.3 chunked PSBT-over-QR transport
 * (encoded by `encodeXcwChunks`) and for §22.3 multisig PSBT
 * round-trip envelopes wrapped in the same chunk format.
 *
 * Hidden complexity: `qrcode.toDataURL` is async, so we render each
 * frame to a data URL on demand and cache them in `urls`. While a
 * frame is being rendered the previous frame stays visible — avoids
 * flicker.
 *
 * @param {object} props
 * @param {string[]} props.frames        non-empty array of strings (one QR per frame)
 * @param {number} [props.fps]           default 3 fps, per §20.3
 * @param {number} [props.size]          QR pixel size; default 240
 * @param {string} [props.alt]           alt text for the rendered <img>
 */
export function AnimatedQrFrames({ frames, fps = 3, size = 240, alt = 'Animated QR' }) {
    const [index, setIndex] = useState(0);
    const [urls, setUrls] = useState(/** @type {Record<number, string>} */ ({}));

    useEffect(() => {
        let cancelled = false;
        async function renderFrame(i) {
            if (urls[i]) return;
            try {
                const dataUrl = await QRCode.toDataURL(frames[i], {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    width: size,
                    color: { dark: '#0F172A', light: '#FFFFFF' },
                });
                if (!cancelled) {
                    setUrls((prev) => ({ ...prev, [i]: dataUrl }));
                }
            } catch {
                // Leave the slot empty; the prior frame stays visible.
            }
        }
        renderFrame(index);
        renderFrame((index + 1) % frames.length);
        return () => { cancelled = true; };
    }, [frames, index, size, urls]);

    useEffect(() => {
        if (frames.length <= 1) return undefined;
        const intervalMs = Math.max(50, Math.floor(1000 / fps));
        const id = setInterval(() => {
            setIndex((i) => (i + 1) % frames.length);
        }, intervalMs);
        return () => clearInterval(id);
    }, [frames, fps]);

    if (!Array.isArray(frames) || frames.length === 0) return null;

    const dataUrl = urls[index] || urls[0] || null;
    return (
        <div
            role="img"
            aria-label={`${alt} (frame ${index + 1} of ${frames.length})`}
            data-testid="animated-qr-frames"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
            }}
        >
            {dataUrl ? (
                <img
                    src={dataUrl}
                    alt=""
                    width={size}
                    height={size}
                    style={{ background: '#FFFFFF', borderRadius: 4 }}
                />
            ) : (
                <div
                    style={{
                        width: size,
                        height: size,
                        background: '#F1F5F9',
                        borderRadius: 4,
                    }}
                />
            )}
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                Frame {index + 1} / {frames.length} · {fps} fps
            </span>
        </div>
    );
}
