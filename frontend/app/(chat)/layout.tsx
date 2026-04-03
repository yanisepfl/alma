import { Toaster } from "sonner";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { PositionProvider } from "@/hooks/use-position-context";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DataStreamProvider>
      <PositionProvider>
        <div className="flex h-dvh">
          <AppSidebar />
          <div className="flex flex-1 flex-col min-w-0">
            <Toaster
              position="top-center"
              theme="system"
              toastOptions={{
                className:
                  "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
              }}
            />
            <ActiveChatProvider>
              <ChatShell />
            </ActiveChatProvider>
            {children}
          </div>
        </div>
      </PositionProvider>
    </DataStreamProvider>
  );
}
