// lib/data-intelligence.ts
//
// Pure functions that analyze uploaded dataset schemas to produce:
//   1. Data quality issues (missing values, constant columns, etc.)
//   2. Smart suggested prompts tailored to the actual data

// ── Types ────────────────────────────────────────────────────────────────────

interface ColumnStats {
  type: string;         // "number" | "string" | "boolean"
  missingCount: number;
  uniqueCount: number;
  sampleValues: unknown[];
}

interface DatasetSchema {
  columns: Record<string, ColumnStats>;
  rowCount: number;
}

export interface DataQualityIssue {
  severity: "warning" | "info";
  column?: string;
  message: string;
  detail: string;
}

export interface SuggestedPrompt {
  text: string;
  category: "explore" | "visualize" | "analyze" | "clean";
}

// ── Schema parser ────────────────────────────────────────────────────────────

function parseSchemas(
  files: { filename: string; schema: unknown }[]
): { filename: string; schema: DatasetSchema }[] {
  return files
    .map((f) => {
      const s = f.schema as DatasetSchema | null;
      if (!s?.columns || !s?.rowCount) return null;
      return { filename: f.filename, schema: s };
    })
    .filter(Boolean) as { filename: string; schema: DatasetSchema }[];
}

// ── Data Quality Analysis ────────────────────────────────────────────────────

export function analyzeDataQuality(
  files: { filename: string; schema: unknown }[]
): DataQualityIssue[] {
  const parsed = parseSchemas(files);
  if (parsed.length === 0) return [];

  const issues: DataQualityIssue[] = [];

  for (const { filename, schema } of parsed) {
    const prefix = parsed.length > 1 ? `${filename}: ` : "";
    const { columns, rowCount } = schema;

    let totalMissing = 0;
    let columnsWithMissing = 0;

    for (const [col, stats] of Object.entries(columns)) {
      const missingPct = rowCount > 0 ? (stats.missingCount / rowCount) * 100 : 0;

      // Fully empty column
      if (stats.missingCount === rowCount && rowCount > 0) {
        issues.push({
          severity: "warning",
          column: col,
          message: `${prefix}"${col}" is entirely empty`,
          detail: "This column has no data and can likely be dropped.",
        });
        totalMissing += stats.missingCount;
        columnsWithMissing++;
        continue;
      }

      // High missing rate (>20%)
      if (missingPct > 20) {
        issues.push({
          severity: "warning",
          column: col,
          message: `${prefix}"${col}" has ${Math.round(missingPct)}% missing values`,
          detail: `${stats.missingCount.toLocaleString()} of ${rowCount.toLocaleString()} rows are empty. Consider imputation or dropping.`,
        });
        columnsWithMissing++;
      } else if (missingPct > 5) {
        // Moderate missing (5-20%)
        issues.push({
          severity: "info",
          column: col,
          message: `${prefix}"${col}" has ${Math.round(missingPct)}% missing values`,
          detail: `${stats.missingCount.toLocaleString()} of ${rowCount.toLocaleString()} rows are empty.`,
        });
        columnsWithMissing++;
      }

      if (stats.missingCount > 0) totalMissing += stats.missingCount;

      // Constant column (only 1 unique value, not empty)
      if (stats.uniqueCount === 1 && stats.missingCount < rowCount) {
        issues.push({
          severity: "info",
          column: col,
          message: `${prefix}"${col}" has a single constant value`,
          detail: `Every row is "${String(stats.sampleValues[0])}". This column adds no analytical value.`,
        });
      }

      // Possible ID column (unique count == row count, string type)
      if (
        stats.type === "string" &&
        stats.uniqueCount === rowCount &&
        rowCount > 10
      ) {
        issues.push({
          severity: "info",
          column: col,
          message: `${prefix}"${col}" looks like an ID column`,
          detail: "Every value is unique. Exclude from numeric analysis.",
        });
      }
    }

    // Dataset-level summary if multiple columns have missing data
    if (columnsWithMissing >= 3) {
      const totalCells = rowCount * Object.keys(columns).length;
      const overallPct = totalCells > 0 ? (totalMissing / totalCells) * 100 : 0;
      issues.unshift({
        severity: "warning",
        message: `${prefix}${columnsWithMissing} columns have missing data (${overallPct.toFixed(1)}% of all cells)`,
        detail: "Review missing data patterns before running analysis.",
      });
    }
  }

  return issues;
}

