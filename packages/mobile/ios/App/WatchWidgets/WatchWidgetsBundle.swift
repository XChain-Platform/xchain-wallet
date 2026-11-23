import SwiftUI
import WidgetKit

private struct PlaceholderEntry: TimelineEntry {
    let date: Date
}

private struct PlaceholderProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlaceholderEntry {
        PlaceholderEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (PlaceholderEntry) -> Void) {
        completion(PlaceholderEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlaceholderEntry>) -> Void) {
        completion(Timeline(entries: [PlaceholderEntry(date: Date())], policy: .never))
    }
}

private struct WatchSummaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WatchSummary", provider: PlaceholderProvider()) { _ in
            Text("XChain")
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("XChain")
        .description("Wallet summary")
    }
}

@main
struct WatchWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WatchSummaryWidget()
    }
}
