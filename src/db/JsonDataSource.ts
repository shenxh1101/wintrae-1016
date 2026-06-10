import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

export interface FindOptionsWhere {
  [key: string]: any;
}

export interface FindOptionsOrder {
  [key: string]: "ASC" | "DESC" | "asc" | "desc";
}

export interface FindOptionsRelations {
  [key: string]: boolean;
}

export interface FindManyOptions<T = any> {
  where?: FindOptionsWhere | FindOptionsWhere[];
  order?: FindOptionsOrder;
  skip?: number;
  take?: number;
  relations?: string[] | FindOptionsRelations;
}

export interface FindOneOptions<T = any> {
  where?: FindOptionsWhere | FindOptionsWhere[];
  relations?: string[] | FindOptionsRelations;
  order?: FindOptionsOrder;
}

export interface CountOptions<T = any> {
  where?: FindOptionsWhere;
}

export type EntityClass<T = any> = new (...args: any[]) => T;

class JsonRepository<T extends { id: string }> {
  private entityName: string;
  private entityClass: EntityClass<T>;
  private dbFile: string;

  constructor(entityName: string, entityClass: EntityClass<T>, dbFile: string) {
    this.entityName = entityName;
    this.entityClass = entityClass;
    this.dbFile = dbFile;
  }

  private readAll(): any[] {
    if (!fs.existsSync(this.dbFile)) return [];
    try {
      const content = fs.readFileSync(this.dbFile, "utf-8");
      const json = JSON.parse(content || "{}");
      return json[this.entityName] || [];
    } catch (e) {
      return [];
    }
  }

  private writeAll(data: any[]) {
    const dir = path.dirname(this.dbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let root: any = {};
    if (fs.existsSync(this.dbFile)) {
      try {
        root = JSON.parse(fs.readFileSync(this.dbFile, "utf-8") || "{}");
      } catch (e) {}
    }
    root[this.entityName] = data;
    fs.writeFileSync(this.dbFile, JSON.stringify(root, null, 2), "utf-8");
  }

  private matchWhere(row: any, where: FindOptionsWhere | FindOptionsWhere[] | undefined): boolean {
    if (!where) return true;
    const conds = Array.isArray(where) ? where : [where];
    return conds.some((w) => {
      return Object.keys(w).every((k) => {
        if (w[k] === undefined || w[k] === null) {
          return row[k] === undefined || row[k] === null;
        }
        return String(row[k]) === String(w[k]);
      });
    });
  }

  private applyWhere(qbRows: any[], where: FindOptionsWhere | FindOptionsWhere[] | undefined): any[] {
    if (!where) return qbRows;
    const conds = Array.isArray(where) ? where : [where];
    return qbRows.filter((row) =>
      conds.some((w) => {
        return Object.keys(w).every((k) => {
          const v = w[k];
          if (v === undefined || v === null) return row[k] === undefined || row[k] === null;
          return String(row[k]) === String(v);
        });
      })
    );
  }

  private applyOrder(rows: any[], order?: FindOptionsOrder): any[] {
    if (!order) return rows;
    const keys = Object.keys(order);
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const dir = order[k].toUpperCase() === "ASC" ? 1 : -1;
        const av = a[k];
        const bv = b[k];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? dir : -dir;
      }
      return 0;
    });
  }

  private resolveRelations(row: any, relations?: string[] | FindOptionsRelations, depth = 0): any {
    if (!relations || depth > 2) return row;
    const relKeys = Array.isArray(relations) ? relations : Object.keys(relations).filter((k) => relations[k]);
    const result = { ...row };
    for (const rel of relKeys) {
      const idField = `${rel}Id`;
      if (result[idField] !== undefined && result[idField] !== null) {
        const relRepo = (global as any).__jsonRepos?.[rel] || (global as any).__jsonRepos?.[toPascalCase(rel)];
        if (relRepo) {
          try {
            result[rel] = relRepo.findOneById(result[idField]) || null;
          } catch (e) {
            result[rel] = null;
          }
        }
      } else {
        result[rel] = null;
      }
    }
    return result;
  }

  findOneById(id: string, options?: FindOneOptions): T | null {
    const rows = this.readAll();
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    return this.resolveRelations(row, options?.relations) as T;
  }

  async findOne(options: FindOneOptions): Promise<T | null> {
    let rows = this.readAll();
    rows = this.applyWhere(rows, options.where);
    rows = this.applyOrder(rows, options.order);
    if (rows.length === 0) return null;
    return this.resolveRelations(rows[0], options.relations) as T;
  }

  async find(options?: FindManyOptions): Promise<T[]> {
    let rows = this.readAll();
    if (options?.where) rows = this.applyWhere(rows, options.where);
    if (options?.order) rows = this.applyOrder(rows, options.order);
    if (options?.skip !== undefined) rows = rows.slice(options.skip);
    if (options?.take !== undefined) rows = rows.slice(0, options.take);
    return rows.map((r) => this.resolveRelations(r, options?.relations) as T);
  }

  async findAndCount(options?: FindManyOptions): Promise<[T[], number]> {
    let rows = this.readAll();
    if (options?.where) rows = this.applyWhere(rows, options.where);
    const count = rows.length;
    if (options?.order) rows = this.applyOrder(rows, options.order);
    if (options?.skip !== undefined) rows = rows.slice(options.skip);
    if (options?.take !== undefined) rows = rows.slice(0, options.take);
    return [rows.map((r) => this.resolveRelations(r, options?.relations) as T), count];
  }

  async count(options?: CountOptions): Promise<number> {
    let rows = this.readAll();
    if (options?.where) rows = this.applyWhere(rows, options.where);
    return rows.length;
  }

  create(data?: Partial<T>): T {
    const entity = new this.entityClass();
    if (data) Object.assign(entity, data);
    return entity as T;
  }

  merge(target: T, data: Partial<T>) {
    Object.assign(target, data);
  }

  async save(entity: T | T[]): Promise<any> {
    const list = Array.isArray(entity) ? entity : [entity];
    const all = this.readAll();

    for (const item of list as any[]) {
      if (!item.id) item.id = uuidv4();

      const now = new Date().toISOString();
      if (!item.createdAt) item.createdAt = now;
      item.updatedAt = now;

      const idx = all.findIndex((r) => r.id === item.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...item };
      } else {
        all.push(item);
      }
    }

    this.writeAll(all);
    return Array.isArray(entity) ? entity : entity;
  }

  async delete(criteria: string | string[] | FindOptionsWhere): Promise<void> {
    let all = this.readAll();
    if (typeof criteria === "string") {
      all = all.filter((r) => r.id !== criteria);
    } else if (Array.isArray(criteria)) {
      all = all.filter((r) => !criteria.includes(r.id));
    } else {
      all = all.filter((r) => !this.matchWhere(r, criteria));
    }
    this.writeAll(all);
  }

  async remove(entity: T | T[]): Promise<void> {
    const list = Array.isArray(entity) ? entity : [entity];
    const ids = list.map((e: any) => e.id).filter(Boolean);
    if (ids.length > 0) {
      await this.delete(ids);
    }
  }

  createQueryBuilder(alias: string): JsonQueryBuilder<T> {
    return new JsonQueryBuilder<T>(this, alias);
  }
}