// ── Smart Suggested Prompts ──────────────────────────────────────────────────

// Column name patterns for domain detection
const SURVIVAL_PATTERNS = /^(time|duration|survival|os_months|pfs|dfs|efs|rfs|tte|follow_up)/i;
const EVENT_PATTERNS = /^(status|event|died|dead|death|censored|vital_status|os_status)/i;
const CLINICAL_PATTERNS = /^(age|sex|gender|stage|grade|tnm|tumor|diagnosis|treatment|therapy|response|recurrence|metastasis)/i;
const DATE_PATTERNS = /^(date|dt|dob|diagnosis_date|birth)/i;

export function generateSuggestedPrompts(
  files: { filename: string; schema: unknown }[]
): SuggestedPrompt[] {
  const parsed = parseSchemas(files);
  if (parsed.length === 0) return [];

  const prompts: SuggestedPrompt[] = [];

  // Always start with exploration
  prompts.push({
    text: "Describe the dataset and summarize key statistics",
    category: "explore",
  });

  // Aggregate column info across all files
  const allColumns: { name: string; stats: ColumnStats; filename: string }[] = [];
  for (const { filename, schema } of parsed) {
    for (const [name, stats] of Object.entries(schema.columns)) {
      allColumns.push({ name, stats, filename });
    }
  }

  const numericCols = allColumns.filter((c) => c.stats.type === "number");
  const stringCols = allColumns.filter((c) => c.stats.type === "string");
  const categoricalCols = stringCols.filter(
    (c) => c.stats.uniqueCount <= 20 && c.stats.uniqueCount > 1
  );

  // Check for domain patterns
  const hasSurvival = allColumns.some((c) => SURVIVAL_PATTERNS.test(c.name));
  const hasEvent = allColumns.some((c) => EVENT_PATTERNS.test(c.name));
  const hasClinical = allColumns.some((c) => CLINICAL_PATTERNS.test(c.name));
  const hasDate = allColumns.some((c) => DATE_PATTERNS.test(c.name));

  // Missing data prompt if quality issues exist
  const totalMissing = allColumns.reduce((sum, c) => sum + c.stats.missingCount, 0);
  if (totalMissing > 0) {
    prompts.push({
      text: "Analyze missing data patterns and suggest a cleaning strategy",
      category: "clean",
    });
  }

  // Visualization prompts
  if (numericCols.length >= 2) {
    prompts.push({
      text: "Show distributions of all numeric columns",
      category: "visualize",
    });
  }

  if (numericCols.length >= 3) {
    prompts.push({
      text: "Correlation heatmap of numeric variables",
      category: "visualize",
    });
  }

  // Categorical breakdown
  if (categoricalCols.length > 0 && numericCols.length > 0) {
    const cat = categoricalCols[0].name;
    const num = numericCols.find(
      (n) => !SURVIVAL_PATTERNS.test(n.name) && !EVENT_PATTERNS.test(n.name)
    );
    if (num) {
      prompts.push({
        text: `Compare ${num.name} across ${cat} groups`,
        category: "analyze",
      });
    }
  }

  // Survival analysis
  if (hasSurvival && hasEvent) {
    prompts.push({
      text: "Run a Kaplan-Meier survival analysis",
      category: "analyze",
    });

    if (categoricalCols.length > 0) {
      const stratifier = categoricalCols.find((c) =>
        CLINICAL_PATTERNS.test(c.name)
      ) ?? categoricalCols[0];
      prompts.push({
        text: `Survival curves stratified by ${stratifier.name}`,
        category: "analyze",
      });
    }
  }

  // Clinical data prompts
  if (hasClinical && !hasSurvival) {
    prompts.push({
      text: "Explore clinical variable relationships",
      category: "analyze",
    });
  }

  // Date columns
  if (hasDate) {
    prompts.push({
      text: "Analyze trends over time",
      category: "analyze",
    });
  }

  // Multiple files
  if (parsed.length > 1) {
    prompts.push({
      text: "Can these datasets be merged? Show common columns",
      category: "explore",
    });
  }

  // Outlier detection for numeric data
  if (numericCols.length > 0) {
    prompts.push({
      text: "Detect outliers in the numeric columns",
      category: "analyze",
    });
  }

  // Cap at 6 to avoid overwhelming the UI
  return prompts.slice(0, 6);
}
