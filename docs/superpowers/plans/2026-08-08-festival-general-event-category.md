# 축제 "지역행사" 카테고리 신설 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 축제(festival) 도메인에 새 `FestivalPrimaryCategory` 값 `general_event`("지역행사")를 추가해, 기존 10개 테마 어디에도 맞지 않는 박람회·엑스포·컨벤션류 지역 행사가 "기타"로 뭉개지지 않고 별도 필터/지도 카테고리로 노출되게 한다.

**Architecture:** `shared-types`의 `FESTIVAL_PRIMARY_CATEGORIES`가 정본(source of truth) 배열이고, `worker-backend`의 `llmTaggingSchema.ts`가 이를 독립적으로 재선언해 LLM 프롬프트와 검증에 쓴다. 실제 분류는 Cloudflare Workers AI LLM이 우선 수행하고, 실패 시에만 `llmTaggingFallback.ts`의 정규식 규칙으로 폴백한다. iOS는 `FestivalPrimaryCategory` Swift enum이 표시 정보(이름/아이콘/색/이모지)를 갖고, `MapPinRenderer.map(_:)`가 지도 핀 카테고리로 추가 매핑한다.

**Tech Stack:** TypeScript (Cloudflare Workers, Hono, Vitest), Swift (SwiftUI, XCTest), pnpm workspaces.

## Global Constraints

- 새 카테고리 slug: `general_event`, 한국어 라벨: "지역행사".
- `FESTIVAL_PRIMARY_CATEGORIES` 배열에서 `art_exhibition` 다음, `etc` 이전 위치에 추가한다 (shared-types, llmTaggingSchema.ts, iOS enum 세 곳 모두 동일한 상대 순서 유지).
- 정규식 매칭 패턴에 "행사"라는 단어 자체를 넣지 않는다 — 범용 단어라 과대분류(false positive)를 유발한다.
- `worker-backend/src/llmTaggingFallback.ts`의 `FESTIVAL_RULES`에서 새 규칙은 `art_exhibition` 규칙(`/미술|사진|조각|디자인|공예|전시|exhibition/i`)보다 **앞에** 위치해야 한다 (배열은 첫 매칭 규칙을 채택하므로 순서가 결과를 결정한다).
- iOS `CURRENT_PROJECT_VERSION`은 196 → 197로 정확히 1 증가시킨다 (`ios-app/project.yml`).
- Worker 변경 검증 최소 기준: `pnpm -C worker-backend typecheck` && `pnpm -C worker-backend test`.
- 이 작업은 로컬 매장 이벤트(`LocalEventPrimaryCategory`) 도메인을 건드리지 않는다.

---

### Task 1: shared-types에 `general_event` 카테고리 추가

**Files:**
- Modify: `shared-types/src/discover.ts:29-41`

**Interfaces:**
- Produces: `FESTIVAL_PRIMARY_CATEGORIES` 배열에 `"general_event"` 포함 (이후 모든 task가 이 배열을 정본으로 참조).

이 파일은 `main`/`types`가 `src/index.ts`를 직접 가리키는 workspace 패키지라 별도 빌드 단계 없이 `worker-backend`에서 바로 참조된다.

- [ ] **Step 1: `FESTIVAL_PRIMARY_CATEGORIES` 배열 수정**

`shared-types/src/discover.ts`의 다음 블록을:

```ts
export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "etc",
] as const;
```

다음으로 교체한다 (`art_exhibition`과 `etc` 사이에 `general_event` 삽입):

```ts
export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "general_event",
  "etc",
] as const;
```

- [ ] **Step 2: 타입체크로 컴파일 확인**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS (shared-types는 별도 typecheck 스크립트가 없고, worker-backend가 이 타입을 소비하므로 여기서 타입 오류가 있으면 드러난다).

- [ ] **Step 3: 커밋**

```bash
git add shared-types/src/discover.ts
git commit -m "Add general_event to FESTIVAL_PRIMARY_CATEGORIES"
```

---

### Task 2: worker-backend LLM 태깅 스키마 동기화

**Files:**
- Modify: `worker-backend/src/llmTaggingSchema.ts:1-13` (배열), `worker-backend/src/llmTaggingSchema.ts:52-63` (`FESTIVAL_GUIDE`)

**Interfaces:**
- Consumes: Task 1에서 정의한 `general_event` 값 (별도 import 없이 로컬 배열을 독립적으로 재선언하는 기존 패턴을 그대로 따름).
- Produces: `buildSystemPrompt("festival")`가 반환하는 프롬프트 문자열에 `general_event`가 허용 카테고리 목록과 가이드 문구 양쪽에 포함됨. `validateTaggingResult("festival", ...)`가 `general_event`를 유효한 값으로 인정.

