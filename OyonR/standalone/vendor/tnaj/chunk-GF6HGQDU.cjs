'use strict';

// src/core/networkDrawing.ts
function networkEdgeGeometry(sx, sy, tx, ty, sourceRadius, targetRadius = sourceRadius, curvature = 0, arrowLength = 8) {
  const dx = tx - sx, dy = ty - sy;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    return { path: "", tipX: tx, tipY: ty, tipDx: 0, tipDy: -1, labelX: sx, labelY: sy };
  }
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const mx = (sx + tx) / 2 + px * curvature;
  const my = (sy + ty) / 2 + py * curvature;
  const sdx = mx - sx, sdy = my - sy, slen = Math.hypot(sdx, sdy) || 1;
  const startX = sx + sdx / slen * sourceRadius;
  const startY = sy + sdy / slen * sourceRadius;
  const edx = tx - mx, edy = ty - my, elen = Math.hypot(edx, edy) || 1;
  const eux = edx / elen, euy = edy / elen;
  const tipX = tx - eux * targetRadius;
  const tipY = ty - euy * targetRadius;
  const endX = tx - eux * (targetRadius + arrowLength);
  const endY = ty - euy * (targetRadius + arrowLength);
  const t = 0.55;
  const labelX = (1 - t) ** 2 * startX + 2 * (1 - t) * t * mx + t ** 2 * endX;
  const labelY = (1 - t) ** 2 * startY + 2 * (1 - t) * t * my + t ** 2 * endY;
  return {
    path: curvature === 0 ? `M${startX},${startY} L${endX},${endY}` : `M${startX},${startY} Q${mx},${my} ${endX},${endY}`,
    tipX,
    tipY,
    tipDx: eux,
    tipDy: euy,
    labelX,
    labelY
  };
}
function networkArrowPolygon(tipX, tipY, dx, dy, length = 7, halfWidth = 3.5) {
  const baseX = tipX - dx * length, baseY = tipY - dy * length;
  const lx = baseX - dy * halfWidth, ly = baseY + dx * halfWidth;
  const rx = baseX + dy * halfWidth, ry = baseY - dx * halfWidth;
  return `${tipX},${tipY} ${lx},${ly} ${rx},${ry}`;
}
function networkSelfLoopGeometry(x, y, nodeRadius, outwardAngle, reach = nodeRadius * 1.15) {
  const alpha = 0.66;
  const rotate = (angle) => ({ x: Math.cos(angle), y: Math.sin(angle) });
  const a = rotate(outwardAngle + alpha), b = rotate(outwardAngle - alpha);
  const x1 = x + a.x * nodeRadius, y1 = y + a.y * nodeRadius;
  const x2 = x + b.x * nodeRadius, y2 = y + b.y * nodeRadius;
  const c1x = x1 + a.x * reach, c1y = y1 + a.y * reach;
  const c2x = x2 + b.x * reach, c2y = y2 + b.y * reach;
  const tangentX = x2 - c2x, tangentY = y2 - c2y;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  return {
    path: `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`,
    tipX: x2,
    tipY: y2,
    tipDx: tangentX / tangentLength,
    tipDy: tangentY / tangentLength,
    labelX: x + Math.cos(outwardAngle) * (nodeRadius + reach + 9),
    labelY: y + Math.sin(outwardAngle) * (nodeRadius + reach + 9)
  };
}

exports.networkArrowPolygon = networkArrowPolygon;
exports.networkEdgeGeometry = networkEdgeGeometry;
exports.networkSelfLoopGeometry = networkSelfLoopGeometry;
//# sourceMappingURL=chunk-GF6HGQDU.cjs.map
//# sourceMappingURL=chunk-GF6HGQDU.cjs.map