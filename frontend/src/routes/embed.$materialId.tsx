import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { explainMaterial, getPageImageUrl } from "@/lib/api";

/**
 * İframe-ə hazır, yığcam versiya — xarici bir sayt bunu birbaşa göstərə bilər:
 *
 *   <iframe src="https://sənin-domenin.com/embed/5?pages=12" width="480" height="640"></iframe>
 *
 * Header, geri düyməsi, naviqasiya kimi "tətbiq daxili" elementlər yoxdur —
 * yalnız material görüntüsü + izah, kənar saytın öz dizaynına asanlıqla oturur.
 */
export const Route = createFileRoute("/embed/$materialId")({
  validateSearch: (s: Record<string, unknown>) => ({
    pages: Number(s.pages ?? 1) || 1,
  }),
  component: EmbedWidget,
});

function EmbedWidget() {
  const { materialId } = Route.useParams();
  const { pages } = Route.useSearch();

  const [page, setPage] = useState(1);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const explain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await explainMaterial(materialId, page);
      setExplanation(res.content ?? "");
      if (typeof res.page === "number") setPage(res.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xəta baş verdi");
    } finally {
      setLoading(false);
    }
  }, [materialId, page]);

  // Valideynə (iframe-i göstərən sayta) hündürlüyü bildir — responsive iframe
  // üçün standart naxış (postMessage). Valideyn tərəf bunu dinləyib
  // iframe-in height-ini avtomatik tənzimləyə bilər.
  useEffect(() => {
    const height = document.documentElement.scrollHeight;
    window.parent?.postMessage({ type: "ai-tutor-resize", height }, "*");
  }, [explanation, loading]);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-lg space-y-3">
        <div className="overflow-hidden rounded-xl border bg-white">
          {imageFailed ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Görüntü mövcud deyil
            </div>
          ) : (
            <img
              key={page}
              src={getPageImageUrl(materialId, page)}
              alt={`Səhifə ${page}`}
              onError={() => setImageFailed(true)}
              className="w-full object-contain"
            />
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Səhifə {page} / {pages}
          </span>
          <div className="flex gap-1">
            <button
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                setImageFailed(false);
              }}
            >
              ←
            </button>
            <button
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={page >= pages}
              onClick={() => {
                setPage((p) => Math.min(pages, p + 1));
                setImageFailed(false);
              }}
            >
              →
            </button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Müəllimin izahı</span>
            <Button size="sm" variant="outline" onClick={() => void explain()} disabled={loading}>
              {loading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              İzah et
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="whitespace-pre-line text-sm leading-6 text-foreground/80">
              {explanation ?? "İzah almaq üçün yuxarıdakı düyməyə bas."}
            </p>
          )}
        </div>

        <p className="text-center text-[10px] text-muted-foreground/60">Powered by AI Tutor</p>
      </div>
    </div>
  );
}
