export class TokenExpiredError extends Error {
  constructor(message = "Bearer token expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

export class GenetecForbiddenError extends Error {
  constructor(message = "No access to this Genetec resource") {
    super(message);
    this.name = "GenetecForbiddenError";
  }
}

/** Error raised by the player after start (onErrorStateRaised or a non-recoverable stream status). */
export class GwpPlayerError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly isFatal: boolean
  ) {
    super(message);
    this.name = "GwpPlayerError";
  }
}

export class CameraOfflineError extends Error {
  constructor(message = "Camera is offline") {
    super(message);
    this.name = "CameraOfflineError";
  }
}