- [ ] **Step 1: `FESTIVAL_PRIMARY_CATEGORIES` 배열 동기화**

`worker-backend/src/llmTaggingSchema.ts`의 다음 블록을:

```ts
export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "etc",
] as const;
```

다음으로 교체한다:

```ts
export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "general_event",
  "etc",
] as const;
```

- [ ] **Step 2: `FESTIVAL_GUIDE` 프롬프트 문구에 안내 추가**

`worker-backend/src/llmTaggingSchema.ts`의 다음 라인을:

```ts
- art_exhibition: 미술, 사진, 조각, 디자인, 공예 전시·페어.
- etc: 위 카테고리 어디에도 명확히 들어가지 않을 때.`;
```

다음으로 교체한다:

```ts
- art_exhibition: 미술, 사진, 조각, 디자인, 공예 전시·페어.
- general_event: 박람회, 엑스포, 취업박람회, 산업전, 무역전, 컨벤션, 총회 등 산업·행사성 모임. 위 테마(공연/먹거리/꽃/야경/전통/가족/마켓/스포츠/영화/전시)에 해당하면 그쪽을 우선한다.
- etc: 위 카테고리 어디에도 명확히 들어가지 않을 때.`;
```

- [ ] **Step 3: 타입체크**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add worker-backend/src/llmTaggingSchema.ts
git commit -m "Add general_event category to LLM tagging schema and prompt guide"
```

---

### Task 3: 정규식 폴백 규칙 + 회귀 테스트 (TDD)

**Files:**
- Modify: `worker-backend/src/llmTaggingFallback.ts:9-26` (`FESTIVAL_RULES`)
- Create: `worker-backend/tests/llmTaggingFallback.test.ts`

**Interfaces:**
- Consumes: `fallbackTag(input: TaggingInput): TaggingResult` (기존 함수, 시그니처 변경 없음), Task 1/2에서 동기화한 `FESTIVAL_PRIMARY_CATEGORIES` (shared-types와 llmTaggingSchema 양쪽에서 import해 동일 집합인지 비교).
- Produces: `general_event`로 분류되는 폴백 경로가 검증됨. 이후 배포·백필 단계에서 AI 바인딩이 없거나 실패했을 때 이 규칙이 안전망 역할을 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/llmTaggingFallback.test.ts` 파일을 새로 만든다:

