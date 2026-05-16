import type {
  LocalEvent,
  LocalEventAdminUpsertRequest,
  LocalEventReportRequest,
  LocalEventStatus,
  LocalEventStatusPatchRequest
} from "@parking/shared-types";
import { randomUUID } from "node:crypto";
import { config } from "../../config/env.js";
import { distanceMeters } from "../../services/geo.js";
import { inferLocalEventType, structureLocalEvent } from "./localEventStructuring.js";

interface LocalEventQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  cursor?: string;
  limit: number;
  status?: LocalEventStatus;
}

export interface LocalEventListResult {
  items: LocalEvent[];
  nextCursor: string | null;
}

export class LocalEventService {
  private readonly items = new Map<string, LocalEvent>();

  constructor(seedItems: LocalEvent[] = []) {
    for (const item of seedItems) {
      this.items.set(item.id, item);
    }
  }

  list(query: LocalEventQuery): LocalEventListResult {
    const status = query.status ?? "approved";
    const offset = parseCursor(query.cursor);
    const matched = [...this.items.values()]
      .filter((item) => item.status === status)
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
      .map((item) => ({
        ...item,
        distanceMeters: Math.round(distanceMeters(query.lat, query.lng, item.lat, item.lng))
      }))
      .filter((item) => item.distanceMeters <= query.radiusMeters)
      .sort(localEventSort);
    const page = matched.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;
    return {
      items: page,
      nextCursor: nextOffset < matched.length ? String(nextOffset) : null
    };
  }

  get(id: string): LocalEvent | null {
    return this.items.get(id) ?? null;
  }

  report(input: LocalEventReportRequest): LocalEvent {
    const structured = structureLocalEvent({
      sourceUrl: input.sourceUrl,
      captionText: input.captionText,
      storeName: input.storeName,
      address: input.address
    });
    const now = new Date().toISOString();
    const id = `report:${randomUUID()}`;
    const item: LocalEvent = {
      id,
      title: structured.title ?? "Submitted local event",
      eventType: inferLocalEventType([structured.title, structured.description, structured.benefit].filter(Boolean).join(" ")),
      category: "local_event",
      sourceId: id,
      startDate: structured.startDate ?? today(),
      endDate: structured.endDate,
      status: "pending",
      storeName: structured.storeName ?? "Unknown store",
      venueName: structured.storeName,
      address: structured.address ?? "",
      lat: structured.lat ?? 0,
      lng: structured.lng ?? 0,
      distanceMeters: 0,
      source: "user_report",
      sourceUrl: structured.sourceUrl,
      imageUrl: input.imageUrl ?? null,
      benefit: structured.benefit,
      shortDescription: structured.description,
      region: null,
      updatedAt: now,
      confidenceScore: structured.confidenceScore,
      needsReview: true,
      isSponsored: false,
      sponsorTier: null,
      paidUntil: null,
      priorityScore: 0
    };
    this.items.set(item.id, item);
    return item;
  }

  create(input: LocalEventAdminUpsertRequest): LocalEvent {
    const now = new Date().toISOString();
    const id = `local:${randomUUID()}`;
    const description = input.description ?? null;
    const item: LocalEvent = {
      id,
      title: input.title ?? "Local event",
      eventType: input.eventType ?? inferLocalEventType([input.title, input.description, input.benefit].filter(Boolean).join(" ")),
      category: "local_event",
      sourceId: id,
      startDate: input.startDate ?? today(),
      endDate: input.endDate ?? null,
      status: input.status ?? "pending",
      storeName: input.storeName ?? "Unknown store",
      venueName: input.storeName ?? "Unknown store",
      address: input.address ?? "",
      lat: input.lat ?? 0,
      lng: input.lng ?? 0,
      distanceMeters: 0,
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      imageUrl: input.imageUrl ?? null,
      benefit: input.benefit ?? null,
      shortDescription: description,
      region: null,
      updatedAt: now,
      confidenceScore: null,
      needsReview: input.status !== "approved",
      isSponsored: input.isSponsored ?? false,
      sponsorTier: input.sponsorTier ?? null,
      paidUntil: input.paidUntil ?? null,
      priorityScore: input.priorityScore ?? 0
    };
    this.items.set(item.id, item);
    return item;
  }

  update(id: string, input: Partial<LocalEventAdminUpsertRequest>): LocalEvent | null {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated: LocalEvent = {
      ...existing,
      title: input.title ?? existing.title,
      eventType: input.eventType ?? existing.eventType,
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate === undefined ? existing.endDate : input.endDate,
      status: input.status ?? existing.status,
      storeName: input.storeName ?? existing.storeName,
      venueName: input.storeName ?? existing.venueName,
      address: input.address ?? existing.address,
      lat: input.lat ?? existing.lat,
      lng: input.lng ?? existing.lng,
      source: input.source ?? existing.source,
      sourceUrl: input.sourceUrl === undefined ? existing.sourceUrl : input.sourceUrl,
      imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl,
      benefit: input.benefit ?? existing.benefit,
      shortDescription: input.description ?? existing.shortDescription,
      updatedAt: new Date().toISOString(),
      isSponsored: input.isSponsored ?? existing.isSponsored,
      sponsorTier: input.sponsorTier === undefined ? existing.sponsorTier : input.sponsorTier,
      paidUntil: input.paidUntil === undefined ? existing.paidUntil : input.paidUntil,
      priorityScore: input.priorityScore ?? existing.priorityScore,
      needsReview: input.status ? input.status !== "approved" : existing.needsReview
    };
    this.items.set(id, updated);
    return updated;
  }

  patchStatus(id: string, input: LocalEventStatusPatchRequest): LocalEvent | null {
    return this.update(id, { status: input.status });
  }
}

export function createLocalEventService(): LocalEventService {
  const seed: LocalEvent[] = process.env.NODE_ENV === "test" || config.PARKING_PROVIDER_MODE === "mock"
    ? [
        {
          id: "mock-local-event",
          title: "Cafe review event",
          eventType: "review_event",
          category: "local_event",
          sourceId: "mock-local-event",
          startDate: "2026-05-01",
          endDate: "2026-05-31",
          status: "approved",
          storeName: "Sample Cafe",
          venueName: "Sample Cafe",
          address: "110 Sejong-daero, Jung-gu, Seoul",
          lat: 37.5665,
          lng: 126.978,
          distanceMeters: 0,
          source: "owner_submitted",
          sourceUrl: "https://example.com/sample-cafe-event",
          imageUrl: null,
          benefit: "Free americano for review",
          shortDescription: "Visit and write a review to receive a drink benefit.",
          region: "Seoul",
          updatedAt: new Date().toISOString(),
          confidenceScore: 1,
          needsReview: false,
          isSponsored: true,
          sponsorTier: "local_boost",
          paidUntil: "2026-05-31",
          priorityScore: 50
        }
      ]
    : [];
  return new LocalEventService(seed);
}

function localEventSort(a: LocalEvent, b: LocalEvent): number {
  if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1;
  if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
  return a.distanceMeters - b.distanceMeters;
}

function parseCursor(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
