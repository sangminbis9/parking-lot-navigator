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
  // 김천(gc.go.kr)은 샌드박스 curl에서는 200으로 정상 응답하지만, 실제 배포
  // 후 Workers egress IP에서는 동일 URL이 404로 차단된다(2026-07-29
  // wrangler tail로 확인: "city festival site fetch failed: 404"). 이전에
  // tour.gb.go.kr/문경/청송에서 확인한 것과 같은 Workers egress IP 대역
  // 차단 패턴으로 보고, 우회 시도 없이 이번 wave에서 제외한다.
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
  },
  // wave 6(전라남도, 시/군 개별 사이트): 22개 시/군을 3개 그룹으로 나눠
  // 조사했다(2026-07-30). 21곳은 게시판 구조 부재(고정 메뉴형 정적
  // 소개 페이지만 존재), robots.txt Disallow, WAF/타임아웃 차단, 날짜에
  // 연도·일자가 없는 텍스트, SSL 인증서 체인 결함 등으로 제외했다. 완도군
  // (wando.go.kr, tempEventList JS 변수)은 구조상 등록 가능해 보였지만,
  // 통합 작업 중 재확인한 결과 데이터가 2025-08~2025-10 구간에서 멈춰
  // 있어(오늘 기준 전부 과거 날짜) 정적으로 방치된 페이지로 판단, 등록하지
  // 않는다. 순천시(suncheon.go.kr)만 등록한다 — eventV3/list.do가 JSON을
  // 반환하고 2026년 데이터가 정상적으로 갱신되고 있음을 확인했다.
  {
    siteId: "suncheon-tour",
    cityName: "순천시",
    listUrl:
      "https://www.suncheon.go.kr/kr/main/city/eventV3/list.do?mode=data&boardId=bbs_0000000000011687&nowPage=1",
    fallbackLat: 34.950637,
    fallbackLng: 127.4872135,
    robotsCheckedAt: "2026-07-30",
    customParser: "suncheon-tour"
  },
  // wave 7(경상남도, 공유 포털): 17개 시/군(통영시는 파일럿에서 이미 등록)을
  // 3개 그룹으로 나눠 조사했다(2026-07-30). 시/군 자체 사이트는 대부분 축제별
  // 고정 CMS 페이지만 있거나(하동/산청/함양/거창/합천/진주/사천/김해),
  // robots.txt가 전면 Disallow이거나(산청 newtour, 도 관광포털
  // tour.gyeongnam.go.kr, 거제/창원 문화재단), DNS 실패(창원
  // culture.changwon.go.kr)이거나, 달력 그리드 구조라 반복 게시판으로 표현할
  // 수 없어서(거제 tour.geoje.go.kr) 등록하지 못했다. 대신 경상남도 공식
  // "경남축제다모아" 포털(festa.gyeongnam.go.kr)이 sigunguCode 파라미터로
  // 16개 시/군을 정확히 갈라 서버사이드 HTML로 제공해(robots.txt는 /ksis만
  // 차단, 2026-07-30 curl 확인) 여기서 등록한다. 마크업이 동일하므로 custom
  // parser 없이 declarative selector를 공유한다. itemSelector는
  // ".srh_list li.festa__end"가 아니라 ".srh_list li"를 쓴다 — 실측 결과
  // festa__end 클래스는 목록의 첫 항목에만 붙고 이후 항목엔 클래스가 없어서
  // 클래스 기반 셀렉터를 쓰면 첫 항목만 잡힌다. 페이지당 12건 고정이라 12건을
  // 넘는 시/군은 nowPage=2 항목을 추가로 등록해 커버리지를 넓혔다(고성군은
  // 40건 중 24건까지만 커버 — 전량을 원하면 nowPage 3/4 항목을 추가할 수
  // 있다). 합천군(sigunguCode=48890)은 자체 사이트·포털 모두 오늘
  // (2026-07-30) 기준 미래 날짜 데이터가 0건이라 제외했다(자체 게시판은
  // "매년 4월 첫째주" 류 연도 없는 날짜이거나 2025년 이후 갱신되지 않음).
  ...[
    { siteId: "gyeongnam-changwon", cityName: "창원시", code: "48120", pages: [1, 2], lat: 35.2278577, lng: 128.6818148 },
    { siteId: "gyeongnam-jinju", cityName: "진주시", code: "48170", pages: [1], lat: 35.1802165, lng: 128.1077384 },
    { siteId: "gyeongnam-sacheon", cityName: "사천시", code: "48240", pages: [1, 2], lat: 35.0036334, lng: 128.0645331 },
    { siteId: "gyeongnam-gimhae", cityName: "김해시", code: "48250", pages: [1, 2], lat: 35.2285673, lng: 128.8893172 },
    { siteId: "gyeongnam-miryang", cityName: "밀양시", code: "48270", pages: [1, 2], lat: 35.5036457, lng: 128.7460822 },
    { siteId: "gyeongnam-geoje", cityName: "거제시", code: "48310", pages: [1], lat: 34.880481, lng: 128.6212633 },
    { siteId: "gyeongnam-yangsan", cityName: "양산시", code: "48330", pages: [1, 2], lat: 35.335, lng: 129.0355 },
    { siteId: "gyeongnam-uiryeong", cityName: "의령군", code: "48720", pages: [1, 2], lat: 35.3221, lng: 128.2615 },
    { siteId: "gyeongnam-haman", cityName: "함안군", code: "48730", pages: [1], lat: 35.2725, lng: 128.4065 },
    { siteId: "gyeongnam-changnyeong", cityName: "창녕군", code: "48740", pages: [1], lat: 35.5446, lng: 128.4922 },
    { siteId: "gyeongnam-goseong", cityName: "고성군", code: "48820", pages: [1, 2], lat: 34.973, lng: 128.3222 },
    { siteId: "gyeongnam-namhae", cityName: "남해군", code: "48840", pages: [1], lat: 34.8375, lng: 127.8923 },
    { siteId: "gyeongnam-hadong", cityName: "하동군", code: "48850", pages: [1], lat: 35.0673125, lng: 127.7513132 },
    { siteId: "gyeongnam-sancheong", cityName: "산청군", code: "48860", pages: [1], lat: 35.4155607, lng: 127.8734727 },
    { siteId: "gyeongnam-hamyang", cityName: "함양군", code: "48870", pages: [1], lat: 35.5205424, lng: 127.7251841 },
    { siteId: "gyeongnam-geochang", cityName: "거창군", code: "48880", pages: [1], lat: 35.6860981, lng: 127.9096955 }
  ].flatMap<CitySiteConfig>((entry) =>
    entry.pages.map((page) => ({
      siteId: page === 1 ? entry.siteId : `${entry.siteId}-p${page}`,
      cityName: entry.cityName,
      listUrl: `https://festa.gyeongnam.go.kr/index.do?menuCode=001_019001000000&sigunguCode=${entry.code}&nowPage=${page}`,
      fallbackLat: entry.lat,
      fallbackLng: entry.lng,
      robotsCheckedAt: "2026-07-30",
      selectors: {
        itemSelector: ".srh_list li",
        titleSelector: ".srh_list_info strong.ellipsis",
        dateSelector: ".srh_list_info p",
        linkSelector: "a",
        imageSelector: ".imgbnr img"
      }
    }))
  ),

  // wave 8(전라북도): 14개 시/군 중 순창군은 파일럿에서 이미 sunchang-sftf로
  // 등록돼 있어 제외하고 13개를 등록한다(2026-07-30, 3개 그룹 조사). 개별
  // 시/군 사이트는 대부분 전면 robots Disallow(남원 namwon.go.kr), 축제별
  // 고정 CMS 페이지만 있거나(김제/완주), 달력 그리드 구조라 반복 게시판으로
  // 표현할 수 없거나(남원 namwontour.kr), 목록에 날짜가 없어서(진안) 등록하지
  // 못했다. 대신 전북투어(tour.jb.go.kr) 축제 목록을 쓴다.
  // /travel/info/list.do?category_top_id=c&menuCd=DOM_000000110001000000&
  // contentsSid=22&sigun_cd_arr=<코드>는 실제로 서버사이드에서 시/군별로
  // 걸러진다(2026-07-30 curl 재검증: jsessionid 정규화 후 코드별 diff에서
  // "총 N건" 카운트와 항목 자체가 다름 확인 — 무주 11건/장수 7건/전주 26건 등).
  // 그래서 chungnam-tour와 같은 패턴으로 시/군마다 listUrl을 따로 두고
  // jbTour.ts 커스텀 파서 하나를 공유한다.
  // robots.txt는 /iam, /board/list.do, /board/view.do, 특정 menuCd,
  // /searchMain.do, /dwr/만 차단하고(User-agent: *) /travel/info/list.do는
  // 막지 않는다(2026-07-30 curl 확인). 날짜가 "2026.09.04~09.12"처럼 종료일에
  // 연도·월이 생략돼 있어 declarative selector로 표현할 수 없다.
  ...[
    { siteId: "jeonbuk-jeonju", cityName: "전주시", code: "001001", lat: 35.8241462, lng: 127.1481096 },
    { siteId: "jeonbuk-gunsan", cityName: "군산시", code: "001002", lat: 35.9676041, lng: 126.7368816 },
    { siteId: "jeonbuk-iksan", cityName: "익산시", code: "001003", lat: 35.9485758, lng: 126.9576788 },
    { siteId: "jeonbuk-jeongeup", cityName: "정읍시", code: "001004", lat: 35.5699210, lng: 126.8560106 },
    { siteId: "jeonbuk-namwon", cityName: "남원시", code: "001005", lat: 35.4164, lng: 127.3908 },
    { siteId: "jeonbuk-gimje", cityName: "김제시", code: "001006", lat: 35.8038, lng: 126.8809 },
    { siteId: "jeonbuk-wanju", cityName: "완주군", code: "001007", lat: 35.9046, lng: 127.1623 },
    { siteId: "jeonbuk-jinan", cityName: "진안군", code: "001008", lat: 35.7917, lng: 127.4248 },
    { siteId: "jeonbuk-muju", cityName: "무주군", code: "001009", lat: 36.0068, lng: 127.6608 },
    { siteId: "jeonbuk-jangsu", cityName: "장수군", code: "001010", lat: 35.6473, lng: 127.5212 },
    { siteId: "jeonbuk-imsil", cityName: "임실군", code: "001011", lat: 35.6178, lng: 127.2892 },
    { siteId: "jeonbuk-gochang", cityName: "고창군", code: "001013", lat: 35.4356, lng: 126.7020 },
    { siteId: "jeonbuk-buan", cityName: "부안군", code: "001014", lat: 35.7318, lng: 126.7334 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: `https://tour.jb.go.kr/travel/info/list.do?category_top_id=c&menuCd=DOM_000000110001000000&contentsSid=22&sigun_cd_arr=${entry.code}`,
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-30",
    customParser: "jb-tour"
  }))
];
