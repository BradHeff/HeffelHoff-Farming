// Virtual joystick for touch + WASD / arrow keys for desktop testing.
// Output: `value.x`, `value.y` in [-1, 1], y = 1 means "up / forward".

export class InputManager {
  constructor(zoneEl) {
    this.value = { x: 0, y: 0 };
    this.keys = { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false };

    this._initJoystick(zoneEl);
    this._initKeyboard();
  }

  _initJoystick(zone) {
    const pad = document.createElement('div');
    const stick = document.createElement('div');
    Object.assign(pad.style, {
      position: 'absolute', left: '50%', top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '140px', height: '140px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.25)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      pointerEvents: 'none',
    });
    Object.assign(stick.style, {
      position: 'absolute', left: '50%', top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '64px', height: '64px',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 30%, #fff, #b9cad2 70%, #8aa0a8)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
    });
    zone.appendChild(pad);
    zone.appendChild(stick);

    this.zone = zone;
    this.pad = pad;
    this.stick = stick;
    this.activeTouchId = null;
    this.origin = { x: 0, y: 0 };

    const getRect = () => zone.getBoundingClientRect();
    const radius = 60; // max travel of stick in px

    const start = (clientX, clientY, id) => {
      this.activeTouchId = id;
      const r = getRect();
      this.origin.x = r.left + r.width / 2;
      this.origin.y = r.top + r.height / 2;
      move(clientX, clientY);
    };
    const move = (clientX, clientY) => {
      const dx = clientX - this.origin.x;
      const dy = clientY - this.origin.y;
      const mag = Math.hypot(dx, dy);
      const clamped = Math.min(mag, radius);
      const angle = Math.atan2(dy, dx);
      const cx = Math.cos(angle) * clamped;
      const cy = Math.sin(angle) * clamped;
      stick.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
      // Convert to normalized, y up = positive
      this.value.x = cx / radius;
      this.value.y = -cy / radius;
    };
    const end = () => {
      this.activeTouchId = null;
      stick.style.transform = 'translate(-50%,-50%)';
      this.value.x = 0;
      this.value.y = 0;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      start(t.clientX, t.clientY, t.identifier);
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.activeTouchId) {
          move(t.clientX, t.clientY);
          break;
        }
      }
    }, { passive: false });

    const endHandler = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.activeTouchId) { end(); break; }
      }
    };
    zone.addEventListener('touchend', endHandler);
    zone.addEventListener('touchcancel', endHandler);

    // Mouse fallback for desktop
    let mouseDown = false;
    zone.addEventListener('mousedown', (e) => {
      mouseDown = true;
      start(e.clientX, e.clientY, 'mouse');
    });
    window.addEventListener('mousemove', (e) => { if (mouseDown) move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; end(); } });
  }

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') this.keys.up = true;
      else if (k === 's' || k === 'arrowdown') this.keys.down = true;
      else if (k === 'a' || k === 'arrowleft') this.keys.left = true;
      else if (k === 'd' || k === 'arrowright') this.keys.right = true;
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') this.keys.up = false;
      else if (k === 's' || k === 'arrowdown') this.keys.down = false;
      else if (k === 'a' || k === 'arrowleft') this.keys.left = false;
      else if (k === 'd' || k === 'arrowright') this.keys.right = false;
    });
  }

  // Merge keyboard and joystick. Keyboard wins if any key is pressed.
  getMove() {
    let kx = 0, ky = 0;
    if (this.keys.up) ky += 1;
    if (this.keys.down) ky -= 1;
    if (this.keys.right) kx += 1;
    if (this.keys.left) kx -= 1;
    if (kx !== 0 || ky !== 0) {
      const mag = Math.hypot(kx, ky);
      return { x: kx / mag, y: ky / mag };
    }
    return { x: this.value.x, y: this.value.y };
  }
}
