ALTER TABLE user ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro'));
CREATE TABLE billing_account (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  subscription_status TEXT,
  current_period_start INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER
);
