// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as branding from '../branding/branding.js';
import { FilterIcon, TokenListIcon } from './icons/index.jsx';
import { NetworkPicker } from './NetworkPicker.jsx';
import { InfoTip } from './InfoTip.jsx';
import { fieldHelpName } from './fieldRequirement.js';
import buttonStyles from './Button.module.css';
import styles from './ChainPicker.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/firstPaint.js';
import '../i18n/locales/en/ui.js';

/**
 * The standard network form field. It owns its picker screen unless a host
 * supplies onOpenPicker to navigate to a host-owned picker.
 *
 * @param {object} props
 * @param {string} props.value                     selected chainId
 * @param {(chainId: string) => void} props.onChange
 * @param {string[]} props.chainIds               chains offered (typically all with addresses)
 * @param {import('../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string} [props.label]                  defaults to "Network"
 * @param {boolean} [props.disabled]
 * @param {'md' | 'lg'} [props.size]
 * @param {() => void} [props.onOpenPicker]
 * @param {boolean} [props.allOption]             offer the all-networks sentinel
 * @param {import('react').ReactNode} [props.help] help for this field on this form, shown from the label-row InfoTip as Input and Select do
 */
export function NetworkField({
    value,
    onChange,
    chainIds,
    chainRegistry,
    label = t('settings.network.label'),
    disabled = false,
    size = 'md',
    onOpenPicker,
    allOption = false,
    help,
}) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);
    const allSelected = allOption && value === 'all';
    const selected = allSelected ? null : chainRegistry?.get(value);
    const selectionText = allSelected
        ? t('common.allNetworks')
        : (selected?.displayName || value || '');
    const iconUrl = !allSelected && value ? branding.chainIconSmallUrl(value) : null;
    const accessibleName = label ? `${label}: ${selectionText}` : selectionText;
    const hasHelp = Boolean(label && help);

    const closePicker = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus();
    }, []);

    const chooseNetwork = useCallback((chainId) => {
        onChange(chainId);
        closePicker();
    }, [closePicker, onChange]);

    const portalTarget = typeof document === 'undefined'
        ? null
        : triggerRef.current?.closest('#xc-main')?.parentElement || document.body;

    return (
        <div className={`${styles.wrap} ${styles[size] || ''}`.trim()}>
            {hasHelp ? (
                <div className={styles.labelRow}>
                    <span className={styles.label}>{label}</span>
                    <InfoTip
                        className={styles.labelHelp}
                        label={help}
                        aria={t('ui.field.about', { label: fieldHelpName(label) })}
                    />
                </div>
            ) : label ? <span className={styles.label}>{label}</span> : null}
            <button
                type="button"
                ref={triggerRef}
                className={`${buttonStyles.btn} ${styles.trigger}`}
                onClick={() => {
                    if (disabled) return;
                    if (onOpenPicker) onOpenPicker();
                    else setOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                aria-label={accessibleName}
                disabled={disabled}
            >
                {allSelected || iconUrl ? (
                    <span className={styles.triggerIcon} aria-hidden="true">
                        {allSelected ? <FilterIcon /> : <img src={iconUrl} alt="" />}
                    </span>
                ) : null}
                <span className={styles.triggerText}>
                    <span className={styles.triggerLabel}>{selectionText}</span>
                </span>
                <span className={styles.triggerCaret} aria-hidden="true">
                    <TokenListIcon />
                </span>
            </button>
            {open && portalTarget ? createPortal(
                <NetworkPicker
                    label={label}
                    value={value}
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    onSelect={chooseNetwork}
                    onBack={closePicker}
                    contained={portalTarget !== document.body}
                    allOption={allOption}
                />,
                portalTarget,
            ) : null}
        </div>
    );
}
