import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

/* =========================================================
   DOM Refs
========================================================= */
const canvas = document.getElementById("webgl");
const fileInput = document.getElementById("fileInput");
const resetBtn = document.getElementById("resetBtn");
const snapshotBtn = document.getElementById("snapshotBtn");


const colorPurpleBtn = document.getElementById("colorPurpleBtn");
const colorCyanBtn = document.getElementById("colorCyanBtn");
const restoreMatBtn = document.getElementById("restoreMatBtn");

const wireframeToggle = document.getElementById("wireframeToggle");

const fitViewBtn = document.getElementById("fitViewBtn");
const camPresetButtons = document.querySelectorAll(".camera-group button[data-cam]");

const explodeRange = document.getElementById("explodeRange");
const explodeValue = document.getElementById("explodeValue");

const loaderEl = document.getElementById("loader");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

/* =========================================================
   Scene / Camera / Renderer
========================================================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  5000
);
camera.position.set(2.5, 1.8, 2.8);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* =========================================================
   Controls
========================================================= */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.minDistance = 0.1;
controls.maxDistance = 2000;
controls.target.set(0, 0.5, 0);

/* =========================================================
   Lights
========================================================= */
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1f2b, 0.9);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(5, 8, 6);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.1;
dir.shadow.camera.far = 80;
scene.add(dir);

const fill = new THREE.DirectionalLight(0x88aaff, 0.45);
fill.position.set(-4, 3, -5);
scene.add(fill);

const amb = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(amb);

/* Ground (subtle) */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.95,
    metalness: 0.0
  })
);
ground.rotation.x = -Math.PI * 0.5;
ground.position.y = -0.0001;
ground.receiveShadow = true;
scene.add(ground);

/* =========================================================
   Loaders / Global State
========================================================= */
const gltfLoader = new GLTFLoader();

let currentModelRoot = null;
let currentObjectURL = null;

/**
 * For restoring materials after tint changes
 * Map<Mesh.uuid, Material or Material[]>
 */
const originalMaterials = new Map();

/**
 * For explode view
 * Array<{ mesh, origin: Vector3, dir: Vector3 }>
 */
let explodeParts = [];

/* =========================================================
   Utilities
========================================================= */
function exportSnapshot(filename = "snapshot.png") {
  try {
    // یک رندر فوری برای اطمینان از فریم نهایی
    renderer.render(scene, camera);

    const dataURL = renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (typeof showStatus === "function") {
      showStatus("تصویر با موفقیت ذخیره شد.", "success", 1800);
    }
  } catch (err) {
    console.error(err);
    if (typeof showStatus === "function") {
      showStatus("خطا در خروجی تصویر.", "error", 2500);
    }
  }
}

function setLoading(visible, progress = 0) {
  if (!loaderEl) return;
  loaderEl.classList.toggle("hidden", !visible);
  const val = Math.max(0, Math.min(100, progress));
  if (progressBar) progressBar.style.width = `${val}%`;
  if (progressText) progressText.textContent = `${Math.round(val)}%`;
}

function computeBounds(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return { box, size, center };
}

function fitDistanceForPerspective(cam, size, fitOffset = 1.25) {
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const fov = THREE.MathUtils.degToRad(cam.fov);
  let dist = (maxDim * 0.5) / Math.tan(fov * 0.5);
  dist *= fitOffset;
  return dist;
}

function fitCameraToObject(object3d, fitOffset = 1.25) {
  if (!object3d) return;
  const { size, center } = computeBounds(object3d);
  const dist = fitDistanceForPerspective(camera, size, fitOffset);

  // Keep view direction
  const viewDir = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();

  const newPos = center.clone().addScaledVector(viewDir, dist);

  camera.position.copy(newPos);
  controls.target.copy(center);

  camera.near = Math.max(dist / 100, 0.01);
  camera.far = Math.max(dist * 100, 1000);
  camera.updateProjectionMatrix();
  controls.update();
}

function traverseMeshes(root, cb) {
  root.traverse((obj) => {
    if (obj.isMesh) cb(obj);
  });
}

function cloneMaterialWithColor(mat, colorHex) {
  const m = mat.clone();
  if ("color" in m && m.color) {
    m.color = new THREE.Color(colorHex);
  }
  if ("metalness" in m && typeof m.metalness === "number") {
    m.metalness = Math.min(1, Math.max(0, m.metalness));
  }
  if ("roughness" in m && typeof m.roughness === "number") {
    m.roughness = Math.min(1, Math.max(0, m.roughness));
  }
  m.needsUpdate = true;
  return m;
}

function toTintedMaterial(materialOrArray, colorHex) {
  if (Array.isArray(materialOrArray)) {
    return materialOrArray.map((m) => cloneMaterialWithColor(m, colorHex));
  }
  return cloneMaterialWithColor(materialOrArray, colorHex);
}

function applyTintToModel(colorHex) {
  if (!currentModelRoot) return;
  traverseMeshes(currentModelRoot, (mesh) => {
    if (!originalMaterials.has(mesh.uuid)) {
      originalMaterials.set(mesh.uuid, mesh.material);
    }
    mesh.material = toTintedMaterial(mesh.material, colorHex);
    mesh.material.needsUpdate = true;
  });
  rebuildModelMaterials();
}