```ts
import { describe, expect, it } from "vitest";
import { fallbackTag } from "../src/llmTaggingFallback.js";
import { FESTIVAL_PRIMARY_CATEGORIES as SCHEMA_CATEGORIES } from "../src/llmTaggingSchema.js";
import { FESTIVAL_PRIMARY_CATEGORIES as SHARED_CATEGORIES } from "@parking/shared-types";

describe("fallbackTag - festival domain", () => {
  it("classifies expo/trade-fair titles as general_event", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "a",
      title: "2026 서울 국제 산업박람회",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("general_event");
  });

  it("classifies expo keyword in description even when title has no signal", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "b",
      title: "가을맞이 큰 마당",
      description: "이번 행사는 지역 상공인 취업박람회와 함께 진행됩니다.",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("general_event");
  });

  it("does not classify generic '행사' wording alone as general_event (over-triggering regression)", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "c",
      title: "가을 문화 행사",
      description: "우리 동네에서 열리는 즐거운 행사입니다.",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("etc");
  });

  it("prioritizes general_event over art_exhibition when both keywords appear (rule order regression)", () => {
    const result = fallbackTag({
      domain: "festival",
      id: "d",
      title: "산업박람회 및 미술 전시",
      source: "tourapi",
    });

    expect(result.primaryCategory).toBe("general_event");
  });
});

describe("FESTIVAL_PRIMARY_CATEGORIES sync", () => {
  it("keeps shared-types and llmTaggingSchema category sets identical", () => {
    expect(new Set(SCHEMA_CATEGORIES)).toEqual(new Set(SHARED_CATEGORIES));
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `pnpm -C worker-backend test -- llmTaggingFallback`
Expected: FAIL — `general_event`로 분류되어야 할 케이스들이 `etc`로 나옴 (아직 규칙이 없으므로).

- [ ] **Step 3: 규칙 추가 (최소 구현)**

`worker-backend/src/llmTaggingFallback.ts`의 다음 블록을:

```ts
const FESTIVAL_RULES: Array<{
  pattern: RegExp;
  category: FestivalPrimaryCategory;
  tag?: string;
}> = [
  { pattern: /불꽃|불꽃놀이|fireworks/i, category: "light_night", tag: "불꽃" },
  { pattern: /야경|빛|조명|미디어\s*파사드|루미나리에/i, category: "light_night", tag: "야경" },
  { pattern: /벚꽃|벚나무|cherry\s*blossom/i, category: "nature_flower", tag: "벚꽃" },
  { pattern: /장미|튤립|유채|국화|단풍|꽃|억새|연꽃/, category: "nature_flower", tag: "꽃" },
  { pattern: /콘서트|페스티벌|festival|edm|록|재즈|클래식|국악|k-?pop/i, category: "music_performance", tag: "공연" },
  { pattern: /와인|맥주|막걸리|커피|푸드|food|먹거리|미식|음식/i, category: "food_drink", tag: "먹거리" },
  { pattern: /전통|민속|향토|제례|사찰|문화재/, category: "tradition_culture", tag: "전통" },
  { pattern: /키즈|어린이|가족|kids|family|캐릭터/i, category: "family_kids", tag: "가족" },
  { pattern: /마켓|플리\s*마켓|야시장|장터|market/i, category: "market_flea", tag: "마켓" },
  { pattern: /마라톤|자전거|트레일|등산|카약|스포츠|sport/i, category: "sports_outdoor", tag: "스포츠" },
  { pattern: /영화제|미디어아트|애니메이션|film|cinema/i, category: "film_media", tag: "영화" },
  { pattern: /미술|사진|조각|디자인|공예|전시|exhibition/i, category: "art_exhibition", tag: "전시" },
];
```

다음으로 교체한다 (`art_exhibition` 규칙 바로 앞에 새 규칙 삽입):

```ts
const FESTIVAL_RULES: Array<{
  pattern: RegExp;
  category: FestivalPrimaryCategory;
  tag?: string;
}> = [
  { pattern: /불꽃|불꽃놀이|fireworks/i, category: "light_night", tag: "불꽃" },
  { pattern: /야경|빛|조명|미디어\s*파사드|루미나리에/i, category: "light_night", tag: "야경" },
  { pattern: /벚꽃|벚나무|cherry\s*blossom/i, category: "nature_flower", tag: "벚꽃" },
  { pattern: /장미|튤립|유채|국화|단풍|꽃|억새|연꽃/, category: "nature_flower", tag: "꽃" },
  { pattern: /콘서트|페스티벌|festival|edm|록|재즈|클래식|국악|k-?pop/i, category: "music_performance", tag: "공연" },
  { pattern: /와인|맥주|막걸리|커피|푸드|food|먹거리|미식|음식/i, category: "food_drink", tag: "먹거리" },
  { pattern: /전통|민속|향토|제례|사찰|문화재/, category: "tradition_culture", tag: "전통" },
  { pattern: /키즈|어린이|가족|kids|family|캐릭터/i, category: "family_kids", tag: "가족" },
  { pattern: /마켓|플리\s*마켓|야시장|장터|market/i, category: "market_flea", tag: "마켓" },
  { pattern: /마라톤|자전거|트레일|등산|카약|스포츠|sport/i, category: "sports_outdoor", tag: "스포츠" },
  { pattern: /영화제|미디어아트|애니메이션|film|cinema/i, category: "film_media", tag: "영화" },
  { pattern: /박람회|엑스포|expo|무역전|산업전|취업박람회|잡페어|job\s*fair|컨벤션|convention/i, category: "general_event", tag: "박람회" },
  { pattern: /미술|사진|조각|디자인|공예|전시|exhibition/i, category: "art_exhibition", tag: "전시" },
];
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `pnpm -C worker-backend test -- llmTaggingFallback`
Expected: PASS (5개 테스트 전부)

- [ ] **Step 5: 전체 테스트 스위트 + 타입체크로 회귀 확인**

Run: `pnpm -C worker-backend typecheck && pnpm -C worker-backend test`
Expected: PASS, 기존 `festivalDedupe.test.ts` 등 다른 테스트도 그대로 통과.

- [ ] **Step 6: 커밋**

```bash
git add worker-backend/src/llmTaggingFallback.ts worker-backend/tests/llmTaggingFallback.test.ts
git commit -m "Classify expo/trade-fair festival titles as general_event in tagging fallback"
```

---

