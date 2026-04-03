"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { toast } from "@/components/chat/toast";
import { usePositionContext } from "@/hooks/use-position-context";
import { serializePosition } from "@/lib/positions/utils";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const { setDataStream } = useDataStream();
  const { selectedPosition } = usePositionContext();
  const chatIdRef = useRef(generateUUID());
  const chatId = chatIdRef.current;

  const [input, setInput] = useState("");

  // Keep a ref to the selected position so the transport can read it
  const positionRef = useRef(selectedPosition);
  useEffect(() => {
    positionRef.current = selectedPosition;
  }, [selectedPosition]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
  } = useChat<ChatMessage>({
    id: chatId,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const pos = positionRef.current;
        return {
          body: {
            id: request.id,
            message: lastMessage,
            messages: request.messages,
            positionContext: pos ? serializePosition(pos) : null,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onError: (error) => {
      toast({
        type: "error",
        description: error.message || "Oops, an error occurred!",
      });
    },
  });

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      input,
      setInput,
      isLoading: false,
    }),
    [chatId, messages, setMessages, sendMessage, status, stop, input]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
