import "server-only";
import { one, q } from "./db";

// ---------- Constantes ----------

export const STAGES = [
  { id: "novo", label: "Novo contato" },
  { id: "avaliacao", label: "Avaliação agendada" },
  { id: "simulacao", label: "Simulação feita" },
  { id: "orcamento", label: "Orçamento enviado" },
  { id: "tratamento", label: "Em tratamento" },
  { id: "finalizado", label: "Finalizado" },
  { id: "perdido", label: "Perdido" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;
const STAGE_ORDER: string[] = ["novo", "avaliacao", "simulacao", "orcamento", "tratamento", "finalizado"];

export const APPT_STATUS = [
  { id: "agendado", label: "Agendado" },
  { id: "confirmado", label: "Confirmado" },
  { id: "atendido", label: "Atendido" },
  { id: "faltou", label: "Faltou" },
  { id: "cancelado", label: "Cancelado" },
] as const;
export const apptLabel = (id: string) => APPT_STATUS.find((s) => s.id === id)?.label ?? id;

export const QUOTE_STATUS = [
  { id: "rascunho", label: "Rascunho" },
  { id: "enviado", label: "Enviado" },
  { id: "aprovado", label: "Aprovado" },
  { id: "recusado", label: "Recusado" },
] as const;
export const quoteLabel = (id: string) => QUOTE_STATUS.find((s) => s.id === id)?.label ?? id;

// ---------- Datas (horário de Brasília, sem horário de verão desde 2019) ----------

export const TZ = "America/Sao_Paulo";
const OFFSET = "-03:00";

export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}
export function dayRange(iso: string): [string, string] {
  return [`${iso}T00:00:00${OFFSET}`, `${addDaysISO(iso, 1)}T00:00:00${OFFSET}`];
}
/** "2026-11-16T14:30" (campo datetime-local) → instante em Brasília. */
export function localToInstant(v: string): string {
  return `${v.length === 16 ? v + ":00" : v}${OFFSET}`;
}
export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ });
export const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
export const fmtDayLong = (iso: string) =>
  new Date(`${iso}T12:00:00${OFFSET}`).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
export const minutesOfDay = (d: Date | string) => {
  const [h, m] = fmtTime(d).split(":").map(Number);
  return h * 60 + m;
};

export const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function parseMoney(v: string): number {
  const s = v.replace(/[^\d,.-]/g, "");
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const onlyDigits = (v: string) => v.replace(/\D/g, "");

// ---------- Tipos ----------

export type Patient = {
  id: number;
  name: string;
  phone: string;
  email: string;
  birth_date: string | null;
  cpf: string;
  notes: string;
  stage: string;
  source: string;
  created_at: string;
  updated_at: string;
};
export type Professional = { id: number; name: string; specialty: string; color: string; active: boolean };
export type Appointment = {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_phone: string;
  professional_id: number | null;
  professional_name: string | null;
  professional_color: string | null;
  starts_at: string;
  duration_min: number;
  procedure: string;
  status: string;
  notes: string;
};
export type QuoteItem = { id: number; quote_id: number; description: string; tooth: string; qty: number; price_cents: number };
export type Quote = {
  id: number;
  patient_id: number;
  status: string;
  notes: string;
  payment: string;
  simulation_id: number | null;
  created_at: string;
  updated_at: string;
  total_cents: number;
};
export type Simulation = {
  id: number;
  patient_id: number;
  kind: string;
  shade: string;
  before_img: string;
  after_img: string;
  created_at: string;
};
export type CrmEvent = { id: number; patient_id: number; kind: string; text: string; created_at: string };

// ---------- Pacientes ----------

export async function listPatients(search = "", stage = ""): Promise<Patient[]> {
  const s = search.trim();
  const digits = onlyDigits(s);
  return q<Patient>(
    `SELECT * FROM patients
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR ($2 <> '' AND phone LIKE '%' || $2 || '%') OR email ILIKE '%' || $1 || '%')
       AND ($3 = '' OR stage = $3)
     ORDER BY updated_at DESC LIMIT 300`,
    [s, digits, stage],
  );
}

export const getPatient = (id: number) => one<Patient>(`SELECT * FROM patients WHERE id = $1`, [id]);

export type PatientInput = {
  name: string;
  phone?: string;
  email?: string;
  birth_date?: string | null;
  cpf?: string;
  notes?: string;
  source?: string;
  stage?: string;
};

export async function createPatient(p: PatientInput): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO patients (name, phone, email, birth_date, cpf, notes, source, stage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [p.name.trim(), onlyDigits(p.phone ?? ""), (p.email ?? "").trim(), p.birth_date || null, p.cpf ?? "", p.notes ?? "", p.source ?? "", p.stage || "novo"],
  );
  await addEvent(r!.id, "sistema", `Paciente cadastrado${p.source ? ` (origem: ${p.source})` : ""}.`);
  return r!.id;
}

