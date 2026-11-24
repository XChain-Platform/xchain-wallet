import SwiftUI
import WidgetKit

struct Complications: Widget {
    static let kind = "XChainComplications"
    static let rootURL = URL(string: "xchain://balances")
    static let families: [WidgetFamily] = [
        .accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular,
    ]

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: WidgetProvider()) { entry in
            ComplicationView(entry: entry)
                .privacySensitive()
                .widgetURL(Self.rootURL)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("XChain")
        .description("Wallet summary")
        .supportedFamilies(Self.families)
    }
}

struct ComplicationView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content(for: family)
    }

    @ViewBuilder
    func content(for family: WidgetFamily) -> some View {
        switch family {
        case .accessoryCircular, .accessoryCorner:
            ZStack(alignment: .topTrailing) {
                Image(systemName: "wallet.pass.fill")
                    .font(.title2)
                if let badgeText {
                    Text(badgeText)
                        .font(.caption2.bold())
                        .padding(2)
                        .background(.red, in: Capsule())
                }
            }
        case .accessoryInline:
            Label(headlineText, systemImage: "wallet.pass.fill")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(headlineText).font(.headline)
                if let ageText {
                    Text(ageText).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    var badgeText: String? {
        switch entry.badge {
        case .request: return "!"
        case .unread(let count): return count > 99 ? "99+" : String(count)
        case .none: return nil
        }
    }

    var headlineText: String {
        switch entry.headline {
        case .total(let text): return text
        case .alerts(let count):
            return "\(count) \(NSLocalizedString("g1.alerts", comment: ""))"
        }
    }

    var ageText: String? {
        guard let age = entry.age else { return nil }
        return RelativeTimeText.fill(NSLocalizedString(age.key, comment: ""), n: age.n)
    }
}
