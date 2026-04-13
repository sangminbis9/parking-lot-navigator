import type { ProviderHealth } from "@parking/shared-types";

export class BaseProviderHealth {
  protected status: ProviderHealth["status"] = "up";
  protected lastSuccessAt: string | null = null;
  protected lastError: string | null = null;
  protected qualityScore = 1;

  constructor(private readonly providerName: string) {}

  protected markSuccess(qualityScore = 1): void {
    this.status = qualityScore < 0.6 ? "degraded" : "up";
    this.lastSuccessAt = new Date().toISOString();
    this.lastError = null;
    this.qualityScore = qualityScore;
  }

  protected markFailure(error: unknown): void {
    this.status = "down";
    this.lastError = error instanceof Error ? error.message : "알 수 없는 provider 오류";
    this.qualityScore = 0;
  }

  health(): ProviderHealth {
    return {
      name: this.providerName,
      status: this.status,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      qualityScore: this.qualityScore,
      stale: false
    };
  }
}
