import { createContext } from "react";
import type { IMediaGatewayService } from "@/render/types/genetec";

export interface GenetecServiceValue {
  /** true: cells share one IMediaGatewayService (startWithService). */
  multiplexed: boolean;
  service: IMediaGatewayService | null;
  /** false while the shared service is still being built. */
  ready: boolean;
  error: Error | null;
}

/** Default = individual mode: every cell opens its own connection via start(). */
export const GenetecServiceContext = createContext<GenetecServiceValue>({
  multiplexed: false,
  service: null,
  ready: true,
  error: null
});
