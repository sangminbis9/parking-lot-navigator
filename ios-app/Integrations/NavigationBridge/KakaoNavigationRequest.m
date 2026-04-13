#import "KakaoNavigationRequest.h"

@implementation KakaoNavigationRequest

- (instancetype)initWithDestinationName:(NSString *)destinationName
                         destinationLat:(double)destinationLat
                         destinationLng:(double)destinationLng {
  self = [super init];
  if (self) {
    _destinationName = [destinationName copy];
    _destinationLat = destinationLat;
    _destinationLng = destinationLng;
  }
  return self;
}

@end
