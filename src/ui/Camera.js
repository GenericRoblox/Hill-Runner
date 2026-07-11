// Smooth-follow camera with velocity look-ahead and landing shake.

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.shake = 0;
    this._init = false;
  }

  follow(pos, vel, dt) {
    // Show roughly 950 world-px of height regardless of window size.
    this.zoom = Math.max(0.45, Math.min(1.2, this.canvas.height / 950));

    const lookAhead = Math.max(-120, Math.min(260, vel.x * 14));
    const tx = pos.x + lookAhead;
    const ty = pos.y - 60;

    if (!this._init) {
      this.x = tx; this.y = ty; this._init = true;
    } else {
      const k = 1 - Math.pow(0.001, dt); // framerate-independent lerp
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k * 0.7;
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
  }

  addShake(amount) {
    this.shake = Math.min(18, this.shake + amount);
  }

  applyTransform(ctx) {
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(this.canvas.width / 2 + sx, this.canvas.height / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