class JsonQueryBuilder<T extends { id: string }> {
  private repo: JsonRepository<T>;
  private alias: string;
  private whereClauses: { sql: string; params: Record<string, any> }[] = [];
  private orderByClauses: { field: string; dir: "ASC" | "DESC" }[] = [];
  private joins: { alias: string; field: string; type: "left" }[] = [];
  private selectFields: string[] = [];
  private groupByFields: string[] = [];
  private skipN?: number;
  private takeN?: number;

  constructor(repo: JsonRepository<T>, alias: string) {
    this.repo = repo;
    this.alias = alias;
  }

  private stripAlias(expr: string): string {
    const parts = expr.split(".");
    return parts.length > 1 ? parts.slice(1).join(".") : parts[0];
  }

  select(fields: string | string[], alias?: string): this {
    const list = typeof fields === "string" ? [fields] : fields;
    for (const f of list) {
      if (f.includes(" AS ") || f.includes(" as ")) {
        const [expr, al] = f.split(/\s+AS\s+/i);
        this.selectFields.push(`${this.stripAlias(expr.trim())} AS ${al.trim()}`);
      } else if (alias) {
        this.selectFields.push(`${this.stripAlias(f)} AS ${alias}`);
      } else {
        this.selectFields.push(this.stripAlias(f));
      }
    }
    return this;
  }

  addSelect(fields: string | string[], alias?: string): this {
    return this.select(fields, alias);
  }

  leftJoinAndSelect(relation: string, alias: string): this {
    this.joins.push({ alias, field: this.stripAlias(relation), type: "left" });
    return this;
  }

  where(sql: string, params?: Record<string, any>): this {
    this.whereClauses = [];
    if (sql) this.andWhere(sql, params);
    return this;
  }

