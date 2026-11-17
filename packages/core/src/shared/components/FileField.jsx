// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useRef, useState } from 'react';
import { Button } from '../../ui/Button.jsx';
import { FieldIconButton } from '../../ui/FieldIconButton.jsx';
import { Input } from '../../ui/Input.jsx';
import { UploadIcon, XIcon } from '../../ui/icons/index.jsx';
import styles from './FileField.module.css';
import { usePickedFieldError } from '../../ui/formErrors.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

/**
 * FileField: the one choose-file field every file picker in the wallet uses.
 *
 * It is drawn as a standard read-only field: the label (which names the size
 * limit where there is one) with its ? help, the picked file's name or a
 * placeholder inside the field, an Upload icon at the trailing edge that opens
 * the file dialog, and an X in its place once a file is picked. Clicking the
 * field opens the dialog too, and a file dropped on the field is taken the
 * same way as a picked one.
 *
 * The field only hands the File over; reading and checking it stay with the
 * form, so each form keeps its own size, type and content refusals.
 *
 * Two wiring modes:
 *   - `onFile(file)`: the field owns its hidden file input and drop target.
 *   - `drop`: a `useDropZone` result; the hook's own picker input and drop
 *     handlers are used, so its size cap, type check and read run unchanged.
 *
 * `variant="area"` draws the same picker as a large drop area instead of a
 * one-line field, for a screen whose whole first step is choosing one file
 * (restore from a backup): an upload tile, the label as its title, a short
 * hint, and a green Choose File button inside it (one fixed label: it is a
 * button, so Title Case, not the field's own chooseLabel). The whole area takes a click or
 * a drop; the button is the keyboard control, so the area itself is not a
 * second focus stop. A form shows it only until a file is picked, then puts
 * its own summary of that file in its place.
 *
 * @param {object} props
 * @param {'field' | 'area'} [props.variant]
 * @param {string} [props.hint]                 persistent text under a field, or the area's second line
 * @param {string} props.label                  visible label, e.g. "File (up to 7,792 bytes)"
 * @param {import('react').ReactNode} [props.help]
 * @param {boolean} [props.optional]
 * @param {string | null} [props.fileName]      the picked file's display name; empty shows the placeholder
 * @param {string} [props.placeholder]
 * @param {string[] | string} [props.accept]    the dialog's default filter; it never stops another type being chosen
 * @param {(file: File) => void} [props.onFile]
 * @param {ReturnType<typeof import('../hooks/useDropZone.js').useDropZone>} [props.drop]
 * @param {() => void} [props.onClear]          shows the X once a file is picked
 * @param {string} [props.inputLabel]           accessible name of the hidden file input
 * @param {string} [props.chooseLabel]
 * @param {string} [props.clearLabel]
 * @param {string | null} [props.error]        wins over the form's entry
 * @param {string | number} [props.errorKey]
 * @param {string} [props.formErrorKey]         read this entry of the form's map instead of `id`
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]                   with a form on the form error standard (useFormErrors), the field reads its entry by this id
 */
