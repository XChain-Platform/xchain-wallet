// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useRef, useState } from 'react';
import { FieldIconButton } from '../../ui/FieldIconButton.jsx';
import { Input } from '../../ui/Input.jsx';
import { UploadIcon, XIcon } from '../../ui/icons/index.jsx';
import styles from './FileField.module.css';
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
 * @param {object} props
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
 * @param {string | null} [props.error]
 * @param {string | number} [props.errorKey]
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 */
export function FileField({
    label,
    help,
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
    error,
    errorKey,
    disabled = false,
    id,
}) {
    const ownInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [ownDragOver, setOwnDragOver] = useState(false);
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
        if (file) onFile?.(file);
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
            if (file) onFile?.(file);
        },
    };
    const rootProps = drop ? drop.rootProps : ownRootProps;
    const dragOver = drop ? drop.isDragOver : ownDragOver;

    // The hook's picker props carry `style: display none`; the hidden
    // attribute does the same job for the field's own input.
    const pickerInput = drop ? (
        <input
            {...drop.pickerProps}
            accept={acceptList ?? drop.pickerProps.accept}
            aria-label={inputLabel || label}
            disabled={disabled}
            hidden
        />
    ) : (
        <input
            ref={ownInputRef}
            type="file"
            accept={acceptList}
            onChange={handleOwnChange}
            aria-label={inputLabel || label}
            disabled={disabled}
            hidden
        />
    );

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
