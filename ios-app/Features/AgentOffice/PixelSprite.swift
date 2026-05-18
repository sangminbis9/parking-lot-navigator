import SwiftUI

/// Renders one frame from a 7-column × 3-row, 16×32-per-frame sprite sheet.
/// Sheets come from `harishkotra/agent-office` (MIT licensed).
struct PixelSprite: View {
    enum Direction { case down, up, left, right }

    let sheet: String
    let direction: Direction
    let walking: Bool
    let walkPhase: Int   // 0..2 cycling frame index
    let scale: CGFloat

    private let cols = 7
    private let rows = 3
    private let frameW: CGFloat = 16
    private let frameH: CGFloat = 32

    private var row: Int {
        switch direction {
        case .down: return 0
        case .up: return 1
        case .right, .left: return 2
        }
    }

    private var flipX: Bool {
        direction == .left
    }

    private var col: Int {
        walking ? max(0, min(2, walkPhase)) : 1
    }

    var body: some View {
        let sheetW = CGFloat(cols) * frameW
        let sheetH = CGFloat(rows) * frameH
        let dx = -CGFloat(col) * frameW * scale
        let dy = -CGFloat(row) * frameH * scale

        ZStack(alignment: .topLeading) {
            Image(sheet)
                .resizable()
                .interpolation(.none)
                .frame(width: sheetW * scale, height: sheetH * scale)
                .offset(x: dx, y: dy)
        }
        .frame(width: frameW * scale, height: frameH * scale, alignment: .topLeading)
        .clipped()
        .scaleEffect(x: flipX ? -1 : 1, y: 1, anchor: .center)
    }
}

extension PixelSprite {
    /// Convenience: pick a direction from a movement vector (dx, dy) in normalized space.
    static func direction(from delta: CGPoint) -> Direction {
        if abs(delta.x) > abs(delta.y) {
            return delta.x >= 0 ? .right : .left
        } else {
            return delta.y >= 0 ? .down : .up
        }
    }
}
