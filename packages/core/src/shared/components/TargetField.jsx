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
import { FieldIconButton } from '../../ui/FieldIconButton.jsx';
import { InfoTip } from '../../ui/InfoTip.jsx';
import { ClockIcon, ContractIcon, TokenListIcon } from '../../ui/icons/index.jsx';
import { fieldHelpName } from '../../ui/fieldRequirement.js';
import inputStyles from '../../ui/Input.module.css';
import styles from './TargetField.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/ui.js';

/**
 * TargetField: the read-only field that names what a form acts on (a
 * contract, or the network a stake is locked on), with a plain list icon
 * inside it to pick another target.
 *
 * The target is fixed by the page that opened the form, so the field is not
 * editable; the list icon opens the host's picker page, and without a picker
 * the icon stays, locked, like the From address icon. The hint line under it
 * carries the one fact the user should read before acting (a stake's
 * cooldown), with a clock icon.
 *
 * @param {object} props
 * @param {string} props.label                      field label ("Contract", "Stake On")
 * @param {import('react').ReactNode} [props.help]  help shown from the label-row InfoTip
 * @param {string} props.name                       the target's name ("Yield Vault", "Unnamed contract")
 * @param {import('react').ReactNode} [props.detail] its identity, shown muted after the name ("#12", or the network's ChainBadge)
 * @param {import('react').ReactNode} [props.icon]  leading icon; the contract icon by default
 * @param {string | null} [props.hint]              the line under the field, with a clock icon
 * @param {() => void} [props.onPick]               open the host's target picker
 * @param {string} [props.pickLabel]                the list icon's name ("Choose another contract")
 * @param {string} [props.pickLockedReason]         why the target cannot change, when there is no picker
 */
export function TargetField({
    label,
    help,
    name,
    detail,
    icon,
    hint,
    onPick,
    pickLabel = 'Choose another target',
    pickLockedReason,
}) {
    const id = useId();
    const labelId = `${id}-label`;
    const hintId = hint ? `${id}-hint` : undefined;
    const valueText = typeof detail === 'string' && detail ? `${name} ${detail}` : name;
    return (
        <div className={styles.field} data-target-field="">
            <div className={inputStyles.labelRow}>
                <span id={labelId} className={inputStyles.label}>{label}</span>
                {help ? (
                    <InfoTip
                        className={inputStyles.labelHelp}
                        label={help}
                        aria={t('ui.field.about', { label: fieldHelpName(label) })}
                    />
                ) : null}
            </div>
            <div
                className={styles.control}
                role="group"
                aria-labelledby={labelId}
                aria-describedby={hintId}
            >
                <span className={styles.icon} aria-hidden="true">{icon || <ContractIcon />}</span>
                <span className={styles.value} title={valueText}>
                    <span className={styles.name}>{name}</span>
                    {detail ? <span className={styles.detail}>{detail}</span> : null}
                </span>
                <FieldIconButton
                    icon={<TokenListIcon />}
                    label={pickLabel}
                    onClick={onPick}
                    lockedReason={onPick ? undefined : (pickLockedReason || pickLabel)}
                />
            </div>
            {hint ? (
                <div id={hintId} className={styles.hint}>
                    <span className={styles.hintIcon} aria-hidden="true"><ClockIcon /></span>
                    <span>{hint}</span>
                </div>
            ) : null}
        </div>
    );
}
