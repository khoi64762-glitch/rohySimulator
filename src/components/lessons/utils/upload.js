import { apiUrl } from '../../../config/api';
import { getAuthToken } from './auth';

// Best-effort read of the rohy_csrf double-submit cookie (non-HttpOnly by
// design — see server/middleware/csrf.js). Cookie-mode clients must echo it
// back as X-CSRF-Token on every mutation or the server rejects with 403.
// Mirrors the inline readers in src/services/apiClient.js / authService.js.
const readCsrfToken = () => {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null;
    for (const pair of document.cookie.split(';')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      if (pair.slice(0, eq).trim() !== 'rohy_csrf') continue;
      const v = pair.slice(eq + 1).trim();
      try { return decodeURIComponent(v); } catch { return v; }
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Upload a single file via XHR to `endpoint` (an /api-relative path such as
 * '/uploads/image', resolved through apiUrl() so production base paths work),
 * reporting 0–100 progress through `onProgress`, and resolve to the stored
 * file's URL. Shared by the lesson and course editors so upload/auth/response
 * handling lives in one place.
 * Rejects on non-2xx, network error, or a 2xx response with no url/path.
 */
export const uploadWithProgress = (
  endpoint,
  file,
  onProgress,
) =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const token = getAuthToken();
    const csrf = readCsrfToken();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(endpoint));
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const j = JSON.parse(xhr.responseText);
          const d = j.data || j;
          const url = d.url || d.path;
          if (url) resolve(url);
          else reject(new Error('upload response missing url'));
        } catch {
          reject(new Error('bad upload response'));
        }
      } else {
        // Surface the server's { error } message when it sent one.
        let message = 'upload failed';
        try {
          const j = JSON.parse(xhr.responseText);
          if (j && typeof j.error === 'string' && j.error) message = j.error;
        } catch { /* keep the generic message */ }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(form);
  });
