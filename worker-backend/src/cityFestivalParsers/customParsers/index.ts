import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";
import { parseTongyeongUtour } from "./tongyeongUtour.js";
import { parseJeongseonArirang } from "./jeongseonArirang.js";
import { parseChungnamTour } from "./chungnamTour.js";

export type CustomParserFn = (html: string, config: CitySiteConfig) => RawCityFestivalCandidate[];

// selectors만으로 표현 안 되는 사이트(JS 렌더링 위젯, 비정형 마크업 등)를 위한
// 탈출구. siteId를 키로 등록하고, CitySiteConfig.customParser에 같은 키를 지정한다.
export const CUSTOM_PARSERS: Record<string, CustomParserFn> = {
  "tongyeong-utour": parseTongyeongUtour,
  "jeongseon-arirang": parseJeongseonArirang,
  "chungnam-tour": parseChungnamTour
};
