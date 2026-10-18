-- v5: a new type of push («Новый участник»): whoever saved their settings before has it on.
UPDATE notification_settings SET push_types = array_append(push_types, 'member_joined')
 WHERE NOT ('member_joined' = ANY (push_types));
