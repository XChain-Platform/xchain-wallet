// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The frame of the Wallet Form Standard. A
// form is its own fields placed in this shared frame.

import { isValidElement } from 'react';
import { FormPage } from '../../../ui/FormPage.jsx';
import { ViewSwitch } from '../giveGet/ViewSwitch.jsx';
import { FormAction } from './FormAction.jsx';
import { FormStatusScope, FormStatusSlot } from './FormStatusSlot.jsx';
import styles from './formStandard.module.css';

/**
 * Lays a form out top to bottom as the standard asks. The title bar stays the
 * host's Screen + PageHeader (Back, Title Case title, page-level icons only);
 * FormFrame is the page body under it:
 *
 *   lead           page-level notes that must stay first (the panic freeze)
 *   Quick | Full   only when `view` is passed (giveGet ViewSwitch), 8px above the first section
 *   from           <FromSection />
 *   children       the main <FormSection> (open by default), then the others (closed)
 *   fee            <FeeSection />
 *   status slot    `status` plus every notice raised inside the body
 *   action         <FormAction />, full width
 *
 * Sections sit 8px apart. On a wide screen the form card keeps the section
 * cards (data-xc-preserve-nested-cards), as Issue token does.
 *
 * Every other prop goes to FormPage (id, label, onSubmit, onChangeCapture,
 * demoGuard, ...). Do not pass FormPage `status` or `actions`; use `status`
 * and `action` here.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.lead]
 * @param {'quick' | 'full'} [props.view]
 * @param {(view: 'quick' | 'full') => void} [props.onViewChange]
 * @param {string} [props.viewLabel]
 * @param {import('react').ReactNode} [props.from]
 * @param {import('react').ReactNode} [props.fee]
 * @param {import('react').ReactNode | import('react').ReactNode[]} [props.status]
 * @param {import('react').ReactNode} props.action
 * @param {import('react').ReactNode} props.children
 */
export function FormFrame({
    lead = null,
    view,
    onViewChange,
    viewLabel,
    from = null,
    fee = null,
    status,
    action,
    children,
    ...formPageProps
}) {
    // FormPage recognises a real Button in its action row (green submit,
    // demo disable); FormAction has no hooks, so it is unwrapped here.
    const actionNode = isValidElement(action) && action.type === FormAction
        ? FormAction(action.props)
        : action;
    return (
        <FormPage {...formPageProps} actions={actionNode}>
            {lead}
            {view ? (
                <ViewSwitch value={view} onChange={onViewChange} label={viewLabel} />
            ) : null}
            <FormStatusScope>
                <div className={styles.sections} data-xc-preserve-nested-cards="" data-form-sections="">
                    {from}
                    {children}
                    {fee}
                </div>
                <FormStatusSlot status={status} />
            </FormStatusScope>
        </FormPage>
    );
}