### Task 4: iOS `FestivalPrimaryCategory`에 케이스 추가

**Files:**
- Modify: `ios-app/Core/Models/DiscoverCategories.swift:3-79`

**Interfaces:**
- Produces: `FestivalPrimaryCategory.generalEvent` case, `.displayName == "지역행사"`, `.systemImage == "megaphone.fill"`, `.emoji == "📢"`, `.tint`는 기존 10개와 겹치지 않는 색상. `FilterSheetView`/`NotificationSettingsView`/`SearchView`는 `FestivalPrimaryCategory.allCases`를 순회하므로 이 케이스 추가만으로 자동 반영됨 (별도 수정 불필요, task 5에서 grep으로 재확인).

- [ ] **Step 1: enum에 case 추가**

`ios-app/Core/Models/DiscoverCategories.swift`의 다음 라인을:

```swift
enum FestivalPrimaryCategory: String, CaseIterable, Codable, Hashable {
    case musicPerformance = "music_performance"
    case foodDrink = "food_drink"
    case natureFlower = "nature_flower"
    case lightNight = "light_night"
    case traditionCulture = "tradition_culture"
    case familyKids = "family_kids"
    case marketFlea = "market_flea"
    case sportsOutdoor = "sports_outdoor"
    case filmMedia = "film_media"
    case artExhibition = "art_exhibition"
    case etc
```

다음으로 교체한다:

```swift
enum FestivalPrimaryCategory: String, CaseIterable, Codable, Hashable {
    case musicPerformance = "music_performance"
    case foodDrink = "food_drink"
    case natureFlower = "nature_flower"
    case lightNight = "light_night"
    case traditionCulture = "tradition_culture"
    case familyKids = "family_kids"
    case marketFlea = "market_flea"
    case sportsOutdoor = "sports_outdoor"
    case filmMedia = "film_media"
    case artExhibition = "art_exhibition"
    case generalEvent = "general_event"
    case etc
```

- [ ] **Step 2: `displayName`에 분기 추가**

다음을:

```swift
        case .artExhibition: return "예술·전시"
        case .etc: return "기타"
        }
    }
```

다음으로 교체한다 (`displayName` 프로퍼티 내부):

```swift
        case .artExhibition: return "예술·전시"
        case .generalEvent: return "지역행사"
        case .etc: return "기타"
        }
    }
```

- [ ] **Step 3: `systemImage`에 분기 추가**

다음을:

```swift
        case .artExhibition: return "paintpalette.fill"
        case .etc: return "star.circle"
        }
    }
```

다음으로 교체한다 (`systemImage` 프로퍼티 내부):

```swift
        case .artExhibition: return "paintpalette.fill"
        case .generalEvent: return "megaphone.fill"
        case .etc: return "star.circle"
        }
    }
```

- [ ] **Step 4: `tint`에 분기 추가**

다음을:

```swift
        case .artExhibition: return Color(red: 0.616, green: 0.306, blue: 0.867)     // #9D4EDD
        case .etc: return Color(red: 0.424, green: 0.459, blue: 0.490)               // #6C757D
        }
    }
```

다음으로 교체한다 (`tint` 프로퍼티 내부):

```swift
        case .artExhibition: return Color(red: 0.616, green: 0.306, blue: 0.867)     // #9D4EDD
        case .generalEvent: return Color(red: 0.271, green: 0.427, blue: 0.663)      // #4569A9
        case .etc: return Color(red: 0.424, green: 0.459, blue: 0.490)               // #6C757D
        }
    }
```

- [ ] **Step 5: `emoji`에 분기 추가**

다음을:

```swift
        case .artExhibition:      return "🎨"
        case .etc:                return "🎪"
        }
    }
}
```

다음으로 교체한다 (`emoji` 프로퍼티 내부, 첫 번째 `FestivalPrimaryCategory` extension의 마지막 프로퍼티):

```swift
        case .artExhibition:      return "🎨"
        case .generalEvent:       return "📢"
        case .etc:                return "🎪"
        }
    }
}
```

- [ ] **Step 6: 커밋**

```bash
git add ios-app/Core/Models/DiscoverCategories.swift
git commit -m "Add generalEvent case to FestivalPrimaryCategory"
```

---

### Task 5: iOS `MapPinRenderer` 매핑 + 빌드번호 증가

**Files:**
- Modify: `ios-app/Features/Map/MapPinRenderer.swift:109-121`
- Modify: `ios-app/project.yml:21`
- Test: `ios-app/Tests/ParkingLotNavigatorTests.swift` (추가)

