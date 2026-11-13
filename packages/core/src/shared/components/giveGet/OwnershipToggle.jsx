// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId } from 'react';
import { InfoTip } from '../../../ui/InfoTip.jsx';
import switchStyles from '../../../ui/Switch.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/ui.js';
import styles from './GiveGet.module.css';

/**
 * One ownership on/off switch for a Give/Get side. Drawn with the
 * shared Switch's track and thumb, but the label and its ? help sit outside
 * any <label> wrapper so tapping the help never flips the switch. The fixed
 * explanation lives in the help tip; nothing static sits under the label.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {import('react').ReactNode} [props.help]
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 */
export function OwnershipToggle({ label, help, checked, onChange, disabled = false, id }) {
    const autoId = useId();
    const inputId = id || `own-${autoId.replace(/:/g, '')}`;
    return (
        <div className={styles.toggleRow}>
            <div className={styles.toggleCopy}>
                <span className={styles.toggleLabelRow}>
                    <label className={styles.toggleLabel} htmlFor={inputId}>{label}</label>
                    {help ? <InfoTip label={help} aria={t('ui.field.about', { label })} /> : null}
                </span>
            </div>
            <span className={`${switchStyles.hitArea} ${styles.toggleSwitch}`}>
                <input
                    id={inputId}
                    className={switchStyles.input}
                    type="checkbox"
                    role="switch"
                    aria-checked={checked}
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked)}
                />
                <span className={switchStyles.track} aria-hidden="true">
                    <span className={switchStyles.thumb} />
                </span>
            </span>
        </div>
    );
}
