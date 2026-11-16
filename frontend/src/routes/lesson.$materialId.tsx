import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Hand,
  Loader2,
  Mic,
  Send,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ListChecks,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StreamingText } from "@/components/lesson/StreamingText";
import { QuizPanel } from "@/components/lesson/QuizPanel";
import {
  askQuestion,
  explainMaterial,
  fetchQuiz,
  getPageImageUrl,
  submitQuizResult,
  type QuizQuestion,
} from "@/lib/api";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { useSpeechToText } from "@/hooks/useSpeechToText";

export const Route = createFileRoute("/lesson/$materialId")({
  validateSearch: (s: Record<string, unknown>) => ({
    pages: Number(s.pages ?? 1) || 1,
    name: typeof s.name === "string" ? s.name : "Dərs materialı",
  }),
  head: () => ({
    meta: [
      { title: "Dərs otağı — AI Tutor" },
      {
        name: "description",
        content: "Sənədi öz sürətinlə vərəqlə, istədiyin səhifədə izah və ya sual iste.",
      },
      { property: "og:title", content: "Dərs otağı — AI Tutor" },
      { property: "og:description", content: "Səhifələr arasında sərbəst gəz, izahı öz vaxtında al." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LessonRoom,
});

interface Bubble {
  id: string;
  question: string;
  answer: string | null;
  guardrailBlocked?: boolean;
}

const SPEECH_LANG_OPTIONS: { code: string; label: string }[] = [
  { code: "az-AZ", label: "AZ" },
  { code: "tr-TR", label: "TR" },
  { code: "en-US", label: "EN" },
];

function LessonRoom() {
  const { materialId } = Route.useParams();
  const { pages, name } = Route.useSearch();

  // Sənəd görüntüsü — tamamilə sərbəst gəzinti, heç bir API çağırmır
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    setImageLoading(true);
  }, [page]);

  // İzah — yalnız istifadəçi "Bu səhifəni izah et" düyməsinə basanda çağırılır
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainedPage, setExplainedPage] = useState<number | null>(null);
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [handRaised, setHandRaised] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  const lastRequestedPage = useRef<number | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);

  const tts = useTextToSpeech();
  const stt = useSpeechToText();
  const [speechLang, setSpeechLang] = useState("az-AZ");
  const responseLang = speechLang.slice(0, 2); // "az-AZ" -> "az" (backend/Gemini üçün)

  const goToPage = useCallback(
    (target: number) => {
      const clamped = Math.min(Math.max(target, 1), pages);
      setPage(clamped);
      setPageInput(String(clamped));
      setImageFailed(false);
      tts.stop();
    },
    [pages, tts.stop],
  );

  const explainCurrentPage = useCallback(async () => {
    tts.stop();
    lastRequestedPage.current = page;
    setLoadingExplain(true);
    setError(null);
    try {
      const res = await explainMaterial(materialId, page, responseLang);
      setExplanation(res.content ?? "");
      // Backend bu səhifə boşdursa irəlidəki məzmunlu səhifəni tapıb izah edə bilər —
      // onda görüntünü də faktiki izah olunan səhifəyə sürüşdürürük.
      if (typeof res.page === "number" && res.page !== page) {
        goToPage(res.page);
      }
      setExplainedPage(res.page ?? page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xəta baş verdi");
    } finally {
      setLoadingExplain(false);
    }
  }, [materialId, page, goToPage, tts.stop, responseLang]);

  // Dərsin başlanğıcında 1-ci səhifəni bir dəfə avtomatik izah et
  useEffect(() => {
    void explainCurrentPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  const openQuiz = useCallback(async () => {
    setQuizLoading(true);
    setQuizError(null);
    try {
      const q = await fetchQuiz(materialId);
      setQuiz(q);
      setQuizOpen(true);
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "Quiz yüklənmədi");
    } finally {
      setQuizLoading(false);
    }
  }, [materialId]);

  const submitQuestion = async () => {
    const text = question.trim();
    if (!text || asking) return;
    const id = `${Date.now()}`;
    setBubbles((b) => [...b, { id, question: text, answer: null }]);
    setQuestion("");
    setAsking(true);
    try {
      const res = await askQuestion(materialId, text, page, responseLang);
      setBubbles((b) =>
        b.map((x) =>
          x.id === id ? { ...x, answer: res.answer, guardrailBlocked: res.guardrail_blocked } : x,
        ),
      );
      tts.speak(res.answer, speechLang);
    } catch (e) {
      setBubbles((b) =>
        b.map((x) =>
          x.id === id
            ? { ...x, answer: e instanceof Error ? e.message : "Cavab alınmadı" }
            : x,
        ),
      );
    } finally {
      setAsking(false);
    }
  };

  const submitPageJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) goToPage(n);
  };

  const isCurrentPageExplained = explainedPage === page;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link to="/">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <p className="truncate text-sm font-medium">{name}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void openQuiz()} disabled={quizLoading}>
            {quizLoading ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
            Mini-quiz
          </Button>
        </div>
      </header>

      {quizError && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {quizError}
          </p>
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-6">
          {/* Sənəd görüntüsü — sərbəst gəzinti, API çağırmır */}
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sənəd görüntüsü
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <form onSubmit={submitPageJump} className="flex items-center gap-1">
                  <Input
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground">/ {pages}</span>
                </form>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= pages}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            {imageFailed ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-xl bg-secondary/60 p-8 text-center text-sm text-muted-foreground">
                Bu fayl növü üçün səhifə görüntüsü hələ dəstəklənmir.
              </div>
            ) : (
              <div className="relative min-h-[280px]">
                {imageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-secondary/40">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <img
                  key={page}
                  src={getPageImageUrl(materialId, page)}
                  alt={`Səhifə ${page}`}
                  onLoad={() => setImageLoading(false)}
                  onError={() => {
                    setImageLoading(false);
                    setImageFailed(true);
                  }}
                  className="max-h-[70vh] w-full rounded-xl border bg-white object-contain"
                />
              </div>
            )}
          </div>

          {/* İzah — yalnız istəyəndə */}
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            {(tts.supported || stt.supported) && (
              <div className="mb-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Səs dili:</span>
                  {SPEECH_LANG_OPTIONS.map((opt) => (
                    <Button
                      key={opt.code}
                      type="button"
                      size="sm"
                      variant={speechLang === opt.code ? "default" : "outline"}
                      disabled={stt.listening || tts.speaking}
                      onClick={() => setSpeechLang(opt.code)}
                      className="h-7 px-2 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                {speechLang !== "az-AZ" && (
                  <p className="text-xs text-muted-foreground">
                    Dili dəyişdin — mövcud izah köhnə dildədir, yeni dildə görmək üçün
                    "Yenidən izah et" bas.
                  </p>
                )}
              </div>
            )}
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Müəllimin izahı</h2>
              <div className="flex items-center gap-2">
                {tts.supported && explanation && isCurrentPageExplained && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => (tts.speaking ? tts.stop() : tts.speak(explanation, speechLang))}
                  >
                    {tts.speaking ? (
                      <>
                        <VolumeX className="size-4" /> Dayandır
                      </>
                    ) : (
                      <>
                        <Volume2 className="size-4" /> Dinlə
                      </>
                    )}
                  </Button>
                )}
                <Button size="sm" onClick={() => void explainCurrentPage()} disabled={loadingExplain}>
                  {loadingExplain ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {isCurrentPageExplained ? "Yenidən izah et" : "Bu səhifəni izah et"}
                </Button>
              </div>
            </div>

            {error ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void explainCurrentPage()}>
                  Yenidən cəhd et
                </Button>
              </div>
            ) : loadingExplain ? (
              <p className="text-sm text-muted-foreground">İzah hazırlanır...</p>
            ) : explanation && isCurrentPageExplained ? (
              <StreamingText
                text={explanation}
                paused={handRaised}
                spotlightIndex={tts.speaking ? tts.boundaryIndex : null}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Bu səhifə hələ izah edilməyib. Yuxarıdakı düyməyə basaraq izah istə.
              </p>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border bg-card p-5 shadow-card">
            <h2 className="text-sm font-semibold">Sual-cavab</h2>
            {bubbles.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                Nə isə aydın deyilsə, əl qaldır və sualını yaz.
              </p>
            )}
            <div className="mt-4 space-y-4">
              {bubbles.map((b) => (
                <div key={b.id} className="space-y-2">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                    {b.question}
                  </p>
                  <p
                    className={`w-fit max-w-[90%] rounded-2xl rounded-bl-sm px-4 py-2 text-sm ${
                      b.guardrailBlocked
                        ? "bg-secondary/60 italic text-muted-foreground"
                        : "bg-secondary"
                    }`}
                  >
                    {b.answer ?? "Cavab hazırlanır..."}
                  </p>
                </div>
              ))}
            </div>

            {handRaised && (
              <div className="mt-5 space-y-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  💡 Sualın {page}-ci səhifənin görüntüsü ilə birlikdə göndərilir — diaqram və ya
                  şəkil haqqında da soruşa bilərsən.
                </p>
                <Textarea
                  ref={questionInputRef}
                  autoFocus
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submitQuestion();
                    }
                  }}
                  placeholder="Sualını yaz və ya mikrofonla danış... (Enter — göndər, Shift+Enter — yeni sətir)"
                  rows={3}
                />

                {stt.listening && (
                  <p className="text-xs text-primary">🎙️ Dinlənilir... "Dayandır" basana qədər davam edir</p>
                )}
                {!stt.supported && (
                  <p className="text-xs text-muted-foreground">
                    Səsli sual yalnız Chrome/Edge brauzerlərində dəstəklənir.
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button onClick={submitQuestion} disabled={asking || !question.trim()}>
                    {asking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    Göndər
                  </Button>

                  {stt.supported && (
                    <Button
                      type="button"
                      variant={stt.listening ? "destructive" : "outline"}
                      onClick={() => {
                        if (stt.listening) {
                          stt.stopListening();
                        } else {
                          tts.stop();
                          stt.listen((text) => setQuestion(text), speechLang);
                        }
                      }}
                    >
                      {stt.listening ? (
                        <>
                          <Mic className="size-4 animate-pulse" /> Dayandır
                        </>
                      ) : (
                        <>
                          <Mic className="size-4" /> Danış
                        </>
                      )}
                    </Button>
                  )}

                  <Button variant="ghost" onClick={() => setHandRaised(false)}>
                    Davam et
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      <Button
        size="lg"
        className="fixed bottom-6 right-6 z-30 shadow-card"
        onClick={() => {
          setHandRaised(true);
          tts.stop();
        }}
      >
        <Hand className="size-5" /> Əl qaldır
      </Button>

      <Dialog open={quizOpen} onOpenChange={setQuizOpen}>
        <DialogContent className="max-w-2xl">
          {quiz && quiz.length > 0 ? (
            <QuizPanel
              questions={quiz}
              onClose={() => setQuizOpen(false)}
              onFinish={(score, total) => {
                submitQuizResult(materialId, score, total).catch(() => {
                  // Nəticənin saxlanması uğursuz olsa belə, şagirdin nəticəni
                  // görməsinə mane olmuruq — sadəcə arxa fonda sakitcə itir.
                });
              }}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Quiz sualı tapılmadı.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