export function FileField({
    variant = 'field',
    label,
    help,
    hint,
    optional = false,
    fileName = '',
    placeholder,
    accept,
    onFile,
    drop,
    onClear,
    inputLabel,
    chooseLabel,
    clearLabel,
    error: errorProp,
    errorKey: errorKeyProp,
    formErrorKey,
    disabled = false,
    id,
}) {
    // On a form using the form error standard (useFormErrors) the field reads
    // its entry by id, outlines red with its line under it, and drops the
    // entry when a file is picked or removed, as TokenField does: a pick
    // reaches the field as a new file name, not a typed change. An `error`
    // the caller passes wins.
    const formField = usePickedFieldError(formErrorKey ?? id, fileName || '');
    const error = errorProp || formField.error;
    const errorKey = errorProp ? errorKeyProp : formField.errorKey;
    const clearFormEntry = formField.clear;
    const ownInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [ownDragOver, setOwnDragOver] = useState(false);
    const areaId = useId();
    const acceptList = Array.isArray(accept) ? accept.join(',') : (accept || undefined);
    const chooseText = chooseLabel || t('components.fileField.choose');
    const clearText = clearLabel || t('components.fileField.remove');

    const openPicker = () => {
        if (disabled) return;
        if (drop) drop.openFilePicker();
        else ownInputRef.current?.click();
    };

    const handleOwnChange = (event) => {
        const file = event.target?.files?.[0];
        // Cleared so picking the same file again fires a change.
        if (ownInputRef.current) ownInputRef.current.value = '';
        if (file) {
            clearFormEntry();
            onFile?.(file);
        }
    };

    const ownRootProps = {
        onDragOver: (event) => {
            if (disabled) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            setOwnDragOver(true);
        },
        onDragLeave: () => setOwnDragOver(false),
        onDrop: (event) => {
            if (disabled) return;
            event.preventDefault();
            setOwnDragOver(false);
            const file = event.dataTransfer?.files?.[0];
            if (file) {
                clearFormEntry();
                onFile?.(file);
            }
        },
    };
    const rootProps = drop ? drop.rootProps : ownRootProps;
    const dragOver = drop ? drop.isDragOver : ownDragOver;

    // The hook's picker props carry `style: display none`; the hidden
    // attribute does the same job for the field's own input.
    // The area variant's label points at the input by id.
    const pickerId = variant === 'area' ? `${areaId}-input` : undefined;
    const pickerInput = drop ? (
        <input
            {...drop.pickerProps}
            id={pickerId}
            accept={acceptList ?? drop.pickerProps.accept}
            aria-label={inputLabel || label}
            disabled={disabled}
            hidden
        />
    ) : (
        <input
            ref={ownInputRef}
            id={pickerId}
            type="file"
            accept={acceptList}
            onChange={handleOwnChange}
            aria-label={inputLabel || label}
            disabled={disabled}
            hidden
        />
    );

    if (variant === 'area') {
        const titleId = `${areaId}-title`;
        const hintId = hint ? `${areaId}-hint` : undefined;
        const errorId = error ? `${areaId}-error` : undefined;
        return (
            <div className={styles.areaRoot} data-file-field="area">
                {/* Outside the area, so the area's own click never reaches it twice. */}
                {pickerInput}
                {/* The area is the hidden input's label, so a click anywhere on
                    it opens the dialog with no click handler of its own; the
                    button inside is the keyboard and screen-reader control. A
                    label is not a control, so the button is not nested in one. */}
                <label
                    {...rootProps}
                    htmlFor={pickerId}
                    className={styles.area}
                    data-drop-active={dragOver ? 'true' : 'false'}
                    data-disabled={disabled ? 'true' : 'false'}
                    data-invalid={error ? 'true' : 'false'}
                >
                    <span className={styles.areaTile} aria-hidden="true"><UploadIcon /></span>
                    <span id={titleId} className={styles.areaTitle}>{label}</span>
                    {hint ? <span id={hintId} className={styles.areaHint}>{hint}</span> : null}
                    <Button
                        id={id}
                        type="button"
                        variant="success"
                        icon={<UploadIcon />}
                        onClick={(event) => {
                            // Kept from the label, which would open the dialog a second time.
                            event.preventDefault();
                            event.stopPropagation();
                            openPicker();
                        }}
                        disabled={disabled}
                        aria-describedby={[titleId, errorId].filter(Boolean).join(' ')}
                        aria-invalid={error ? 'true' : undefined}
                    >
                        {t('components.fileField.chooseButton')}
                    </Button>
                </label>
                {error ? (
                    <p id={errorId} key={errorKey} className={styles.areaError} role="alert">{error}</p>
                ) : null}
            </div>
        );
    }

    const picked = Boolean(fileName);
    return (
        <div
            {...rootProps}
            className={styles.root}
            data-drop-active={dragOver ? 'true' : 'false'}
            data-file-field=""
        >
            {pickerInput}
            <Input
                id={id}
                label={label}
                help={help}
                hint={hint}
                optional={optional}
                readOnly
                value={fileName || ''}
                placeholder={placeholder || t('components.fileField.placeholder')}
                onChange={() => {}}
                onClick={openPicker}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openPicker();
                    }
                }}
                className={styles.display}
                disabled={disabled}
                error={error || undefined}
                errorKey={errorKey}
                fieldAction={picked && onClear ? (
                    <FieldIconButton
                        icon={<XIcon />}
                        label={clearText}
                        onClick={onClear}
                        disabled={disabled}
                    />
                ) : (
                    <FieldIconButton
                        icon={<UploadIcon />}
                        label={chooseText}
                        onClick={openPicker}
                        disabled={disabled}
                    />
                )}
            />
        </div>
    );
}
