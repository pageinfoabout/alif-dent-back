// Simple catalog used as a fallback when a service item lacks explicit name/price.
// Update ids/names/prices here to match your Supabase data if needed.
export const SERVICE_CATALOG = {
  'serv-ortho': { name: 'Ортодонтия', price: 0 },
  'serv-thera': { name: 'Терапия', price: 0 },
  'serv-plasti': { name: 'Пластика', price: 0 },
};

export function resolveServiceDisplay(service) {
  const byId = service?.id && SERVICE_CATALOG[service.id];
  const name = service?.name || service?.title || byId?.name || 'Услуга';
  const price = typeof service?.price === 'number' ? service.price : (byId?.price ?? 0);
  return { name, price };
}


