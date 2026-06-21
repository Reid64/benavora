import { vi } from "vitest";

interface QueryRecord {
  table: string;
  operation: "select" | "insert" | "update" | "upsert" | "delete";
  filters: Array<{ column: string; value: unknown }>;
  data?: unknown;
}

type TableData = Record<string, unknown[]>;

export function createSupabaseMock(initialData: TableData = {}) {
  const queries: QueryRecord[] = [];
  const tableData: TableData = { ...initialData };
  let orgId: string | null = null;

  function getTableRows(table: string): unknown[] {
    return tableData[table] ?? [];
  }

  function applyRls(rows: unknown[]): unknown[] {
    if (!orgId) return rows;
    return rows.filter((row) => {
      const r = row as Record<string, unknown>;
      return !("organization_id" in r) || r["organization_id"] === orgId;
    });
  }

  function createQueryBuilder(table: string) {
    const currentRecord: QueryRecord = {
      table,
      operation: "select",
      filters: [],
    };
    let pendingData: unknown = undefined;

    const builder = {
      select: vi.fn((_columns?: string) => {
        currentRecord.operation = "select";
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        currentRecord.filters.push({ column, value });
        return builder;
      }),
      neq: vi.fn((_column: string, _value: unknown) => builder),
      gt: vi.fn((_column: string, _value: unknown) => builder),
      lt: vi.fn((_column: string, _value: unknown) => builder),
      gte: vi.fn((_column: string, _value: unknown) => builder),
      lte: vi.fn((_column: string, _value: unknown) => builder),
      in: vi.fn((_column: string, _values: unknown[]) => builder),
      is: vi.fn((_column: string, _value: unknown) => builder),
      not: vi.fn((_column: string, _op: string, _value: unknown) => builder),
      contains: vi.fn((_column: string, _value: unknown) => builder),
      order: vi.fn((_column: string, _opts?: unknown) => builder),
      limit: vi.fn((_count: number) => builder),
      range: vi.fn((_from: number, _to: number) => builder),
      insert: vi.fn((data: unknown) => {
        currentRecord.operation = "insert";
        pendingData = data;
        return builder;
      }),
      update: vi.fn((data: unknown) => {
        currentRecord.operation = "update";
        pendingData = data;
        return builder;
      }),
      upsert: vi.fn((data: unknown) => {
        currentRecord.operation = "upsert";
        pendingData = data;
        return builder;
      }),
      delete: vi.fn(() => {
        currentRecord.operation = "delete";
        return builder;
      }),
      single: vi.fn(async () => {
        queries.push({ ...currentRecord });
        const rows = applyRls(getTableRows(table));
        const filtered = applyFilters(rows, currentRecord.filters);
        return filtered.length > 0
          ? { data: filtered[0], error: null }
          : { data: null, error: { message: "No rows found", code: "PGRST116" } };
      }),
      maybeSingle: vi.fn(async () => {
        queries.push({ ...currentRecord });
        const rows = applyRls(getTableRows(table));
        const filtered = applyFilters(rows, currentRecord.filters);
        return { data: filtered[0] ?? null, error: null };
      }),
      then: vi.fn((resolve: (value: unknown) => unknown) => {
        queries.push({ ...currentRecord, data: pendingData });
        if (
          currentRecord.operation === "insert" ||
          currentRecord.operation === "upsert"
        ) {
          const insertedRow = pendingData as Record<string, unknown>;
          if (!tableData[table]) tableData[table] = [];
          tableData[table]!.push(insertedRow);
          return Promise.resolve(resolve({ data: insertedRow, error: null }));
        }
        if (currentRecord.operation === "update") {
          const rows = applyRls(getTableRows(table));
          const updated = applyFilters(rows, currentRecord.filters).map((r) => ({
            ...(r as Record<string, unknown>),
            ...(pendingData as Record<string, unknown>),
          }));
          return Promise.resolve(resolve({ data: updated, error: null }));
        }
        if (currentRecord.operation === "delete") {
          const rows = getTableRows(table);
          tableData[table] = rows.filter((r) => {
            const matched = applyFilters([r], currentRecord.filters);
            return matched.length === 0;
          });
          return Promise.resolve(resolve({ data: null, error: null }));
        }
        const rows = applyRls(getTableRows(table));
        const filtered = applyFilters(rows, currentRecord.filters);
        return Promise.resolve(resolve({ data: filtered, error: null }));
      }),
    };

    return builder;
  }

  function applyFilters(
    rows: unknown[],
    filters: Array<{ column: string; value: unknown }>
  ): unknown[] {
    return rows.filter((row) => {
      const r = row as Record<string, unknown>;
      return filters.every(({ column, value }) => r[column] === value);
    });
  }

  const mockClient = {
    from: vi.fn((table: string) => createQueryBuilder(table)),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: orgId ?? "test-user-id" } },
        error: null,
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        download: vi.fn().mockResolvedValue({ data: null, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      })),
    },
  };

  return {
    client: mockClient,
    queries,
    tableData,
    setOrgId: (id: string) => {
      orgId = id;
    },
    setTableData: (table: string, rows: unknown[]) => {
      tableData[table] = rows;
    },
    reset: () => {
      queries.length = 0;
      Object.keys(tableData).forEach((k) => delete tableData[k]);
      Object.assign(tableData, initialData);
      orgId = null;
    },
  };
}
