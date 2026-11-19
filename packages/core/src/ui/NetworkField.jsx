// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useContext, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as branding from '../branding/branding.js';
import { FilterIcon, TokenListIcon } from './icons/index.jsx';
import { NetworkPicker } from './NetworkPicker.jsx';
import { InfoTip } from './InfoTip.jsx';
import { fieldHelpName } from './fieldRequirement.js';
import { InFilterPanel } from './filterPanelSlot.js';
import { usePickedFieldError } from './formErrors.js';
import buttonStyles from './Button.module.css';
import inputStyles from './Input.module.css';
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
 * @param {boolean} [props.notSource]             this network is data (the chain to verify on, a linked
 *                                                action's chain, a bridge destination), not the form's source
 *                                                network, so the Form Standard's From rule skips it
 *                                                (data-form-network-exempt)
 * @param {string} [props.placeholder]           shown muted while no network is chosen
 * @param {string} [props.id]                    the trigger's id; with a form on the form error standard
 *                                                (useFormErrors), the field reads its entry by this id, outlines
 *                                                red with its line under it, and drops it when a network is picked
 * @param {string} [props.formErrorKey]         read this entry of the form's map instead of `id` (a form-level
 *                                                key such as 'form:dest-network', listed as a plain line)
 * @param {string | null} [props.error]          an error the caller shows itself; wins over the form's entry
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
    notSource = false,
    placeholder,
    id,
    formErrorKey,
    error: errorProp,
}) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);
    // A host-owned picker writes the pick back as a new value, so the form's
    // entry leaves the map when the value changes as well as on a pick here.
    const formField = usePickedFieldError(formErrorKey ?? id, value || '');
    const error = errorProp || formField.error;
    const autoId = useId();
    const errorId = error ? `${id || autoId}-error` : undefined;
    const allSelected = allOption && value === 'all';
    const selected = allSelected || !value ? null : chainRegistry?.get(value);
    const chosenText = allSelected
        ? t('common.allNetworks')
        : (selected?.displayName || value || '');
    const showPlaceholder = !chosenText && Boolean(placeholder);
    const selectionText = chosenText || placeholder || '';
    // The chain's own id (the descriptor's, when the registry has one) picks the
    // icon; the large file backs the small one as it does in a token avatar, so
    // a field never shows an empty slot where the wallet has the network's icon.
    const iconChainId = selected?.id || value;
    const smallIconUrl = !allSelected && iconChainId ? branding.chainIconSmallUrl(iconChainId) : null;
    const largeIconUrl = !allSelected && iconChainId ? branding.chainIconLargeUrl(iconChainId) : null;
    const [failedIconUrls, setFailedIconUrls] = useState(/** @type {string[]} */ ([]));
    const iconUrl = [smallIconUrl, largeIconUrl].find((url) => url && !failedIconUrls.includes(url)) || null;
    const iconFailed = !iconUrl && Boolean(smallIconUrl || largeIconUrl);
    const fallbackLetter = String(chosenText || iconChainId || '?').slice(0, 1).toUpperCase();
    const accessibleName = label ? `${label}: ${selectionText}` : selectionText;
    // Every Network field carries the ? help; a form without its own
    // wording gets the general explanation.
    const fieldHelp = help || "The blockchain this runs on. The address, the network fee and the coin it is paid in all belong to this network.";
    // In a list's filter panel the label is the field's accessible name only,
    // as Select's is there (G96 walk ruling 2026-11-13).
    const shownLabel = useContext(InFilterPanel) ? '' : label;
    const hasHelp = Boolean(shownLabel && fieldHelp);
    const showIcon = allSelected || Boolean(iconUrl) || iconFailed;

    const closePicker = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus();
    }, []);

    const clearOwnError = formField.clear;
    const chooseNetwork = useCallback((chainId) => {
        clearOwnError();
        onChange(chainId);
        closePicker();
    }, [clearOwnError, closePicker, onChange]);

    const portalTarget = typeof document === 'undefined'
        ? null
        : triggerRef.current?.closest('#xc-main')?.parentElement || document.body;

    return (
        <div
            className={`${styles.wrap} ${styles[size] || ''}`.trim()}
            data-form-network-exempt={notSource ? '' : undefined}
        >
            {hasHelp ? (
                <div className={styles.labelRow}>
                    <span className={styles.label}>{shownLabel}</span>
                    <InfoTip
                        className={styles.labelHelp}
                        label={fieldHelp}
                        aria={t('ui.field.about', { label: fieldHelpName(shownLabel) })}
                    />
                </div>
            ) : shownLabel ? <span className={styles.label}>{shownLabel}</span> : null}
            <button
                type="button"
                ref={triggerRef}
                id={id}
                // G112: leadIcon puts the network icon in its square slot.
                className={`${buttonStyles.btn} ${styles.trigger}${showIcon ? ` ${styles.leadIcon}` : ''}${error ? ` ${styles.invalid}` : ''}`}
                onClick={() => {
                    if (disabled) return;
                    if (onOpenPicker) onOpenPicker();
                    else setOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                aria-label={accessibleName}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={errorId}
                disabled={disabled}
            >
                {showIcon ? (
                    <span className={styles.triggerIcon} aria-hidden="true">
                        {allSelected ? <FilterIcon /> : iconFailed ? (
                            <span className={styles.triggerIconLetter}>{fallbackLetter}</span>
                        ) : (
                            <img
                                src={iconUrl}
                                alt=""
                                onError={() => setFailedIconUrls((urls) => [...urls, iconUrl])}
                            />
                        )}
                    </span>
                ) : null}
                <span className={styles.triggerText}>
                    <span className={showPlaceholder ? styles.triggerPlaceholder : styles.triggerLabel}>{selectionText}</span>
                </span>
                <span className={styles.triggerCaret} aria-hidden="true">
                    <TokenListIcon />
                </span>
            </button>
            {error ? <div id={errorId} className={inputStyles.error} role="alert">{error}</div> : null}
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
