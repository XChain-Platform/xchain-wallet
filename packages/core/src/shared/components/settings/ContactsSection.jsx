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
import { detectAddressCoin, isValidAddressAnyNetwork } from '../../utils/addressValidation.js';
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
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/settings.js';

const CONTACT_ACTIONS = {
    display: 'flex',
    flex: '1 1 100%',
    flexWrap: 'wrap',
    gap: 'var(--xc-space-2)',
};
// Equal flex bases keep the three actions the same width on a row; growing
// instead of a fixed width lets a longer translation widen its button rather
// than clip a label that must stay on one line.
const CONTACT_ACTION_BUTTON = {
    flex: '1 0 9.5rem',
    whiteSpace: 'nowrap',
};

const MAX_CONTACT_IMPORT_BYTES = 2 * 1024 * 1024;
const CONTACT_FIELDS = new Set([
    'schemaVersion', 'id', 'name', 'notes', 'entries', 'avatarSeed', 'createdAt', 'updatedAt',
]);
const ENTRY_FIELDS = new Set(['chain', 'address', 'label']);
const SUPPORTED_CHAINS = new Set(['bitcoin', 'litecoin', 'dogecoin']);

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

    const reportImportFailure = (message, subject = 'Import file') => {
        setError(null);
        setImportResult({
            imported: 0,
            duplicates: 0,
            failures: [{ subject, message }],
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

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

    const importFromText = async (text, fileName = '', fileSize) => {
        setImportResult(null);
        setError(null);
        try {
            const bytes = Number.isFinite(fileSize) ? fileSize : new Blob([text]).size;
            if (bytes > MAX_CONTACT_IMPORT_BYTES) {
                throw new Error(importSizeMessage(bytes));
            }
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
                const audited = auditJsonContacts(parsed);
                rows = audited.records;
                failures = audited.failures;
                duplicates = audited.duplicates;
            }
            const confirmed = await confirmDialog.confirm({
                title: 'Import contacts?',
                message: 'Contacts with the same ID will be replaced by the imported records. This cannot be undone.',
                confirmLabel: 'Import contacts',
                danger: true,
            });
            if (!confirmed) return;
            let imported = 0;
            const recordFailure = ({ record, line }, message) => {
                if (isDuplicateFailure(message)) duplicates += 1;
                failures.push({
                    subject: record?.name || record?.id || `Line ${line}`,
                    message: `${csv ? `Line ${line}: ` : ''}${message}`,
                });
            };
            if (typeof messaging.saveContacts === 'function') {
                // One vault write for the whole file: saving record by record
                // re-encrypts the vault once per contact.
                const batch = await messaging.saveContacts({ records: rows.map(({ record }) => record) });
                const failed = Array.isArray(batch?.failures) ? batch.failures : [];
                imported = Array.isArray(batch?.saved) ? batch.saved.length : 0;
                for (const { index, message } of failed) {
                    if (rows[index]) recordFailure(rows[index], message || 'The wallet returned no explanation.');
                }
            } else {
                for (const { record, line } of rows) {
                    try {
                        await messaging.saveContact({ record });
                        imported += 1;
                    } catch (err) {
                        const message = err instanceof Error
                            ? err.message
                            : (String(err || '') || 'The wallet returned no explanation.');
                        recordFailure({ record, line }, message);
                        // eslint-disable-next-line no-console
                        console.warn('contacts.import: skipping invalid record:', err);
                    }
                }
            }
            setImportResult({ imported, failures, duplicates });
            await reload();
        } catch (err) {
            reportImportFailure(
                err instanceof Error ? err.message : String(err),
                fileName || 'Import file',
            );
        } finally {
            // Reset the input so re-importing the same file fires onChange again.
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const onImportFile = async (file) => {
        if (!file) return;
        try {
            if (Number.isFinite(file.size) && file.size > MAX_CONTACT_IMPORT_BYTES) {
                reportImportFailure(importSizeMessage(file.size), file.name || 'Import file');
                return;
            }
            const text = await file.text();
            await importFromText(text, file.name || '', file.size);
        } catch (err) {
            reportImportFailure(
                err instanceof Error ? err.message : String(err),
                file.name || 'Import file',
            );
        }
    };

    const importDrop = useDropZone({
        accept: ['.json', '.csv', 'application/json', 'text/csv'],
        maxBytes: MAX_CONTACT_IMPORT_BYTES,
        readAs: 'text',
        onError: (message) => reportImportFailure(message),
        onFile: ({ file, content }) => importFromText(
            typeof content === 'string' ? content : '',
            file.name,
            file.size,
        ),
    });

    return (
        <div style={STACK}>
            <div style={ROW}>
                <div style={ROW_COPY}>
                    <span style={ROW_VALUE}>{t('settings.contacts.contactsInThisWallet')}</span>
                    <span style={ROW_HINT}>
                        {count === null ? t('common.loading') : t('settings.contacts.storedCount', { count })}
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
                    <span style={ROW_VALUE}>{t('settings.contacts.exportAndImport')}</span>
                    <span style={ROW_HINT}>
                        {t('settings.contacts.savesOrReadsPlainJson')}
                    </span>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,text/csv,.json,.csv"
                    onChange={(e) => onImportFile(e.target.files?.[0])}
                    aria-label={t('settings.contacts.importContactsJson')}
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
                        {t('history.export.open')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        style={CONTACT_ACTION_BUTTON}
                        onClick={onExportCsv}
                        disabled={count === 0}
                    >
                        {t('settings.contacts.exportCsv')}
                    </Button>
                    <Button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        size="sm"
                        variant="secondary"
                        style={CONTACT_ACTION_BUTTON}
                    >
                        {t('settings.contacts.import')}
                    </Button>
                </div>
            </div>
            {importResult ? (
                <>
                    <Status
                        text={t('settings.contacts.importedSummary', {
                            imported: importResult.imported,
                            skipped: importResult.failures.length,
                            duplicates: importResult.duplicates,
                        })}
                    />
                    <DiagnosticDetails
                        summary={t('settings.contacts.skippedContacts', { length: importResult.failures.length })}
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

function auditJsonContacts(parsed) {
    const records = [];
    const failures = [];
    const ids = new Map();
    const names = new Map();
    const addresses = new Map();
    let duplicates = 0;

    parsed.forEach((record, index) => {
        const line = index + 1;
        const subject = record?.name || record?.id || `Contact ${line}`;
        const problem = jsonRecordProblem(record);
        if (problem) {
            failures.push({ subject, message: `Contact ${line}: ${problem}` });
            return;
        }

        const id = typeof record?.id === 'string' ? record.id.trim() : '';
        const name = typeof record?.name === 'string' ? record.name.trim().toLowerCase() : '';
        const duplicate = (id && ids.get(id)) || (name && names.get(name));
        const entries = Array.isArray(record?.entries) ? record.entries : [];
        const duplicateAddress = entries
            .map(entryKey)
            .map((key) => addresses.get(key))
            .find(Boolean);
        if (duplicate || duplicateAddress) {
            const owner = duplicate || duplicateAddress;
            failures.push({
                subject,
                message: `Contact ${line}: duplicates ${owner.subject} (contact ${owner.line}).`,
            });
            duplicates += 1;
            return;
        }

        const owner = { line, subject };
        if (id) ids.set(id, owner);
        if (name) names.set(name, owner);
        entries.forEach((entry) => addresses.set(entryKey(entry), owner));
        records.push({ record, line });
    });

    return { records, failures, duplicates };
}

function jsonRecordProblem(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return 'must be an object.';
    const unknown = Object.keys(record).find((field) => !CONTACT_FIELDS.has(field));
    if (unknown) return `unknown field "${unknown}".`;
    if (!Array.isArray(record.entries)) return null;

    const seen = new Set();
    for (const entry of record.entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const unknownEntry = Object.keys(entry).find((field) => !ENTRY_FIELDS.has(field));
        if (unknownEntry) return `unknown address field "${unknownEntry}".`;
        const chain = String(entry.chain || '').trim().toLowerCase();
        const address = String(entry.address || '').trim();
        if (!SUPPORTED_CHAINS.has(chain)) {
            return `address network must be bitcoin, litecoin, or dogecoin, not "${chain || 'empty'}".`;
        }
        if (!isValidAddressAnyNetwork(address)) return `"${address}" is not a valid supported address.`;
        const addressCoin = detectAddressCoin(address);
        if (addressCoin && addressCoin !== chain) {
            return `address belongs to ${addressCoin}, not ${chain}.`;
        }
        const key = entryKey(entry);
        if (seen.has(key)) return `address appears more than once: ${address}.`;
        seen.add(key);
    }
    return null;
}

function entryKey(entry) {
    const chain = String(entry?.chain || '').trim().toLowerCase();
    const address = String(entry?.address || '').trim();
    const lower = address.toLowerCase();
    const normalized = /^(bc|tb|bcrt|ltc|tltc|rltc)1/.test(lower) ? lower : address;
    return `${chain}|${normalized}`;
}

function isDuplicateFailure(message) {
    return /already exists|already saved|appears more than once/i.test(message);
}

function importSizeMessage(bytes) {
    return `File is too large (${Math.ceil(bytes / 1024)} KB; max ${MAX_CONTACT_IMPORT_BYTES / 1024} KB).`;
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
