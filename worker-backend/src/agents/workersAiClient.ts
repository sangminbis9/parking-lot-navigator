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

type AiTextResponse = {
  response?: string;
};

export async function callAiText(opts: AiCallOptions): Promise<string> {
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
  const data = raw as AiTextResponse;
  const text = typeof data?.response === "string" ? data.response.trim() : "";
  if (!text) throw new Error("workers_ai_empty_response");
  return text;
}

export async function callAiJson<T>(opts: AiCallOptions): Promise<T> {
  const text = await callAiText({ ...opts, jsonMode: true });
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    throw new Error(
      `workers_ai_json_parse_failed:${(error as Error).message}:${cleaned.slice(0, 200)}`,
    );
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
