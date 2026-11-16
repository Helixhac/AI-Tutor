from django.db import models


class Material(models.Model):
    """Yüklənmiş dərs materialı — format-agnostik (PDF/PPTX/DOCX/şəkil)."""

    FILE_TYPES = [
        ("pdf", "PDF"),
        ("pptx", "PPTX"),
        ("docx", "DOCX"),
        ("image", "Image"),
    ]

    original_filename = models.CharField(max_length=255)
    file = models.FileField(upload_to="materials/")
    file_type = models.CharField(max_length=10, choices=FILE_TYPES)

    # Universal Document Parser-in çıxışı: {"pages": [{"index":0,"text":"..."}], "raw_text": "..."}
    extracted_content = models.JSONField(default=dict, blank=True)

    # Guardrail (Addım 2): mətn parçalarının embedding-ləri, bir dəfə hesablanıb
    # kеşlənir. Format: [{"text": "...", "embedding": [float, ...]}, ...]
    content_embeddings = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.original_filename} ({self.file_type})"


class Explanation(models.Model):
    """Gemini tərəfindən materialdan generasiya olunan izah."""

    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="explanations")
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Explanation for {self.material.original_filename} @ {self.created_at:%Y-%m-%d %H:%M}"


class Question(models.Model):
    """Şagirdin verdiyi sual və Gemini-nin cavabı (guardrail addım 2-də əlavə olunacaq)."""

    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="questions")
    question_text = models.TextField()
    answer_text = models.TextField()
    # Guardrail (Addım 2): sual mövzuya uyğun olmadığı üçün Gemini-nin əsas
    # modeli çağırılmadan bloklanıbsa, izlənmə üçün saxlanılır.
    guardrail_blocked = models.BooleanField(default=False)
    similarity_score = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Q: {self.question_text[:50]}"


class QuizResult(models.Model):
    """Şagirdin mini-quiz nəticəsi (spec 4.5: quiz nəticəsi bazada saxlanılır)."""

    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="quiz_results")
    score = models.PositiveIntegerField()
    total = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.score}/{self.total} — {self.material.original_filename}"
