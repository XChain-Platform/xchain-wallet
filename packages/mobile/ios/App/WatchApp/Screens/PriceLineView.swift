import Charts
import SwiftUI

struct PriceLineView: View {
    let chart: DetailChart

    var body: some View {
        if let xDomain = PriceLineScale.xDomain(count: chart.points.count),
           let yDomain = PriceLineScale.yDomain(chart.points) {
            Chart(Array(chart.points.enumerated()), id: \.offset) { index, point in
                LineMark(
                    x: .value("Index", index),
                    y: .value("Price", point)
                )
                .foregroundStyle(lineColor)
            }
            .chartXScale(domain: xDomain)
            .chartYScale(domain: yDomain)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
        }
    }

    private var lineColor: Color {
        PriceLineScale.tone(up: chart.up) == .gain ? .green : .red
    }
}
