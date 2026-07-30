/*
 * tweakTreeSvg — restyle tnaj's plotTree (horizontal) SVG output to:
 *   1. node radius strictly proportional to frequency (count),
 *   2. node fill-opacity (colour density) proportional to frequency,
 *   3. labels centered BELOW each node instead of to its right.
 * tnaj still computes and lays out the tree; this only rewrites the emitted
 * node markup, so no layout/algorithm is reinvented.
 *
 * Matches tnaj's horizontal node template:
 *   <g><circle cx cy r fill stroke stroke-width><title>… · n=N · …</title>
 *   </circle><text class="tt-text tt-small" x y>label</text></g>
 */
const NODE_RE = /<g><circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill="([^"]+)" stroke="([^"]+)" stroke-width="([\d.]+)"><title>([^<]*)<\/title><\/circle>(?:<text class="tt-text tt-small" x="[-\d.]+" y="[-\d.]+">([^<]*)<\/text>)?<\/g>/g;

function countFromTitle(title: string): number {
  const m = /n=([\d,]+)/.exec(title);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

export function tweakTreeSvg(svg: string): string {
  if (typeof svg !== 'string' || !svg) return svg;

  // Pass 1 — max count for normalization.
  let maxN = 1;
  for (const m of svg.matchAll(NODE_RE)) maxN = Math.max(maxN, countFromTitle(m[7]));

  // Pass 2 — rewrite each node: proportional radius + opacity, label below.
  return svg.replace(NODE_RE, (_full, cx, cy, _r0, fill, stroke, sw, title, label) => {
    const n = countFromTitle(title);
    const frac = Math.max(0, Math.min(1, n / maxN));
    const r = 3 + 12 * frac;                 // strictly proportional size
    const opacity = 0.22 + 0.78 * frac;      // proportional colour density
    const circle = `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="${fill}" fill-opacity="${opacity.toFixed(3)}" stroke="${stroke}" stroke-width="${sw}"><title>${title}</title></circle>`;
    const text = label
      ? `<text class="tt-text tt-small" x="${cx}" y="${(parseFloat(cy) + r + 11).toFixed(2)}" text-anchor="middle">${label}</text>`
      : '';
    return `<g>${circle}${text}</g>`;
  });
}
