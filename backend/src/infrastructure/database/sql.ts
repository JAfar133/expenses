/**
 * SQL fragments that make the result identical for all drivers:
 * dates and times are returned as strings, not Date objects (no time zone shifts).
 */
export const dateText = (column: string) => `to_char(${column}, 'YYYY-MM-DD')`;

export const timestampText = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
