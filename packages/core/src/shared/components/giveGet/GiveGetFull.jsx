// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { FilterIcon, ReceiveIcon, SendIcon } from '../../../ui/icons/index.jsx';
import { GiveGetSection } from './GiveGetSection.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/components.js';
import '../../../i18n/locales/en/ui.js';

/**
 * The Full view of the shared Give/Get standard: collapsible You give and You
 * get sections (the host's own fields), then a closed Options section. Returns
 * siblings, not a wrapper, so the optionalSection rules space them 8px apart.
 *
 * @typedef {object} FullSide
 * @property {string} [title]                     defaults to 'You give' / 'You get'
 * @property {() => import('react').ReactNode} [icon]
 * @property {import('react').ReactNode} [summary] shown while closed, e.g. '100 DANKEST'
 * @property {import('react').ReactNode} children  the side's fields, in order
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.lead]        fields above the sections (single-chain forms: Network, From)
 * @param {FullSide} props.give
 * @param {FullSide} props.get
 * @param {import('react').ReactNode} [props.between]     between You get and Options (a price or escrow line)
 * @param {FullSide | null} [props.options]               title defaults to 'Options'; omit for none
 * @param {import('react').ReactNode} [props.after]       after Options (rate, fees)
 * @param {Record<string, boolean>} props.sections        open state, keyed give / get / options
 * @param {(id: string) => void} props.onToggleSection
 */
export function GiveGetFull({ lead, give, get, between, options, after, sections, onToggleSection }) {
    return (
        <>
            {lead}
            <GiveGetSection
                id="give"
                title={give.title || t('components.giveGet.youGive')}
                icon={give.icon || SendIcon}
                summary={give.summary}
                open={!!sections.give}
                onToggle={() => onToggleSection('give')}
            >
                {give.children}
            </GiveGetSection>
            <GiveGetSection
                id="get"
                title={get.title || t('components.giveGet.youGet')}
                icon={get.icon || ReceiveIcon}
                summary={get.summary}
                open={!!sections.get}
                onToggle={() => onToggleSection('get')}
            >
                {get.children}
            </GiveGetSection>
            {between}
            {options ? (
                <GiveGetSection
                    id="options"
                    title={options.title || t('ui.iconSelect.options')}
                    icon={options.icon || FilterIcon}
                    summary={options.summary}
                    open={!!sections.options}
                    onToggle={() => onToggleSection('options')}
                >
                    {options.children}
                </GiveGetSection>
            ) : null}
            {after}
        </>
    );
}
