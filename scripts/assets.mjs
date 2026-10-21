import { escapeXml, shapes } from "./catalog.mjs";

export function spriteSvg(icons, defaults) {
  const attributes = `fill="none" stroke="currentColor" stroke-width="${(defaults.strokeWidth * 64) / 24}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg"><defs>${icons
    .map(
      (icon) =>
        `<symbol id="${icon.slug}" viewBox="0 0 64 64" ${attributes}>${shapes(icon.nodes)}</symbol>`,
    )
    .join("")}</defs></svg>`;
}

export function sheetSvg(icons, sheet) {
  const { iconSize, strokeWidth, color, background } = sheet;
  const cellWidth = Math.max(160, iconSize + 32);
  const cellHeight = iconSize + 64;
  const width = cellWidth * 5;
  const height = cellHeight * Math.ceil(icons.length / 5);
  const attributes = `fill="none" stroke="currentColor" stroke-width="${(strokeWidth * 64) / iconSize}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color="${escapeXml(color)}"><rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>${icons
    .map((icon, index) => {
      const x = (index % 5) * cellWidth;
      const y = Math.floor(index / 5) * cellHeight;
      return `<svg x="${x + (cellWidth - iconSize) / 2}" y="${y + 12}" width="${iconSize}" height="${iconSize}" viewBox="0 0 64 64" ${attributes}>${shapes(icon.nodes)}</svg><text x="${x + cellWidth / 2}" y="${y + iconSize + 36}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="currentColor">${index + 1}. ${escapeXml(icon.slug)}</text>`;
    })
    .join("")}</svg>`;
}
