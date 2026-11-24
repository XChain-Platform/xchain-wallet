// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum AccessibilityLabels {
    static func control(_ key: String, text: (String) -> String) -> String {
        text(key)
    }

    static func balanceHeader(
        _ display: BalancesDisplay,
        text: (String) -> String
    ) -> String {
        spoken(display.header, isPrimary: true, text: text) ?? ""
    }

    static func balanceLines(
        _ display: BalancesDisplay,
        text: (String) -> String
    ) -> [String] {
        display.lines.map { line in
            if let key = line.key {
                return text(key)
            }

            return SpokenLabels.lines([
                line.name,
                spoken(line.primary, isPrimary: true, text: text),
                spoken(line.secondary, isPrimary: false, text: text),
            ])
        }
    }

    static func requestPinned(
        _ model: AlertsPresenter.RequestModel,
        text: (String) -> String
    ) -> String {
        if let valueText = model.pinned.text {
            return valueText
        }
        return model.pinned.key.map(text) ?? ""
    }

    static func requestLines(
        _ model: AlertsPresenter.RequestModel,
        text: (String) -> String,
        time: (Int64) -> String
    ) -> [String] {
        model.lines.map { line in
            SpokenLabels.lines([
                line.label.flatMap { requestValue($0, text: text, time: time) },
                requestValue(line.value, text: text, time: time),
            ])
        }
    }

    static func tokenIdentity(_ display: TokenDetailDisplay) -> String {
        SpokenLabels.lines([display.displayName, display.tick])
    }

    static func tokenAmount(
        _ display: TokenDetailDisplay,
        showsValue: Bool,
        text: (String) -> String
    ) -> String {
        let amount = showsValue ? display.valueText : display.amountText
        return SpokenLabels.lines([
            display.displayName,
            amount == "••••" ? text(SpokenLabels.hiddenKey) : amount,
        ])
    }

    static func labeled(
        _ label: String,
        value: String,
        localized: Bool,
        text: (String) -> String
    ) -> String {
        SpokenLabels.lines([localized ? text(label) : label, value])
    }

    static func alertRow(_ item: SnapshotInboxItem, time: String) -> String {
        SpokenLabels.lines([item.title, item.body, time])
    }

    static func alertDetail(_ item: SnapshotInboxItem, time: String) -> String {
        SpokenLabels.lines([item.title, AlertsRules.detailBody(item.body), time])
    }

    private static func spoken(
        _ value: BalanceText?,
        isPrimary: Bool,
        text: (String) -> String
    ) -> String? {
        guard let value else {
            return nil
        }
        if isPrimary, value.key == "state.hidden" {
            return text(SpokenLabels.hiddenKey)
        }
        if let valueText = value.text {
            return valueText
        }
        return value.key.map(text)
    }

    private static func requestValue(
        _ value: AlertsPresenter.Value,
        text: (String) -> String,
        time: (Int64) -> String
    ) -> String? {
        if let valueText = value.text {
            return valueText
        }
        if let key = value.key {
            return text(key)
        }
        return value.at.map(time)
    }
}
