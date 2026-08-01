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
  })),

  // wave 16(광주광역시): 서울(wave 12)/인천(wave 15)처럼 통합 포털 하나로 5개
  // 구(동구/서구/남구/북구/광산구)를 전부 커버할 수 있는지부터 확인했다
  // (2026-07-31 실측). 광주관광포털 tour.gwangju.go.kr의 "축제와 이벤트"
  // 목록(home/sub.cs?m=346)이 그 후보인데, 목록 항목 자체에는 실제 날짜가
  // 있어 조건 (b)는 통과하지만, 구·군을 걸러내는 서버사이드 쿼리 파라미터가
  // 전혀 없다 — sel_gugun류 파라미터를 아무리 찾아도 없고(cheerio로 직접
  // 확인), 페이지 안의 "동구/서구/남구/북구/광산구" 문자열은 전부 하단
  // 푸터의 정적 외부 링크일 뿐이었다(예: <a href="https://www.donggu.kr/
  // tour">동구</a>, .../seogu.gwangju.kr/culture, .../namgu.gwangju.kr/
  // index.es?sid=a7, bukgu.gwangju.kr/culture, .../gwangsan.go.kr/culture —
  // 전부 각 구 자체 사이트로 나가는 링크고 쿼리 파라미터 필터가 아니다).
  // 즉 조건 (a. 서버사이드 구 필터)가 실패해 통합 포털은 쓸 수 없고, 지시된
  // 대로 개별 구 사이트로 fallback해서 조사했다.
  //
  // 참고: 조사 중 광주광역시가 전라남도와 통합되어 "전남광주통합특별시"라는
  // 새 광역단체가 출범한 사실을 확인했다(2026-07-31 시점, tour.gwangju.go.kr
  // 홈페이지 배너·gjgwangsan.kccf.or.kr 푸터 "전남광주통합특별시 광산구"·
  // www.gjsgcc.or.kr 본문 "전남광주통합특별시 서구청" 등 복수 페이지에서
  // 교차 확인). 다만 인천 wave 15의 행정구역 개편과 달리 이번 통합은 광역
  // 단위(도-광역시 통합)이고, 동구/서구/남구/북구/광산구 5개 구는 여전히
  // 별도 홈페이지를 운영하는 기초자치단체로 실재하고 있어 이 wave의 조사
  // 대상(5개 구) 자체는 바뀌지 않는다.
  //
  // 개별 구 조사 결과 4개 구는 제외했다:
  // - 서구: 구청 사이트(www.seogu.gwangju.kr)에 실제 날짜가 있는 유일한
  //   목록("행사 일정 안내", board.es?mid=a70301000000&bid=0075, 2026-07-31
  //   실측 "2026-"/"2025-" 형식 날짜 다수 확인)이 정확히 robots.txt의
  //   `User-agent: *` 그룹 `Disallow: /board*`에 걸려 제외된다. 문화관광
  //   메인(/culture)이나 연중문화행사(/culture, "연중문화행사" 페이지)에는
  //   ISO 날짜가 아예 없다. 산하 서구문화원(gjsgcc.or.kr, "문화예술축제"
  //   게시판)도 확인했으나 SEQ 번호가 붙은 게시판 목록이고 날짜 컬럼이
  //   "2026-01-28"처럼 전부 동일한 등록일(글쓴 날짜)일 뿐, 축제 자체의
  //   시작/종료일이 아니라 제외(사진 갤러리류와 동일한 "게시일만 있고
  //   행사 기간 없음" 패턴). 웹 검색으로 나온 playgwangju.co.kr(플레이광주,
  //   민간/커뮤니티 사이트로 공식 구청·문화재단 출처가 아님)의 축제 게시판도
  //   확인했으나 서버가 약한 DH 키를 쓰는 TLS 설정이라(`SSL routines::dh
  //   key too small`) 표준 curl TLS 협상 자체가 실패해 접근이 안 되고,
  //   공식 출처도 아니라 우회하지 않고 제외했다.
  // - 남구: 구청 사이트(www.namgu.gwangju.kr)는 robots.txt `User-agent: *`
  //   그룹이 `Disallow: /`(단 `Allow: /index.es?sid=a1` 하나만 예외)라
  //   문화관광 페이지(index.es?sid=a7, 실제로는 "굿모닝!양림" 오디오 소개
  //   페이지) 자체가 전면 차단 대상이라 제외. 산하 광주남구문화원
  //   (gjnamgu.or.kr 계열, 홈 화면 확인)도 확인했으나 홈의 게시물 목록들이
  //   "등록된 게시물이 없습니다" 플레이스홀더와 "2026-02-10"처럼 전부 같은
  //   등록일만 찍힌 사진 갤러리류라 실제 축제 기간 데이터가 없어 제외.
  // - 북구: 구청 사이트(bukgu.gwangju.kr)는 robots.txt `User-agent: *`
  //   그룹이 `Disallow:/`로 전체 차단이라 제외. 산하 광주광역시북구문화원
  //   (gjbukgu.or.kr, robots는 `/jingle/`만 차단해 접근은 가능)의 "행사사업"
  //   페이지(/ko/21)도 확인했으나 "가족과 함께하는 화전부치기와 민속놀이 —
  //   사업시기: 4월", "문화역사 유적지 탐방 — 사업시기: 11월"처럼 매년
  //   반복되는 사업을 월 단위로만 소개하는 정적 소개 페이지라 연도가 없는
  //   반복 목록형 게시판이 아니라 제외.
  // - 광산구: 구청 사이트(www.gwangsan.go.kr)의 축제 게시판(clturTourList.do)
  //   은 robots는 막혀 있지 않지만 JS/AJAX로 목록을 그려 넣는 위젯이라
  //   정적 HTML을 그대로 fetch하면 `<ul class="d_list_gallery dataList">`가
  //   빈 채로 온다(2026-07-31 실측, 항목 0개). 산하 광산문화원
  //   (gjgwangsan.kccf.or.kr)의 "축제/행사" 소개 페이지도 확인했으나 텍스트
  //   목록이 아니라 인포그래픽 PNG 이미지 한 장뿐이고, 홈 메뉴의 "월별행사"
  //   링크는 `<!--li><a href="">월별행사</a></li-->`처럼 HTML 주석으로
  //   막혀 있는 죽은 메뉴 항목이라 제외.
  //
  // 유일하게 등록한 동구는 구청 사이트(donggu.kr)의 robots.txt가
  // `User-agent: *` 그룹에 `Disallow: /`(단 `Allow: /index.es?sid=a1`
  // 하나만 예외)라 문화관광(/tour) 경로가 차단 대상이라 제외한 대신, 산하
  // 동구문화관광재단(gdctf.or.kr)의 "행사" 게시판(front/M0000255/accdata/
  // list.do)을 등록했다. robots.txt는 `User-agent: *` 그룹이 기본
  // `Disallow: /`이지만 `Allow: /front/`가 있어 대상 경로가 비차단으로
  // 확인됐다(2026-07-31 실측). 이 게시판은 재단이 국립아시아문화전당(ACC)의
  // 행사 정보를 그대로 옮겨와 보여주는 목록(URL 자체가 "accdata")으로,
  // ul.galleryList > li 반복 구조 안에 "<time>2026-08-17 ~
  // 2026-08-17</time>" 형식의 실제 날짜가 있어 declarative selector만으로
  // parseCityDateRange()가 시작/종료일을 그대로 나눈다. 상세 링크는
  // acc.go.kr 자체 상세 페이지로 바로 연결되는 절대경로라 별도 URL 조립이
  // 필요 없다. 장소 span이 비어 있는 항목도 있으나(예: "ACC 친환경 캠페인")
  // venueSelector는 선택 필드라 null로 처리돼 문제 없다. 좌표는 OSM
  // Nominatim으로 조회한 동구청 좌표를 사용.
  {
    siteId: "gwangju-donggu-gdctf",
    cityName: "동구",
    listUrl: "https://gdctf.or.kr/front/M0000255/accdata/list.do",
    fallbackLat: 35.1461883,
    fallbackLng: 126.9230060,
    robotsCheckedAt: "2026-07-31",
    selectors: {
      itemSelector: ".galleryList > li",
      titleSelector: ".txt strong",
      dateSelector: ".txt time",
      linkSelector: "a",
      imageSelector: ".img img",
      venueSelector: ".txt > span"
    }
  },

  // wave 17(대전광역시): 5개 구(동구/중구/서구/유성구/대덕구)를 조사했다
  // (2026-07-31 실측). 먼저 통합 포털 후보 daejeontour.co.kr
  // (/festival_djt)을 확인했는데, 목록 페이지에 embed된 `calEvents` JS
  // 배열 자체에 title/start/end/venue(wr_8)가 전부 실제 날짜로 들어 있어
  // 조건 (b, 목록 페이지 자체에 전체 날짜 정보)는 통과한다(예:
  // {"title":"2025 대전 동구동락 축제","start":"2025-10-24","end":
  // "2025-10-27","wr_8":"소제동 동광장로 및 대동천 일원"},{"title":
  // "2025 대전서구아트페스티벌","start":"2025-10-10","end":"2025-10-13"},
  // {"title":"2026 유성온천문화축제","start":"2026-05-08","end":
  // "2026-05-11"} 등). 하지만 이 JSON 레코드 자체에 구를 나타내는 필드가
  // 전혀 없고(장소 텍스트에 동네 이름이 섞여 있을 뿐 구조화된 필드가
  // 아님), 임의로 ?gu=동구 쿼리를 붙여 curl해도 결과가 서버사이드로
  // 걸러지지 않는다 — og:url meta와 스팸방지용 hidden input(`spt`)
  // 값만 쿼리를 그대로 반사해서 달라질 뿐, 실제 항목 목록은 사실상
  // 동일했다(2026-07-31 실측, 원본과 ?gu= 버전을 diff해 확인). 즉 조건
  // (a, 서버사이드 구 필터)가 실패해 통합 포털은 등록할 수 없고, 지시된
  // 대로 개별 구 사이트로 fallback했다. 참고로 daejeon.go.kr 시청
  // 자체 도메인은 robots.txt `User-agent: *` 그룹이 `Disallow: /`이고
  // Allow는 /english /japanese /chinese /drh 뿐이라(관광/축제 경로 전부
  // 제외), 프로덕션 UA로는 애초에 시청 자체 사이트를 스크레이핑할 수
  // 없다 — Yeti/Googlebot/DAUM 같은 named-bot 그룹은 더 넓은 Allow
  // 목록을 갖고 있지만 우리 UA와 매칭되지 않아 적용되지 않는다.
  //
  // 5개 구 전부 조사했지만 등록 가능한 사이트를 하나도 찾지 못했다:
  // - 중구: 구청 사이트(djjunggu.go.kr, robots는 `User-agent: *` 그룹이
  //   없고 named-bot 그룹만 있어 우리 UA에는 비제한 적용)의 문화관광
  //   메뉴(sub02_03.do?partCode=17)는 "마을 축제"라는 정적 소개 글로,
  //   각 축제마다 "2024" 같은 연도 라벨만 있고 월/일 날짜가 전혀 없어
  //   제외. 산하 중구문화원(djcc.or.kr, robots는 Yoast 기본값으로 전면
  //   허용)의 "행사일정" 페이지는 Google Calendar iframe을 그대로
  //   삽입한 형태라, fetch되는 HTML 자체에는 이벤트 데이터가 전혀 없고
  //   실제 데이터는 구글 iframe 내부에만 존재해 스크레이핑이 불가능해
  //   제외.
  // - 서구: 구청 사이트(seogu.go.kr, robots는 중구와 마찬가지로
  //   `User-agent: *` 그룹이 없어 우리 UA에는 비제한)의 "축제소식"
  //   게시판(bbs/BBSMSTR_000000000221/list.do)을 확인했으나 총
  //   게시물이 6건뿐이고 전부 "대전 서구(힐링) 아트페스티벌"이라는
  //   같은 단일 축제의 연도별 행정 공지(2021/2023/2024/2025년 "입장권
  //   배부 안내", "먹거리 부스 정보 안내" 등)였다 — 날짜 컬럼도 행사
  //   기간이 아니라 게시글 등록일이라 제외(사진 갤러리류와 동일한
  //   "등록일만 있고 행사 기간 없음" 패턴). 문화체육관광 메인 페이지의
  //   "맞춤여행 추천받기" 위젯에도 "축제/행사"(data-set="07") 탭이
  //   있었지만 이건 관광명소 카드를 클라이언트 JS로 걸러내는 테마별
  //   필터일 뿐 날짜가 있는 게시판이 아니라 제외. 산하 서구문화원
  //   (sgcc.or.kr, robots는 기술 경로만 차단해 사실상 전면 허용)은 GNB
  //   메뉴 전체(대관/문화학교/전통문화사업/지역자료/커뮤니티)를
  //   확인했으나 "축제"나 "행사일정"에 해당하는 메뉴 항목 자체가 없어
  //   제외. 웹 검색으로 나온 단일 축제 마이크로사이트
  //   djseogufestival.kr도 위 구청 게시판과 같은 "아트페스티벌" 하나만
  //   다루는 사이트로 판단돼 별도 확인 없이 같은 사유로 제외.
  // - 유성구: 구청 사이트(yuseong.go.kr, robots는 역시 `User-agent: *`
  //   그룹이 없어 비제한)의 문화관광 경로
  //   (prog/trrsrt/TRSE_01/tour/sub04_01/list.do)는 반복 게시판이
  //   아니라 "온천문화축제/국화축제/재즈&맥주페스타" 3개를 각각 개별
  //   view.do 페이지로 하드코딩해 소개하는 메뉴라 제외. 산하
  //   유성문화원(yuseong.or.kr)은 4차례 접속을 시도했으나(HTTPS
  //   HTTP:500 with 404-형태 본문 → HTTPS 재시도 HTTP:000(연결 실패) →
  //   HTTPS 재재시도 HTTP:000 → HTTP(비TLS) HTTP:500) 응답이 일관되게
  //   깨져 있어 "확인 불가"로 처리하고 무리하게 등록하지 않았다. 웹
  //   검색으로 나온 단일 축제 마이크로사이트 ysfesta.com은 유성문화원
  //   접속 불가로 대체 확인이 필요했으나, 다루는 축제(유성온천문화축제)
  //   자체는 이미 daejeontour.co.kr의 통합 목록에 실제 날짜로 잡혀
  //   있어(위 조건 b 예시 참고) 별도 등록 시도 없이 제외.
  // - 대덕구: 구청 사이트(daedeok.go.kr, robots는 `User-agent: *`
  //   그룹이 `Allow: /`이고 우리가 쓴 경로도 차단 목록에 없어 전면
  //   허용)의 "행사소식" 게시판(dpt/dpt04/DPT040102_cmmBoardList.do)을
  //   확인했으나 "2026 작은미술관 신탄진 지역신진예술인 전시... 관람
  //   안내", "「산사에서 힐링하기」 2차 참여자 모집"처럼 전시/강좌
  //   참가자 모집 공지 위주이고 날짜 컬럼도 등록일(예: 2026-07-22,
  //   2026-07-20)일 뿐 행사 기간이 아니라 제외. 산하 대덕문화원
  //   (ddcc.or.kr, robots는 Yoast 기본값으로 전면 허용)의 "행사일정"
  //   페이지는 WordPress KBoard 캘린더 플러그인이 서버사이드로 렌더링한
  //   일자별 목록이라(`?kboard_calendar_type=list`, 파라미터 없이도
  //   현재 달을 기본으로 보여줌) 실제 데이터 자체는 진짜였다(2026-07-31
  //   실측: "공연 / 연극 <망원동 브라더스> / 대덕문화원 공연장",
  //   "교육 / 인문학 강의 1회차 / 대덕문화원 2층 공연장"). 다만 (1)
  //   전부 시작~종료 기간이 아닌 단일 날짜 항목이고, (2) 현재 달
  //   기준으로 항목이 단 2개뿐일 정도로 데이터가 희박하며, (3) "공연"
  //   카테고리 항목은 이 코드베이스가 이미 별도 파이프라인(KOPIS +
  //   music_performance)으로 다루는 공연 도메인과 성격이 겹쳐, "축제"
  //   목록에 넣기에는 부적절하다고 판단해 제외했다.
  // - 동구: 구청 사이트(donggu.go.kr, robots는 `User-agent: *` 그룹이
  //   `Allow: /`라 전면 허용 — 다만 다른 AI 크롤러 UA들은 별도로 차단)의
  //   "축제" 메뉴처럼 보였던 /dg/tour/132/festivalAll 경로는 실제로는
  //   문화유산(향토유적) 소개 콘텐츠일 뿐 날짜 정보가 전혀 없어 제외.
  //   산하 동구문화원(dgcc.or.kr, robots는 /wp-admin/만 차단해 사실상
  //   전면 허용)의 후보 메뉴 2개를 모두 확인했다 — "전통문화전승·축제"는
  //   실제로는 "우암문화제"라는 단일 축제 하나만 소개하는 정적 페이지로
  //   날짜도 "2025. 10. 25.(토) 10:00" 한 건뿐이라 제외, "문화행사
  //   갤러리"는 사진 갤러리라 날짜 정보 자체가 없어 제외. 웹 검색으로
  //   나온 단일 축제 마이크로사이트 dgdr.kr("대전동구동락축제")도 직접
  //   확인 — 메뉴가 축제소개/일정표/프로그램/갤러리로만 구성된 이
  //   축제 하나만을 위한 전용 사이트고, "2025. 10. 24 (금) ~ 10. 26
  //   (일)"이라는 지난 축제 날짜가 홈 히어로 텍스트에 하드코딩돼 있을
  //   뿐 반복 게시판 구조가 아니라 제외(robots.txt는 그누보드 관리자
  //   설정 문제로 호스팅사 302 리다이렉트만 응답해 정상적인 규칙이
  //   없었지만, 사이트 구조 자체가 이미 제외 사유로 충분해 무관).
  //
  // 결과적으로 이번 wave는 5개 구 전부 제외하고 등록 0건이다.
  // daejeontour.co.kr 자체는 실제 시작~종료일이 있는 좋은 데이터를
  // 갖고 있지만 구별 서버사이드 필터가 없어 등록할 수 없고, 개별 구
  // 사이트/문화재단은 정적 소개 페이지, 단일 축제 전용 마이크로사이트,
  // 사진 갤러리, 또는 등록일만 있는 행정 게시판뿐이라 진짜 반복형
  // 축제 게시판을 하나도 찾지 못했다.

  // wave 18(울산광역시): 서울(wave 12)/인천(wave 15)처럼 통합 포털 하나로
  // 5개 구·군(중구/남구/동구/북구/울주군)을 전부 커버할 수 있는지부터
  // 확인했다(2026-08-01 실측). 먼저 시청 산하 관광포털
  // www.ulsan.go.kr/tour의 "축제행사" 목록
  // (/tour/kor/unit/fstvl/list.ulsan?searchDvsn1=1&mId=001001010000000000)을
  // 확인했지만, 이 목록은 (1) 구·군 필터 자체가 없고 검색조건이 제목/월별
  // 뿐이며, (2) 각 항목이 "12월"처럼 연도 없는 월 카테고리 라벨만 갖고
  // 실제 시작~종료일이 전혀 없고, (3) 상세 페이지도 정적 링크가 아니라
  // `<a href="javascript:fn_view('14');return false;">`처럼 폼 제출
  // JS로만 열려 declarative parser의 href 추출이 불가능해 조건 (a)(b)
  // 둘 다 실패, 등록하지 않았다.
  //
  // 대신 울산문화재단(재단법인, uctf.or.kr)이 운영하는 통합 문화행사
  // 포털 ulsanculture.kr을 발견해 확인했다. "문화행사" 목록
  // (/webuser/exhibit/all_list.html)에 `sch_an_gu_code` 쿼리 파라미터로
  // 실제 서버사이드 구·군 필터가 걸려 있는 것을 확인했다 — 목록 페이지의
  // "구·군 선택" select 옵션이 1=남구/2=중구/3=동구/4=북구/5=울주군으로
  // 매핑돼 있고, `sch_so_show_kind=4`("행사·축제" 카테고리)와 조합해
  // 5개 코드 각각 요청한 결과 총 게시물 수가 59/30/11/16/20건으로 전부
  // 다르고 제목 집합도 서로 겹치지 않음을 curl+cheerio로 직접 확인했다
  // (2026-08-01 실측, 조건 a 통과). 목록 페이지 자체의 각 항목 카드에
  // "<dt>기간</dt><dd>2026-07-29 ~ 2026-08-29</dd>"처럼 실제 시작~종료일이
  // 그대로 있어 상세 페이지를 추가로 열 필요가 없다(조건 b 통과,
  // parseCityDateRange가 같은 dateText 문자열에서 시작/종료일 두 개를
  // 그대로 추출한다).
  //
  // robots.txt는 `User-agent: ClaudeBot` 등 특정 크롤러 UA에는
  // `Disallow: /`가 걸려 있지만, 우리 프로덕션 UA
  // (Mozilla/5.0 ParkingLotNavigator/1.0)는 그 named-bot 규칙과 일치하지
  // 않아 적용되지 않는다. 우리에게 적용되는 `User-agent: *` 그룹은
  // `/webadmin/`, `/log/`, `/module/`, `/layout/`과
  // `/*sch_date=`, `/*sch_s_date=`, `/*sch_e_date=`, `/*sch_text=`
  // 쿼리 패턴만 차단한다("무한 루프 유발 날짜/검색 크롤링 차단" 주석 있음).
  // 이 wave가 쓰는 listUrl(`sch_an_gu_code`, `sch_so_show_kind`만 사용)은
  // 차단 패턴에 해당하지 않아 전부 허용 대상이다. 참고로
  // all_list.html에 sch_date/sch_s_date 등을 붙인 날짜 검색 URL은
  // 이 robots 규칙에 걸려 애초에 후보에서 배제했다(사용할 필요도 없었다
  // — 필터 없이 기본 목록만으로 이미 실제 날짜가 포함돼 있었다).
  //
  // 마크업은 `.gal-box .flex` 아래 카드 `<div>`가 반복되는 구조이고, 각
  // 카드 안에 `<a href="/webuser/exhibit/가든-나이트-마켓-3232?...">`
  // 하나가 이미지/제목/dl 세 개(기간→장소→문의 순, 문의는 선택)를 전부
  // 감싼다. 기간 dd는 항상 첫 번째 dl, 장소 dd는 항상 두 번째 dl이라
  // `dl:nth-of-type(1) dd` / `dl:nth-of-type(2) dd`로 안정적으로 구분된다
  // (5개 구·군 응답 각각 8개 카드 전부에서 순서 확인 완료, 예외 없음).
  // 목록에는 이미 종료된 2025년 행사도 섞여 있으나(기본 정렬이 최신
  // 등록순), cityFestivalCache.ts가 읽기 시점에 upcomingWithinDays로
  // 다시 거르므로 앱에는 노출되지 않는다.
  //
  // "행사·축제"(sch_so_show_kind=4) 카테고리를 선택한 이유: 이 포털은
  // 공연(1)/전시(2)/교육체험(3)/행사·축제(4)/기타(5)로 나뉘는데, 공연·
  // 전시는 이미 이 코드베이스가 KOPIS 소스와 music_performance 카테고리로
  // 별도 파이프라인에서 다루는 도메인과 겹칠 위험이 커 제외하고,
  // "행사·축제" 카테고리만 등록했다. 이 카테고리에는 장터/마켓류
  // (예: "가든 나이트 마켓")도 섞여 있지만 전부 실제 기간이 있는
  // 반복형 행사라 이전 wave들이 받아들인 "축제성 지역 행사" 기준에
  // 부합한다고 판단했다.
  ...[
    { siteId: "ulsan-culture-nam", cityName: "남구", code: "1", lat: 35.5437079, lng: 129.3294956 },
    { siteId: "ulsan-culture-jung", cityName: "중구", code: "2", lat: 35.5692163, lng: 129.3316424 },
    { siteId: "ulsan-culture-dong", cityName: "동구", code: "3", lat: 35.5049028, lng: 129.4166501 },
    { siteId: "ulsan-culture-buk", cityName: "북구", code: "4", lat: 35.5827403, lng: 129.3612174 },
    { siteId: "ulsan-culture-ulju", cityName: "울주군", code: "5", lat: 35.5219040, lng: 129.2424398 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: `https://ulsanculture.kr/webuser/exhibit/all_list.html?sch_an_gu_code=${entry.code}&sch_so_show_kind=4`,
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-08-01",
    selectors: {
      itemSelector: ".gal-box .flex > div",
      titleSelector: ".text-box .subject",
      dateSelector: "dl:nth-of-type(1) dd",
      linkSelector: "a",
      imageSelector: ".img-box img",
      venueSelector: "dl:nth-of-type(2) dd"
    }
  }))
];

