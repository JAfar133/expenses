-- v2: the categories table is the single list of categories of a group.
-- A record written with a category that is not in the list yet (an import from Excel, an old record) adds it,
-- so nothing used in the records is missing from the list. Existing records are covered at start-up
-- (the first group is created after the migrations run, see modules/groups/default-group.ts).
-- The trigger name sorts after expenses_assign_group_and_card: the group is known by the time it runs.
CREATE FUNCTION expenses_ensure_category() RETURNS trigger AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    INSERT INTO categories (group_id, name, position)
    VALUES (
      NEW.group_id,
      NEW.category,
      COALESCE((SELECT max(c.position) + 1 FROM categories c WHERE c.group_id = NEW.group_id), 0)
    )
    ON CONFLICT (group_id, name) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_ensure_category
  BEFORE INSERT OR UPDATE OF category ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_ensure_category();
