export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const CURSOR_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399']; //mettre en random les couleurs
export const userColor = (id) => CURSOR_COLORS[Math.abs((id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % CURSOR_COLORS.length];

// Radius de vision du fog automatique (en nombre de cases de grille)
export const VISION_NORMAL   = 3; // tous les tokens joueurs non cachés
export const VISION_ENHANCED = 6; // tokens avec nightVision: true (vision nocturne étendue)
