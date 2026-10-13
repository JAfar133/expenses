import {
  aiBadResponse,
  aiKeyInvalid,
  aiModelNotFound,
  aiUnavailable,
  type LlmCredentials,
  type LlmProvider,
  type LlmRequest,
} from '../llm.types.ts';

const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_PAUSE_MS = 1_500;

export interface GeminiOptions {
  baseUrl: string;
  /** For tests */
  fetch?: typeof fetch;
}

/** Gemini API over plain HTTPS. The key goes in a header, never in the URL, and is never logged. */
export class GeminiProvider implements LlmProvider {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: GeminiOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async generateJson(request: LlmRequest, { apiKey, model }: LlmCredentials): Promise<unknown> {
    const parts: unknown[] = [{ text: request.prompt }];
    if (request.image) {
      parts.push({
        inline_data: {
          mime_type: request.image.contentType,
          data: request.image.bytes.toString('base64'),
        },
      });
    }
    const response = await this.send(
      `/models/${encodeURIComponent(model)}:generateContent`,
      apiKey,
      model,
      {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: request.schema,
        },
      },
    );
    const text = (response as GenerateResponse).candidates?.[0]?.content?.parts?.find(
      (part) => typeof part.text === 'string',
    )?.text;
    if (typeof text !== 'string' || !text) throw aiBadResponse();
    try {
      return JSON.parse(text);
    } catch {
      throw aiBadResponse();
    }
  }

  async check({ apiKey, model }: LlmCredentials): Promise<void> {
    await this.send(`/models/${encodeURIComponent(model)}`, apiKey, model);
  }

  /** One request with one retry on "busy" answers (429 and 5xx); the errors are the ones safe for the client. */
  private async send(
    path: string,
    apiKey: string,
    model: string,
    body?: unknown,
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetch(`${this.options.baseUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt === 1) {
          await pause(RETRY_PAUSE_MS);
          continue;
        }
        throw aiUnavailable();
      }

      if (response.ok) return response.json();
      if ((response.status === 429 || response.status >= 500) && attempt === 1) {
        await pause(RETRY_PAUSE_MS);
        continue;
      }
      throw errorFor(response.status, model, await response.text().catch(() => ''));
    }
  }
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: unknown }[] } }[];
}

function errorFor(status: number, model: string, body: string) {
  if (status === 401 || status === 403) return aiKeyInvalid();
  // Gemini answers an invalid key with 400 and the reason API_KEY_INVALID
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) return aiKeyInvalid();
  if (status === 404) return aiModelNotFound(model);
  if (status === 400) return aiBadResponse();
  return aiUnavailable();
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
