"""
Universal Document Parser
=========================
Spec bölmə 1.1: hansı material yüklənməsindən asılı olmayaraq eyni axından keçir.
Fayl uzantısına görə uyğun parser seçilir, amma çıxışda hamısı eyni formata
(vahid "material konteksti" obyektinə) çevrilir:

    {
        "raw_text": "<bütün mətn birlikdə>",
        "pages": [
            {"index": 0, "text": "<səhifə/slayd mətni>"},
            ...
        ],
        "file_type": "pdf" | "pptx" | "docx" | "image",
    }

Bundan sonrakı bütün axın (Gemini-yə göndərmək, guardrail, quiz generasiyası)
bu formatdan istifadə edir — fayl növü ilə maraqlanmır.
"""
import os

import fitz  # PyMuPDF
from pptx import Presentation
import docx


class UnsupportedFileTypeError(Exception):
    pass


def detect_file_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return "pdf"
    if ext == ".pptx":
        return "pptx"
    if ext == ".docx":
        return "docx"
    if ext in (".jpg", ".jpeg", ".png"):
        return "image"
    raise UnsupportedFileTypeError(f"Dəstəklənməyən fayl növü: {ext}")


def parse_pdf(filepath: str) -> dict:
    pages = []
    doc = fitz.open(filepath)
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        pages.append({"index": i, "text": text})
    doc.close()
    raw_text = "\n\n".join(p["text"] for p in pages)
    return {"raw_text": raw_text, "pages": pages, "file_type": "pdf"}


def parse_pptx(filepath: str) -> dict:
    prs = Presentation(filepath)
    pages = []
    for i, slide in enumerate(prs.slides):
        chunks = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                chunks.append(shape.text_frame.text)
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        chunks.append(cell.text)
        # speaker notes də mətnə daxil edilir
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = slide.notes_slide.notes_text_frame.text
            if notes:
                chunks.append(f"[Speaker notes: {notes}]")
        pages.append({"index": i, "text": "\n".join(c for c in chunks if c)})
    raw_text = "\n\n".join(p["text"] for p in pages)
    return {"raw_text": raw_text, "pages": pages, "file_type": "pptx"}


def parse_docx(filepath: str) -> dict:
    document = docx.Document(filepath)
    # DOCX-də "səhifə" konsepti fiziki olaraq yoxdur — paraqrafları məntiqi bloklara ayırırıq
    paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
    raw_text = "\n".join(paragraphs)
    pages = [{"index": 0, "text": raw_text}]
    return {"raw_text": raw_text, "pages": pages, "file_type": "docx"}


def parse_image(filepath: str) -> dict:
    # Şəkilin mətni yoxdur — Gemini-nin vision qabiliyyəti izah zamanı
    # birbaşa faylın özünü oxuyacaq (bax gemini_client.py). Burada yalnız
    # material konteksti üçün skelet yaradılır.
    pages = [{"index": 0, "text": "[Şəkil — mətn OCR ilə deyil, Gemini vision ilə oxunacaq]"}]
    return {"raw_text": "", "pages": pages, "file_type": "image", "image_path": filepath}


_PARSERS = {
    "pdf": parse_pdf,
    "pptx": parse_pptx,
    "docx": parse_docx,
    "image": parse_image,
}


def parse_material(filepath: str, original_filename: str) -> dict:
    """Fayl növünü aşkarlayıb uyğun parseri çağırır, vahid material konteksti qaytarır."""
    file_type = detect_file_type(original_filename)
    parser_fn = _PARSERS[file_type]
    return parser_fn(filepath)
