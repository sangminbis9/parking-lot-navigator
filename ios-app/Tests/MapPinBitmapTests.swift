import XCTest
import UIKit
@testable import ParkingLotNavigator

final class MapPinBitmapTests: XCTestCase {
    func testExtendedRangeImageBecomesEightBitSRGB() throws {
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.extendedLinearSRGB))
        let context = try XCTUnwrap(CGContext(
            data: nil, width: 24, height: 24, bitsPerComponent: 16, bytesPerRow: 0,
            space: space,
            bitmapInfo: CGBitmapInfo.floatComponents.rawValue |
                CGBitmapInfo.byteOrder16Little.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.setFillColor(red: 1.5, green: 0.2, blue: 0.3, alpha: 1)
        context.fill(CGRect(x: 4, y: 4, width: 16, height: 16))
        let source = UIImage(cgImage: try XCTUnwrap(context.makeImage()), scale: 2, orientation: .up)
        let normalized = try XCTUnwrap(MapPinBitmap.normalized(source))
        let bitmap = try XCTUnwrap(normalized.cgImage)
        XCTAssertEqual(bitmap.bitsPerComponent, 8)
        XCTAssertEqual(bitmap.bitsPerPixel, 32)
        XCTAssertEqual(bitmap.colorSpace?.name, CGColorSpace.sRGB)
        XCTAssertFalse(bitmap.bitmapInfo.contains(.floatComponents))
        XCTAssertEqual(bitmap.alphaInfo, .premultipliedLast)
        XCTAssertEqual(normalized.size, source.size)
        XCTAssertEqual(normalized.scale, source.scale)
        let png = try XCTUnwrap(normalized.pngData())
        let decoded = try XCTUnwrap(UIImage(data: png)?.cgImage)
        XCTAssertEqual(decoded.bitsPerComponent, 8)
    }

    func testGrayscaleImageBecomesRGB() throws {
        let context = try XCTUnwrap(CGContext(
            data: nil, width: 12, height: 12, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
        ))
        let source = UIImage(cgImage: try XCTUnwrap(context.makeImage()))
        let output = try XCTUnwrap(MapPinBitmap.normalized(source)?.cgImage)
        XCTAssertEqual(output.colorSpace?.model, .rgb)
        XCTAssertEqual(output.bitsPerPixel, 32)
    }

    func testEmptyImageIsRejected() {
        XCTAssertNil(MapPinBitmap.normalized(UIImage()))
    }
}
