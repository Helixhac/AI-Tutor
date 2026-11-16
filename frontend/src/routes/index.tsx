import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { UploadCloud, FileText, Loader2, GraduationCap, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadMaterial, type UploadResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Tutor — Dərs materialını addım-addım öyrən" },
      {
        name: "description",
        content:
          "Materialını yüklə, izahı addım-addım dinlə, istənilən an sual ver və mövzu sonunda mini-quiz həll et.",
      },
      { property: "og:title", content: "AI Tutor — Dərs materialını addım-addım öyrən" },
      {
        property: "og:description",
        content: "PDF, PPTX, DOCX və şəkil materiallarını interaktiv dərsə çevir.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const ACCEPT = ".pdf,.pptx,.docx,.jpg,.jpeg,.png";
const ACCEPT_EXTENSIONS = [".pdf", ".pptx", ".docx", ".jpg", ".jpeg", ".png"];

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(f: File): boolean {
  const name = f.name.toLowerCase();
  return ACCEPT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function Index() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!isAcceptedFile(f)) {
      setError("Bu fayl növü dəstəklənmir. Yalnız PDF, PPTX, DOCX, JPG və ya PNG yüklə.");
      setFile(null);
      setResult(null);
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
  };

  const upload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await uploadMaterial(file);
      setResult(res);
      navigate({
        to: "/lesson/$materialId",
        params: { materialId: String(res.material_id) },
        search: { pages: res.pages_count ?? 1, name: file.name },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xəta baş verdi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <GraduationCap className="size-5 text-primary" />
            AI Tutor
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/teacher">
              <BarChart3 className="size-4" /> Müəllim paneli
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Dərs materialını yüklə, izahı addım-addım dinlə
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          PDF, PPTX, DOCX və ya şəkil yüklə. İzah zamanı istənilən an əl qaldırıb sual ver, mövzu
          bitəndə isə mini-quiz həll et.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "mt-10 cursor-pointer rounded-2xl border-2 border-dashed bg-card p-10 text-center shadow-card transition-colors",
            dragging ? "border-primary bg-accent/40" : "border-border hover:border-primary/50",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <UploadCloud className="mx-auto size-10 text-primary" />
          <p className="mt-4 font-medium">Faylı bura sürüklə və ya seçmək üçün klikləyin</p>
          <p className="mt-1 text-sm text-muted-foreground">PDF, PPTX, DOCX, JPG, PNG</p>
          {file && (
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm">
              <FileText className="size-4 text-primary" />
              {file.name}
              <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setResult(null);
                  setError(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="ml-1 text-muted-foreground hover:text-destructive"
                aria-label="Faylı sil"
              >
                ✕
              </button>
            </p>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button size="lg" disabled={!file || loading} onClick={upload}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? "Material hazırlanır..." : "Dərsə başla"}
          </Button>
          {result && (
            <span className="text-sm text-muted-foreground">{result.pages_count} səhifə tapıldı</span>
          )}
        </div>
      </main>
    </div>
  );
}
