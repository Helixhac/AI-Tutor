import { useEffect, useState } from "react";

export function StreamingText({
  text,
  paused,
  onDone,
  spotlightIndex,
}: {
  text: string;
  paused?: boolean;
  onDone?: () => void;
  /**
   * TTS oxuyarkən cari söz mövqeyi (simvol indeksi) — spec bölmə 7:
   * "AI izah etdikcə slaydın üzərində spotlight effekti ilə cari abzas işıqlanır".
   * Verildikdə komponent "yazma" animasiyasından tam mətn + canlı söz-vurğusu
   * rejiminə keçir (səs təbii sürətlə oxuduğu üçün süni yazma effektinə ehtiyac yoxdur).
   */
  spotlightIndex?: number | null;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
  }, [text]);

  useEffect(() => {
    if (spotlightIndex != null) return; // spotlight rejimində typewriter dayanır
    if (paused || shown >= text.length) return;
    const t = setTimeout(() => setShown((s) => Math.min(text.length, s + 2)), 18);
    return () => clearTimeout(t);
  }, [shown, paused, text, spotlightIndex]);

  const done = shown >= text.length;
  useEffect(() => {
    if (done && spotlightIndex == null) onDone?.();
  }, [done, onDone, spotlightIndex]);

  if (spotlightIndex != null && text) {
    // Cari sözün sərhədlərini tap (spotlightIndex-dən əvvəlki/sonrakı boşluğa qədər)
    let wordStart = spotlightIndex;
    while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) wordStart--;
    let wordEnd = spotlightIndex;
    while (wordEnd < text.length && !/\s/.test(text[wordEnd])) wordEnd++;

    const before = text.slice(0, wordStart);
    const current = text.slice(wordStart, wordEnd);
    const after = text.slice(wordEnd);

    return (
      <div className="text-[15px] leading-7">
        <span className="text-foreground">{before}</span>
        <span className="rounded-md bg-highlight px-1 py-0.5 font-medium text-highlight-foreground">
          {current}
        </span>
        <span className="text-foreground/35">{after}</span>
      </div>
    );
  }

  const paragraphs = text.slice(0, shown).split(/\n+/).filter(Boolean);

  return (
    <div className="space-y-3 text-[15px] leading-7">
      {paragraphs.map((p, i) => {
        const isCurrent = i === paragraphs.length - 1 && !done;
        return (
          <p
            key={i}
            className={
              isCurrent
                ? "rounded-md bg-highlight px-2 py-1 text-highlight-foreground"
                : "text-foreground/70"
            }
          >
            {p}
            {isCurrent && <span className="ml-0.5 animate-pulse">▌</span>}
          </p>
        );
      })}
      {paragraphs.length === 0 && <p className="text-muted-foreground">Müəllim izah edir...</p>}
    </div>
  );
}