export async function updatePatient(id: number, p: PatientInput) {
  await q(
    `UPDATE patients SET name=$2, phone=$3, email=$4, birth_date=$5, cpf=$6, notes=$7, source=$8, updated_at=now() WHERE id=$1`,
    [id, p.name.trim(), onlyDigits(p.phone ?? ""), (p.email ?? "").trim(), p.birth_date || null, p.cpf ?? "", p.notes ?? "", p.source ?? ""],
  );
}

export async function setStage(id: number, stage: string, why = "") {
  const cur = await getPatient(id);
  if (!cur || cur.stage === stage) return;
  await q(`UPDATE patients SET stage=$2, updated_at=now() WHERE id=$1`, [id, stage]);
  await addEvent(id, "funil", `Etapa: ${stageLabel(cur.stage)} → ${stageLabel(stage)}${why ? ` (${why})` : ""}.`);
}

/** Avança no funil só para frente (não mexe em finalizado/perdido). */
export async function advanceStage(id: number, to: StageId, why: string) {
  const cur = await getPatient(id);
  if (!cur) return;
  const a = STAGE_ORDER.indexOf(cur.stage);
  const b = STAGE_ORDER.indexOf(to);
  if (a === -1 || b === -1 || b <= a || cur.stage === "finalizado") return;
  await setStage(id, to, why);
}

/** Usado pelo atendimento no WhatsApp: acha o paciente pelo telefone ou cria como "Novo contato". */
export async function upsertPatientByPhone(phone: string, name: string, source = "WhatsApp"): Promise<number> {
  const d = onlyDigits(phone);
  const tail = d.slice(-10); // compara pelos últimos dígitos (com ou sem 55 / nono dígito)
  const found = await one<{ id: number }>(
    `SELECT id FROM patients WHERE phone <> '' AND right(phone, 10) = $1 ORDER BY id LIMIT 1`,
    [tail],
  );
  if (found) return found.id;
  return createPatient({ name: name || `Contato ${d.slice(-4)}`, phone: d, source });
}

export async function deletePatient(id: number) {
  await q(`DELETE FROM patients WHERE id=$1`, [id]);
}

// ---------- Eventos (histórico) ----------

export async function addEvent(patientId: number, kind: string, text: string) {
  await q(`INSERT INTO events (patient_id, kind, text) VALUES ($1, $2, $3)`, [patientId, kind, text]);
}
export const listEvents = (patientId: number) =>
  q<CrmEvent>(`SELECT * FROM events WHERE patient_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100`, [patientId]);

// ---------- Profissionais ----------

export const listProfessionals = (onlyActive = false) =>
  q<Professional>(`SELECT * FROM professionals WHERE ($1 = false OR active) ORDER BY active DESC, name`, [onlyActive]);

export async function createProfessional(name: string, specialty: string, color: string) {
  await q(`INSERT INTO professionals (name, specialty, color) VALUES ($1, $2, $3)`, [name.trim(), specialty.trim(), color]);
}
export async function toggleProfessional(id: number) {
  await q(`UPDATE professionals SET active = NOT active WHERE id=$1`, [id]);
}

