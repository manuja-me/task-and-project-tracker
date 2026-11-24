import { ApiErrorPayload } from "./types";

export class ApiError extends Error {
  status: number;
  data: ApiErrorPayload;
  resourceVersion?: number;

  constructor(status: number, data: ApiErrorPayload, resourceVersion?: number) {
    super(data.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.resourceVersion = resourceVersion;
  }
}

export function getCsrfToken(): string | null {
  const match = document.cookie.match(/(^|;)\s*csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[2]) : null;
}

interface RequestOptions extends RequestInit {
  expectedVersion?: number;
}

export interface ApiResponse<T> {
  data: T;
  resourceVersion?: number;
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const url = endpoint.startsWith("/") ? `/api/v1${endpoint}` : `/api/v1/${endpoint}`;
  const headers = new Headers(options.headers || {});

  headers.set("Accept", "application/json");

  if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRFToken", csrfToken);
    }
  }

  if (options.expectedVersion !== undefined) {
    headers.set("X-Expected-Version", options.expectedVersion.toString());
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  const resourceVersionHeader = response.headers.get("X-Resource-Version");
  const resourceVersion = resourceVersionHeader ? parseInt(resourceVersionHeader, 10) : undefined;

  if (response.status === 204) {
    return { data: null as unknown as T, resourceVersion };
  }

  let data: any = null;
  const contentType = response.headers.get("Content-Type");
  if (contentType && contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorPayload: ApiErrorPayload = data || {
      code: "http_error",
      message: response.statusText || `HTTP ${response.status}`,
    };
    throw new ApiError(response.status, errorPayload, resourceVersion);
  }

  return { data, resourceVersion };
}
