import UIKit

enum MapPinBitmap {
    // Kakao's image decoder throws a C++ exception for unsupported pixel formats.
    // Normalize at the SDK boundary, including HDR photos and grayscale symbols.
    static func normalized(_ image: UIImage) -> UIImage? {
        let width = image.size.width * image.scale
        let height = image.size.height * image.scale
        guard width.isFinite, height.isFinite, width >= 1, height >= 1,
              width <= 4096, height <= 4096,
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: nil, width: Int(width.rounded(.up)), height: Int(height.rounded(.up)),
                bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
              ) else { return nil }
        context.translateBy(x: 0, y: CGFloat(context.height))
        context.scaleBy(x: image.scale, y: -image.scale)
        UIGraphicsPushContext(context)
        image.draw(in: CGRect(origin: .zero, size: image.size))
        UIGraphicsPopContext()
        guard let bitmap = context.makeImage() else { return nil }
        return UIImage(cgImage: bitmap, scale: image.scale, orientation: .up)
    }
}
