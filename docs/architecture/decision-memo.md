# 의사결정 메모

## 1. 왜 오버레이 방식은 iOS 실서비스 경로로 부적합한가

외부 내비 앱 위에 UI를 올리거나 다른 앱의 화면을 읽는 구조는 iOS 샌드박스, 개인정보 보호, App Store 심사 기준과 충돌할 가능성이 큽니다. Kakao Navi 또는 다른 내비 앱의 검색 흐름에 주차 정보를 삽입하는 공식 확장 지점도 전제할 수 없습니다. 따라서 오버레이 방식은 실서비스 후보 경로에서 제외합니다.

## 2. 왜 인앱 내비게이션 방식이 이번 프로젝트의 우선 해법인가

인앱 방식은 목적지 검색, 주차 추천, 실시간 정보 표시, 길안내 시작까지 한 흐름으로 묶을 수 있습니다. 주차 데이터의 freshness, 출처, fallback 문구를 앱 안에서 일관되게 제어할 수 있고, 사용자가 외부 앱으로 이동하면서 맥락을 잃는 문제도 줄일 수 있습니다.

## 3. App Intents가 검색 마찰을 어떻게 줄이는가

`목적지 주변 주차 찾기`와 `최근 목적지로 길안내 시작` intent를 제공해 Siri, Spotlight, Shortcuts에서 바로 앱 흐름으로 진입하게 합니다. intent는 시스템 진입점 역할만 담당하고, 실제 검색과 라우팅은 앱의 deep link 처리 및 도메인 서비스가 재사용합니다.

## 4. Share Extension이 주소 전달 마찰을 어떻게 줄이는가

사용자는 Safari, Messages, Maps 등에서 주소, 장소명, URL을 공유해 앱으로 보낼 수 있습니다. Share Extension은 텍스트를 정리해 App Group 저장소에 임시 목적지 후보로 저장하고, 메인 앱을 목적지 확인 화면으로 엽니다.

## 5. 서울 주차 실시간 데이터 연동 방법

서울시 시영주차장 실시간 주차대수 provider와 공영주차장 메타데이터 provider를 분리합니다. 실시간 provider는 가능 대수와 freshness 중심으로 사용하고, 메타데이터 provider는 주소, 운영시간, 요금, 총면수 보강에 사용합니다.

## 6. data.go.kr / 한국교통안전공단 주차 API 연동 방법

한국교통안전공단 provider는 전국 확장을 위한 별도 adapter로 둡니다. 개발/운영 endpoint와 서비스키는 환경 변수로 분리하며, 응답 필드 누락 가능성을 normalization 단계에서 흡수합니다.

## 7. 실시간 데이터 커버리지 한계와 fallback 전략

실시간 가능 대수, 혼잡도, 총면수, 정보 없음 상태를 구분합니다. freshness가 오래된 데이터는 실시간으로 표시하지 않고 `업데이트 지연 가능` 경고를 표시합니다. 오래된 데이터는 ranking confidence도 낮춥니다.

## 8. API 키 보안 모델

민감한 REST 키는 백엔드 환경 변수에만 저장합니다. iOS 앱에는 공개성 설정과 백엔드 URL만 둡니다. 운영 값은 `.env.production` 또는 CI/CD secret store로 주입하고, 저장소에는 example만 둡니다.

## 9. TestFlight 및 App Store 제출을 고려한 구조

앱, App Intents, Share Extension target을 분리합니다. App Group, 위치 권한, 공유 확장, 외부 데이터 출처, 실시간 정보 한계를 문서화합니다. signing placeholder 문서와 배포 체크리스트를 별도로 유지합니다.

## 10. MVP와 실서비스 후보의 차이

실서비스 후보는 mock 화면뿐 아니라 실제 provider 연결 지점, 환경 변수, stale 보호, health endpoint, 운영 문서, 테스트, 배포 점검 스크립트를 포함합니다. API 키만 연결하면 실기기 테스트와 TestFlight 준비로 넘어갈 수 있게 설계합니다.

## 11. 현재 단계에서 반드시 사람이 직접 해야 하는 일

- Kakao Developers 앱 등록과 REST/Native 키 발급
- Kakao Mobility iOS UI SDK 사용 권한과 계약 확인
- 서울 열린데이터광장 인증키 발급
- data.go.kr API 활용 신청과 운영 전환 승인
- Apple Developer Team, bundle id, App Group, signing 설정
