import * as THREE from 'three';

// Generate a CanvasTexture painted with a cute chibi face (eyes, mouth,
// cheeks, eyebrows). Every character uses the same face texture variant —
// the texture is reused across many heads, no per-head allocation.
//
// `variant` picks the expression style:
//   'default' — smile + pink cheeks (customers, helpers)
//   'happy'   — big closed-eye smile (shopkeeper)
//   'wink'    — one eye winking (ambient wanderers)
//   'content' — calm eyes, faint smile (workers)
//
// The texture wraps the sphere with the face centered on the front (+Z).
// Two tricks to make it read as a face:
//   1. Full-dome skin-color background so it blends with the head material
//   2. Face features concentrated near u=0.5, v=0.5 (sphere front)
export function makeFaceTexture(variant = 'default') {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Skin base — same color as head MeshLambertMaterial so seams don't show
  ctx.fillStyle = '#ffcf87';
  ctx.fillRect(0, 0, W, H);

  // The sphere UV puts the equator at v=0.5, so face features sit here.
  // Front of sphere is approx u=0.25..0.75 (or 0.5 ± 0.25).
  // Scale all positions to the canvas:
  const cx = W * 0.5; // front center
  const cy = H * 0.55; // slightly below equator, like actual eye level

  // Blush circles (soft pink)
  const blush = (x, y) => {
    ctx.save();
    ctx.globalAlpha = 0.55;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, 28);
    grad.addColorStop(0, '#ff9aa8');
    grad.addColorStop(1, '#ff9aa800');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  blush(cx - 46, cy + 18);
  blush(cx + 46, cy + 18);

  // Eyes
  const drawEye = (x, y, style) => {
    if (style === 'closed') {
      ctx.strokeStyle = '#2a1a12';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 14, y);
      ctx.quadraticCurveTo(x, y + 10, x + 14, y);
      ctx.stroke();
      return;
    }
    // Solid eye with highlight
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(x, y, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shine
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 3, y - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 3, y + 4, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };

  const leftStyle = (variant === 'happy') ? 'closed' : 'open';
  const rightStyle = (variant === 'wink' || variant === 'happy') ? 'closed' : 'open';
  drawEye(cx - 22, cy, leftStyle);
  drawEye(cx + 22, cy, rightStyle);

  // Eyebrows — small dark arcs above eyes
  ctx.strokeStyle = '#4a2a15';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 32, cy - 22);
  ctx.quadraticCurveTo(cx - 22, cy - 26, cx - 12, cy - 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 12, cy - 22);
  ctx.quadraticCurveTo(cx + 22, cy - 26, cx + 32, cy - 22);
  ctx.stroke();

  // Mouth
  const mouthY = cy + 38;
  ctx.strokeStyle = '#6a2820';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (variant === 'content') {
    ctx.moveTo(cx - 9, mouthY);
    ctx.lineTo(cx + 9, mouthY);
  } else {
    // Smile
    ctx.moveTo(cx - 14, mouthY - 2);
    ctx.quadraticCurveTo(cx, mouthY + 8, cx + 14, mouthY - 2);
  }
  ctx.stroke();

  // Nose — tiny dot / shadow
  ctx.fillStyle = '#d8a56f';
  ctx.beginPath();
  ctx.arc(cx, cy + 14, 1.8, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Materials keyed by expression variant — each material is created once and
// shared across every head using that expression.
const _faceMats = new Map();
export function getFaceMaterial(variant = 'default') {
  if (_faceMats.has(variant)) return _faceMats.get(variant);
  const tex = makeFaceTexture(variant);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  _faceMats.set(variant, mat);
  return mat;
}
