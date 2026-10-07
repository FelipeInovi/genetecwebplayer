// Cameras that reached Streaming: tells a token renewal (keep playing) from a
// first token (the cell cannot start). Shared by the player hook and the
// multiplexed service, which has no cell of its own to ask.
const streamed = new Set<string>();

export const markStreamed = (cameraId: string): void => {
  streamed.add(cameraId);
};

export const hasStreamed = (cameraId: string): boolean =>
  streamed.has(cameraId);

export const forgetStreamed = (cameraId: string): void => {
  streamed.delete(cameraId);
};

/** Tests only. */
export const resetStreamed = (): void => streamed.clear();
