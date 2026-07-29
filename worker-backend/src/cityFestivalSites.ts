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
  },
  // wave 2: 충청남도 15개 시/군. 시/군 자체 문화관광 사이트는 대부분 축제를
  // 개별 소개 페이지(view.do)로만 노출하고 날짜가 붙은 목록 페이지가 없거나
  // robots.txt가 User-agent: * 를 전면 Disallow 해서 쓸 수 없었다
  // (.superpowers/sdd/2026-07-29-city-festival-226-expansion-plan/task-7-report.md 참고).
  // 대신 충청남도 공식 관광포털 충남관광(tour.chungnam.go.kr)의 축제/행사 목록이
  // searchRgn 파라미터로 15개 시/군을 정확히 나눠주고, 제목·기간·도로명주소·
  // 상세링크·썸네일을 모두 제공해서 시/군마다 한 항목씩 등록했다.
  // 마크업이 동일하므로 chungnam-tour custom parser 하나를 공유한다.
  // 셀렉터/파라미터는 2026-07-29에 raw HTML을 curl로 받아 확인했다.
  ...[
    { siteId: "chungnam-tour-cheonan", cityName: "천안시", rgn: "01", lat: 36.8151, lng: 127.1139 },
    { siteId: "chungnam-tour-gongju", cityName: "공주시", rgn: "02", lat: 36.4465, lng: 127.119 },
    { siteId: "chungnam-tour-boryeong", cityName: "보령시", rgn: "03", lat: 36.3492, lng: 126.5978 },
    { siteId: "chungnam-tour-asan", cityName: "아산시", rgn: "04", lat: 36.7898, lng: 127.0018 },
    { siteId: "chungnam-tour-seosan", cityName: "서산시", rgn: "05", lat: 36.7848, lng: 126.4503 },
    { siteId: "chungnam-tour-nonsan", cityName: "논산시", rgn: "06", lat: 36.1872, lng: 127.0987 },
    { siteId: "chungnam-tour-gyeryong", cityName: "계룡시", rgn: "07", lat: 36.2745, lng: 127.2486 },
    { siteId: "chungnam-tour-dangjin", cityName: "당진시", rgn: "08", lat: 36.8894, lng: 126.6459 },
    { siteId: "chungnam-tour-geumsan", cityName: "금산군", rgn: "09", lat: 36.1089, lng: 127.488 },
    { siteId: "chungnam-tour-buyeo", cityName: "부여군", rgn: "10", lat: 36.2757, lng: 126.9098 },
    { siteId: "chungnam-tour-seocheon", cityName: "서천군", rgn: "11", lat: 36.0803, lng: 126.6917 },
    { siteId: "chungnam-tour-cheongyang", cityName: "청양군", rgn: "12", lat: 36.4593, lng: 126.802 },
    { siteId: "chungnam-tour-hongseong", cityName: "홍성군", rgn: "13", lat: 36.6015, lng: 126.6608 },
    { siteId: "chungnam-tour-yesan", cityName: "예산군", rgn: "14", lat: 36.6828, lng: 126.8449 },
    { siteId: "chungnam-tour-taean", cityName: "태안군", rgn: "15", lat: 36.7456, lng: 126.298 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: `https://tour.chungnam.go.kr/prog/fstvl/kor/sub02_02_02/list.do?searchRgn=${entry.rgn}&pageUnit=48`,
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-29",
    customParser: "chungnam-tour"
  }))
];