  andWhere(sql: string, params?: Record<string, any>): this {
    this.whereClauses.push({ sql, params: params || {} });
    return this;
  }

  orderBy(field: string, dir: "ASC" | "DESC" = "ASC"): this {
    this.orderByClauses = [{ field: this.stripAlias(field), dir }];
    return this;
  }

  addOrderBy(field: string, dir: "ASC" | "DESC" = "ASC"): this {
    this.orderByClauses.push({ field: this.stripAlias(field), dir });
    return this;
  }

  groupBy(field: string | string[]): this {
    const list = typeof field === "string" ? [field] : field;
    this.groupByFields = list.map((f) => this.stripAlias(f));
    return this;
  }

  skip(n: number): this {
    this.skipN = n;
    return this;
  }

  take(n: number): this {
    this.takeN = n;
    return this;
  }

  private compareValues(a: any, b: any): number {
    if (a === null || a === undefined || b === null || b === undefined) {
      if (a === b) return 0;
      if (a === null || a === undefined) return -1;
      return 1;
    }
    const aIsDate = a instanceof Date || !isNaN(Date.parse(a));
    const bIsDate = b instanceof Date || !isNaN(Date.parse(b));
    if (aIsDate && bIsDate) {
      return new Date(a).getTime() - new Date(b).getTime();
    }
    const aNum = Number(a);
    const bNum = Number(b);
    if (!isNaN(aNum) && !isNaN(bNum) && a !== "" && b !== "") {
      return aNum - bNum;
    }
    return String(a).localeCompare(String(b));
  }