**Interfaces:**
- Consumes: Task 4의 `FestivalPrimaryCategory.generalEvent`.
- Produces: `MapPinRenderer.map(_:)`가 `.generalEvent`를 exhaustive하게 처리 (컴파일 통과 필수 — Swift `switch`가 exhaustive해야 하므로 이 case 없이는 빌드 실패). `.generalEvent`는 전용 `MapPinCategory`를 새로 만들지 않고 `.natureFlower`/`.etc`와 동일하게 `nil`을 반환해 키워드/기본 핀 경로로 넘긴다 — 이미 `keyword(in:)`의 exhibition 키워드 목록에 "박람회"가 포함되어 있어(`ios-app/Features/Map/MapPinRenderer.swift:131`), 제목에 "박람회"가 있으면 자연스럽게 `.exhibition` 핀으로 떨어진다.

- [ ] **Step 1: 실패하는 테스트 작성**

`ios-app/Tests/ParkingLotNavigatorTests.swift`의 다음 블록을:

```swift
    func testMapPinCategoryFallsBackToDefaultWhenNoSignal() {
        // 전용 카테고리 없는 primaryCategory + 단서 없음 → 기본 축제
        XCTAssertEqual(MapPinCategory.resolve(primaryCategory: .natureFlower, categoryTags: [], title: "동네 축제", description: nil, rawTags: ["축제"]), .defaultFestival)
        XCTAssertEqual(MapPinCategory.resolve(primaryCategory: nil, categoryTags: [], title: "축제", description: nil, rawTags: ["행사", "이벤트"]), .defaultFestival)
    }
```

다음으로 교체한다 (새 테스트 케이스 추가):

```swift
    func testMapPinCategoryFallsBackToDefaultWhenNoSignal() {
        // 전용 카테고리 없는 primaryCategory + 단서 없음 → 기본 축제
        XCTAssertEqual(MapPinCategory.resolve(primaryCategory: .natureFlower, categoryTags: [], title: "동네 축제", description: nil, rawTags: ["축제"]), .defaultFestival)
        XCTAssertEqual(MapPinCategory.resolve(primaryCategory: nil, categoryTags: [], title: "축제", description: nil, rawTags: ["행사", "이벤트"]), .defaultFestival)
    }

    func testMapPinCategoryGeneralEventFallsBackToKeyword() {
        // generalEvent는 전용 핀이 없고, 제목의 "박람회" 키워드로 exhibition 핀에 떨어진다
        XCTAssertEqual(MapPinCategory.resolve(primaryCategory: .generalEvent, categoryTags: [], title: "지역 산업박람회", description: nil, rawTags: []), .exhibition)
        // 키워드 신호도 없으면 기본 핀
        XCTAssertEqual(MapPinCategory.resolve(primaryCategory: .generalEvent, categoryTags: [], title: "동네 모임", description: nil, rawTags: []), .defaultFestival)
    }
```

- [ ] **Step 2: `MapPinRenderer.map(_:)`에 분기 추가 (최소 구현)**

`ios-app/Features/Map/MapPinRenderer.swift`의 다음 블록을:

```swift
    private static func map(_ category: FestivalPrimaryCategory) -> MapPinCategory? {
        switch category {
        case .musicPerformance: return .music
        case .foodDrink: return .food
        case .lightNight: return .night
        case .marketFlea: return .market
        case .artExhibition, .filmMedia: return .exhibition
        case .familyKids: return .family
        case .traditionCulture: return .tradition
        case .sportsOutdoor: return .sports
        case .natureFlower, .etc: return nil  // 전용 카테고리 없음 → keyword/기본 핀으로
        }
    }
```

다음으로 교체한다:

```swift
    private static func map(_ category: FestivalPrimaryCategory) -> MapPinCategory? {
        switch category {
        case .musicPerformance: return .music
        case .foodDrink: return .food
        case .lightNight: return .night
        case .marketFlea: return .market
        case .artExhibition, .filmMedia: return .exhibition
        case .familyKids: return .family
        case .traditionCulture: return .tradition
        case .sportsOutdoor: return .sports
        case .natureFlower, .generalEvent, .etc: return nil  // 전용 카테고리 없음 → keyword/기본 핀으로
        }
    }
```

- [ ] **Step 3: 빌드번호 증가**

`ios-app/project.yml`의 다음 라인을:

```yaml
    CURRENT_PROJECT_VERSION: 196
```

다음으로 교체한다:

```yaml
    CURRENT_PROJECT_VERSION: 197
```

