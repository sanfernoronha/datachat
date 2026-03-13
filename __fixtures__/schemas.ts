// __fixtures__/schemas.ts
//
// Reusable test data for dataset schemas and uploaded file objects.

export interface ColumnStats {
  type: string;
  missingCount: number;
  uniqueCount: number;
  sampleValues: unknown[];
}

export interface DatasetSchema {
  columns: Record<string, ColumnStats>;
  rowCount: number;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

export const EMPTY_SCHEMA: DatasetSchema = { columns: {}, rowCount: 0 };

export const SIMPLE_SCHEMA: DatasetSchema = {
  columns: {
    id: { type: "string", missingCount: 0, uniqueCount: 100, sampleValues: ["A1", "A2", "A3"] },
    name: { type: "string", missingCount: 0, uniqueCount: 90, sampleValues: ["Alice", "Bob", "Carol"] },
    value: { type: "number", missingCount: 0, uniqueCount: 80, sampleValues: [1.5, 2.3, 4.7] },
  },
  rowCount: 100,
};

export const MISSING_DATA_SCHEMA: DatasetSchema = {
  columns: {
    col_a: { type: "number", missingCount: 100, uniqueCount: 1, sampleValues: [] },       // 100% missing
    col_b: { type: "number", missingCount: 30, uniqueCount: 50, sampleValues: [1, 2, 3] }, // 30% missing (>20%)
    col_c: { type: "string", missingCount: 10, uniqueCount: 40, sampleValues: ["x", "y"] },// 10% missing (5-20%)
    col_d: { type: "number", missingCount: 2, uniqueCount: 60, sampleValues: [5, 6, 7] },  // 2% missing (<5%)
  },
  rowCount: 100,
};

export const CONSTANT_COLUMN_SCHEMA: DatasetSchema = {
  columns: {
    status: { type: "string", missingCount: 0, uniqueCount: 1, sampleValues: ["active"] },
    score: { type: "number", missingCount: 0, uniqueCount: 50, sampleValues: [10, 20, 30] },
  },
  rowCount: 50,
};

export const ID_COLUMN_SCHEMA: DatasetSchema = {
  columns: {
    patient_id: { type: "string", missingCount: 0, uniqueCount: 100, sampleValues: ["P001", "P002", "P003"] },
    age: { type: "number", missingCount: 0, uniqueCount: 60, sampleValues: [25, 30, 45] },
  },
  rowCount: 100,
};

export const GENOMICS_SCHEMA: DatasetSchema = {
  columns: {
    patient_id: { type: "string", missingCount: 0, uniqueCount: 200, sampleValues: ["P001", "P002", "P003"] },
    os_months: { type: "number", missingCount: 5, uniqueCount: 150, sampleValues: [12.5, 24.0, 36.1] },
    vital_status: { type: "string", missingCount: 0, uniqueCount: 2, sampleValues: ["alive", "dead"] },
    age: { type: "number", missingCount: 3, uniqueCount: 70, sampleValues: [55, 62, 71] },
    stage: { type: "string", missingCount: 10, uniqueCount: 4, sampleValues: ["I", "II", "III"] },
    grade: { type: "string", missingCount: 8, uniqueCount: 3, sampleValues: ["low", "mid", "high"] },
    tp53_expression: { type: "number", missingCount: 0, uniqueCount: 195, sampleValues: [0.5, 1.2, 3.4] },
    brca1_expression: { type: "number", missingCount: 0, uniqueCount: 190, sampleValues: [0.8, 1.1, 2.9] },
  },
  rowCount: 200,
};

export const DATE_SCHEMA: DatasetSchema = {
  columns: {
    date: { type: "string", missingCount: 0, uniqueCount: 50, sampleValues: ["2024-01-01", "2024-02-01"] },
    count: { type: "number", missingCount: 0, uniqueCount: 40, sampleValues: [10, 20, 30] },
  },
  rowCount: 50,
};

export const MULTI_MISSING_SCHEMA: DatasetSchema = {
  columns: {
    a: { type: "number", missingCount: 25, uniqueCount: 50, sampleValues: [1] },
    b: { type: "number", missingCount: 30, uniqueCount: 40, sampleValues: [2] },
    c: { type: "string", missingCount: 15, uniqueCount: 30, sampleValues: ["x"] },
    d: { type: "number", missingCount: 20, uniqueCount: 35, sampleValues: [3] },
  },
  rowCount: 100,
};

// ── Uploaded File Objects ────────────────────────────────────────────────────

export function makeUploadedFile(
  overrides: Partial<{
    id: string;
    sessionId: string;
    filename: string;
    filePath: string;
    fileSize: bigint;
    fileType: string;
    schema: unknown;
    createdAt: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? "file-1",
    sessionId: overrides.sessionId ?? "session-1",
    filename: overrides.filename ?? "data.csv",
    filePath: overrides.filePath ?? "sessions/session-1/data/data.csv",
    fileSize: overrides.fileSize ?? BigInt(1024),
    fileType: overrides.fileType ?? "text/csv",
    schema: overrides.schema ?? SIMPLE_SCHEMA,
    createdAt: overrides.createdAt ?? new Date("2024-01-01"),
  };
}
