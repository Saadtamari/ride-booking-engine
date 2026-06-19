/**
 * A single, predictable response envelope for the whole API.
 * Success:  { success: true,  data: {...} }
 * Failure:  { success: false, error: { code, message, details? } }
 */

export interface SuccessBody<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function ok<T>(data: T): SuccessBody<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return { success: false, error: details ? { code, message, details } : { code, message } };
}

/** A fully-formed HTTP outcome: status code + JSON body. */
export interface HttpResult {
  statusCode: number;
  body: SuccessBody | ErrorBody;
}
