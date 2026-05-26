# TestFlight 배포 전 체크리스트

- [ ] 백엔드 `pnpm test` 통과
- [ ] 백엔드 `pnpm preflight` 통과
- [ ] 실제 provider health 확인
- [ ] iOS Debug/Release 빌드 통과
- [ ] 실제 기기에서 검색 → 결과 → 상세 → 길안내 흐름 확인
- [ ] App Intents 실행 확인
- [ ] Share Extension 텍스트/URL 수신 확인
- [ ] App Group 저장소 전달 확인 (main app ↔ Share Extension ↔ Widget Extension)
- [ ] 캘린더 탭 dot 표시 + 일별 상세 시트 동작 확인
- [ ] 필터 시트 적용 시 캘린더와 위젯이 같은 결과로 동기화
- [ ] 홈 화면에 Medium `UpcomingFestivalsWidget` 추가 시 다가오는 축제 3개 카드 표시
- [ ] 위젯 빈 상태(90일 매칭 없음) 문구 노출 확인
- [ ] 위치 권한 문구 확인
- [ ] Kakao Mobility SDK fallback 확인
- [ ] 개인정보 처리방침 URL 준비
