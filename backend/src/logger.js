const levels = {
  info: "INFO",
  success: "SUCCESS",
  warn: "WARN",
  error: "ERROR",
  debug: "DEBUG"
};

function timestamp() {
  return new Date().toISOString();
}

function serializeMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) return "";

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [unserializable-meta]";
  }
}

function write(level, message, meta = {}) {
  const output = `[${timestamp()}] [${levels[level]}] ${message}${serializeMeta(meta)}`;

  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
}

export const logger = {
  info: (message, meta) => write("info", message, meta),
  success: (message, meta) => write("success", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
  debug: (message, meta) => {
    if (process.env.NODE_ENV !== "production") write("debug", message, meta);
  }
};
