export interface RankingWeights {
  distance: number;
  realtimeConfidence: number;
  availability: number;
  freshness: number;
  fee: number;
  publicPreference: number;
  ev: number;
  accessible: number;
  walkingDistance: number;
}

export const defaultRankingWeights: RankingWeights = {
  distance: 0.24,
  realtimeConfidence: 0.2,
  availability: 0.18,
  freshness: 0.14,
  fee: 0.08,
  publicPreference: 0.06,
  ev: 0.05,
  accessible: 0.03,
  walkingDistance: 0.02
};
