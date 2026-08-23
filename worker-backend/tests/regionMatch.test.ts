import { describe, expect, it } from "vitest";
import { matchesRegions, parseRegion } from "../src/regionMatch.js";

describe("parseRegion", () => {
  it("광역시도 단축명과 시/군/구를 함께 뽑는다", () => {
    expect(parseRegion("인천광역시 연수구 송도동 123")).toEqual({
      province: "인천",
      district: "연수구",
    });
    expect(parseRegion("서울특별시 중구 세종대로 110")).toEqual({
      province: "서울",
      district: "중구",
    });
  });

  it("옛 표기(경상남도 등)도 단축명으로 맞춘다", () => {
    expect(parseRegion("경상남도 고성군 고성읍")).toEqual({
      province: "경남",
      district: "고성군",
    });
    expect(parseRegion("강원특별자치도 고성군 간성읍")).toEqual({
      province: "강원",
      district: "고성군",
    });
  });

  it("자치구가 아니라 시 단위를 district로 본다", () => {
    expect(parseRegion("경기도 수원시 팔달구 인계동")).toEqual({
      province: "경기",
      district: "수원시",
    });
  });

  it("광역시도를 못 찾으면 null", () => {
    expect(parseRegion("").province).toBeNull();
    expect(parseRegion("어딘가 123").province).toBeNull();
  });
});

describe("matchesRegions", () => {
  it("선택한 지역이 없으면 전국 전체가 대상이다", () => {
    expect(matchesRegions("제주특별자치도 서귀포시", [])).toBe(true);
    expect(matchesRegions("부산광역시 중구", [])).toBe(true);
  });

  it("광역시도만 고르면 그 안의 모든 시군구가 대상이다", () => {
    expect(matchesRegions("서울특별시 강남구 역삼동", ["서울"])).toBe(true);
    expect(matchesRegions("부산광역시 중구", ["서울"])).toBe(false);
  });

  it("서울 중구와 부산 중구를 구분한다", () => {
    expect(matchesRegions("서울특별시 중구 필동", ["서울|중구"])).toBe(true);
    expect(matchesRegions("부산광역시 중구 남포동", ["서울|중구"])).toBe(false);
    expect(matchesRegions("부산광역시 중구 남포동", ["부산|중구"])).toBe(true);
  });

  it("강원 고성군과 경남 고성군을 구분한다", () => {
    expect(matchesRegions("강원특별자치도 고성군 간성읍", ["강원|고성군"])).toBe(true);
    expect(matchesRegions("경상남도 고성군 고성읍", ["강원|고성군"])).toBe(false);
    expect(matchesRegions("경상남도 고성군 고성읍", ["경남|고성군"])).toBe(true);
  });

  it("인천 연수구를 고르면 인천의 다른 구는 빠진다", () => {
    expect(matchesRegions("인천광역시 연수구 송도동", ["인천|연수구"])).toBe(true);
    expect(matchesRegions("인천광역시 중구 신흥동", ["인천|연수구"])).toBe(false);
  });

  it("여러 지역을 고르면 그중 하나만 맞아도 통과한다", () => {
    const regions = ["인천|연수구", "서울"];
    expect(matchesRegions("서울특별시 마포구", regions)).toBe(true);
    expect(matchesRegions("인천광역시 연수구", regions)).toBe(true);
    expect(matchesRegions("대전광역시 유성구", regions)).toBe(false);
  });
});
