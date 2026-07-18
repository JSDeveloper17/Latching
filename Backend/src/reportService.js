import fs from "node:fs/promises";
import path from "node:path";

export async function ensureFolders(paths) {
  await Promise.all(paths.map((folderPath) => fs.mkdir(folderPath, { recursive: true })));
}

export async function latestReportAfter(reportsDir, startedAtMs) {
  const entries = await fs.readdir(reportsDir, { withFileTypes: true });
  const reports = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
      .map(async (entry) => {
        const fullPath = path.join(reportsDir, entry.name);
        const stats = await fs.stat(fullPath);
        return { name: entry.name, mtimeMs: stats.mtimeMs };
      })
  );

  return reports
    .filter((report) => report.mtimeMs >= startedAtMs - 1000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name;
}

export async function summarizeReport(reportPath) {
  const content = await fs.readFile(reportPath, "utf8");
  const rows = content
    .split(/\r?\n/)
    .slice(1)
    .map((row) => row.trim())
    .filter(Boolean);

  return rows.reduce(
    (summary, row) => {
      const lower = row.toLowerCase();
      if (lower.includes("success")) summary.success += 1;
      if (lower.includes("failed")) summary.failed += 1;
      return summary;
    },
    { success: 0, failed: 0 }
  );
}
