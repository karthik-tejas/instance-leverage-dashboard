// In production (Vercel Services), the frontend and backend live on the same
// origin -- vercel.json rewrites /api/* to the backend service -- so a plain
// relative path ("/api/...") is correct and no env var is needed. Locally
// the frontend (e.g. :3000) and backend (e.g. :8000) run on different ports
// on the same host, so we target that host's :8000 instead. NEXT_PUBLIC_API_URL
// can always override this explicitly (e.g. a backend on a different domain).
function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;
    // An explicit, non-standard port is a reliable signal for "local/LAN dev
    // server", regardless of hostname spelling (localhost, 127.0.0.1, a LAN
    // IP, etc.) -- production on Vercel is always plain :80/:443.
    if (port && port !== "80" && port !== "443") {
      const host = hostname.includes(":") ? `[${hostname}]` : hostname; // IPv6
      return `${protocol}//${host}:8000`;
    }
  }
  return ""; // same-origin (production)
}

const API_BASE = resolveApiBase();

export interface Month {
  month_id: number;
  month_label: string;
  source_filename: string;
}

export interface TrendPoint {
  month_id: number;
  month_label: string;
  total_questions: number;
  total_active_users: number;
}

export interface LeaderboardRow {
  instance: string;
  questions_asked: number;
  active_users: number;
}

export interface Overview {
  selected_month_id: number;
  previous_month_id: number | null;
  trend: TrendPoint[];
  leaderboard: LeaderboardRow[];
  previous_leaderboard: LeaderboardRow[];
}

export interface DocRow {
  date_uploaded: string | null;
  doc_url: string | null;
  doc_name: string | null;
  frequency: number | null;
}

export interface QuestionRow {
  question: string | null;
  count: number | null;
}

export interface DislikedRow {
  question: string | null;
  answer: string | null;
  feedback: string | null;
  count: number | null;
  likes: number | null;
  dislikes: number | null;
}

export interface InstanceDetail {
  instance: string;
  found: boolean;
  questions_asked: number;
  active_users: number;
  top_documents: DocRow[];
  top_questions: QuestionRow[];
  feedback_totals: { likes: number; dislikes: number };
  disliked_qa: DislikedRow[];
}

export interface QaRow {
  id: number;
  date: string | null;
  question: string | null;
  answer: string | null;
  source: string | null;
}

export interface QaResp {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  rows: QaRow[];
}

export interface ComparePoint {
  month_id: number;
  month_label: string;
  questions_asked: number;
  active_users: number;
}

export interface CompareSeries {
  instance: string;
  points: ComparePoint[];
}

export interface CompareResp {
  months: { month_id: number; month_label: string }[];
  series: CompareSeries[];
}

export interface ComparisonRow {
  instance: string;
  users_prev: number;
  users_cur: number;
  questions_prev: number;
  questions_cur: number;
  delta_pct: number | null;
  qu_prev: number;
  qu_cur: number;
  status: string;
}

export interface LeverageDoc {
  doc_name: string | null;
  doc_url: string | null;
  frequency: number | null;
}

export interface LeverageQuestion {
  question: string | null;
  count: number | null;
}

export interface KnowledgeLeverageRow {
  instance: string;
  questions_asked: number;
  top_documents: LeverageDoc[];
  top_questions: LeverageQuestion[];
}

export interface FeedbackDislike {
  question: string | null;
  answer: string | null;
  feedback: string | null;
  dislikes: number | null;
  likes: number | null;
}

export interface FeedbackInstanceRow {
  instance: string;
  likes: number;
  dislikes: number;
  responses: number;
  sample_dislikes: FeedbackDislike[];
}

export interface ReportFeedback {
  instances_with_feedback: number;
  total_responses: number;
  likes: number;
  dislikes: number;
  per_instance: FeedbackInstanceRow[];
}

export interface CumulativeRow {
  instance: string;
  months: { month_label: string; questions_asked: number }[];
  total_questions: number;
  trend_status: string;
}

export interface NextStepRow {
  instance: string;
  status: string;
  action: string;
}

export interface KeyInsight {
  heading: string;
  detail: string;
}

export interface ReportOverview {
  total_instances: number;
  active_instances: number;
  total_questions: number;
  previous_total_questions: number;
  total_users: number;
  delta_pct: number | null;
}