- [ ] **Step 4: 다른 `FestivalPrimaryCategory` 소비 지점에 하드코딩된 exhaustive switch가 없는지 재확인**

Run: `grep -rn "case \.artExhibition" ios-app --include="*.swift" 2>/dev/null || rg -n "case \.artExhibition" ios-app -g "*.swift"`
Expected: `DiscoverCategories.swift`(Task 4에서 이미 처리)와 `MapPinRenderer.swift`(이번 Step 2에서 처리) 두 파일만 나와야 한다. 세 번째 파일이 나오면 그 파일도 같은 방식으로 `.generalEvent` 분기를 추가해야 한다.

- [ ] **Step 5: XcodeGen 프로젝트 재생성 및 테스트 실행 (Xcode 환경에서)**

이 저장소는 WSL/Linux 환경이라 Xcode가 없다. 다음은 macOS/Codemagic 환경에서 실행한다:

Run: `cd ios-app && xcodegen generate && xcodebuild test -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: PASS, 특히 `testMapPinCategoryGeneralEventFallsBackToKeyword`.

Xcode 환경이 없다면 이 스텝은 건너뛰고 코드 리뷰로 대체한 뒤, 최종 배포 전 Codemagic 빌드에서 검증한다.

- [ ] **Step 6: 커밋**

```bash
git add ios-app/Features/Map/MapPinRenderer.swift ios-app/project.yml ios-app/Tests/ParkingLotNavigatorTests.swift
git commit -m "Map generalEvent festival category to map pin fallback, bump build to 197"
```

---

### Task 6: 배포 및 백필 (운영 단계, 코드 변경 없음)

**Files:** 없음 (배포/운영 명령만 실행)

**Interfaces:**
- Consumes: Task 1-5의 전체 diff.
- Produces: 프로덕션 D1의 기존 "기타" festival 레코드가 새 `general_event` 카테고리를 반영해 재분류됨.

- [ ] **Step 1: Worker 배포 전 최종 검증**

Run: `pnpm -C worker-backend typecheck && pnpm -C worker-backend test`
Expected: PASS

- [ ] **Step 2: Worker 배포**

Run: `pnpm -C worker-backend deploy`
Expected: 배포 성공, Version ID 출력됨.

- [ ] **Step 3: 배포 확인**

Run: `curl -s https://parking-lot-navigator-api.parkingnav.workers.dev/health`
Expected: 정상 응답 (예: `{"status":"ok"}` 형태).

- [ ] **Step 4: 기존 festival 데이터 백필 트리거**

Run:
```bash
curl -X POST \
  -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" \
  "https://parking-lot-navigator-api.parkingnav.workers.dev/admin/run-tagging-backfill"
```
Expected: JSON 응답에 `processed`, `succeededLlm`, `fallback` 등 카운트가 찍힘. `processed`가 실제 festival 행 수보다 적으면(기본 `max_rows=500`) `?max_rows=1000` 등으로 반복 호출한다.

- [ ] **Step 5: 백필 결과로 새 카테고리 반영 확인**

Run: `pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --command "SELECT COUNT(*) FROM discovery_items WHERE type='festival' AND primary_category='general_event'"`
Expected: 0보다 큰 카운트 (신규 카테고리로 재분류된 항목이 실제로 존재).

- [ ] **Step 6: iOS 빌드**

Task 5에서 `CURRENT_PROJECT_VERSION`을 197로 올렸으므로, Codemagic 또는 Xcode에서 빌드해 필터 시트에 "지역행사" 칩이 정상 노출되는지, 해당 카테고리로 필터링 시 실제 항목이 뜨는지 확인한다.

---

## Self-Review Notes

- **스펙 커버리지:** 스펙의 5개 변경 지점(shared-types/llmTaggingSchema/llmTaggingFallback/iOS enum/백필) 모두 Task 1-6에 매핑됨. 스펙에 없던 `MapPinRenderer.swift`의 exhaustive switch는 이번 계획 작성 중 코드 조사로 새로 발견해 Task 5에 반영함(스펙의 "구현 단계에서 grep으로 재확인" 문구가 예견한 지점).
- **플레이스홀더 스캔:** "TBD"/"추후" 등 표현 없음. 모든 코드 스텝에 실제 diff 포함.
- **타입 일관성:** `general_event` slug가 shared-types/llmTaggingSchema/iOS Swift raw value(`"general_event"`) 전부 동일. Swift case명은 `generalEvent`(camelCase 컨벤션)로 다른 case들과 일치.
