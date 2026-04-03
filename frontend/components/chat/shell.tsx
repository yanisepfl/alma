"use client";

import { useActiveChat } from "@/hooks/use-active-chat";
import { usePositionContext } from "@/hooks/use-position-context";
import { ConnectButton } from "../connect-button";
import { EmptyState } from "../positions/empty-state";
import { PositionDashboard } from "../positions/position-dashboard";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    input,
    setInput,
    isLoading,
  } = useActiveChat();

  const { selectedPosition } = usePositionContext();

  const handleSuggestedAction = (text: string) => {
    sendMessage({
      role: "user",
      parts: [{ type: "text", text }],
    });
  };

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <div className="absolute top-3 right-4 z-20">
        <ConnectButton />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {selectedPosition ? (
          <div className="flex-1 overflow-y-auto">
            <PositionDashboard
              position={selectedPosition}
              onSuggestedAction={handleSuggestedAction}
            />

            {messages.length > 0 && (
              <div className="mx-auto w-full max-w-4xl px-2 pb-4 md:px-4">
                <div className="border-t border-border/20 pt-4">
                  <Messages
                    chatId={chatId}
                    isLoading={isLoading}
                    messages={messages}
                    status={status}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState />
              </div>
            ) : (
              <Messages
                chatId={chatId}
                isLoading={isLoading}
                messages={messages}
                status={status}
              />
            )}
          </div>
        )}

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          <MultimodalInput
            chatId={chatId}
            input={input}
            isLoading={isLoading}
            messages={messages}
            sendMessage={sendMessage}
            setInput={setInput}
            setMessages={setMessages}
            status={status}
            stop={stop}
          />
        </div>
      </div>
    </div>
  );
}