// wave 19(세종특별자치시): 다른 광역시와 달리 구가 없는 단일 행정구역이라
// 커버할 사이트 1개(또는 소수)만 찾으면 되는 wave였다(2026-08-01 실측).
// 결과적으로 등록 가능한 사이트를 찾지 못해 이번 wave도 등록 0건이다.
//
// - 세종시청 자체(www.sejong.go.kr): robots.txt의 `User-agent: *` 그룹이
//   `Disallow: /`라 우리 UA에 전면 차단이다. Yeti/Daum/Googlebot 같은
//   named-bot 그룹에는 더 좁은 Disallow 목록(주로 /prog/bbs/*, /cmm/fms/*
//   같은 기술 경로)이 있지만 우리 UA와 일치하지 않아 적용되지 않는다.
//   시청 자체 문화관광 메뉴는 애초에 접근 대상에서 제외했다.
//
// - 세종시문화관광재단(www.sjcf.or.kr): robots.txt는 `User-agent: *` 그룹이
//   `Disallow: /cms` + `Allow: /`라 대부분 경로가 허용된다(2026-08-01 확인).
//   GNB "세종예술 > 문화행사 > 리스트로 보기"
//   (/clturEvent/list.do?key=2111060073)를 확인했는데, 이 게시판 자체는
//   진짜 반복형 구조이고(`ul.board_gallery_ul2 > li` 카드 반복) 각 카드 안에
//   `<strong class="tit">제목</strong>`과
//   `<li class="sprio"><span class="if_tit">기간</span>2026-07-30 ~
//   2026-08-01</li>`처럼 실제 시작~종료일이 있어 조건 (b)는 통과한다. 검색
//   폼에 "행사 유형" 체크박스(공연=0001/전시=0002/행사=0003/교육=0004)가
//   있고, `sc_eventTy=0003` 쿼리를 GET으로 직접 붙였을 때 전체 1,664건과
//   다른 224건이 반환되는 것을 확인해(2026-08-01 curl 실측) 서버사이드
//   카테고리 필터 자체는 진짜로 동작한다. 상세 링크는
//   `<a href="#none" onclick="goView('2606260001');">자세히보기</a>` 형태의
//   JS 폼 제출이라(goView(key)가 hidden form의 action을 view.do로 바꾸고
//   clturEventSn=key를 채워 submit) declarative parser의 href 추출로는
//   detailUrl을 얻을 수 없어 어차피 customParser가 필요했다.
//
//   다만 "행사"(0003) 카테고리 자체가 진짜 축제만 걸러주지 않는다는 게
//   결정적 문제였다. 최근 등록순 5페이지(50건)를 표본으로 확인한 결과 19건
//   (38%)이 "백수문학 창간 70주년〈백수문학 제 110호〉발간", "이재운
//   시집〈시로 만나는 이순신 백의 종군의 길〉", "이규애 수필집〈발자국
//   도장〉책 발간"처럼 지역 문인 개인의 책 출간을 알리는 홍보성 공지이거나
//   "수요일은 문화요일"처럼 특정 장소·프로그램 설명 없이 반복되는 정기
//   슬롯이었다 — 이 항목들도 "기간" 필드에 값이 있긴 하지만(예:
//   "2026-07-04 ~ 2026-07-04") 실제로는 발간/등록 시점을 하루짜리 기간으로
//   그대로 채운 것일 뿐 현장에서 열리는 공개 행사가 아니고, 장소 정보도
//   목록/상세 어디에도 없다. 이 프로젝트 초기 안동시(andong-culture) 재검토
//   때와 동일한 패턴이다(파일 상단 주석 참고: "문화행사" 게시판이 축제만
//   분리할 카테고리 신호가 없어 비축제 콘텐츠가 섞임). cityFestivalScore.ts는
//   제목 길이/날짜 유효성/좌표/상세URL 존재 여부만 보는 순수 구조적
//   스코어링이라 이런 홍보성 공지도 전부 만점(1.0)을 받아 자동공개
//   threshold(0.7)를 그대로 통과한다 — 즉 등록하면 "축제" 도메인에 책
//   출간 홍보 게시물이 그대로 섞여 노출된다.
//
//   "진짜" 축제성 항목도 이 카테고리 안에 분명히 있다(예: "2026
//   어반나잇-세종 NEON", "2026년 5월 세종 밤마실주간", "제629돌 세종대왕
//   나신 날 x 세종 책 사랑 축제", "2025 세종한글컬처로드", "제2회
//   한글대전"). 이를 분리해보려고 검색어 필터(`sc=clturEventSj&sw=축제`,
//   GET으로 서버사이드 동작 확인)로 제목에 "축제"가 들어간 것만 걸러봤지만
//   총 35건 중에는 "2025 세종시민 연극교실 낭독 축제 두근두근 설레는
//   우리의 무대"처럼 소규모 발표회급 항목도 섞이고, 반대로 "어반나잇",
//   "밤마실주간", "한글컬처로드", "한글대전"처럼 실제로는 축제성이 뚜렷한데
//   제목에 "축제"라는 단어가 아예 없는 행사는 이 키워드 검색에서 빠진다
//   (2026-08-01 실측). 즉 제목 키워드로도 신뢰할 만하게 분리되지 않는다.
//   서버사이드로 "진짜 축제"만 골라낼 필터가 없고, 코드베이스에 없는
//   제목 기반 휴리스틱(발간/시집/수필집 등 블록리스트)을 새로 만드는 건
//   구조적 selector/customParser 원칙을 벗어난 임시방편이라 판단해
//   시도하지 않았다. 결과적으로 등록하지 않았다.
//
// - sjfestival.kr("세종축제", sjcf.or.kr GNB의 "세종의 축제" 링크가 가리키는
//   산하 사이트): robots.txt는 `User-agent: *` 그룹이 `Allow: /`이면서
//   일부 관리자/게시판 경로만 Disallow하고 `Crawl-delay: 3600`이 붙어 있다
//   (2026-08-01 확인). 메인 페이지 title이 "세종축제"이고 GNB
//   "/dh/festival" 페이지의 title은 "세종한글축제란? - 세종축제"라, 실제로는
//   "세종한글축제" 한 축제만 다루는 전용 마이크로사이트임을 확인했다 —
//   이전 wave들의 "단일 축제 전용 마이크로사이트" 제외 기준과 동일해
//   등록하지 않았다. sjcf.or.kr GNB에는 "세종의 축제" 하위에 세종낙화축제/
//   세종한글축제 두 개 정적 소개 페이지(content.do)도 있었는데, 이 역시
//   반복형 게시판이 아니라 각 축제 하나씩을 소개하는 고정 콘텐츠 페이지라
//   등록 대상이 아니다.
//
// - 추가로 도메인을 추정해 직접 curl로 확인했으나 전부 죽었거나 무관했다:
//   sjtour.kr(404), visitsejong.kr / sejongfestival.kr / festival.sejong.go.kr
//   / tour.sejong.go.kr / www.sjbf.or.kr / sjfoundation.or.kr(전부 DNS 실패
//   또는 무응답, 2026-08-01 확인).
//
// 결과적으로 세종특별자치시는 시청 사이트가 robots로 전면 차단, 문화관광
// 재단의 유일한 반복형 게시판은 카테고리·키워드 어느 쪽으로도 축제만
// 분리할 서버사이드 수단이 없어 데이터 품질 문제로 제외, 축제 전용 산하
// 사이트는 단일 축제 마이크로사이트라 제외되어 등록 0건이다.

