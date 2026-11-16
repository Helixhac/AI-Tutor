from collections import Counter
import os

import fitz  # PyMuPDF
from django.db.models import Count
from django.http import HttpResponse, FileResponse, Http404
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Material, Explanation, Question, QuizResult
from .universal_parser import parse_material, UnsupportedFileTypeError
from .gemini_client import GeminiClientWrapper, QuotaExceededError
from . import guardrail


def _quota_error_response(e: QuotaExceededError):
    """Gemini-nin gündəlik/dəqiqəlik pulsuz limiti bitəndə istifadəçiyə aydın,
    'server çökmüşdür' təəssüratı yaratmayan bir mesaj qaytarır."""
    if e.retry_seconds:
        message = (
            f"Gemini-nin pulsuz sorğu limiti hazırda bitib. "
            f"Təxminən {int(e.retry_seconds)} saniyədən sonra yenidən cəhd et."
        )
    else:
        message = "Gemini-nin pulsuz sorğu limiti hazırda bitib. Bir azdan yenidən cəhd et."
    return Response(
        {"error": message, "retry_after_seconds": e.retry_seconds},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


import shutil
import subprocess
import uuid

from django.conf import settings


_SOFFICE_COMMON_PATHS = [
    # Windows (default quraşdırma yerləri)
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    # macOS
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    # Linux
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
]


def _find_soffice() -> str | None:
    """
    `soffice` binary-sini tapır. Əvvəlcə PATH-ə baxır (`shutil.which`),
    tapmasa Windows/Mac/Linux-un standart quraşdırma yerlərini yoxlayır.
    Bu sayədə istifadəçi PATH-ə əl ilə düzəliş etməli olmur — LibreOffice
    adi qaydada (Next-Next-Install) quraşdırılıbsa avtomatik tapılır.
    """
    found = shutil.which("soffice")
    if found:
        return found
    for path in _SOFFICE_COMMON_PATHS:
        if os.path.isfile(path):
            return path
    return None


def _convert_via_office_com(material: "Material") -> str | None:
    """
    Windows-da, PowerPoint/Word əsl quraşdırılıbsa, COM avtomatlaşdırması
    (pywin32) ilə birbaşa PDF-ə çevirir — LibreOffice-dən daha etibarlı ola
    bilər, çünki istifadəçinin öz, artıq işlək Office quraşdırmasından istifadə
    edir. Windows olmayan mühitdə və ya pywin32/Office yoxdursa, sakitcə
    None qaytarır (LibreOffice-ə keçilir).
    """
    try:
        import win32com.client  # yalnız Windows-da mövcuddur
    except ImportError:
        return None

    converted_dir = os.path.join(settings.MEDIA_ROOT, "converted")
    os.makedirs(converted_dir, exist_ok=True)
    output_pdf = os.path.abspath(os.path.join(converted_dir, f"{material.id}.pdf"))
    source_path = os.path.abspath(material.file.path)

    try:
        if material.file_type == "pptx":
            app = win32com.client.Dispatch("PowerPoint.Application")
            presentation = app.Presentations.Open(source_path, WithWindow=False)
            presentation.SaveAs(output_pdf, 32)  # 32 = ppSaveAsPDF
            presentation.Close()
            app.Quit()
        elif material.file_type == "docx":
            app = win32com.client.Dispatch("Word.Application")
            app.Visible = False
            doc = app.Documents.Open(source_path)
            doc.ExportAsFixedFormat(output_pdf, 17)  # 17 = wdExportFormatPDF
            doc.Close()
            app.Quit()
        else:
            return None
    except Exception:
        # COM xətası (Office quraşdırılmayıb, lisenziya problemi və s.) —
        # sakitcə None qaytarıb LibreOffice fallback-ına icazə veririk.
        return None

    return output_pdf if os.path.exists(output_pdf) else None


def _office_to_pdf_path(material: "Material") -> str | None:
    """
    PPTX/DOCX faylını PDF-ə çevirir və keşlənmiş PDF-in yolunu qaytarır.
    Sıra: 1) PowerPoint/Word COM (Windows + əsl Office quraşdırılıbsa,
    ən etibarlısı) → 2) LibreOffice (cross-platform fallback). Heç biri
    mövcud deyilsə None qaytarır — vizual render sadəcə dəstəklənmir,
    heç nə sınmır.

    Nəticə `MEDIA_ROOT/converted/<material_id>.pdf` altında keşlənir ki, hər
    səhifə sorğusunda təkrar-təkrar (yavaş) çevrilmə getməsin.
    """
    converted_dir = os.path.join(settings.MEDIA_ROOT, "converted")
    os.makedirs(converted_dir, exist_ok=True)
    output_pdf = os.path.join(converted_dir, f"{material.id}.pdf")
    if os.path.exists(output_pdf):
        return output_pdf

    com_result = _convert_via_office_com(material)
    if com_result:
        return com_result

    soffice_path = _find_soffice()
    if soffice_path is None:
        return None

    # Hər çağırışa unikal profil qovluğu veririk ki, eyni anda gələn sorğular
    # LibreOffice-un profil kilidində bir-birinə mane olmasın.
    profile_dir = f"/tmp/lo_profile_{uuid.uuid4().hex}"
    try:
        subprocess.run(
            [
                soffice_path, "--headless", "--norestore",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "pdf",
                "--outdir", converted_dir,
                material.file.path,
            ],
            capture_output=True,
            timeout=60,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return None
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)

    # LibreOffice çıxış faylını orijinal ad əsasında adlandırır (uzantı .pdf) —
    # material.id ilə uyğunlaşdırmaq üçün adını dəyişirik.
    original_stem = os.path.splitext(os.path.basename(material.file.path))[0]
    produced_path = os.path.join(converted_dir, f"{original_stem}.pdf")
    if os.path.exists(produced_path) and produced_path != output_pdf:
        os.replace(produced_path, output_pdf)

    return output_pdf if os.path.exists(output_pdf) else None


def _render_pdf_page_png(filepath: str, page_index: int, zoom: float = 150 / 72) -> bytes | None:
    """PDF-in bir səhifəsini PNG bayta render edir. Uğursuz olsa None qaytarır."""
    try:
        doc = fitz.open(filepath)
        if page_index < 0 or page_index >= len(doc):
            doc.close()
            return None
        page = doc[page_index]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        png_bytes = pixmap.tobytes("png")
        doc.close()
        return png_bytes
    except Exception:
        return None


def _get_material_image_bytes(material: Material, page_number: int | None = None) -> bytes | None:
    """
    Gemini-nin vision qabiliyyətinə göndəriləcək real şəkil baytlarını qaytarır:
    - "image" material üçün: birbaşa yüklənmiş faylın özü
    - "pdf" material üçün: verilən səhifənin render olunmuş görüntüsü
    - "pptx"/"docx" material üçün: LibreOffice ilə PDF-ə çevrilib, həmin
      səhifə render olunur (LibreOffice quraşdırılmayıbsa None qaytarır)
    """
    if material.file_type == "image":
        try:
            with material.file.open("rb") as f:
                return f.read()
        except Exception:
            return None
    if material.file_type == "pdf" and page_number:
        return _render_pdf_page_png(material.file.path, page_number - 1)
    if material.file_type in ("pptx", "docx") and page_number:
        pdf_path = _office_to_pdf_path(material)
        if pdf_path is None:
            return None
        return _render_pdf_page_png(pdf_path, page_number - 1)
    return None


@api_view(["POST"])
def upload_material(request):
    """
    4.1 Material yükləmə:
    Fayl gəlir -> uyğun parser seçilir -> mətn çıxarılır -> Material kimi saxlanılır.
    Bu addımda hələ Gemini çağırılmır (izah ayrıca /explain/ endpoint-i ilə istənilir).
    """
    uploaded_file = request.FILES.get("file")
    if not uploaded_file:
        return Response({"error": "Fayl göndərilməyib (form-data açarı: 'file')."},
                         status=status.HTTP_400_BAD_REQUEST)

    material = Material(original_filename=uploaded_file.name, file=uploaded_file)
    material.save()  # fayl diskə yazılır ki, parser oxuya bilsin

    try:
        content = parse_material(material.file.path, uploaded_file.name)
    except UnsupportedFileTypeError as e:
        material.delete()
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    material.file_type = content["file_type"]
    material.extracted_content = content
    material.save()

    return Response({
        "material_id": material.id,
        "file_type": material.file_type,
        "pages_count": len(content.get("pages", [])),
    }, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def explain_material(request, material_id):
    """
    4.2 AI izahı:
    Material konteksti Gemini-yə göndərilir, izah alınır və saxlanılır.

    Əgər body-də {"page": N} göndərilirsə, backend həmin səhifədən başlayaraq
    İRƏLİ doğru axtarır və ilk MƏZMUNLU (boş olmayan) səhifəni tapıb onu izah
    edir — üz qabığı, boş vərəq və s. kimi səhifələr üçün istifadəçi əl ilə
    "Növbəti səhifə" düyməsinə basmasın, Gemini də boşuna çağırılmasın deyə.
    Cavabda hansı səhifənin faktiki izah olunduğu ("page") göndərilir ki,
    frontend öz sayğacını buna uyğunlaşdırsın.
    """
    try:
        material = Material.objects.get(id=material_id)
    except Material.DoesNotExist:
        return Response({"error": "Material tapılmadı."}, status=status.HTTP_404_NOT_FOUND)

    page_number = request.data.get("page")
    lang = request.data.get("lang", "az")
    gemini = GeminiClientWrapper()

    # Boş sayılmaq üçün minimum məzmun uzunluğu (çox qısa/whitespace-only səhifələr
    # üz qabığı, boş vərəq və ya "bu səhifə qəsdən boş buraxılıb" tipli olur).
    # 40 simvol çox aşağı idi — səhifə başlığı/nömrəsi kimi "zibil" mətn də asanlıqla
    # bu həddi keçir, amma real izah ediləcək məzmun deyil. 150 daha etibarlıdır.
    MIN_MEANINGFUL_CHARS = 150

    if page_number is not None:
        pages = material.extracted_content.get("pages", [])
        try:
            start_index = int(page_number) - 1
        except ValueError:
            return Response({"error": "Səhifə tapılmadı."}, status=status.HTTP_400_BAD_REQUEST)

        if start_index < 0 or start_index >= len(pages):
            return Response({"error": "Səhifə tapılmadı."}, status=status.HTTP_400_BAD_REQUEST)

        # start_index-dən başlayaraq irəli doğru ilk məzmunlu səhifəni tap.
        # QEYD: "image" material üçün mətn uzunluğu meyarı tətbiq olunmur —
        # şəkillərdə mənalı OCR mətni olmaya bilər, amma vizual məzmun (Gemini
        # vision ilə) hər zaman var sayılır. "pptx" üçün də eyni şey keçərlidir:
        # slaydlar kitab səhifələrindən fərqli olaraq həmişə hazırlanmış,
        # məqsədli məzmundur (qısa başlıq/bullet-lər normaldır, "boş" demək deyil).
        found_index = None
        for i in range(start_index, len(pages)):
            if material.file_type in ("image", "pptx"):
                found_index = i
                break
            text = (pages[i].get("text") or "").strip()
            if len(text) >= MIN_MEANINGFUL_CHARS:
                found_index = i
                break

        if found_index is None:
            # Bu nöqtədən sonra materialda daha məzmunlu səhifə qalmayıb
            return Response({
                "explanation_id": None,
                "content": "Bu materialda bundan sonra izah ediləcək əlavə mətn qalmayıb.",
                "page": len(pages),
                "no_more_content": True,
            })

        single_page_context = {"raw_text": pages[found_index].get("text", "")}
        image_bytes = _get_material_image_bytes(material, found_index + 1)
        try:
            explanation_text = gemini.explain_material(
                single_page_context, image_bytes=image_bytes, lang=lang
            )
        except QuotaExceededError as e:
            return _quota_error_response(e)
        explanation = Explanation.objects.create(material=material, content=explanation_text)

        return Response({
            "explanation_id": explanation.id,
            "content": explanation_text,
            "page": found_index + 1,  # faktiki izah olunan səhifə (1-indexed)
            "no_more_content": False,
        })

    try:
        explanation_text = gemini.explain_material(material.extracted_content, lang=lang)
    except QuotaExceededError as e:
        return _quota_error_response(e)
    explanation = Explanation.objects.create(material=material, content=explanation_text)

    return Response({
        "explanation_id": explanation.id,
        "content": explanation_text,
    })


@api_view(["POST"])
def ask_question(request, material_id):
    """
    4.4 Sual-cavab + Guardrail (Addım 2):
    Sual göndərilmədən əvvəl embedding oxşarlığı ilə materialın mövzusuna
    uyğunluğu yoxlanılır. Uyğun deyilsə, Gemini-nin əsas modeli çağırılmadan
    hazır "mövzuya qayıdaq" cavabı göstərilir (həm sürət, həm kvotaya qənaət).
    """
    try:
        material = Material.objects.get(id=material_id)
    except Material.DoesNotExist:
        return Response({"error": "Material tapılmadı."}, status=status.HTTP_404_NOT_FOUND)

    question_text = request.data.get("question")
    if not question_text:
        return Response({"error": "'question' sahəsi tələb olunur."},
                         status=status.HTTP_400_BAD_REQUEST)

    # İstəyə bağlı: hansı səhifəyə baxdığını bilsək (frontend göndərərsə),
    # həmin səhifənin real görüntüsünü də sualla birlikdə Gemini-yə göndəririk —
    # "bu diaqramda nə göstərilir?" kimi vizual sualları cavablandıra bilsin deyə.
    page_number = request.data.get("page")
    lang = request.data.get("lang", "az")
    image_bytes = None
    if page_number is not None:
        try:
            image_bytes = _get_material_image_bytes(material, int(page_number))
        except (TypeError, ValueError):
            image_bytes = None

    gemini = GeminiClientWrapper()

    # 1. Material üçün chunk embedding-ləri hələ hesablanmayıbsa, bir dəfə hesabla
    # və Material-da keşlə (növbəti suallar üçün təkrar hesablanmır).
    if not material.content_embeddings:
        raw_text = material.extracted_content.get("raw_text", "")
        chunks = guardrail.chunk_text(raw_text)
        if chunks:
            try:
                chunk_vectors = gemini.embed_texts(chunks)
            except QuotaExceededError as e:
                return _quota_error_response(e)
            material.content_embeddings = [
                {"text": c, "embedding": v} for c, v in zip(chunks, chunk_vectors)
            ]
            material.save(update_fields=["content_embeddings"])

    # 2. Sualın embedding-i ilə materialın parçaları arasında ən yüksək oxşarlığı tap
    try:
        question_embedding = gemini.embed_texts([question_text])[0]
    except QuotaExceededError as e:
        return _quota_error_response(e)

    chunk_vectors = [c["embedding"] for c in material.content_embeddings]
    similarity = guardrail.max_similarity(question_embedding, chunk_vectors)

    # 3. Uyğun deyilsə — Gemini-nin əsas modeli çağırılmadan hazır cavab qaytar
    if similarity < guardrail.SIMILARITY_THRESHOLD:
        off_topic_text = guardrail.OFF_TOPIC_RESPONSES.get(lang, guardrail.OFF_TOPIC_RESPONSE)
        question = Question.objects.create(
            material=material,
            question_text=question_text,
            answer_text=off_topic_text,
            guardrail_blocked=True,
            similarity_score=similarity,
        )
        return Response({
            "question_id": question.id,
            "answer": off_topic_text,
            "guardrail_blocked": True,
        })

    # 4. Uyğundursa — normal axın: Gemini-yə material konteksti (və varsa cari
    # səhifənin görüntüsü) ilə sual göndər
    try:
        answer_text = gemini.answer_question(
            material.extracted_content, question_text, image_bytes=image_bytes, lang=lang
        )
    except QuotaExceededError as e:
        return _quota_error_response(e)

    question = Question.objects.create(
        material=material,
        question_text=question_text,
        answer_text=answer_text,
        guardrail_blocked=False,
        similarity_score=similarity,
    )

    return Response({
        "question_id": question.id,
        "answer": answer_text,
        "guardrail_blocked": False,
    })


@api_view(["POST"])
def generate_quiz(request, material_id):
    """4.5 Mövzunun tamamlanması: material bitdikdə mini-quiz generasiyası."""
    try:
        material = Material.objects.get(id=material_id)
    except Material.DoesNotExist:
        return Response({"error": "Material tapılmadı."}, status=status.HTTP_404_NOT_FOUND)

    gemini = GeminiClientWrapper()
    try:
        quiz_json_text = gemini.generate_quiz(material.extracted_content)
    except QuotaExceededError as e:
        return _quota_error_response(e)

    return Response({"quiz_raw": quiz_json_text})


@api_view(["POST"])
def submit_quiz_result(request, material_id):
    """Quiz bitəndə nəticəni saxlayır (spec 4.5)."""
    try:
        material = Material.objects.get(id=material_id)
    except Material.DoesNotExist:
        return Response({"error": "Material tapılmadı."}, status=status.HTTP_404_NOT_FOUND)

    score = request.data.get("score")
    total = request.data.get("total")
    if score is None or total is None:
        return Response({"error": "'score' və 'total' sahələri tələb olunur."},
                         status=status.HTTP_400_BAD_REQUEST)

    try:
        score = int(score)
        total = int(total)
    except (TypeError, ValueError):
        return Response({"error": "'score' və 'total' rəqəm olmalıdır."},
                         status=status.HTTP_400_BAD_REQUEST)

    result = QuizResult.objects.create(material=material, score=score, total=total)
    return Response({"result_id": result.id, "score": score, "total": total},
                     status=status.HTTP_201_CREATED)


@api_view(["GET"])
def analytics(request):
    """
    Müəllim paneli üçün real analitika (spec bölmə 7):
    Hər material üzrə neçə sual verilib və ən çox təkrarlanan sual/mövzu nədir.
    """
    materials = (
        Material.objects.annotate(question_count=Count("questions"))
        .filter(question_count__gt=0)
        .order_by("-question_count")
    )

    rows = []
    for material in materials:
        questions = list(material.questions.values_list("question_text", flat=True))
        # ən çox təkrarlanan sual mətni (tam eyni olmasa da, ən çox rast gəlinən
        # ilk sualı "mövzu" kimi göstəririk — sadə MVP yanaşması)
        top_question, _count = Counter(questions).most_common(1)[0]
        blocked_count = material.questions.filter(guardrail_blocked=True).count()
        quiz_attempts = material.quiz_results.count()
        avg_score = None
        if quiz_attempts:
            results = material.quiz_results.all()
            avg_score = round(
                sum(r.score / r.total for r in results if r.total) / quiz_attempts * 100
            )
        rows.append({
            "material_id": material.id,
            "material_name": material.original_filename,
            "question_count": material.question_count,
            "top_topic": top_question,
            "guardrail_blocked_count": blocked_count,
            "quiz_attempts": quiz_attempts,
            "quiz_avg_score_percent": avg_score,
        })

    return Response({"rows": rows})


@api_view(["GET"])
def material_page_image(request, material_id, page_number):
    """
    Sənədin real görüntüsünü qaytarır (frontend-dəki boz "Sənəd görüntüsü"
    placeholder-inin yerinə). Hazırda:
    - PDF: PyMuPDF ilə həmin səhifə PNG-yə render olunur
    - PPTX/DOCX: LibreOffice ilə PDF-ə çevrilib (bir dəfə, keşlənir), sonra
      eyni yolla render olunur — LibreOffice quraşdırılmayıbsa 404 qaytarılır
      (frontend bu halda mətn placeholder-inə düşür, heç nə sınmır)
    - Şəkil (JPG/PNG) faylları: birbaşa orijinal fayl qaytarılır (səhifə 1)
    """
    try:
        material = Material.objects.get(id=material_id)
    except Material.DoesNotExist:
        raise Http404("Material tapılmadı.")

    if material.file_type == "image":
        return FileResponse(material.file.open("rb"), content_type="image/png")

    if material.file_type == "pdf":
        source_path = material.file.path
    elif material.file_type in ("pptx", "docx"):
        source_path = _office_to_pdf_path(material)
        if source_path is None:
            raise Http404(
                "Bu fayl növü üçün vizual render mövcud deyil "
                "(LibreOffice serverdə quraşdırılmayıb)."
            )
    else:
        raise Http404("Bu fayl növü üçün səhifə görüntüsü hələ dəstəklənmir.")

    png_bytes = _render_pdf_page_png(source_path, int(page_number) - 1)
    if png_bytes is None:
        raise Http404("Səhifə tapılmadı və ya render edilə bilmədi.")

    return HttpResponse(png_bytes, content_type="image/png")
