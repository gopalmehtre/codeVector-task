CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY,
  name        VARCHAR(255)   NOT NULL,
  category    VARCHAR(100)   NOT NULL,
  price       NUMERIC(10, 2) NOT NULL,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_updated_id
  ON products (updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_products_category_updated_id
  ON products (category, updated_at DESC, id DESC);
