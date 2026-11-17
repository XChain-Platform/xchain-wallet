// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { NetworkField } from './NetworkField.jsx';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/**
 * Single-select chain picker, kept as a name for callers that still import
 * it. A network is always chosen from the standard Network field and its
 * full-screen list (operator ruling 2026-11-13), never from a popover, so
 * this draws NetworkField: the field shows the chosen network's icon and
 * name, and pressing it opens NetworkPicker, whose rows are drawn like the
 * token list's (icon, name, ticker and network kind, right chevron).
 *
 * An unlabelled picker draws no label row and names itself from its
 * visible text, as it did before.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(chainId: string) => void} props.onChange
 * @param {string[]} props.chainIds
 * @param {import('../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string} [props.label]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {'sm' | 'md' | 'lg'} [props.size] field size matching Input; defaults to 'md'.
 * @param {import('react').ReactNode} [props.help]
 * @param {string} [props.id]      the field's id; NetworkField reads the form's error entry by it
 * @param {string | null} [props.error]
 */
export function ChainPicker({
    value,
    onChange,
    chainIds,
    chainRegistry,
    label,
    placeholder = t('ui.chainPicker.selectANetwork'),
    disabled = false,
    size = 'md',
    help,
    id,
    error,
}) {
    return (
        <NetworkField
            value={value}
            onChange={onChange}
            chainIds={chainIds}
            chainRegistry={chainRegistry}
            label={label || ''}
            placeholder={placeholder}
            disabled={disabled}
            size={size}
            help={help}
            id={id}
            error={error}
        />
    );
}
