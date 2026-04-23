import * as THREE from 'three';

// Paints a flat ground decal with a dashed border, optional label text and
// optional icon glyph. Uses a CanvasTexture so styles can be changed freely
// without bundling image assets.
export class ZoneDecal {
  constructor({
    width = 4,
    depth = 3,
    label = '',
    icon = '',
    color = '#8fd1ff',
    textColor = 'rgba(255,255,255,0.95)',
    dashSpacing = [32, 22],
    textSize = 92,
  } = {}) {
    this.width = width;
    this.depth = depth;
    this.label = label;

    // Pixel resolution scales with dims for consistent line thickness
    const pxPerUnit = 160;
    const w = Math.max(128, Math.round(width * pxPerUnit));
    const h = Math.max(128, Math.round(depth * pxPerUnit));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Background subtle highlight
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, w, h);

    // Dashed border
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(10, Math.round(pxPerUnit * 0.065));
    ctx.setLineDash(dashSpacing);
    const pad = ctx.lineWidth * 0.75;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

    // Inner label/icon
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${textSize}px system-ui, sans-serif`;
    // outline + fill for high contrast on any ground color
    const text = (icon ? icon + ' ' : '') + (label || '');
    if (text) {
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = textColor;
      ctx.fillText(text, w / 2, h / 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(width, depth);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 0.06;
    this.mesh.renderOrder = 2;

    this._texture = texture;
    this._mat = mat;
    this._t = 0;
  }

  setPosition(x, z) { this.mesh.position.set(x, 0.05, z); }
  addTo(scene) { scene.add(this.mesh); }
  removeFrom(scene) { scene.remove(this.mesh); }

  // Gentle breathing so the tile catches the eye without being loud.
  update(dt) {
    this._t += dt;
    this._mat.opacity = 0.82 + Math.sin(this._t * 2.6) * 0.15;
  }
}
