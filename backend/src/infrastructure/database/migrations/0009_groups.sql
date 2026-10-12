-- v2, stage 1: groups, members, cards, card access, categories.
-- Additive only: the app still works with the text columns (expenses.card, expenses.category);
-- group_id and card_id are filled alongside (by the trigger below, until the app writes them itself).

ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  reporting_currency text        NOT NULL,
  timezone           text        NOT NULL,
  disabled_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A user belongs to exactly one group (user_id is the primary key)
CREATE TABLE memberships (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  group_id   uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memberships_group_idx ON memberships (group_id);

CREATE TABLE cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  currency    text        NOT NULL,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);

-- No row means the card is hidden from the user; owners see every card without rows
CREATE TABLE card_access (
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  level   text NOT NULL CHECK (level IN ('view', 'edit')),
  PRIMARY KEY (card_id, user_id)
);
CREATE INDEX card_access_user_idx ON card_access (user_id);

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  position    integer     NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);

ALTER TABLE expenses
  ADD COLUMN group_id uuid REFERENCES groups (id),
  ADD COLUMN card_id  uuid REFERENCES cards (id);
CREATE INDEX expenses_group_date_idx ON expenses (group_id, date DESC);
CREATE INDEX expenses_card_idx ON expenses (card_id);

-- Transitional: fills group_id and card_id from the text columns on every insert and card change, so the code
-- that writes expenses does not need to change yet. The group is the author's group, or the first group.
-- A card that does not exist yet is created in the group's reporting currency. Removed when the app writes ids itself.
CREATE FUNCTION expenses_assign_group_and_card() RETURNS trigger AS $$
BEGIN
  IF NEW.group_id IS NULL THEN
    NEW.group_id := COALESCE(
      (SELECT m.group_id FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE u.username = NEW.created_by),
      (SELECT g.id FROM groups g ORDER BY g.created_at, g.id LIMIT 1)
    );
  END IF;

  IF NEW.group_id IS NOT NULL
     AND (NEW.card_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.card IS DISTINCT FROM OLD.card)) THEN
    SELECT c.id INTO NEW.card_id FROM cards c WHERE c.group_id = NEW.group_id AND c.name = NEW.card;
    IF NEW.card_id IS NULL THEN
      INSERT INTO cards (group_id, name, currency)
      SELECT g.id, NEW.card, g.reporting_currency FROM groups g WHERE g.id = NEW.group_id
      RETURNING id INTO NEW.card_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_assign_group_and_card
  BEFORE INSERT OR UPDATE OF card ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_assign_group_and_card();
