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

import { isValidElement, useMemo } from 'react';
import { isDemoWallet } from '../../../flows/demoMode.js';
import { FormPage } from '../../../ui/FormPage.jsx';
import { ViewSwitch } from '../giveGet/ViewSwitch.jsx';
import { FormAdvancedContext } from './AdvancedSection.jsx';
import { armAdvanced } from './advancedOptions.js';
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
 *   fee            <FeeSection />, which draws the optional Advanced section
 *                  (fee bumping, coin control, change address) directly above it
 *   status slot    `status` plus every notice raised inside the body
 *   action         <FormAction />, full width
 *
 * Sections sit 8px apart. On a wide screen the form card keeps the section
 * cards (data-xc-preserve-nested-cards), as Issue token does.
 *
 * Every other prop goes to FormPage (id, label, onSubmit, onChangeCapture,
 * demoGuard, errors, ...). Do not pass FormPage `status` or `actions`; use
 * `status` and `action` here. `errors` (the map from useFormErrors, the form
 * error standard) goes straight to FormPage, so the form's error notice leads
 * the page at the top, above the first section, and each kit field reads its
 * own entry; it never goes in the status slot. `errorAction` (that notice's
 * one action, such as Send's Use max) goes to FormPage with it.
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
 * @param {boolean | { rbf?: boolean, coins?: boolean, change?: boolean }} [props.advanced]
 *   capability flags for the Advanced section FeeSection draws above Speed
 *   and Fees (see FeeSection `advanced`); `false` leaves it out
 * @param {string} [props.walletId]  the wallet, when the form passes no demoGuard
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
    advanced,
    walletId: walletIdProp,
    children,
    ...formPageProps
}) {
    // FormPage recognises a real Button in its action row (green submit);
    // FormAction has no hooks, so it is unwrapped here.
    const actionNode = isValidElement(action) && action.type === FormAction
        ? FormAction(action.props)
        : action;
    // A refused demo submit answers in the slot above the action, as any
    // other submit error does, so FormPage gets the guard without its note.
    const { demoGuard } = formPageProps;
    const demoRefusal = demoGuard?.blocked ? demoGuard.note : null;
    const basePageProps = demoRefusal ? { ...formPageProps, demoGuard: { ...demoGuard, note: null } } : formPageProps;
    const slotStatus = demoRefusal
        ? [demoRefusal, ...(Array.isArray(status) ? status : [status])]
        : status;

    // The Advanced section (drawn by FeeSection) learns the form, the source
    // network and address from FromSection, and the wallet from the demo
    // guard, so no form passes them again.
    const formKey = String(formPageProps.id || formPageProps.label || 'form');
    const fromProps = isValidElement(from) ? /** @type {any} */ (from.props) : null;
    const walletId = walletIdProp ?? demoGuard?.walletId ?? null;
    const advancedFrame = useMemo(() => ({
        formKey,
        chainId: fromProps?.chainId || null,
        address: typeof fromProps?.address === 'string' && fromProps.address ? fromProps.address : null,
        walletId,
        demo: Boolean(walletId && isDemoWallet(walletId)),
        advanced,
    }), [formKey, fromProps?.chainId, fromProps?.address, walletId, advanced]);

    // A submit (or a press of the action) arms this form's Advanced choices,
    // so the compose it starts takes them and no other action on the page
    // does. The confirmation disarms them when it ends.
    const { onSubmitCapture, onClickCapture } = formPageProps;
    const pageProps = {
        ...basePageProps,
        onSubmitCapture: (event) => {
            armAdvanced(formKey, event.currentTarget);
            onSubmitCapture?.(event);
        },
        onClickCapture: (event) => {
            // Clicks inside the change-address picker page (a portal) reach
            // here through React, but are not a press of the action.
            const button = event.target?.closest?.('button');
            if (button && !button.closest('[data-form-sections]') && !button.closest('[data-form-status]')
                && !button.closest('[data-advanced-picker]')) {
                armAdvanced(formKey, event.currentTarget);
            }
            onClickCapture?.(event);
        },
    };
    return (
        <FormAdvancedContext.Provider value={advancedFrame}>
            <FormPage {...pageProps} data-form-frame="" actions={actionNode}>
                {lead ? <div className={styles.lead}>{lead}</div> : null}
                {view ? (
                    <ViewSwitch value={view} onChange={onViewChange} label={viewLabel} />
                ) : null}
                <FormStatusScope>
                    <div className={styles.sections} data-xc-preserve-nested-cards="" data-form-sections="">
                        {from}
                        {children}
                        {fee}
                    </div>
                    <FormStatusSlot status={slotStatus} />
                </FormStatusScope>
            </FormPage>
        </FormAdvancedContext.Provider>
    );
}
