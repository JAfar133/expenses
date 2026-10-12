-- v2: the right to edit is the owner role in the group (memberships.role); the personal override of v1 is not used anymore.
-- can_edit_default stays: it only chooses the owners of the first group at the first start (EDITOR_USERS).
ALTER TABLE users DROP COLUMN can_edit_override;
