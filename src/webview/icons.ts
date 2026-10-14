export type IconFile = { id: string; mimeType: 'image/svg+xml'; dataURL: string; created: number };

export const ICONS: Record<string, string> = {
  client: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  api: '<path d="M8 4c-2 0-3 1-3 3v2c0 1-1 2-2 3 1 1 2 2 2 3v2c0 2 1 3 3 3"/><path d="M16 4c2 0 3 1 3 3v2c0 1 1 2 2 3-1 1-2 2-2 3v2c0 2-1 3-3 3"/>',
  worker: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  gateway: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cache: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  queue: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>',
  storage: '<path d="M4 7h16l-2 13H6z"/><ellipse cx="12" cy="7" rx="8" ry="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.4.6 4 2.3 4 5.2"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 11 3.5 3.5 0 0 1 18 18z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  container: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 9H3c0-1 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 4-6 3-12 4.5"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5L6.5 17M12 11.5L17.5 17"/>',
  loadbalancer: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  cdn: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.5 6.5C9 9 15 9 18.5 6.5M5.5 17.5C9 15 15 15 18.5 17.5"/>',
  firewall: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 9.3v5.3M9 14.6V20"/>',
  function: '<path d="M6 4h3l9 16M10 12l-5 8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  webhook: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><circle cx="12" cy="6" r="3"/><path d="M12 9l-4.5 5.5M9 17h6M12 9l4.5 5.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 16h5"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
  stream: '<path d="M3 7c3-3 6 3 9 0s6-3 9 0M3 13c3-3 6 3 9 0s6-3 9 0M3 19c3-3 6 3 9 0s6-3 9 0"/>',
  warehouse: '<path d="M3 10l9-6 9 6v10H3z"/><path d="M8 20v-6h8v6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  sms: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/>',
  bug: '<rect x="8" y="8" width="8" height="12" rx="4"/><path d="M12 8V5M9 4l3 3 3-3M4 13h4M16 13h4M5 19l3-2M19 19l-3-2M5 8l3 2M19 8l-3 2"/>',
  rocket: '<path d="M12 3c4 2 6 6 5 11l-3 3h-4l-3-3C6 9 8 5 12 3z"/><circle cx="12" cy="10" r="1.5"/><path d="M9 17l-3 4M15 17l3 4"/>',
  test: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  docs: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4h10.6L21 7H6"/>',
  pin: '<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="14" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
};

export const CATEGORIES: Record<string, string[]> = {
  Infrastructure: ['cloud', 'server', 'container', 'network', 'loadbalancer', 'cdn', 'firewall', 'cpu', 'layers', 'wifi', 'globe'],
  Data: ['db', 'table', 'cache', 'queue', 'stream', 'storage', 'warehouse', 'search', 'chart'],
  Application: ['client', 'mobile', 'browser', 'terminal', 'api', 'code', 'function', 'worker', 'webhook', 'clock', 'bot', 'gateway'],
  'People & security': ['user', 'users', 'lock', 'key', 'shield'],
  Messaging: ['mail', 'bell', 'sms', 'link', 'sync', 'download'],
  Developer: ['git', 'rocket', 'test', 'bug', 'file', 'docs', 'settings', 'eye'],
  Product: ['card', 'cart', 'home', 'pin', 'camera', 'image', 'video', 'mic'],
};

export const iconSvg = (name: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

export const toDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

export function iconFile(name: string, color: string): IconFile {
  return { id: `icon:${name}:${color}`, mimeType: 'image/svg+xml', dataURL: toDataUrl(iconSvg(name, color)), created: Date.now() };
}

export function importedSvgFile(name: string, raw: string): { file: IconFile; width: number; height: number } | null {
  const root = new DOMParser().parseFromString(raw, 'image/svg+xml').documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || root.querySelector('parsererror')) return null;
  root.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  const vb = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const num = (a: string | null) => (a && !a.endsWith('%') ? parseFloat(a) : NaN);
  const width = num(root.getAttribute('width')) || vb?.[2] || 96;
  const height = num(root.getAttribute('height')) || vb?.[3] || 96;
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!vb) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  const svg = new XMLSerializer().serializeToString(root);
  let h = 0;
  for (const ch of svg) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return { file: { id: `svg:${name}:${(h >>> 0).toString(36)}`, mimeType: 'image/svg+xml', dataURL: toDataUrl(svg), created: Date.now() }, width, height };
}
