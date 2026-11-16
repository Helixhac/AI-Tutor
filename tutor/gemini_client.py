"""
Gemini Client Wrapper
======================
Spec bölmə 2.1: "Gemini API ilə bütün əlaqənin mərkəzləşdirilməsi".

Addım 1 MVP-də (bax spesifikasiya bölmə 8):
- Guardrail servisi hələ yoxdur (addım 2-də əlavə olunacaq) — amma sistem
  promptunda "yalnız bu materialdan istifadə et" qaydası artıq qoyulur ki,
  Gemini-nin özü mövzudan kənara çıxmasın.
- Kamera/səs yoxdur — sadə mətn izahı və mətn sual-cavab.
"""
import os

import re

from google import genai
from google.genai import types
from google.genai import errors as genai_errors

LANGUAGE_NAMES = {
    "az": "Azərbaycan",
    "tr": "Türk",
    "en": "İngilis",
}

SYSTEM_INSTRUCTION_TEMPLATE = """Sən AI Tutor-san — şagirdlərə yalnız aşağıda verilmiş dərs materialı
əsasında dərs izah edən virtual müəllimsən.

QAYDALAR (mütləq riayət et):
1. Yalnız aşağıdakı material məzmunundan istifadə et. Materialda olmayan
   məlumatı əlavə etmə, xarici mənbələrdən fakt uydurma.
2. Əgər sual materialın mövzusundan tamamilə kənardırsa, nəzakətlə bildir ki,
   bu mövzu material daxilində deyil və şagirdi əsas mövzuya qaytar.
3. İzahı sadə, addım-addım, şagirdin başa düşəcəyi dildə ver.
4. Cavabını MÜTLƏQ {language_name} dilində ver — başqa dilə keçmə, hətta
   material və ya sual başqa dildə olsa belə, cavab dili dəqiq bu olmalıdır.
5. Sənə şəkil (bu səhifənin real görüntüsü) də verilibsə, onu diqqətlə təhlil et —
   diaqram, cədvəl, qrafik, sxem və ya illüstrasiyaları da izahına qat, təkcə
   mətnlə kifayətlənmə.
6. MÜTLƏQ: cavabını YALNIZ sadə mətn (plain text) kimi yaz. Markdown
   sintaksisindən HEÇ VAXT istifadə etmə — yəni `**qalın**`, `### başlıq`,
   `* bullet`, `---` kimi işarələr QADAĞANDIR. Başlıq lazımdırsa sadəcə yeni
   sətirdə aydın bir ifadə yaz (məs. "Əsas anlayışlar:"), siyahı üçün isə
   defis (-) və ya rəqəm (1., 2.) işlət, ulduz (*) işlətmə.
7. Hər səhifədə özünü təqdim etmə, salamlaşma ("Salam, mən sənin
   müəlliminəm..." kimi) YAZMA — şagird artıq kim olduğunu bilir. Birbaşa
   materialın məzmununun izahına başla.

MATERIAL MƏZMUNU:
---
{material_text}
---
"""


class QuotaExceededError(Exception):
    """Gemini-nin (pulsuz plan) gündəlik/dəqiqəlik sorğu limiti bitəndə qaldırılır."""

    def __init__(self, retry_seconds: float | None = None):
        self.retry_seconds = retry_seconds
        super().__init__("Gemini API sorğu limiti bitib.")


def _call_gemini_safely(fn, *args, **kwargs):
    """Gemini çağırışlarını sarır — 429 (RESOURCE_EXHAUSTED) xətasını aydın bir
    exception-a çevirir ki, view səviyyəsində istifadəçiyə anlaşılan mesaj
    göstərmək mümkün olsun (default davranış: xam 500 + tam traceback)."""
    try:
        return fn(*args, **kwargs)
    except genai_errors.ClientError as e:
        if getattr(e, "code", None) == 429 or "RESOURCE_EXHAUSTED" in str(e):
            retry_seconds = None
            try:
                details = e.details.get("error", {}).get("details", [])
                for d in details:
                    if d.get("@type", "").endswith("RetryInfo"):
                        delay = d.get("retryDelay", "")
                        retry_seconds = float(delay.rstrip("s")) if delay else None
            except Exception:
                pass
            raise QuotaExceededError(retry_seconds) from e
        raise


