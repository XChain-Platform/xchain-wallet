// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { SegmentedControl } from '../../../ui/SegmentedControl.jsx';
import { DocumentIcon, ZapIcon } from '../../../ui/icons/index.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/components.js';
import styles from './GiveGet.module.css';

/**
 * The Quick | Full switch at the top of a Give/Get form, built on
 * the app's SegmentedControl. Both views render the same form state.
 *
 * @param {object} props
 * @param {'quick' | 'full'} props.value
 * @param {(view: 'quick' | 'full') => void} props.onChange
 * @param {string} [props.label]   accessible name of the group
 * @param {boolean} [props.disabled]
 */
export function ViewSwitch({ value, onChange, label, disabled = false }) {
    return (
        <SegmentedControl
            aria-label={label ?? t('components.giveGet.formView')}
            className={styles.viewSwitch}
            value={value}
            onChange={onChange}
            items={[
                { id: 'quick', disabled, label: <><ZapIcon aria-hidden="true" /><span>{t('components.giveGet.viewQuick')}</span></> },
                { id: 'full', disabled, label: <><DocumentIcon aria-hidden="true" /><span>{t('components.giveGet.viewFull')}</span></> },
            ]}
        />
    );
}