function restoreOriginalMaterials() {
  if (!currentModelRoot) return;
  traverseMeshes(currentModelRoot, (mesh) => {
    const orig = originalMaterials.get(mesh.uuid);
    if (orig) {
      disposeMaterial(mesh.material);
      mesh.material = orig;
      mesh.material.needsUpdate = true;
    }
  });
  rebuildModelMaterials();
}

function rebuildModelMaterials() {
  const wf = !!wireframeToggle?.checked;
  if (!currentModelRoot) return;
  traverseMeshes(currentModelRoot, (mesh) => {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => {
        m.wireframe = wf;
        m.needsUpdate = true;
      });
    } else if (mesh.material) {
      mesh.material.wireframe = wf;
      mesh.material.needsUpdate = true;
    }
  });
}

function setWireframe(enabled) {
  if (!currentModelRoot) return;
  traverseMeshes(currentModelRoot, (mesh) => {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => {
        m.wireframe = enabled;
        m.needsUpdate = true;
      });
    } else if (mesh.material) {
      mesh.material.wireframe = enabled;
      mesh.material.needsUpdate = true;
    }
  });
}

/* =========================================================
   Explode View
========================================================= */
function buildExplodeData(root) {
  explodeParts = [];
  if (!root) return;

  const { center } = computeBounds(root);

  traverseMeshes(root, (mesh) => {
    const origin = mesh.position.clone();

    const meshWorldCenter = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getCenter(meshWorldCenter);

    const dir = meshWorldCenter.clone().sub(center);
    if (dir.lengthSq() < 1e-8) {
      dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    }
    dir.normalize();

    explodeParts.push({ mesh, origin, dir });
  });
}

function applyExplode(amount) {
  const k = Number(amount) || 0;
  for (const part of explodeParts) {
    part.mesh.position.copy(part.origin).addScaledVector(part.dir, k);
  }
}

/* =========================================================
   Camera Presets + Smooth Transition
========================================================= */
const camAnim = {
  active: false,
  start: 0,
  duration: 700,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
};

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function getPresetPosition(preset, center, radius) {
  switch (preset) {
    case "front": return new THREE.Vector3(center.x, center.y, center.z + radius);
    case "back":  return new THREE.Vector3(center.x, center.y, center.z - radius);
    case "left":  return new THREE.Vector3(center.x - radius, center.y, center.z);
    case "right": return new THREE.Vector3(center.x + radius, center.y, center.z);
    case "top":   return new THREE.Vector3(center.x, center.y + radius, center.z + 0.001);
    case "iso":
    default:
      return new THREE.Vector3(
        center.x + radius * 0.9,
        center.y + radius * 0.7,
        center.z + radius * 0.9
      );
  }
}

function animateCameraTo(toPos, toTarget, duration = 700) {
  camAnim.active = true;
  camAnim.start = performance.now();
  camAnim.duration = duration;
  camAnim.fromPos.copy(camera.position);
  camAnim.toPos.copy(toPos);
  camAnim.fromTarget.copy(controls.target);
  camAnim.toTarget.copy(toTarget);
}

function updateCameraAnimation(now) {
  if (!camAnim.active) return;
  const t = Math.min((now - camAnim.start) / camAnim.duration, 1);
  const k = easeOutCubic(t);

  camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
  controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
  controls.update();

  if (t >= 1) camAnim.active = false;
}

function setActiveCamButton(preset) {
  camPresetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cam === preset);
  });
}

function goToPreset(preset) {
  if (!currentModelRoot) return;
  const { size, center } = computeBounds(currentModelRoot);
  const radius = Math.max(size.x, size.y, size.z) * 1.35;
  const toPos = getPresetPosition(preset, center, radius);
  animateCameraTo(toPos, center.clone(), 700);
  setActiveCamButton(preset);
}

/* =========================================================
   Dispose / Memory Cleanup
========================================================= */
function disposeMaterial(mat) {
  if (!mat) return;

  const disposeOne = (m) => {
    const texSlots = [
      "map","aoMap","alphaMap","bumpMap","normalMap","metalnessMap",
      "roughnessMap","emissiveMap","displacementMap","clearcoatMap",
      "clearcoatNormalMap","clearcoatRoughnessMap","iridescenceMap",
      "iridescenceThicknessMap","sheenColorMap","sheenRoughnessMap",
      "specularMap","specularColorMap","specularIntensityMap","transmissionMap",
      "thicknessMap","anisotropyMap"
    ];
    texSlots.forEach((k) => {
      if (m[k] && m[k].isTexture) m[k].dispose();
    });
    m.dispose?.();
  };

  if (Array.isArray(mat)) mat.forEach(disposeOne);
  else disposeOne(mat);
}

function disposeModel(root) {
  if (!root) return;

  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.();
      disposeMaterial(obj.material);
    }
  });

  scene.remove(root);
  originalMaterials.clear();
  explodeParts = [];
}

