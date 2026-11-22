-- 0021_coupons.sql — Coupons and offers (as quickPOS, product owner 2026-11-22). New tables only.
-- coupon: the owner's codes (Settings › Coupons / Offers). pct values are basis points, amounts paise.
CREATE TABLE coupon (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  description        TEXT,
  kind               TEXT NOT NULL CHECK (kind IN ('pct', 'amount')),
  value              INTEGER NOT NULL CHECK (value > 0),
  max_discount_paise INTEGER CHECK (max_discount_paise IS NULL OR max_discount_paise > 0),
  min_bill_paise     INTEGER NOT NULL DEFAULT 0 CHECK (min_bill_paise >= 0),
  valid_from         TEXT,
  valid_to           TEXT,
  max_uses           INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- coupon_use: the coupon a bill was printed with (one per bill; printing the bill again replaces it). The code and the
-- amount it took off are kept as printed. A use counts while its bill is not void.
CREATE TABLE coupon_use (
  bill_id        TEXT PRIMARY KEY REFERENCES bill(id),
  coupon_id      TEXT NOT NULL REFERENCES coupon(id),
  code           TEXT NOT NULL,
  discount_paise INTEGER NOT NULL CHECK (discount_paise >= 0),
  used_at        TEXT NOT NULL
);
CREATE INDEX coupon_use_coupon ON coupon_use (coupon_id);
