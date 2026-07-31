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
  })),

  // wave 9(경기도 1차): 31개 시/군 중 평택은 파일럿에서 이미 pyeongtaek-pccf로
  // 등록돼 있어 제외. 이번 wave에서는 구조를 확정한 4곳만 등록하고 나머지는
  // 다음 wave로 넘긴다. 김포시청(gimpo.go.kr)은 robots.txt가
  // User-agent: * / Disallow: /로 일반 크롤러를 전면 차단해(2026-07-30 확인)
  // 우회하지 않고 제외했고, 대신 김포문화재단(gcf.or.kr)을 등록했다.
  // 남양주시청(nyj.go.kr)도 같은 이유(robots.txt 전면 차단)로 제외했으나
  // 아직 대안 사이트를 찾지 못했다. 성남/고양/화성/안산/부천/안양은 목록
  // URL 또는 실제 게시판 구조를 아직 확정하지 못해 이번 wave에서 보류한다.
  //
  // wave 9-2(경기도 2차): 성남/고양/화성/안산/부천/안양 6곳을 조사해 이 중
  // 구조를 확정한 성남/화성 2곳만 등록한다(2026-07-31 실측).
  // - 성남시(seongnam.go.kr) "이달의 행사" 게시판은 축제(srchEvntDtlTypeCd=2)
  //   필터를 걸면 실제 발행 축제만 걸러진다. seongnam-event 커스텀 파서 참고.
  // - 화성시(tour.hscity.go.kr) "축제·행사 일정"은 연 1회 개편되는 정적 표라
  //   hwaseong-tour 커스텀 파서로 연도를 보정해 파싱한다. 기존 hcf.or.kr은
  //   TLS 레벨 차단으로 계속 제외.
  // - 고양시(goyang.go.kr)는 robots.txt가 일부만 차단해 크롤링 자체는
  //   가능하지만(/visitgoyang/www/tourRsrcList.do), 목록 아이템의 날짜/장소
  //   구조를 아직 확인하지 못해 보류.
  // - 안산시(ansan.go.kr)는 robots.txt 전면 허용이지만 문화관광 사이트의
  //   "축제" 메뉴가 목록형 게시판이 아니라 김홍도축제 단일 소개 정적
  //   페이지라 반복 가능한 아이템 구조가 없어 보류.
  // - 부천시(bucheon.go.kr) "동네축제" 게시판은 날짜가 "10월", "매년
  //   9,10월경", "홀수년도 개최"처럼 일/연도 없이 텍스트로만 있어 정확한
  //   시작일·종료일을 만들 수 없다. "주요축제" 탭도 목록형이 아닌 정적
  //   소개 콘텐츠라 보류.
  // - 안양시(anyang.go.kr) "축제/행사 목록"도 개최시기가 "2월(1일간)"처럼
  //   월 단위뿐이라 부천과 같은 이유로 보류.
  {
    siteId: "suwon-culture",
    cityName: "수원시",
    listUrl: "https://www.suwon.go.kr/culture/smartSearchListJson.do?q_groupCd=19&q_ingYn=0&q_currPage=1&q_rowPerPage=50",
    fallbackLat: 37.2636,
    fallbackLng: 127.0286,
    robotsCheckedAt: "2026-07-31",
    customParser: "suwon-tour"
  },
  {
    siteId: "paju-tour",
    cityName: "파주시",
    listUrl: "https://tour.paju.go.kr/user/link/cultural/BD_selectCulturalList.do?q_cultClassCd=1001&q_rowPerPage=200",
    fallbackLat: 37.7599,
    fallbackLng: 126.7802,
    robotsCheckedAt: "2026-07-31",
    customParser: "paju-tour"
  },
  {
    siteId: "yongin-event",
    cityName: "용인시",
    listUrl: "https://www.yongin.go.kr/user/web/eventyt/BD_selectClturEventPfmcytList.do?q_clCode=2",
    fallbackLat: 37.2411,
    fallbackLng: 127.1776,
    robotsCheckedAt: "2026-07-31",
    customParser: "yongin-event"
  },
  {
    siteId: "gimpo-gcf-ing",
    cityName: "김포시",
    listUrl: "https://www.gcf.or.kr/main/exh/list.do?mthd=FEST&state_se=ing",
    fallbackLat: 37.6154,
    fallbackLng: 126.7156,
    robotsCheckedAt: "2026-07-31",
    customParser: "gimpo-gcf"
  },
  {
    siteId: "gimpo-gcf-exp",
    cityName: "김포시",
    listUrl: "https://www.gcf.or.kr/main/exh/list.do?mthd=FEST&state_se=exp",
    fallbackLat: 37.6154,
    fallbackLng: 126.7156,
    robotsCheckedAt: "2026-07-31",
    customParser: "gimpo-gcf"
  },
  {
    siteId: "seongnam-event",
    cityName: "성남시",
    listUrl: "https://www.seongnam.go.kr/tour/tu-pm020101?cntPerPage=100&curPage=1&srchEvntDtlTypeCd=2",
    fallbackLat: 37.4201,
    fallbackLng: 127.1267,
    robotsCheckedAt: "2026-07-31",
    customParser: "seongnam-event"
  },
  {
    siteId: "hwaseong-tour",
    cityName: "화성시",
    listUrl: "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp",
    fallbackLat: 37.1996,
    fallbackLng: 126.8310,
    robotsCheckedAt: "2026-07-31",
    customParser: "hwaseong-tour"
  },

  // wave 9-3(경기도 3차): 의정부/광명/동두천/과천/구리/오산/시흥/군포/의왕/하남/
  // 이천/안성/광주/양주/포천 15곳을 조사해 이 중 구조를 확정한 의정부/하남 2곳만
  // 등록한다(2026-07-31 실측).
  // - 의정부시(ui4u.go.kr) "알림마당 행사목록"은 GET 쿼리스트링으로는 검색
  //   필터가 걸리지 않고(폼이 method="post") POST로 searchType=CATE&
  //   searchTxt=축제를 보내야 분야가 "축제"인 항목만 걸러진다. 상세 링크가
  //   onclick="fn_go_view(idx)" 방식이라 uijeongbu-event 커스텀 파서로
  //   idx를 추출해 view.do URL을 만든다.
  // - 하남시(hanam.go.kr) "문화행사소식" 게시판은 ul.p-media-list li.p-media
  //   구조로 시작일~종료일이 "YYYY-MM-DD ~ YYYY-MM-DD" 한 텍스트에 같이 있어
  //   declarative selector만으로 충분하다(기존 parseCityDateRange가 한 문자열
  //   안의 날짜 2개를 자동으로 시작/종료로 분리).
  // - 광명시(gm.go.kr) "gmFestival" 게시판은 이름과 달리 월별 캘린더 위젯이고
  //   항목 대부분이 주민자치회의·협의체 월례회의 등 행정 일정이라 실제
  //   축제만 걸러낼 카테고리 필터가 없어 제외.
  // - 동두천/의왕/포천은 robots.txt가 대상 경로를 전면 차단해 제외.
  // - 과천은 현재 데이터가 있는 경로가 robots 차단이고, 허용된 대안은 2021년
  //   에 멈춘 아카이브 페이지뿐이라 제외.
  // - 구리는 여러 후보 게시판을 확인했지만 진짜 다건 축제 리스트 구조를
  //   찾지 못해 제외.
  // - 오산은 문화재단 도메인이 robots.txt로 전면 차단돼 있고 대안 경로에는
  //   리스트 구조가 없어 제외.
  // - 군포는 필터링된 게시판에 구조화된 시작일/종료일 필드가 없어 제외.
  // - 이천은 모든 축제가 개별 정적 페이지로 하드코딩돼 있어 반복 가능한
  //   목록 구조가 없어 제외.
  // - 안성은 후보 게시판이 빈 콘텐츠를 반환하고, JS 렌더링 대안은 구조를
  //   확인하지 못해 제외.
  // - 광주(경기)는 축제 3개가 각각 개별 정적 마이크로사이트로만 존재해
  //   제외.
  // - 양주는 축제 3개만 정적 카드로 하드코딩돼 있어 제외했고, 별도 외부
  //   도메인은 아직 조사하지 못해 보류.
  // - 시흥은 robots.txt가 http/https 모두 8회 이상, 최대 25초까지 반복
  //   타임아웃되어 접근 허용 여부를 확인할 수 없다(본문 페이지는 정상
  //   200 응답). 확인 전까지 등록을 보류한다.
  {
    siteId: "uijeongbu-event",
    cityName: "의정부시",
    listUrl: "https://www.ui4u.go.kr/portal/eventNoti/list.do?mId=0301170100",
    fallbackLat: 37.7393,
    fallbackLng: 127.0348,
    robotsCheckedAt: "2026-07-31",
    fetchMethod: "POST",
    fetchBody: "page=1&searchType=CATE&searchTxt=%EC%B6%95%EC%A0%9C",
    customParser: "uijeongbu-event"
  },
  {
    siteId: "hanam-culture",
    cityName: "하남시",
    listUrl: "https://www.hanam.go.kr/www/selectClturEventWebList.do?key=12376",
    fallbackLat: 37.5393,
    fallbackLng: 127.2148,
    robotsCheckedAt: "2026-07-31",
    selectors: {
      itemSelector: "ul.p-media-list li.p-media",
      titleSelector: ".p-media__heading-text",
      dateSelector: ".p-media__heading-date_sbox span.p-maedia_text:nth-of-type(2)",
      linkSelector: "a.p-media__link",
      imageSelector: "img",
      venueSelector: ".p-media__heading-date_sbox span.p-maedia_text:nth-of-type(4)"
    }
  },

  // wave 10(강원특별자치도): 춘천/원주/강릉/동해/태백/속초/삼척/홍천/횡성/영월/
  // 평창/철원/화천/양구/인제/고성/양양 17곳을 조사했다(정선군은 파일럿에서
  // jeongseon-arirang으로 이미 등록됨, 이번 wave 범위 제외). 이 중 구조를
  // 확정한 속초/철원 2곳만 등록한다(2026-07-31 실측).
  // - 속초시(sokchocf.or.kr) "공연·행사·공모" 페이지는 GET으로는 분야
  //   필터가 걸리지 않고(폼이 method="post") POST로 mode=banner&
  //   searchCondition=TYPE&searchKeyword=E 를 보내야 "축제" 분야만 담긴
  //   캐러셀이 반환된다. 상세 링크가 onclick="fncEventDetail(seq, cDate)"
  //   방식이라 sokcho-culture 커스텀 파서로 seq/cDate를 추출해 상세 URL을
  //   만든다. https(443)는 접속이 거부되고 http(80)만 응답해 http listUrl로
  //   등록했다(운영 배포 환경인 Cloudflare Workers에서도 동일하게 동작하는지
  //   재확인 필요 — 로컬 curl 기준 검증).
  // - 철원군은 군 공식 관광포털(cwg.go.kr)에는 리스트 구조가 없고, 철원
  //   문화재단(gcwcf.or.kr) "공연/전시/행사" 게시판이 #event_list(마크업
  //   중복 id 중 class 없는 두 번째 ul)에 진짜 반복 항목(제목/기간/장소/
  //   이미지)을 담고 있어 declarative selector로 등록한다.
  // - 춘천은 홈페이지에 작은 "이벤트" 위젯은 있으나 축제로 필터링되지
  //   않고 단일 날짜 의미가 불명확하며, "더보기"가 같은 URL로 순환돼 더
  //   풍부한 목록 페이지를 찾지 못해 제외.
  // - 원주는 후보 목록에 날짜 필드가 없어 제외.
  // - 강릉은 날짜 표기가 모호(연/월만 있거나 "상시" 등)해 제외.
  // - 동해는 dhfesta.or.kr 루트가 개별 축제 마이크로사이트 2~3개로만
  //   연결될 뿐 통합 목록 페이지가 없어 제외.
  // - 태백은 tour.taebaek.go.kr "태백 대표축제" 페이지가 정적 3개 카드로만
  //   구성되고 날짜가 이미지 alt 텍스트에 다른 정보와 뒤섞여 있어 파싱
  //   불가. 재단 사이트(tbcf.or.kr)에도 별도 축제 목록 nav를 찾지 못해
  //   제외.
  // - 삼척은 삼척관광문화재단(stcf.or.kr)이 4개 축제로 하드코딩된 정적
  //   서브메뉴만 제공하고, 삼척시청 관광포털(samcheok.go.kr/tour.web)
  //   홈페이지 원본 HTML에는 축제/행사 섹션 링크 자체가 없어(JS 메뉴
  //   추정) 제외.
  // - 홍천은 tour.hongcheon.go.kr의 "축제/행사" 메뉴가 외부 도메인
  //   hccf.or.kr(홍천문화재단)로만 연결되는데, hccf.or.kr robots.txt가
  //   `User-agent: *` `Disallow: /`로 전면 차단(Allow는 Googlebot/Yeti/
  //   Daumoa의 Home*만)돼 있어 제외.
  // - 횡성은 횡성문화원(hs-culture.or.kr) 게시판이 "총 3개"뿐인 정적
  //   소개글이고 날짜도 게시일(2021.02.22)만 있어 실제 축제 일정이
  //   아니라 제외.
  // - 영월은 게시판이 실제 다건 축제 목록이 아닌 범용 CMS 게시판이라
  //   제외.
  // - 평창은 tour.pc.go.kr 목록이 front.place.list.js가 채우는 빈
  //   #placeDataList div로, curl로 받은 원본 HTML에는 항목이 전혀
  //   없어(JS/AJAX 렌더링) 제외.
  // - 화천은 tour.ihc.go.kr robots.txt가 `User-agent: *` `Disallow: /`에
  //   `Allow: /tour`만 예외로 둔 구조라 /tour 하위만 접근 가능한데,
  //   실제 "축제나라"(/tour/theme/festival) 페이지가 산천어축제/
  //   토마토축제 2건 정적 카드뿐이고 날짜 필드가 없으며 상세 링크도
  //   `javascript:;` JS 모달이라 제외. 참고로 www.ihc.go.kr(군청 대표
  //   도메인)은 curl 요청 시 헤더 조합을 바꿔도 항상 400 Bad Request를
  //   반환해 확인 불가.
  // - 양구는 robots.txt가 대상 경로를 전면 차단해 제외(이전 조사 결과
  //   유지).
  // - 인제는 injetour.co.kr(인제로컬투어) "festivals" 목록/상세 페이지에
  //   실제 축제 항목은 있으나 날짜가 "매년 10월중"처럼 연도 없는 텍스트라
  //   parseCityDateRange가 요구하는 YYYY-MM-DD 패턴을 추출할 수 없어
  //   제외(tour.inje.go.kr는 Next.js 빈 셸이라 원천 제외).
  // - 고성은 날짜 필드 없는 정적 카드 구조라 제외.
  // - 양양은 tour.yangyang.go.kr가 서핑/송이축제/연어축제/문화제/마을축제/
  //   해맞이 등 주제별 개별 정적 페이지로만 구성돼 있고, 반복 가능한
  //   날짜 목록 게시판을 찾지 못해 제외(마을축제 링크 funfestival.do는
  //   직접 접근 시 에러 페이지 반환).
  {
    siteId: "sokcho-culture",
    cityName: "속초시",
    listUrl: "http://sokchocf.or.kr/sokchocf/event/information",
    fallbackLat: 38.2070,
    fallbackLng: 128.5918,
    robotsCheckedAt: "2026-07-31",
    fetchMethod: "POST",
    fetchBody: "calendarSeq=0&mode=banner&searchKeyword=E&searchCondition=TYPE&prevF=&nextF=&cDate=2026-07-31",
    customParser: "sokcho-culture"
  },
  {
    siteId: "cheorwon-culture",
    cityName: "철원군",
    listUrl: "https://gcwcf.or.kr/w2_1",
    fallbackLat: 38.1467,
    fallbackLng: 127.3132,
    robotsCheckedAt: "2026-07-31",
    selectors: {
      itemSelector: "ul#event_list:not(.ing_wrap) > li",
      titleSelector: "a.txt_subject",
      dateSelector: "li.date p",
      linkSelector: "a.txt_subject",
      imageSelector: "img",
      venueSelector: "li.place p"
    }
  },

  // wave 11(제주특별자치도): 제주는 기초자치단체가 아니라 행정시 2곳(제주시,
  // 서귀포시)뿐이다. 제주도청 통합 포털(jeju.go.kr), 제주관광공사
  // (visitjeju.net), 각 행정시 자체 사이트, 제주문화예술재단(jfac.kr)/
  // 제주인놀다(jejunolda.com)까지 조사했다(2026-07-31 실측). 이 중 구조를
  // 확정한 제주시 1곳만 등록한다.
  // - 제주시(jejusi.go.kr) "문화행사(목록)"(/field/culture/festival/list.do)
  //   페이지는 ul.event_list > li 반복 구조로 제목/기간("YYYY-MM-DD ~
  //   YYYY-MM-DD" 한 필드)/장소/상세링크/이미지가 모두 갖춰져 있어
  //   declarative selector로 충분하다. 실제 fetch한 raw HTML을 cheerio로
  //   파싱해 10건 전부(제23회 방선문축제, 제15회 우도소라축제, 제22회
  //   삼양검은모래 축제 등)가 정확히 추출되는 것을 직접 확인했다.
  //   robots.txt는 `User-agent: * / Disallow: / / Allow: /`로 같은 그룹
  //   안에 폭(width)이 동일한 Disallow와 Allow가 공존하는 모순된 형태인데,
  //   RFC 9309 §2.2.2("길이가 같으면 덜 제한적인 규칙을 따른다")에 따르면
  //   Allow가 우선해 크롤링 허용으로 판단한다. 이는 서귀포시(아래)처럼
  //   `*` 그룹 자체에 Allow 예외가 전혀 없는 명백한 차단과는 구조가 달라
  //   구분해서 처리했다.
  // - 서귀포시는 자체 포털 seogwipo.go.kr(및 서브도메인 없는 bare
  //   도메인)의 robots.txt가 `User-Agent: * / Disallow: / / Disallow:
  //   /notice / Disallow: /workplans`이고, `Allow: /`는 Googlebot/Yeti/
  //   Daumoa 전용 별도 그룹에만 있어 대상 UA는 전체 도메인이 차단된다.
  //   실제 "통합축제 포털"(seogwipo.go.kr/festival/index.htm)과 "축제·
  //   문화행사"(seogwipo.go.kr/tourismculture/culture/schedule1.htm)가
  //   전부 이 차단된 도메인 안에 있어 등록 불가. 서브도메인
  //   culture.seogwipo.go.kr(서귀포시문화예술포털, robots.txt 없음/404라
  //   자체는 크롤링 가능)도 확인했지만 메인 콘텐츠가 서귀포예술의전당·
  //   기당미술관·소암기념관 등의 공연/전시 프로그램 캘린더이고 정작
  //   "축제·문화행사" 링크는 다시 차단된 seogwipo.go.kr로 나가므로
  //   "축제" 신호가 없는 공연장 자체 프로그램 게시판으로 판단해 제외.
  //   tourseogwipo/sgptour/visitseogwipo/seogwipotour 등 대체 도메인은
  //   존재하지 않는다(DNS 미응답).
  // - jeju.go.kr(제주도청 통합 포털)은 robots.txt가 `Disallow: /`에
  //   `/jori/`, `/jejueo/`, `/jedu/` 등 축제와 무관한 몇 개 경로만
  //   Allow 예외로 둬, 문화예술진흥원 등 문화행사 관련 경로
  //   (/jejuculture 등)는 차단 대상이라 제외.
  // - visitjeju.net(제주관광공사)은 robots.txt는 열려 있으나 축제 목록
  //   페이지(/kr/festival/list)가 Nuxt SSR인데 실제 항목 데이터는 서버
  //   렌더 HTML에는 없고 __NUXT_DATA__ 스크립트 안의 devalue 참조 인코딩
  //   JSON payload로만 존재해(raw HTML grep으로 리스트 마크업 0건 확인)
  //   cheerio 기반 declarative/간단 정규식 파서로 처리 불가능하다. 게다가
  //   행정시별 필터(제주시/서귀포시 구분) 파라미터도 확인되지 않아 도
  //   전역 포털이라 "시" 단위 등록과도 맞지 않아 제외.
  // - jfac.kr(제주문화예술재단)·jejunolda.com(제주인놀다, 같은 재단
  //   운영)은 robots.txt가 열려 있지만 두 사이트 모두 제주시/서귀포시를
  //   구분하지 않는 도 전역 문화달력이라 "시" 단위 사이트 등록 기준에
  //   맞지 않아 제외.
  {
    siteId: "jejusi-culture",
    cityName: "제주시",
    listUrl: "https://www.jejusi.go.kr/field/culture/festival/list.do",
    fallbackLat: 33.4996,
    fallbackLng: 126.5312,
    robotsCheckedAt: "2026-07-31",
    selectors: {
      itemSelector: "ul.event_list > li",
      titleSelector: ".event_page_tit",
      dateSelector: "ul.li_sty03 li:nth-of-type(2) div",
      linkSelector: "a",
      imageSelector: "img",
      venueSelector: "ul.li_sty03 li:nth-of-type(1) div"
    }
  },

  // wave 12(서울특별시): 서울은 기초자치단체가 25개 자치구뿐이다. 자치구별
  // 개별 사이트(구청/문화재단)를 하나씩 조사하기 전에, 서울시 통합
  // 문화포털(culture.seoul.go.kr) "문화행사 > 축제" 목록이 자치구별 지역
  // 필터를 실제로 지원하는지부터 확인했다(2026-07-31 실측). 목록 페이지의
  // "지역별" 상세검색 체크박스(name="dist")가 25개 자치구를 법정동 코드
  // (예: 종로구=11110, 강남구=11680)로 정확히 매핑하고 있고, 실제 렌더링을
  // 담당하는 AJAX 엔드포인트(eventList.do)에 searchField=FESTIVAL과
  // searchDist=<법정동코드>를 GET 쿼리스트링으로 붙이면 서버사이드에서 그
  // 자치구 소재 행사만 걸러서 반환한다 — 종로구(11110) 요청은 세종문화회관/
  // 아르코예술극장 등, 강남구(11680) 요청은 코엑스처럼 실제로 다른 장소가
  // 나오는 것을 cheerio로 직접 파싱해 확인했다. 자치구마다 별도 사이트를
  // 찾을 필요 없이 이 포털 하나로 25개 전부가 정확히 커버되므로, 설계
  // 문서의 "통합 포털로 충분하면 그걸로 마친다" 기준에 따라 2단계
  // (자치구 개별 사이트 조사)는 진행하지 않았다.
  // robots.txt는 `User-agent : * / Disallow: / / Allow : /culture/culture/`
  // 구조이고 목록 페이지(list.do)와 AJAX 엔드포인트(eventList.do) 모두
  // `/culture/culture/` 하위 경로라 허용 대상이다. 마크업이 25개 자치구
  // 전부 동일해서 custom parser 없이 declarative selector 하나를 공유한다
  // (ul#dataList > li 구조, 25개 dist 코드 각각 cheerio 파싱 결과를 직접
  // 검증 완료).
  // listUrl에 넣은 sdate=2026-07-31은 조사 시점(오늘) 기준 하한이며, 다음
  // 재배포 전까지 고정값으로 남는다. 이 사이트는 sdate 없이 기본 정렬이면
  // 이미 종료된 2025년 행사가 먼저 나오는 걸 확인했기 때문에(기본 정렬이
  // 시작일 오름차순이라 과거 행사부터 잡힘) sdate 하한이 꼭 필요했다. 다만
  // sdate가 고정돼도 위험하지 않다 — cityFestivalCache.ts의
  // queryCityFestivalsFromCache가 읽기 시점에 upcomingWithinDays로 다시
  // 거르므로, DB에 지난 축제가 쌓여도 앱에는 노출되지 않는다. 유일한 남는
  // 리스크는 향후 sdate보다 이른 시작일로 새로 등록되는 축제를 놓칠 수
  // 있다는 것뿐이다(다음 wave 재검증 시 sdate를 그날 날짜로 갱신하면
  // 해소된다).
  ...[
    { siteId: "seoul-culture-jongno", cityName: "종로구", code: "11110", lat: 37.5730853, lng: 126.9792509 },
    { siteId: "seoul-culture-jung", cityName: "중구", code: "11140", lat: 37.563758, lng: 126.9975659 },
    { siteId: "seoul-culture-yongsan", cityName: "용산구", code: "11170", lat: 37.5325763, lng: 126.9904206 },
    { siteId: "seoul-culture-seongdong", cityName: "성동구", code: "11200", lat: 37.5612078, lng: 127.0371526 },
    { siteId: "seoul-culture-gwangjin", cityName: "광진구", code: "11215", lat: 37.5363239, lng: 127.0877952 },
    { siteId: "seoul-culture-dongdaemun", cityName: "동대문구", code: "11230", lat: 37.5735046, lng: 127.0398572 },
    { siteId: "seoul-culture-jungnang", cityName: "중랑구", code: "11260", lat: 37.60618, lng: 127.09359 },
    { siteId: "seoul-culture-seongbuk", cityName: "성북구", code: "11290", lat: 37.5894403, lng: 127.0167332 },
    { siteId: "seoul-culture-gangbuk", cityName: "강북구", code: "11305", lat: 37.6396318, lng: 127.0273341 },
    { siteId: "seoul-culture-dobong", cityName: "도봉구", code: "11320", lat: 37.6687201, lng: 127.0473035 },
    { siteId: "seoul-culture-nowon", cityName: "노원구", code: "11350", lat: 37.654325, lng: 127.0563749 },
    { siteId: "seoul-culture-eunpyeong", cityName: "은평구", code: "11380", lat: 37.6027849, lng: 126.9291822 },
    { siteId: "seoul-culture-seodaemun", cityName: "서대문구", code: "11410", lat: 37.579077, lng: 126.9346051 },
    { siteId: "seoul-culture-mapo", cityName: "마포구", code: "11440", lat: 37.5635586, lng: 126.9033645 },
    { siteId: "seoul-culture-yangcheon", cityName: "양천구", code: "11470", lat: 37.512295, lng: 126.865945 },
    { siteId: "seoul-culture-gangseo", cityName: "강서구", code: "11500", lat: 37.5509788, lng: 126.8495652 },
    { siteId: "seoul-culture-guro", cityName: "구로구", code: "11530", lat: 37.4934375, lng: 126.8949325 },
    { siteId: "seoul-culture-geumcheon", cityName: "금천구", code: "11545", lat: 37.4558132, lng: 126.8939002 },
    { siteId: "seoul-culture-yeongdeungpo", cityName: "영등포구", code: "11560", lat: 37.5253085, lng: 126.8965943 },
    { siteId: "seoul-culture-dongjak", cityName: "동작구", code: "11590", lat: 37.5042165, lng: 126.94022 },
    { siteId: "seoul-culture-gwanak", cityName: "관악구", code: "11620", lat: 37.481223, lng: 126.9527151 },
    { siteId: "seoul-culture-seocho", cityName: "서초구", code: "11650", lat: 37.4840614, lng: 127.0324034 },
    { siteId: "seoul-culture-gangnam", cityName: "강남구", code: "11680", lat: 37.5171756, lng: 127.0412865 },
    { siteId: "seoul-culture-songpa", cityName: "송파구", code: "11710", lat: 37.5145656, lng: 127.1060321 },
    { siteId: "seoul-culture-gangdong", cityName: "강동구", code: "11740", lat: 37.5306942, lng: 127.1206234 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: `https://culture.seoul.go.kr/culture/culture/cultureEvent/eventList.do?viewType=CONTBODY&menuNo=200010&searchField=FESTIVAL&searchDist=${entry.code}&sdate=2026-07-31&pageIndex=1`,
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-31",
    selectors: {
      itemSelector: "ul#dataList > li",
      titleSelector: "p.tit",
      dateSelector: "div.date",
      linkSelector: "a",
      imageSelector: "img",
      venueSelector: "p.place"
    }
  })),

  // wave 13(부산광역시): 서울(wave 12)처럼 통합 포털 하나로 16개 구·군을
  // 전부 커버할 수 있는지부터 확인했다. visitbusan.net(부산관광공사)의
  // "축제" 목록(/kr/festival/list)은 구·군 필터(gugun_nm 파라미터)가 실제로
  // 동작하는 것을 확인했지만(2026-07-31 실측: 중구/해운대구 요청에서 실제로
  // 다른 항목이 반환됨), 그 목록 페이지 자체에는 날짜가 없고 각 항목의 상세
  // 페이지에만 기간이 있다. cityFestivalDiscovery.ts의 discoverSite()는
  // site당 listUrl 하나만 fetch해 정적/커스텀 파서에 그대로 넘기는 구조라
  // 상세 페이지를 추가로 fetch할 방법이 없어(fetch 서브리퀘스트를 항목 수만큼
  // 늘리는 건 설계 밖이라 채택하지 않음) 이 방식은 쓸 수 없었다. 부산은 서울과
  // 달리 필터와 날짜가 같은 페이지에 없어 통합 포털 방식이 성립하지 않는다고
  // 결론 내리고, 16개 구·군을 개별 조사했다.
  //
  // 개별 조사 결과 15개 구·군은 제외했다. 압도적 다수가 "해당 구의 대표
  // 축제 1~2개를 소개하는 단독 마이크로사이트"이거나 "행사 사진 갤러리(날짜가
  // 게시일일 뿐 축제 기간이 아님)" 패턴이라 반복되는 진짜 축제 목록이
  // 없었다(2026-07-31 실측):
  // - 서구: bsseogu.go.kr에는 자체 "문화관광" 축제 목록이 없고, 유일한
  //   대표 축제(제16회 부산 고등어 축제)가 외부 도메인 busangde.co.kr에
  //   있는데 이 도메인은 루트와 robots.txt 모두 403 Forbidden(WAF 차단,
  //   tour.gb.go.kr 사례와 동일 패턴)이라 구조 확인 자체가 불가능해 제외.
  // - 동구: "부산차이나타운 문화축제" 단독 마이크로사이트뿐이고, "축제·행사"
  //   메뉴는 실제로는 "축제·행사 사진"(과거 행사 사진 게시판, 게시일만 있고
  //   축제 기간 필드가 없음)이라 제외.
  // - 영도구: robots.txt 요청이 실제 robots 규칙 대신 "보안을 위해 일시 접속
  //   차단" WAF 안내 페이지(mojibake로 응답, Source ip 로그까지 노출)를
  //   돌려줘 실제 크롤링 허용 범위를 확인할 수 없었다. 타임아웃은 아니라서
  //   프로토콜의 "3회 이상 타임아웃 시 확인 불가" 조건과 정확히 일치하지는
  //   않지만 취지상 동일하게 "확인 불가"로 보류하고 제외 — 재검증 시 이
  //   판단이 맞는지 다시 볼 필요가 있음.
  // - 부산진구: robots.txt는 허용이지만(`*`: Allow /), "축제공연 달력"은
  //   실제 데이터가 없는 JS 렌더 캘린더 위젯이고(정적 HTML에 이벤트 날짜가
  //   전혀 없음), "축제" 하위 메뉴도 개별 축제 마이크로사이트로 가는 내비게이션
  //   목록일 뿐이라 제외.
  // - 동래구: "동래읍성역사축제" 단독 마이크로사이트뿐이라 제외.
  // - 남구: robots.txt가 기본(`*`) 그룹에 `Disallow: /`이고 `Allow: /`는
  //   Yeti(네이버 봇) 전용 그룹이라 우리 UA는 차단 대상 — robots 차단으로
  //   제외.
  // - 북구: "낙동강 구포나루 축제"·"만덕사람들의 가을은행잎 축제" 두 개
  //   대표 축제를 소개하는 마이크로사이트뿐, 반복되는 목록형 게시판이
  //   없어 제외.
  // - 해운대구: "빛축제" 단독 마이크로사이트뿐이라 제외.
  // - 사하구: 루트(www.saha.go.kr/)조차 403 Forbidden("BAD REQUEST",
  //   tour.gb.go.kr과 동일한 WAF 차단 패턴)이라 제외.
  // - 금정구: robots.txt는 허용이지만, "축제/행사" 메뉴의 모든 링크가
  //   금정산성축제·새해 해맞이 행사·정월대보름 행사·회동호 가을빛 축제 같은
  //   개별 행사 전용 페이지로만 연결되고 반복되는 목록형 게시판이 없다.
  //   초기에 시도한 메뉴 코드 하나는 EGOV 프레임워크 런타임 오류
  //   페이지("RFC 3.0 오류 메세지")만 반환했는데, 이는 서버 코드 오류로 보고
  //   더 이상 파고들지 않았다 — 정확한 메뉴 코드로 재시도해도 결국 개별 행사
  //   페이지로 귀결되는 구조 자체가 제외 사유다.
  // - 강서구: robots.txt가 기본(`*`) 그룹에 `Disallow: /`라 전면 차단 —
  //   robots 차단으로 제외.
  // - 연제구: "연제고분판타지축제" 단독 마이크로사이트뿐이라 제외(게시판
  //   확인 결과 실제로 등록된 행사가 이 축제 하나, 기간 2026.4.3~4.5).
  // - 수영구: "축제행사의 목록"이라는 제목의 페이지가 있어 기대했으나 실제
  //   본문에는 반복되는 게시판/갤러리 구조가 없고 내비게이션 메뉴만 있어
  //   제외.
  // - 사상구: "사상강변축제" 단독 마이크로사이트뿐이라 제외.
  // - 기장군: "기장멸치축제" 단독 마이크로사이트뿐이라 제외.
  //
  // 유일하게 등록한 중구는 "한눈에 보는 축제문화행사"
  // (bsjunggu.go.kr/tour/index.junggu?menuCd=DOM_000000203003000000)라는
  // 시기/행사명/기간/장소 4열 표 하나에 연간 일정 23~25건이 실제 날짜와
  // 함께 정리돼 있다. robots.txt에 `User-agent: *` 그룹이 없어(Yeti/Googlebot
  // 전용 그룹뿐) 우리 UA는 어느 그룹과도 매치되지 않아 비차단으로 판단했다.
  // 기간 열 형식이 "4.7.(월)~5.6.(화)" / "9.18(목)~9.21(일)"(마침표 없는
  // 변형) / "9.12.(금)~13.(토)"(종료일 일자만) / "6.28.(토)/8.9.(토)"(복수
  // 개최일) / "25.12.5.(금)~26.2.22.(일)"(2자리 연도 명시, 연도교차) /
  // "9.11.(목) 17:30"(시각 포함) 6가지가 섞여 있고 표 마크업도 일부 행에서
  // <tr> 여는 태그가 누락돼 있어 declarative selector로는 처리할 수 없다 —
  // customParsers/bsjungguAnnualSchedule.ts를 만들어 <tr> 경계 대신 표 전체의
  // <td>를 3개씩(행사명/기간/장소) 묶어 파싱하고, "11월 중"처럼 일자가 없는
  // 행은 제외한다. 좌표는 OSM Nominatim으로 조회한 중구청 좌표를 사용.
  // 주의: 2026-07-31 재확인 시점에도 이 표는 "2025년 문화관광 행사일정"
  // 그대로다(구청이 2026년판으로 아직 갱신하지 않음) — 즉 등록 시점 기준
  // 표 안의 모든 항목이 이미 지난 날짜라 당장은 신규 데이터가 쌓이지 않는다.
  // 구조와 파서 로직은 실제 마크업으로 검증을 마쳤으므로 등록해 두면 구청이
  // 다음 연도판으로 갱신하는 즉시 크론이 새 데이터를 수집한다.
  {
    siteId: "busan-junggu-culture",
    cityName: "중구",
    listUrl: "https://www.bsjunggu.go.kr/tour/index.junggu?menuCd=DOM_000000203003000000",
    fallbackLat: 35.1062423,
    fallbackLng: 129.0323659,
    robotsCheckedAt: "2026-07-31",
    customParser: "bsjunggu-annual-schedule"
  },

  // wave 14(대구광역시): 서울(wave 12)처럼 통합 포털 하나로 7개 구·1개 군을
  // 전부 커버할 수 있는지부터 확인했다. 두 후보 모두 탈락했다(2026-07-31 실측):
  // - tour.daegu.go.kr(대구관광포털) "축제" 목록은 구·군 필터는 없고, 무엇보다
  //   목록 페이지의 기간 필드 자체가 "03월중"/"04월중"/"05월중"처럼 월 단위까지만
  //   있고 일자가 없다. cityFestivalNormalize.ts의 parseCityDateRange()는
  //   YYYY.MM.DD/YYYY년M월D일 같은 "일자 포함" 패턴만 인식하므로 이 목록은
  //   애초에 파싱 대상이 될 수 없어 제외.
  // - dgfca.or.kr(대구문화예술진흥원) "행사" 목록은 정적 HTML을 그대로 fetch하면
  //   날짜 문자열이 단 한 건도 없다(JS/AJAX로 목록을 그려 넣는 위젯이라
  //   Workers의 fetch()로는 빈 뼈대만 받아진다) — 제외.
  //
  // 개별 조사 결과 7개 구·군은 제외했다:
  // - 중구(jung.daegu.kr): robots.txt를 포함한 모든 요청이 "sabFingerPrint/
  //   sabSignature" JS 쿠키 챌린지 페이지(WAF 핑거프린트 검사)로 응답돼
  //   실제 robots 규칙을 3회 재시도해도 한 번도 받아보지 못했다. 정확히
  //   "3회 이상 타임아웃"은 아니고(응답 자체는 옴, 다만 실제 규칙이 아닌
  //   챌린지 페이지) 부산 영도구 사례(WAF 안내 페이지 응답)와 취지상 동일한
  //   "확인 불가"로 보고 등록하지 않았다 — 재검증 시 이 판단이 맞는지
  //   다시 볼 필요가 있음.
  // - 동구(dong.daegu.kr): "문화관광" 하위 메뉴가 반복되는 목록형 게시판이
  //   아니라 개별 축제(예: 팔공산 관련 행사) 소개 페이지 나열뿐인 마이크로사이트
  //   패턴이라 제외. 별도로 웹 검색에 나온 "팔공문화원(palgong.or.kr)" 도메인도
  //   확인했으나 실제로는 축제 콘텐츠와 무관한 "ARTKOREA" 호스팅사 템플릿
  //   페이지로 연결되는 죽은/탈취된 도메인이었다(참고용 발견, 제외 사유에는
  //   영향 없음).
  // - 서구(dgs.go.kr/seogu): "문화관광" 축제 메뉴가 개별 축제 소개 페이지
  //   나열뿐인 마이크로사이트 패턴이라 제외.
  // - 남구(nam.daegu.kr): "문화관광" 메뉴 하위 항목들이 전부 "앞산해맞이축제"
  //   등 개별 축제 소개 페이지로만 연결되고 반복되는 목록형 게시판이 없어
  //   제외. 웹 검색에 나온 "남구문화원(namgucc.or.kr)" 도메인도 확인했으나
  //   팔공문화원과 마찬가지로 축제와 무관한 "ARTKOREA" 호스팅사 템플릿
  //   페이지로 연결되는 죽은/탈취된 도메인이었다.
  // - 북구(buk.daegu.kr): "문화관광" 축제 메뉴는 개별 축제 소개 페이지
  //   나열뿐이고, 별도 "관광소식" 게시판은 있으나 최근 글이 2023년에 멈춰
  //   있어(장기 미갱신) 실질적으로 갱신되지 않는 자료라 제외. 구 문화재단인
  //   행복북구문화재단(hbcf.or.kr)도 확인했으나 robots.txt 기본(`*`) 그룹에
  //   `Disallow: /`라 전면 차단이라 제외.
  // - 수성구(suseong.kr): 구청 사이트의 "문화관광" 메뉴는 개별 축제 소개
  //   페이지 나열뿐인 마이크로사이트 패턴이고, "행사일정" 캘린더 페이지는
  //   정적 HTML에 날짜 데이터가 전혀 없는 JS 렌더 위젯이라 제외. 수성문화재단
  //   (sscf.or.kr)도 확인했으나 루트 도메인이 메타 리프레시로 넘어가는
  //   pages/index.htm이 빈 페이지이고, 실제 콘텐츠가 있는 하위 경로도 대표
  //   축제 하나만 소개하는 마이크로사이트 패턴이라 제외.
  // - 달성군(dalseong.daegu.kr): 군청 사이트의 "문화관광" 메뉴는 개별 축제
  //   소개 페이지 나열뿐이고, "행사일정" 캘린더도 정적 HTML에 데이터가 없는
  //   JS 렌더 위젯이라 제외. 구 문화재단인 달성문화재단(dsart.or.kr)도
  //   확인했으나 robots.txt 기본(`*`) 그룹에 `Disallow: /`이고 `Allow: /`는
  //   Yeti/Googlebot 전용 그룹뿐이라 우리 UA는 차단 대상 — robots 차단으로
  //   제외.
  //
  // 유일하게 등록한 달서구는 구청 산하 달서문화재단(dscf.or.kr)의 "축제"
  // 콘텐츠 페이지(main/contents.do?a_num=28659473)에 div.photo_list >
  // div.top_box 반복 구조로 5개 항목이 실제 날짜(예: "2026. 05. 15.(Fri) ~
  // 05. 17.(Sun)")와 함께 있다. robots.txt는 `User-agent: *`에 /cert, /data,
  // /db, /ieetu_ckfinder, /nanum, /sns, /pages만 Disallow하고 나머지는
  // `Allow: /`라 대상 경로(main/contents.do)는 비차단으로 확인했다. 항목의
  // 기간 dd 안에 과거 값이 남은 HTML 주석(<!-- 2025. 1월 중 -->)이 섞여 있고
  // 종료일 표기가 "일자만"(같은 연/월 재사용)이라 declarative selector로는
  // 처리할 수 없어 customParsers/dalseoDscf.ts를 만들어 파싱한다. 좌표는
  // OSM Nominatim으로 조회한 달서구청 좌표를 사용. 주의: 2026-07-31 등록
  // 시점 기준 5개 항목이 "2025 희망달서 대축제"(10월)/"2026 장미꽃 필(Feel)
  // 무렵"(5월)처럼 매년 반복 개최되는 대표 축제 위주라 항목 수 자체는 적지만,
  // 구조와 파서 로직은 실제 마크업으로 검증을 마쳤으므로 등록해 두면 재단이
  // 다음 회차 정보를 올리는 즉시 크론이 수집한다.
  {
    siteId: "daegu-dalseo-dscf",
    cityName: "달서구",
    listUrl: "https://www.dscf.or.kr/main/contents.do?a_num=28659473",
    fallbackLat: 35.8299206,
    fallbackLng: 128.5328266,
    robotsCheckedAt: "2026-07-31",
    customParser: "dalseo-dscf"
  },

  // wave 15(인천광역시): 서울(wave 12)처럼 통합 포털 하나로 전 구·군을 커버할
  // 수 있는지부터 확인했다(2026-07-31 실측). 인천관광공사가 운영하는
  // itour.incheon.go.kr의 "축제" 목록(ssst/ssst/list.do?pageNm=fstv)이 그
  // 후보인데, sel_gugun 쿼리 파라미터(구·군마다 다른 포털 자체 코드, 법정동
  // 코드 아님)로 실제 서버사이드 지역 필터링이 되는 것을 cheerio로 직접
  // 확인했다 — 미추홀구(177)/연수구(185)/남동구(200)/부평구(237)/계양구(245)/
  // 강화군(710)/옹진군(720)/제물포구(125)/영종구(155)/검단구(290)/서해구(275)
  // 11개 코드 각각 요청 결과의 cotId 집합이 서로 완전히 겹치지 않음을 확인
  // 완료. 목록 페이지 자체(div.date)에 "YYYY.MM.DD ~YYYY.MM.DD" 형식의 실제
  // 날짜가 있어 parseCityDateRange()가 그대로 시작/종료일로 나눈다. 서울과
  // 달리 fstv_year 쿼리 파라미터를 생략해도 서버가 현재 연도를 기본값으로
  // 채워주는 것을 확인했으므로(2026-07-31 실측: 파라미터 유무와 무관하게
  // 동일 결과), listUrl에 연도를 하드코딩하지 않았다 — 서울 wave의 sdate
  // 하드코딩과 달리 다음 해가 되어도 갱신 없이 그대로 최신 연도를 조회한다.
  // robots.txt는 `User-agent:*` 그룹에 Disallow 없이 Sitemap 3개만 있어
  // 전면 허용으로 판단했다.
  //
  // 중요: 조사 중 인천시 행정구역이 2026-07-01부로 개편된 사실을 확인했다
  // (2군 8구 → 2군 9구). 이 작업 지시서에 적힌 "8개 구·2개 군(중구, 동구,
  // 미추홀구, 연수구, 남동구, 부평구, 계양구, 서구, 강화군, 옹진군)"은 개편
  // 이전 구성이다. '인천시 제물포구·영종구 및 검단구 설치 등에 관한 법률'
  // (2024년 제정)에 따라 중구+동구가 폐지되고 제물포구·영종구로, 서구에서
  // 검단구가 분리 신설되고 남은 서구는 서해구로 개칭됐다(경향신문
  // 2026-06-08, 한국경제 2026-06-29 보도, 인천시 공식 카드뉴스
  // incheon.go.kr/IC010601/2187729 확인). itour.incheon.go.kr의 sel_gugun
  // 드롭다운도 이미 새 명칭(제물포구/영종구/검단구/서해구)만 제공하고
  // 중구/동구/서구는 옵션에 없다 — 포털이 개편을 반영해 갱신됐다는 뜻이므로
  // 이 wave는 옛 10개가 아니라 현재 실제 기초자치단체인 9개 구·2개 군
  // (미추홀구/연수구/남동구/부평구/계양구/제물포구/영종구/검단구/서해구/
  // 강화군/옹진군) 전부를 등록한다.
  //
  // 상세 링크가 <a href="javascript:;" name="btn_detail" cotId="...">라
  // href 속성이 없어(cheerio 파싱 시 cotId 속성은 cotid로 소문자 정규화된다)
  // declarative parser의 href 기반 링크 추출로는 상세 URL을 만들 수 없다 —
  // customParsers/incheonItourFestival.ts를 만들어 cotId로 상세 URL
  // (detail.do?cotId=...)을 직접 조립한다. 목록에 장소/주소 필드가 없어
  // venue/address는 항상 null이고, 좌표는 구·군 fallback(OSM Nominatim 조회)을
  // 그대로 쓴다. 옹진군(720)과 서해구(275)는 2026-07-31 조사 시점 기준 등록된
  // 항목이 0건이었다(구조 오류가 아니라 그 시점 포털에 실제로 해당 지역
  // 축제가 없는 것으로 확인, cotId 집합 자체가 비어 있고 다른 코드와 겹치지도
  // 않음) — 향후 포털에 항목이 올라오면 크론이 자동 수집하도록 그대로
  // 등록해 둔다.
  ...[
    { siteId: "incheon-itour-michuhol", cityName: "미추홀구", code: "177", lat: 37.4636, lng: 126.6502 },
    { siteId: "incheon-itour-yeonsu", cityName: "연수구", code: "185", lat: 37.4098, lng: 126.6787 },
    { siteId: "incheon-itour-namdong", cityName: "남동구", code: "200", lat: 37.446902, lng: 126.7315126 },
    { siteId: "incheon-itour-bupyeong", cityName: "부평구", code: "237", lat: 37.5070221, lng: 126.7220068 },
    { siteId: "incheon-itour-gyeyang", cityName: "계양구", code: "245", lat: 37.5373539, lng: 126.7379078 },
    { siteId: "incheon-itour-jemulpo", cityName: "제물포구", code: "125", lat: 37.4652463, lng: 126.6064148 },
    { siteId: "incheon-itour-yeongjong", cityName: "영종구", code: "155", lat: 37.4564531, lng: 126.4433445 },
    { siteId: "incheon-itour-geomdan", cityName: "검단구", code: "290", lat: 37.5972286, lng: 126.6601317 },
    { siteId: "incheon-itour-seohae", cityName: "서해구", code: "275", lat: 37.545, lng: 126.676 },
    { siteId: "incheon-itour-ganghwa", cityName: "강화군", code: "710", lat: 37.746, lng: 126.488 },
    { siteId: "incheon-itour-ongjin", cityName: "옹진군", code: "720", lat: 37.533, lng: 126.429 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: `https://itour.incheon.go.kr/ssst/ssst/list.do?pageNm=fstv&sel_gugun=${entry.code}`,
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-31",
    customParser: "incheon-itour-festival"
  }))
];
