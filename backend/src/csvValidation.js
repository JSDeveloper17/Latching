import fs from "node:fs";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import { parse } from "csv-parse";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const MIN_DATA_ROWS = 1;
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx"]);

const REQUIRED_COLUMNS = [
  "FSN",
  "SELLER SKU ID",
  "LISTING STATUS*",
  "MRP*",
  "YOUR SELLING PRICE*",
  "MINIMUM ORDER QUANTITY (MINOQ)",
  "FULLFILMENT BY*",
  "PROCUREMENT TYPE*",
  "PROCUREMENT SLA*",
  "STOCK*",
  "SHIPPING PROVIDER*",
  "HSN*",
  "TAX CODE*",
  "COUNTRY OF ORIGIN*"
];

function normalizeHeader(value) {
  return String(value || "").trim().toUpperCase();
}

function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value).trim();
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
  if (value.text) return String(value.text).trim();
  if (value.result !== undefined) return cellToString(value.result);
  if (value.hyperlink) return String(value.hyperlink).trim();
  return String(value).trim();
}

function createValidationState() {
  return {
    headers: null,
    fsnIndex: -1,
    total: 0,
    maxRows: Math.max(Number(config.csvMaxRows) || 100, MIN_DATA_ROWS)
  };
}

function isEmptyRow(row) {
  return row.every((cell) => !String(cell || "").trim());
}

function processRow(state, row) {
  if (isEmptyRow(row)) return;

  if (!state.headers) {
    state.headers = row.map(normalizeHeader);
    const missing = REQUIRED_COLUMNS.filter((column) => !state.headers.includes(column));

    if (missing.length > 0) {
      throw new ApiError(422, `Missing required columns: ${missing.join(", ")}.`, {
        missingColumns: missing
      });
    }

    state.fsnIndex = state.headers.indexOf("FSN");
    return;
  }

  state.total += 1;

  if (state.total > state.maxRows) {
    throw new ApiError(422, `File cannot contain more than ${state.maxRows} data rows.`, {
      maxRows: state.maxRows
    });
  }

  if (!String(row[state.fsnIndex] || "").trim()) {
    throw new ApiError(422, `FSN is required on row ${state.total + 1}.`, {
      row: state.total + 1
    });
  }
}

function completeValidation(state) {
  if (!state.headers || state.total < MIN_DATA_ROWS) {
    throw new ApiError(422, "File must include a header and at least one data row.");
  }

  return {
    total: state.total,
    headers: state.headers
  };
}

async function validateCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const state = createValidationState();
    let isSettled = false;

    function fail(error) {
      if (isSettled) return;
      isSettled = true;
      reject(error);
    }

    const parser = parse({
      bom: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true
    });

    const stream = fs.createReadStream(filePath, { encoding: "utf8" });

    stream.on("error", (error) => {
      fail(new ApiError(400, "Unable to read uploaded CSV file.", {
        originalMessage: error.message
      }));
    });

    parser.on("readable", () => {
      let row;
      while ((row = parser.read()) !== null) {
        try {
          processRow(state, row.map(cellToString));
        } catch (error) {
          fail(error);
          stream.destroy();
          parser.destroy();
          return;
        }
      }
    });

    parser.on("error", (error) => {
      fail(new ApiError(422, "CSV could not be parsed. Check the file format and quoting.", {
        originalMessage: error.message
      }));
    });

    parser.on("end", () => {
      if (isSettled) return;
      isSettled = true;

      try {
        resolve(completeValidation(state));
      } catch (error) {
        reject(error);
      }
    });

    stream.pipe(parser);
  });
}

async function validateXlsxFile(filePath) {
  const state = createValidationState();

  try {
    const rows = await readXlsxFile(filePath, { sheet: 1 });

    for (const row of rows) {
      processRow(state, row.map(cellToString));
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "Excel file could not be parsed. Upload a valid .xlsx workbook.", {
      originalMessage: error.message
    });
  }

  return completeValidation(state);
}

export async function validateCsv(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ApiError(400, "Only CSV or XLSX files are allowed.");
  }

  if (extension === ".xlsx") {
    return validateXlsxFile(filePath);
  }

  return validateCsvFile(filePath);
}

