import * as THREE from "three";

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const rayCaster = new THREE.Raycaster();
const mouseNdc = new THREE.Vector2();
const mouseWorld = new THREE.Vector3();
const prevMouseWorld = new THREE.Vector3();
const mouseVelWorld = new THREE.Vector3();

/**
 * 卡片後方：3D 球體漂浮場 + 指標力場（預設排斥，按住 Shift 為吸引）
 */
export function initNeuronBackground(canvas) {
  const prefersReduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1016, 0.018);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
  camera.position.set(0, 0, 20);

  scene.add(new THREE.AmbientLight(0x6a8299, 0.35));
  const key = new THREE.DirectionalLight(0xe8c878, 0.85);
  key.position.set(6, 10, 8);
  scene.add(key);
  const rim = new THREE.PointLight(0x7eb8ff, 0.6, 40);
  rim.position.set(-8, -4, 6);
  scene.add(rim);

  const SPHERE_SEGMENTS = prefersReduced ? 12 : 20;
  const geometry = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
  const material = new THREE.MeshStandardMaterial({
    color: 0x5c7a9e,
    metalness: 0.35,
    roughness: 0.42,
    emissive: 0x1e3a55,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.92,
  });

  const count = prefersReduced ? 48 : 118;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const baseHome = [];
  const pos = [];
  const vel = [];
  const scaleArr = [];
  const seed = [];

  const spreadX = 22;
  const spreadY = 13;

  for (let i = 0; i < count; i++) {
    const hx = (Math.random() - 0.5) * spreadX * 2;
    const hy = (Math.random() - 0.5) * spreadY * 2;
    const hz = (Math.random() - 0.5) * 9 - 1;
    baseHome.push(new THREE.Vector3(hx, hy, hz));
    pos.push(new THREE.Vector3(hx, hy, hz));
    vel.push(new THREE.Vector3());
    const s = 0.12 + Math.random() * 0.42;
    scaleArr.push(s);
    seed.push({
      a: Math.random() * Math.PI * 2,
      b: Math.random() * Math.PI * 2,
      c: Math.random() * Math.PI * 2,
      f: 0.4 + Math.random() * 0.9,
    });
    tmpS.set(s, s, s);
    tmpQ.identity();
    tmpM.compose(pos[i], tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
  }
  mesh.instanceMatrix.needsUpdate = true;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  let pointerSeen = false;
  let attractMode = false;

  function setPointerFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const rw = Math.max(rect.width, 1);
    const rh = Math.max(rect.height, 1);
    const x = ((e.clientX - rect.left) / rw) * 2 - 1;
    const y = -((e.clientY - rect.top) / rh) * 2 + 1;
    mouseNdc.set(x, y);
  }

  function projectMouseToWorld() {
    rayCaster.setFromCamera(mouseNdc, camera);
    const hit = rayCaster.ray.intersectPlane(plane, mouseWorld);
    return hit !== null;
  }

  function onPointerMove(e) {
    pointerSeen = true;
    setPointerFromEvent(e);
  }

  window.addEventListener("pointermove", onPointerMove, { passive: true });

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Shift") attractMode = true;
    },
    { passive: true }
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Shift") attractMode = false;
    },
    { passive: true }
  );

  let lastMouseSample = 0;
  mouseVelWorld.set(0, 0, 0);
  prevMouseWorld.copy(mouseWorld);

  const springK = prefersReduced ? 0.16 : 0.22;
  const damping = prefersReduced ? 0.97 : 0.982;
  const driftAmp = prefersReduced ? 0.22 : 0.72;
  /** 游標力場半徑（世界空間）：與球體視覺縮放分離，小球也能被掃到 */
  const cursorRadius = prefersReduced ? 8.5 : 11;
  const cursorStrength = prefersReduced ? 4.2 : 9.5;
  const sweepGain = prefersReduced ? 0.55 : 1.45;
  const wanderAmpX = spreadX * 0.5;
  const wanderAmpY = spreadY * 0.5;
  const wanderAmpZ = 5;
  const wobbleHz = prefersReduced ? 14 : 20;

  function falloffNear(distSq, radius) {
    if (distSq >= radius * radius) return 0;
    const d = Math.sqrt(distSq);
    return 1 - d / radius;
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.055);
    const t = clock.elapsedTime;

    const hasMouse = pointerSeen && projectMouseToWorld();

    if (hasMouse) {
      const nowPerf = performance.now();
      if (lastMouseSample > 0) {
        const ds = nowPerf - lastMouseSample;
        if (ds > 0) {
          mouseVelWorld.subVectors(mouseWorld, prevMouseWorld);
          mouseVelWorld.multiplyScalar(1000 / Math.max(ds, 8));
          const vmax = prefersReduced ? 28 : 72;
          if (mouseVelWorld.length() > vmax) mouseVelWorld.setLength(vmax);
        }
      } else {
        prevMouseWorld.copy(mouseWorld);
      }
      prevMouseWorld.copy(mouseWorld);
      lastMouseSample = nowPerf;
    } else {
      lastMouseSample = 0;
      mouseVelWorld.multiplyScalar(0.9);
    }

    const sign = attractMode ? -1 : 1;

    for (let i = 0; i < count; i++) {
      const p = pos[i];
      const v = vel[i];
      const bh = baseHome[i];
      const sd = seed[i];

      const wx =
        Math.sin(t * 0.062 + sd.a) * wanderAmpX +
        Math.cos(t * 0.118 + sd.b) * (wanderAmpX * 0.35);
      const wy =
        Math.cos(t * 0.069 + sd.c) * wanderAmpY +
        Math.sin(t * 0.104 + sd.a) * (wanderAmpY * 0.35);
      const wz =
        Math.sin(t * 0.054 + sd.b) * wanderAmpZ +
        Math.cos(t * 0.091 + sd.c) * (wanderAmpZ * 0.4);

      tmpV.set(bh.x + wx, bh.y + wy, bh.z + wz);
      tmpV.sub(p);
      tmpV.multiplyScalar(springK);
      v.add(tmpV);

      const wa =
        Math.sin(t * sd.f * 0.55 + sd.a) * 0.45 +
        Math.cos(t * sd.f * 0.38 + sd.b) * 0.35;
      const wb =
        Math.cos(t * sd.f * 0.62 + sd.c) * 0.4 +
        Math.sin(t * sd.f * 0.48 + sd.b) * 0.35;
      const wc =
        Math.sin(t * sd.f * 0.33 + sd.c) * 0.28 +
        Math.cos(t * sd.f * 0.71 + sd.a) * 0.22;
      v.x += wa * driftAmp * dt;
      v.y += wb * driftAmp * dt;
      v.z += wc * driftAmp * dt;

      if (hasMouse) {
        tmpV.subVectors(p, mouseWorld);
        const distSq = tmpV.lengthSq();
        const r = cursorRadius;
        const dist = Math.sqrt(Math.max(distSq, 1e-8));
        const influence = falloffNear(distSq, r);
        if (influence > 0 && dist > 1e-4) {
          const falloff = 1 - dist / r;
          const sizeBoost = 0.45 / Math.max(scaleArr[i], 0.18);
          const mag =
            (cursorStrength * sizeBoost * falloff * falloff) / (dist + 0.28);
          tmpV.multiplyScalar(((sign * mag) / dist) * dt);
          v.add(tmpV);

          const shake = influence * influence * (prefersReduced ? 0.35 : 1.1);
          const ph = t * wobbleHz + sd.a * 1.7 + i * 0.37;
          v.x += Math.sin(ph) * shake * dt;
          v.y += Math.cos(ph * 1.03) * shake * dt;
          v.z += Math.sin(ph * 0.91 + sd.c) * shake * 0.55 * dt;
        }

        const sw = influence;
        const sv = mouseVelWorld.length();
        if (sv > 0.04 && sw > 0.01) {
          const sizeBoost = 0.5 / Math.max(scaleArr[i], 0.18);
          const push = sw * sweepGain * sizeBoost * dt * 0.024;
          v.x += mouseVelWorld.x * push;
          v.y += mouseVelWorld.y * push;
          v.z += mouseVelWorld.z * push;
        }
      }

      v.multiplyScalar(damping);
      p.addScaledVector(v, dt);

      tmpS.set(scaleArr[i], scaleArr[i], scaleArr[i]);
      tmpQ.identity();
      tmpM.compose(p, tmpQ, tmpS);
      mesh.setMatrixAt(i, tmpM);
    }

    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  animate();

  return () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("resize", resize);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}

function boot() {
  const canvas = document.getElementById("neuron-bg");
  if (!canvas) return;
  initNeuronBackground(canvas);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
