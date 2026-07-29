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
  })),
  // wave 3: 충청북도 11개 시/군. tour.chungbuk.go.kr의 "연간축제일정"
  // 게시판 표 하나에 11개 시/군이 모두 함께 노출되고(searchCtgry 파라미터는
  // 응답에 영향을 주지 않아 붙이지 않음 — 2026-07-29 실측), 표의
  // 기초자치단체명 컬럼으로 시/군을 가른다. 마크업이 동일하므로
  // chungbuk-tour custom parser 하나를 공유한다.
  // robots.txt는 404(제한 선언 없음)로 확인했다. 2026-07-29 실측.
  ...[
    { siteId: "chungbuk-tour-cheongju", cityName: "청주시", lat: 36.6424, lng: 127.489 },
    { siteId: "chungbuk-tour-chungju", cityName: "충주시", lat: 36.991, lng: 127.9259 },
    { siteId: "chungbuk-tour-jecheon", cityName: "제천시", lat: 37.1326, lng: 128.191 },
    { siteId: "chungbuk-tour-boeun", cityName: "보은군", lat: 36.4894, lng: 127.7295 },
    { siteId: "chungbuk-tour-okcheon", cityName: "옥천군", lat: 36.3062, lng: 127.5713 },
    { siteId: "chungbuk-tour-yeongdong", cityName: "영동군", lat: 36.175, lng: 127.7764 },
    { siteId: "chungbuk-tour-jeungpyeong", cityName: "증평군", lat: 36.7852, lng: 127.5811 },
    { siteId: "chungbuk-tour-jincheon", cityName: "진천군", lat: 36.8551, lng: 127.4355 },
    { siteId: "chungbuk-tour-goesan", cityName: "괴산군", lat: 36.8154, lng: 127.7872 },
    { siteId: "chungbuk-tour-eumseong", cityName: "음성군", lat: 36.9401, lng: 127.6902 },
    { siteId: "chungbuk-tour-danyang", cityName: "단양군", lat: 36.9845, lng: 128.3656 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: "https://tour.chungbuk.go.kr/www/selectBbsNttList.do?bbsNo=10&key=80",
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-29",
    customParser: "chungbuk-tour"
  })),
  // wave 4(경상북도) 시도: tour.gb.go.kr의 WAF가 Cloudflare Workers egress IP
  // 대역을 "Web firewall security policy" 위반으로 전면 차단해서(GET으로 메인
  // 페이지 접근조차 404 차단, Referer/UA를 바꿔도 무관 — 2026-07-29 wrangler dev
  // --remote로 직접 확인) 이 사이트를 데이터 소스로 쓸 수 없다. 헤더 우회는
  // 시도하지 않기로 하고 site 등록은 넣지 않았다. 파서(gyeongbukTour.ts)와
  // POST fetch/lat-lng passthrough 프레임워크 확장은 남겨뒀다 — 다른 방식으로
  // 접근 가능해지거나 대체 데이터 소스가 생기면 재사용할 수 있다.
  //
  // wave 5(경상북도, 시/군 개별 사이트): 공유 포털이 막힌 뒤 21개 시/군을
  // 각자 사이트로 재조사했다(2026-07-29). 시/군 사이트 대부분은 목록
  // 페이지가 없거나(안동/영천/칠곡/성주/청도/의성/울진/울릉/봉화/예천),
  // robots.txt가 전면 Disallow이거나(구미/영양), tour.gb.go.kr와 같은 WAF
  // 차단 시그니처("Web firewall security policy" 위반, HTTP 404)를
  // 보이거나(문경/청송) 해서 5곳만 등록한다. 2곳은 이번 웨이브에서 보류:
  // - 영주(tour.yeongju.go.kr): 이전 리포트는 POST JSON({"rows":[...]})
  //   구조를 확인했다고 했지만, 이번 통합 작업 중 재검증 curl이 TCP connect
  //   단계에서 전부 타임아웃돼(포트 443 연결 자체가 안 됨) 필드명을 다시
  //   확인하지 못했다. 확인 안 된 필드명으로 파서를 추측해 쓰지 않기로 하고
  //   등록을 보류한다. wrangler dev --remote로 Workers 쪽에서 재확인되면
  //   추가할 수 있다.
  // - 고령(grta.co.kr): 목록 페이지에 날짜가 잘려 나와 상세 페이지를 한 번
  //   더 불러야 하는데, customParser는 동기 함수라 추가 fetch를 할 수 없다
  //   (프레임워크 한계). grta.co.kr 인증서가 만료된 자체서명 인증서인 문제도
  //   겹쳐 있어, 프레임워크를 확장하기보다 이번 웨이브에서는 건너뛴다.
  ...[
    {
      siteId: "gyeongju-tour",
      cityName: "경주시",
      listUrl: "https://www.gyeongju.go.kr/tour/page.do?mnu_uid=2393&listType=list",
      lat: 35.8562,
      lng: 129.2247,
      customParser: "gyeongju-tour"
    },
    {
      siteId: "pohang-phcf",
      cityName: "포항시",
      listUrl:
        "https://www.phcf.or.kr/api/template/festival/getList.do?PRJ_ID=phcf&FESTIVAL_SORT=date&LIMIT=200&PAGE=1&OFFSET=0",
      lat: 36.019,
      lng: 129.3435,
      customParser: "pohang-tour"
    },
    {
      siteId: "sangju-tour",
      cityName: "상주시",
      listUrl: "https://www.sangju.go.kr/life/page/10452/10182.tc",
      lat: 36.4109,
      lng: 128.159,
      customParser: "sangju-tour"
    }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: entry.listUrl,
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-29",
    customParser: entry.customParser
  })),
  // 김천(gc.go.kr)은 목록이 date=YYYY-MM-DD 쿼리 파라미터로 월 단위
  // 페이지네이션되고, CitySiteConfig는 정적 문자열이라 "오늘"을 계산해
  // 넣을 방법이 없다. date 파라미터를 아예 생략하면 서버가 요청 시점의
  // "이번 달"로 기본 동작하므로(2026-07-29 실측: date 없이 요청하면
  // "진행중인 행사가 없습니다" — 당시 7월에 행사가 없었을 뿐, date=2026-10-01로
  // 요청하면 같은 셀렉터로 정상 노출됨을 확인), 다른 게시판형 파일럿
  // 사이트처럼 "그 시점에 걸린 것만" 최선형으로 수집하는 쪽을 택했다.
  // 페이지가 PC/모바일용으로 같은 dl을 두 번 렌더링하지만, 제목+시작일이
  // 같으면 같은 city_festival id로 upsert되므로 중복 행은 생기지 않는다.
  {
    siteId: "gimcheon-culture",
    cityName: "김천시",
    listUrl: "https://www.gc.go.kr/culture/cultureList.do?mId=0205000000",
    fallbackLat: 36.1398,
    fallbackLng: 128.1135,
    robotsCheckedAt: "2026-07-29",
    selectors: {
      itemSelector: "div.list dl",
      titleSelector: "dd p.title",
      dateSelector: "dd > ul > li:first-child",
      linkSelector: "dt a",
      imageSelector: "dt img"
    }
  },
  // 영덕(ydstay.kr)은 tour.yd.go.kr가 없어지고 이 사이트로 이전된 걸
  // 이번에 확인했다(구 URL은 리다이렉트만 함). 축제 카테고리(category=F)
  // 목록이 셀렉터만으로 충분해 custom parser 없이 등록한다.
  {
    siteId: "yeongdeok-stay",
    cityName: "영덕군",
    listUrl: "https://ydstay.kr/stayEvent?category=F&category2=%EC%98%81%EB%8D%95",
    fallbackLat: 36.4151,
    fallbackLng: 129.3655,
    robotsCheckedAt: "2026-07-29",
    selectors: {
      itemSelector: "ul#list li",
      titleSelector: "p.tit",
      dateSelector: "div.gfe_cont > p:nth-child(2)",
      linkSelector: "a",
      imageSelector: "img"
    }
  }
];
