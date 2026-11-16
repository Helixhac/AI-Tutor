"""
Guardrail Servisi (Addım 2)
===========================
Spec bölmə 2.1: "Sualın mövzuya uyğunluğunun embedding ilə yoxlanması".

Məntiq:
1. Material yüklənəndə mətni parçalara (chunk) bölürük və hər parçanın
   embedding-ini bir dəfə hesablayıb Material.content_embeddings-də saxlayırıq.
2. Şagird sual verəndə, sualın embedding-i həmin parçalarla cosine similarity
   üzrə müqayisə olunur.
3. Ən yüksək oxşarlıq (max_similarity) threshold-dan aşağıdırsa — demək sual
   materialın mövzusundan kənardır — Gemini-nin əsas modeli HEÇ ÇAĞIRILMIR,
   əvəzinə hazır "mövzuya qayıdaq" cavabı göstərilir (həm sürət, həm limitə
   qənaət).
"""
import math

# Cosine similarity threshold — 0.0 (heç bir əlaqə yoxdur) ilə 1.0 (eyni) arası.
# QEYD: Bu dəyər empirik seçilib, real testlərlə (fərqli mövzularda suallar
# verməklə) kalibrlənməlidir. Google kvota limiti səbəbindən hazırda canlı
# test edilə bilmədi — ilk istifadədə lazım gələrsə tənzimlə.
SIMILARITY_THRESHOLD = 0.55

CHUNK_SIZE = 3000  # simvol
CHUNK_OVERLAP = 200
MAX_CHUNKS = 30  # embedding sorğularını məhdudlaşdırmaq üçün (böyük kitablarda)


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP,
                max_chunks: int = MAX_CHUNKS) -> list[str]:
    """Mətni overlap-lı parçalara bölür (RAG-da standart yanaşma)."""
    text = text.strip()
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text) and len(chunks) < max_chunks:
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap

    return chunks


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def max_similarity(query_embedding: list[float], chunk_embeddings: list[list[float]]) -> float:
    """Sualın embedding-i ilə materialın bütün parçaları arasında ən yüksək oxşarlığı tapır."""
    if not chunk_embeddings:
        # Embedding hesablanmayıbsa (məs. boş material), guardrail-i bloklamırıq —
        # bu halda əsas Gemini modeli özü qərar verəcək.
        return 1.0
    return max(cosine_similarity(query_embedding, c) for c in chunk_embeddings)


OFF_TOPIC_RESPONSES = {
    "az": (
        "Bu sual, yüklədiyin materialın mövzusundan kənara çıxır kimi görünür. "
        "Gəl əsas mövzuya qayıdaq — material daxilindəki bir sualını yaza bilərsən."
    ),
    "tr": (
        "Bu soru, yüklediğin materyalin konusunun dışına çıkıyor gibi görünüyor. "
        "Gel ana konuya dönelim — materyal içindeki bir soruyu yazabilirsin."
    ),
    "en": (
        "This question seems to be outside the topic of the material you uploaded. "
        "Let's get back on track — feel free to ask something from within the material."
    ),
}
# Geriyə uyğunluq üçün (kodun başqa yerində birbaşa istinad edilə bilər)
OFF_TOPIC_RESPONSE = OFF_TOPIC_RESPONSES["az"]
