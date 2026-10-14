-- v4: the languages the AI may use for the names it returns (shop and items). The owner chooses them per group.
-- With both allowed the AI keeps the language of the receipt when it is one of them and translates anything else
-- (Armenian, ...) to English.
ALTER TABLE groups ADD COLUMN ai_languages text[] NOT NULL DEFAULT ARRAY['en', 'ru']
  CHECK (ai_languages <@ ARRAY['en', 'ru'] AND cardinality(ai_languages) >= 1);
