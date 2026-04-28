// useDropZone — §37 / G123. Shared drop-target hook so individual
// forms don't have to re-roll the (preventDefault → setDragOver →
// validate → FileReader) plumbing every time.
//
// Surfaces wired today:
//   - PsbtSignForm   (hex / base64 / binary .psbt)
//   - ContactsSection import (JSON)
//   - ImportWallet backup file lane (encrypted .xchain-wallet)
//
// Pre-existing one-off drop handlers (ImportWallet mnemonic txt drop)
// keep their bespoke wiring; the hook is opt-in for new sites.
//
// Read modes:
//   'text'         — decoded as UTF-8 text (default for JSON / txt / base64 PSBTs)
//   'arrayBuffer'  — passed through as ArrayBuffer (for binary blobs)
//
// The hook returns:
//   { rootProps, isDragOver, openFilePicker }
//
// `rootProps` spreads onto the drop target (`<div {...rootProps}>`).
// `openFilePicker` triggers the OS file picker via a hidden <input>;
// callers can mount it next to a "Browse…" button without writing
// the input themselves.

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — large enough for PSBT / backup / contacts; small enough to keep paste OOM-proof.

function matchesAccept(file, accept) {
    if (!accept || accept.length === 0) return true;
    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    return accept.some((rule) => {
        const r = String(rule).toLowerCase();
        if (r.startsWith('.')) return name.endsWith(r);
        if (r.endsWith('/*')) return mime.startsWith(r.slice(0, -1));
        return mime === r;
    });
}

function readFile(file, readAs) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
        reader.onload = () => resolve(reader.result);
        if (readAs === 'arrayBuffer') reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
    });
}

/**
 * @param {object} options
 * @param {(payload: { file: File, content: string | ArrayBuffer }) => void | Promise<void>} options.onFile
 * @param {string[]} [options.accept]    `['.json']` / `['text/*', '.psbt']` / etc. Empty / undefined accepts everything.
 * @param {number} [options.maxBytes]    default 2 MB
 * @param {'text' | 'arrayBuffer'} [options.readAs]   default 'text'
 * @param {(message: string) => void} [options.onError]   surface validation / read errors
 * @param {boolean} [options.disabled]   short-circuits the drop / picker handlers
 */
export function useDropZone({
    onFile,
    accept,
    maxBytes = DEFAULT_MAX_BYTES,
    readAs = 'text',
    onError,
    disabled = false,
} = {}) {
    const [isDragOver, setIsDragOver] = useState(false);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const handleFile = useCallback(async (file) => {
        if (!file) return;
        if (file.size > maxBytes) {
            onError?.(`File is too large (${Math.round(file.size / 1024)} KB; max ${Math.round(maxBytes / 1024)} KB).`);
            return;
        }
        if (!matchesAccept(file, accept)) {
            const acceptLabel = (accept || []).join(', ') || 'allowed types';
            onError?.(`File type not accepted (need ${acceptLabel}).`);
            return;
        }
        try {
            const content = await readFile(file, readAs);
            await onFile({ file, content });
        } catch (err) {
            onError?.(err?.message || 'Could not read the file.');
        }
    }, [onFile, onError, accept, maxBytes, readAs]);

    const onDragOver = useCallback((event) => {
        if (disabled) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    }, [disabled]);

    const onDragLeave = useCallback(() => {
        if (disabled) return;
        setIsDragOver(false);
    }, [disabled]);

    const onDrop = useCallback((event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragOver(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) handleFile(file);
    }, [disabled, handleFile]);

    const onPickerChange = useCallback((event) => {
        const file = event.target?.files?.[0];
        if (file) handleFile(file);
        // Reset so re-picking the same file fires onChange again.
        if (inputRef.current) inputRef.current.value = '';
    }, [handleFile]);

    const openFilePicker = useCallback(() => {
        if (disabled) return;
        inputRef.current?.click();
    }, [disabled]);

    // Mount a hidden <input type="file"> alongside the drop target so a
    // matching "Browse…" button is one ref-click away. Hosts that don't
    // need it can ignore `pickerProps`.
    const pickerProps = {
        ref: inputRef,
        type: 'file',
        accept: (accept || []).join(','),
        onChange: onPickerChange,
        style: { display: 'none' },
    };

    // Drop the visual indicator if the component unmounts mid-drag.
    useEffect(() => () => setIsDragOver(false), []);

    const rootProps = {
        onDragOver,
        onDragLeave,
        onDrop,
        'data-drop-active': isDragOver ? 'true' : 'false',
    };

    return {
        rootProps,
        isDragOver,
        openFilePicker,
        pickerProps,
    };
}
