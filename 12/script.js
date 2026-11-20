
const cursorRing = document.getElementById('cursor-ring');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

addEventListener('pointermove', event => {
  if (!finePointer.matches || event.pointerType === 'touch') return;
  cursorRing.style.left = event.clientX + 'px';
  cursorRing.style.top = event.clientY + 'px';
  cursorRing.classList.add('is-visible');
}, { passive: true });

addEventListener('pointerdown', event => {
  if (finePointer.matches && event.pointerType !== 'touch') {
    cursorRing.classList.add('is-pressed');
  }
}, { passive: true });

addEventListener('pointerup', () => cursorRing.classList.remove('is-pressed'), { passive: true });
addEventListener('pointercancel', () => cursorRing.classList.remove('is-pressed'), { passive: true });

addEventListener('blur', () => {
  cursorRing.classList.remove('is-visible', 'is-pressed');
});

document.addEventListener('mouseleave', () => {
  cursorRing.classList.remove('is-visible');
});

(() => {
  'use strict';

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const reset = document.getElementById('reset');

  let W = 0;
  let H = 0;
  let dpr = 1;
  let last = performance.now();
  let acc = 0;
  let scrollPrev = 0;
  let drive = 0;
  let contactPulse = 0;

  const ball = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 21,
    rot: 0,
    grounded: true
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function originalTerrain(u) {
    return H * (
      .705
      - .020 * Math.sin(u * Math.PI * 3.1 - .7)
      - .009 * Math.sin(u * Math.PI * 5.8 + 1.1)
    );
  }

  function terrain(x) {
    const u = x / Math.max(W, 1);
    const t = clamp((u - .19) / .15, 0, 1);
    const blend = t * t * (3 - 2 * t);

    return originalTerrain(.17) * (1 - blend)
      + originalTerrain(u) * blend;
  }

  function slope(x) {
    return (terrain(x + 1) - terrain(x - 1)) / 2;
  }

  function groundBallY(x) {
    const m = slope(x);
    return terrain(x) - ball.r * Math.sqrt(1 + m * m);
  }

  function resize() {
    W = innerWidth;
    H = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ball.r = clamp(Math.min(W, H) * .036, 15, 24);

    if (!ball.x) {
      ball.x = W * .17;
      ball.y = groundBallY(ball.x);
    } else {
      ball.x = clamp(ball.x, ball.r, W - ball.r);

      if (ball.grounded) {
        ball.y = groundBallY(ball.x);
      }
    }
  }

  function restart() {
    ball.x = W * .17;
    ball.y = groundBallY(ball.x);
    ball.vx = 0;
    ball.vy = 0;
    ball.rot = 0;
    ball.grounded = true;
    drive = 0;
    contactPulse = 0;
  }

  function jump() {
    if (!ball.grounded) return;

    ball.grounded = false;
    ball.vy = -clamp(H * 1.18, 460, 790);
    ball.y -= 2;
    contactPulse = 0;
  }

  function applyDrive(delta) {
    if (!Number.isFinite(delta) || !delta) return;

    drive += clamp(delta, -130, 130) * 12;
    drive = clamp(drive, -2300, 2300);
  }

  function onScroll() {
    const now = scrollY;
    const delta = now - scrollPrev;

    scrollPrev = now;

    if (Math.abs(delta) > innerHeight * 1.5) return;

    applyDrive(delta);
  }

  function scrollLimit() {
    return Math.max(
      0,
      document.documentElement.scrollHeight - innerHeight
    );
  }

  function atScrollEdge(delta) {
    const max = scrollLimit();

    return (delta > 0 && scrollY >= max - 1)
      || (delta < 0 && scrollY <= 1);
  }

  addEventListener('wheel', e => {
    let delta = e.deltaY;

    if (e.deltaMode === 1) delta *= 16;
    if (e.deltaMode === 2) delta *= innerHeight;

    if (atScrollEdge(delta)) {
      applyDrive(delta);
    }
  }, { passive: true });

  let touchY = null;

  addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      touchY = e.touches[0].clientY;
    } else {
      touchY = null;
    }
  }, { passive: true });

  addEventListener('touchmove', e => {
    if (touchY === null || e.touches.length !== 1) return;

    const y = e.touches[0].clientY;
    const delta = touchY - y;

    touchY = y;

    if (atScrollEdge(delta)) {
      applyDrive(delta);
    }
  }, { passive: true });

  addEventListener('touchend', () => touchY = null, { passive: true });
  addEventListener('touchcancel', () => touchY = null, { passive: true });

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', resize);

  reset.addEventListener('click', restart);

  let down = null;

  addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;

    down = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      id: e.pointerId
    };
  }, { passive: true });

  addEventListener('pointerup', e => {
    if (!down || down.id !== e.pointerId) return;

    const moved = Math.hypot(
      e.clientX - down.x,
      e.clientY - down.y
    );

    if (moved < 14 && performance.now() - down.t < 550) {
      jump();
    }

    down = null;
  }, { passive: true });

  addEventListener('pointercancel', () => down = null);

  function step(dt) {
    const g = 1250;
    const m = slope(ball.x);

    if (ball.grounded) {
      const gravityAlong = g * m / (1 + m * m);
      const motor = drive;

      ball.vx += (gravityAlong + motor) * dt;
      ball.vx *= Math.exp(-.58 * dt);
      ball.vx = clamp(ball.vx, -540, 540);

      const oldX = ball.x;

      ball.x = clamp(
        ball.x + ball.vx * dt,
        ball.r,
        W - ball.r
      );

      if (
        (ball.x <= ball.r && ball.vx < 0)
        || (ball.x >= W - ball.r && ball.vx > 0)
      ) {
        ball.vx = 0;
      }

      ball.y = groundBallY(ball.x);
      ball.vy = (ball.x - oldX) / dt * slope(ball.x);
      ball.rot += (ball.x - oldX) / ball.r;

      const curve = (
        slope(ball.x + 3) - slope(ball.x - 3)
      ) / 6;

      const normalForce =
        g / Math.sqrt(1 + m * m)
        + ball.vx * ball.vx * curve
        / Math.pow(1 + m * m, 1.5);

      if (normalForce < 0 && Math.abs(ball.vx) > 150) {
        ball.grounded = false;
        ball.y -= 1;
      }
    } else {
      ball.vy += g * dt;
      ball.vx += drive * .20 * dt;
      ball.vx = clamp(ball.vx, -540, 540);

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.vx *= Math.exp(-.12 * dt);

      if (ball.x < ball.r) {
        ball.x = ball.r;
        ball.vx = 0;
      }

      if (ball.x > W - ball.r) {
        ball.x = W - ball.r;
        ball.vx = 0;
      }

      const gy = groundBallY(ball.x);

      if (ball.y >= gy && ball.vy > 0) {
        const sl = slope(ball.x);
        const len = Math.sqrt(1 + sl * sl);
        const nx = sl / len;
        const ny = -1 / len;
        const vn = ball.vx * nx + ball.vy * ny;

        ball.vx -= 1.12 * vn * nx;
        ball.vy -= 1.12 * vn * ny;
        ball.y = gy;

        contactPulse = clamp(
          Math.abs(vn) / 1000,
          .10,
          .27
        );

        if (Math.abs(ball.vy) < 145) {
          ball.grounded = true;
          ball.vy = 0;
        }
      }

      ball.rot += ball.vx * dt / ball.r * .25;
    }

    drive *= Math.exp(-3.0 * dt);

    if (Math.abs(drive) < .1) {
      drive = 0;
    }

    contactPulse = Math.max(
      0,
      contactPulse - dt * 1.65
    );
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const floor = ctx.createLinearGradient(
      0, H * .55, 0, H
    );

    floor.addColorStop(0, '#98c5a0');
    floor.addColorStop(1, '#d9e8c8');

    ctx.beginPath();
    ctx.moveTo(0, terrain(0));

    for (let x = 3; x < W + 3; x += 3) {
      ctx.lineTo(x, terrain(x));
    }

    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();

    ctx.fillStyle = floor;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, terrain(0));

    for (let x = 3; x < W + 3; x += 3) {
      ctx.lineTo(x, terrain(x));
    }

    ctx.strokeStyle = '#638d71';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(ball.x, ball.y);

    const squash = ball.grounded
      ? Math.min(contactPulse * .48, .12)
      : 0;

    ctx.scale(1 + squash, 1 - squash);
    ctx.rotate(ball.rot);

    ctx.beginPath();

    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2;

      const r = ball.r * (
        1
        + .018 * Math.sin(a * 5 + 1)
        + .014 * Math.sin(a * 9 + 2)
      );

      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;

      if (!i) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.fillStyle = '#d4c8e4';
    ctx.fill();

    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#9483ab';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
      -ball.r * .15,
      -ball.r * .12,
      ball.r * .66,
      2.45,
      3.75
    );

    ctx.strokeStyle = '#f1eafb';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function frame(now) {
    let elapsed = Math.min((now - last) / 1000, .05);

    last = now;
    acc += elapsed;

    while (acc >= 1 / 120) {
      step(1 / 120);
      acc -= 1 / 120;
    }

    draw();
    requestAnimationFrame(frame);
  }

  resize();
  scrollPrev = scrollY;
  requestAnimationFrame(frame);
})();
