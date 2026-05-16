export type CandidateSource = "kakao_place_feed" | "naver_place_feed" | "instagram";

export interface CandidateEvent {
  source: CandidateSource;
  placeId: string;
  placeName: string;
  title: string | null;
  body: string | null;
  imageUrls: string[];
  startDate: string | null;
  endDate: string | null;
  benefit: string | null;
  postedAt: string | null;
  permalink: string | null;
  rawSnippet: string;
}

export interface QualityScore {
  hasImage: boolean;
  hasDateRange: boolean;
  hasBenefit: boolean;
  recencyDays: number | null;
  textLength: number;
  composite: number;
}

export interface SampleStore {
  region: string;
  placeName: string;
  kakaoPlaceId: string | null;
  naverPlaceId: string | null;
  instagramHandle: string | null;
}

export interface SourceFetchResult {
  ok: boolean;
  source: CandidateSource;
  store: SampleStore;
  events: CandidateEvent[];
  reason?: string;
}

export interface SourceRunSummary {
  source: CandidateSource;
  attemptedStores: number;
  successStores: number;
  failedStores: number;
  skippedStores: number;
  skippedReason?: string;
}

export interface ScoredCandidate {
  event: CandidateEvent;
  score: QualityScore;
}
