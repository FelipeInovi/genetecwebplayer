import { createContext } from "react";
import type { GwpGetTokenFct, IMediaGatewayService } from "@/render/types/genetec";

export interface GenetecServiceValue {
  /** true: cells share one IMediaGatewayService (startWithService). */
  multiplexed: boolean;
  service: IMediaGatewayService | null;
  /** false while the shared service is still being built. */
  ready: boolean;
  error: Error | null;
  /**
   * Individual mode: the page-wide token retriever (one cache + one queue), so the
   * concurrency cap is global instead of per cell. Absent: cells build their own.
   */
  tokenRetriever?: GwpGetTokenFct;
  /** Shows the GWP debug overlay on every player. Default: off. */
  debugOverlay?: boolean;
}

/** Default = individual mode: every cell opens its own connection via start(). */
export const GenetecServiceContext = createContext<GenetecServiceValue>({
  multiplexed: false,
  service: null,
  ready: true,
  error: null
});
