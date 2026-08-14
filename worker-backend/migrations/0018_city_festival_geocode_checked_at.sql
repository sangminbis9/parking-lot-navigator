ALTER TABLE city_festivals ADD COLUMN geocode_checked_at TEXT;

CREATE INDEX idx_city_festivals_geocode_checked_at
  ON city_festivals(geocode_checked_at, start_date);
