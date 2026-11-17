// Stands in for Settings in unit tests of the Fees and Network endpoints
// pages: the list opens a network's page and a Back button returns to the
// list, as Settings' openChildPage and closeSubpage do. The real Settings
// wiring is covered by the network-page tests in
// test/unit/routes/Settings.mobile.test.jsx.

import { useState } from 'react';
import {
    FeesNetworkPage,
    FeesSection,
    FEES_NETWORK_PAGE_PREFIX,
} from '../../../packages/core/src/shared/components/settings/FeesSection.jsx';
import {
    ENDPOINTS_NETWORK_PAGE_PREFIX,
    NetworkEndpointsNetworkPage,
    NetworkEndpointsSection,
} from '../../../packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx';

function Harness({ List, Page, prefix }) {
    const [pageId, setPageId] = useState(/** @type {string | null} */ (null));
    if (!pageId) return <List onOpen={setPageId} />;
    return (
        <>
            <button type="button" aria-label="Back to previous screen" onClick={() => setPageId(null)}>Back</button>
            <Page chainId={pageId.slice(prefix.length)} />
        </>
    );
}

export function FeesHarness() {
    return <Harness List={FeesSection} Page={FeesNetworkPage} prefix={FEES_NETWORK_PAGE_PREFIX} />;
}

export function EndpointsHarness() {
    return <Harness List={NetworkEndpointsSection} Page={NetworkEndpointsNetworkPage} prefix={ENDPOINTS_NETWORK_PAGE_PREFIX} />;
}
