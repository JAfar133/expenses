-- v4: the owner chooses the categories where the AI reads receipts (for example not for housing).
-- On by default, so the AI works wherever receipt photos are allowed until the owner turns it off for a category.
ALTER TABLE categories ADD COLUMN ai_allowed boolean NOT NULL DEFAULT true;
