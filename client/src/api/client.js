// ─── Client API centralisé ─────────────────────────────────────────────────
// Préfixe l'URL de base de l'API + ajoute l'en-tête Bearer (token lu depuis
// localStorage, comme AuthContext). Retourne la Response brute : les call sites
// conservent VERBATIM leur gestion (res.ok, await res.json(), res.status, …).
//
// Détection FormData : si le body est un FormData, on ne fixe PAS Content-Type
// (le navigateur ajoute le boundary multipart) — sinon Content-Type JSON +
// JSON.stringify, reproduisant exactement les en-têtes manuels d'origine.
//
// Non couverts (volontaire) : les 3 endpoints qui émettent le token et
// n'envoient aucun Authorization (auth/login, auth/register,
// auth/reset-password) restent des fetch manuels dans AuthContext / LoginPage.
const API = `${import.meta.env.VITE_API_URL}/api`;

function authHeaders(base = {}) {
  const token = localStorage.getItem('dnd-token');
  return token ? { ...base, Authorization: `Bearer ${token}` } : { ...base };
}

export function apiGet(path) {
  return fetch(`${API}${path}`, { headers: authHeaders() });
}

export function apiDelete(path) {
  return fetch(`${API}${path}`, { method: 'DELETE', headers: authHeaders() });
}

function send(method, path, body) {
  const isForm = body instanceof FormData;
  return fetch(`${API}${path}`, {
    method,
    headers: isForm ? authHeaders() : authHeaders({ 'Content-Type': 'application/json' }),
    body: isForm ? body : JSON.stringify(body),
  });
}

export const apiPost = (path, body) => send('POST', path, body);
export const apiPut = (path, body) => send('PUT', path, body);
