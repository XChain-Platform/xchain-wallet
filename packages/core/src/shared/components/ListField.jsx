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
import { TokenListIcon, XIcon } from '../../ui/icons/index.jsx';
import { FieldIconButton } from '../../ui/FieldIconButton.jsx';
import { OptionalPill } from '../../ui/OptionalPill.jsx';
import { fieldHelpName, resolveFieldRequirement } from '../../ui/fieldRequirement.js';
import { InfoTip } from '../../ui/InfoTip.jsx';
// Ahead of the field's own sheets, as in TokenField, so the shared button
// base loads first and the control's rules follow it.
import buttonStyles from '../../ui/Button.module.css';
import tokenStyles from './TokenField.module.css';
import styles from './ListField.module.css';
import inputStyles from '../../ui/Input.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/ui.js';

/**
 * ListField: the inline list selector for forms, built like TokenField.
 *
 * A field-shaped button showing the chosen list's text (or the placeholder)
 * with the list icon at its trailing edge; tapping it opens the host's list
 * picker. Presentation and click only: the host owns the picker and writes
 * the choice back through `valueText`. With `onClear` and a value, a clear
 * action sits inside the field beside the list icon, as a sibling of the
 * control (a button never nests in a button).
 *
 * @param {object} props
 * @param {string} props.label                             field label above the control
 * @param {import('react').ReactNode} [props.help]          help for this field, from the label-row InfoTip
 * @param {string | null} [props.valueText]                 the chosen list as text, or null for the empty state
 * @param {import('react').ReactNode} [props.icon]           chosen option's leading icon
 * @param {string} props.placeholder                       empty-state text
 * @param {() => void} props.onOpenPicker
 * @param {() => void} [props.onClear]                     shows the clear action while a value is shown
 * @param {string} [props.clearLabel]                      accessible name of the clear action
 * @param {boolean} [props.optional]
 * @param {boolean} [props.disabled]
 * @param {string} [props.error]
 * @param {string} [props.id]
 */
export function ListField({
    label,
    help,
    valueText = null,
    icon = null,
    placeholder,
    onOpenPicker,
    onClear,
    clearLabel,
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
    const hasValue = typeof valueText === 'string' && valueText.length > 0;
    const clearable = hasValue && typeof onClear === 'function';
    const selectionText = hasValue ? valueText : placeholder;
    const accessibleName = requirement.label ? `${requirement.label}: ${selectionText}` : selectionText;
    const describedBy = [optionalPillId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className={tokenStyles.field}>
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
            <div className={styles.controlWrap}>
                <button
                    type="button"
                    id={controlId}
                    className={[
                        buttonStyles.btn,
                        tokenStyles.control,
                        hasValue && icon ? tokenStyles.leadIcon : '',
                        error ? tokenStyles.invalid : '',
                    ].filter(Boolean).join(' ')}
                    onClick={onOpenPicker}
                    disabled={disabled}
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={describedBy}
                    aria-label={accessibleName}
                >
                    {hasValue ? (
                        <>
                            {icon ? <span className={styles.icon} aria-hidden="true" data-list-field-icon="">{icon}</span> : null}
                            <span className={styles.value} title={valueText}>{valueText}</span>
                        </>
                    ) : (
                        <span className={tokenStyles.placeholder}>{placeholder}</span>
                    )}
                    {clearable ? <span className={styles.clearSpace} aria-hidden="true" /> : null}
                    <span
                        className={`${tokenStyles.caret} ${clearable ? styles.caretAfterSpace : ''}`.trim()}
                        aria-hidden="true"
                    >
                        <TokenListIcon />
                    </span>
                </button>
                {clearable ? (
                    <span className={styles.clear}>
                        <FieldIconButton
                            icon={<XIcon />}
                            label={clearLabel}
                            onClick={onClear}
                            disabled={disabled}
                        />
                    </span>
                ) : null}
            </div>
            {error ? (
                <div id={errorId} className={inputStyles.error} role="alert">{error}</div>
            ) : null}
        </div>
    );
}
