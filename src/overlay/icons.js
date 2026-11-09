// Icon set. 24x24 grid, drawn with strokes unless a shape says fill.
// Add an icon by adding its inner SVG markup here, then refer to it by name.

const F = 'fill="currentColor" stroke="none"';

const ICONS = {
  play: `<path ${F} d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z"/>`,
  pause: `<rect ${F} x="6" y="5" width="4.4" height="14" rx="1.3"/><rect ${F} x="13.6" y="5" width="4.4" height="14" rx="1.3"/>`,
  replay: `<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4.2h4.2"/>`,
  volume: `<path ${F} d="M3.5 9.6v4.8a.6.6 0 0 0 .6.6h2.7l4 3.4a.7.7 0 0 0 1.2-.5V6.1a.7.7 0 0 0-1.2-.5L6.8 9H4.1a.6.6 0 0 0-.6.6z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
  volumeLow: `<path ${F} d="M3.5 9.6v4.8a.6.6 0 0 0 .6.6h2.7l4 3.4a.7.7 0 0 0 1.2-.5V6.1a.7.7 0 0 0-1.2-.5L6.8 9H4.1a.6.6 0 0 0-.6.6z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/>`,
  mute: `<path ${F} d="M3.5 9.6v4.8a.6.6 0 0 0 .6.6h2.7l4 3.4a.7.7 0 0 0 1.2-.5V6.1a.7.7 0 0 0-1.2-.5L6.8 9H4.1a.6.6 0 0 0-.6.6z"/><path d="M15.8 9.6l4.8 4.8M20.6 9.6l-4.8 4.8"/>`,
  captions: `<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="M10.3 10.7a2 2 0 1 0 0 2.6M16.6 10.7a2 2 0 1 0 0 2.6"/>`,
  chat: `<path d="M5.4 5h13.2A2.4 2.4 0 0 1 21 7.4v7.2a2.4 2.4 0 0 1-2.4 2.4h-6.3L8 20.4V17H5.4A2.4 2.4 0 0 1 3 14.6V7.4A2.4 2.4 0 0 1 5.4 5z"/>`,
  settings: `<path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="15" cy="7.5" r="2.4"/><circle cx="9" cy="16.5" r="2.4"/>`,
  fullscreen: `<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/>`,
  fullscreenExit: `<path d="M9 4v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M15 20v-3a2 2 0 0 1 2-2h3M4 15h3a2 2 0 0 1 2 2v3"/>`,
  pin: `<path d="M9.2 4h5.6l-.8 5.6 2.8 2.9v1.7H7.2v-1.7L10 9.6 9.2 4z"/><path d="M12 14.2V20"/>`,
  pinOn: `<path ${F} d="M9.2 3.2h5.6a.8.8 0 0 1 .8.9l-.75 5.2 2.5 2.6a.8.8 0 0 1 .25.6v1.7a.8.8 0 0 1-.8.8H7.2a.8.8 0 0 1-.8-.8v-1.7a.8.8 0 0 1 .25-.6l2.5-2.6-.75-5.2a.8.8 0 0 1 .8-.9z"/><path d="M12 15v5"/>`,
  minimize: `<path d="M6.5 12h11"/>`,
  maximize: `<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="1.8"/>`,
  restore: `<rect x="5.6" y="8.4" width="10" height="10" rx="1.6"/><path d="M8.6 8.2V7.4a1.8 1.8 0 0 1 1.8-1.8h6.2a1.8 1.8 0 0 1 1.8 1.8v6.2a1.8 1.8 0 0 1-1.8 1.8h-.8"/>`,
  close: `<path d="M6.8 6.8l10.4 10.4M17.2 6.8L6.8 17.2"/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13"/>`,
  link: `<path d="M10.2 13.8a4 4 0 0 0 5.66 0l2.9-2.9a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M13.8 10.2a4 4 0 0 0-5.66 0l-2.9 2.9a4 4 0 0 0 5.66 5.66l1-1"/>`,
  history: `<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4.2h4.2"/><path d="M12 8.2v4.2l2.7 1.7"/>`,
  user: `<circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 19.6a7.2 7.2 0 0 1 14.4 0"/>`,
  arrowLeft: `<path d="M18.5 12h-13M11 6.5 5.5 12l5.5 5.5"/>`,
  check: `<path d="M5.5 12.6l4.2 4.2 8.8-9.3"/>`,
  chevron: `<path d="M9.5 6.5L15 12l-5.5 5.5"/>`,
  back: `<path d="M14.5 6.5L9 12l5.5 5.5"/>`,
  forward10: `<path d="M19.5 12A7.5 7.5 0 1 1 17 6.4"/><path d="M19.5 4.5v4.2h-4.2"/>`,
  back10: `<path d="M4.5 12A7.5 7.5 0 1 0 7 6.4"/><path d="M4.5 4.5v4.2h4.2"/>`,
  speed: `<path d="M5 17a8 8 0 1 1 14 0"/><path d="M12 13l3.6-4.2"/><circle ${F} cx="12" cy="13" r="1.3"/>`,
  arrow: `<path d="M5.5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>`,
  mark: `<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="3.6"/><path ${F} d="M10 9.1v5.8a.6.6 0 0 0 .92.5l4.5-2.9a.6.6 0 0 0 0-1L10.92 8.6a.6.6 0 0 0-.92.5z"/>`,
};

/** @returns {SVGSVGElement} */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}
