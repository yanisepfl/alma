import { Toaster } from "sonner";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatShell } from "@/components/chat/shell";
import { PositionProvider } from "@/hooks/use-position-context";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
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
          <ChatShell />
          {children}
        </div>
      </div>
    </PositionProvider>
  );
}
