// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct AlertDetailScreen: View {
    let item: SnapshotInboxItem?
    let request: Request?
    let now: Int64
    let onOpenOnPhone: () -> Void

    init(
        item: SnapshotInboxItem,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        onOpenOnPhone: @escaping () -> Void
    ) {
        self.item = item
        request = nil
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    init(
        request: Request,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        onOpenOnPhone: @escaping () -> Void
    ) {
        item = nil
        self.request = request
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    var content: AlertDetailContent {
        AlertDetailContent(
            item: item,
            request: request,
            now: now,
            onOpenOnPhone: onOpenOnPhone
        )
    }

    var familySymbol: String { content.familySymbol }

    var detailBody: String? { content.detailBody }
    var alertTime: (key: String, n: Int)? { content.alertTime }
    var requestExpired: Bool { content.requestExpired }
    var requestModel: AlertsPresenter.RequestModel? { content.requestModel }
    func alertLabel(_ item: SnapshotInboxItem) -> String {
        content.alertLabel(item)
    }

    func requestLabel(_ index: Int) -> String {
        content.requestLabel(index)
    }

    func controlLabel(_ key: String) -> String {
        content.controlLabel(key)
    }

    var body: some View {
        ScrollView {
            content
        }
        .navigationTitle(LocalizedStringKey("w4.title"))
    }
}

struct AlertDetailContent: View {
    let item: SnapshotInboxItem?
    let request: Request?
    let now: Int64
    let onOpenOnPhone: () -> Void

    init(
        item: SnapshotInboxItem,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        onOpenOnPhone: @escaping () -> Void
    ) {
        self.item = item
        request = nil
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    init(
        request: Request,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        onOpenOnPhone: @escaping () -> Void
    ) {
        item = nil
        self.request = request
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    init(
        item: SnapshotInboxItem?,
        request: Request?,
        now: Int64,
        onOpenOnPhone: @escaping () -> Void
    ) {
        self.item = item
        self.request = request
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    var familySymbol: String {
        AlertFamilyIcon.symbol(family: item?.family ?? request?.kind.rawValue ?? "")
    }

    var detailBody: String? { item.flatMap { AlertsRules.detailBody($0.body) } }
    var alertTime: (key: String, n: Int)? {
        item.map { RelativeTimeText.alertKey(at: $0.at, now: now) }
    }
    var requestExpired: Bool { AlertsRules.isExpired(expiresAt: request?.expiresAt, now: now) }
    var requestModel: AlertsPresenter.RequestModel? {
        request.map { AlertsPresenter.request($0, now: now) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: familySymbol).font(.title2).foregroundStyle(.tint)
                .accessibilityHidden(true)
            if let item {
                Text(item.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(verbatim: alertLabel(item)))
                if let detailBody {
                    Text(detailBody).fixedSize(horizontal: false, vertical: true)
                        .accessibilityHidden(true)
                }
                if let time = alertTime {
                    Text(RelativeTimeText.fill(NSLocalizedString(time.key, comment: ""), n: time.n))
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            } else if let request {
                Text(request.sentence).font(.headline).fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(verbatim: requestLabel(0)))
                LabeledContent(LocalizedStringKey("w4.requestAmount"), value: request.amountText)
                    .accessibilityLabel(Text(verbatim: requestLabel(1)))
                if let expiresAt = request.expiresAt {
                    if requestExpired {
                        Text(LocalizedStringKey("w4.requestExpired"))
                            .accessibilityLabel(Text(verbatim: requestLabel(2)))
                    } else {
                        LabeledContent(LocalizedStringKey("w4.requestExpiry")) {
                            Text(
                                Date(timeIntervalSince1970: Double(expiresAt) / 1_000),
                                format: .dateTime.month(.abbreviated).day().hour().minute()
                            )
                        }
                        .accessibilityLabel(Text(verbatim: requestLabel(2)))
                    }
                }
            }
            Button(action: onOpenOnPhone) {
                Label(LocalizedStringKey("w4.openOnPhone"), systemImage: "iphone")
            }
            .accessibilityLabel(Text(verbatim: controlLabel("w4.openOnPhone")))
        }
    }

    func alertLabel(_ item: SnapshotInboxItem) -> String {
        AccessibilityLabels.alertDetail(item, time: formattedAlertTime)
    }

    func requestLabel(_ index: Int) -> String {
        guard let requestModel else { return "" }
        return AccessibilityLabels.requestLines(
            requestModel,
            text: localized,
            time: formattedExpiry
        )[index]
    }

    func controlLabel(_ key: String) -> String {
        AccessibilityLabels.control(key, text: localized)
    }

    private var formattedAlertTime: String {
        guard let time = alertTime else { return "" }
        return RelativeTimeText.fill(localized(time.key), n: time.n)
    }

    private func formattedExpiry(_ expiresAt: Int64) -> String {
        Date(timeIntervalSince1970: Double(expiresAt) / 1_000).formatted(
            .dateTime.month(.abbreviated).day().hour().minute()
        )
    }

    private func localized(_ key: String) -> String { NSLocalizedString(key, comment: "") }
}
