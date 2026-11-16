import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuizQuestion } from "@/lib/api";

const KEYS = ["A", "B", "C", "D"] as const;

export function QuizPanel({
  questions,
  onClose,
  onFinish,
}: {
  questions: QuizQuestion[];
  onClose: () => void;
  onFinish?: (score: number, total: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const reportedRef = useRef(false);

  const q = questions[index];

  useEffect(() => {
    if (finished && !reportedRef.current) {
      reportedRef.current = true;
      onFinish?.(correctCount, questions.length);
    }
  }, [finished, correctCount, questions.length, onFinish]);

  if (finished || !q) {
    return (
      <div className="space-y-4 text-center">
        <h3 className="text-2xl font-semibold">Quiz bitdi</h3>
        <p className="text-muted-foreground">
          {questions.length} sualdan{" "}
          <span className="font-semibold text-success">{correctCount}</span> düzgün cavab
        </p>
        <Button onClick={onClose}>Dərsə qayıt</Button>
      </div>
    );
  }

  const answer = (key: string) => {
    if (picked) return;
    setPicked(key);
    if (key === q.correct) setCorrectCount((c) => c + 1);
  };

  const next = () => {
    setPicked(null);
    if (index + 1 >= questions.length) setFinished(true);
    else setIndex((i) => i + 1);
  };

  return (
    <div className="space-y-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Sual {index + 1} / {questions.length}
      </p>
      <h3 className="text-lg font-semibold leading-snug">{q.question}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {KEYS.map((k) => {
          const isCorrect = picked && k === q.correct;
          const isWrongPick = picked === k && k !== q.correct;
          return (
            <button
              key={k}
              onClick={() => answer(k)}
              disabled={!!picked}
              className={cn(
                "rounded-xl border bg-card p-4 text-left text-sm transition-colors",
                "hover:border-primary/50 disabled:cursor-default",
                isCorrect && "border-success bg-success/10 text-success-foreground",
                isWrongPick && "border-destructive bg-destructive/10",
              )}
            >
              <span className="mr-2 font-semibold text-primary">{k}.</span>
              {q.options?.[k]}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="flex items-center justify-between">
          <span className={cn("text-sm font-medium", picked === q.correct ? "text-success" : "text-destructive")}>
            {picked === q.correct ? "Düzgün cavab!" : `Səhv — doğrusu ${q.correct}`}
          </span>
          <Button onClick={next}>{index + 1 >= questions.length ? "Nəticə" : "Növbəti sual"}</Button>
        </div>
      )}
    </div>
  );
}