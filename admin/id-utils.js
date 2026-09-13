export function generateIdFromName(name) {
  const raw =
    typeof name === 'string'
      ? name.trim()
      : '';

  if (!raw) {
    return '';
  }

  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}