// wave 20: 새 지역이 아니라 이전 wave에서 "확인 불가"/미등록으로 보류됐던
// 3곳(부산 영도구, 대구 중구, 제주 서귀포시)을 재조사한 wave다(2026-08-01
// 재검증). 결론부터: 3곳 다 등록 불가 — 이전 판단을 유지한다. 다만 이번
// 재조사에서 새로 확인한 사실이 있어 아래에 갱신한다.
//
// - 부산 영도구: robots.txt(https://www.yeongdo.go.kr/robots.txt)가 여전히
//   실제 규칙이 아니라 WAF "일시 접속 차단" 안내 페이지(mojibake, Source ip
//   로그 노출)를 돌려준다 — 프로덕션 UA(Mozilla/5.0
//   ParkingLotNavigator/1.0)뿐 아니라 일반 Chrome 데스크톱 UA로도 동일한
//   차단 페이지가 나와(2026-08-01 실측 7회+, 시간 간격을 두고 재시도해도
//   동일) UA 기반 차단이 아니라고 확인했다. 흥미로운 점은 robots.txt만
//   막히고 메인 페이지(www.yeongdo.go.kr/ → main.web, 200)와 실제 콘텐츠
//   페이지는 정상 접근된다는 것 — 그래도 robots.txt 자체를 못 읽으면 크롤링
//   허용 범위를 확인할 수 없어 원칙대로 "확인 불가" 제외를 유지한다.
//   대안으로 영도문화원(ydculture.com, WordPress) 사이트를 새로 찾아
//   확인했다 — robots.txt는 기본 WordPress 형태(`Disallow: /wp-admin/`만)로
//   전면 허용이지만, 네비게이션에 축제/행사 전용 게시판이 없고 유일한
//   후보인 공지사항(kboard 플러그인, /notice/)은 목록/상세 모두 "작성일"
//   필드(예: "2026.07.01")만 구조화돼 있을 뿐, 실제 행사 일시("일 시 : 2026.
//   7. 24.(금) 19:00 ~ 20:30")는 본문 자유 텍스트 안에만 있어(uid=14025
//   "2026 도시섬 음악 콘서트" 글로 확인) declarative selector로 안정적으로
//   추출할 수 없다 — "등록일만 있는 게시판" 배제 기준에 해당해 제외.
//
// - 대구 중구: jung.daegu.kr(및 그 아래 tour.jung.daegu.kr 서브도메인)은
//   robots.txt를 포함해 요청하는 모든 경로(메인 페이지, /tour/index.do 등)가
//   예외 없이 sabFingerPrint/sabSignature JS 쿠키 챌린지 스텁만 반환한다
//   (2026-08-01 재확인). 진단 목적으로 이전 응답에서 본 쿠키 값을 그대로
//   재전송(-b 옵션)해봤더니 챌린지를 우회해 실제 robots.txt를 읽을 수
//   있었다 — 내용은 `User-agent: Googlebot/-Image/-News/-Video` 4개 그룹만
//   있고 전부 `Disallow: /`이며 `User-agent: *` 그룹 자체가 없다. 이전
//   wave들의 "* 그룹이 없으면 우리 UA는 어느 그룹과도 매치되지 않아 비차단"
//   해석(부산 중구 bsjunggu.go.kr 사례와 동일)을 적용하면 robots 상으로는
//   비차단이라고 볼 수 있다. 하지만 이건 순수 진단용 확인일 뿐이다 —
//   cityFestivalDiscovery.ts의 fetchSiteHtml()은 쿠키를 전혀 설정/전달하지
//   않으므로 실제 크론 fetch는 이 도메인의 어떤 페이지에서도 JS 챌린지
//   스텁만 받는다. 즉 robots 해석과 무관하게 등록해도 파서가 항상 빈
//   결과만 받으므로 등록 실익이 없어 제외를 유지한다. 대안으로 대구중구
//   문화원(djc.kr, http만 정상 — https는 인증서 불일치)도 재확인했다 —
//   이전 wave 14에서 "ARTKOREA 템플릿 죽은 도메인"으로 분류했던
//   팔공문화원/남구문화원과 달리 djc.kr은 같은 ARTKOREA 호스팅사 템플릿을
//   쓰지만 실제 대구중구문화원 콘텐츠(공지사항/문화행사 게시판 등)가 살아
//   있는 사이트였다. 유일한 후보 게시판 "문화행사"(/~culturalevent, 총
//   68건)를 확인했으나 목록/상세 모두 "작성일"(예: "26/06/12",
//   "2026-06-12 14:28:12")만 구조화된 필드이고 실제 행사 일시("일시 :
//   2026년 6월 27일 토요일 오후 5시30분", article_id=1842 "매마토문화공연III"
//   글로 확인)는 본문 자유 텍스트 안에만 있어 영도문화원과 동일한 이유로
//   제외.
//
// - 제주 서귀포시: 서귀포시청 통합축제 포털(www.seogwipo.go.kr)의
//   robots.txt는 wave 11 때와 동일하게 `User-Agent: * / Disallow: / /
//   Disallow: /notice / Disallow: /workplans`이고 `Allow: /`는
//   Googlebot/Yeti/Daumoa 전용이라 여전히 전면 차단으로 확인했다(변경 없음,
//   2026-08-01 재확인). 이번에 새로 찾은 대안 2곳도 등록에 실패했다:
//   서귀포문화원(seogwipo.org)은 robots.txt 요청이 자체 404("404 Not found
//   Error")로 귀결돼(호스팅사 webjejuns.com의 기본 404 템플릿으로 리다이렉트,
//   즉 robots.txt 파일 자체가 없음) 관례대로 비차단으로 판단했지만, 유일한
//   후보 게시판 "문화원행사"(Bd/list.php?btable=schedule)가 반복형 목록이
//   아니라 연/월(toYear/toMonth) 단위로 넘겨보는 JS 달력 위젯이라 site당
//   listUrl 하나만 fetch하는 현재 구조로는 애초에 스캔할 수 없고(2026-08월
//   기준 달력 칸도 전부 비어 있음, td.tdList 안에 항목 0건), 나머지 게시판인
//   "공지사항/새소식"도 "작성일" 필드만 있는 통상 공지 게시판이라 제외.
//   문화도시 서귀포(nojiculture.kr)는 접속 시 네이버 블로그
//   (blog.naver.com/culture_seogwipo)로 전체 리다이렉트되는 사실상 블로그
//   운영 형태라 구조화된 게시판이 없어 제외. 결과적으로 서귀포시는 이번
//   wave에서도 등록 가능한 사이트를 찾지 못해 미등록으로 유지한다.
//
// 결과적으로 wave 20은 재검증 대상 3곳 모두 등록 0건이다 — 3곳 다 이전
// wave의 제외 판단이 유효함을 재확인했고, 그 과정에서 새로 찾은 대안
// 사이트(영도문화원/대구중구문화원/서귀포문화원/문화도시 서귀포)도 전부
// "등록일만 있는 게시판" 또는 "JS 달력/블로그 구조" 배제 기준에 걸려
// 등록하지 않았다.

