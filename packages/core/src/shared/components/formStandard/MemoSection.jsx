// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The optional Memo section of the Wallet Form Standard, for a form whose
// Memo section holds only the memo field.

import { useId } from 'react';
import { Textarea } from '../../../ui/Textarea.jsx';
import { MessageIcon } from '../../../ui/icons/index.jsx';
import { MAX_MEMO_LENGTH } from '../../utils/memoLimit.js';
import { FormSection } from './FormSection.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/send.js';

/** The memo shows at most this many lines before it scrolls. */
export const MEMO_MAX_ROWS = 3;

/**
 * A Memo section that holds only the memo field. The section title already
 * says "Memo", so the field draws no label row of its own: no second "Memo",
 * no ? tip (memo is plain and always optional, the one field the "every field
 * has a ? tip" rule leaves out by ruling). The input keeps "Memo" as its
 * accessible name, and the character count ("12 / 250") moves into the
 * section header, at its trailing edge before the chevron while open.
 *
 * The field is a textarea one line tall when empty that grows with the text
 * to three lines, then scrolls inside. A memo holds no line breaks (the chain
 * refuses control characters), so Enter adds none, and it never submits the
 * form from here either.
 *
 * A Memo section with more than the memo field in it stays a plain
 * FormSection with a labelled Input.
 *
 * Section props: id (default 'memo'), title (default 'Memo'), icon, optional
 * (default true), summary (default the trimmed memo or 'None'), open,
 * onOpenChange, defaultOpen, revealKey, autoRevealErrors, main (from
 * useFormSections' bind), tag, className. Every other prop goes to the
 * Textarea (value, onChange, error, disabled, placeholder, onBlur ...);
 * `inputId` is the field's id, for an error summary to focus.
 *
 * @param {object} props
 * @param {string} [props.id]
 * @param {string} [props.title]
 * @param {import('react').ComponentType<any>} [props.icon]
 * @param {boolean} [props.optional]
 * @param {import('react').ReactNode} [props.summary]
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {boolean} [props.defaultOpen]
 * @param {unknown} [props.revealKey]
 * @param {string} [props.className]
 * @param {string} [props.inputId]
 * @param {string} props.value
 * @param {number} [props.maxLength]   default MAX_MEMO_LENGTH (250)
 */
export function MemoSection({
    id = 'memo',
    title: titleProp,
    icon = MessageIcon,
    optional = true,
    summary,
    open,
    onOpenChange,
    defaultOpen,
    revealKey,
    autoRevealErrors,
    main,
    tag,
    className,
    inputId,
    value,
    maxLength = MAX_MEMO_LENGTH,
    'aria-describedby': describedBy,
    // An input type means nothing on a textarea.
    type: _type,
    onKeyDown,
    onChange,
    ...fieldProps
}) {
    const title = titleProp ?? t('send.memo');
    const handleKeyDown = (event) => {
        // Enter (not mid-composition) neither breaks the line nor submits.
        if (event.key === 'Enter' && !event.nativeEvent?.isComposing) event.preventDefault();
        onKeyDown?.(event);
    };
    // A one-line input dropped pasted line breaks; a textarea keeps them, and
    // the chain refuses them, so each becomes a space before the host sees it.
    const handleChange = (event) => {
        const field = event.target;
        const raw = field?.value;
        if (typeof raw === 'string' && /[\r\n]/.test(raw)) {
            const caret = field.selectionStart;
            const flatten = (text) => text.replace(/\r\n|[\r\n]/g, ' ');
            field.value = flatten(raw);
            // The caret stays after the same character it followed.
            if (typeof caret === 'number') {
                const at = flatten(raw.slice(0, caret)).length;
                field.setSelectionRange?.(at, at);
            }
        }
        onChange?.(event);
    };
    const text = String(value ?? '');
    const closedSummary = summary ?? (text.trim() ? text.trim() : t('send.advanced.none'));
    const countId = `memo-count-${useId().replace(/:/g, '')}`;
    const count = maxLength != null ? (
        <span id={countId} aria-live="polite" data-memo-count="">
            {text.length} / {maxLength}
        </span>
    ) : null;
    return (
        <FormSection
            id={id}
            title={title}
            icon={icon}
            optional={optional}
            summary={closedSummary}
            count={count}
            open={open}
            onOpenChange={onOpenChange}
            defaultOpen={defaultOpen}
            revealKey={revealKey}
            autoRevealErrors={autoRevealErrors}
            main={main}
            tag={tag}
            className={className}
        >
            <Textarea
                {...fieldProps}
                id={inputId}
                // No visible label: the section title names it on screen.
                aria-label={typeof title === 'string' ? title : t('send.memo')}
                aria-describedby={[describedBy, count ? countId : null].filter(Boolean).join(' ') || undefined}
                value={value}
                maxLength={maxLength}
                hideCounter
                autoGrow
                maxRows={MEMO_MAX_ROWS}
                autoComplete={fieldProps.autoComplete ?? 'off'}
                onKeyDown={handleKeyDown}
                onChange={handleChange}
            />
        </FormSection>
    );
}
