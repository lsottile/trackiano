export const MAX_TELEGRAM_MESSAGE_UTF16 = 4096;
export const LOW_CONFIDENCE_HEADER = 'No pude elegir una categoría con seguridad. Reenviá una de estas opciones:';
export const GENERIC_SAFE_CATEGORY_RESPONSE =
  'No pude inferir la categoría con seguridad. Mandalo como: description amount category';

export function buildLowConfidenceReply({ originalText, candidates }) {
  const seen = new Set();
  const choices = [];
  for (const candidate of candidates ?? []) {
    if (!candidate?.budgetId || typeof candidate.categoryName !== 'string' || seen.has(candidate.budgetId)) continue;
    seen.add(candidate.budgetId);
    choices.push(candidate.categoryName);
    if (choices.length === 3) break;
  }
  if (choices.length < 2) return GENERIC_SAFE_CATEGORY_RESPONSE;
  const input = originalText.trim();
  const reply = `${LOW_CONFIDENCE_HEADER}\n${choices.map((name) => `• ${input} ${name}`).join('\n')}`;
  return reply.length <= MAX_TELEGRAM_MESSAGE_UTF16 ? reply : GENERIC_SAFE_CATEGORY_RESPONSE;
}
