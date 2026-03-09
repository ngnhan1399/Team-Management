/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { PgQueryResultHKT, PgQueryResultKind } from "drizzle-orm/pg-core/session";

// Runtime compatibility methods are attached by src/db/index.ts.
declare module "drizzle-orm/pg-core/query-builders/select" {
  interface PgSelectBase<
    TTableName extends string | undefined,
    TSelection extends import("drizzle-orm/sql/sql").ColumnsSelection,
    TSelectMode extends import("drizzle-orm/query-builders/select.types").SelectMode,
    TNullabilityMap extends Record<string, import("drizzle-orm/query-builders/select.types").JoinNullability>,
    TDynamic extends boolean,
    TExcludedMethods extends string,
    TResult extends any[],
    TSelectedFields extends import("drizzle-orm/sql/sql").ColumnsSelection,
  > {
    all(): Promise<TResult>;
    get(): Promise<TResult[number] | undefined>;
  }
}

declare module "drizzle-orm/pg-core/query-builders/insert" {
  interface PgInsertBase<
    TTable extends import("drizzle-orm/pg-core/table").PgTable,
    TQueryResult extends PgQueryResultHKT,
    TSelectedFields extends import("drizzle-orm/sql/sql").ColumnsSelection | undefined,
    TReturning extends Record<string, unknown> | undefined,
    TDynamic extends boolean,
    TExcludedMethods extends string,
  > {
    all(): Promise<TReturning extends undefined ? PgQueryResultKind<TQueryResult, never> : TReturning[]>;
    get(): Promise<TReturning extends undefined ? PgQueryResultKind<TQueryResult, never> | undefined : TReturning | undefined>;
    run(): Promise<PgQueryResultKind<TQueryResult, never> & { rowsAffected: number }>;
  }
}

declare module "drizzle-orm/pg-core/query-builders/update" {
  interface PgUpdateBase<
    TTable extends import("drizzle-orm/pg-core/table").PgTable,
    TQueryResult extends PgQueryResultHKT,
    TFrom extends import("drizzle-orm/pg-core/table").PgTable | import("drizzle-orm/subquery").Subquery | import("drizzle-orm/pg-core/view-base").PgViewBase | import("drizzle-orm/sql/sql").SQL | undefined,
    TSelectedFields extends import("drizzle-orm/sql/sql").ColumnsSelection | undefined,
    TReturning extends Record<string, unknown> | undefined,
    TNullabilityMap extends Record<string, import("drizzle-orm/query-builders/select.types").JoinNullability>,
    TJoins extends any[],
    TDynamic extends boolean,
    TExcludedMethods extends string,
  > {
    all(): Promise<TReturning extends undefined ? PgQueryResultKind<TQueryResult, never> : TReturning[]>;
    get(): Promise<TReturning extends undefined ? PgQueryResultKind<TQueryResult, never> | undefined : TReturning | undefined>;
    run(): Promise<PgQueryResultKind<TQueryResult, never> & { rowsAffected: number }>;
  }
}

declare module "drizzle-orm/pg-core/query-builders/delete" {
  interface PgDeleteBase<
    TTable extends import("drizzle-orm/pg-core/table").PgTable,
    TQueryResult extends PgQueryResultHKT,
    TSelectedFields extends import("drizzle-orm/sql/sql").ColumnsSelection | undefined,
    TReturning extends Record<string, unknown> | undefined,
    TDynamic extends boolean,
    TExcludedMethods extends string,
  > {
    all(): Promise<TReturning extends undefined ? PgQueryResultKind<TQueryResult, never> : TReturning[]>;
    get(): Promise<TReturning extends undefined ? PgQueryResultKind<TQueryResult, never> | undefined : TReturning | undefined>;
    run(): Promise<PgQueryResultKind<TQueryResult, never> & { rowsAffected: number }>;
  }
}

