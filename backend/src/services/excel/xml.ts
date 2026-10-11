export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Returns all opening tags with the given name: `<sheet .../>`. */
export function findTags(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

/** Returns a tag attribute value (already without XML escaping) or undefined. */
export function getAttr(tag: string, name: string): string | undefined {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? undefined : unescapeXml(value);
}
