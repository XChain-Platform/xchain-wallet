// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { OptionSwitch, OptionSwitchList } from '../../../ui/OptionSwitchList.jsx';
import { KeyIcon } from '../../../ui/icons/index.jsx';

/**
 * One ownership on/off option for a Give/Get side (G118): a one-row card with
 * a key icon, the label and a switch on the right. The shared Switch keeps the
 * label's ? help outside the labelled text, so tapping the help never flips the
 * switch. The fixed explanation lives in the help tip; nothing static sits
 * under the label.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {import('react').ReactNode} [props.help]
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 */
export function OwnershipToggle({ label, help, checked, onChange, disabled = false, id }) {
    return (
        <OptionSwitchList data-ownership-toggle="">
            <OptionSwitch
                id={id}
                icon={<KeyIcon />}
                label={label}
                help={help || undefined}
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
            />
        </OptionSwitchList>
    );
}
