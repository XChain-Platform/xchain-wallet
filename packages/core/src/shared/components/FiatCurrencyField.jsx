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
import { TokenListIcon } from '../../ui/icons/index.jsx';
import { OptionalPill } from '../../ui/OptionalPill.jsx';
import { fieldHelpName, resolveFieldRequirement } from '../../ui/fieldRequirement.js';
import { InfoTip } from '../../ui/InfoTip.jsx';
import { usePickedFieldError } from '../../ui/formErrors.js';
// Ahead of the field's own sheets, so the shared button base loads first; the
// control is TokenField's, so a currency field and a token field look alike.
import buttonStyles from '../../ui/Button.module.css';
import tokenFieldStyles from './TokenField.module.css';
import styles from './FiatCurrency.module.css';
import inputStyles from '../../ui/Input.module.css';
import { fiatCurrency, fiatCurrencySymbol } from '../utils/fiatCurrencies.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/ui.js';

/**
 * FiatCurrencyField: the one way a form picks a fiat currency (G122). A
 * field-shaped button showing the chosen currency's symbol mark, code and
 * name, that opens the full-page FiatCurrencyPicker when tapped; never a
 * dropdown. Presentation and click only, like TokenField: the host opens the
 * picker and writes the chosen code back into `value`, so the value a form
 * submits is the plain ISO code it always was.
 *
 * @param {object} props
 * @param {string} [props.label]          defaults to Fiat currency; the label always says Fiat currency
 * @param {string} props.value            the chosen ISO code, or '' for none
 * @param {() => void} props.onOpenPicker
 * @param {string} [props.placeholder]    the empty state's text
 * @param {boolean} [props.disabled]
 * @param {string} [props.error]          shown under the control; wins over the form's entry
 * @param {string} [props.id]             the control's id and its form-error key
 * @param {boolean} [props.optional]      shows the shared Optional pill
 * @param {import('react').ReactNode} [props.help]  help from the label-row InfoTip
 */
export function FiatCurrencyField({
    // The same words as the Settings row: "Fiat currency".
    label = t('settings.languageRegion.fiatCurrency'),
    value = '',
    onOpenPicker,
    placeholder = t('components.fiatCurrencyField.select'),
    disabled = false,
    error: errorProp,
    id,
    optional = false,
    help,
}) {
    const autoId = useId();
    const controlId = id || autoId;
    const code = String(value || '').trim().toUpperCase();
    const currency = code ? (fiatCurrency(code) || { code, name: '', description: '' }) : null;
    const formField = usePickedFieldError(id, code);
    const error = errorProp || formField.error;
    const errorId = error ? `${controlId}-error` : undefined;
    const requirement = resolveFieldRequirement({ label, optional });
    const optionalPillId = requirement.isOptional ? `${controlId}-optional` : undefined;
    const hasHelp = Boolean(label && help);
    const selectionText = currency
        ? [currency.code, currency.name].filter(Boolean).join(', ')
        : placeholder;
    const accessibleName = requirement.label ? `${requirement.label}: ${selectionText}` : selectionText;
    const describedBy = [optionalPillId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className={tokenFieldStyles.field} data-fiat-currency-field="">
            {label && (requirement.isOptional || hasHelp) ? (
                <div className={inputStyles.labelRow}>
                    <span className={`${tokenFieldStyles.label} ${inputStyles.label}`}>{requirement.label}</span>
                    {requirement.isOptional ? <OptionalPill id={optionalPillId} /> : null}
                    {hasHelp ? (
                        <InfoTip
                            className={inputStyles.labelHelp}
                            label={help}
                            aria={t('ui.field.about', { label: fieldHelpName(requirement.label) })}
                        />
                    ) : null}
                </div>
            ) : label ? <span className={tokenFieldStyles.label}>{requirement.label}</span> : null}
            <button
                type="button"
                id={controlId}
                // G112: leadIcon puts the symbol mark in the field's square icon slot.
                className={[
                    buttonStyles.btn,
                    tokenFieldStyles.control,
                    currency ? tokenFieldStyles.leadIcon : '',
                    error ? tokenFieldStyles.invalid : '',
                ].filter(Boolean).join(' ')}
                onClick={onOpenPicker}
                disabled={disabled}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={describedBy}
                aria-label={accessibleName}
                data-value={code}
            >
                {currency ? (
                    <>
                        <span className={styles.symbol} aria-hidden="true">{fiatCurrencySymbol(currency.code)}</span>
                        <span className={tokenFieldStyles.text}>
                            <span className={tokenFieldStyles.tick}>{currency.code}</span>
                            {currency.name ? <span className={styles.name}>{currency.name}</span> : null}
                        </span>
                    </>
                ) : (
                    <span className={tokenFieldStyles.placeholder}>{placeholder}</span>
                )}
                {/* The trailing list icon, as on the token and network fields:
                    the whole control opens the list, the icon signals it. */}
                <span className={tokenFieldStyles.caret} aria-hidden="true">
                    <TokenListIcon />
                </span>
            </button>
            {error ? (
                <div id={errorId} className={inputStyles.error} role="alert">{error}</div>
            ) : null}
        </div>
    );
}
