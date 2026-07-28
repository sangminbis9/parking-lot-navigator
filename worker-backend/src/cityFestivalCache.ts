import type { Festival } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";
import { discoverStatus, isWithinWindow } from "../../backend/src/features/discover/common/dateUtils.js";

const CITY_FESTIVAL_RESULT_LIMIT = 500;
const CITY_FESTIVAL_PREFETCH_LIMIT = 5000;

export interface CityFestivalRow {
  id: string;
  site_id: string;
  source_url: string;
  title: string;
  start_date: string;
  end_date: string;
  venue: string | null;
  address: string | null;
  lat: number;
  lng: number;
  image_url: string | null;
}

export async function queryCityFestivalsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  radiusMeters: number,
  upcomingWithinDays: number
): Promise<Festival[]> {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const rows = await db
    .prepare(
      `SELECT id, site_id, source_url, title, start_date, end_date, venue, address, lat, lng, image_url
         FROM city_festivals
        WHERE lat BETWEEN ? AND ?
          AND lng BETWEEN ? AND ?
        ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?)) ASC
        LIMIT ?`
    )
    .bind(
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      lat,
      lat,
      lng,
      lng,
      CITY_FESTIVAL_PREFETCH_LIMIT
    )
    .all<CityFestivalRow>();

  return (rows.results ?? [])
    .map((row) => mapCityFestivalRow(row, lat, lng))
    .filter((item): item is Festival => item !== null)
    .filter((item) => item.distanceMeters <= radiusMeters)
    .filter((item) => isWithinWindow(item.startDate, item.endDate, upcomingWithinDays))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, CITY_FESTIVAL_RESULT_LIMIT);
}

export function mapCityFestivalRow(row: CityFestivalRow, lat: number, lng: number): Festival | null {
  if (!row.id || !row.title || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  return {
    id: row.id,
    title: row.title,
    subtitle: null,
    description: null,
    startDate: row.start_date,
    endDate: row.end_date,
    status: discoverStatus(row.start_date, row.end_date),
    venueName: row.venue,
    address: row.address ?? "",
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    source: "city-scraped",
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    tags: []
  };
}
