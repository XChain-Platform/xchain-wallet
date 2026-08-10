// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Sandboxed in-app viewer for unlocked gated-file plaintext (PC-27).
//
// Threat model: anyone can be a gated-content issuer, so the decrypted
// bytes AND the on-chain declared MIME are attacker-controlled. The
// wallet origin holds session key material, so those bytes must never
// gain a scripting context here. Hard rules this component enforces:
//   - No `window.open(blobUrl)` and no navigation to the plaintext:
//     a blob document inherits the wallet origin, so declared
//     `text/html` or `image/svg+xml` bytes would execute script
//     same-origin with the wallet. Everything renders inside this
//     modal in script-inert surfaces.
//   - Presentation is decided by sniffing the BYTES (sniffContent.js);
//     the declared type is shown as a label and compared for a
//     mismatch warning, but never chooses a render path.
//   - Raster images and SVG render only via <img> (SVG-as-image
//     disables scripts, external loads, and foreignObject); text
//     renders as a React text node inside <pre> (escaped, never
//     interpreted); every other kind - including PDF - is
//     download-only.
//   - Downloads are Blob'd as application/octet-stream regardless of
//     sniffed type, so a saved-then-reopened file never round-trips
//     through a wallet-origin document either.

import { useEffect, useMemo } from 'react';
import { Button, StatusMessage } from '@xchain-wallet/core/ui';
import { sniffContent } from '../utils/sniffContent.js';
import styles from './GatedFileViewer.module.css';

const MAX_TEXT_CHARS = 200_000;

function decodeBase64(plaintextBase64) {
    try {
        const bin = typeof atob === 'function'
            ? atob(plaintextBase64)
            : Buffer.from(plaintextBase64, 'base64').toString('binary');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return bytes;
    } catch (_e) {
        return null;
    }
}

/**
 * Is the on-chain declared MIME plausibly describing the sniffed
 * content? Purely a warning input; render decisions never consult it.
 */
function declaredMatchesSniff(declared, sniffed) {
    if (sniffed.kind === 'image') {
        // image/jpg is a common alias for image/jpeg.
        return declared === sniffed.mime
            || (sniffed.mime === 'image/jpeg' && declared === 'image/jpg');
    }
    if (sniffed.kind === 'svg' || sniffed.kind === 'pdf') {
        return declared === sniffed.mime;
    }
    if (sniffed.kind === 'text') {
        // Any textual declared type is fine, but an image/* claim over
        // text bytes (e.g. "image/svg+xml" that didn't sniff as SVG)
        // stays a mismatch.
        return declared.startsWith('text/')
            || declared === 'application/json'
            || declared === 'application/xml'
            || (!declared.startsWith('image/') && (declared.endsWith('+json') || declared.endsWith('+xml')));
    }
    // binary: only an explicit opaque declaration matches.
    return declared === 'application/octet-stream';
}

function kindLabel(kind, mime) {
    if (kind === 'image') return mime || 'image';
    if (kind === 'svg') return 'SVG image';
    if (kind === 'text') return 'plain text';
    if (kind === 'pdf') return 'PDF';
    return 'binary data';
}

/**
 * @param {object} props
 * @param {string} props.name              display name for the file row / download
 * @param {string | null} [props.declaredType]  on-chain declared MIME (cosmetic only)
 * @param {string} props.plaintextBase64   decrypted plaintext, base64
 * @param {() => void} props.onClose
 */
export function GatedFileViewer({ name, declaredType, plaintextBase64, onClose }) {
    const bytes = useMemo(() => decodeBase64(plaintextBase64), [plaintextBase64]);
    const sniffed = useMemo(() => sniffContent(bytes), [bytes]);

    // Inline-render blob URL, typed with the SNIFFED mime only. Created
    // solely for <img> consumption; never opened as a document.
    const imageUrl = useMemo(() => {
        if (!bytes) return null;
        if (sniffed.kind !== 'image' && sniffed.kind !== 'svg') return null;
        try {
            return URL.createObjectURL(new Blob([bytes], { type: sniffed.mime }));
        } catch (_e) {
            return null;
        }
    }, [bytes, sniffed]);

    useEffect(() => {
        if (!imageUrl) return undefined;
        return () => URL.revokeObjectURL(imageUrl);
    }, [imageUrl]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const text = useMemo(() => {
        if (!bytes || sniffed.kind !== 'text') return null;
        try {
            const decoded = typeof TextDecoder === 'function'
                ? new TextDecoder('utf-8').decode(bytes)
                : Buffer.from(bytes).toString('utf8');
            return decoded.length > MAX_TEXT_CHARS
                ? `${decoded.slice(0, MAX_TEXT_CHARS)}\n… (truncated for display; download for the full file)`
                : decoded;
        } catch (_e) {
            return null;
        }
    }, [bytes, sniffed]);

    function handleDownload() {
        if (!bytes) return;
        let url = null;
        try {
            // Deliberately NOT the sniffed type: a saved file typed
            // octet-stream downloads again instead of rendering if it
            // ever lands back in a browser tab.
            url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = name || 'unlocked-file';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (_e) {
            // Nothing actionable; the button stays available for retry.
        } finally {
            if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
    }

    const declared = String(declaredType || '').trim().toLowerCase();
    // Warn when the publisher's declared type disagrees with the bytes.
    // A benign issuer typo trips this too, but for spoof-shaped input
    // (declares an image, carries something else - including bytes we
    // can't identify at all) it is the one signal the holder gets
    // before saving the file.
    const mismatch = declared ? !declaredMatchesSniff(declared, sniffed) : false;

    let body;
    if (!bytes) {
        body = <p className={styles.notice}>Could not decode the unlocked bytes.</p>;
    } else if (imageUrl) {
        body = <img className={styles.image} src={imageUrl} alt={name || 'Unlocked gated image'} />;
    } else if (text !== null) {
        body = <pre className={styles.text}>{text}</pre>;
    } else if (sniffed.kind === 'pdf') {
        body = (
            <p className={styles.notice}>
                PDF preview is disabled for security. Download the file and
                open it in your PDF viewer.
            </p>
        );
    } else {
        body = (
            <p className={styles.notice}>
                This file type can&apos;t be previewed. Download it to view
                with a matching application.
            </p>
        );
    }

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-label={`Unlocked file: ${name || 'gated file'}`}
            onClick={onClose}
            tabIndex={-1}
        >
            <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="presentation" tabIndex={-1}>
                <p className={styles.title}>{name || 'Unlocked file'}</p>
                <p className={styles.meta}>
                    {bytes ? `${bytes.length.toLocaleString()} bytes · ` : ''}
                    detected: {kindLabel(sniffed.kind, sniffed.mime)}
                    {declared ? ` · published as: ${declared}` : ''}
                </p>
                {mismatch ? (
                    <StatusMessage variant="error" className={styles.mismatch}>
                        The published file type ({declared}) doesn&apos;t match the
                        actual content ({kindLabel(sniffed.kind, sniffed.mime)}).
                        Treat this file with caution.
                    </StatusMessage>
                ) : null}
                <div className={styles.body}>{body}</div>
                <div className={styles.actions}>
                    <Button variant="secondary" block onClick={onClose} autoFocus>
                        Close
                    </Button>
                    <Button variant="primary" block onClick={handleDownload} disabled={!bytes}>
                        Download
                    </Button>
                </div>
            </div>
        </div>
    );
}
