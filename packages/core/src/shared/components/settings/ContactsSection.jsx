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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { useDropZone } from '../../hooks/useDropZone.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { contactsFromCsv, contactsToCsv } from '../../utils/contactsCsv.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { DiagnosticDetails } from '../DiagnosticDetails.jsx';
import {
    ROW,
    ROW_COPY,
    ROW_HINT,
    ROW_VALUE,
    STACK,
    Status,
} from './_settingsPrimitives.jsx';

const CONTACT_ACTIONS = {
    display: 'flex',
    flex: '1 1 100%',
    flexWrap: 'wrap',
    gap: 'var(--xc-space-2)',
};
const CONTACT_ACTION_BUTTON = {
    flex: '0 0 9.5rem',
    width: '9.5rem',
    whiteSpace: 'nowrap',
};

export function ContactsSection() {
    const { messaging } = useMessaging();
    const confirmDialog = useConfirmModal();
    const [count, setCount] = useState(/** @type {number | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [importResult, setImportResult] = useState(
        /** @type {{ imported: number, duplicates: number, failures: Array<{ subject: string, message: string }> } | null} */
        (null),
    );
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const reloadRequestRef = useRef(0);

    const reload = useCallback(async () => {
        const request = ++reloadRequestRef.current;
        if (typeof messaging?.listContacts !== 'function') {
            setError('Contacts is not wired in this shell yet.');
            return;
        }
        try {
            const list = await messaging.listContacts();
            if (request !== reloadRequestRef.current) return;
            setCount(Array.isArray(list) ? list.length : 0);
            setError(null);
        } catch (err) {
            if (request !== reloadRequestRef.current) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [messaging]);

    useEffect(() => {
        reload();
        return () => { reloadRequestRef.current += 1; };
    }, [reload]);

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
            const confirmed = await confirmDialog.confirm({
                title: 'Import contacts?',
                message: 'Contacts with the same ID will be replaced by the imported records. This cannot be undone.',
                confirmLabel: 'Import contacts',
                danger: true,
            });
            if (!confirmed) return;
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
                <div style={ROW_COPY}>
                    <span style={ROW_VALUE}>Contacts in this wallet</span>
                    <span style={ROW_HINT}>
                        {count === null ? 'Loading…' : `${count} contact${count === 1 ? '' : 's'} stored`}
                    </span>
                </div>
            </div>
            <div
                {...importDrop.rootProps}
                style={{
                    ...ROW,
                    border: importDrop.isDragOver ? '2px dashed var(--xc-accent)' : ROW.border,
                    transition: 'border-color 120ms ease',
                }}
            >
                <div style={ROW_COPY}>
                    <span style={ROW_VALUE}>Export and import</span>
                    <span style={ROW_HINT}>
                        Saves or reads plain JSON and spreadsheet-compatible CSV. Neither format is encrypted.
                        Choose a file or drop one here to import it. Existing contacts with the same id are overwritten.
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
                <div style={CONTACT_ACTIONS}>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        style={CONTACT_ACTION_BUTTON}
                        onClick={onExport}
                        disabled={count === 0}
                    >
                        Export…
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        style={CONTACT_ACTION_BUTTON}
                        onClick={onExportCsv}
                        disabled={count === 0}
                    >
                        Export CSV…
                    </Button>
                    <Button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        size="sm"
                        variant="secondary"
                        style={CONTACT_ACTION_BUTTON}
                    >
                        Import…
                    </Button>
                </div>
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
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
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
