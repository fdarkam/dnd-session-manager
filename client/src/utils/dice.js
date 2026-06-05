// Parse "NdX+M" → { count, sides, modifier } — retourne null si invalide
export function parseDice(expr) {
  const match = expr.trim().match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  return {
    count:    parseInt(match[1]) || 1,
    sides:    parseInt(match[2]),
    modifier: parseInt(match[3]) || 0,
  };
}

// Lancer les dés d'une expression et retourner le résultat brut
export function rollFromExpr(expr) {
  const parsed = parseDice(expr);
  if (!parsed) return null;
  const results = Array.from({ length: parsed.count }, () =>
    Math.floor(Math.random() * parsed.sides) + 1
  );
  const total = results.reduce((a, b) => a + b, 0) + parsed.modifier;
  return { expression: expr.trim(), results, total };
}
