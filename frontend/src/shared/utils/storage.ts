/** localStorage может быть недоступен (приватный режим), поэтому все обращения защищены. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Не критично: просто не запомним выбор
  }
}
