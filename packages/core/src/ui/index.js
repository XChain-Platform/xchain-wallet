// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @xchain-wallet/core/ui: React primitives for the shell layer.
//
// tokens.css is a sibling of this file; shells import it once at their
// entry point: `import '@xchain-wallet/core/ui/tokens.css';`.

export { Screen } from './Screen.jsx';
export { PageHeader } from './PageHeader.jsx';
// Page templates: every routed screen's body is one of these (STYLE_GUIDE.md).
export { FormPage } from './FormPage.jsx';
export { FormErrorSummary } from './FormErrorSummary.jsx';
export { FormSection } from './FormSection.jsx';
export { ListPage } from './ListPage.jsx';
export { EmptyState } from './EmptyState.jsx';
export { SectionHeader } from './SectionHeader.jsx';
export { StatusMessage } from './StatusMessage.jsx';
export { Button } from './Button.jsx';
export { Tabs } from './Tabs.jsx';
export { Input } from './Input.jsx';
export { Select } from './Select.jsx';
export { Textarea } from './Textarea.jsx';
export { IconSelect } from './IconSelect.jsx';
export { AddressCombobox } from './AddressCombobox.jsx';
export { AddressField } from './AddressField.jsx';
export { ChainBadge } from './ChainBadge.jsx';
export { FeeSelector } from './FeeSelector.jsx';
export { AddressText } from './AddressText.jsx';
export { CopyButton } from './CopyButton.jsx';
export { AnimatedQrFrames } from './AnimatedQrFrames.jsx';
export { MultisigBadge } from './MultisigBadge.jsx';
export { VerifiedBadge } from './VerifiedBadge.jsx';
export { QrScanner } from './QrScanner.jsx';
export { ChainPicker } from './ChainPicker.jsx';
export { NetworkField } from './NetworkField.jsx';
export { Skeleton } from './Skeleton.jsx';
export { InfoTip } from './InfoTip.jsx';
export * as Icon from './icons/index.jsx';
// The reduced-motion resolver every JS-driven animation reads, so a
// consumer never has to decide between the OS preference and the in-app
// override itself.
export {
    useReducedMotion,
    resolveReducedMotion,
    REDUCED_MOTION_ATTR,
} from './reducedMotion.js';
