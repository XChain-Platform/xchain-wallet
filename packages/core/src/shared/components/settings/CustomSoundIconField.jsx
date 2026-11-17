// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Icon, ListPage, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { CustomSoundIcon, CUSTOM_SOUND_ICON_OPTIONS } from '../../../ui/icons/customSoundIcons.jsx';
import { useBackHandler } from '../../../ui/backStack.js';
import { ListField } from '../ListField.jsx';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { ChoiceList, RowIcon } from './AppearancePages.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/common.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/shell.js';

const LEGACY_LABELS = Object.freeze({
    BellIcon: 'Bell',
    MusicIcon: 'Chime',
    CoinsIcon: 'Coin',
    TokenIcon: 'Star',
    SendIcon: 'Rocket',
    GuitarIcon: 'Music Note',
    HeartIcon: 'Heart',
    CircleCheckIcon: 'Check',
    ZapIcon: 'Sparkle',
    ClockIcon: 'Alarm',
    UsersIcon: 'Party',
    BroadcastIcon: 'Wave',
});
const LEGACY_EQUIVALENTS = Object.freeze({ HeartIcon: 'lucide:heart' });

export function availableCustomSoundIcons(usedIcons = [], currentIcon = null) {
    const used = new Set(usedIcons);
    for (const icon of usedIcons) {
        if (LEGACY_EQUIVALENTS[icon]) used.add(LEGACY_EQUIVALENTS[icon]);
    }
    const options = CUSTOM_SOUND_ICON_OPTIONS.filter(
        (option) => option.value === currentIcon || !used.has(option.value),
    );
    const CurrentIcon = currentIcon ? Icon[currentIcon] : null;
    if (currentIcon && !options.some((option) => option.value === currentIcon) && typeof CurrentIcon === 'function') {
        return [{
            value: currentIcon,
            label: LEGACY_LABELS[currentIcon] || currentIcon.replace(/Icon$/, ''),
            source: currentIcon,
            legacy: true,
        }, ...options];
    }
    return options;
}

function OptionGlyph({ option }) {
    if (!option) return null;
    if (!option.legacy) return <CustomSoundIcon value={option.value} />;
    const LegacyIcon = Icon[option.value];
    return typeof LegacyIcon === 'function' ? <LegacyIcon /> : null;
}

export function CustomSoundIconField({
    value,
    onChange,
    usedIcons = [],
    currentIcon = null,
    disabled = false,
    onOpenPicker,
}) {
    const options = useMemo(
        () => availableCustomSoundIcons(usedIcons, currentIcon),
        [currentIcon, usedIcons],
    );
    const selected = options.find((option) => option.value === value) || options[0] || null;

    useEffect(() => {
        if (selected && selected.value !== value) onChange(selected.value);
    }, [onChange, selected, value]);

    return (
        <ListField
            id="soundIcon"
            label={t('settings.notifications.soundIcon')}
            help={t('settings.notifications.soundIconHelp')}
            valueText={selected?.label || null}
            icon={<OptionGlyph option={selected} />}
            placeholder={t('settings.notifications.chooseSoundIcon')}
            onOpenPicker={onOpenPicker}
            disabled={disabled || !selected || typeof onOpenPicker !== 'function'}
        />
    );
}

/**
 * Full-page icon picker used by Add Sound. Search stays in the standard header
 * filter and every choice is one row in the shared Settings list card.
 */
export function CustomSoundIconPickerScreen({
    value,
    usedIcons = [],
    currentIcon = null,
    onSelect,
    onBack,
    variant,
}) {
    const [query, setQuery] = useState('');
    const options = useMemo(
        () => availableCustomSoundIcons(usedIcons, currentIcon),
        [currentIcon, usedIcons],
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visible = normalizedQuery
        ? options.filter((option) => `${option.label} ${option.source}`.toLocaleLowerCase().includes(normalizedQuery))
        : options;
    const choices = visible.map((option) => {
        const Glyph = () => <OptionGlyph option={option} />;
        return {
            value: option.value,
            title: option.label,
            leading: <RowIcon icon={Glyph} />,
        };
    });

    useBackHandler(onBack, false, 'screen');

    return (
        <Screen
            variant={variant}
            header={(
                <PageHeader
                    nested
                    onBack={onBack}
                    backLabel={t('shell.settings.back')}
                    title={t('settings.notifications.chooseSoundIconTitle')}
                    trailing={(
                        <ListFilterMenu
                            query={query}
                            onQueryChange={setQuery}
                            label={t('settings.notifications.searchSoundIcons')}
                            searchLabel={t('settings.notifications.searchSoundIcons')}
                            searchPlaceholder={t('settings.notifications.searchSoundIconsPlaceholder')}
                        />
                    )}
                />
            )}
        >
            <ListPage>
                {choices.length > 0 ? (
                    <ChoiceList
                        label={t('settings.notifications.soundIcons')}
                        choices={choices}
                        value={value}
                        onSelect={onSelect}
                    />
                ) : (
                    <EmptyState
                        title={t('settings.notifications.noSoundIconsMatch')}
                        body={t('settings.notifications.noSoundIconsMatchBody')}
                        actionLabel={t('common.clear')}
                        actionIcon={<Icon.RefreshIcon />}
                        onAction={() => setQuery('')}
                    />
                )}
            </ListPage>
        </Screen>
    );
}
