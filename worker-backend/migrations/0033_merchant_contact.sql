-- 사장님 이벤트 등록 시 필수로 받는 등록자 연락처.
-- display_name/email은 OAuth 로그인마다 COALESCE로 덮어써지므로 사용자가 직접 입력한 값은
-- 별도 컬럼에 둔다. 전화번호는 0007부터 있었지만 쓰이지 않던 phone 컬럼을 그대로 쓴다.
-- merchants 쓰기는 드물고 이 컬럼으로 조회하지 않으므로 인덱스는 만들지 않는다.
ALTER TABLE merchants ADD COLUMN contact_name TEXT;
ALTER TABLE merchants ADD COLUMN contact_email TEXT;