class GeminiClientWrapper:
    def __init__(self, api_key: str | None = None, model: str = "gemini-3.5-flash-lite"):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "GEMINI_API_KEY tapılmadı. .env faylına və ya mühit dəyişənlərinə əlavə et."
            )
        self.client = genai.Client(api_key=self.api_key)
        self.model = model

    def _system_instruction(self, material_text: str, lang: str = "az", has_image: bool = False) -> str:
        language_name = LANGUAGE_NAMES.get(lang, LANGUAGE_NAMES["az"])
        text_stripped = material_text.strip()

        if not text_stripped and has_image:
            # Material mətni boşdur, amma bir şəkil əlavə olunub — bu şəkil
            # materialın ÖZÜDÜR (mətn yox deyə "material verilməyib" demə).
            material_section = (
                "Bu materialın mətn hissəsi yoxdur — material YALNIZ əlavə "
                "olunmuş şəkildən ibarətdir. Şəklin özünü material məzmunu "
                "kimi qəbul et və ona əsaslanaraq cavab ver."
            )
        else:
            material_section = text_stripped[:30000]

        return SYSTEM_INSTRUCTION_TEMPLATE.format(
            material_text=material_section, language_name=language_name
        )

    def explain_material(
        self,
        material_context: dict,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
        lang: str = "az",
    ) -> str:
        """
        Materialın izahını generasiya edir (addım 1 — stream yoxdur, sadə mətn).

        `image_bytes` verilibsə (səhifənin real görüntüsü və ya yüklənmiş şəkil),
        bu, mətnlə YANAŞI Gemini-nin vision qabiliyyətinə göndərilir — yəni
        diaqramlar, qrafiklər, sxemlər və illüstrasiyalar da faktiki "görülür",
        təkcə çıxarılan mətnə əsaslanılmır.

        `lang` — cavabın diliini müəyyən edir ("az"/"tr"/"en"). Bu, yalnız
        SƏSİN özünü deyil, MƏTNİN özünü də həmin dilə keçirir — TTS düzgün
        tələffüz etsin deyə (əks halda, məs. ingilis səsi Azərbaycan mətnini
        oxuyanda səhv/qəribə tələffüz yaranır).
        """
        material_text = material_context.get("raw_text", "")
        prompt_text = (
            "Bu materialı şagirdə addım-addım izah et. Əsas anlayışları, sıra ilə,"
            " aydın başlıqlarla izah et."
        )
        if image_bytes:
            prompt_text += (
                " Əlavə olunan şəkildə (bu səhifənin real görüntüsü) diaqram, qrafik,"
                " sxem və ya illüstrasiya varsa, onu da diqqətlə təhlil edib izahına daxil et —"
                " yalnız mətnlə kifayətlənmə, vizual elementləri də təsvir et."
            )
            contents = [prompt_text, types.Part.from_bytes(data=image_bytes, mime_type=image_mime)]
        else:
            contents = prompt_text

        response = _call_gemini_safely(
            self.client.models.generate_content,
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction(material_text, lang, has_image=bool(image_bytes)),
            ),
        )
        return self._strip_markdown(response.text)

    def answer_question(
        self,
        material_context: dict,
        question: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
        lang: str = "az",
    ) -> str:
        """Şagirdin sualına material konteksti daxilində cavab verir.

        `image_bytes` verilibsə (cari səhifənin real görüntüsü), sual bu şəklə
        istinadən ola bilər (məs. "bu diaqramda X nə deməkdir?") — şəkil
        mətnlə YANAŞI Gemini-nin vision qabiliyyətinə göndərilir.

        `lang` — cavabın dilini müəyyən edir (bax `explain_material` qeydi).

        QEYD: Guardrail (embedding oxşarlığı yoxlaması) view səviyyəsində,
        bu metod çağırılmadan əvvəl aparılır.
        """
        material_text = material_context.get("raw_text", "")
        if image_bytes:
            contents = [question, types.Part.from_bytes(data=image_bytes, mime_type=image_mime)]
        else:
            contents = question

        response = _call_gemini_safely(
            self.client.models.generate_content,
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction(material_text, lang, has_image=bool(image_bytes)),
            ),
        )
        return self._strip_markdown(response.text)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Guardrail üçün: mətnləri embedding vektorlarına çevirir.
        Bir API çağırışında bütün mətnlər (sual + material chunk-ları) birlikdə
        göndərilə bilər — gemini-embedding-001 max 250 mətnə qədər dəstəkləyir,
        bu da limitə daha az təsir edir (əsas Gemini modelindən ayrı, ucuz model).
        """
        response = _call_gemini_safely(
            self.client.models.embed_content,
            model="gemini-embedding-001",
            contents=texts,
        )
        return [list(e.values) for e in response.embeddings]

    def generate_quiz(self, material_context: dict, num_questions: int = 3) -> str:
        """Material bitdikdə mini-quiz generasiyası (spec bölmə 4.5)."""
        material_text = material_context.get("raw_text", "")
        prompt = (
            f"Bu materialın özündən {num_questions} sualdan ibarət qısa quiz hazırla. "
            "Hər sual üçün 4 variant (A,B,C,D) və düzgün cavabı JSON formatında qaytar: "
            '[{"question": "...", "options": {"A":"...","B":"...","C":"...","D":"..."}, "correct": "A"}]. '
            "Yalnız JSON qaytar, başqa mətn əlavə etmə."
        )
        response = _call_gemini_safely(
            self.client.models.generate_content,
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction(material_text),
            ),
        )
        return self._strip_json_fence(response.text)

    @staticmethod
    def _strip_json_fence(text: str) -> str:
        """Gemini bəzən JSON-u ```json ... ``` kod blokunda qaytarır —
        frontend-in JSON.parse-i sınmasın deyə bunu təmizləyirik."""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]  # ilk sətri (```json) at
            if cleaned.rstrip().endswith("```"):
                cleaned = cleaned.rstrip()[:-3]
        return cleaned.strip()

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """
        Qoruyucu tədbir: sistem promptunda 'markdown işlətmə' desək də,
        Gemini bəzən yenə `**qalın**`, `### başlıq`, `* bullet` kimi
        işarələr yaza bilər — frontend bunları render etmədiyi (sadə mətn
        kimi göstərdiyi) üçün, buradan təmizləyib göndəririk.
        """
        # Üfüqi xətlər (---, ***, ___)
        text = re.sub(r"^\s*[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
        # Başlıqlar: ### Başlıq -> Başlıq (sətir əvvəlində və ya mətn içində)
        text = re.sub(r"(^|\s)#{1,6}\s*", r"\1", text, flags=re.MULTILINE)
        # Qalın/italik: **mətn** və __mətn__ -> mətn
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
        text = re.sub(r"__(.+?)__", r"\1", text)
        # Sətir əvvəlindəki "* " bullet-i "- "-yə çevir
        text = re.sub(r"^(\s*)\*\s+", r"\1- ", text, flags=re.MULTILINE)
        # Qalan tək ulduzlu vurğular: *mətn* -> mətn
        text = re.sub(r"(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)", r"\1", text)
        # Artıq boş sətirləri yığcamlaşdır
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()
