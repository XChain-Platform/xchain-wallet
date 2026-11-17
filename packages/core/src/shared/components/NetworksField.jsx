// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useState } from 'react';
import * as branding from '../../branding/branding.js';
import { TokenListIcon } from '../../ui/icons/index.jsx';
import { OptionalPill } from '../../ui/OptionalPill.jsx';
import { fieldHelpName, resolveFieldRequirement } from '../../ui/fieldRequirement.js';
import { InfoTip } from '../../ui/InfoTip.jsx';
// The same sheets as ListField, in the same order, so this field has the Form
// Standard height, border, type and G112 icon slots with no geometry of its own.
import buttonStyles from '../../ui/Button.module.css';
import tokenStyles from './TokenField.module.css';
import listStyles from './ListField.module.css';
import inputStyles from '../../ui/Input.module.css';
import styles from './NetworksField.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/ui.js';

/**
 * Past this many characters of joined names the field switches to the count
 * form ("3 networks: Bitcoin, Dogecoin, Litecoin"), so a long choice still
 * says how many networks it holds when its tail is cut off. A fixed budget
 * rather than a layout measurement, so every width and every test reads the
 * same text.
 */
export const NETWORKS_FIELD_NAMES_BUDGET = 20;

/**
 * The most network icons the field draws. The wallet grows to many networks,
 * so a longer choice shows the first five icons and a "+N more" label rather
 * than a row of icons too small to tell apart.
 */
export const NETWORKS_FIELD_MAX_ICONS = 5;

/**
 * How many icons the field draws for a choice of `count` networks, and how
 * many it folds into the "+N more" label.
 *
 * @param {number} count
 * @returns {{ shown: number, more: number }}
 */
export function networksFieldIcons(count) {
    const shown = Math.min(Math.max(0, count), NETWORKS_FIELD_MAX_ICONS);
    return { shown, more: Math.max(0, count - shown) };
}

/**
 * One network a NetworksField can show.
 *
 * @typedef {object} NetworksFieldOption
 * @property {string} value     what the host stores (a coin ticker, a chain id)
 * @property {string} title     the network's name, e.g. Bitcoin
 * @property {string} [chainId] the chain whose icon is drawn
 */

/**
 * The text a NetworksField shows for a choice, and whether that text is the
 * count form. Exported so the rule is tested without a DOM.
 *
 * @param {string[]} names the chosen networks' names, in list order
 * @returns {{ text: string, summary: boolean }}
 */
export function networksFieldText(names) {
    const joined = names.join(', ');
    if (names.length <= 1
        || (names.length <= NETWORKS_FIELD_MAX_ICONS && joined.length <= NETWORKS_FIELD_NAMES_BUDGET)) {
        return { text: joined, summary: false };
    }
    return {
        text: t('components.networksField.summary', { count: names.length, names: joined }),
        summary: true,
    };
}

/**
 * NetworksField: one picker field for a choice of several networks (G117).
 *
 * A field-shaped button showing the chosen networks (each network's icon and
 * name while the names fit, otherwise the icons of the first five and a
 * "+N more" label for the rest; the button's name always lists every chosen
 * network) with the list icon at
 * its trailing edge; tapping it opens the host's networks picker page. Only the
 * chosen networks appear here, so the field keeps one height however many
 * networks the wallet supports. Presentation and click only: the host owns the
 * picker and the selection.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {import('react').ReactNode} [props.help]   help from the label-row InfoTip
 * @param {NetworksFieldOption[]} props.options      every network the picker offers, in display order
 * @param {string[]} props.selected                  the chosen option values
 * @param {string} props.placeholder                 empty-state text, e.g. None set
 * @param {() => void} props.onOpenPicker
 * @param {boolean} [props.optional]
 * @param {boolean} [props.disabled]
 * @param {string} [props.error]
 * @param {string} [props.id]
 */
