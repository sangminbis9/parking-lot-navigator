# 운영자 장애 대응 메모

## 검색 API 실패

1. `KAKAO_REST_API_KEY`가 설정되어 있는지 확인합니다.
2. Kakao Developers 쿼터와 앱 설정을 확인합니다.
3. mock provider로 전환해 앱 흐름이 유지되는지 확인합니다.

## 주차 데이터가 모두 `정보 없음`으로 표시됨

1. `/parking/providers/health`에서 서울/data.go.kr provider 상태를 확인합니다.
2. 인증키 만료, quota 초과, 응답 스키마 변경 여부를 확인합니다.
3. stale threshold가 지나치게 짧지 않은지 확인합니다.

## Kakao Navigation SDK 초기화 실패

1. SDK framework가 target에 포함되었는지 확인합니다.
2. Native App Key와 bundle id 등록 상태를 확인합니다.
3. 앱은 `MockNavigationService` fallback으로 사용자에게 안내 메시지를 표시해야 합니다.
