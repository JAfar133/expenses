function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export const ownersLabel = (count: number) =>
  `${count} ${plural(count, 'владелец', 'владельца', 'владельцев')}`;

export const membersLabel = (count: number) =>
  `${count} ${plural(count, 'участник', 'участника', 'участников')}`;
