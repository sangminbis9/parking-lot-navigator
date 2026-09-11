// 대표 지역의 행사 콘텐츠 밀도·품질을 production API로 점검하는 read-only 진단 스크립트.
//
// 출시 전 "그 지역을 열었을 때 앱이 비어 보이는가"를 눈이 아니라 숫자로 확인하려고 만들었다.
// 쓰기는 하나도 하지 않는다. 공개 GET 엔드포인트만 부른다.
//
//   node worker-backend/scripts/content-quality-report.mjs
//   RADIUS_KM=30 UPCOMING_DAYS=90 node worker-backend/scripts/content-quality-report.mjs
//   FORMAT=json node worker-backend/scripts/content-quality-report.mjs > report.json

import process from "node:process";

const BASE_URL = process.env.API_BASE_URL ?? "https://parking-lot-navigator-api.parkingnav.workers.dev";
const RADIUS_METERS = Math.round(Number(process.env.RADIUS_KM ?? 20) * 1000);
const UPCOMING_DAYS = Number(process.env.UPCOMING_DAYS ?? 180);
const FORMAT = process.env.FORMAT ?? "text";

// 요청 지역. 좌표는 각 시청 기준이다.
const REGIONS = [
  { name: "서울", lat: 37.5663, lng: 126.9779 },
  { name: "인천", lat: 37.4563, lng: 126.7052 },
  { name: "수원", lat: 37.2636, lng: 127.0286 },
  { name: "부산", lat: 35.1796, lng: 129.0756 },
  { name: "대구", lat: 35.8714, lng: 128.6014 }
];

const TODAY = new Date().toISOString().slice(0, 10);

async function getJson(path, params) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

/** 지구 반지름 근사. 반경 밖 좌표를 잡아내는 용도라 정밀도는 이 정도면 충분하다. */
function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

function auditFestivals(items, origin) {
  const issues = { noImage: [], badCoordinate: [], outOfRadius: [], thinDetail: [], staleEnded: [], badDate: [] };
  let ongoing = 0;
  let upcoming = 0;
  let ended = 0;
  const bySource = {};

  for (const item of items) {
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;

    if (item.status === "ongoing") ongoing += 1;
    else if (item.status === "upcoming") upcoming += 1;
    else ended += 1;

    const images = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
    if (images.length === 0) issues.noImage.push(item.title);

    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng) || (item.lat === 0 && item.lng === 0)) {
      issues.badCoordinate.push(item.title);
    } else {
      const meters = distanceMeters(origin, item);
      // API가 반경으로 걸러 주는데도 넘는 항목은 좌표가 잘못 붙은 것이다.
      if (meters > RADIUS_METERS * 1.1) issues.outOfRadius.push(`${item.title} (${Math.round(meters / 1000)}km)`);
    }

    // 상세 화면에서 제목 말고 보여 줄 게 없는 행사.
    const hasBody = (item.description ?? "").trim().length >= 20;
    const hasPlace = Boolean((item.venueName ?? "").trim() || (item.address ?? "").trim());
    if (!hasBody && !hasPlace) issues.thinDetail.push(item.title);

    if (!item.startDate || !item.endDate || Number.isNaN(Date.parse(item.startDate)) || Number.isNaN(Date.parse(item.endDate))) {
      issues.badDate.push(item.title);
    } else {
      if (Date.parse(item.endDate) < Date.parse(item.startDate)) issues.badDate.push(`${item.title} (종료<시작)`);
      // 이미 끝난 지 오래인데도 목록에 남아 있는 행.
      if (daysBetween(item.endDate, TODAY) > 30) issues.staleEnded.push(`${item.title} (~${item.endDate})`);
    }
  }

  return { total: items.length, ongoing, upcoming, ended, bySource, issues };
}

