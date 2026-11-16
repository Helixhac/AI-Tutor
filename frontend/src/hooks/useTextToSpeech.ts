import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Brauzer daxili Text-to-Speech (spec bölmə 5: Web Speech API, əlavə xərc yoxdur).
 * Azərbaycan dilində səs mövcuddursa onu seçir, olmasa brauzerin default səsini işlədir.
 *
 * `boundaryIndex` — spec bölmə 7-dəki "spotlight effekti" üçün: səsin hazırda
 * hansı sözü oxuduğunu (mətndəki simvol indeksi) canlı izləyir, bu sayədə UI
 * cari sözü vurğulaya bilir.
 */
export function useTextToSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [boundaryIndex, setBoundaryIndex] = useState<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const pickVoice = useCallback((langCode?: string): SpeechSynthesisVoice | undefined => {
    const voices = window.speechSynthesis.getVoices();
    const prefix = (langCode ?? "az").slice(0, 2).toLowerCase();
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("az")) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("tr")) ?? // Azərbaycana yaxın fonetika
      voices.find((v) => v.default) ??
      voices[0]
    );
  }, []);

  const speak = useCallback(
    (text: string, langCode?: string) => {
      if (!supported || !text) return;
      window.speechSynthesis.cancel(); // əvvəlki oxuma davam edirsə dayandır
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(langCode);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? langCode ?? "az-AZ";
      utterance.rate = 1;
      utterance.onstart = () => {
        setSpeaking(true);
        setBoundaryIndex(0);
      };
      utterance.onend = () => {
        setSpeaking(false);
        setBoundaryIndex(null);
      };
      utterance.onerror = () => {
        setSpeaking(false);
        setBoundaryIndex(null);
      };
      // Hər söz sərhədində atəşlənir — spotlight effekti üçün istifadə olunur.
      // Bütün brauzer/səs kombinasiyaları bunu dəstəkləmir; dəstəkləməsə
      // sadəcə vurğu canlı irəliləmir, funksionallıq pozulmur.
      utterance.onboundary = (e) => setBoundaryIndex(e.charIndex);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [supported, pickVoice],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setBoundaryIndex(null);
  }, [supported]);

  useEffect(() => stop, [stop]); // unmount olanda oxumanı dayandır

  return { speak, stop, speaking, supported, boundaryIndex };
}
