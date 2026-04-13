#import <Foundation/Foundation.h>
#import "KakaoNavigationRequest.h"

NS_ASSUME_NONNULL_BEGIN

@interface KakaoNavigationBridge : NSObject

- (BOOL)isSDKAvailable;
- (void)startNavigationWithRequest:(KakaoNavigationRequest *)request;

@end

NS_ASSUME_NONNULL_END
