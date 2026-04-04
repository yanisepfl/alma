"use client";

import { usePositionContext } from "@/hooks/use-position-context";
import { ConnectButton } from "../connect-button";
import { PositionDashboard } from "../positions/position-dashboard";
import { PositionsGrid } from "../positions/positions-grid";
// import { useActiveChat } from "@/hooks/use-active-chat";
// import { Messages } from "./messages";
// import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const { selectedPosition } = usePositionContext();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <div className="absolute top-3 right-4 z-20">
        <ConnectButton />
      </div>

      <div className="absolute bottom-3 right-4 z-20 flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground/50">Built with ❤️ for Uniswap at ETHGlobal</span>
        <a href="#" className="text-[10px] text-muted-foreground/45 hover:text-muted-foreground transition-colors">Documentation</a>
        <a href="#" className="text-[10px] text-muted-foreground/45 hover:text-muted-foreground transition-colors">Twitter</a>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
        {selectedPosition ? (
          <PositionDashboard position={selectedPosition} />
        ) : (
          <PositionsGrid />
        )}
      </div>
    </div>
  );
}
