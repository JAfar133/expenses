/**
 * Фрагменты SQL, которые делают результат одинаковым для всех драйверов:
 * даты и время возвращаются строками, а не объектами Date (без сдвигов часового пояса).
 */
export const dateText = (column: string) => `to_char(${column}, 'YYYY-MM-DD')`;

export const timestampText = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
