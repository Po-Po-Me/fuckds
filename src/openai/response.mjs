import crypto from 'node:crypto';

import { estimateTokens } from '../util.mjs';

/**
 * 对外声称的原生模型名（网页版背后的真实模型）；/v1/models 里排在第一位。
 * 请求侧的模型名不校验，所以这里列出来的必须和 config.deepseek 真正接受的别名一致，
 * 否则客户端拿到 id 再发回来会碰到 model_not_found。
 */
export const NATIVE_MODEL_ID = 'deepseek-v4.1-flash-1017';

const modelEntry = (id) => ({ id, object: 'model', created: 0, owned_by: 'deepseek-web' });

/** 固定返回原生名（不依赖 config 时的兜底列表，也用于测试与文档） */
export const MODELS = [modelEntry(NATIVE_MODEL_ID)];

/** 服务端真正接受的模型名：原生名 + 默认模型 + 所有别名，去重保序 */
export function modelIds(config) {
  const ids = new Set(MODELS.map((model) => model.id));
  const deepseek = config?.deepseek ?? {};
  if (deepseek.defaultModel) ids.add(deepseek.defaultModel);
  for (const alias of Object.keys(deepseek.modelAliases ?? {})) ids.add(alias);
  return [...ids];
}

export const newCompletionId = () => `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;

export function modelsResponse(config) {
  return { object: 'list', data: modelIds(config).map(modelEntry) };
}

/** 非流式响应 */
export function buildChatCompletion({ id, model, content, reasoning, toolCalls, finishReason, usage }) {
  const message = { role: 'assistant', content };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls?.length) {
    message.tool_calls = toolCalls.map((call, index) => ({
      id: call.id ?? `call_${crypto.randomBytes(8).toString('hex')}`,
      index,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    message.content = content ?? '';
  }
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, logprobs: null, finish_reason: finishReason }],
    usage,
  };
}

/** 流式 chunk */
export function buildChatChunk({ id, model, delta, finishReason = null }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  };
}

/**
 * 粗略 usage：网页版不返回真实 token 数，这里按字符估算并标注。
 *
 * `completion_tokens` 必须包含思考（reasoning）token：OpenAI / pi-ai 的约定就是
 * completion_tokens 含 reasoning_tokens。少算会让客户端显示的 tok/s 明显偏低
 * （工具调用轮次思考多、正文少时尤其明显，看起来就像「一调用工具就掉速」）。
 */
export function estimateUsage(promptText, completionText, reasoningText = '') {
  const prompt = estimateTokens(promptText);
  const reasoning = estimateTokens(reasoningText);
  const completion = estimateTokens(completionText) + reasoning;
  const usage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    estimated: true,
  };
  if (reasoning > 0) usage.completion_tokens_details = { reasoning_tokens: reasoning };
  return usage;
}
