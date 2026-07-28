import type { CitySiteConfig } from "./cityFestivalParsers/types.js";

// 파일럿 사이트 5곳. 각 항목의 selectors/customParser는 2026-07-28에
// 실제 raw HTML을 curl로 받아 확인한 값이다
// (.superpowers/sdd/2026-07-28-city-festival-scraper-plan/task-11-report.md 참고).
// 조사했지만 구조가 맞지 않아 제외한 사이트도 같은 리포트에 사유와 함께 남겼다.
// andong-culture(안동시)는 등록 후 재검토에서 "문화행사" 게시판이 축제만
// 분리할 카테고리 신호가 없어 공연/전시/SNS 발대식 등 비축제 콘텐츠가
// 섞임을 확인, 제외했다 (같은 리포트의 fix round 섹션 참고).
export const CITY_FESTIVAL_SITES: CitySiteConfig[] = [
  {
    siteId: "sunchang-sftf",
    cityName: "순창군",
    listUrl: "https://www.sftf.or.kr/bbs/board.php?bo_table=event",
    fallbackLat: 35.3745,
    fallbackLng: 127.1379,
    robotsCheckedAt: "2026-07-28",
    selectors: {
      itemSelector: "li.gall_li",
      titleSelector: "dd strong",
      dateSelector: "dd > ul > li:first-child",
      linkSelector: "a",
      imageSelector: "dt img"
    }
  },
  {
    siteId: "pyeongtaek-pccf",
    cityName: "평택시",
    listUrl: "https://www.pccf.or.kr/festival/festivalList.do",
    fallbackLat: 36.9921075,
    fallbackLng: 127.1129451,
    robotsCheckedAt: "2026-07-28",
    selectors: {
      itemSelector: ".ds-poster-card",
      titleSelector: ".ds-poster-card__title",
      dateSelector: ".ds-poster-card__meta > span:first-child",
      linkSelector: "a",
      imageSelector: ".ds-poster-card__thumb img"
    }
  },
  {
    siteId: "gyeongsan-gsctf",
    cityName: "경산시",
    listUrl: "https://gsctf.or.kr/user/festival/festival",
    fallbackLat: 35.8251,
    fallbackLng: 128.7413,
    robotsCheckedAt: "2026-07-28",
    selectors: {
      itemSelector: ".bbsGallery > li",
      titleSelector: ".tit",
      dateSelector: ".in_item.time .val",
      // 실제 링크는 href가 없는 javascript:void(0) onclick 네비게이션이라
      // a[href^='http']는 항상 매칭되지 않고 listUrl로 폴백된다.
      linkSelector: "a[href^='http']",
      imageSelector: ".img_area img"
    }
  },
  {
    siteId: "tongyeong-utour",
    cityName: "통영시",
    listUrl: "https://www.utour.go.kr/00056/00060/00090.web",
    fallbackLat: 34.8544,
    fallbackLng: 128.4331,
    robotsCheckedAt: "2026-07-28",
    customParser: "tongyeong-utour"
  },
  {
    siteId: "jeongseon-arirang",
    cityName: "정선군",
    listUrl: "https://arirangfestival.kr/bbs/board.php?bo_table=2_2",
    fallbackLat: 37.3806,
    fallbackLng: 128.6608,
    robotsCheckedAt: "2026-07-28",
    customParser: "jeongseon-arirang"
  }
];
