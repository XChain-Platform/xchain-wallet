// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one action of the Wallet Form Standard.

import { Button } from '../../../ui/Button.jsx';

/**
 * One full-width primary button with an icon. The label is a verb, never a
 * ticker ("Send", "Create Dispenser", "Open Market"). It submits the form by
 * default; FormPage gives a submit its green success treatment and the
 * demo guard disables it. The form's submit handler leads to the shared
 * confirm screen (ActionConfirmScreen).
 *
 * Pass it as FormFrame's `action`, never inside the body. FormPage looks for
 * a real Button element in its action row (green submit, demo disable), so
 * FormFrame unwraps a FormAction element into the Button it renders; a submit
 * is drawn in the success colour here too, for a form that puts it straight
 * into FormPage's `actions`. A `type="button"` action (one that opens its
 * own step instead of submitting) is the same green primary: there is one
 * action style on every form.
 *
 * The label is Title Case ("Create Dispenser", "Sign Message"); hosts write
 * it that way, since a locale string cannot be recased safely here.
 *
 * It stays a plain function with no hooks: FormFrame calls it directly.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.icon        an icon element, e.g. <Icon.SendIcon />
 * @param {import('react').ReactNode} props.children    the verb
 * @param {'submit' | 'button'} [props.type]            default 'submit'
 * @param {boolean} [props.loading]
 * @param {boolean} [props.disabled]
 * @param {string} [props.title]
 * @param {(e: import('react').MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 */
export function FormAction({ icon, children, type = 'submit', ...rest }) {
    return (
        // The success variant applies to both button types.
        <Button type={type} variant="success" block icon={icon} {...rest}>
            {children}
        </Button>
    );
}
