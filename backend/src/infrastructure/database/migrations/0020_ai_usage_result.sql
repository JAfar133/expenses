-- v4: a receipt can be parsed before the expense exists (as soon as the photo is chosen in the form).
-- The parsed result is kept with the attempt so that, when the expense is saved, the server can tell which of its
-- values really came from the AI (the marks are never taken from the client). expense_id is filled when the
-- expense claims the parsing; a parsing is claimed at most once.
ALTER TABLE ai_usage ADD COLUMN result jsonb;
