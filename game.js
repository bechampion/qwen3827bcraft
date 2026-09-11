/* qwencraft — minimal voxel sandbox with zombies + creepers */
'use strict';

// ---------- utils ----------
let seed = 1337;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

// ---------- world data ----------
const W = 64, HMAX = 32;
const blocks = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const solid = (x, y, z) => blocks.has(key(x, y, z));

function hgt(x, z) {
  return Math.floor(9 + 3 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 2 * Math.sin((x + z) * 0.10));
}
function topY(x, z) { for (let y = HMAX - 1; y >= 0; y--) if (solid(x, y, z)) return y; return 0; }

function genWorld() {
  for (let x = 0; x < W; x++) for (let z = 0; z < W; z++) {
    const h = hgt(x, z);
    for (let y = 0; y <= h; y++) {
      const t = y === h ? 1 : (y >= h - 3 ? 2 : 3); // grass / dirt / stone
      blocks.set(key(x, y, z), t);
    }
  }
  // trees
  for (let i = 0; i < 28; i++) {
    const tx = 4 + Math.floor(rnd() * (W - 8)), tz = 4 + Math.floor(rnd() * (W - 8));
    const base = topY(tx, tz);
    if (blocks.get(key(tx, base, tz)) !== 1) continue; // grass only
    const th = 4 + Math.floor(rnd() * 2);
    for (let y = 1; y <= th; y++) blocks.set(key(tx, base + y, tz), 4);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = th - 1; dy <= th + 1; dy++) {
      if (Math.abs(dx) + Math.abs(dz) + (dy - (th - 1) === 2 ? 1 : 0) > 4) continue;
      blocks.set(key(tx + dx, base + dy, tz + dz), 5);
    }
  }
}

// ---------- textures (procedural, 8 tiles of 16x16) ----------
// tiles: 0 grass_top | 1 grass_side | 2 dirt | 3 stone | 4 wood_side | 5 wood_top | 6 leaves | 7 plank
const TILE = 16, NT = 8;
const cv = document.createElement('canvas');
cv.width = TILE * NT; cv.height = TILE;
const img = cv.getContext('2d').createImageData(NT * TILE, TILE);
function put(t, x, y, r, g, b) {
  const o = (y * NT * TILE + t * TILE + x) * 4;
  img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
}
function paint(t, fn) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(t, x, y, ...fn(x, y)); }
function noise(base, spread) { const r = rnd; return (x, y) => { const n = (rnd() - .5) * spread; return [base[0] + n, base[1] + n, base[2] + n]; }; }
paint(0, noise([98, 155, 50], 26));
paint(2, noise([130, 96, 66], 22));
paint(1, (x, y) => (y < 3 + (x % 5 === 0) ? noise([95, 145, 45], 22) : noise([130, 96, 66], 22))(x, y));
paint(3, noise([125, 125, 125], 20));
paint(4, (x) => { const c = (x % 4 < 2) ? [85, 66, 40] : [106, 84, 54]; const n = (rnd() - .5) * 12; return [c[0] + n, c[1] + n, c[2] + n]; });
paint(5, (x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); const c = (d % 3 < 2) ? [150, 124, 80] : [104, 82, 52]; return c; });
paint(6, () => rnd() < .15 ? [22, 48, 18] : [45 + rnd() * 40, 100 + rnd() * 40, 30 + rnd() * 15]);
paint(7, (x, y) => { const c = (y % 4 === 0 || (x + Math.floor(y / 4)) % 8 === 0) ? [120, 96, 55] : [162, 133, 77]; const n = (rnd() - .5) * 10; return [c[0] + n, c[1] + n, c[2] + n]; });
cv.getContext('2d').putImageData(img, 0, 0);

// block type -> [top, bottom, side] tiles
const TILES = { 1: [0, 2, 1], 2: [2, 2, 2], 3: [3, 3, 3], 4: [5, 5, 4], 5: [6, 6, 6], 6: [7, 7, 7] };
const BLOCK_NAMES = { 1: 'grass', 2: 'dirt', 3: 'stone', 4: 'wood', 5: 'leaves', 6: 'plank' };
const INV = [1, 3, 4, 6, 2];

// ---------- three setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.65);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

const atlas = new THREE.CanvasTexture(cv);
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
const wmat = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide });
let wmesh = null;

// faces: [axis, sign, 4 corners], uv per face
const FACES = [
  { n: [1, 0, 0],  c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 0, 1],  c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 1, 0],  c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
];
const UVQ = [[0, 0], [1, 0], [1, 1], [0, 1]];

