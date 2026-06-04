import SwiftUI

// 손그림(크레파스) 테마 전용 형태/질감 유틸.
// 다른 테마는 이 파일의 어떤 것도 사용하지 않으므로 영향이 없다.

// 결정적(deterministic) 해시: 같은 입력이면 항상 같은 값 → 프레임마다 외곽선이 떨리지 않는다.
private func handDrawnHash(_ n: Double) -> Double {
    let x = sin(n) * 43758.5453
    return x - floor(x) // [0, 1)
}

/// 둥근 사각형 경로를 따라 미세하게 흔들리는 손그림 외곽선 Shape.
/// clip(채움)과 stroke(테두리) 양쪽에 쓸 수 있도록 InsettableShape를 채택한다.
struct RoughRoundedRectangle: InsettableShape {
    var cornerRadius: CGFloat
    /// 흔들림 진폭(pt). 클수록 더 거칠게 보인다.
    var roughness: CGFloat = 1.8
    /// 같은 카드라도 다른 모양을 주고 싶을 때 바꾸는 시드.
    var seed: Double = 17
    private var insetAmount: CGFloat = 0

    init(cornerRadius: CGFloat, roughness: CGFloat = 1.8, seed: Double = 17) {
        self.cornerRadius = cornerRadius
        self.roughness = roughness
        self.seed = seed
    }

    func inset(by amount: CGFloat) -> some InsettableShape {
        var copy = self
        copy.insetAmount += amount
        return copy
    }

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: insetAmount, dy: insetAmount)
        guard r.width > 4, r.height > 4 else {
            return Path(roundedRect: r, cornerRadius: cornerRadius)
        }

        let radius = min(cornerRadius, min(r.width, r.height) / 2)
        let anchors = perimeterAnchors(in: r, radius: radius)
        guard anchors.count > 3 else {
            return Path(roundedRect: r, cornerRadius: cornerRadius)
        }

        // 각 앵커를 법선 방향으로 살짝 밀어 흔든다(+ 접선 방향 미세 흔들림).
        var pts: [CGPoint] = []
        pts.reserveCapacity(anchors.count)
        for (i, a) in anchors.enumerated() {
            let jn = (handDrawnHash(Double(i) * 1.7 + seed) - 0.5) * 2 * roughness
            let jt = (handDrawnHash(Double(i) * 3.1 + seed * 2) - 0.5) * roughness
            let tangent = CGVector(dx: -a.normal.dy, dy: a.normal.dx)
            pts.append(CGPoint(
                x: a.point.x + a.normal.dx * jn + tangent.dx * jt,
                y: a.point.y + a.normal.dy * jn + tangent.dy * jt
            ))
        }

        // 중점을 지나고 앵커를 control point로 쓰는 부드러운 닫힌 곡선.
        var path = Path()
        let count = pts.count
        let first = midpoint(pts[count - 1], pts[0])
        path.move(to: first)
        for i in 0..<count {
            let curr = pts[i]
            let next = pts[(i + 1) % count]
            path.addQuadCurve(to: midpoint(curr, next), control: curr)
        }
        path.closeSubpath()
        return path
    }

    private func midpoint(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
        CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
    }

    private struct Anchor {
        let point: CGPoint
        let normal: CGVector // 바깥쪽 단위 법선
    }

    private func perimeterAnchors(in rect: CGRect, radius: CGFloat) -> [Anchor] {
        var out: [Anchor] = []
        let edgeStep: CGFloat = 26 // 직선 구간 샘플 간격
        let arcSteps = 3           // 모서리 구간 샘플 수

        func addEdge(from p0: CGPoint, to p1: CGPoint, normal: CGVector) {
            let len = hypot(p1.x - p0.x, p1.y - p0.y)
            let n = max(1, Int((len / edgeStep).rounded()))
            for k in 0..<n { // 끝점은 다음 모서리 시작과 겹치지 않게 제외
                let t = CGFloat(k) / CGFloat(n)
                out.append(Anchor(
                    point: CGPoint(x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t),
                    normal: normal
                ))
            }
        }

        func addArc(center: CGPoint, start: CGFloat, end: CGFloat) {
            for k in 0...arcSteps {
                let t = CGFloat(k) / CGFloat(arcSteps)
                let ang = start + (end - start) * t
                let nx = cos(ang), ny = sin(ang)
                out.append(Anchor(
                    point: CGPoint(x: center.x + nx * radius, y: center.y + ny * radius),
                    normal: CGVector(dx: nx, dy: ny)
                ))
            }
        }

        let minX = rect.minX, minY = rect.minY, maxX = rect.maxX, maxY = rect.maxY
        let halfPi = CGFloat.pi / 2

        addEdge(from: CGPoint(x: minX + radius, y: minY), to: CGPoint(x: maxX - radius, y: minY), normal: CGVector(dx: 0, dy: -1))
        addArc(center: CGPoint(x: maxX - radius, y: minY + radius), start: -halfPi, end: 0)
        addEdge(from: CGPoint(x: maxX, y: minY + radius), to: CGPoint(x: maxX, y: maxY - radius), normal: CGVector(dx: 1, dy: 0))
        addArc(center: CGPoint(x: maxX - radius, y: maxY - radius), start: 0, end: halfPi)
        addEdge(from: CGPoint(x: maxX - radius, y: maxY), to: CGPoint(x: minX + radius, y: maxY), normal: CGVector(dx: 0, dy: 1))
        addArc(center: CGPoint(x: minX + radius, y: maxY - radius), start: halfPi, end: .pi)
        addEdge(from: CGPoint(x: minX, y: maxY - radius), to: CGPoint(x: minX, y: minY + radius), normal: CGVector(dx: -1, dy: 0))
        addArc(center: CGPoint(x: minX + radius, y: minY + radius), start: .pi, end: .pi + halfPi)

        return out
    }
}

/// 코드만으로 만든 종이 질감. 외부 이미지에 의존하지 않는다.
/// 결정적 배치라 스크롤 중 다시 그려도 동일하게 보인다.
struct PaperTexture: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 9
            let cols = max(1, Int(size.width / step))
            let rows = max(1, Int(size.height / step))
            for row in 0..<rows {
                for col in 0..<cols {
                    let h = handDrawnHash(Double(row) * 91.7 + Double(col) * 13.3)
                    guard h > 0.55 else { continue }
                    let jx = (handDrawnHash(Double(row) * 7.1 + Double(col) * 2.9) - 0.5) * step
                    let jy = (handDrawnHash(Double(row) * 2.3 + Double(col) * 5.7) - 0.5) * step
                    let x = CGFloat(col) * step + step / 2 + jx
                    let y = CGFloat(row) * step + step / 2 + jy
                    let d = 0.7 + handDrawnHash(Double(row) + Double(col) * 0.5) * 0.9
                    let alpha = 0.025 + h * 0.03
                    let rect = CGRect(x: x, y: y, width: d, height: d)
                    context.fill(Path(ellipseIn: rect), with: .color(.black.opacity(alpha)))
                }
            }
        }
        .blendMode(.multiply)
    }
}

extension View {
    /// 크레파스 테마일 때만 화면 위에 아주 옅은 종이 grain을 덧씌운다.
    /// 다른 테마에서는 아무것도 하지 않는다(투명).
    @ViewBuilder
    func paperGrainOverlay() -> some View {
        if FestivalDesign.isHandDrawn {
            overlay(
                PaperTexture()
                    .allowsHitTesting(false)
                    .ignoresSafeArea()
            )
        } else {
            self
        }
    }
}
