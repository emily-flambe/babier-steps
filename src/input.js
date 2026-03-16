export class InputManager {
  constructor() {
    this.keys = {};

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Prevent default for game keys to avoid browser shortcuts
    window.addEventListener('keydown', (e) => {
      const gameKeys = [
        'KeyQ', 'KeyE', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
        'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
      ];
      if (gameKeys.includes(e.code)) {
        e.preventDefault();
      }
    });
  }
}
