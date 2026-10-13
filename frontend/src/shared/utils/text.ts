/** «одежда» → «Одежда»: the first letter is a capital, as category names are shown elsewhere in the UI. */
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