function auditLocalEvents(items, origin) {
  const issues = { noImage: [], badCoordinate: [], outOfRadius: [], thinDetail: [], staleEnded: [], blogTitle: [] };
  // 로컬 이벤트의 status는 진행 여부가 아니라 검수 상태(approved/pending)다. 진행 여부는 날짜로 센다.
  let ongoing = 0;

  for (const item of items) {
    const endDate = item.endDate ?? item.startDate;
    if (item.startDate <= TODAY && endDate >= TODAY) ongoing += 1;

    // 블로그 글 제목이 그대로 들어온 항목. 목록에서 무슨 이벤트인지 읽히지 않는다.
    if (item.title.length > 30 || /[|()]/.test(item.title)) issues.blogTitle.push(item.title);

    const images = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
    if (images.length === 0) issues.noImage.push(item.title);

    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng) || (item.lat === 0 && item.lng === 0)) {
      issues.badCoordinate.push(item.title);
    } else if (distanceMeters(origin, item) > RADIUS_METERS * 1.1) {
      issues.outOfRadius.push(item.title);
    }

    const hasBody = (item.benefit ?? "").trim().length > 0 || (item.shortDescription ?? "").trim().length >= 10;
    if (!hasBody) issues.thinDetail.push(item.title);

    if (item.endDate && !Number.isNaN(Date.parse(item.endDate)) && daysBetween(item.endDate, TODAY) > 30) {
      issues.staleEnded.push(`${item.title} (~${item.endDate})`);
    }
  }

  return { total: items.length, ongoing, issues };
}

function pct(part, whole) {
  if (whole === 0) return "-";
  return `${Math.round((part / whole) * 100)}%`;
}

function printRegion(report) {
  const { region, festivals, localEvents } = report;
  console.log(`\n## ${region.name} (반경 ${RADIUS_METERS / 1000}km)`);
  console.log(`- 축제/공연/박람회: 총 ${festivals.total} (진행중 ${festivals.ongoing} / 예정 ${festivals.upcoming} / 종료 ${festivals.ended})`);
  console.log(`- 로컬 매장 이벤트: 총 ${localEvents.total} (진행중 ${localEvents.ongoing})`);
  const sources = Object.entries(festivals.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
  console.log(`- 소스 분포: ${sources.join(", ") || "-"}`);
  const f = festivals.issues;
  console.log(`- 축제 품질: 이미지 없음 ${f.noImage.length} (${pct(f.noImage.length, festivals.total)}), 좌표 이상 ${f.badCoordinate.length}, 반경 밖 ${f.outOfRadius.length}, 상세 부족 ${f.thinDetail.length}, 날짜 이상 ${f.badDate.length}, 종료 30일 초과 ${f.staleEnded.length}`);
  const e = localEvents.issues;
  console.log(`- 이벤트 품질: 이미지 없음 ${e.noImage.length} (${pct(e.noImage.length, localEvents.total)}), 좌표 이상 ${e.badCoordinate.length}, 반경 밖 ${e.outOfRadius.length}, 혜택/설명 없음 ${e.thinDetail.length}, 제목이 블로그 글 제목 ${e.blogTitle.length}, 종료 30일 초과 ${e.staleEnded.length}`);
  for (const [label, list] of [["반경 밖 축제", f.outOfRadius], ["날짜 이상 축제", f.badDate], ["오래 지난 축제", f.staleEnded]]) {
    if (list.length > 0) console.log(`  · ${label}: ${list.slice(0, 5).join(" / ")}${list.length > 5 ? ` 외 ${list.length - 5}건` : ""}`);
  }
}

async function main() {
  const reports = [];
  for (const region of REGIONS) {
    const params = { lat: region.lat, lng: region.lng, radiusMeters: RADIUS_METERS };
    const [festivalRes, eventRes] = await Promise.all([
      getJson("/api/festivals", { ...params, upcomingWithinDays: UPCOMING_DAYS, pastWithinDays: 0 }),
      getJson("/api/local-events", params)
    ]);
    reports.push({
      region,
      festivals: auditFestivals(festivalRes.items ?? [], region),
      localEvents: auditLocalEvents(eventRes.items ?? [], region)
    });
  }

  if (FORMAT === "json") {
    console.log(JSON.stringify({ baseUrl: BASE_URL, radiusMeters: RADIUS_METERS, upcomingWithinDays: UPCOMING_DAYS, checkedAt: new Date().toISOString(), reports }, null, 2));
    return;
  }

  console.log(`# 행사 콘텐츠 품질 진단`);
  console.log(`- 대상: ${BASE_URL}`);
  console.log(`- 기준: 반경 ${RADIUS_METERS / 1000}km, 향후 ${UPCOMING_DAYS}일, ${new Date().toISOString()}`);
  for (const report of reports) printRegion(report);
}

await main();