function newGeo() {
  const pos = [], uv = [], nrm = [], idx = [];
  let v = 0;
  for (const [k, t] of blocks) {
    const p = k.split(','); const x = +p[0], y = +p[1], z = +p[2];
    const tl = TILES[t];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      if (solid(x + F.n[0], y + F.n[1], z + F.n[2])) continue;
      const tile = f === 4 ? tl[0] : (f === 5 ? tl[1] : tl[2]);
      for (let i = 0; i < 4; i++) {
        pos.push(x + F.c[i][0], y + F.c[i][1], z + F.c[i][2]);
        uv.push((tile + UVQ[i][0]) / NT, UVQ[i][1]);
        nrm.push(...F.n);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
// ponytail: full world mesh rebuild on every edit (fast enough at 64x64; per-chunk diff if world grows)
function rebuild() {
  const g = newGeo();
  if (wmesh) { wmesh.geometry.dispose(); wmesh.geometry = g; }
  else { wmesh = new THREE.Mesh(g, wmat); scene.add(wmesh); }
}

// ---------- player ----------
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  hp: 20, onGround: false, dead: false,
};
function spawnPlayer() {
  const x = 32, z = 32;
  player.pos.set(x + .5, topY(x, z) + 1.01, z + .5);
  player.vel.set(0, 0, 0);
  player.hp = 20; player.dead = false; player.yaw = Math.PI / 2;
}
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code >= 'Digit1' && e.code <= 'Digit5') sel = +e.code.slice(5) - 1, showSel();
  if (e.code === 'KeyR' && player.dead) respawn();
});
addEventListener('keyup', e => keys[e.code] = false);

const HW = 0.3, PH = 1.8; // player half-width / height
function boxHit(p, hw, h) {
  const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + h - 0.02);
  const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++) if (solid(x, y, z)) return true;
  return false;
}
function stepBody(b, dt, hw, h, jumpV) {
  const move = (axis, amt) => {
    const np = new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z);
    np[axis] += amt;
    if (!boxHit(np, hw, h)) { b.pos[axis] = np[axis]; return true; }
    return false;
  };
  move('x', b.vel.x * dt);
  move('z', b.vel.z * dt);
  const blockedY = !move('y', b.vel.y * dt);
  if (blockedY) {
    if (b.vel.y < 0) { b.onGround = true; if (b.jump) { b.vel.y = jumpV; b.jump = false; b.onGround = false; } }
    b.vel.y = 0;
  } else if (b.pos.y < 0) { // fell off the world
    b.pos.copy(player.pos); b.vel.y = 2;
  }
}

// ---------- input: mouse break / place / punch ----------
let sel = 0, started = false;
const msg = document.getElementById('msg'), hud = document.getElementById('hud'), dmgEl = document.getElementById('damage');
function showSel() { document.getElementById('sel').textContent = '[' + (sel + 1) + '] ' + BLOCK_NAMES[INV[sel]]; }
document.getElementById('hp').textContent = '♥'.repeat(10);
showSel();

renderer.domElement.addEventListener('click', () => {
  if (!started) {
    started = true; msg.classList.add('hidden'); hud.classList.remove('hidden');
    renderer.domElement.requestPointerLock();
    return;
  }
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
  if (player.dead) return;
  // punch an enemy in front?
  const cd = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  for (const e of enemies) {
    const to = e.pos.clone().add(new THREE.Vector3(0, 0.8, 0)).sub(camera.position).normalize();
    if (to.dot(cd) > 0.92 && player.pos.distanceTo(e.pos) < 4) {
      e.hp -= 5;
      e.vel.x += to.x * 6; e.vel.z += to.z * 6; e.vel.y = 4;
      hitEnemy(e);
      return;
    }
  }
  const hit = rayWorld(camera.position, cd, 6);
  if (hit) {
    blocks.delete(key(hit.x, hit.y, hit.z));
    if (player.pos.distanceTo(new THREE.Vector3(hit.x + .5, hit.y, hit.z + .5)) < 1.2) player.hp -= 0; // no self-damage, lazy
    rebuild();
  }
});
renderer.domElement.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!started || player.dead) return;
  const cd = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  const hit = rayWorld(camera.position, cd, 6);
  if (!hit) return;
  const px = hit.nx, py = hit.ny, pz = hit.nz;
  const np = new THREE.Vector3(px + .5, py, pz + .5);
  if (blocks.has(key(px, py, pz))) return;
  // don't place a block inside the player
  const overlap = px <= Math.floor(player.pos.x + HW) && px + 1 > Math.floor(player.pos.x - HW)
    && pz <= Math.floor(player.pos.z + HW) && pz + 1 > Math.floor(player.pos.z - HW)
    && py < Math.floor(player.pos.y + PH) && py + 1 > Math.floor(player.pos.y);
  if (overlap) return;

  blocks.set(key(px, py, pz), INV[sel]);
  rebuild();
});
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0022));
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// DDA voxel raycast
function rayWorld(o, d, maxT) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const dx = d.x ? Math.abs(1 / d.x) : 1e9, dy = d.y ? Math.abs(1 / d.y) : 1e9, dz = d.z ? Math.abs(1 / d.z) : 1e9;
  let tx = d.x ? (sx > 0 ? x + 1 - o.x : o.x - x) * dx : 1e9;
  let ty = d.y ? (sy > 0 ? y + 1 - o.y : o.y - y) * dy : 1e9;
  let tz = d.z ? (sz > 0 ? z + 1 - o.z : o.z - z) * dz : 1e9;
  let prev = [x, y, z], face = [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    if (tx < ty && tx < tz) {
      if (tx > maxT) break;
      face = [-sx, 0, 0]; prev = [x, y, z]; x += sx; tx += dx;
    } else if (ty < tz) {
      if (ty > maxT) break;
      face = [0, -sy, 0]; prev = [x, y, z]; y += sy; ty += dy;
    } else {
      if (tz > maxT) break;
      face = [0, 0, -sz]; prev = [x, y, z]; z += sz; tz += dz;
    }
    if (solid(x, y, z)) return { x, y, z, nx: prev[0], ny: prev[1], nz: prev[2] };
  }
  return null;
}

