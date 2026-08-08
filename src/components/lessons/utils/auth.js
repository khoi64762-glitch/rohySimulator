// auth utils — shim for LAILA-v3 client/src/utils/auth.ts. LAILA stores a JWT
// in localStorage and sends it as a Bearer header; rohy does the same for
// legacy bearer-mode tabs (src/services/authService.js keeps it under the
// 'token' key), while cookie-mode tabs have no token and authenticate via the
// HttpOnly rohy_auth cookie + the X-CSRF-Token double-submit header instead.
// Same exported surface so copied callers work unchanged.
export const getAuthToken = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  } catch {
    return null;
  }
};

export const isAuthenticated = () => true;

export const getAuthHeaders = () => {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
