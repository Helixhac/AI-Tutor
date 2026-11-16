const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export function getPageImageUrl(materialId: string, page: number): string {
  return `${BASE_URL}/api/materials/${materialId}/page/${page}/image/`;
}

export class ApiError extends Error {}

const NETWORK_MESSAGE = "Bağlantı problemi, yenidən cəhd et";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        // ngrok pulsuz plan brauzer üçün xəbərdarlıq səhifəsi göstərir —
        // bu header fetch sorğularının o səhifəyə ilişməməsini təmin edir.
        "ngrok-skip-browser-warning": "true",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE);
  }
  if (!res.ok) {
    // Backend aydın bir "error" mesajı qaytarıbsa (məs. Gemini kvota limiti),
    // generic mesaj əvəzinə onu göstəririk.
    let backendMessage: string | null = null;
    try {
      const body = await res.clone().json();
      if (typeof body?.error === "string") backendMessage = body.error;
    } catch {
      // JSON deyildi və ya "error" sahəsi yoxdur — aşağıdakı generic mesaja düş
    }
    if (backendMessage) throw new ApiError(backendMessage);
    throw new ApiError(
      res.status >= 500 || res.status === 429
        ? "Server cavab vermir, bir azdan yenidən cəhd et"
        : NETWORK_MESSAGE,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("Serverdən gözlənilməz cavab gəldi");
  }
}

export interface UploadResponse {
  material_id: string;
  file_type: string;
  pages_count: number;
}

export function uploadMaterial(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResponse>("/api/materials/upload/", { method: "POST", body: form });
}

export interface ExplainResponse {
  explanation_id: string | null;
  content: string;
  page?: number;
  no_more_content?: boolean;
}

export function explainMaterial(id: string, page?: number, lang?: string) {
  return request<ExplainResponse>(`/api/materials/${id}/explain/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(page ? { page } : {}), ...(lang ? { lang } : {}) }),
  });
}

export interface AskResponse {
  question_id: string;
  answer: string;
  guardrail_blocked?: boolean;
}

export function askQuestion(id: string, question: string, page?: number, lang?: string) {
  return request<AskResponse>(`/api/materials/${id}/ask/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      ...(page ? { page } : {}),
      ...(lang ? { lang } : {}),
    }),
  });
}

export interface QuizQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: "A" | "B" | "C" | "D";
}

export async function fetchQuiz(id: string): Promise<QuizQuestion[]> {
  const data = await request<{ quiz_raw: string }>(`/api/materials/${id}/quiz/`, {
    method: "POST",
  });
  try {
    const parsed = JSON.parse(data.quiz_raw);
    return Array.isArray(parsed) ? (parsed as QuizQuestion[]) : [];
  } catch {
    throw new ApiError("Quiz məlumatı oxunmadı");
  }
}

export function submitQuizResult(materialId: string, score: number, total: number) {
  return request<{ result_id: string; score: number; total: number }>(
    `/api/materials/${materialId}/quiz/result/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, total }),
    },
  );
}

export interface AnalyticsRow {
  material_id: number;
  material_name: string;
  question_count: number;
  top_topic: string;
  guardrail_blocked_count?: number;
  quiz_attempts?: number;
  quiz_avg_score_percent?: number | null;
}

export async function fetchAnalytics(): Promise<AnalyticsRow[]> {
  const data = await request<{ rows: AnalyticsRow[] }>("/api/analytics/", { method: "GET" });
  return data.rows;
}