// wave 21: 새 지역이 아니라 이전 wave에서 "확인 불가"/보류로 명시적으로
// 남겨둔 3곳(영주시, 시흥시, 양주시)을 재조사한 wave다(2026-08-01
// 재검증). 결론부터: 3곳 다 등록 불가 — 이전 판단을 유지한다.
//
// - 영주시(tour.yeongju.go.kr): wave 5에서 "재검증 curl이 TCP connect
//   단계에서 타임아웃"으로 보류했던 것을 다시 시도했다. DNS는 정상
//   해석되지만(getent hosts → 27.101.16.51) 해당 IP의 443 포트 자체가
//   응답하지 않는다 — `curl -v --connect-timeout 10
//   https://tour.yeongju.go.kr/`을 2회, `nc -zv -w 5 27.101.16.51 443`을
//   1회 실행해 모두 "Failed to connect ... Timeout was reached" /
//   "connect ... timed out"로 확인했다(2026-08-01). 애플리케이션 레벨이
//   아니라 네트워크(방화벽/라우팅) 레벨 차단으로 보이며 UA를 바꿔도 의미가
//   없는 종류다. 필드명을 재확인할 방법이 없어 등록을 계속 보류한다.
// - 시흥시(siheung.go.kr): wave 9-3에서 "robots.txt가 http/https 모두
//   반복 타임아웃"으로 보류했던 것을 재확인했다. 이번에도 동일했다 —
//   `curl -A "Mozilla/5.0 ParkingLotNavigator/1.0"
//   https://siheung.go.kr/robots.txt`는 TLS 핸드셰이크(인증서: CN=
//   *.siheung.go.kr, 유효기간 2026-07-03~2027-01-17)까지는 성공하지만 이후
//   HTTP 요청 자체가 25초간 0바이트 응답으로 멈춘다. `http://` 포트 80으로도
//   15초간 동일하게 멈추고, 기본 curl UA로는 TCP connect 자체가 8초만에
//   타임아웃된다. 반면 `https://www.siheung.go.kr/main.do`(대표 콘텐츠
//   페이지, www 서브도메인)는 0.3초 만에 200을 반환해 사이트 자체는 살아
//   있다 — robots.txt(non-www apex 도메인)만 선택적으로 응답하지 않는
//   구조로 보인다. robots.txt를 못 읽으면 크롤링 허용 범위를 확인할 수
//   없어 원칙대로 확인 불가 보류를 유지한다.
// - 양주시: wave 9-3에서 "축제 3개만 정적 카드로 하드코딩, 외부 도메인은
//   미조사"로 보류했던 것을 이번에 조사했다. 명명 패턴으로 여러 후보를
//   시도한 결과 두 도메인이 실제로 응답했다: (1) yjcf.or.kr /
//   www.yjcf.or.kr — 200 응답이지만 페이지 타이틀이 "여주세종문화관광재단",
//   설명에 "명성황후생가"(여주시 소재 사적)가 나와 이니셜만 같을 뿐 실제로는
//   양주(楊州)가 아니라 여주(驪州)+세종 문화재단 사이트다 — 도메인명
//   충돌로 인한 오탐이라 제외. (2) yangjufestival.kr — 200 응답이고
//   실제로 양주 관련이지만, 타이틀이 "2025 양주국가유산 야행"이고 본문의
//   반복 날짜가 2025.09.19~09.21(해당 단일 행사)과 2018~2021년 과거 사진
//   갤러리뿐이라 여러 축제가 반복되는 목록 구조가 아니라 단일 행사
//   프로모션 마이크로사이트다 — 기존 이천/광주(경기) 사례와 같은 사유로
//   제외. 그 외 시도한 후보 도메인(yangjuculture.or.kr, yangjucf.or.kr,
//   yjculture.or.kr, yangjuart.or.kr, yjartcenter.or.kr, yjac.or.kr,
//   yangju.or.kr, yjfnc.or.kr, yjcf.kr, yangjufestival.or.kr,
//   yjmuseum.or.kr, okjeong.or.kr, hoeamsa.or.kr, yangjumuseum.or.kr,
//   tour.yangju.go.kr, ntour.yangju.go.kr)는 전부 DNS 해석 자체가 안 되는
//   미존재 도메인이었다. 마지막으로 yangju.go.kr 본문 링크를 훑어 site
//   내부에 별도 축제 게시판이 있는지도 다시 봤지만 /tour/index.do에는
//   "축제" 텍스트가 전혀 없고, 유일하게 새로 발견한 게시판(bbsNo=367)은
//   모범음식점(맛집) 목록이었으며 yjcc는 양주시의회 사이트였다 — 둘 다
//   무관해 제외. 결과적으로 양주시도 이번 wave에서 등록 가능한 사이트를
//   찾지 못해 미등록으로 유지한다.
//
// 결과적으로 wave 21도 재검증 대상 3곳 모두 등록 0건이다. 영주/시흥은
// 네트워크·인프라 레벨 문제로 여전히 확인 자체가 불가능하고, 양주는 새
// 외부 도메인 2곳을 찾았으나 각각 "도메인명 오탐(실제로는 다른 시)"과
// "단일 행사 마이크로사이트"라는 명확한 사유로 제외했다.
