CREATE TABLE akei_trade_expos (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  organizer TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  venue TEXT,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  image_url TEXT,
  scraped_at TEXT NOT NULL
);

CREATE INDEX idx_akei_trade_expos_lat_lng ON akei_trade_expos(lat, lng);
