import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 60;

const BASE_PROMPT = `You are Alma, an autonomous liquidity management agent for Uniswap V4. You help users understand and manage their concentrated liquidity positions. Be concise and direct. Use plain language. When users ask to perform actions like rebalancing or claiming fees, explain what would happen step by step.`;

function buildSystemPrompt(positionContext: Record<string, unknown> | null): string {
  if (!positionContext) return BASE_PROMPT;

  return `${BASE_PROMPT}

The user is currently viewing their Uniswap V4 position with the following data:
- Position ID: #${positionContext.tokenId}
- Pool: ${positionContext.token0}/${positionContext.token1}
- Tick range: [${positionContext.tickLower}, ${positionContext.tickUpper}]
- Current tick: ${positionContext.currentTick}
- Liquidity: ${positionContext.liquidity}
- Status: ${positionContext.isInRange ? "IN RANGE" : `OUT OF RANGE (${positionContext.percentOutOfRange}% outside)`}
- Fee tier: ${positionContext.fee}
- Tick spacing: ${positionContext.tickSpacing}

Answer questions about this specific position. If the user asks to rebalance, claim fees, or modify the position, explain the steps clearly.`;
}

export async function POST(request: Request) {
  try {
    const { message, messages, positionContext } = await request.json();

    const allMessages = messages ?? (message ? [message] : []);
    const modelMessages = await convertToModelMessages(allMessages);

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const result = streamText({
          // @ts-expect-error — version mismatch between ai-sdk core and openai adapter
          model: openai("gpt-4o-mini"),
          system: buildSystemPrompt(positionContext ?? null),
          messages: modelMessages,
        });

        dataStream.merge(result.toUIMessageStream());
      },
      generateId: generateUUID,
      onError: (error) => {
        console.error("Stream error:", error);
        return "An error occurred while generating a response.";
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request. Check your OPENAI_API_KEY." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
