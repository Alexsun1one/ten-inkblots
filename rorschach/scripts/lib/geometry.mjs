// Where a drawn shape sits on a plate, measured against the plate's ink mask.
// Shapes are lists of [x, y] in the plate frame, so rotation and zoom never affect the result.
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const round3 = v => +v.toFixed(3);
export const normDeg = d => +((((d % 360) + 360) % 360).toFixed(1)) % 360;
export const isClosed = pts => pts.length > 8 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], (pts[0][1] - pts[pts.length - 1][1]) / 1.44) < .07;

export function geometry(PLATES, card, shapes, rotation = 0) {
  const plate = PLATES.plates[card], { gridW, gridH } = PLATES;
  const bits = Buffer.from(plate.ink, 'base64');
  let inside = 0, ink = 0;
  for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
    const x = (gx + .5) / gridW, y = (gy + .5) / gridH;
    if (!shapes.some(pts => inPoly(x, y, pts))) continue;
    inside++;
    const i = gy * gridW + gx;
    if (bits[i >> 3] & (1 << (i & 7))) ink++;
  }
  const all = shapes.flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round3);
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const coverage = ink / plate.inkCells, purity = inside ? ink / inside : 0;
  let near = null, best = Infinity;
  for (const [name, [x, y, rx, ry]] of Object.entries(plate.regions)) {
    if (name === 'whole') continue;
    const d = Math.hypot((cx - x) / (rx + .04), (cy - y) / (ry + .04));
    if (d < best) { best = d; near = name; }
  }
  return {
    box,
    inkCoverage: round3(coverage),
    areaFraction: round3(inside / (gridW * gridH)),
    inkPurity: round3(purity),
    locationHint: coverage >= .8 ? 'W' : (inside && purity < .3) ? 'S' : coverage >= .045 ? 'D' : 'Dd',
    nearRegion: best < 1.6 ? near : null,
    closed: shapes.every(isClosed),
    rotation: normDeg(rotation),
  };
}
