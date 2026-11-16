import { useCallback, useEffect, useRef, useState } from "react";

// TypeScript-in özündə SpeechRecognition tipi yoxdur (yalnız Chrome/Edge-ə
// xas, standartlaşmamış bir API) — minimal tip təsviri özümüz veririk.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Brauzer daxili Speech-to-Text (spec bölmə 5: Web Speech API).
 * `continuous: true` ilə işləyir — istifadəçi özü "Dayandır" düyməsinə
 * basana qədər dinləməyə davam edir (qısa fasilələrdə avtomatik kəsilmir).
 * Dəstəklənmirsə (yalnız Chrome/Edge dəstəkləyir) `supported=false` qaytarır.
 */
export function useSpeechToText() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSupported(!!Ctor);
  }, []);

  /**
   * onUpdate hər dəfə (aralıq və ya yekun nəticə gələndə) çağırılır və
   * HƏMİŞƏ indiyədək toplanmış TAM mətni ötürür (əlavə etmə məntiqini
   * çağıran tərəf düşünməsin deyə).
   */
  const listen = useCallback((onUpdate: (fullText: string) => void, lang: string = "az-AZ") => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;

    finalTranscriptRef.current = "";

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
        } else {
          interim += text;
        }
      }
      onUpdate(`${finalTranscriptRef.current} ${interim}`.trim());
    };
    // Bəzi brauzerlər uzun sükutdan sonra servisi özü bağlayır (davranışı
    // dəyişmək mümkün deyil) — bu halda vəziyyəti sadəcə "dayanıb" göstəririk.
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { listen, stopListening, listening, supported };
}
