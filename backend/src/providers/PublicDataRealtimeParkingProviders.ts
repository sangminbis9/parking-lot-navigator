import type { ParkingSearchOptions } from "@parking/shared-types";
import type { AppConfig } from "../config/env.js";
import { distanceMeters } from "../services/geo.js";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

const DAEJEON_PAGE_SIZE = 50;
const DAEJEON_MAX_ROWS = 1000;

export class DaejeonRealtimeParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "daejeon-realtime";

  constructor(private readonly config: AppConfig) {
    super("daejeon-realtime");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.PUBLIC_DATA_SERVICE_KEY) {
      this.markFailure(new Error("PUBLIC_DATA_SERVICE_KEY is not configured."));
      return [];
    }

    try {
      const rows = await fetchAllDaejeonRows(this.config);
      const mapped = rows
        .map(mapDaejeonRow)
        .filter((item): item is RawParkingRecord & { lat: number; lng: number } => Boolean(item?.lat && item.lng))
        .filter((item) => distanceMeters(lat, lng, item.lat, item.lng) <= options.radiusMeters);
      this.markSuccess(mapped.length > 0 ? 0.86 : 0.5);
      return mapped;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

export class KacAirportRealtimeParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "kac-airport-realtime";

  constructor(private readonly config: AppConfig) {
    super("kac-airport-realtime");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.PUBLIC_DATA_SERVICE_KEY) {
      this.markFailure(new Error("PUBLIC_DATA_SERVICE_KEY is not configured."));
      return [];
    }

    try {
      const rows = await fetchKacAirportRows(this.config);
      const mapped = rows
        .map(mapKacAirportRow)
        .filter((item): item is RawParkingRecord & { lat: number; lng: number } => Boolean(item?.lat && item.lng))
        .filter((item) => distanceMeters(lat, lng, item.lat, item.lng) <= Math.max(options.radiusMeters, 3000));
      this.markSuccess(mapped.length > 0 ? 0.88 : 0.5);
      return mapped;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

export class IncheonAirportRealtimeParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "incheon-airport-realtime";

  constructor(private readonly config: AppConfig) {
    super("incheon-airport-realtime");
  }

  async fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.PUBLIC_DATA_SERVICE_KEY) {
      this.markFailure(new Error("PUBLIC_DATA_SERVICE_KEY is not configured."));
      return [];
    }

    try {
      const rows = await fetchIncheonAirportRows(this.config);
      const mapped = rows
        .map(mapIncheonAirportRow)
        .filter((item): item is RawParkingRecord & { lat: number; lng: number } => Boolean(item?.lat && item.lng))
        .filter((item) => distanceMeters(lat, lng, item.lat, item.lng) <= Math.max(options.radiusMeters, 6000));
      this.markSuccess(mapped.length > 0 ? 0.88 : 0.5);
      return mapped;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

interface DaejeonParkingRow {
  name?: string;
  lat?: string;
  lon?: string;
  address?: string;
  tel?: string;
  totalQty?: string;
  resQty?: string;
  type?: string;
  baseTime?: string;
  baseRate?: string;
  addTime?: string;
  addRate?: string;
  weekdayOpenTime?: string;
  weekdayCloseTime?: string;
  satOpenTime?: string;
  satCloseTime?: string;
  holidayOpenTime?: string;
  holidayCloseTime?: string;
  operDay?: string;
}

interface KacAirportRow {
  aprEng?: string;
  aprKor?: string;
  parkingAirportCodeName?: string;
  parkingFullSpace?: string;
  parkingGetdate?: string;
  parkingGettime?: string;
  parkingIstay?: string;
}

interface IncheonAirportResponse {
  response?: {
    body?: {
      items?: IncheonAirportRow[] | { item?: IncheonAirportRow[] | IncheonAirportRow };
    };
  };
}

interface IncheonAirportRow {
  floor?: string;
  parking?: string | number;
  parkingarea?: string | number;
  datetm?: string;
}

async function fetchAllDaejeonRows(config: AppConfig): Promise<DaejeonParkingRow[]> {
  const first = await fetchDaejeonPage(config, 1);
  const totalCount = Math.min(toNumber(first.totalCount) ?? first.rows.length, DAEJEON_MAX_ROWS);
  if (totalCount <= DAEJEON_PAGE_SIZE) return first.rows;

  const pages: number[] = [];
  for (let page = 2; page <= Math.ceil(totalCount / DAEJEON_PAGE_SIZE); page += 1) {
    pages.push(page);
  }
  const remaining = await Promise.all(pages.map((page) => fetchDaejeonPage(config, page)));
  return [...first.rows, ...remaining.flatMap((page) => page.rows)];
}

async function fetchDaejeonPage(
  config: AppConfig,
  pageNo: number
): Promise<{ rows: DaejeonParkingRow[]; totalCount: string | null }> {
  const text = await fetchDaejeonText(config, pageNo);
  return {
    rows: xmlItems(text).map((item) => ({
      name: xmlValue(item, "name"),
      lat: xmlValue(item, "lat"),
      lon: xmlValue(item, "lon"),
      address: xmlValue(item, "address"),
      tel: xmlValue(item, "tel"),
      totalQty: xmlValue(item, "totalQty"),
      resQty: xmlValue(item, "resQty"),
      type: xmlValue(item, "type"),
      baseTime: xmlValue(item, "baseTime"),
      baseRate: xmlValue(item, "baseRate"),
      addTime: xmlValue(item, "addTime"),
      addRate: xmlValue(item, "addRate"),
      weekdayOpenTime: xmlValue(item, "weekdayOpenTime"),
      weekdayCloseTime: xmlValue(item, "weekdayCloseTime"),
      satOpenTime: xmlValue(item, "satOpenTime"),
      satCloseTime: xmlValue(item, "satCloseTime"),
      holidayOpenTime: xmlValue(item, "holidayOpenTime"),
      holidayCloseTime: xmlValue(item, "holidayCloseTime"),
      operDay: xmlValue(item, "operDay")
    })),
    totalCount: xmlValue(text, "totalCount")
  };
}

async function fetchDaejeonText(config: AppConfig, pageNo: number): Promise<string> {
  const attempts = [
    { url: new URL("/6300000/pis/parkinglotIF", config.PUBLIC_DATA_BASE_URL), keyParam: "ServiceKey" },
    { url: new URL("/6300000/pis/parkinglotIF", config.PUBLIC_DATA_BASE_URL), keyParam: "serviceKey" },
    { url: new URL("http://apis.data.go.kr/6300000/pis/parkinglotIF"), keyParam: "ServiceKey" },
    { url: new URL("http://apis.data.go.kr/6300000/pis/parkinglotIF"), keyParam: "serviceKey" }
  ];
  let lastError: unknown;

  for (const { url, keyParam } of attempts) {
    url.searchParams.set(keyParam, config.PUBLIC_DATA_SERVICE_KEY ?? "");
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(DAEJEON_PAGE_SIZE));
    try {
      const text = await fetchText(url, "Daejeon realtime parking");
      ensureOpenApiXmlSuccess(text, "Daejeon realtime parking");
      return text;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Daejeon realtime parking API failed.");
}

function ensureOpenApiXmlSuccess(xml: string, label: string): void {
  const resultCode = xmlValue(xml, "resultCode");
  if (resultCode && resultCode !== "00" && resultCode !== "0") {
    throw new Error(`${label} API returned resultCode ${resultCode}: ${xmlValue(xml, "resultMsg") ?? "unknown error"}`);
  }
  if (!xml.includes("<item") && !xmlValue(xml, "totalCount")) {
    throw new Error(`${label} API returned an unexpected XML body.`);
  }
}

async function fetchKacAirportRows(config: AppConfig): Promise<KacAirportRow[]> {
  const url = new URL("http://openapi.airport.co.kr/service/rest/AirportParking/airportparkingRT");
  url.searchParams.set("serviceKey", config.PUBLIC_DATA_SERVICE_KEY ?? "");
  const text = await fetchText(url, "KAC airport realtime parking");
  return xmlItems(text).map((item) => ({
    aprEng: xmlValue(item, "aprEng"),
    aprKor: xmlValue(item, "aprKor"),
    parkingAirportCodeName: xmlValue(item, "parkingAirportCodeName"),
    parkingFullSpace: xmlValue(item, "parkingFullSpace"),
    parkingGetdate: xmlValue(item, "parkingGetdate"),
    parkingGettime: xmlValue(item, "parkingGettime"),
    parkingIstay: xmlValue(item, "parkingIstay")
  }));
}

async function fetchIncheonAirportRows(config: AppConfig): Promise<IncheonAirportRow[]> {
  const url = new URL("/B551177/StatusOfParking/getTrackingParking", config.PUBLIC_DATA_BASE_URL);
  url.searchParams.set("serviceKey", config.PUBLIC_DATA_SERVICE_KEY ?? "");
  url.searchParams.set("numOfRows", "50");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("type", "json");
  const response = await fetch(url, defaultFetchOptions());
  if (!response.ok) throw new Error(`Incheon airport parking API failed: ${response.status}`);
  const body = (await response.json()) as IncheonAirportResponse;
  const items = body.response?.body?.items;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
}

function mapDaejeonRow(row: DaejeonParkingRow): RawParkingRecord | null {
  if (!row.name) return null;
  const lat = toNumber(row.lat);
  const lng = toNumber(row.lon);
  if (lat === null || lng === null) return null;
  return {
    source: "daejeon-realtime",
    sourceParkingId: stableId(`${row.name}|${row.address ?? ""}|${lat}|${lng}`),
    name: row.name,
    address: row.address ?? null,
    lat,
    lng,
    totalCapacity: toNumber(row.totalQty),
    availableSpaces: toNumber(row.resQty),
    realtimeAvailable: toNumber(row.resQty) !== null,
    freshnessTimestamp: new Date().toISOString(),
    operatingHours: formatDaejeonHours(row),
    feeSummary: formatFee(row.type, row.baseTime, row.baseRate, row.addTime, row.addRate),
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    rawSourcePayload: row
  };
}

function mapKacAirportRow(row: KacAirportRow): RawParkingRecord | null {
  const airport = airportByName(row.aprKor, row.aprEng);
  if (!airport || !row.parkingAirportCodeName) return null;
  const totalCapacity = toNumber(row.parkingFullSpace);
  const parked = toNumber(row.parkingIstay);
  const availableSpaces =
    totalCapacity !== null && parked !== null ? Math.max(0, totalCapacity - parked) : null;
  const coords = offsetCoordinates(airport.lat, airport.lng, row.parkingAirportCodeName);
  return {
    source: "kac-airport-realtime",
    sourceParkingId: `${airport.code}:${stableId(row.parkingAirportCodeName)}`,
    name: `${airport.name} ${row.parkingAirportCodeName}`,
    address: airport.address,
    lat: coords.lat,
    lng: coords.lng,
    totalCapacity,
    availableSpaces,
    realtimeAvailable: availableSpaces !== null,
    freshnessTimestamp: parseKacTimestamp(row.parkingGetdate, row.parkingGettime),
    operatingHours: "24시간",
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    rawSourcePayload: row
  };
}

function mapIncheonAirportRow(row: IncheonAirportRow): RawParkingRecord | null {
  if (!row.floor) return null;
  const totalCapacity = toNumber(row.parkingarea);
  const parked = toNumber(row.parking);
  const availableSpaces =
    totalCapacity !== null && parked !== null ? Math.max(0, totalCapacity - parked) : null;
  const base = incheonTerminalCoordinates(row.floor);
  const coords = offsetCoordinates(base.lat, base.lng, row.floor);
  return {
    source: "incheon-airport-realtime",
    sourceParkingId: stableId(row.floor),
    name: `인천국제공항 ${row.floor}`,
    address: base.address,
    lat: coords.lat,
    lng: coords.lng,
    totalCapacity,
    availableSpaces,
    realtimeAvailable: availableSpaces !== null,
    freshnessTimestamp: parseCompactTimestamp(row.datetm),
    operatingHours: "24시간",
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    rawSourcePayload: row
  };
}

async function fetchText(url: URL, label: string): Promise<string> {
  const response = await fetch(url, defaultFetchOptions());
  if (!response.ok) throw new Error(`${label} API failed: ${response.status}`);
  return response.text();
}

function defaultFetchOptions(): RequestInit {
  return {
    headers: {
      "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
      Accept: "application/json,application/xml,text/xml,text/plain,*/*"
    }
  };
}

function xmlItems(xml: string): string[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map((match) => match[1] ?? "");
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1] ? decodeXml(match[1].trim()) : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function formatDaejeonHours(row: DaejeonParkingRow): string | null {
  const parts = [
    formatHoursPart("평일", row.weekdayOpenTime, row.weekdayCloseTime),
    formatHoursPart("토요일", row.satOpenTime, row.satCloseTime),
    formatHoursPart("공휴일", row.holidayOpenTime, row.holidayCloseTime)
  ].filter((item): item is string => Boolean(item));
  if (parts.length > 0) return parts.join(", ");
  return row.operDay ?? null;
}

function formatHoursPart(label: string, open?: string, close?: string): string | null {
  if (!open || !close) return null;
  return `${label} ${open}-${close}`;
}

function formatFee(
  type?: string,
  baseTime?: string,
  baseRate?: string,
  addTime?: string,
  addRate?: string
): string | null {
  if (type?.includes("무료")) return "무료";
  const baseMinutes = toNumber(baseTime);
  const baseFee = toNumber(baseRate);
  const addMinutes = toNumber(addTime);
  const addFee = toNumber(addRate);
  if (baseFee === null || baseMinutes === null) return type ?? null;
  const addText = addFee !== null && addMinutes !== null ? `, 추가 ${addMinutes}분 ${addFee.toLocaleString("ko-KR")}원` : "";
  return `기본 ${baseMinutes}분 ${baseFee.toLocaleString("ko-KR")}원${addText}`;
}

function parseKacTimestamp(date?: string, time?: string): string | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCompactTimestamp(value?: string): string | null {
  if (!value || value.length < 14) return null;
  const parsed = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function offsetCoordinates(lat: number, lng: number, key: string): { lat: number; lng: number } {
  const hash = Number.parseInt(stableId(key), 36);
  const angle = (hash % 360) * (Math.PI / 180);
  const radius = 0.0018 + (hash % 4) * 0.0003;
  return {
    lat: lat + Math.sin(angle) * radius,
    lng: lng + Math.cos(angle) * radius
  };
}

const AIRPORTS = [
  { code: "GMP", names: ["김포", "GIMPO"], name: "김포국제공항", address: "서울 강서구 하늘길 112", lat: 37.5583, lng: 126.7906 },
  { code: "PUS", names: ["김해", "GIMHAE"], name: "김해국제공항", address: "부산 강서구 공항진입로 108", lat: 35.1795, lng: 128.9382 },
  { code: "CJU", names: ["제주", "JEJU"], name: "제주국제공항", address: "제주특별자치도 제주시 공항로 2", lat: 33.5104, lng: 126.4914 },
  { code: "TAE", names: ["대구", "DAEGU"], name: "대구국제공항", address: "대구 동구 공항로 221", lat: 35.8995, lng: 128.6378 },
  { code: "KWJ", names: ["광주", "GWANGJU"], name: "광주공항", address: "광주 광산구 상무대로 420-25", lat: 35.1264, lng: 126.8089 },
  { code: "CJJ", names: ["청주", "CHEONGJU"], name: "청주국제공항", address: "충북 청주시 청원구 내수읍 오창대로 980", lat: 36.7166, lng: 127.4987 },
  { code: "RSU", names: ["여수", "YEOSU"], name: "여수공항", address: "전남 여수시 율촌면 여순로 386", lat: 34.8423, lng: 127.6168 },
  { code: "USN", names: ["울산", "ULSAN"], name: "울산공항", address: "울산 북구 산업로 1103", lat: 35.5935, lng: 129.3520 },
  { code: "KUV", names: ["군산", "GUNSAN"], name: "군산공항", address: "전북 군산시 옥서면 산동길 2", lat: 35.9038, lng: 126.6159 },
  { code: "WJU", names: ["원주", "WONJU"], name: "원주공항", address: "강원 횡성군 횡성읍 횡성로 38", lat: 37.4381, lng: 127.9600 },
  { code: "YNY", names: ["양양", "YANGYANG"], name: "양양국제공항", address: "강원 양양군 손양면 공항로 201", lat: 38.0613, lng: 128.6692 },
  { code: "HIN", names: ["사천", "SACHEON", "JINJU"], name: "사천공항", address: "경남 사천시 사천읍 사천대로 1971", lat: 35.0885, lng: 128.0717 },
  { code: "MWX", names: ["무안", "MUAN"], name: "무안국제공항", address: "전남 무안군 망운면 공항로 970-260", lat: 34.9914, lng: 126.3828 },
  { code: "KPO", names: ["포항", "POHANG", "경주", "GYEONGJU"], name: "포항경주공항", address: "경북 포항시 남구 동해면 일월로 18", lat: 35.9879, lng: 129.4204 }
];

function airportByName(korean?: string, english?: string): (typeof AIRPORTS)[number] | undefined {
  const haystack = `${korean ?? ""} ${english ?? ""}`.toUpperCase();
  return AIRPORTS.find((airport) => airport.names.some((name) => haystack.includes(name.toUpperCase())));
}

function incheonTerminalCoordinates(floor: string): { lat: number; lng: number; address: string } {
  if (floor.includes("T2") || floor.includes("제2")) {
    return { lat: 37.4688, lng: 126.4335, address: "인천 중구 제2터미널대로 446" };
  }
  return { lat: 37.4495, lng: 126.4510, address: "인천 중구 공항로 271" };
}
