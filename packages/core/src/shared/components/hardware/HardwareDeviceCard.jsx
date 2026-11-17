// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The hardware wallet card the connect flow, the sign page and the manage
// page share: the vendor picture, the device name and one status pill
// (Found by USB, Connected, Not connected, Unlock your Trezor). It is one
// card; a page never puts it inside another card.

import { signerVendorLogoUrl } from '../../../branding/branding.js';
import { FIRMWARE_MANIFEST } from '../../../signers/firmware-manifest.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/hardwareConnect.js';
import styles from './HardwareDeviceCard.module.css';

/** The vendor's own name, or the generic word when it is unknown. */
export function hardwareVendorName(vendor) {
    if (vendor === 'trezor') return t('hardwareConnect.vendor.trezor');
    if (vendor === 'ledger') return t('hardwareConnect.vendor.ledger');
    return t('hardwareConnect.vendor.other');
}

// Model codes the signer packages can store that the firmware manifest has no
// row for. Trezor's getFeatures passes `internal_model` through as is (T3B1 is
// the newer Safe 3 board) and older firmware's plain `model` string ("Safe 3")
// too. Ledger's ids follow @ledgerhq/devices, whose id for the Flex is
// "europa" and for the Nano Gen5 "apex". Product names, never translated.
const EXTRA_MODEL_NAMES = Object.freeze({
    trezor: Object.freeze({
        1: 'Trezor Model One',
        T: 'Trezor Model T',
        T3B1: 'Trezor Safe 3',
        One: 'Trezor Model One',
        'Safe 3': 'Trezor Safe 3',
        'Safe 5': 'Trezor Safe 5',
    }),
    ledger: Object.freeze({
        flex: 'Ledger Flex',
        europa: 'Ledger Flex',
        apex: 'Ledger Nano Gen5',
    }),
});

/**
 * The product name for a stored model code ("nanoSP" is "Ledger Nano S
 * Plus"). The firmware manifest's display names come first, then the codes
 * above. A code neither table knows is never shown raw: one that is already
 * a spelled-out name ("Nano X") follows the vendor's name, and any other
 * (a new board id) shows the vendor's name alone.
 *
 * @param {string | null | undefined} vendor  'trezor' | 'ledger'
 * @param {string | null | undefined} model   the code the signer recorded
 * @returns {string}
 */
export function hardwareModelName(vendor, model) {
    const code = typeof model === 'string' ? model.trim() : '';
    const vendorName = hardwareVendorName(vendor);
    const own = (table) => (table && Object.prototype.hasOwnProperty.call(table, code) ? table[code] : null);
    const manifest = own(FIRMWARE_MANIFEST.vendors?.[vendor]?.models);
    if (manifest?.displayName) return manifest.displayName;
    const extra = own(EXTRA_MODEL_NAMES[vendor]);
    if (extra) return extra;
    if (/\s/.test(code)) {
        return code.toLowerCase().startsWith(`${vendorName.toLowerCase()} `) ? code : `${vendorName} ${code}`;
    }
    return vendorName;
}

// Green for a device the app can reach, amber for one waiting on its PIN,
// muted for one that is gone.
const STATUS_TONE = {
    found: 'good',
    connected: 'good',
    unlock: 'wait',
    'not-connected': 'off',
};

function statusText(status, vendorName) {
    if (status === 'found') return t('hardwareConnect.device.found');
    if (status === 'connected') return t('hardwareConnect.device.connected');
    if (status === 'unlock') return t('hardwareConnect.device.unlock', { vendor: vendorName });
    return t('hardwareConnect.device.notConnected');
}

/**
 * @param {{vendor: string, model?: string, name?: string,
 *   status: 'found'|'connected'|'not-connected'|'unlock'}} props
 *   `name` is the device's display name (Trezor Safe 3); without it the card
 *   shows the model's product name.
 */
export function HardwareDeviceCard({ vendor, model, name, status }) {
    const vendorName = hardwareVendorName(vendor);
    const title = name || hardwareModelName(vendor, model);
    const logo = signerVendorLogoUrl(vendor);
    const tone = STATUS_TONE[status] || 'off';
    return (
        <section
            className={styles.card}
            aria-label={title}
            data-hardware-device-card=""
            data-vendor={vendor}
            data-status={status}
        >
            <span className={styles.picture} aria-hidden="true">
                {logo ? (
                    <img className={styles.logo} src={logo} alt="" width="48" height="48" />
                ) : null}
            </span>
            <span className={styles.name}>{title}</span>
            <span className={styles.status} data-tone={tone}>
                <span className={styles.dot} aria-hidden="true" />
                {statusText(status, vendorName)}
            </span>
        </section>
    );
}