// ---------- Agenda ----------

const APPT_SELECT = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone,
  pr.name AS professional_name, pr.color AS professional_color
  FROM appointments a JOIN patients p ON p.id = a.patient_id
  LEFT JOIN professionals pr ON pr.id = a.professional_id`;

export function appointmentsForDay(iso: string) {
  const [a, b] = dayRange(iso);
  return q<Appointment>(`${APPT_SELECT} WHERE a.starts_at >= $1 AND a.starts_at < $2 ORDER BY a.starts_at`, [a, b]);
}
export const appointmentsForPatient = (id: number) =>
  q<Appointment>(`${APPT_SELECT} WHERE a.patient_id = $1 ORDER BY a.starts_at DESC`, [id]);

export type AppointmentInput = {
  patient_id: number;
  professional_id: number | null;
  starts_at: string; // instante ISO com fuso
  duration_min: number;
  procedure: string;
  notes?: string;
};

export async function createAppointment(a: AppointmentInput) {
  await q(
    `INSERT INTO appointments (patient_id, professional_id, starts_at, duration_min, procedure, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
    [a.patient_id, a.professional_id, a.starts_at, a.duration_min, a.procedure, a.notes ?? ""],
  );
  await addEvent(a.patient_id, "agenda", `Consulta marcada: ${fmtDateTime(a.starts_at)}${a.procedure ? ` · ${a.procedure}` : ""}.`);
  await advanceStage(a.patient_id, "avaliacao", "consulta marcada");
}

export async function setAppointmentStatus(id: number, status: string) {
  const r = await one<{ patient_id: number; starts_at: string }>(
    `UPDATE appointments SET status=$2 WHERE id=$1 RETURNING patient_id, starts_at`,
    [id, status],
  );
  if (r) await addEvent(r.patient_id, "agenda", `Consulta de ${fmtDateTime(r.starts_at)}: ${apptLabel(status)}.`);
}

export async function deleteAppointment(id: number) {
  const r = await one<{ patient_id: number; starts_at: string }>(
    `DELETE FROM appointments WHERE id=$1 RETURNING patient_id, starts_at`,
    [id],
  );
  if (r) await addEvent(r.patient_id, "agenda", `Consulta de ${fmtDateTime(r.starts_at)} excluída.`);
}

// ---------- Simulações ----------