// ---------- enemies ----------
const enemies = [];
function makeMesh(type) {
  const g = new THREE.Group();
  const body = type === 0 ? 0x4a8f3c : 0x58b53f; // zombie vs creeper green
  const arm = type === 0 ? 0x3f7a33 : 0x58b53f;
  const mk = (w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }));
    m.position.set(x, y, z); g.add(m); return m;
  };
  if (type === 0) {
    mk(0.5, 0.7, 0.3, 0x3b6fd4, 0, 0.95, 0);            // torso (blue tunic)
    mk(0.22, 0.7, 0.22, 0x3b6fd4, -0.36, 0.95, 0);      // arms
    mk(0.22, 0.7, 0.22, 0x3b6fd4, 0.36, 0.95, 0);
    mk(0.2, 0.5, 0.2, 0x4a4a8a, -0.13, 0.25, 0);        // legs
    mk(0.2, 0.5, 0.2, 0x4a4a8a, 0.13, 0.25, 0);
    mk(0.42, 0.42, 0.42, body, 0, 1.55, 0);             // head
    mk(0.08, 0.08, 0.05, 0x101010, -0.09, 1.58, 0.21);  // eyes
    mk(0.14, 0.07, 0.05, 0x101010, 0, 1.45, 0.21);      // mouth
  } else {
    mk(0.55, 0.6, 0.35, body, 0, 0.9, 0);
    mk(0.18, 0.35, 0.18, body, -0.18, 0.25, -0.18);
    mk(0.18, 0.35, 0.18, body, 0.18, 0.25, -0.18);
    mk(0.18, 0.35, 0.18, body, -0.18, 0.25, 0.18);
    mk(0.18, 0.35, 0.18, body, 0.18, 0.25, 0.18);
    mk(0.45, 0.4, 0.4, body, 0, 1.4, 0);
    mk(0.09, 0.12, 0.04, 0x101010, -0.1, 1.44, 0.21);
    mk(0.09, 0.12, 0.04, 0x101010, 0.1, 1.44, 0.21);
    mk(0.16, 0.2, 0.04, 0x101010, 0, 1.32, 0.21);
  }
  return g;
}
function spawnEnemy(type) {
  let x, z, tries = 0;
  do {
    x = Math.floor(rnd() * W); z = Math.floor(rnd() * W); tries++;
  } while (Math.hypot(x - player.pos.x, z - player.pos.z) < 12 && tries < 50);
  const m = makeMesh(type);
  scene.add(m);
  enemies.push({
    type, mesh: m, hp: type === 0 ? 10 : 8,
    pos: new THREE.Vector3(x + .5, topY(x, z) + 1.01, z + .5),
    vel: new THREE.Vector3(), onGround: false, jump: false,
    wander: (rnd() * 6.28), cool: 0, fuse: -1,
  });
}
function hitEnemy(e) {
  if (e.hp <= 0) {
    scene.remove(e.mesh);
    enemies.splice(enemies.indexOf(e), 1);
  }
}
function blowUp(e) {
  const ox = Math.floor(e.pos.x), oy = Math.floor(e.pos.y + 0.5), oz = Math.floor(e.pos.z);
  const r = 3;
  for (let x = ox - r; x <= ox + r; x++) for (let y = oy - r; y <= oy + r; y++) for (let z = oz - r; z <= oz + r; z++)
    if (Math.hypot(x + .5 - e.pos.x, y + .5 - e.pos.y, z + .5 - e.pos.z) <= r) blocks.delete(key(x, y, z));
  rebuild();
  const d = player.pos.distanceTo(e.pos);
  if (d < 7) damagePlayer(Math.round(14 * (1 - d / 7)));
  const kbx = (player.pos.x - e.pos.x) / (d || 1), kbxz = (player.pos.z - e.pos.z) / (d || 1);
  if (d < 7) { player.vel.x += kbx * 8; player.vel.z += kbxz * 8; player.vel.y = 6; }
  scene.remove(e.mesh);
  enemies.splice(enemies.indexOf(e), 1);
}
function damagePlayer(n) {
  player.hp -= n;
  dmgEl.style.opacity = 1;
  setTimeout(() => dmgEl.style.opacity = 0, 220);
  if (player.hp <= 0) die();
  else document.getElementById('hp').textContent = '♥'.repeat(Math.max(0, Math.ceil(player.hp / 2))) + '·'.repeat(10 - Math.max(0, Math.ceil(player.hp / 2)));
}
function die() {
  player.dead = true;
  msg.innerHTML = '<h1>You died!</h1><div>(press R to respawn)</div>';
  msg.classList.remove('hidden');
  document.exitPointerLock && document.exitPointerLock();
}
function respawn() {
  for (const e of [...enemies]) { scene.remove(e.mesh); enemies.splice(enemies.indexOf(e), 1); }
  spawnPlayer(); updateHUD();
  for (let i = 0; i < EN_COUNT; i++) spawnEnemy(rnd() < .35 ? 1 : 0);
  msg.classList.add('hidden');
  renderer.domElement.requestPointerLock();
}
function updateHUD() {
  const h = Math.max(0, Math.ceil(player.hp / 2));
  document.getElementById('hp').textContent = '♥'.repeat(h) + '·'.repeat(10 - h);
}

