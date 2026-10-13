import type { LlmCredentials, LlmProvider, LlmRequest } from '../llm.types.ts';

/** A provider for tests and local runs without a key: answers with what it was told to, remembers the calls. */
export class FakeProvider implements LlmProvider {
  /** The next answers (the last one repeats); a function may throw to simulate a failure */
  answers: (unknown | (() => unknown))[] = [];
  readonly calls: { request: LlmRequest; credentials: LlmCredentials }[] = [];
  checks: LlmCredentials[] = [];
  /** An error thrown by check() */
  checkError?: Error;

  async generateJson(request: LlmRequest, credentials: LlmCredentials): Promise<unknown> {
    this.calls.push({ request, credentials });
    const index = Math.min(this.calls.length - 1, this.answers.length - 1);
    const answer = this.answers[index];
    return typeof answer === 'function' ? (answer as () => unknown)() : answer;
  }

  async check(credentials: LlmCredentials): Promise<void> {
    this.checks.push(credentials);
    if (this.checkError) throw this.checkError;
  }
}