export function NetworksField({
    label,
    help,
    options,
    selected,
    placeholder,
    onOpenPicker,
    optional = false,
    disabled = false,
    error,
    id,
}) {
    const autoId = useId();
    const controlId = id || autoId;
    const errorId = error ? `${controlId}-error` : undefined;
    const requirement = resolveFieldRequirement({ label, optional });
    const optionalPillId = requirement.isOptional ? `${controlId}-optional` : undefined;
    const hasHelp = Boolean(label && help);
    const [failedIcons, setFailedIcons] = useState(/** @type {string[]} */ ([]));

    const chosenSet = new Set(selected || []);
    const chosen = (options || []).filter((option) => chosenSet.has(option.value));
    const names = chosen.map((option) => option.title);
    const { text, summary } = networksFieldText(names);
    const iconPlan = networksFieldIcons(chosen.length);
    const hasValue = chosen.length > 0;
    const selectionText = hasValue ? names.join(', ') : placeholder;
    const accessibleName = requirement.label ? `${requirement.label}: ${selectionText}` : selectionText;
    const describedBy = [optionalPillId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className={tokenStyles.field} data-networks-field="" data-form-network-exempt="">
            {label && (requirement.isOptional || hasHelp) ? (
                <div className={inputStyles.labelRow}>
                    <span className={`${tokenStyles.label} ${inputStyles.label}`}>{requirement.label}</span>
                    {requirement.isOptional ? <OptionalPill id={optionalPillId} /> : null}
                    {hasHelp ? (
                        <InfoTip
                            className={inputStyles.labelHelp}
                            label={help}
                            aria={t('ui.field.about', { label: fieldHelpName(requirement.label) })}
                        />
                    ) : null}
                </div>
            ) : label ? <span className={tokenStyles.label}>{requirement.label}</span> : null}
            <div className={listStyles.controlWrap}>
                <button
                    type="button"
                    id={controlId}
                    className={`${buttonStyles.btn} ${tokenStyles.control} ${error ? tokenStyles.invalid : ''}`.trim()}
                    onClick={onOpenPicker}
                    disabled={disabled}
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={describedBy}
                    aria-label={accessibleName}
                >
                    {!hasValue ? (
                        <span className={tokenStyles.placeholder}>{placeholder}</span>
                    ) : summary ? (
                        // The longer choice: the first five icons, then "+N more"
                        // for the rest. The button's name lists every network.
                        <span className={`${listStyles.value} ${styles.stack}`} title={text} data-networks-summary="">
                            {chosen.slice(0, iconPlan.shown).map((option) => {
                                const iconUrl = option.chainId ? branding.chainIconSmallUrl(option.chainId) : null;
                                const showIcon = iconUrl && !failedIcons.includes(iconUrl);
                                return showIcon ? (
                                    <img
                                        key={option.value}
                                        className={styles.networkIcon}
                                        src={iconUrl}
                                        alt=""
                                        aria-hidden="true"
                                        data-network-value={option.value}
                                        onError={() => setFailedIcons((urls) => [...urls, iconUrl])}
                                    />
                                ) : (
                                    // No icon for this chain: its initial in a
                                    // round mark, so every network still shows.
                                    <span
                                        key={option.value}
                                        className={`${styles.networkIcon} ${styles.networkLetter}`}
                                        aria-hidden="true"
                                        data-network-value={option.value}
                                    >
                                        {String(option.title || option.value || '?').slice(0, 1).toUpperCase()}
                                    </span>
                                );
                            })}
                            {iconPlan.more > 0 ? (
                                <span className={styles.more} data-networks-more="">
                                    {t('components.networksField.more', { count: iconPlan.more })}
                                </span>
                            ) : null}
                        </span>
                    ) : (
                        <span className={`${listStyles.value} ${styles.names}`} title={text}>
                            {chosen.map((option) => {
                                const iconUrl = option.chainId ? branding.chainIconSmallUrl(option.chainId) : null;
                                const showIcon = iconUrl && !failedIcons.includes(iconUrl);
                                return (
                                    <span key={option.value} className={styles.network} data-network-value={option.value}>
                                        {showIcon ? (
                                            <img
                                                className={styles.networkIcon}
                                                src={iconUrl}
                                                alt=""
                                                aria-hidden="true"
                                                onError={() => setFailedIcons((urls) => [...urls, iconUrl])}
                                            />
                                        ) : null}
                                        <span className={styles.networkName}>{option.title}</span>
                                    </span>
                                );
                            })}
                        </span>
                    )}
                    <span className={tokenStyles.caret} aria-hidden="true">
                        <TokenListIcon />
                    </span>
                </button>
            </div>
            {error ? (
                <div id={errorId} className={inputStyles.error} role="alert">{error}</div>
            ) : null}
        </div>
    );
}
