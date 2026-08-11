export const CATEGORY_SEMANTICS_VERSION = 1;

const families = [
  {
    aliases: ['housing', 'vivienda', 'hogar'],
    semantics: 'English: permanent home, rent, utilities, and recurring household costs; not a temporary stay. Español: hogar permanente, alquiler, servicios y costos recurrentes; no alojamiento temporal.',
    examples: ['monthly rent / alquiler mensual', 'home electricity / electricidad del hogar'],
  },
  {
    aliases: ['lodging', 'alojamiento'],
    semantics: 'English: temporary stay such as a hotel or hostel; not permanent home costs. Español: estadía temporal como hotel u hostal; no costos del hogar permanente.',
    examples: ['hotel stay / estadía de hotel', 'hostel / hostal'],
  },
  {
    aliases: ['investments', 'inversiones'],
    semantics: 'English: financial assets such as stocks or funds; not goods bought for use. Español: activos financieros como acciones o fondos; no bienes comprados para uso.',
    examples: ['index fund / fondo índice', 'stocks / acciones'],
  },
  {
    aliases: ['shopping', 'compras'],
    semantics: 'English: goods purchased for personal use; not a financial asset. Español: bienes comprados para uso personal; no activos financieros.',
    examples: ['clothes / ropa', 'household goods / artículos del hogar'],
  },
  {
    aliases: ['food', 'comida', 'alimentación'],
    semantics: 'English: groceries, meals, and food. Español: supermercado, comidas y alimentación.',
    examples: ['groceries / supermercado', 'lunch / almuerzo'],
  },
  {
    aliases: ['transport', 'transporte'],
    semantics: 'English: local transport and commuting. Español: transporte local y viajes cotidianos.',
    examples: ['bus / colectivo', 'taxi / taxi'],
  },
  {
    aliases: ['travel', 'viajes'],
    semantics: 'English: travel costs and trips. Español: costos de viaje y viajes.',
    examples: ['flight / vuelo', 'trip / viaje'],
  },
];

const catalog = new Map(families.flatMap((family) =>
  family.aliases.map((alias) => [alias, Object.freeze({
    semantics: family.semantics,
    examples: Object.freeze([...family.examples]),
  })]),
));

export function normalizeCategoryAlias(name) {
  if (typeof name !== 'string') throw new TypeError('Category name must be a string.');
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function buildCategoryGuidance(budgets) {
  return budgets.map(({ name }) => {
    const semantic = catalog.get(normalizeCategoryAlias(name));
    return semantic ? { name, semantics: semantic.semantics, examples: [...semantic.examples] } : { name };
  });
}
