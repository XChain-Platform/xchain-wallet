// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// KeyQR — static-string QR primitive for ViewPrivateKey + similar
// "show this opaque value as a scannable QR" surfaces (Cluster E
// FOLLOWUP 5 / §17.7).
//
// Renders a lazy QR via the bundled `qrcode` library. The component
// is self-contained — caller passes a string `value`; the canvas
// regenerates whenever the value changes. Errors degrade silently
// (the component renders nothing) so reveal screens stay usable
// even if the encoder rejects an oversized string.
//
// Both shells (extension popup + web + desktop) wire this through
// `ViewPrivateKey`'s `renderQR` render-prop so the component itself
// stays framework-agnostic and the QR area doesn't ship its
// dependency unless a route asks for it.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * @param {object} props
 * @param {string} props.value
 * @param {number} [props.size]   pixel width (default 200)
 * @param {string} [props.alt]    accessibility label (default 'QR code')
 */
export function KeyQR({ value, size = 200, alt = 'QR code' }) {
    const [dataUrl, setDataUrl] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (typeof value !== 'string' || value.length === 0) {
            setDataUrl(null);
            return undefined;
        }
        let cancelled = false;
        QRCode.toDataURL(value, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: size,
            color: { dark: '#0F172A', light: '#FFFFFF' },
        })
            .then((url) => { if (!cancelled) setDataUrl(url); })
            .catch(() => { if (!cancelled) setDataUrl(null); });
        return () => { cancelled = true; };
    }, [value, size]);

    if (!dataUrl) return null;
    return (
        <img
            src={dataUrl}
            alt={alt}
            width={size}
            height={size}
            style={{ borderRadius: 'var(--xc-radius-md)', display: 'block' }}
        />
    );
}
