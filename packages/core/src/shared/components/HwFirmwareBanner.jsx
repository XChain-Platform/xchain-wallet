// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// HwFirmwareBanner: sign-flow warning banner that renders on top of every
// HW-signed sign screen when the paired device's firmware is below the
// recommended floor, in the known-vulnerable list, or unsupported. Sits
// alongside the pairing-time `FirmwareBanner` in `PairSignerForm.jsx`,
// but is meant for the sign path specifically. The user sees this every
// time they're about to sign with an outdated device, not just at pair
// time, so they can't forget about a vulnerable firmware after the
// initial pair.
//
// Severity-to-style mapping mirrors the pairing banner:
//   - 'unsupported' / 'vulnerable' → error variant. Sign path may still
//     submit, but the form's parent should surface the banner in its
//     submit-button copy ("Update firmware first").
//   - 'outdated' → warning variant. Soft nudge.
//   - 'unknown'  → neutral note. Manifest doesn't know this model;
//     the user verifies manually.
//   - 'ok' → returns null; no banner.
//
// Renders as a `role="alert"` for vulnerable / unsupported so screen
// readers announce; `role="note"` for outdated / unknown.

import { signers as signersLib } from '@xchain-wallet/core';
import styles from './HwFirmwareBanner.module.css';

const { checkFirmware } = signersLib;

/**
 * @param {object} props
 * @param {{ vendor: string, model: string, firmwareVersion: string | null }} props.signerInfo
 */
export function HwFirmwareBanner({ signerInfo }) {
    if (!signerInfo) return null;
    const { vendor, model, firmwareVersion } = signerInfo;
    if (!vendor || !model) return null;

    const verdict = checkFirmware({
        vendor,
        model,
        version: firmwareVersion ?? '',
    });

    if (verdict.status === 'ok') return null;

    const severe = verdict.status === 'vulnerable' || verdict.status === 'unsupported';
    const role = severe ? 'alert' : 'note';
    const className = severe
        ? styles.errorBanner
        : verdict.status === 'outdated'
        ? styles.warningBanner
        : styles.neutralBanner;

    const headline = severe
        ? verdict.status === 'vulnerable'
            ? 'Update firmware before signing'
            : 'Unsupported firmware'
        : verdict.status === 'outdated'
        ? 'Firmware update recommended'
        : 'Firmware status unknown';

    return (
        <div role={role} className={className}>
            <strong className={styles.headline}>{headline}</strong>
            {verdict.detail ? (
                <p className={styles.detail}>{verdict.detail}</p>
            ) : null}
            {verdict.updateUrl ? (
                <a
                    className={styles.updateLink}
                    href={verdict.updateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open vendor update tool →
                </a>
            ) : null}
        </div>
    );
}
