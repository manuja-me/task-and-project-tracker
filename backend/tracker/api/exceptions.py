from rest_framework.views import exception_handler
from rest_framework.exceptions import (
    APIException,
    AuthenticationFailed,
    NotAuthenticated,
    PermissionDenied,
    ValidationError,
    NotFound,
)
from rest_framework.response import Response
from rest_framework import status

class ConflictError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "conflict"
    default_detail = "A business conflict occurred."

class MemberHasAssignedTasksError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "member_has_assigned_tasks"
    default_detail = "Cannot remove member with assigned tasks."

    def __init__(self, assigned_count: int, filter_url: str):
        super().__init__(self.default_detail)
        self.assigned_count = assigned_count
        self.filter_url = filter_url

class StaleWriteError(APIException):
    status_code = status.HTTP_412_PRECONDITION_FAILED
    default_code = "stale_write"
    default_detail = "Resource version conflict. The resource was modified by another request."

class PreconditionRequiredError(APIException):
    status_code = status.HTTP_428_PRECONDITION_REQUIRED
    default_code = "precondition_required"
    default_detail = "X-Expected-Version header is required."

def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is None:
        return None

    data = response.data
    code = getattr(exc, "default_code", "error")
    if hasattr(exc, "get_codes"):
        codes = exc.get_codes()
        if isinstance(codes, str):
            code = codes
    elif hasattr(exc, "code") and exc.code:
        code = str(exc.code)

    if isinstance(exc, MemberHasAssignedTasksError):
        return Response(
            {
                "code": "member_has_assigned_tasks",
                "message": exc.default_detail,
                "assigned_task_count": exc.assigned_count,
                "filter_url": exc.filter_url,
                "fields": {},
            },
            status=status.HTTP_409_CONFLICT,
        )

    if isinstance(exc, NotAuthenticated):
        code = "not_authenticated"
        message = "Authentication credentials were not provided."
        fields = {}
    elif isinstance(exc, AuthenticationFailed):
        code = "invalid_credentials"
        message = str(exc.detail) if isinstance(exc.detail, str) else "Invalid credentials."
        fields = {}
    elif isinstance(exc, PermissionDenied):
        code = "forbidden"
        message = str(exc.detail) if isinstance(exc.detail, str) else "You do not have permission to perform this action."
        fields = {}
    elif isinstance(exc, NotFound):
        code = "not_found"
        message = str(exc.detail) if isinstance(exc.detail, str) else "Resource not found."
        fields = {}
    elif isinstance(exc, ValidationError):
        code = "invalid_field"
        message = "Validation error."
        fields = {}
        if isinstance(data, dict):
            for k, v in data.items():
                if k in ("non_field_errors", "message", "detail"):
                    if isinstance(v, list) and v:
                        message = str(v[0])
                    elif isinstance(v, str):
                        message = v
                else:
                    fields[k] = [str(item) for item in v] if isinstance(v, list) else [str(v)]
            if message == "Validation error." and fields:
                first_k = next(iter(fields))
                first_msg = fields[first_k][0] if fields[first_k] else "Invalid input."
                message = first_msg
        elif isinstance(data, list):
            message = str(data[0]) if data else "Validation error."
    else:
        message = str(exc.detail) if hasattr(exc, "detail") and isinstance(exc.detail, str) else "An error occurred."
        fields = {}

    return Response(
        {
            "code": code,
            "message": message,
            "fields": fields,
        },
        status=response.status_code,
    )
