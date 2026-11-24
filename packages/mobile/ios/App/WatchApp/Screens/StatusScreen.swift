// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct StatusScreen: View {
    let reachable: Bool
    let balancesAt: Int64?
    let session: String?
    let hideAmounts: Bool
    let appVersion: String
    let onToggleHideAmounts: (Bool) -> Void

    var rows: [StatusRows.Row] {
        StatusRows.rows(
            reachable: reachable,
            balancesAt: balancesAt,
            session: session,
            hideAmounts: hideAmounts,
            appVersion: appVersion
        )
    }

    var body: some View {
        List(rows, id: \.labelKey) { row in
            if case .toggle(let isOn) = row.value {
                Toggle(LocalizedStringKey(row.labelKey), isOn: Binding(get: { isOn }, set: onToggleHideAmounts))
            } else {
                LabeledContent(LocalizedStringKey(row.labelKey), value: text(row.value))
            }
        }
        .navigationTitle(LocalizedStringKey(StatusRows.titleKey))
    }

    func text(_ value: StatusRows.Value) -> String {
        switch value {
        case .flag(let on): return on ? "Yes" : "No"
        case .age(let at): return Date(timeIntervalSince1970: TimeInterval(at) / 1000).formatted(.relative(presentation: .numeric))
        case .none: return "-"
        case .session(let locked): return locked ? "Locked" : "Unlocked"
        case .sessionUnknown: return String(localized: "state.sessionUnknown")
        case .toggle(let on): return on ? "On" : "Off"
        case .text(let string): return string
        }
    }
}
