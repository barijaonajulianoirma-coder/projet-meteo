/** Helpers de téléchargement réservés au navigateur. */

export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Exporte un graphique Recharts (SVG) en PNG, sans service externe. */
export async function downloadSvgAsPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    text { font-family: Inter, system-ui, sans-serif; font-size: 12px; fill: #334155; }
    .recharts-cartesian-axis-line, .recharts-cartesian-axis-tick-line { stroke: #cbd5e1; }
    .recharts-cartesian-grid line { stroke: #e2e8f0; }
  `;
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.width = width;
    image.height = height;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Impossible de convertir le graphique en image.'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas indisponible dans ce navigateur.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
