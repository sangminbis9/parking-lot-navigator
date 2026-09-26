-- 같은 축제의 provider별 행을 파이프라인에서 하나로 합친다(festivalMerge.ts).
-- 스냅샷은 id 해시 버킷별로 만들어져 같은 묶음이 서로 다른 part에 흩어지므로,
-- part 안에서는 중복을 걸러낼 수 없다. 병합 job이 묶음을 계산해 행에 결과를 적는다.
--   merged_into       : 다른 행에 흡수된 행이면 그 대표 행의 id. 스냅샷 festivals에서 빠진다.
--   merge_donors_json : 대표 행이면 흡수한 행들의 공개 필드(더 긴 설명·사진 등) JSON.
-- 행을 지우지 않는다. 인덱스도 만들지 않는다 — 쓰기 증폭을 늘리지 않기 위해서다.
ALTER TABLE discovery_items ADD COLUMN merged_into TEXT;
ALTER TABLE discovery_items ADD COLUMN merge_donors_json TEXT;

-- 0032 트리거는 나열한 컬럼만 보므로, 병합 결과가 바뀌면 그 행의 스냅샷 버킷을 다시 만든다.
CREATE TRIGGER discovery_items_snapshot_merge_update AFTER UPDATE ON discovery_items
WHEN OLD.merged_into IS NOT NEW.merged_into
 OR OLD.merge_donors_json IS NOT NEW.merge_donors_json
BEGIN
 UPDATE snapshot_sections SET revision=revision+1, changed_at = CASE WHEN revision=published_revision THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE changed_at END WHERE kind='discovery' AND bucket=NEW.snapshot_bucket;
END;
