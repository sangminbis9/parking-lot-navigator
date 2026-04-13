# Provider Health Dashboard 설명

현재 구현은 `/parking/providers/health` JSON 응답을 운영 대시보드의 최소 단위로 사용합니다.

확인 항목:

- provider 이름
- 상태: `up`, `degraded`, `down`
- 마지막 성공 시각
- 마지막 오류 메시지
- 응답 품질 점수
- stale 여부

운영 대시보드 1차 버전은 이 endpoint를 주기적으로 호출해 provider별 상태를 표로 보여주면 됩니다.
