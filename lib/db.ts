import "server-only";

/**
 * Banco de dados do CRM (Postgres).
 *  - Produção: Neon pela Vercel (variável DATABASE_URL, criada pela integração).
 *  - Testes locais: DATABASE_URL=pglite:memory (Postgres em memória).
 * As tabelas são criadas automaticamente na primeira consulta.
 */

type Row = Record<string, unknown>;
type QueryFn = (text: string, params: unknown[]) => Promise<Row[]>;

let runner: Promise<QueryFn> | null = null;
let ready: Promise<void> | null = null;

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS professionals (
     id serial PRIMARY KEY,
     name text NOT NULL,
     specialty text NOT NULL DEFAULT '',
     color text NOT NULL DEFAULT '#0f766e',
     active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS patients (
     id serial PRIMARY KEY,
     name text NOT NULL,
     phone text NOT NULL DEFAULT '',
     email text NOT NULL DEFAULT '',
     birth_date date,
     cpf text NOT NULL DEFAULT '',
     notes text NOT NULL DEFAULT '',
     stage text NOT NULL DEFAULT 'novo',
     source text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS patients_phone_idx ON patients (phone)`,
  `CREATE TABLE IF NOT EXISTS appointments (
     id serial PRIMARY KEY,
     patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     professional_id integer REFERENCES professionals(id) ON DELETE SET NULL,
     starts_at timestamptz NOT NULL,
     duration_min integer NOT NULL DEFAULT 30,
     procedure text NOT NULL DEFAULT '',
     status text NOT NULL DEFAULT 'agendado',
     notes text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS appointments_starts_idx ON appointments (starts_at)`,
  `CREATE TABLE IF NOT EXISTS simulations (
     id serial PRIMARY KEY,
     patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     kind text NOT NULL,
     shade text NOT NULL DEFAULT '',
     before_img text NOT NULL,
     after_img text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS quotes (
     id serial PRIMARY KEY,
     patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     status text NOT NULL DEFAULT 'rascunho',
     notes text NOT NULL DEFAULT '',
     payment text NOT NULL DEFAULT '',
     simulation_id integer REFERENCES simulations(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS quote_items (
     id serial PRIMARY KEY,
     quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
     description text NOT NULL,
     tooth text NOT NULL DEFAULT '',
     qty integer NOT NULL DEFAULT 1,
     price_cents integer NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS events (
     id serial PRIMARY KEY,
     patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     kind text NOT NULL DEFAULT 'nota',
     text text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now())`,
];

export function dbConfigured() {
  return !!process.env.DATABASE_URL;
}

async function makeRunner(): Promise<QueryFn> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Banco não configurado (DATABASE_URL).");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    return async (text, params) => (await db.query<Row>(text, params)).rows;
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return async (text, params) => (await sql.query(text, params)) as Row[];
}

async function migrate(run: QueryFn) {
  try {
    const r = await run(`SELECT value FROM app_meta WHERE key = 'schema_version'`, []);
    if (Number(r[0]?.value) >= SCHEMA_VERSION) return;
  } catch {
    // tabela ainda não existe
  }
  for (const stmt of MIGRATIONS) await run(stmt, []);
  await run(
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(SCHEMA_VERSION)],
  );
}

/** Executa uma consulta com parâmetros ($1, $2…). */
export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  runner ??= makeRunner();
  const run = await runner.catch((e) => {
    runner = null;
    throw e;
  });
  ready ??= migrate(run).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return (await run(text, params)) as T[];
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}
