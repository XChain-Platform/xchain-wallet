// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ContactsSection (§35.1 Contacts panel).
//
// Export / import the address book. JSON preserves the storage representation;
// CSV uses one row per address and groups rows by contact id on import. Existing
// ids are preserved, so re-imports overwrite rather than duplicate.
//
// Editing contacts (add / rename / delete) lives in the dedicated
// `ContactsList` route reached from the main menu. Settings only
// owns the bulk export / import action.

import { useEffect, useRef, useState } from 'react';
import { useMessaging } from '../../useMessaging.js';
import { useDropZone } from '../../hooks/useDropZone.js';
import { contactsFromCsv, contactsToCsv } from '../../utils/contactsCsv.js';
import { DiagnosticDetails } from '../DiagnosticDetails.jsx';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    cursor: 'pointer',
};

export function ContactsSection() {
    const { messaging } = useMessaging();
    const [count, setCount] = useState(/** @type {number | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [importResult, setImportResult] = useState(
        /** @type {{ imported: number, duplicates: number, failures: Array<{ subject: string, message: string }> } | null} */
        (null),
    );
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const reload = async () => {
        if (typeof messaging?.listContacts !== 'function') {
            setError('Contacts is not wired in this shell yet.');
            return;
        }
        try {
            const list = await messaging.listContacts();
            setCount(Array.isArray(list) ? list.length : 0);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const onExport = async () => {
        try {
            const list = await messaging.listContacts();
            const json = JSON.stringify(Array.isArray(list) ? list : [], null, 2);
            triggerDownload('contacts', json, 'json', 'application/json');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const onExportCsv = async () => {
        try {
            const list = await messaging.listContacts();
            triggerDownload('contacts', contactsToCsv(list), 'csv', 'text/csv;charset=utf-8');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const importFromText = async (text, fileName = '') => {
        setImportResult(null);
        setError(null);
        try {
            const leading = text.replace(/^\uFEFF/, '').trimStart()[0];
            const csv = fileName.toLowerCase().endsWith('.csv')
                || (!fileName.toLowerCase().endsWith('.json') && leading !== '[' && leading !== '{');
            let rows;
            let failures = [];
            let duplicates = 0;
            if (csv) {
                const parsed = contactsFromCsv(text);
                rows = parsed.records;
                failures = parsed.failures;
                duplicates = parsed.duplicates;
            } else {
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) {
                    throw new Error('Expected a JSON array of contact records.');
                }
                rows = parsed.map((record, index) => ({ record, line: index + 1 }));
            }
            let imported = 0;
            for (const { record, line } of rows) {
                try {
                    await messaging.saveContact({ record });
                    imported += 1;
                } catch (err) {
                    failures.push({
                        subject: record?.name || record?.id || `Line ${line}`,
                        message: `${csv ? `Line ${line}: ` : ''}${err instanceof Error
                            ? err.message
                            : (String(err || '') || 'The wallet returned no explanation.')}`,
                    });
                    // eslint-disable-next-line no-console
                    console.warn('contacts.import: skipping invalid record:', err);
                }
            }
            setImportResult({ imported, failures, duplicates });
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            // Reset the input so re-importing the same file fires onChange again.
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const onImportFile = async (file) => {
        if (!file) return;
        try {
            const text = await file.text();
            await importFromText(text, file.name || '');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const importDrop = useDropZone({
        accept: ['.json', '.csv', 'application/json', 'text/csv'],
        readAs: 'text',
        onError: setError,
        onFile: ({ file, content }) => importFromText(typeof content === 'string' ? content : '', file.name),
    });

    return (
        <div style={STACK}>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Contacts in this wallet</span>
                    <span style={ROW_HINT}>
                        {count === null ? 'Loading…' : `${count} contact${count === 1 ? '' : 's'} stored`}
                    </span>
                </div>
            </div>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Export</span>
                    <span style={ROW_HINT}>Saves plain JSON or spreadsheet-compatible CSV. Neither format is encrypted.</span>
                </div>
                <button type="button" onClick={onExport} style={ACTION_BTN} disabled={count === 0}>
                    Export…
                </button>
                <button type="button" onClick={onExportCsv} style={ACTION_BTN} disabled={count === 0}>
                    Export CSV…
                </button>
            </div>
            <div
                {...importDrop.rootProps}
                style={{
                    ...ROW,
                    border: importDrop.isDragOver ? '2px dashed var(--xc-accent)' : '1px solid transparent',
                    borderRadius: 'var(--xc-radius-sm)',
                    transition: 'border-color 120ms ease',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Import</span>
                    <span style={ROW_HINT}>
                        Reads contacts JSON or CSV, or drop one here. Existing contacts with the same id are overwritten.
                    </span>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,text/csv,.json,.csv"
                    onChange={(e) => onImportFile(e.target.files?.[0])}
                    aria-label="Import contacts JSON"
                    style={{ display: 'none' }}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={ACTION_BTN}
                >
                    Import…
                </button>
            </div>
            {importResult ? (
                <>
                    <Status
                        text={`Imported ${importResult.imported} contact${importResult.imported === 1 ? '' : 's'}${importResult.failures.length > 0 ? `; ${importResult.failures.length} skipped` : ''}${importResult.duplicates > 0 ? `; ${importResult.duplicates} duplicate row${importResult.duplicates === 1 ? '' : 's'} removed` : ''}.`}
                    />
                    <DiagnosticDetails
                        summary={`Skipped contacts (${importResult.failures.length})`}
                        items={importResult.failures}
                    />
                </>
            ) : null}
            {error ? <Status text={error} tone="error" /> : null}
        </div>
    );
}

function triggerDownload(prefix, content, extension, type) {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}-${stamp}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
