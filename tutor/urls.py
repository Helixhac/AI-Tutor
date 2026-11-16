from django.urls import path
from . import views

urlpatterns = [
    path("materials/upload/", views.upload_material, name="upload_material"),
    path("materials/<int:material_id>/explain/", views.explain_material, name="explain_material"),
    path("materials/<int:material_id>/ask/", views.ask_question, name="ask_question"),
    path("materials/<int:material_id>/quiz/", views.generate_quiz, name="generate_quiz"),
    path("materials/<int:material_id>/quiz/result/", views.submit_quiz_result, name="submit_quiz_result"),
    path("analytics/", views.analytics, name="analytics"),
    path("materials/<int:material_id>/page/<int:page_number>/image/", views.material_page_image, name="material_page_image"),
]
