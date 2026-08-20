import { z } from 'zod';

export interface DiagnosticsStore {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const clientCrashReportSchema=z.object({
  name:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  code:z.literal('RENDER_FAILURE'),
  route:z.string().regex(/^\/[A-Za-z0-9/_-]{0,199}$/),
  fingerprint:z.string().regex(/^[a-f0-9]{24}$/),
  release:z.string().regex(/^\d+\.\d+\.\d+$/).max(20),
}).strict();

export const clientCrashReportQuerySchema=z.object({
  limit:z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type ClientCrashReport=z.infer<typeof clientCrashReportSchema>;

export type ClientCrashAggregate={
  name:string;
  code:'RENDER_FAILURE';
  route:string;
  fingerprint:string;
  release:string;
  occurrences:number;
  firstSeen:string;
  lastSeen:string;
};

const aggregate=(row:Record<string,unknown>):ClientCrashAggregate=>({
  name:String(row.name??row.error_name??''),
  code:'RENDER_FAILURE',
  route:String(row.route??''),
  fingerprint:String(row.fingerprint??''),
  release:String(row.release??''),
  occurrences:Number(row.occurrences??0),
  firstSeen:new Date(String(row.firstSeen??row.first_seen)).toISOString(),
  lastSeen:new Date(String(row.lastSeen??row.last_seen)).toISOString(),
});

export async function ensureClientDiagnosticsSchema(db:DiagnosticsStore):Promise<void>{
  await db.query(`CREATE TABLE IF NOT EXISTS client_crash_reports (
    fingerprint varchar(24) NOT NULL,
    release varchar(20) NOT NULL,
    route varchar(200) NOT NULL,
    error_name varchar(100) NOT NULL,
    code varchar(32) NOT NULL CHECK(code='RENDER_FAILURE'),
    occurrences bigint NOT NULL DEFAULT 1 CHECK(occurrences>0),
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(fingerprint,release,route)
  );
  CREATE INDEX IF NOT EXISTS idx_client_crash_reports_last_seen ON client_crash_reports(last_seen DESC)`);
}

export async function recordClientCrashReport(db:DiagnosticsStore,input:unknown):Promise<ClientCrashAggregate>{
  const value=clientCrashReportSchema.parse(input);
  const result=await db.query(`INSERT INTO client_crash_reports(fingerprint,release,route,error_name,code)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(fingerprint,release,route) DO UPDATE SET
      error_name=excluded.error_name,
      code=excluded.code,
      occurrences=client_crash_reports.occurrences+1,
      last_seen=now()
    RETURNING fingerprint,release,route,error_name AS name,code,occurrences,first_seen AS "firstSeen",last_seen AS "lastSeen"`,
  [value.fingerprint,value.release,value.route,value.name,value.code]);
  return aggregate(result.rows[0]!);
}

export async function listClientCrashReports(db:DiagnosticsStore,input:unknown):Promise<ClientCrashAggregate[]>{
  const query=clientCrashReportQuerySchema.parse(input);
  const result=await db.query(`SELECT fingerprint,release,route,error_name AS name,code,occurrences,first_seen AS "firstSeen",last_seen AS "lastSeen"
    FROM client_crash_reports ORDER BY last_seen DESC LIMIT $1`,[query.limit]);
  return result.rows.map(aggregate);
}

export async function pruneClientCrashReports(db:DiagnosticsStore):Promise<void>{
  await db.query("DELETE FROM client_crash_reports WHERE last_seen < now()-interval '90 days'");
}
