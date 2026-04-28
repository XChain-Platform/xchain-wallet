// ContactsSection — §35.1 Contacts panel.
//
// Export / import the address book. Export downloads the array of
// Contact records as JSON; import reads a JSON file and upserts each
// contact via `messaging.saveContact({ record })` — the existing id is
// preserved, so re-imports overwrite rather than duplicate.
//
// Editing contacts (add / rename / delete) lives in the dedicated
// `ContactsList` route reached from the main menu — Settings only
// owns the bulk export / import action.

import { useEffect, useRef, useState } from 'react';
import { useMessaging } from '../../useMessaging.js';
import { useDropZone } from '../../hooks/useDropZone.js';
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
    const [importStatus, setImportStatus] = useState(/** @type {string | null} */ (null));
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
            triggerDownload('contacts', json);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const importFromText = async (text) => {
        setImportStatus(null);
        setError(null);
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) {
                throw new Error('Expected a JSON array of contact records.');
            }
            let imported = 0;
            let failed = 0;
            for (const record of parsed) {
                try {
                    await messaging.saveContact({ record });
                    imported += 1;
                } catch (err) {
                    failed += 1;
                    // eslint-disable-next-line no-console
                    console.warn('contacts.import: skipping invalid record:', err);
                }
            }
            setImportStatus(`Imported ${imported} contact${imported === 1 ? '' : 's'}${failed > 0 ? ` (${failed} skipped)` : ''}.`);
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
            await importFromText(text);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const importDrop = useDropZone({
        accept: ['.json', 'application/json'],
        readAs: 'text',
        onError: setError,
        onFile: ({ content }) => importFromText(typeof content === 'string' ? content : ''),
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
                    <span style={ROW_HINT}>Saves the address book as plain JSON. No encryption — keep the file private.</span>
                </div>
                <button type="button" onClick={onExport} style={ACTION_BTN} disabled={count === 0}>
                    Export…
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
                        Reads a contacts JSON file or drop one here. Existing contacts with the same id are overwritten.
                    </span>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
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
            {importStatus ? <Status text={importStatus} /> : null}
            {error ? <Status text={error} tone="error" /> : null}
        </div>
    );
}

function triggerDownload(prefix, content) {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
