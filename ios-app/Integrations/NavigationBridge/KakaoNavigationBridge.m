#import "KakaoNavigationBridge.h"

@implementation KakaoNavigationBridge

- (BOOL)isSDKAvailable {
  // TODO(실연동): Kakao Mobility iOS UI SDK framework 추가 후 실제 class 이름으로 교체합니다.
  return NSClassFromString(@"KNRouteGuideViewController") != nil ||
         NSClassFromString(@"KakaoNavi.KNRouteGuideViewController") != nil;
}

- (void)startNavigationWithRequest:(KakaoNavigationRequest *)request {
  if (![self isSDKAvailable]) {
    NSLog(@"Kakao Mobility SDK가 없어 bridge 호출을 건너뜁니다: %@", request.destinationName);
    return;
  }

  // TODO(실연동): SDK 초기화, 목적지 좌표 전달, route guide view controller 표시를 연결합니다.
  NSLog(@"Kakao Mobility 인앱 길안내 시작 요청: %@ (%f,%f)",
        request.destinationName,
        request.destinationLat,
        request.destinationLng);
}

@end
