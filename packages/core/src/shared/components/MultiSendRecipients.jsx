// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send form's Multi and Advanced tabs. Presentation only: Send owns the
// recipient list, the open add-recipient draft and the Advanced text, because
// the Token field's picker replaces the form while it is open and anything
// held here would be lost with it. The list rules live in
// flows/multiSendRecipients.js.

import { AddressField, AddressText, Button, FieldNote, Icon, ListRow, Textarea } from '@xchain-wallet/core/ui';
import { AmountField } from './AmountField.jsx';
import { FileField } from './FileField.jsx';
import { TickerIcon } from './TickerIcon.jsx';
import { TokenField } from './TokenField.jsx';
import { useDropZone } from '../hooks/useDropZone.js';
import {
    MAX_MULTI_RECIPIENTS,
    RECIPIENT_LINE_FORMAT,
    recipientAmountText,
    recipientTotalsText,
} from '../../flows/multiSendRecipients.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/common.js';
import '../../i18n/locales/en/composeMessage.js';
import '../../i18n/locales/en/send.js';
import styles from './MultiSendRecipients.module.css';

// Splits a translated "to {address}" around the address so the address can be
// drawn by AddressText, in whatever word order the language uses.
const ADDRESS_MARK = String.fromCharCode(0);
function toAddressParts() {
    const line = String(t('send.summary.toAddress', { address: ADDRESS_MARK }));
    const at = line.indexOf(ADDRESS_MARK);
    return at === -1 ? [line, ''] : [line.slice(0, at), line.slice(at + ADDRESS_MARK.length)];
}

/**
 * The add-recipient form or an expanded row editor. Enter adds or updates the
 * row instead of submitting the whole Send form.
 *
 * The coin pays its own output and has no multi-recipient form, so the field
 * offers tokens only and is labelled Token (G60).
 */
