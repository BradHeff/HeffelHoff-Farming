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
    highlightColor = null,   // when set, enables setHighlighted(true)
    rounded = false,          // round the border corners (looks like a pill)
    cornerRadius = 0.28,      // fraction of min(width,depth) for rounded mode
  } = {}) {
    this.width = width;
    this.depth = depth;
    this.label = label;
    this._rounded = rounded;
    this._cornerRadius = cornerRadius;

    // Pixel resolution scales with dims for consistent line thickness
    const pxPerUnit = 160;
    const w = Math.max(128, Math.round(width * pxPerUnit));
    const h = Math.max(128, Math.round(depth * pxPerUnit));
    this._w = w; this._h = h;
    this._pxPerUnit = pxPerUnit;
    this._color = color;
    this._textColor = textColor;
    this._dashSpacing = dashSpacing;
    this._textSize = textSize;
    this._icon = icon;
    this._highlightColor = highlightColor;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._paint(false);

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
    this._highlighted = false;
  }

  _paint(highlighted) {
    const ctx = this._ctx;
    const w = this._w, h = this._h;
    ctx.clearRect(0, 0, w, h);

    const roundedRectPath = (x, y, rw, rh, r) => {
      const rr = Math.min(r, rw / 2, rh / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + rw - rr, y);
      ctx.quadraticCurveTo(x + rw, y, x + rw, y + rr);
      ctx.lineTo(x + rw, y + rh - rr);
      ctx.quadraticCurveTo(x + rw, y + rh, x + rw - rr, y + rh);
      ctx.lineTo(x + rr, y + rh);
      ctx.quadraticCurveTo(x, y + rh, x, y + rh - rr);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
      ctx.closePath();
    };

    const cornerR = this._rounded
      ? Math.round(Math.min(w, h) * this._cornerRadius)
      : 0;

    if (highlighted && this._highlightColor) {
      // Filled background tile with thick solid border — "active / step here"
      ctx.lineWidth = Math.max(18, Math.round(this._pxPerUnit * 0.1));
      const pad = ctx.lineWidth * 0.6;
      if (this._rounded) {
        roundedRectPath(pad, pad, w - pad * 2, h - pad * 2, cornerR);
        ctx.fillStyle = this._highlightColor + '55';
        ctx.fill();
        ctx.strokeStyle = this._highlightColor;
        ctx.stroke();
      } else {
        ctx.fillStyle = this._highlightColor + '55';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = this._highlightColor;
        ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
      }
    } else {
      ctx.lineWidth = Math.max(10, Math.round(this._pxPerUnit * 0.065));
      const pad = ctx.lineWidth * 0.75;
      if (this._rounded) {
        roundedRectPath(pad, pad, w - pad * 2, h - pad * 2, cornerR);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = this._color;
        ctx.setLineDash(this._dashSpacing);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = this._color;
        ctx.setLineDash(this._dashSpacing);
        ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
        ctx.setLineDash([]);
      }
    }

    // Label + icon — auto-shrink the font so the full string fits inside
    // the decal. Emojis count as wide glyphs, so a "HIRE" + emoji label at
    // the requested 120px would often spill past the canvas edge and show
    // as "Hir" etc. We step the font size down until it fits.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = (this._icon ? this._icon + ' ' : '') + (this.label || '');
    if (text) {
      const maxTextW = w * 0.82;
      const maxTextH = h * 0.70;
      let sz = this._textSize;
      ctx.font = `bold ${sz}px system-ui, sans-serif`;
      while (
        sz > 24 &&
        (ctx.measureText(text).width > maxTextW || sz > maxTextH)
      ) {
        sz = Math.max(24, sz - 6);
        ctx.font = `bold ${sz}px system-ui, sans-serif`;
      }
      ctx.lineWidth = Math.max(6, Math.round(sz * 0.08));
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = highlighted && this._highlightColor ? '#ffffff' : this._textColor;
      ctx.fillText(text, w / 2, h / 2);
    }
  }

  setHighlighted(v) {
    if (!!v === this._highlighted) return;
    this._highlighted = !!v;
    this._paint(this._highlighted);
    if (this._texture) this._texture.needsUpdate = true;
  }

  setPosition(x, z) { this.mesh.position.set(x, 0.05, z); }
  addTo(scene) { scene.add(this.mesh); }
  removeFrom(scene) { scene.remove(this.mesh); }

  // Gentle breathing so the tile catches the eye without being loud. When
  // highlighted the tile stays at full opacity so it reads as "active".
  update(dt) {
    this._t += dt;
    this._mat.opacity = this._highlighted
      ? 0.95
      : 0.82 + Math.sin(this._t * 2.6) * 0.15;
  }
}
