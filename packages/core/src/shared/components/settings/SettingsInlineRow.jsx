// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A setting changed in place on its Settings group page (2026-11-13 inline
// rule): one switch is a switch on the row, one short choice is the themed
// dropdown on the row, one action is a button on the row, and a row with
// nothing to change shows its value. Only a setting with several related
// fields still opens a page of its own.
//
// A row describes its control as data, so a group adopts inline rows by
// adding a `control` to its row entries:
//   { kind: 'switch', checked(settings), patch(next), disabled?(settings) }
//       (or write(next, update, settings) when the change does more than save)
//   { kind: 'select', value(settings), options(settings), patch(value) }
//       (or write(value, update, settings) when a step runs before the save)
//   { kind: 'action', label, icon, run(update, settings), confirm? }
//       (label Title Case; run may resolve { message, variant } to show a
//       result under the row; confirm is a ConfirmModal request asked first)
//   { kind: 'static', value(settings) }
//   { kind: 'custom', Component }   a row with state of its own (Panic mode,
//                                   Biometric unlock, contacts files); it
//                                   draws itself with InlineRowFrame
// Each control writes the same settings key, through the same update, as the
// page it replaces.

import { useId, useState } from 'react';
import { Button, InfoTip, Select, StatusMessage, Switch } from '@xchain-wallet/core/ui';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/ui.js';
import styles from './SettingsInlineRow.module.css';

// The Settings load failure and the focus hand-off between swapped buttons,
// shared with the group page and the stateful rows outside this directory.
export { SettingsLoadError, useFocusAfterSwap } from './_settingsPrimitives.jsx';

const SAVE_ERROR = 'Could not save this setting. Try again.';

/**
 * One inline row's layout: icon, title with its ? tip, one short line, and
 * the control at the row end; messages about the row go under it.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.leading]
 * @param {string} props.title
 * @param {import('react').ReactNode} [props.help]
 * @param {import('react').ReactNode} [props.line]
 * @param {string} [props.lineId]
 * @param {string} [props.kind]   the control kind, for tests and styling
 * @param {import('react').ReactNode} [props.children]   the control
 * @param {import('react').ReactNode} [props.after]   messages under the row
 */
export function InlineRowFrame({ leading, title, help, line, lineId, kind = 'custom', children, after }) {
    return (
        <>
            <div className={styles.row} data-settings-inline={kind}>
                {leading}
                <div className={styles.copy}>
                    <span className={styles.titleLine}>
                        <span className={styles.title} data-settings-row-title="">{title}</span>
                        {help ? <InfoTip label={help} aria={t('ui.field.about', { label: title })} /> : null}
                    </span>
                    {line ? <span className={styles.line} id={lineId}>{line}</span> : null}
                </div>
                {children ? <div className={styles.control}>{children}</div> : null}
            </div>
            {after ? <div className={styles.error}>{after}</div> : null}
        </>
    );
}

/**
 * A switch row: the kit Switch fills the row, so a tap on the title or line
 * flips it as a tap on the switch does.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.leading]
 * @param {string} props.title
 * @param {import('react').ReactNode} [props.help]
 * @param {import('react').ReactNode} [props.line]
 * @param {boolean} props.checked
 * @param {boolean} [props.disabled]
 * @param {(next: boolean) => void} props.onChange
 * @param {import('react').ReactNode} [props.after]
 */
export function InlineSwitchFrame({ leading, title, help, line, checked, disabled = false, onChange, after }) {
    return (
        <>
            <div className={styles.row} data-settings-inline="switch">
                {leading}
                <Switch
                    className={styles.switch}
                    label={<span className={styles.title} data-settings-row-title="">{title}</span>}
                    aria-label={title}
                    help={help}
                    description={line ? <span className={styles.line}>{line}</span> : undefined}
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.checked)}
                />
            </div>
            {after ? <div className={styles.error}>{after}</div> : null}
        </>
    );
}

/**
 * @param {object} props
 * @param {{ id: string, title: string, help?: import('react').ReactNode, line?: string | ((settings: any) => string), saveError?: string, control: any }} props.row
 * @param {import('react').ReactNode} [props.leading]   the row icon
 * @param {any} props.settings
 * @param {(patch: Record<string, unknown>) => Promise<unknown>} props.update
 */
export function SettingsInlineRow({ row, leading, settings, update }) {
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [note, setNote] = useState(/** @type {{ message: string, variant?: string } | null} */ (null));
    const [busy, setBusy] = useState(false);
    const confirmDialog = useConfirmModal();
    const baseId = useId();
    const lineId = `${baseId}-line`;
    const { control } = row;
    const line = typeof row.line === 'function' ? row.line(settings) : row.line;
    const ready = Boolean(settings);

    if (control.kind === 'custom') {
        const Custom = control.Component;
        return <Custom row={row} leading={leading} settings={settings} update={update} />;
    }

    const save = async (write) => {
        setError(null);
        setNote(null);
        setBusy(true);
        try {
            const result = await write();
            if (result && typeof result.message === 'string') setNote(result);
        } catch (err) {
            setError(row.saveError || SAVE_ERROR);
            // eslint-disable-next-line no-console
            console.error(`settings ${row.id} update failed:`, err);
        } finally {
            setBusy(false);
        }
    };
    const after = error || note || confirmDialog.request ? (
        <>
            {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
            {note ? <StatusMessage variant={note.variant || 'success'}>{note.message}</StatusMessage> : null}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </>
    ) : null;

    if (control.kind === 'switch') {
        return (
            <InlineSwitchFrame
                leading={leading}
                title={row.title}
                help={row.help}
                line={line}
                checked={ready ? Boolean(control.checked(settings)) : false}
                disabled={!ready || Boolean(control.disabled?.(settings))}
                onChange={(next) => save(() => (control.write
                    ? control.write(next, update, settings)
                    : update(control.patch(next, settings))))}
                after={after}
            />
        );
    }

    let trailing = null;
    if (control.kind === 'select') {
        trailing = (
            <div className={styles.select}>
                <Select
                    value={ready ? String(control.value(settings)) : undefined}
                    options={ready ? control.options(settings) : []}
                    // Stays enabled while a pick saves, so focus returned to it is never stranded.
                    disabled={!ready}
                    aria-label={row.title}
                    aria-describedby={line ? lineId : undefined}
                    onChange={(event) => {
                        const next = event.target.value;
                        save(() => (control.write
                            ? control.write(next, update, settings)
                            : update(control.patch(next, settings))));
                    }}
                />
            </div>
        );
    } else if (control.kind === 'action') {
        // Every Settings button carries an icon, so an action names one.
        const ActionIcon = control.icon;
        trailing = (
            <Button
                type="button"
                size="sm"
                variant={control.variant || 'secondary'}
                icon={<ActionIcon />}
                // An action that does not read settings (Check for updates) is ready at once.
                disabled={(control.requiresSettings !== false && !ready) || busy}
                aria-describedby={line ? lineId : undefined}
                onClick={async () => {
                    if (control.confirm && !(await confirmDialog.confirm(control.confirm))) return;
                    save(() => control.run(update, settings));
                }}
            >
                {control.label}
            </Button>
        );
    } else if (control.kind === 'static') {
        trailing = <span className={styles.value}>{ready ? control.value(settings) : '-'}</span>;
    }
    return (
        <InlineRowFrame
            leading={leading}
            title={row.title}
            help={row.help}
            line={line}
            lineId={lineId}
            kind={control.kind}
            after={after}
        >
            {trailing}
        </InlineRowFrame>
    );
}
