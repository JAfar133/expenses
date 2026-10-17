-- v5: the category an imported expense gets when the group has nothing to go by for the merchant (per key).
ALTER TABLE api_keys ADD COLUMN default_category_id uuid REFERENCES categories (id) ON DELETE SET NULL;
