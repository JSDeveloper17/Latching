export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function normalizeError(error) {
  if (error instanceof ApiError) return error;

  if (error?.code === "LIMIT_FILE_SIZE") {
    return new ApiError(413, "File is too large. Maximum allowed size is 10 MB.", {
      code: error.code
    });
  }

  if (error?.message?.includes("Only CSV or XLSX files are allowed")) {
    return new ApiError(400, "Only CSV or XLSX files are allowed.");
  }

  if (error?.message?.includes("Origin is not allowed by CORS")) {
    return new ApiError(403, "Request origin is not allowed.");
  }

  if (error?.type === "entity.parse.failed" || error instanceof SyntaxError) {
    return new ApiError(400, "Invalid JSON request body.", {
      originalMessage: error.message
    });
  }

  return new ApiError(500, "Unexpected server error.", {
    originalMessage: error?.message,
    stack: error?.stack
  });
}

