import Foundation
import WidgetKit

struct WidgetEntry: TimelineEntry {
    let date: Date
    let badge: ComplicationContent.Badge
    let headline: ComplicationContent.Headline
    let age: WidgetFrames.Age?
    let relevance: TimelineEntryRelevance?
}

struct WidgetProvider: TimelineProvider {
    typealias Reader = () -> WidgetSummaryContent?

    private let read: Reader
    private let now: () -> Date

    init(
        directory: URL? = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: WidgetSummary.appGroup
        ),
        read: Reader? = nil,
        now: @escaping () -> Date = Date.init
    ) {
        let file = directory.map(WidgetSummaryFile.init(directory:))
        self.read = read ?? { file?.read() }
        self.now = now
    }

    func placeholder(in context: Context) -> WidgetEntry {
        entries().first!
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        completion(entries().first!)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        completion(timeline())
    }

    func timeline() -> Timeline<WidgetEntry> {
        Timeline(entries: entries(), policy: .atEnd)
    }

    private func entries() -> [WidgetEntry] {
        let date = now()
        let milliseconds = Int64(date.timeIntervalSince1970 * 1_000)
        let summary = read() ?? WidgetSummaryContent(
            unreadCount: 0, requestWaiting: false, totalText: nil, balancesAt: nil
        )
        return WidgetFrames.frames(summary: summary, now: milliseconds).map { frame in
            WidgetEntry(
                date: Date(timeIntervalSince1970: TimeInterval(frame.at) / 1_000),
                badge: frame.badge,
                headline: frame.headline,
                age: frame.age,
                relevance: TimelineEntryRelevance(score: frame.relevance)
            )
        }
    }
}