// ---------- main loop ----------
genWorld();
rebuild();
spawnPlayer();
const EN_COUNT = 10;
for (let i = 0; i < EN_COUNT; i++) spawnEnemy(rnd() < .35 ? 1 : 0);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  if (!player.dead && started) {
    const sprint = keys['ShiftLeft'];
    const sp = sprint ? 9 : 5.5;
    const fw = new THREE.Vector2(-Math.sin(player.yaw), -Math.cos(player.yaw));
    const rt = new THREE.Vector2(Math.cos(player.yaw), -Math.sin(player.yaw));
    let mx = 0, mz = 0;
    if (keys['KeyW']) { mx += fw.x; mz += fw.y; }
    if (keys['KeyS']) { mx -= fw.x; mz -= fw.y; }
    if (keys['KeyD']) { mx += rt.x; mz += rt.y; }
    if (keys['KeyA']) { mx -= rt.x; mz -= rt.y; }
    const l = Math.hypot(mx, mz) || 1;
    player.vel.x = mx / l * sp;
    player.vel.z = mz / l * sp;
    player.vel.y -= 28 * dt;
    if (player.vel.y < -38) player.vel.y = -38;
    if (keys['Space'] && player.onGround) { player.vel.y = 9.2; player.onGround = false; }
    player.onGround = false;
    stepBody(player, dt, HW, PH, 0);
  }

  for (const e of [...enemies]) {
    e.cool -= dt;
    const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    if (e.fuse >= 0) {
      e.fuse -= dt;
      e.mesh.scale.setScalar(Math.max(0.05, 1 + (1.5 - e.fuse) * 0.5));
      if (e.fuse <= 0) { blowUp(e); continue; }
    } else if (dist < 14 && !player.dead) {
      const s = 2.4;
      e.vel.x = dx / dist * s; e.vel.z = dz / dist * s;
      if (e.type === 1 && dist < 1.4 && e.fuse < 0) e.fuse = 1.6;
      if (e.type === 0 && dist < 1.5 && e.cool <= 0) {
        e.cool = 1;
        damagePlayer(1);
        player.vel.x += (dx / (dist || 1)) * -5; player.vel.z += (dz / (dist || 1)) * -5; player.vel.y = 4;
      }
    } else {
      e.wander += dt * 0.5;
      const s = 1.2;
      e.vel.x = Math.cos(e.wander) * s; e.vel.z = Math.sin(e.wander) * s;
    }
    e.vel.y -= 28 * dt;
    if (e.vel.y < -38) e.vel.y = -38;
    e.onGround = false;
    const before = { x: e.pos.x, z: e.pos.z };
    stepBody(e, dt, 0.3, 1.6, 8.5);
    if (e.onGround && Math.hypot(e.pos.x - before.x, e.pos.z - before.z) < 0.02 && e.vel.x + e.vel.z !== 0) e.jump = true;
    // keep facing player-ish
    e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
    e.mesh.rotation.y = Math.atan2(dx, dz);
  }

  camera.position.set(player.pos.x, player.pos.y + 1.62, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
