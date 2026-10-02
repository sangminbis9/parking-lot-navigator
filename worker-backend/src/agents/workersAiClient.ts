// Cloudflare Workers AI wrapper. Uses Llama model on the platform's built-in AI binding.
// Docs: https://developers.cloudflare.com/workers-ai/models/

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type AiCallOptions = {
  ai: Ai;
  systemInstruction?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  model?: string;
};

type AiRawResponse = {
  // JSON mode(response_format)일 때 Workers AI는 `response`를 이미 파싱된 객체로
  // 돌려준다. 타입 정의는 string뿐이라 string만 보던 예전 코드는 정상 응답을
  // `workers_ai_empty_response`로 버렸다(2026-10 운영 activity 로그).
  response?: unknown;
};

async function runAi(opts: AiCallOptions): Promise<unknown> {
  if (!opts.ai) throw new Error("workers_ai_binding_missing");
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemInstruction) {
    messages.push({ role: "system", content: opts.systemInstruction });
  }
  messages.push({ role: "user", content: opts.prompt });
  const payload: Record<string, unknown> = {
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxOutputTokens ?? 1024,
  };
  if (opts.jsonMode) {
    payload.response_format = { type: "json_object" };
  }
  let raw: unknown;
  try {
    raw = await opts.ai.run((opts.model ?? DEFAULT_MODEL) as never, payload as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    throw new Error(`workers_ai_run_failed:${message.slice(0, 400)}`);
  }
  return (raw as AiRawResponse | null)?.response;
}

export async function callAiText(opts: AiCallOptions): Promise<string> {
  const response = await runAi(opts);
  const text = typeof response === "string" ? response.trim() : "";
  if (!text) throw new Error("workers_ai_empty_response");
  return text;
}

export async function callAiJson<T>(opts: AiCallOptions): Promise<T> {
  const response = await runAi({ ...opts, jsonMode: true });
  if (response !== null && typeof response === "object") return response as T;
  const text = typeof response === "string" ? response.trim() : "";
  if (!text) throw new Error("workers_ai_empty_response");
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    // 원문은 붙이지 않는다 — 이 메시지가 agent_activity.reason으로 앱에 노출된다.
    throw new Error(`workers_ai_json_parse_failed:${(error as Error).message.slice(0, 120)}`);
  }
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const withoutFirst = trimmed.replace(/^```(?:json)?\s*/i, "");
    return withoutFirst.replace(/```\s*$/i, "").trim();
  }
  return trimmed;
}