export async function createSimulation(patientId: number, kind: string, shade: string, before: string, after: string) {
  const r = await one<{ id: number }>(
    `INSERT INTO simulations (patient_id, kind, shade, before_img, after_img) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [patientId, kind, shade, before, after],
  );
  await addEvent(patientId, "simulacao", `Simulação salva: ${kind}${shade ? ` · ${shade}` : ""}.`);
  await advanceStage(patientId, "simulacao", "simulação de sorriso");
  return r!.id;
}
export const listSimulations = (patientId: number) =>
  q<Simulation>(`SELECT * FROM simulations WHERE patient_id=$1 ORDER BY created_at DESC`, [patientId]);
export const getSimulation = (id: number) => one<Simulation>(`SELECT * FROM simulations WHERE id=$1`, [id]);

// ---------- Orçamentos ----------

const QUOTE_SELECT = `SELECT qu.*, COALESCE((SELECT SUM(qty * price_cents) FROM quote_items i WHERE i.quote_id = qu.id), 0)::int AS total_cents FROM quotes qu`;

export const listQuotes = (patientId: number) =>
  q<Quote>(`${QUOTE_SELECT} WHERE qu.patient_id=$1 ORDER BY qu.created_at DESC`, [patientId]);
export const getQuote = (id: number) => one<Quote>(`${QUOTE_SELECT} WHERE qu.id=$1`, [id]);
export const listQuoteItems = (quoteId: number) =>
  q<QuoteItem>(`SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY id`, [quoteId]);

export async function createQuote(patientId: number): Promise<number> {
  const r = await one<{ id: number }>(`INSERT INTO quotes (patient_id) VALUES ($1) RETURNING id`, [patientId]);
  await addEvent(patientId, "orcamento", `Orçamento #${r!.id} criado.`);
  return r!.id;
}
export async function addQuoteItem(quoteId: number, description: string, tooth: string, qty: number, priceCents: number) {
  await q(`INSERT INTO quote_items (quote_id, description, tooth, qty, price_cents) VALUES ($1,$2,$3,$4,$5)`, [
    quoteId,
    description.trim(),
    tooth.trim(),
    Math.max(1, qty),
    Math.max(0, priceCents),
  ]);
  await q(`UPDATE quotes SET updated_at=now() WHERE id=$1`, [quoteId]);
}
export async function removeQuoteItem(itemId: number) {
  await q(`DELETE FROM quote_items WHERE id=$1`, [itemId]);
}
export async function updateQuote(id: number, notes: string, payment: string, simulationId: number | null) {
  await q(`UPDATE quotes SET notes=$2, payment=$3, simulation_id=$4, updated_at=now() WHERE id=$1`, [id, notes, payment, simulationId]);
}
export async function setQuoteStatus(id: number, status: string) {
  const qt = await getQuote(id);
  if (!qt || qt.status === status) return;
  await q(`UPDATE quotes SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
  await addEvent(qt.patient_id, "orcamento", `Orçamento #${id} (${money(qt.total_cents)}): ${quoteLabel(status)}.`);
  if (status === "enviado") await advanceStage(qt.patient_id, "orcamento", `orçamento #${id} enviado`);
  if (status === "aprovado") await advanceStage(qt.patient_id, "tratamento", `orçamento #${id} aprovado`);
}

// ---------- Painel ----------

export async function dashboard() {
  const today = todayISO();
  const [a, b] = dayRange(today);
  const monthStart = `${today.slice(0, 7)}-01T00:00:00${OFFSET}`;
  const [counts] = await q<{
    patients: number;
    today: number;
    confirmed: number;
    open_quotes: number;
    open_value: number;
    sims_month: number;
    approved_month: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM patients)::int AS patients,
       (SELECT COUNT(*) FROM appointments WHERE starts_at >= $1 AND starts_at < $2 AND status <> 'cancelado')::int AS today,
       (SELECT COUNT(*) FROM appointments WHERE starts_at >= $1 AND starts_at < $2 AND status = 'confirmado')::int AS confirmed,
       (SELECT COUNT(*) FROM quotes WHERE status = 'enviado')::int AS open_quotes,
       (SELECT COALESCE(SUM(i.qty * i.price_cents), 0) FROM quotes qu JOIN quote_items i ON i.quote_id = qu.id WHERE qu.status = 'enviado')::bigint AS open_value,
       (SELECT COUNT(*) FROM simulations WHERE created_at >= $3)::int AS sims_month,
       (SELECT COALESCE(SUM(i.qty * i.price_cents), 0) FROM quotes qu JOIN quote_items i ON i.quote_id = qu.id WHERE qu.status = 'aprovado' AND qu.updated_at >= $3)::bigint AS approved_month`,
    [a, b, monthStart],
  );
  const funnel = await q<{ stage: string; n: number }>(`SELECT stage, COUNT(*)::int AS n FROM patients GROUP BY stage`);
  const recentSims = await q<{ id: number; patient_id: number; patient_name: string; kind: string; shade: string; after_img: string; created_at: string }>(
    `SELECT s.id, s.patient_id, p.name AS patient_name, s.kind, s.shade, s.after_img, s.created_at
     FROM simulations s JOIN patients p ON p.id = s.patient_id ORDER BY s.created_at DESC LIMIT 4`,
  );
  return {
    counts: { ...counts, open_value: Number(counts.open_value), approved_month: Number(counts.approved_month) },
    funnel,
    recentSims,
    todayAppts: await appointmentsForDay(today),
  };
}