export interface Report {
  empty?: boolean;
  month_id: number;
  month_label: string;
  previous_month_id: number | null;
  previous_month_label: string | null;
  overview: ReportOverview;
  comparison: ComparisonRow[];
  knowledge_leverage: KnowledgeLeverageRow[];
  feedback: ReportFeedback;
  cumulative: CumulativeRow[];
  curation_next_steps: NextStepRow[];
  key_insights: KeyInsight[];
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<T>;
}

export type UploadResult = { month_id: number; month_label: string; counts: Record<string, number> };

// Vercel Functions cap request bodies at a hard, non-configurable 4.5MB.
// Files under this stay on the simple path (direct multipart POST); larger
// files go straight to Blob storage from the browser instead. Picked with
// headroom under the real 4.5MB limit to leave room for multipart overhead.
const DIRECT_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

async function uploadDirect(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "upload failed");
    throw new Error(detail);
  }
  return res.json();
}

async function uploadViaBlob(
  file: File,
  onProgress?: (percentage: number) => void
): Promise<UploadResult> {
  // Imported lazily so the (fairly small) @vercel/blob client bundle is only
  // pulled in when an actual large-file upload happens.
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/blob-upload",
    onUploadProgress: ({ percentage }) => onProgress?.(percentage),
  });

  let result: UploadResult;
  try {
    const res = await fetch(`${API_BASE}/api/upload-from-blob`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob_url: blob.url, filename: file.name }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "upload failed");
      throw new Error(detail);
    }
    result = await res.json();
  } finally {
    // Best-effort cleanup; the file's contents are already in the database
    // (or the ingest failed and there's nothing worth keeping either way).
    fetch(`/blob-upload?url=${encodeURIComponent(blob.url)}`, { method: "DELETE" }).catch(() => {});
  }
  return result;
}

export function uploadFile(file: File, onProgress?: (percentage: number) => void): Promise<UploadResult> {
  return file.size > DIRECT_UPLOAD_LIMIT_BYTES ? uploadViaBlob(file, onProgress) : uploadDirect(file);
}

export const getMonths = () => getJSON<Month[]>(`${API_BASE}/api/months`);

export const getOverview = (monthId: number | null) =>
  getJSON<Overview>(`${API_BASE}/api/overview${monthId ? `?month_id=${monthId}` : ""}`);

export const getInstances = (monthId: number | null) =>
  getJSON<{ month_id: number; instances: string[] }>(
    `${API_BASE}/api/instances${monthId ? `?month_id=${monthId}` : ""}`
  );

export const getAllInstances = () =>
  getJSON<{ instances: string[] }>(`${API_BASE}/api/all-instances`);

export const getInstance = (monthId: number, name: string) =>
  getJSON<InstanceDetail>(`${API_BASE}/api/instance?month_id=${monthId}&name=${encodeURIComponent(name)}`);

export const getCompare = (instances: string[]) =>
  getJSON<CompareResp>(`${API_BASE}/api/compare?instances=${encodeURIComponent(instances.join(","))}`);

export const getReport = (monthId: number | null) =>
  getJSON<Report>(`${API_BASE}/api/report${monthId ? `?month_id=${monthId}` : ""}`);

export const getQa = (params: {
  monthId: number;
  instance: string;
  q?: string;
  source?: string;
  page?: number;
  pageSize?: number;
}) => {
  const sp = new URLSearchParams();
  sp.set("month_id", String(params.monthId));
  sp.set("instance", params.instance);
  if (params.q) sp.set("q", params.q);
  if (params.source) sp.set("source", params.source);
  sp.set("page", String(params.page ?? 1));
  sp.set("page_size", String(params.pageSize ?? 25));
  return getJSON<QaResp>(`${API_BASE}/api/qa?${sp.toString()}`);
};

/** Fetch every Q&A row for an instance (used for CSV export), page by page. */
export async function getAllQa(monthId: number, instance: string, q?: string, source?: string): Promise<QaRow[]> {
  const pageSize = 200;
  const first = await getQa({ monthId, instance, q, source, page: 1, pageSize });
  const rows = [...first.rows];
  for (let page = 2; page <= first.pages; page++) {
    const next = await getQa({ monthId, instance, q, source, page, pageSize });
    rows.push(...next.rows);
  }
  return rows;
}