  private evalCondition(row: any, sql: string, params: Record<string, any>): boolean {
    try {
      sql = sql.trim();
      const simpleEq = sql.match(/^(\w+(?:\.\w+)?)\s*=\s*:(\w+)$/);
      if (simpleEq) {
        const field = this.stripAlias(simpleEq[1]);
        const val = params[simpleEq[2]];
        if (val === null || val === undefined) return row[field] === null || row[field] === undefined;
        return String(row[field]) === String(val);
      }

      const inMatch = sql.match(/^(\w+(?:\.\w+)?)\s+IN\s+\(:\.\.\.(\w+)\)$/i);
      if (inMatch) {
        const field = this.stripAlias(inMatch[1]);
        const values: any[] = params[inMatch[2]];
        return values.map(String).includes(String(row[field]));
      }

      const likeMatch = sql.match(/^(\w+(?:\.\w+)?)\s+LIKE\s+:(\w+)$/i);
      if (likeMatch) {
        const field = this.stripAlias(likeMatch[1]);
        const pattern = (params[likeMatch[2]] as string) || "";
        const regex = new RegExp("^" + pattern.replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
        return regex.test(String(row[field] ?? ""));
      }

      const gtMatch = sql.match(/^(\w+(?:\.\w+)?)\s*>\s*:(\w+)$/);
      if (gtMatch) {
        const field = this.stripAlias(gtMatch[1]);
        const val = params[gtMatch[2]];
        return this.compareValues(row[field], val) > 0;
      }

      const ltMatch = sql.match(/^(\w+(?:\.\w+)?)\s*<\s*:(\w+)$/);
      if (ltMatch) {
        const field = this.stripAlias(ltMatch[1]);
        const val = params[ltMatch[2]];
        return this.compareValues(row[field], val) < 0;
      }

      const gteMatch = sql.match(/^(\w+(?:\.\w+)?)\s*>=\s*:(\w+)$/);
      if (gteMatch) {
        const field = this.stripAlias(gteMatch[1]);
        const val = params[gteMatch[2]];
        return this.compareValues(row[field], val) >= 0;
      }

      const lteMatch = sql.match(/^(\w+(?:\.\w+)?)\s*<=\s*:(\w+)$/);
      if (lteMatch) {
        const field = this.stripAlias(lteMatch[1]);
        const val = params[lteMatch[2]];
        return this.compareValues(row[field], val) <= 0;
      }

      const neqMatch = sql.match(/^(\w+(?:\.\w+)?)\s*!=\s*:(\w+)$/);
      if (neqMatch) {
        const field = this.stripAlias(neqMatch[1]);
        const val = params[neqMatch[2]];
        return String(row[field]) !== String(val);
      }

      const isNullMatch = sql.match(/^(\w+(?:\.\w+)?)\s+IS\s+NULL$/i);
      if (isNullMatch) {
        const field = this.stripAlias(isNullMatch[1]);
        return row[field] === null || row[field] === undefined;
      }

      const isNotNullMatch = sql.match(/^(\w+(?:\.\w+)?)\s+IS\s+NOT\s+NULL$/i);
      if (isNotNullMatch) {
        const field = this.stripAlias(isNotNullMatch[1]);
        return row[field] !== null && row[field] !== undefined;
      }

      const parenOrMatch = sql.match(/^\((\w+(?:\.\w+)?)\s*=\s*:(\w+)\s+OR\s+(\w+(?:\.\w+)?)\s*=\s*:(\w+)\)$/i);
      if (parenOrMatch) {
        const f1 = this.stripAlias(parenOrMatch[1]);
        const v1 = params[parenOrMatch[2]];
        const f2 = this.stripAlias(parenOrMatch[3]);
        const v2 = params[parenOrMatch[4]];
        return String(row[f1]) === String(v1) || String(row[f2]) === String(v2);
      }

      if (sql === "1=1") return true;

      const betweenMatch = sql.match(/^(\w+(?:\.\w+)?)\s+BETWEEN\s+:(\w+)\s+AND\s+:(\w+)$/i);
      if (betweenMatch) {
        const field = this.stripAlias(betweenMatch[1]);
        const v1 = params[betweenMatch[2]];
        const v2 = params[betweenMatch[3]];
        return this.compareValues(row[field], v1) >= 0 && this.compareValues(row[field], v2) <= 0;
      }

      console.warn("[JsonQueryBuilder] Unhandled where condition:", sql);
      return true;
    } catch (e) {
      console.warn("[JsonQueryBuilder] Condition eval error:", sql, e);
      return true;
    }
  }

  private applyConditions(rows: any[]): any[] {
    return rows.filter((row) => {
      for (const wc of this.whereClauses) {
        if (!this.evalCondition(row, wc.sql, wc.params)) return false;
      }
      return true;
    });
  }

  private applySort(rows: any[]): any[] {
    if (this.orderByClauses.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.orderByClauses) {
        const dir = o.dir === "ASC" ? 1 : -1;
        const av = a[o.field];
        const bv = b[o.field];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? dir : -dir;
      }
      return 0;
    });
  }

  private resolveJoins(rows: any[]): any[] {
    return rows.map((row) => {
      const result = { ...row };
      for (const j of this.joins) {
        const idField = `${j.field}Id`;
        if (result[idField] != null) {
          const relRepo = (global as any).__jsonRepos?.[toPascalCase(j.field)];
          if (relRepo) {
            try {
              result[j.alias] = relRepo.findOneById(result[idField]) || null;
            } catch (e) {
              result[j.alias] = null;
            }
          }
        } else {
          result[j.alias] = null;
        }
      }
      return result;
    });
  }

  private doAggregation(rows: any[]): any[] {
    if (this.selectFields.length === 0 && this.groupByFields.length === 0) return rows;
    if (this.groupByFields.length === 0) return rows;

    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const key = this.groupByFields.map((f) => String(row[f])).join("||");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: any[] = [];
    for (const [, groupRows] of groups) {
      const item: any = {};
      for (const sel of this.selectFields) {
        const parts = sel.split(/\s+AS\s+/i);
        const expr = parts[0].trim();
        const alias = parts[1]?.trim() || expr;

        const countMatch = expr.match(/^COUNT\s*\(\s*(.+?)\s*\)$/i);
        if (countMatch) {
          if (countMatch[1] === "*") item[alias] = groupRows.length;
          else {
            const f = this.stripAlias(countMatch[1]);
            item[alias] = groupRows.filter((r) => r[f] != null).length;
          }
          continue;
        }

        const sumMatch = expr.match(/^SUM\s*\(\s*(.+?)\s*\)$/i);
        if (sumMatch) {
          const f = this.stripAlias(sumMatch[1]);
          item[alias] = groupRows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
          continue;
        }

        const caseMatch = expr.match(/^SUM\s*\(\s*CASE\s+WHEN\s+(.+?)\s+THEN\s+(\d+)\s+ELSE\s+(\d+)\s+END\s*\)$/i);
        if (caseMatch) {
          let total = 0;
          for (const row of groupRows) {
            total += this.evalCondition(row, caseMatch[1], {})
              ? Number(caseMatch[2])
              : Number(caseMatch[3]);
          }
          item[alias] = total;
          continue;
        }

        const distinctCountMatch = expr.match(/^COUNT\s*\(\s*DISTINCT\s+(.+?)\s*\)$/i);
        if (distinctCountMatch) {
          const f = this.stripAlias(distinctCountMatch[1]);
          const set = new Set(groupRows.map((r) => r[f]).filter((v) => v != null));
          item[alias] = set.size;
          continue;
        }

        const f = this.stripAlias(expr);
        item[alias] = groupRows[0]?.[f];
      }
      result.push(item);
    }
    return result;
  }

  async getMany(): Promise<T[]> {
    let rows = (this.repo as any).readAll();
    rows = this.applyConditions(rows);
    rows = this.resolveJoins(rows);
    rows = this.applySort(rows);
    rows = this.doAggregation(rows);
    if (this.skipN !== undefined) rows = rows.slice(this.skipN);
    if (this.takeN !== undefined) rows = rows.slice(0, this.takeN);
    return rows as T[];
  }

  async getManyAndCount(): Promise<[T[], number]> {
    let rows = (this.repo as any).readAll();
    rows = this.applyConditions(rows);
    const count = rows.length;
    rows = this.resolveJoins(rows);
    rows = this.applySort(rows);
    rows = this.doAggregation(rows);
    if (this.skipN !== undefined) rows = rows.slice(this.skipN);
    if (this.takeN !== undefined) rows = rows.slice(0, this.takeN);
    return [rows as T[], count];
  }

  async getRawMany(): Promise<any[]> {
    return this.getMany();
  }

  async getOne(): Promise<T | null> {
    const many = await this.getMany();
    return many[0] || null;
  }

  async getCount(): Promise<number> {
    let rows = (this.repo as any).readAll();
    rows = this.applyConditions(rows);
    return rows.length;
  }

  async execute(): Promise<any> {
    return this.getMany();
  }

  update(entity: any, values: Record<string, any>): this {
    return this;
  }

  set(values: Record<string, any>): this {
    return this;
  }
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

