# AI Tutor — Backend + Frontend

[![CI](https://github.com/Helixhac/AI-Tutor/actions/workflows/ci.yml/badge.svg)](https://github.com/Helixhac/AI-Tutor/actions/workflows/ci.yml)

Dərs materialını (PDF/PPTX/DOCX/şəkil) yükləyib, Gemini ilə addım-addım izah
alan, sual-cavab, səsli qarşılıqlı əlaqə və mini-quiz təklif edən interaktiv
tədris sistemi.

## Struktur

```
ai_tutor/
├── ai_tutor/               # Django project settings/urls
├── tutor/
│   ├── models.py           # Material, Explanation, Question, QuizResult
│   ├── universal_parser.py # PDF/PPTX/DOCX/Image -> vahid "material konteksti"
│   ├── gemini_client.py    # Gemini API-nin mərkəzi nöqtəsi (mətn + vizual + embedding)
│   ├── guardrail.py        # Embedding-based mövzu-uyğunluq yoxlaması
│   ├── views.py            # upload/explain/ask/quiz/quiz-result/analytics/page-image
│   └── urls.py
├── frontend/                # React (Vite) — dərs otağı, quiz, müəllim paneli
└── requirements.txt
```

## Quraşdırma

```bash
python -m venv venv
venv\Scripts\activate        # Windows; Mac/Linux: source venv/bin/activate
pip install -r requirements.txt

# Kök qovluqda .env faylı yarat (aşağıdakı "Konfiqurasiya" bölməsinə bax)

python manage.py migrate
python manage.py createsuperuser   # admin panel üçün (istəyə görə)
python manage.py runserver
```

Frontend (ayrı terminalda):
```bash
cd frontend
npm install
# frontend/.env.local faylında VITE_API_BASE_URL yaz
npm run dev
```

## Konfiqurasiya

Gizli dəyərlər repoda saxlanılmır. Lokal `.env` faylında aşağıdakı dəyişənləri öz dəyərlərinlə yarat:

| Dəyişən | Təyinat |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API açarı (məcburi) |
| `CORS_ALLOW_ALL` | Lokal üçün `True`, production-da `False` |
| `CORS_ALLOWED_ORIGINS` | Production-da icazəli frontend domenləri |
| `DB_ENGINE` | Boş = SQLite, `postgresql` = PostgreSQL |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | PostgreSQL bağlantısı (yalnız `DB_ENGINE=postgresql` olduqda) |

Frontend üçün `frontend/.env.local`: `VITE_API_BASE_URL` — backend ünvanı (lokal: `http://127.0.0.1:8000`).

## Tamamlanmış funksionallıq

- ✅ **Universal Document Parser** — PDF (PyMuPDF), PPTX (python-pptx), DOCX
  (python-docx), şəkil — hamısı vahid material konteksti formatına gətirilir
- ✅ **Gemini ilə izah** — səhifə-səhifə, tələb olunanda (istifadəçi "Bu
  səhifəni izah et" düyməsinə basanda), boş/zibil-mətnli səhifələr avtomatik
  keçilir (150 simvol həddi)
- ✅ **Vizual analiz (multimodal)** — PDF səhifəsinin/şəklin real görüntüsü
  mətnlə YANAŞI Gemini-yə göndərilir, diaqram/qrafik/sxemlər də təhlil olunur
- ✅ **Guardrail** — sualın embedding-i (`gemini-embedding-001`) materialın
  mətn parçalarının embedding-ləri ilə cosine similarity üzrə müqayisə
  olunur; oxşarlıq həddin (`SIMILARITY_THRESHOLD=0.55`, `guardrail.py`-də)
  altındadırsa, Gemini-nin əsas modeli çağırılmadan hazır "mövzuya qayıdaq"
  cavabı göstərilir
- ✅ **Sərbəst səhifə naviqasiyası** — irəli/geri/birbaşa nömrə, real PDF
  səhifə görüntüsü ilə, heç bir API sorğusu getmədən
- ✅ **Səs (TTS)** — izahı "Dinlə" düyməsi ilə səslə oxutmaq, sözbəsöz
  **spotlight effekti** (cari söz canlı vurğulanır, spec bölmə 7)
- ✅ **Səs (STT)** — "Danış" düyməsi ilə davamlı dinləmə (əl ilə "Dayandır"a
  qədər), AZ/TR/EN dil seçimi
- ✅ **Mini-quiz** — material əsasında avtomatik generasiya, nəticə bazada
  saxlanılır (`QuizResult`)
- ✅ **Müəllim paneli** — real analitika: sual sayı, ən çox soruşulan mövzu,
  guardrail-in bloklama sayı, quiz cəhdi və orta bal
- ✅ **PostgreSQL-ə hazır** — `.env`-də `DB_ENGINE=postgresql` və uyğun `DB_*`
  dəyişənlərini doldursan avtomatik keçir (`psycopg2-binary` artıq quraşdırılıb);
  doldurmasan SQLite ilə eynilə işləməyə davam edir, heç nə dəyişmir
- ✅ **Sual-cavab da vizual** — sual verəndə cari səhifənin görüntüsü də
  Gemini-yə göndərilir (frontend `page` parametrini ötürür) — diaqram/şəkil
  haqqında "bu nədir?" tipli suallar cavablandırıla bilir
- ✅ **Kvota-təhlükəsiz** — Gemini-nin gündəlik limiti bitəndə istifadəçiyə
  aydın mesaj (server xətası kimi görünmür)
- ✅ **PPTX/DOCX vizual render** — LibreOffice (headless) ilə PDF-ə çevrilib
  (bir dəfə, nəticə `media/converted/`-də keşlənir) sonra PDF kimi render
  olunur; LibreOffice serverdə yoxdursa sakitcə mətn placeholder-inə düşür,
  heç nə sınmır. **Qeyd (DOCX):** mətn-əsaslı "səhifə" sayğacımız DOCX üçün
  həmişə 1-dir (bütün sənəd tək blok kimi emal olunur), ona görə çox səhifəli
  DOCX-lərdə naviqasiya yalnız 1-ci vizual səhifəni göstərəcək — PPTX-də bu
  problem yoxdur (hər slayd = bir səhifə, tam uyğundur)

## Hələ yoxdur / gələcək iş

- 🔲 Kamera ilə əl qaldırma (MediaPipe) — hazırda düymə ilə işləyir, tam kifayətdir
  (kameranın test mühiti olmadığı üçün bu, bilərəkdən gələcəyə saxlanılıb)
- 🔲 WebSocket/streaming izah (hazırda sinxron sorğu, kifayət qədər sürətlidir) —
  Django Channels + ASGI + Redis tələb edir, delivery-dən əvvəl risqli infrastruktur dəyişikliyi

## API Endpoint-lər

| Method | URL | Nə edir |
|---|---|---|
| POST | `/api/materials/upload/` | Fayl yükləyir, parse edir |
| POST | `/api/materials/<id>/explain/` | `{"page": N}` ilə səhifəni (mətn+görüntü) izah etdirir |
| POST | `/api/materials/<id>/ask/` | Guardrail-dən keçirib sual-cavab (`{"page": N}` versə, o səhifənin şəkli də göndərilir) |
| POST | `/api/materials/<id>/quiz/` | Mini-quiz generasiya edir |
| POST | `/api/materials/<id>/quiz/result/` | Quiz nəticəsini saxlayır |
| GET | `/api/materials/<id>/page/<n>/image/` | Səhifənin real görüntüsü (PNG) |
| GET | `/api/analytics/` | Müəllim paneli üçün statistika |

## PPTX/DOCX vizual render üçün LibreOffice (Windows)

PDF və şəkil materialları LibreOffice-siz də tam işləyir. PPTX/DOCX-in real
görüntüsünü görmək istəsən:

1. https://www.libreoffice.org/download/download/ — Windows versiyasını yüklə
2. Adi qaydada quraşdır (Next → Next → Install)
3. `soffice.exe`-nin PATH-də olduğuna əmin ol — adətən avtomatik əlavə olunur,
   olmasa `C:\Program Files\LibreOffice\program` yolunu sistem PATH-inə əlavə et
4. Django server-i restart et

Quraşdırmasan da heç nə sınmır — sadəcə PPTX/DOCX üçün "Sənəd görüntüsü"
yerinə mətn placeholder-i görünəcək (əvvəlki kimi).

## CORS

`.env`-də `CORS_ALLOW_ALL=True` (default, lokal development üçün).
Production-da `False` edib `CORS_ALLOWED_ORIGINS`-ə real domeni yaz.
