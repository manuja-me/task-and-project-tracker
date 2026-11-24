import mimetypes
from pathlib import Path
from django.contrib import admin
from django.urls import path, include, re_path
from django.http import JsonResponse, FileResponse, HttpResponse
from django.conf import settings

def api_fallback_404(request, *args, **kwargs):
    return JsonResponse({"code": "not_found", "message": "API endpoint not found."}, status=404)

def spa_fallback(request, path=""):
    dist_dir = settings.BASE_DIR.parent / "frontend" / "dist"
    if path:
        clean_path = path.lstrip("/")
        candidate = dist_dir / clean_path
        if candidate.exists() and candidate.is_file():
            content_type, _ = mimetypes.guess_type(str(candidate))
            return FileResponse(open(candidate, "rb"), content_type=content_type or "application/octet-stream")

    index_file = dist_dir / "index.html"
    if index_file.exists():
        return FileResponse(open(index_file, "rb"), content_type="text/html")
    return HttpResponse("Frontend not built. Run 'npm run build'.", status=200)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("tracker.api.urls")),
    # Unknown API routes return 404 JSON
    re_path(r"^api/.*$", api_fallback_404),
    # Serve built assets and fallback to SPA for client-side routing
    re_path(r"^(?P<path>.*)$", spa_fallback),
]
