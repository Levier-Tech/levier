import { z } from "zod";
const methods = z.enum([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
]);
const request = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.number().int(), z.string().max(100)]),
    method: methods,
    params: z.array(z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.params === undefined &&
      ![
        "eth_chainId",
        "eth_blockNumber",
        "eth_gasPrice",
        "eth_maxPriorityFeePerGas",
      ].includes(value.method)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["params"],
        message: "Method parameters required",
      });
    }
  })
  // JSON-RPC permits params to be omitted for parameterless methods.
  .transform((value) => ({ ...value, params: value.params ?? [] }));
export function validateRpc(value, maxBatch) {
  return Array.isArray(value)
    ? z.array(request).min(1).max(maxBatch).parse(value)
    : request.parse(value);
}
export function sanitizedRpcResponse(input, output) {
  if (Array.isArray(input)) {
    if (!Array.isArray(output) || input.length !== output.length)
      throw new Error("Invalid batch response");
    return input.map((item) => {
      const matches = output.filter((entry) => entry?.id === item.id);
      if (matches.length !== 1) throw new Error("Invalid response identity");
      return sanitizedRpcResponse(item, matches[0]);
    });
  }
  if (!output || output.jsonrpc !== "2.0" || output.id !== input.id)
    throw new Error("Invalid RPC response");
  if (output.error)
    return {
      jsonrpc: "2.0",
      id: input.id,
      error: { code: -32000, message: "RPC request failed" },
    };
  if (!Object.hasOwn(output, "result")) throw new Error("Missing RPC result");
  return { jsonrpc: "2.0", id: input.id, result: output.result };
}
export async function boundedText(stream, limit) {
  if (!stream) throw new Error("Missing body");
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("Payload exceeds limit");
      chunks.push(value);
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
