from django.contrib import admin
from .models import Material, Explanation, Question, QuizResult


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ("id", "original_filename", "file_type", "created_at")


@admin.register(Explanation)
class ExplanationAdmin(admin.ModelAdmin):
    list_display = ("id", "material", "created_at")


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "material", "question_text", "created_at")


@admin.register(QuizResult)
class QuizResultAdmin(admin.ModelAdmin):
    list_display = ("id", "material", "score", "total", "created_at")
