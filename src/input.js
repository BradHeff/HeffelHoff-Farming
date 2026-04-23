// Floating joystick — touch anywhere on the screen (outside UI buttons) to
// spawn the joystick at the finger position. Drag to steer, lift to dismiss.
// Keyboard still works for desktop testing.
export class InputManager {
  constructor(zoneEl) {
    this.value = { x: 0, y: 0 };
    this.keys = { up: false, down: false, left: false, right: false };

    this._initJoystick(zoneEl);
    this._initKeyboard();
  }

  _initJoystick() {
    // We put the joystick overlay at the game-root level so it can appear
    // anywhere. Elements marked with the `data-ui` attribute (buttons, modal
    // controls) block the joystick — tapping those won't activate it.
    this.root = document.getElementById('game-root');
    const pad = document.createElement('div');
    const stick = document.createElement('div');
    Object.assign(pad.style, {
      position: 'absolute',
      left: '0px', top: '0px',
      width: '140px', height: '140px',
      marginLeft: '-70px', marginTop: '-70px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.25)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: 5,
    });
    Object.assign(stick.style, {
      position: 'absolute',
      left: '0px', top: '0px',
      width: '64px', height: '64px',
      marginLeft: '-32px', marginTop: '-32px',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 30%, #fff, #b9cad2 70%, #8aa0a8)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: 6,
    });
    this.root.appendChild(pad);
    this.root.appendChild(stick);

    this.pad = pad;
    this.stick = stick;
    this.activeTouchId = null;
    this.origin = { x: 0, y: 0 };
    this.radius = 60;

    const start = (clientX, clientY, id) => {
      this.activeTouchId = id;
      this.origin.x = clientX;
      this.origin.y = clientY;
      pad.style.display = 'block';
      stick.style.display = 'block';
      this._positionPad();
      this._positionStick(clientX, clientY);
    };
    const move = (clientX, clientY) => {
      this._positionStick(clientX, clientY);
    };
    const end = () => {
      this.activeTouchId = null;
      pad.style.display = 'none';
      stick.style.display = 'none';
      this.value.x = 0;
      this.value.y = 0;
    };

    // Helper: determine whether a touch should activate the joystick. Ignores
    // taps on anything with data-ui or pointer-events:auto except the canvas.
    const isBlockingElement = (el) => {
      let n = el;
      while (n && n !== this.root) {
        if (n.dataset && n.dataset.ui !== undefined) return true;
        // Seed modal buttons, hire button, upgrade cards — anything
        // explicitly pointer-events:auto that isn't the canvas blocks
        if (n.classList && (
          n.classList.contains('seed-btn') ||
          n.classList.contains('hud-btn')
        )) return true;
        n = n.parentElement;
      }
      return false;
    };

    // TouchEvents — primary mobile path
    this.root.addEventListener('touchstart', (e) => {
      if (this.activeTouchId !== null) return;
      const t = e.changedTouches[0];
      if (isBlockingElement(e.target)) return;
      e.preventDefault();
      start(t.clientX, t.clientY, t.identifier);
    }, { passive: false });
    this.root.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.activeTouchId) {
          e.preventDefault();
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
    this.root.addEventListener('touchend', endHandler);
    this.root.addEventListener('touchcancel', endHandler);

    // Mouse fallback for desktop
    let mouseDown = false;
    this.root.addEventListener('mousedown', (e) => {
      if (isBlockingElement(e.target)) return;
      mouseDown = true;
      start(e.clientX, e.clientY, 'mouse');
    });
    window.addEventListener('mousemove', (e) => { if (mouseDown) move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; end(); } });
  }

  _positionPad() {
    this.pad.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
  }
  _positionStick(clientX, clientY) {
    const dx = clientX - this.origin.x;
    const dy = clientY - this.origin.y;
    const mag = Math.hypot(dx, dy);
    const clamped = Math.min(mag, this.radius);
    const angle = Math.atan2(dy, dx);
    const cx = Math.cos(angle) * clamped;
    const cy = Math.sin(angle) * clamped;
    this.stick.style.transform = `translate(${this.origin.x + cx}px, ${this.origin.y + cy}px)`;
    this.value.x = cx / this.radius;
    this.value.y = -cy / this.radius;
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
