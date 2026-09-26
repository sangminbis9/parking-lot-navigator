-- 병합 job(festivalMerge.ts)이 Worker CPU 10ms 안에 끝나도록 제목 정규화 키를 행에 저장한다.
-- 전 행을 매회 정규화(정규식 수십 개)하면 4천 건에 20~50ms가 들어 invocation이 조용히 죽는다.
-- 키가 있으면 SQL 창 함수로 "같은 키가 둘 이상인 행"만 골라 JS로 넘길 수 있다.
--   merge_title_key : 수식어를 벗긴 핵심 제목(공백 제거)
--   merge_word_key  : 핵심 제목의 단어를 정렬해 이은 값
-- 인덱스는 만들지 않는다(쓰기 증폭 방지). 0032 트리거의 컬럼 목록에 없어 스냅샷도 건드리지 않는다.
ALTER TABLE discovery_items ADD COLUMN merge_title_key TEXT;
ALTER TABLE discovery_items ADD COLUMN merge_word_key TEXT;

-- 제목이 바뀌면 키를 비워 병합 job이 다시 계산하게 한다.
CREATE TRIGGER discovery_items_merge_key_reset AFTER UPDATE OF title ON discovery_items
WHEN OLD.title IS NOT NEW.title
BEGIN
 UPDATE discovery_items SET merge_title_key = NULL, merge_word_key = NULL WHERE id = NEW.id;
END;