function RecipientEditor({
    chainId, draft, number, editing, onDraftChange, onOpenTokenPicker, onOpenContactsPicker,
    onCommit, onCancel, onRemove, divisibilityFor, maxFor, id,
}) {
    const errors = draft.errors || {};
    const tick = String(draft.tick || '').toUpperCase();
    const maxAmount = tick && maxFor ? maxFor(tick) : null;
    const fieldPrefix = editing ? `${id}-field` : 'send-multi';
    return (
        <div
            id={id}
            className={styles.editor}
            role="group"
            aria-label={editing ? t('send.multi.editRecipient', { number }) : t('send.multi.newRecipient')}
            data-testid="send-multi-editor"
            onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.target?.tagName !== 'INPUT') return;
                event.preventDefault();
                onCommit();
            }}
        >
            <AddressField
                id={`${fieldPrefix}-to`}
                icon="contacts"
                label={t('send.fields.to')}
                help={t('send.multi.toHelp')}
                placeholder={t('composeMessage.recipientPlaceholder')}
                value={draft.to}
                onChange={(event) => onDraftChange({ to: event.target.value })}
                onIconClick={onOpenContactsPicker}
                error={errors.to || undefined}
                autoComplete="off"
                spellCheck={false}
            />
            <TokenField
                id={`${fieldPrefix}-token`}
                help={t('send.multi.tokenHelp')}
                value={chainId && tick ? { chainId, tick } : null}
                onOpenPicker={onOpenTokenPicker}
                error={errors.tick || undefined}
                disabled={!chainId}
            />
            <AmountField
                id={`${fieldPrefix}-amount`}
                amount={draft.amount}
                tick={tick}
                help={t('send.multi.amountHelp')}
                divisibility={tick && divisibilityFor ? divisibilityFor(tick) : undefined}
                onAmountFieldChange={(value) => onDraftChange({ amount: String(value).replace(/,/g, '') })}
                onMax={maxAmount ? () => onDraftChange({ amount: maxAmount }) : undefined}
                maxDisabled={!maxAmount}
                error={errors.amount || undefined}
            />
            <div
                className={styles.editorActions}
                data-testid={editing ? 'send-multi-edit-actions' : 'send-multi-add-actions'}
            >
                {editing ? (
                    <>
                        <Button
                            variant="danger"
                            icon={<Icon.TrashIcon />}
                            aria-label={t('send.multi.removeRow', { number })}
                            onClick={onRemove}
                        >
                            {t('send.recipient.remove')}
                        </Button>
                        <Button variant="success" icon={<Icon.SaveIcon />} onClick={onCommit}>
                            {t('send.multi.save')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="secondary" icon={<Icon.XIcon />} onClick={onCancel}>
                            {t('common.cancel')}
                        </Button>
                        <Button variant="success" icon={<Icon.PlusIcon />} onClick={onCommit}>
                            {t('send.multi.add')}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * Multi: the recipients added so far, each one summary row that opens for
 * editing when tapped, the inline add form, and the per-token total. Removing
 * is an editor action, so every closed row remains one full-width tap target.
 *
 * @param {object} props
 * @param {string | null} props.chainId
 * @param {Array<{ id: string, to: string, tick: string, amount: string }>} props.recipients
 * @param {{ editingId: string, to: string, tick: string, amount: string, errors?: object } | null} props.editDraft
 * @param {{ editingId: null, to: string, tick: string, amount: string, errors?: object } | null} props.addDraft
 * @param {(patch: object) => void} props.onEditDraftChange
 * @param {(patch: object) => void} props.onAddDraftChange
 * @param {() => void} props.onStartAdd
 * @param {(id: string) => void} props.onToggleEdit
 * @param {() => void} props.onCommitEdit
 * @param {() => void} props.onCommitAdd
 * @param {() => void} props.onCancelAdd
 * @param {(id: string) => void} props.onRemove
 * @param {(target: 'edit' | 'add') => void} props.onOpenTokenPicker
 * @param {(target: 'edit' | 'add') => void} props.onOpenContactsPicker
 * @param {(tick: string) => number | undefined} [props.divisibilityFor]
 * @param {(tick: string) => string | null} [props.maxFor]
 * @param {string | null} [props.error]   the list's own refusal (empty, too many, too large, a row, the balance)
 * @param {string} [props.id]
 */
export function MultiRecipientList({
    chainId, recipients, editDraft, addDraft, onEditDraftChange, onAddDraftChange,
    onStartAdd, onToggleEdit, onCommitEdit, onCommitAdd, onCancelAdd, onRemove,
    onOpenTokenPicker, onOpenContactsPicker, divisibilityFor, maxFor,
    error = null, id = 'send-multi-list',
}) {
    const full = recipients.length >= MAX_MULTI_RECIPIENTS;
    const totals = recipientTotalsText(recipients);
    const [toBefore, toAfter] = toAddressParts();
    return (
        <div className={styles.multi} id={id} tabIndex={-1} data-testid="send-multi">
            {recipients.length > 0 ? (
                <ul className={styles.list} aria-label={t('send.multi.listLabel')}>
                    {recipients.map((row, index) => {
                        const number = index + 1;
                        const expanded = editDraft?.editingId === row.id;
                        const panelId = `${id}-recipient-${row.id}`;
                        const amountText = recipientAmountText(row);
                        return (
                            <li
                                key={row.id}
                                className={styles.item}
                                data-testid="send-multi-row"
                            >
                                <ListRow
                                    className={styles.row}
                                    contentClassName={styles.rowContent}
                                    chevron={expanded ? <Icon.ChevronDownIcon /> : true}
                                    onClick={() => onToggleEdit(row.id)}
                                    aria-expanded={expanded}
                                    aria-controls={panelId}
                                    aria-label={t('send.multi.editRow', { number, amount: amountText, address: row.to })}
                                    leading={chainId ? <TickerIcon chainId={chainId} tick={row.tick} size={32} /> : null}
                                    title={amountText}
                                    subtitle={(
                                        <span className={styles.rowTo}>
                                            {toBefore ? <span className={styles.toWord}>{toBefore.trim()}</span> : null}
                                            <AddressText address={row.to} size="sm" fit focusable={false} />
                                            {toAfter.trim() ? <span className={styles.toWord}>{toAfter.trim()}</span> : null}
                                        </span>
                                    )}
                                />
                                {expanded ? (
                                    <div className={styles.editing}>
                                        <RecipientEditor
                                            id={panelId}
                                            chainId={chainId}
                                            draft={editDraft}
                                            number={number}
                                            editing
                                            onDraftChange={onEditDraftChange}
                                            onOpenTokenPicker={() => onOpenTokenPicker('edit')}
                                            onOpenContactsPicker={() => onOpenContactsPicker('edit')}
                                            onCommit={onCommitEdit}
                                            onRemove={() => onRemove(row.id)}
                                            divisibilityFor={divisibilityFor}
                                            maxFor={maxFor}
                                        />
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            ) : null}
            {addDraft ? (
                <RecipientEditor
                    chainId={chainId}
                    draft={addDraft}
                    number={recipients.length + 1}
                    editing={false}
                    onDraftChange={onAddDraftChange}
                    onOpenTokenPicker={() => onOpenTokenPicker('add')}
                    onOpenContactsPicker={() => onOpenContactsPicker('add')}
                    onCommit={onCommitAdd}
                    onCancel={onCancelAdd}
                    divisibilityFor={divisibilityFor}
                    maxFor={maxFor}
                />
            ) : null}
            {!addDraft && !full ? (
                <Button variant="secondary" icon={<Icon.PlusIcon />} onClick={onStartAdd}>
                    {t('send.multi.addRecipient')}
                </Button>
            ) : null}
            {full ? (
                <FieldNote variant="info" testId="send-multi-limit">
                    {t('send.multi.limit', { count: MAX_MULTI_RECIPIENTS })}
                </FieldNote>
            ) : null}
            {totals.length > 0 ? (
                <p className={styles.totals} data-testid="send-multi-totals">
                    {t('send.multi.total', { total: totals.join(' + '), count: recipients.length })}
                </p>
            ) : null}
            {error ? <FieldNote variant="error" testId="send-multi-error">{error}</FieldNote> : null}
        </div>
    );
}

/**
 * Advanced: one recipient per line in a text box, filled by hand or from a
 * CSV file through the standard file field. Line errors show under the box
 * once a submit has failed; the recipient count and the one-transaction limit
 * show as the user types.
 *
 * @param {object} props
 * @param {string} props.text
 * @param {(text: string) => void} props.onTextChange
 * @param {string} [props.fileName]
 * @param {(args: { name: string, text: string }) => void} props.onFileText
 * @param {() => void} props.onClearFile
 * @param {(message: string) => void} props.onFileError
 * @param {string | null} [props.fileError]
 * @param {string | null} [props.error]         line errors, shown after a failed submit
 * @param {string | null} [props.countLine]     the live count or limit line
 * @param {boolean} [props.overLimit]
 * @param {string} [props.id]
 */
export function AdvancedRecipientText({
    text, onTextChange, fileName = '', onFileText, onClearFile, onFileError,
    fileError = null, error = null, countLine = null, overLimit = false, id = 'send-advanced-text',
}) {
    const drop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (message) => onFileError(message),
        onFile: ({ file, content }) => {
            onFileText({ name: file?.name || '', text: typeof content === 'string' ? content : '' });
        },
    });
    return (
        <div className={styles.advanced} data-testid="send-advanced">
            <Textarea
                id={id}
                label={t('send.multi.listLabel')}
                help={t('send.multiText.help')}
                rows={6}
                wrap="off"
                className={styles.advancedText}
                style={{
                    width: '100%',
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                    fontFamily: 'var(--xc-font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
                }}
                value={text}
                onChange={(event) => onTextChange(event.target.value)}
                placeholder={t('send.multiText.placeholder')}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                hint={!overLimit ? (countLine || undefined) : undefined}
                error={error || (overLimit ? countLine : undefined) || undefined}
            />
            {/* The drop zone's own 2 MB cap is named in the label (G25). */}
            <FileField
                id="send-advanced-file"
                label={t('send.multiText.fileLabel')}
                help={t('send.multiText.fileHelp', { format: RECIPIENT_LINE_FORMAT })}
                optional
                inputLabel={t('send.multiText.fileInput')}
                fileName={fileName}
                drop={drop}
                onClear={onClearFile}
                error={fileError}
            />
        </div>
    );
}
