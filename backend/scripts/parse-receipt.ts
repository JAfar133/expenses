/**
 * Tries the receipt parsing on real photos without the app and the database: prints the raw answer of the model
 * and what the app would take from it. For tuning the prompt and checking the key and the model.
 *
 *   GEMINI_API_KEY=... npm run ai:parse -- receipt1.jpg receipt2.jpg
 *   GEMINI_MODEL=gemini-3.8-flash is the default; GEMINI_BASE_URL can be overridden too.
 */
import { readFile } from 'node:fs/promises';
import { detectReceiptType } from '../src/modules/receipts/receipt-file.ts';
import { GeminiProvider } from '../src/modules/llm/providers/gemini.provider.ts';
import { parseReceiptAnswer, receiptRequest } from '../src/modules/llm/receipt-parser.ts';

const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
const baseUrl =
  process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta';
const files = process.argv.slice(2);

if (!apiKey || files.length === 0) {
  console.error('Usage: GEMINI_API_KEY=... npm run ai:parse -- <photo> [<photo>...]');
  process.exit(1);
}

const provider = new GeminiProvider({ baseUrl });
await provider.check({ apiKey, model });
console.log(`Key works, model ${model} is available\n`);

const today = new Date().toISOString().slice(0, 10);
for (const file of files) {
  const bytes = await readFile(file);
  const type = detectReceiptType(bytes);
  if (!type) {
    console.log(`${file}: not a JPEG, PNG or WebP photo\n`);
    continue;
  }
  const started = Date.now();
  try {
    const answer = await provider.generateJson(
      receiptRequest({ bytes, contentType: type.contentType }, today),
      { apiKey, model },
    );
    console.log(`=== ${file} (${Date.now() - started} ms)`);
    console.log('Raw answer:', JSON.stringify(answer, null, 2));
    console.log('Taken by the app:', JSON.stringify(parseReceiptAnswer(answer), null, 2), '\n');
  } catch (error) {
    console.log(`=== ${file}: failed:`, (error as Error).message, '\n');
  }
}
