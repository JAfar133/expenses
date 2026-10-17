export const TEXT_MAX = 300;
export const TITLE_MAX = 80;

const pick = (count: number, one: string, few: string, many: string) => {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  return last >= 2 && last <= 4 ? few : many;
};

/** «1 человек», «2 человека», «5 человек» */
export const peopleLabel = (count: number) =>
  `${count} ${pick(count, 'человек', 'человека', 'человек')}`;

/** «1 получателю», «2 получателям» (after «Отправить сообщение …») */
export const recipientsDative = (count: number) =>
  `${count} ${pick(count, 'получателю', 'получателям', 'получателям')}`;
