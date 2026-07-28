CREATE TABLE city_festivals (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  venue TEXT,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  image_url TEXT,
  score REAL NOT NULL,
  scraped_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_city_festivals_site_title_start ON city_festivals(site_id, title, start_date);
CREATE INDEX idx_city_festivals_lat_lng ON city_festivals(lat, lng);
