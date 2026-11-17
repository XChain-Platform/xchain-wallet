// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon, Select } from '@xchain-wallet/core/ui';
import { ENTRY_ICON } from '../routes/ActionsMenu.jsx';
import { actionDisplayLabel } from './actionDisplayLabel.js';

/**
 * The icon a protocol action's dropdown option wears: the Actions menu's icon
 * for the same action when it has one, else the icon its display label maps
 * to, else the contract icon. Every action picker uses this one map.
 *
 * @param {string} name protocol action name, such as SEND
 * @returns {import('react').ReactNode}
 */
export function actionOptionIcon(name) {
    const ActionIcon = ENTRY_ICON[String(name).toLowerCase()]
        || Icon.iconForLabel(actionDisplayLabel(name))
        || Icon.ContractIcon;
    return <ActionIcon />;
}

/**
 * The options of an action dropdown, shared by the Advanced, Batch and
 * Parallel forms: a placeholder first, then one option per action with its
 * icon and its "Label (NAME)" text.
 *
 * @param {readonly string[]} actions protocol action names
 * @param {string} placeholder text of the empty choice
 * @returns {import('react').ReactNode[]}
 */
export function actionSelectOptions(actions, placeholder) {
    return [
        <Select.Option key="" value="" icon={<Icon.ListIcon />}>{placeholder}</Select.Option>,
        ...actions.map((a) => (
            <Select.Option key={a} value={a} icon={actionOptionIcon(a)}>{actionDisplayLabel(a)} ({a})</Select.Option>
        )),
    ];
}
