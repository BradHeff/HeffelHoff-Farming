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

  ctx.fillStyle = '#ffcf87';
  ctx.fillRect(0, 0, W, H);

  const cx = W * 0.5;
  const cy = H * 0.55;

  // Softer, punchier pink blush with bigger radius for the anime "cheeks" look
  const blush = (x, y) => {
    ctx.save();
    ctx.globalAlpha = 0.72;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, 34);
    grad.addColorStop(0, '#ff7e99');
    grad.addColorStop(0.65, '#ff9ab0aa');
    grad.addColorStop(1, '#ff9aa800');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  blush(cx - 52, cy + 22);
  blush(cx + 52, cy + 22);

  // Anime eyes — bigger, oval with colored iris, double highlight sparkle,
  // dark upper lash line. Much more expressive than the previous black dots.
  const drawEye = (x, y, style) => {
    if (style === 'closed') {
      ctx.strokeStyle = '#2a1a12';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 18, y);
      ctx.quadraticCurveTo(x, y + 13, x + 18, y);
      ctx.stroke();
      return;
    }
    // Eye white
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, y, 13, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Iris — warm brown
    ctx.fillStyle = '#5a3a1e';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 10, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    // Inner pupil
    ctx.fillStyle = '#1a1208';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // Big highlight sparkle (upper-left) + small secondary (lower-right)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 3, y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 4, y + 6, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Upper lash line — thick dark arc for anime emphasis
    ctx.strokeStyle = '#1a1208';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y + 2, 14, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    // Eyelash flicks at outer corner
    ctx.beginPath();
    ctx.moveTo(x + 13, y - 6);
    ctx.lineTo(x + 18, y - 12);
    ctx.stroke();
  };

  const leftStyle = (variant === 'happy') ? 'closed' : 'open';
  const rightStyle = (variant === 'wink' || variant === 'happy') ? 'closed' : 'open';
  drawEye(cx - 26, cy - 2, leftStyle);
  drawEye(cx + 26, cy - 2, rightStyle);

  // Eyebrows — softer, angled up at outer edges for "sweet" anime read
  ctx.strokeStyle = '#3a2010';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 38, cy - 24);
  ctx.quadraticCurveTo(cx - 26, cy - 30, cx - 14, cy - 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 14, cy - 26);
  ctx.quadraticCurveTo(cx + 26, cy - 30, cx + 38, cy - 24);
  ctx.stroke();

  // Mouth — smaller heart-ish shape (typical chibi) with soft coral color
  const mouthY = cy + 38;
  ctx.strokeStyle = '#c84a3a';
  ctx.fillStyle = '#c84a3a';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (variant === 'content') {
    ctx.moveTo(cx - 6, mouthY);
    ctx.lineTo(cx + 6, mouthY);
    ctx.stroke();
  } else if (variant === 'happy') {
    // Big open smile (filled crescent)
    ctx.beginPath();
    ctx.moveTo(cx - 12, mouthY - 2);
    ctx.quadraticCurveTo(cx, mouthY + 12, cx + 12, mouthY - 2);
    ctx.quadraticCurveTo(cx, mouthY + 6, cx - 12, mouthY - 2);
    ctx.fill();
  } else {
    // Small gentle smile with bottom lip dot
    ctx.beginPath();
    ctx.moveTo(cx - 9, mouthY - 2);
    ctx.quadraticCurveTo(cx, mouthY + 6, cx + 9, mouthY - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, mouthY + 3, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Nose — tiny dot / shadow (kept small, anime style barely suggests a nose)
  ctx.fillStyle = '#d8a56f';
  ctx.beginPath();
  ctx.arc(cx, cy + 16, 1.5, 0, Math.PI * 2);
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
