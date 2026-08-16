// iOS App Transport Security가 http:// 이미지 로드를 막는다. RemoteImage는 실패를
// 조용히 삼켜 placeholder만 남기 때문에, 공공 API가 http로 주는 포스터·사진 URL을
// 저장 시점에 https로 올려 둔다. TLS를 지원하지 않는 호스트라면 원래도 앱에서
// 못 쓰던 URL이라 손해가 없다.
export function toHttpsImageUrl(url: string): string;
export function toHttpsImageUrl(url: string | null | undefined): string | null;
export function toHttpsImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("http://") ? `https://${url.slice(7)}` : url;
}
