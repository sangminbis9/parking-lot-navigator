import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 부산 중구(bsjunggu.go.kr) "한눈에 보는 축제문화행사"는 시기/행사명/기간/장소
// 4열 표 하나에 연간 일정을 담고 있다(2026-07-31 확인). 시기 열(봄/여름/가을/
// 겨울)은 계절별로 rowspan이 걸려 있고, 원본 HTML 일부 행(겨울 두 번째 행인
// "조선통신사행렬약식재현" 11.22 행)은 <tr> 여는 태그가 빠진 채로 응답된다.
// 브라우저는 이를 보정해 렌더링하지만, 우리 파서는 <tr>/<th> 경계에 기대지
// 않고 표 전체의 <td>를 등장 순서대로 3개씩(행사명/기간/장소) 묶어서 읽는다
// (2026-07-31 실측: 시기 열은 <th>라 <td> 집계에서 자동으로 빠지고, 전체
// <td> 개수가 25행 x 3열 = 75개로 정확히 나누어떨어짐을 확인).
//
// 기간 열 형식은 "4.7.(월)~5.6.(화)"(월.일, 트리거는 표 h2의 연도),
// "9.18(목)~9.21(일)"(요일 앞 마침표가 없는 행도 섞여 있음),
// "9.12.(금)~13.(토)"(종료일이 일자만 있으면 시작 월을 물려받음),
// "6.28.(토)/8.9.(토)"(같은 행사가 여러 날 열리는 경우, 첫날~마지막날을
// 구간으로 취급), "25.12.5.(금)~26.2.22.(일)"(2자리 연도까지 명시된
// 연도교차 항목), "9.11.(목) 17:30"(시각이 붙는 행) 6가지가 섞여 있어
// 괄호(요일)와 "H:MM" 시각을 먼저 제거한 뒤 "."로 쪼개 자릿수로 판별한다.
// "11월 중"처럼 일자가 없는 행은 실제 날짜 필드가 아니므로 제외한다.
//
// 주의: 이 페이지는 2026-07-31 현재도 "2025년 문화관광 행사일정"을 그대로
// 보여주고 있어(구청이 아직 2026년판으로 갱신 전) 등록 시점 기준으로는
// 표 안의 모든 항목이 이미 지난 날짜다(마지막 항목도 2026-02-22 종료).
// 구조와 파싱 로직은 실제 마크업으로 검증했으므로 등록해 두고, 구청이 다음
// 연도판으로 갱신하면 크론이 그대로 새 데이터를 수집한다.
export function parseBsjungguAnnualSchedule(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);

  // 페이지 첫 h2는 "통합검색"이라 연도가 없다 — "OOOO년 문화관광 행사일정"
  // 문구를 담은 h2를 찾아 연도를 뽑는다(2026-07-31 실측: 이 페이지는 h1이
  // "한눈에 보는 축제문화행사", 연도 문구는 그다음 h2).
  let baseYear = new Date().getFullYear();
  $("h2").each((_index, element) => {
    const match = $(element).text().match(/(\d{4})\s*년/);
    if (match) {
      baseYear = Number(match[1]);
      return false;
    }
  });

  const cells = $("table.t_typel td")
    .map((_index, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get();

  const results: RawCityFestivalCandidate[] = [];
  for (let i = 0; i + 2 < cells.length; i += 3) {
    const title = cells[i] || null;
    const periodRaw = cells[i + 1] ?? "";
    const venueRaw = cells[i + 2] || null;
    if (!title) continue;

    const range = parsePeriod(periodRaw, baseYear);
    if (!range) continue;

    results.push({
      title,
      startDateRaw: range.start,
      endDateRaw: range.end,
      venueRaw,
      addressRaw: null,
      detailUrl: null,
      imageUrl: null
    });
  }

  return results;
}

interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

function parsePeriod(raw: string, baseYear: number): { start: string; end: string } | null {
  const cleaned = raw.replace(/\s+/g, "");
  if (!cleaned) return null;
  // "11월중", "12월중"처럼 일자가 없는 항목은 실제 날짜 필드가 아니므로 제외
  if (/^\d{1,2}월중$/.test(cleaned)) return null;

  const [beforeTilde, afterTilde] = cleaned.split("~");
  const startToken = beforeTilde.split("/")[0];
  const start = parseOneDate(startToken, baseYear, null, null);
  if (!start) return null;

  let end: ParsedDate | null = null;
  if (afterTilde) {
    const tokens = afterTilde.split("/");
    end = parseOneDate(tokens[tokens.length - 1], baseYear, start.year, start.month);
  } else {
    const tokens = beforeTilde.split("/");
    if (tokens.length > 1) {
      end = parseOneDate(tokens[tokens.length - 1], baseYear, start.year, start.month);
    }
  }
  if (!end) end = start;

  return { start: formatDate(start), end: formatDate(end) };
}

function parseOneDate(
  rawToken: string,
  baseYear: number,
  inheritYear: number | null,
  inheritMonth: number | null
): ParsedDate | null {
  const token = rawToken.replace(/\([^)]*\)/g, "").replace(/\d{1,2}:\d{2}/g, "");
  const parts = token.split(".").filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  if (parts.length >= 3) {
    const yy = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isFinite(yy) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const year = yy < 100 ? 2000 + yy : yy;
    return { year, month, day };
  }
  if (parts.length === 2) {
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year: inheritYear ?? baseYear, month, day };
  }
  const day = Number(parts[0]);
  if (!Number.isFinite(day) || inheritMonth == null) return null;
  return { year: inheritYear ?? baseYear, month: inheritMonth, day };
}

function formatDate(d: ParsedDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}
