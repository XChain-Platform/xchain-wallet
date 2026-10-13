// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef } from 'react';
import styles from './FormPage.module.css';

/**
 * Page template for every screen whose job is a form the user fills in and
 * submits. One rule on every platform, decided by viewport width alone
 * (FormPage.module.css, breakpoint 600px):
 *
 *   narrow (< 600px)  fields sit bare on the page gutter, no card
 *   wide  (>= 600px)  the form sits in one card, a centred 560px column
 *
 * Pass `sectioned` when the children are FormSections: each section then
 * becomes its own card when wide, and a heading-divided block when narrow.
 * The action row always closes the form, below the last field or section,
 * and its buttons wrap rather than overflow.
 *
 * The width decision is pure CSS, never the shell or a JS width check, so a
 * phone browser gets the bare form and the first paint is already right.
 *
 * @param {object} props
 * @param {(e: import('react').FormEvent<HTMLFormElement>) => void} [props.onSubmit]
 * @param {import('react').ReactNode} [props.actions]   the action row: primary last, so it ends up on the right
 * @param {import('react').ReactNode} [props.status]    a StatusMessage shown just above the actions
 * @param {import('react').ReactNode} [props.intro]     one muted paragraph above the first field
 * @param {boolean} [props.sectioned]                   children are FormSections (card per section when wide)
 * @param {string} [props.label]                        accessible name, which makes the form a landmark
 * @param {boolean} [props.noValidate]                  default true: the route validates and reports through `status`
 * @param {'form' | 'div'} [props.as]                   use div for a reusable form fragment already inside a parent form
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export const FormPage = forwardRef(function FormPage(
    {
        onSubmit,
        actions,
        status,
        intro,
        sectioned = false,
        label,
        noValidate = true,
        as: Root = 'form',
        className,
        children,
        ...rest
    },
    ref,
) {
    const classNames = [
        styles.form,
        sectioned ? styles.sectioned : null,
        className,
    ].filter(Boolean).join(' ');
    const semanticProps = Root === 'form'
        ? { onSubmit, noValidate, 'aria-label': label }
        : { role: 'group', 'aria-label': label };
    return (
        <Root
            ref={ref}
            className={classNames}
            {...semanticProps}
            {...rest}
        >
            {intro ? <p className={styles.intro}>{intro}</p> : null}
            <div className={styles.body}>{children}</div>
            {status ? <div className={styles.status}>{status}</div> : null}
            {actions ? <div className={styles.actions}>{actions}</div> : null}
        </Root>
    );
});
