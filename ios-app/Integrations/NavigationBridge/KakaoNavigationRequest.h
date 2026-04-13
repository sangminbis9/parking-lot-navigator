#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface KakaoNavigationRequest : NSObject

@property (nonatomic, copy, readonly) NSString *destinationName;
@property (nonatomic, assign, readonly) double destinationLat;
@property (nonatomic, assign, readonly) double destinationLng;

- (instancetype)initWithDestinationName:(NSString *)destinationName
                         destinationLat:(double)destinationLat
                         destinationLng:(double)destinationLng;

@end

NS_ASSUME_NONNULL_END
