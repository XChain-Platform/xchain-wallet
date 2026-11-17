// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { FieldIconButton } from './FieldIconButton.jsx';
import { XIcon } from './icons/index.jsx';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/**
 * Empties a text control through the platform's own value setter and an
 * `input` event, so a controlled React field sees an ordinary change with an
 * empty value and the field's own handlers (counts, validation) all run.
 *
 * @param {HTMLInputElement | HTMLTextAreaElement | null} node
 */
export function clearControlValue(node) {
    if (!node) return;
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(node, '');
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.focus?.();
}

/**
 * The small X drawn inside a field at its trailing edge (G112 geometry, via
 * the shared FieldIconButton) that clears the field. It is named after the
 * field ("Clear Name") and only shown while the field has text.
 *
 * @param {object} props
 * @param {string} [props.label]     the field's accessible name
 * @param {() => void} props.onClear
 */
export function ClearFieldButton({ label, onClear }) {
    return (
        <FieldIconButton
            icon={<XIcon />}
            label={t('ui.field.clear', { label: label || '' }).trim()}
            onClick={onClear}
        />
    );
}