/* =========================================================
   Model Load Flow
========================================================= */
function onModelLoaded(modelRoot) {
  currentModelRoot = modelRoot;

  traverseMeshes(currentModelRoot, (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  if (wireframeToggle) wireframeToggle.checked = false;
  if (explodeRange) explodeRange.value = "0";
  if (explodeValue) explodeValue.textContent = "0.00";

  buildExplodeData(currentModelRoot);
  applyExplode(0);

  fitCameraToObject(currentModelRoot, 1.25);
  setActiveCamButton("iso");
}

function loadModelFromFile(file) {
  if (!file) return;

  const isValid = /\.(glb|gltf)$/i.test(file.name);
  if (!isValid) {
    alert("فرمت فایل باید .glb یا .gltf باشد.");
    return;
  }

  setLoading(true, 0);

  if (currentModelRoot) {
    disposeModel(currentModelRoot);
    currentModelRoot = null;
  }
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }

  const url = URL.createObjectURL(file);
  currentObjectURL = url;

  gltfLoader.load(
    url,
    (gltf) => {
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) {
        setLoading(false, 0);
        alert("مدل قابل بارگذاری نبود.");
        return;
      }

      scene.add(root);
      onModelLoaded(root);

      setLoading(false, 100);
    },
    (xhr) => {
      if (!xhr || !xhr.total) {
        setLoading(true, 30);
        return;
      }
      const p = (xhr.loaded / xhr.total) * 100;
      setLoading(true, p);
    },
    (err) => {
      console.error(err);
      setLoading(false, 0);
      alert("خطا در بارگذاری مدل.");
    }
  );
}

function loadModelFromUrl(url) {
  if (!url) return;

  setLoading(true, 0);

  if (currentModelRoot) {
    disposeModel(currentModelRoot);
    currentModelRoot = null;
  }
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }

  gltfLoader.load(
    url,
    (gltf) => {
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) {
        setLoading(false, 0);
        alert("مدل پیش‌فرض قابل بارگذاری نبود.");
        return;
      }

      scene.add(root);
      onModelLoaded(root);

      setLoading(false, 100);
    },
    (xhr) => {
      if (!xhr || !xhr.total) {
        setLoading(true, 30);
        return;
      }
      const p = (xhr.loaded / xhr.total) * 100;
      setLoading(true, p);
    },
    (err) => {
      console.error(err);
      setLoading(false, 0);
      alert("خطا در بارگذاری مدل پیش‌فرض.");
    }
  );
}

/* =========================================================
   UI Events
========================================================= */
snapshotBtn?.addEventListener("click", () => {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  exportSnapshot(`product-view-${stamp}.png`);
});


fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  loadModelFromFile(file);
});

resetBtn?.addEventListener("click", () => {
  restoreOriginalMaterials();

  if (wireframeToggle) wireframeToggle.checked = false;
  setWireframe(false);

  if (explodeRange) explodeRange.value = "0";
  if (explodeValue) explodeValue.textContent = "0.00";
  applyExplode(0);

  if (currentModelRoot) fitCameraToObject(currentModelRoot, 1.25);
  setActiveCamButton("iso");
});

colorPurpleBtn?.addEventListener("click", () => {
  applyTintToModel(0x7c3aed);
});

colorCyanBtn?.addEventListener("click", () => {
  applyTintToModel(0x22d3ee);
});

restoreMatBtn?.addEventListener("click", () => {
  restoreOriginalMaterials();
});

wireframeToggle?.addEventListener("change", (e) => {
  setWireframe(!!e.target.checked);
});

explodeRange?.addEventListener("input", (e) => {
  const val = Number(e.target.value || 0);
  if (explodeValue) explodeValue.textContent = val.toFixed(2);
  applyExplode(val);
});

camPresetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    goToPreset(btn.dataset.cam);
  });
});

fitViewBtn?.addEventListener("click", () => {
  if (!currentModelRoot) return;
  fitCameraToObject(currentModelRoot, 1.25);
});

/* =========================================================
   Resize
========================================================= */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
window.addEventListener("resize", onResize);

/* =========================================================
   Animate Loop
========================================================= */
function animate(time = 0) {
  requestAnimationFrame(animate);

  updateCameraAnimation(time);
  controls.update();

  renderer.render(scene, camera);
}
animate();

/* =========================================================
   Boot
========================================================= */
loadModelFromUrl("/models/product.glb");



const fab = document.getElementById("menuToggleFab");
const panel = document.querySelector(".panel.pro-panel");

if (fab && panel) {
  // پیش‌فرض: منو باز
  document.body.classList.add("menu-open");
  document.body.classList.remove("menu-collapsed");
  fab.textContent = "✕";

  fab.addEventListener("click", () => {
    const isCollapsed = document.body.classList.toggle("menu-collapsed");
    document.body.classList.toggle("menu-open", !isCollapsed);
    fab.textContent = isCollapsed ? "☰" : "✕";

    // اگر تابع resize داری، صدا بزن تا رندر درست بماند
    if (typeof onResize === "function") {
      setTimeout(() => onResize(), 260); // بعد از انیمیشن
    }
  });
}