class DataSource {
  private options: any;
  private repos: Map<string, JsonRepository<any>> = new Map();
  public isInitialized = false;

  constructor(options: any) {
    this.options = options;
  }

  async initialize(): Promise<this> {
    const dbDir = path.dirname(this.options.database);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    const entities: any[] = this.options.entities || [];
    const globalRepos: any = (global as any).__jsonRepos || {};

    for (const pattern of entities) {
      if (typeof pattern === "function") {
        const name = pattern.name;
        const repo = new JsonRepository<any>(name, pattern, this.options.database);
        this.repos.set(name, repo);
        this.repos.set(name.toLowerCase(), repo);
        globalRepos[name] = repo;
      } else if (typeof pattern === "string") {
        const entityFiles = resolveGlob(pattern);
        for (const file of entityFiles) {
          try {
            const mod = require(file);
            for (const key of Object.keys(mod)) {
              const exp = mod[key];
              if (typeof exp === "function" && /^[A-Z]/.test(key)) {
                const repo = new JsonRepository<any>(key, exp, this.options.database);
                this.repos.set(key, repo);
                this.repos.set(key.toLowerCase(), repo);
                globalRepos[key] = repo;
              }
            }
          } catch (e) {}
        }
      }
    }

    (global as any).__jsonRepos = globalRepos;
    this.isInitialized = true;
    return this;
  }

  getRepository<T = any>(target: any): JsonRepository<any> {
    const key = typeof target === "function" ? target.name : String(target);
    let repo = this.repos.get(key);
    if (!repo) {
      for (const [k, v] of this.repos) {
        if (k.toLowerCase() === key.toLowerCase()) {
          repo = v;
          break;
        }
      }
    }
    if (!repo) {
      const DynamicClass = class {
        id!: string;
        createdAt!: Date;
        updatedAt!: Date;
      };
      repo = new JsonRepository<any>(key, DynamicClass as any, this.options.database);
      this.repos.set(key, repo);
    }
    return repo;
  }

  async destroy(): Promise<void> {
    this.isInitialized = false;
  }
}

function resolveGlob(pattern: string): string[] {
  const dir = path.dirname(pattern);
  const filePattern = path.basename(pattern);
  const regex = new RegExp("^" + filePattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  const results: string[] = [];

  const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);

  if (!fs.existsSync(absoluteDir)) return results;
  try {
    const files = fs.readdirSync(absoluteDir);
    for (const file of files) {
      if (regex.test(file)) {
        results.push(path.join(absoluteDir, file));
      }
    }
  } catch (e) {}
  return results;
}

export { DataSource };
export type { JsonRepository };
