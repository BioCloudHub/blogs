<template>
  <Teleport to="body">
    <div
      ref="containerRef"
      class="bio-3d-container"
      :class="{ 'is-loading': isLoading }"
    >
      <canvas ref="canvasRef" />
      <div v-if="isLoading" class="bio-3d-loader">
        <div class="bio-3d-spinner"></div>
        <p>Loading 3D Experience... {{ loadProgress }}%</p>
      </div>
      <div class="bio-3d-overlay"></div>
      <div
        class="bio-3d-label"
        v-show="hoverLabel.visible"
        :style="hoverLabel.style"
      >
        {{ hoverLabel.text }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from "vue";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import {
  useDark,
  useWindowSize,
  useMouse,
  useFps,
  useWindowScroll,
} from "@vueuse/core";

// Props & Config
const props = defineProps<{
  particleCount?: number;
}>();

const PARTICLE_COUNT = props.particleCount || 100;
const MOLECULE_COUNT = 15;
const DNA_LENGTH = 52;
const DNA_RADIUS = 2;
const DNA_TUBE_RADIUS = 0.1;
const DNA_STEP = 0.6;
const DNA_ANGLE_STEP = 0.45;
const DNA_HALF = DNA_LENGTH / 2;
const DNA_HEIGHT = DNA_LENGTH * DNA_STEP;
type QualityTier = "high" | "balanced" | "lite";

// State
const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isLoading = ref(true);
const loadProgress = ref(0);
const fps = useFps();
const { y: scrollY } = useWindowScroll();

// Theme
const isDark = useDark({
  selector: "html",
  attribute: "class",
  valueDark: "dark",
  valueLight: "",
});

// Three.js variables
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let composer: EffectComposer;
let bloomPass: UnrealBloomPass;
let bokehPass: BokehPass;
let dnaGroup: THREE.Group;
let moleculesGroup: THREE.Group;
let particlesMesh: THREE.InstancedMesh;
let dustPoints: THREE.Points;
let dnaAura: THREE.Points;
let dnaAuraMaterial: THREE.PointsMaterial;
let depthLayerNear: THREE.Points;
let depthLayerFar: THREE.Points;
let depthLayerNearMaterial: THREE.PointsMaterial;
let depthLayerFarMaterial: THREE.PointsMaterial;
let volumetricBeamGroup: THREE.Group;
let volumetricBeamMaterials: THREE.MeshBasicMaterial[] = [];
let godRayGroup: THREE.Group;
let godRayMaterials: THREE.MeshBasicMaterial[] = [];
let godRaySweepers: Array<{ mesh: THREE.Mesh; speed: number; phase: number }> = [];
let raycaster: THREE.Raycaster;
let mouseVector: THREE.Vector2;
let clock: THREE.Clock;
let animationId: number;
let lastHovered: THREE.Mesh | null = null;
let connectionsGeometry: THREE.BufferGeometry;
let connectionsMaterial: THREE.LineBasicMaterial;
let connectionsLines: THREE.LineSegments;
let maxConnectionSegments = 0;
const hoverLabel = ref<{ visible: boolean; text: string; style: Record<string, string> }>({
  visible: false,
  text: "",
  style: {},
});
let energyCarriers: Array<{ mesh: THREE.Mesh; s: number; strand: number; speed: number }> = [];
let ringGroup: THREE.Group;
let ringOrbs: Array<{ mesh: THREE.Mesh; r: number; speed: number; phase: number }> = [];
let helixShockRings: Array<{ mesh: THREE.Mesh; speed: number; phase: number }> = [];
let antibodyGroup: THREE.Group;
let antibodyMaterial: THREE.MeshPhysicalMaterial;
let lightChainMaterial: THREE.MeshPhysicalMaterial;
let disulfideMaterial: THREE.MeshPhysicalMaterial;
let qualityTier: QualityTier = "high";

// Materials (to be updated on theme change)
let dnaMaterial: THREE.MeshPhysicalMaterial;
let moleculeMaterial: THREE.MeshPhysicalMaterial;
let particleMaterial: THREE.MeshStandardMaterial;

// Colors
const colors = computed(() => ({
  background: isDark.value ? 0x0f172a : 0xf6fbff,
  dna: isDark.value ? 0x60a5fa : 0x2b6cb0,
  dnaHighlight: isDark.value ? 0x22c55e : 0x0ea5e9,
  molecule: isDark.value ? 0x34d399 : 0x2dd4bf,
  particle: isDark.value ? 0x94a3b8 : 0xbcd0e5,
  fog: isDark.value ? 0x0f172a : 0xf6fbff,
}));

const resolveQualityTier = (): QualityTier => {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  if (reduced) return "lite";
  if (window.innerWidth < 960) return "lite";
  if (window.innerWidth < 1360) return "balanced";
  return "high";
};

// Init Scene
const initScene = () => {
  if (!canvasRef.value || !containerRef.value) return;
  qualityTier = resolveQualityTier();

  // Scene
  scene = new THREE.Scene();
  // scene.background = new THREE.Color(colors.value.background); // Use CSS background
  // scene.fog = new THREE.FogExp2(colors.value.fog, 0.02); // Disable fog for gradient background

  // Camera
  const { width, height } = containerRef.value.getBoundingClientRect();
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  camera.position.set(0, 0, 16.8);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    alpha: true,
  });
  renderer.setSize(width, height);
  const pixelRatioCap = qualityTier === "high" ? 2 : qualityTier === "balanced" ? 1.6 : 1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
  renderer.shadowMap.enabled = true;
  // Use ACESFilmic for better bright rendering
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Post-processing
  const renderScene = new RenderPass(scene, camera);

  // Important: Clear alpha for transparent background
  renderScene.clearAlpha = 0;

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.5,
    0.4,
    0.85
  );
  bloomPass.threshold = 0.22;
  bloomPass.strength = qualityTier === "high" ? 0.18 : qualityTier === "balanced" ? 0.14 : 0.1;
  bloomPass.radius = qualityTier === "high" ? 0.5 : qualityTier === "balanced" ? 0.42 : 0.35;
  bokehPass = new BokehPass(scene, camera, {
    focus: 14.5,
    aperture: qualityTier === "high" ? 0.00003 : 0.00002,
    maxblur: qualityTier === "high" ? 0.0025 : qualityTier === "balanced" ? 0.0018 : 0.0012,
  });
  bokehPass.enabled = qualityTier !== "lite";

  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);
  composer.addPass(bokehPass);

  // Lights
  // Significantly increased ambient light for "Professional White" look
  const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 3.5);
  dirLight.position.set(5, 10, 7);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Fill light from bottom to illuminate undersides
  const fillLight = new THREE.DirectionalLight(0xeef4f8, 1.8);
  fillLight.position.set(-5, -5, -5);
  scene.add(fillLight);

  const pointLight = new THREE.PointLight(colors.value.dnaHighlight, 2.5, 25);
  pointLight.position.set(0, 0, 5);
  scene.add(pointLight);

  // Groups
  dnaGroup = new THREE.Group();
  moleculesGroup = new THREE.Group();
  scene.add(dnaGroup);
  scene.add(moleculesGroup);

  // Raycaster
  raycaster = new THREE.Raycaster();
  mouseVector = new THREE.Vector2();
  clock = new THREE.Clock();

  // Mouse Light
  const mouseLight = new THREE.PointLight(colors.value.dnaHighlight, 3, 15);
  mouseLight.position.set(0, 0, 5);
  scene.add(mouseLight);

  // Store mouse light in a variable accessible to animate loop
  (scene as any).userData.mouseLight = mouseLight;

  // Create Objects
  createDNA();
  createDNATubes();
  createDNAAura();
  createDepthLayers();
  createVolumetricBeam();
  createGodRays();
  createHelixShockRings();
  createEnergyCarriers();
  createRings();
  createAntibody();
  createMolecules();
  createConnections();
  createParticles();
  createDust();

  // Animation
  animate();

  isLoading.value = false;
};

// --- Visibility Optimization ---
const handleVisibilityChange = () => {
  if (document.hidden) {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = 0;
    }
  } else {
    if (!animationId && !isLoading.value && scene) {
      animate();
    }
  }
};

// --- Helper: Generate Soft Particle Texture ---
const getParticleTexture = () => {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const center = size / 2;
  const gradient = ctx.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.8)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.2)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const getBeamTexture = () => {
  const width = 64;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradientX = ctx.createLinearGradient(0, 0, width, 0);
  gradientX.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradientX.addColorStop(0.5, "rgba(255, 255, 255, 1)");
  gradientX.addColorStop(1, "rgba(255, 255, 255, 0)");
  const gradientY = ctx.createLinearGradient(0, 0, 0, height);
  gradientY.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradientY.addColorStop(0.22, "rgba(255, 255, 255, 0.8)");
  gradientY.addColorStop(0.8, "rgba(255, 255, 255, 0.55)");
  gradientY.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradientX;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = gradientY;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

// Create DNA
const createDNA = () => {
  dnaMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.value.dna,
    metalness: 0.1,
    roughness: 0.1, // Smoother for cleaner look
    transmission: 0.9, // Slightly less transmission to show color
    thickness: 1.2,
    ior: 1.45,
    emissive: colors.value.dna,
    emissiveIntensity: isDark.value ? 0.15 : 0.05, // Less emissive in light mode
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color(colors.value.dna),
    attenuationDistance: 5,
  });

  const geometry = new THREE.SphereGeometry(0.2, 28, 28);
  const connectorGeometry = new THREE.CylinderGeometry(
    0.03,
    0.03,
    DNA_RADIUS * 2,
    16
  );
  connectorGeometry.rotateZ(Math.PI / 2);

  for (let i = 0; i < DNA_LENGTH; i++) {
    const angle = i * DNA_ANGLE_STEP;
    const y = (i - DNA_HALF) * DNA_STEP;

    // Strands
    const sphere1 = new THREE.Mesh(geometry, dnaMaterial);
    sphere1.position.set(
      Math.cos(angle) * DNA_RADIUS,
      y,
      Math.sin(angle) * DNA_RADIUS
    );
    dnaGroup.add(sphere1);

    const sphere2 = new THREE.Mesh(geometry, dnaMaterial);
    sphere2.position.set(
      Math.cos(angle + Math.PI) * DNA_RADIUS,
      y,
      Math.sin(angle + Math.PI) * DNA_RADIUS
    );
    dnaGroup.add(sphere2);

    // Connector (Base pair)
    if (i % 4 === 0) {
      const connector = new THREE.Mesh(connectorGeometry, dnaMaterial);
      connector.position.set(0, y, 0);
      connector.rotation.y = -angle;
      dnaGroup.add(connector);
    }
  }

  // Tilt DNA
  dnaGroup.rotation.z = Math.PI / 6;
  dnaGroup.rotation.x = Math.PI / 6;
};

const createDNATubes = () => {
  const pointsA: THREE.Vector3[] = [];
  const pointsB: THREE.Vector3[] = [];
  for (let s = 0; s <= DNA_LENGTH * 2; s++) {
    const t = s * 0.5;
    const angle = t * DNA_ANGLE_STEP;
    const y = (t - DNA_HALF) * DNA_STEP;
    pointsA.push(new THREE.Vector3(Math.cos(angle) * DNA_RADIUS, y, Math.sin(angle) * DNA_RADIUS));
    pointsB.push(new THREE.Vector3(Math.cos(angle + Math.PI) * DNA_RADIUS, y, Math.sin(angle + Math.PI) * DNA_RADIUS));
  }
  const curveA = new THREE.CatmullRomCurve3(pointsA, false, "catmullrom", 0.1);
  const curveB = new THREE.CatmullRomCurve3(pointsB, false, "catmullrom", 0.1);
  const tubeGeoA = new THREE.TubeGeometry(curveA, 220, DNA_TUBE_RADIUS, 20, false);
  const tubeGeoB = new THREE.TubeGeometry(curveB, 220, DNA_TUBE_RADIUS, 20, false);
  const tubeMat = new THREE.MeshPhysicalMaterial({
    color: colors.value.dna,
    metalness: 0.05,
    roughness: 0.22,
    transmission: 0.5,
    thickness: 0.6,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: isDark.value ? 0.28 : 0.35,
  });
  const tubeA = new THREE.Mesh(tubeGeoA, tubeMat);
  const tubeB = new THREE.Mesh(tubeGeoB, tubeMat);
  dnaGroup.add(tubeA);
  dnaGroup.add(tubeB);
};

const createDNAAura = () => {
  const auraCount = qualityTier === "high" ? 520 : qualityTier === "balanced" ? 360 : 220;
  const positions = new Float32Array(auraCount * 3);
  for (let i = 0; i < auraCount; i++) {
    const t = Math.random() * DNA_LENGTH;
    const angle = t * DNA_ANGLE_STEP + (Math.random() - 0.5) * 0.6;
    const radius = DNA_RADIUS + 0.8 + Math.random() * 1.8;
    const y = (t - DNA_HALF) * DNA_STEP + (Math.random() - 0.5) * 1.1;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  dnaAuraMaterial = new THREE.PointsMaterial({
    color: colors.value.dnaHighlight,
    size: qualityTier === "lite" ? (isDark.value ? 0.16 : 0.13) : (isDark.value ? 0.22 : 0.18),
    transparent: true,
    opacity: qualityTier === "lite" ? (isDark.value ? 0.14 : 0.1) : (isDark.value ? 0.38 : 0.3),
    blending: THREE.AdditiveBlending,
    map: getParticleTexture(),
    depthWrite: false,
  });
  dnaAura = new THREE.Points(geometry, dnaAuraMaterial);
  dnaGroup.add(dnaAura);
};

const createDepthLayers = () => {
  const nearCount = qualityTier === "high" ? 160 : qualityTier === "balanced" ? 110 : 70;
  const farCount = qualityTier === "high" ? 260 : qualityTier === "balanced" ? 170 : 90;
  const nearPositions = new Float32Array(nearCount * 3);
  const farPositions = new Float32Array(farCount * 3);
  for (let i = 0; i < nearCount; i++) {
    nearPositions[i * 3] = (Math.random() - 0.5) * 14;
    nearPositions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    nearPositions[i * 3 + 2] = 4 + Math.random() * 3;
  }
  for (let i = 0; i < farCount; i++) {
    farPositions[i * 3] = (Math.random() - 0.5) * 22;
    farPositions[i * 3 + 1] = (Math.random() - 0.5) * 24;
    farPositions[i * 3 + 2] = -10 - Math.random() * 8;
  }
  const nearGeometry = new THREE.BufferGeometry();
  const farGeometry = new THREE.BufferGeometry();
  nearGeometry.setAttribute("position", new THREE.BufferAttribute(nearPositions, 3));
  farGeometry.setAttribute("position", new THREE.BufferAttribute(farPositions, 3));
  depthLayerNearMaterial = new THREE.PointsMaterial({
    color: colors.value.dnaHighlight,
    size: isDark.value ? 0.35 : 0.28,
    transparent: true,
    opacity: isDark.value ? 0.14 : 0.1,
    blending: THREE.AdditiveBlending,
    map: getParticleTexture(),
    depthWrite: false,
  });
  depthLayerFarMaterial = new THREE.PointsMaterial({
    color: colors.value.dna,
    size: isDark.value ? 0.45 : 0.34,
    transparent: true,
    opacity: isDark.value ? 0.1 : 0.07,
    blending: THREE.AdditiveBlending,
    map: getParticleTexture(),
    depthWrite: false,
  });
  depthLayerNear = new THREE.Points(nearGeometry, depthLayerNearMaterial);
  depthLayerFar = new THREE.Points(farGeometry, depthLayerFarMaterial);
  scene.add(depthLayerNear);
  scene.add(depthLayerFar);
};

const createVolumetricBeam = () => {
  volumetricBeamGroup = new THREE.Group();
  const beamDefs = qualityTier === "lite"
    ? [{ radiusTop: 0.5, radiusBottom: 2.8, height: 22, opacity: 0.06, offsetX: 0 }]
    : [
        { radiusTop: 0.55, radiusBottom: 3.3, height: 24, opacity: 0.08, offsetX: 0 },
        { radiusTop: 0.18, radiusBottom: 1.8, height: 22, opacity: 0.06, offsetX: -0.8 },
        { radiusTop: 0.18, radiusBottom: 1.8, height: 22, opacity: 0.06, offsetX: 0.8 },
      ];
  beamDefs.forEach((def) => {
    const geometry = new THREE.CylinderGeometry(def.radiusTop, def.radiusBottom, def.height, 40, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: colors.value.dnaHighlight,
      transparent: true,
      opacity: def.opacity,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(geometry, material);
    beam.position.set(def.offsetX, 0, -5.2);
    volumetricBeamMaterials.push(material);
    volumetricBeamGroup.add(beam);
  });
  scene.add(volumetricBeamGroup);
};

const createGodRays = () => {
  godRayGroup = new THREE.Group();
  const texture = getBeamTexture();
  if (qualityTier === "lite") {
    scene.add(godRayGroup);
    return;
  }
  const rayCount = qualityTier === "high" ? 2 : 1;
  for (let i = 0; i < rayCount; i++) {
    const width = 0.9 + Math.random() * 0.4;
    const geometry = new THREE.PlaneGeometry(width, 28);
    const material = new THREE.MeshBasicMaterial({
      color: colors.value.dnaHighlight,
      map: texture ?? undefined,
      transparent: true,
      opacity: 0.015,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((Math.random() - 0.5) * 3.2, 0, -8.4 - Math.random() * 0.8);
    mesh.rotation.z = (Math.random() - 0.5) * 0.18;
    mesh.rotation.y = (Math.random() - 0.5) * 0.08;
    godRayMaterials.push(material);
    godRaySweepers.push({
      mesh,
      speed: 0.03 + Math.random() * 0.05,
      phase: Math.random() * Math.PI * 2,
    });
    godRayGroup.add(mesh);
  }
  scene.add(godRayGroup);
};

const createHelixShockRings = () => {
  const geometry = new THREE.TorusGeometry(DNA_RADIUS + 0.9, 0.02, 8, 64);
  const ringCount = qualityTier === "high" ? 3 : qualityTier === "balanced" ? 2 : 1;
  for (let i = 0; i < ringCount; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: colors.value.dnaHighlight,
      transparent: true,
      opacity: 0.08,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2 + i * 0.08;
    mesh.position.y = (Math.random() - 0.5) * DNA_HEIGHT;
    dnaGroup.add(mesh);
    helixShockRings.push({
      mesh,
      speed: 0.08 + Math.random() * 0.04,
      phase: Math.random(),
    });
  }
};

// Create Molecules
const createMolecules = () => {
  moleculeMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.value.molecule,
    roughness: 0.2,
    metalness: 0.1,
    transmission: 0.6,
    thickness: 0.8,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });

  const geometry = new THREE.IcosahedronGeometry(0.4, 1); // Increased detail

  for (let i = 0; i < MOLECULE_COUNT; i++) {
    const mesh = new THREE.Mesh(geometry, moleculeMaterial);
    const px = (Math.random() - 0.5) * 20;
    const py = (Math.random() - 0.5) * 20;
    const pz = (Math.random() - 0.5) * 10 - 5;
    mesh.position.set(px, py, pz);
    mesh.userData = {
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02
      ),
      rotationSpeed: new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02
      ),
      floatOffset: Math.random() * Math.PI * 2,
      floatSpeed: 0.5 + Math.random() * 0.5,
      basePosition: new THREE.Vector3(px, py, pz),
      label: `Molecule ${i + 1}`,
    };
    moleculesGroup.add(mesh);
  }
};

const createEnergyCarriers = () => {
  const carrierCount = qualityTier === "high" ? 12 : qualityTier === "balanced" ? 9 : 6;
  const geo = new THREE.SphereGeometry(0.08, 16, 16);
  const mat = new THREE.MeshPhysicalMaterial({
    color: colors.value.dnaHighlight,
    emissive: colors.value.dnaHighlight,
    emissiveIntensity: isDark.value ? 0.3 : 0.18,
    roughness: 0.2,
    metalness: 0.0,
    transmission: 0.4,
    thickness: 0.6,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });
  for (let i = 0; i < carrierCount; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    const strand = i % 2;
    const s = Math.random() * DNA_LENGTH;
    const speed = 0.02 + Math.random() * 0.01;
    energyCarriers.push({ mesh, s, strand, speed });
    dnaGroup.add(mesh);
  }
};

const createRings = () => {
  ringGroup = new THREE.Group();
  const radii = [3.2, 4.6];
  radii.forEach((r, idx) => {
    const torusGeo = new THREE.TorusGeometry(r, 0.04, 16, 64);
    const torusMat = new THREE.MeshPhysicalMaterial({
      color: colors.value.dnaHighlight,
      transparent: true,
      opacity: 0.08,
      roughness: 0.4,
      metalness: 0.0,
    });
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.rotation.x = Math.PI / 2.5 + idx * 0.15;
    torus.rotation.z = Math.PI / 8;
    ringGroup.add(torus);
    for (let j = 0; j < 4; j++) {
      const orbGeo = new THREE.SphereGeometry(0.06, 12, 12);
      const orbMat = new THREE.MeshPhysicalMaterial({
        color: colors.value.dna,
        emissive: colors.value.dna,
        emissiveIntensity: isDark.value ? 0.2 : 0.1,
      });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      ringOrbs.push({ mesh: orb, r, speed: 0.4 + Math.random() * 0.3, phase: Math.random() * Math.PI * 2 });
      ringGroup.add(orb);
    }
  });
  ringGroup.position.set(0, 0, 0);
  dnaGroup.add(ringGroup);
};

const createAntibody = () => {
  antibodyGroup = new THREE.Group();
  antibodyMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.value.molecule,
    roughness: 0.15,
    metalness: 0.1,
    transmission: 0.6,
    thickness: 1.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    ior: 1.45,
  });
  lightChainMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.value.dnaHighlight,
    roughness: 0.2,
    metalness: 0.05,
    transmission: 0.5,
    thickness: 0.9,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    ior: 1.4,
  });
  disulfideMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.value.dnaHighlight,
    roughness: 0.18,
    metalness: 0.2,
    transmission: 0.2,
    thickness: 0.6,
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.85,
  });

  // Stem (Fc region)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 16), antibodyMaterial);
  stem.position.set(0, -0.2, 0);

  // Hinge Region (Flexible joint)
  const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), antibodyMaterial);
  hinge.position.set(0, 0.2, 0);

  const upAxis = new THREE.Vector3(0, 1, 0);
  const buildFabCurve = (side: number, xOffset: number, zOffset: number, yOffset: number) =>
    new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(side * (0.08 + xOffset), 0.18 + yOffset, zOffset),
        new THREE.Vector3(side * (0.22 + xOffset), 0.36 + yOffset, zOffset + 0.02),
        new THREE.Vector3(side * (0.36 + xOffset), 0.54 + yOffset, zOffset + 0.04),
        new THREE.Vector3(side * (0.52 + xOffset), 0.74 + yOffset, zOffset + 0.05),
      ],
      false,
      "catmullrom",
      0.5
    );
  const alignToCurve = (mesh: THREE.Mesh, curve: THREE.CatmullRomCurve3, t: number) => {
    const tangent = curve.getTangent(t).normalize();
    mesh.quaternion.setFromUnitVectors(upAxis, tangent);
    mesh.position.copy(curve.getPoint(t));
  };
  const makeChain = (
    curve: THREE.CatmullRomCurve3,
    radius: number,
    material: THREE.MeshPhysicalMaterial
  ) => new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 12, false), material);

  // Heavy chains (curved)
  const heavyCurveL = buildFabCurve(-1, 0, 0, 0);
  const heavyCurveR = buildFabCurve(1, 0, 0, 0);
  const heavyL = makeChain(heavyCurveL, 0.045, antibodyMaterial);
  const heavyR = makeChain(heavyCurveR, 0.045, antibodyMaterial);

  // Light chains (parallel to heavy chains, slightly offset)
  const lightCurveL = buildFabCurve(-1, 0.06, 0.08, -0.05);
  const lightCurveR = buildFabCurve(1, 0.06, 0.08, -0.05);
  const lightL = makeChain(lightCurveL, 0.032, lightChainMaterial);
  const lightR = makeChain(lightCurveR, 0.032, lightChainMaterial);

  // Antigen Binding Sites (Variable regions)
  const tipGeo = new THREE.CapsuleGeometry(0.06, 0.15, 4, 8);
  const tipL = new THREE.Mesh(tipGeo, antibodyMaterial);
  const tipR = new THREE.Mesh(tipGeo, antibodyMaterial);
  alignToCurve(tipL, heavyCurveL, 1);
  alignToCurve(tipR, heavyCurveR, 1);

  const lightTipGeo = new THREE.CapsuleGeometry(0.045, 0.12, 4, 8);
  const lightTipL = new THREE.Mesh(lightTipGeo, lightChainMaterial);
  const lightTipR = new THREE.Mesh(lightTipGeo, lightChainMaterial);
  alignToCurve(lightTipL, lightCurveL, 1);
  alignToCurve(lightTipR, lightCurveR, 1);

  // Disulfide bonds / chain connections
  const bondGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 10);
  const bondCapGeo = new THREE.SphereGeometry(0.03, 10, 10);
  const addBond = (a: THREE.Vector3, b: THREE.Vector3) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    if (length < 0.05) return;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const cyl = new THREE.Mesh(bondGeo, disulfideMaterial);
    cyl.scale.set(1, length, 1);
    cyl.position.copy(mid);
    cyl.quaternion.setFromUnitVectors(upAxis, dir.normalize());
    const capA = new THREE.Mesh(bondCapGeo, disulfideMaterial);
    const capB = new THREE.Mesh(bondCapGeo, disulfideMaterial);
    capA.position.copy(a);
    capB.position.copy(b);
    antibodyGroup.add(cyl, capA, capB);
  };

  // Heavy-Light chain bonds (near hinge and near tip)
  addBond(heavyCurveL.getPoint(0.25), lightCurveL.getPoint(0.25));
  addBond(heavyCurveL.getPoint(0.7), lightCurveL.getPoint(0.7));
  addBond(heavyCurveR.getPoint(0.25), lightCurveR.getPoint(0.25));
  addBond(heavyCurveR.getPoint(0.7), lightCurveR.getPoint(0.7));
  // Heavy-heavy hinge bond
  addBond(heavyCurveL.getPoint(0.12), heavyCurveR.getPoint(0.12));

  antibodyGroup.add(
    stem,
    hinge,
    heavyL,
    heavyR,
    lightL,
    lightR,
    tipL,
    tipR,
    lightTipL,
    lightTipR
  );
  antibodyGroup.position.set(-2.4, 0.6, 1.2);
  
  // Initial random rotation
  antibodyGroup.rotation.x = Math.PI / 12;
  antibodyGroup.rotation.z = -Math.PI / 16;
  
  scene.add(antibodyGroup);
};

const createConnections = () => {
  maxConnectionSegments = MOLECULE_COUNT * (MOLECULE_COUNT - 1);
  connectionsGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxConnectionSegments * 2 * 3);
  connectionsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  connectionsGeometry.setDrawRange(0, 0);
  connectionsMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(colors.value.dna),
    transparent: true,
    opacity: 0.25,
  });
  connectionsLines = new THREE.LineSegments(connectionsGeometry, connectionsMaterial);
  scene.add(connectionsLines);
};

const updateConnections = () => {
  if (!connectionsGeometry || !moleculesGroup) return;
  const attr = connectionsGeometry.getAttribute("position") as THREE.BufferAttribute;
  let offset = 0;
  const threshold = 6;
  const children = moleculesGroup.children as THREE.Mesh[];
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i].position;
      const b = children[j].position;
      const dist = a.distanceTo(b);
      if (dist < threshold) {
        attr.array[offset++] = a.x;
        attr.array[offset++] = a.y;
        attr.array[offset++] = a.z;
        attr.array[offset++] = b.x;
        attr.array[offset++] = b.y;
        attr.array[offset++] = b.z;
      }
    }
  }
  attr.needsUpdate = true;
  connectionsGeometry.setDrawRange(0, offset / 3);
};
// Create Background Particles (Cells/Dust)
const createParticles = () => {
  particleMaterial = new THREE.MeshStandardMaterial({
    color: colors.value.particle,
    transparent: true,
    opacity: 0.25,
  });

  const geometry = new THREE.SphereGeometry(0.1, 8, 8);
  const particleCount = Math.max(24, Math.floor(PARTICLE_COUNT * (qualityTier === "high" ? 1 : qualityTier === "balanced" ? 0.75 : 0.55)));
  particlesMesh = new THREE.InstancedMesh(
    geometry,
    particleMaterial,
    particleCount
  );

  const dummy = new THREE.Object3D();
  for (let i = 0; i < particleCount; i++) {
    dummy.position.set(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 20 - 10
    );
    dummy.scale.setScalar(Math.random() * 2 + 0.5);
    dummy.updateMatrix();
    particlesMesh.setMatrixAt(i, dummy.matrix);
  }

  scene.add(particlesMesh);
};

// Create Dust (Small floating sparkles)
const createDust = () => {
  const dustCount = qualityTier === "high" ? 100 : qualityTier === "balanced" ? 70 : 42;
  const positions = new Float32Array(dustCount * 3);
  const velocities: { x: number; y: number; z: number }[] = [];

  for (let i = 0; i < dustCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

    velocities.push({
      x: (Math.random() - 0.5) * 0.05,
      y: (Math.random() - 0.5) * 0.05,
      z: (Math.random() - 0.5) * 0.02,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: colors.value.particle,
    size: 0.3, // Larger for visibility
    transparent: true,
    opacity: isDark.value ? 0.9 : 0.6,
    // Normal blending is better for dark particles on white background
    blending: isDark.value ? THREE.AdditiveBlending : THREE.NormalBlending,
    map: getParticleTexture(),
    depthWrite: false,
  });

  dustPoints = new THREE.Points(geometry, material);
  dustPoints.userData = { velocities };
  scene.add(dustPoints);
};

// Animation Loop
const animate = () => {
  animationId = requestAnimationFrame(animate);

  const time = clock.getElapsedTime();

  // Rotate DNA (with Scroll Influence)
  if (dnaGroup) {
    const scrollFactor = Math.min(Math.max(scrollY.value / 1400, 0), 1);
    dnaGroup.rotation.y = time * 0.22 + scrollY.value * 0.0022;
    dnaGroup.rotation.x = Math.PI / 6 + scrollY.value * 0.0008;
    dnaGroup.rotation.z = Math.PI / 6 + Math.sin(time * 0.7) * 0.05;
    dnaGroup.position.y = Math.sin(time * 0.5) * 0.5;
    const scale = (1 + Math.sin(time * 1.8) * 0.03 + scrollFactor * 0.04) * 0.9;
    dnaGroup.scale.set(scale, scale, scale);
  }
  const motionScale = qualityTier === "high" ? 1 : qualityTier === "balanced" ? 0.82 : 0.62;
  const pulse = (Math.sin(time * (1.4 * motionScale)) + 1) * 0.5;
  const breathingWave =
    Math.sin(time * (0.32 * motionScale)) * 0.25 +
    Math.sin(time * (0.14 * motionScale)) * 0.12;
  helixShockRings.forEach((item) => {
    const travel = ((time * item.speed + item.phase) % 1) - 0.5;
    item.mesh.position.y = travel * DNA_HEIGHT;
    const s = 1 + Math.sin(time * 3.2 + item.phase * Math.PI * 2) * 0.12;
    item.mesh.scale.setScalar(1 + (s - 1) * 0.55);
    const material = item.mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.035 + pulse * 0.06;
  });
  if (dnaAuraMaterial && dnaAura) {
    dnaAura.rotation.y = -time * 0.18 * motionScale;
    dnaAura.rotation.x = Math.sin(time * 0.4 * motionScale) * 0.08 * motionScale;
    dnaAuraMaterial.size = (isDark.value ? 0.16 : 0.13) + pulse * 0.02;
    dnaAuraMaterial.opacity = (isDark.value ? 0.14 : 0.1) + pulse * 0.05;
  }
  if (depthLayerNear && depthLayerFar) {
    depthLayerNear.rotation.y = -time * 0.06 * motionScale;
    depthLayerNear.rotation.x = Math.sin(time * 0.22 * motionScale) * 0.03 * motionScale;
    depthLayerFar.rotation.y = time * 0.04 * motionScale;
    depthLayerFar.rotation.x = Math.cos(time * 0.18 * motionScale) * 0.03 * motionScale;
  }
  if (volumetricBeamGroup) {
    volumetricBeamGroup.rotation.y = Math.sin(time * 0.08 * motionScale) * 0.015 * motionScale;
    volumetricBeamGroup.position.y = Math.sin(time * 0.2 * motionScale) * 0.05 * motionScale;
    volumetricBeamMaterials.forEach((material, idx) => {
      material.opacity = 0.03 + pulse * 0.018 + idx * 0.006;
    });
  }
  if (godRayGroup) {
    godRayGroup.rotation.y = Math.sin(time * 0.06 * motionScale) * 0.015 * motionScale;
    godRaySweepers.forEach((item, idx) => {
      const sweep = Math.sin(time * item.speed * motionScale + item.phase);
      item.mesh.position.x = sweep * (0.8 + idx * 0.05);
      item.mesh.rotation.z = sweep * 0.03;
      item.mesh.scale.x = 0.95 + (sweep + 1) * 0.06;
      const material = item.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.01 + pulse * 0.012 + Math.max(0, sweep) * 0.012;
    });
  }
  energyCarriers.forEach((c) => {
    c.s += c.speed;
    if (c.s > DNA_LENGTH) c.s -= DNA_LENGTH;
    const angle = c.s * DNA_ANGLE_STEP + (c.strand ? Math.PI : 0);
    const y = (c.s - DNA_HALF) * DNA_STEP;
    c.mesh.position.set(Math.cos(angle) * DNA_RADIUS, y, Math.sin(angle) * DNA_RADIUS);
  });
  ringOrbs.forEach((o) => {
    const a = time * o.speed + o.phase;
    o.mesh.position.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r);
  });
  if (antibodyGroup) {
    antibodyGroup.position.y = 0.6 + Math.sin(time * 0.6) * 0.12;
    antibodyGroup.rotation.y = Math.sin(time * 0.25) * 0.12;
  }

  // Animate Molecules
  moleculesGroup.children.forEach((child) => {
    const mesh = child as THREE.Mesh;

    // Update Pulse
    if (mesh.userData.pulse) {
      mesh.scale.lerp(new THREE.Vector3(1.5, 1.5, 1.5), 0.1);
      if (mesh.scale.x > 1.4) mesh.userData.pulse = false;
    } else if (mesh.userData.hover) {
      mesh.scale.lerp(new THREE.Vector3(1.2, 1.2, 1.2), 0.12);
    } else {
      mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
    }

    const progress = Math.min(Math.max(scrollY.value / 1200, 0), 1);
    const cluster = new THREE.Vector3(0, 0, -3);
    const base: THREE.Vector3 = mesh.userData.basePosition ?? mesh.position.clone();
    const target = base.clone().lerp(cluster, 1 - progress);
    const floatY =
      Math.sin(time * mesh.userData.floatSpeed + mesh.userData.floatOffset) * 0.005;
    const desired = target.clone().add(new THREE.Vector3(0, floatY, 0));
    mesh.position.lerp(desired, 0.06);
    mesh.position.add(mesh.userData.velocity.multiplyScalar(0.98));
    mesh.rotation.x += mesh.userData.rotationSpeed.x;
    mesh.rotation.y += mesh.userData.rotationSpeed.y;
    mesh.rotation.z += mesh.userData.rotationSpeed.z;

    // Subtle floating applied in desired

    // Boundary check (simple bounce)
    if (Math.abs(mesh.position.x) > 15) mesh.userData.velocity.x *= -1;
    if (Math.abs(mesh.position.y) > 15) mesh.userData.velocity.y *= -1;
  });

  // Animate Dust
  if (dustPoints) {
    const positions = dustPoints.geometry.attributes.position
      .array as Float32Array;
    const velocities = dustPoints.userData.velocities;

    for (let i = 0; i < velocities.length; i++) {
      positions[i * 3] += velocities[i].x;
      positions[i * 3 + 1] += velocities[i].y;
      positions[i * 3 + 2] += velocities[i].z;

      // Wrap around
      if (positions[i * 3] > 20) positions[i * 3] = -20;
      if (positions[i * 3] < -20) positions[i * 3] = 20;
      if (positions[i * 3 + 1] > 20) positions[i * 3 + 1] = -20;
      if (positions[i * 3 + 1] < -20) positions[i * 3 + 1] = 20;
    }
    dustPoints.geometry.attributes.position.needsUpdate = true;
    dustPoints.rotation.y = time * 0.05;
  }

  // Mouse Parallax
  const targetX = (mouse.x.value / window.innerWidth) * 2 - 1;
  const targetY = -(mouse.y.value / window.innerHeight) * 2 + 1;

  // Update Mouse Light
  if ((scene as any).userData.mouseLight) {
    const light = (scene as any).userData.mouseLight as THREE.PointLight;
    // Map -1 to 1 screen coords to world coords roughly
    // Assuming camera Z=15, light Z=5, fov=60
    // At Z=5, view height is approx 2 * (15-5) * tan(30deg) = 11.5
    // View width is approx 11.5 * aspect ratio
    const aspect = window.innerWidth / window.innerHeight;
    light.position.x += (targetX * 10 * aspect - light.position.x) * 0.1;
    light.position.y += (targetY * 10 - light.position.y) * 0.1;
  }

  if (dnaMaterial) {
    const centerDistance = Math.hypot(targetX, targetY);
    const boost = Math.max(0, 1 - centerDistance);
    const base = isDark.value ? 0.15 : 0.05;
    const scrollFactor = Math.min(Math.max(scrollY.value / 1400, 0), 1);
    const energy = boost * 0.18 + pulse * (0.18 * motionScale) + scrollFactor * 0.16;
    dnaMaterial.emissiveIntensity = base + energy * 0.08;
    bloomPass.strength = 0.17 + energy * 0.12;
    bloomPass.radius = 0.48 + energy * 0.08;
    bloomPass.threshold = 0.24 - boost * 0.01;
    const bokehUniforms = bokehPass.uniforms as Record<string, { value: number }>;
    bokehUniforms.focus.value = 14.65 - energy * 0.18 + breathingWave * 0.03;
    bokehUniforms.maxblur.value =
      (qualityTier === "high" ? 0.0022 : qualityTier === "balanced" ? 0.0018 : 0.0013) +
      energy * 0.0005 +
      Math.max(0, breathingWave) * 0.00018;
  }

  if (lastHovered && containerRef.value && camera) {
    const rect = containerRef.value.getBoundingClientRect();
    const p = lastHovered.position.clone().project(camera);
    const x = ((p.x + 1) / 2) * rect.width;
    const y = ((-p.y + 1) / 2) * rect.height - 24;
    hoverLabel.value.visible = true;
    hoverLabel.value.text = lastHovered.userData?.label ?? "Molecule";
    hoverLabel.value.style = {
      transform: `translate(${x}px, ${y}px)`,
    };
  } else {
    hoverLabel.value.visible = false;
  }

  updateConnections();

  // Smoother, more subtle parallax
  camera.position.x += (targetX * 1.0 - camera.position.x) * 0.03;
  camera.position.y += (targetY * 1.0 - camera.position.y) * 0.03;
  const targetZ = 15.4 - Math.min(scrollY.value / 2200, 1) * 0.22 + Math.sin(time * 0.2) * 0.03 + breathingWave * 0.02;
  camera.position.z += (targetZ - camera.position.z) * 0.03;
  camera.setFocalLength(44.2 + breathingWave * 0.35 + pulse * 0.08);
  camera.lookAt(0, 0, 0);

  composer.render();
};

// Click Interaction
const handleClick = (event: MouseEvent) => {
  if (!moleculesGroup || !camera || !raycaster) return;

  mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouseVector, camera);
  const intersects = raycaster.intersectObjects(moleculesGroup.children);

  if (intersects.length > 0) {
    const object = intersects[0].object as THREE.Mesh;
    object.userData.pulse = true;
  }
};

// Pointer hover interaction
const handlePointerMove = (event: PointerEvent) => {
  if (!moleculesGroup || !camera || !raycaster) return;
  mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseVector, camera);
  const intersects = raycaster.intersectObjects(moleculesGroup.children);
  if (lastHovered && lastHovered.userData) {
    lastHovered.userData.hover = false;
  }
  if (intersects.length > 0) {
    const object = intersects[0].object as THREE.Mesh;
    object.userData.hover = true;
    lastHovered = object;
  } else {
    lastHovered = null;
  }
};

// Interaction
const mouse = useMouse();
const { width, height } = useWindowSize();

// Resize Handler
watch([width, height], () => {
  if (!camera || !renderer || !containerRef.value) return;
  const { width: w, height: h } = containerRef.value.getBoundingClientRect();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// Theme Watcher
watch(isDark, () => {
  if (!scene) return;

  // Update Lights (Keep bright in light mode)
  const ambientLight = scene.children.find(
    (c) => c instanceof THREE.AmbientLight
  ) as THREE.AmbientLight;
  if (ambientLight) ambientLight.intensity = isDark.value ? 0.8 : 2.5;

  const dirLights = scene.children.filter(
    (c) => c instanceof THREE.DirectionalLight
  ) as THREE.DirectionalLight[];
  if (dirLights.length > 0) dirLights[0].intensity = isDark.value ? 2 : 3.5;
  if (dirLights.length > 1) dirLights[1].intensity = isDark.value ? 0.5 : 1.5; // Fill light

  if ((scene as any).userData.mouseLight) {
    ((scene as any).userData.mouseLight as THREE.PointLight).color.set(
      colors.value.dnaHighlight
    );
  }

  if (dnaMaterial) {
    dnaMaterial.color.set(colors.value.dna);
    dnaMaterial.emissive.set(colors.value.dna);
    dnaMaterial.emissiveIntensity = isDark.value ? 0.15 : 0.05;
    dnaMaterial.attenuationColor.set(colors.value.dna);
  }
  if (moleculeMaterial) {
    moleculeMaterial.color.set(colors.value.molecule);
  }
  if (particleMaterial) {
    particleMaterial.color.set(colors.value.particle);
  }
  if (connectionsMaterial) {
    connectionsMaterial.color.set(colors.value.dna);
    connectionsMaterial.opacity = isDark.value ? 0.22 : 0.28;
  }
  if (ringGroup) {
    ringGroup.children.forEach((child) => {
      const mat = (child as any).material as THREE.MeshPhysicalMaterial | undefined;
      if (!mat) return;
      if (mat.transparent) {
        mat.opacity = isDark.value ? 0.22 : 0.28;
        mat.color.set(colors.value.dnaHighlight);
      } else {
        mat.color.set(colors.value.dna);
        mat.emissive.set(colors.value.dna);
        mat.emissiveIntensity = isDark.value ? 0.2 : 0.1;
      }
    });
  }
  helixShockRings.forEach((item) => {
    const material = item.mesh.material as THREE.MeshBasicMaterial;
    material.color.set(colors.value.dnaHighlight);
  });
  if (dnaAuraMaterial) {
    dnaAuraMaterial.color.set(colors.value.dnaHighlight);
    dnaAuraMaterial.opacity = isDark.value ? 0.14 : 0.1;
    dnaAuraMaterial.size = isDark.value ? 0.16 : 0.13;
  }
  if (depthLayerNearMaterial && depthLayerFarMaterial) {
    depthLayerNearMaterial.color.set(colors.value.dnaHighlight);
    depthLayerNearMaterial.opacity = isDark.value ? 0.14 : 0.1;
    depthLayerNearMaterial.size = isDark.value ? 0.35 : 0.28;
    depthLayerFarMaterial.color.set(colors.value.dna);
    depthLayerFarMaterial.opacity = isDark.value ? 0.1 : 0.07;
    depthLayerFarMaterial.size = isDark.value ? 0.45 : 0.34;
  }
  if (volumetricBeamMaterials.length > 0) {
    volumetricBeamMaterials.forEach((material) => {
      material.color.set(colors.value.dnaHighlight);
      material.opacity = isDark.value ? 0.035 : 0.03;
    });
  }
  if (godRayMaterials.length > 0) {
    godRayMaterials.forEach((material) => {
      material.color.set(colors.value.dnaHighlight);
      material.opacity = isDark.value ? 0.014 : 0.01;
    });
  }
  if (antibodyMaterial) {
    antibodyMaterial.color.set(colors.value.molecule);
  }
  if (lightChainMaterial) {
    lightChainMaterial.color.set(colors.value.dnaHighlight);
  }
  if (disulfideMaterial) {
    disulfideMaterial.color.set(colors.value.dnaHighlight);
    disulfideMaterial.opacity = isDark.value ? 0.78 : 0.85;
  }
  if (dustPoints) {
    (dustPoints.material as THREE.PointsMaterial).color.set(
      colors.value.particle
    );
    (dustPoints.material as THREE.PointsMaterial).blending = isDark.value
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;
    (dustPoints.material as THREE.PointsMaterial).opacity = isDark.value
      ? 0.9
      : 0.6;
  }
});

// Lifecycle
onMounted(() => {
  window.addEventListener("click", handleClick);
  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Simulate loading
  const interval = setInterval(() => {
    loadProgress.value += 10;
    if (loadProgress.value >= 100) {
      clearInterval(interval);
      initScene();
    }
  }, 100);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleClick);
  window.removeEventListener("pointermove", handlePointerMove as any);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  cancelAnimationFrame(animationId);

  // Dispose Scene Resources
  if (scene) {
    scene.traverse((object) => {
      const disposable = object as unknown as {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (disposable.geometry) {
        disposable.geometry.dispose();
      }
      if (disposable.material) {
        if (Array.isArray(disposable.material)) {
          disposable.material.forEach((m) => m.dispose());
        } else {
          disposable.material.dispose();
        }
      }
    });
    scene.clear();
  }
  if (renderer) {
    renderer.dispose();
  }
  if (composer) {
    composer.dispose();
  }
});
</script>

<style scoped lang="scss">
.bio-3d-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  overflow: hidden;
  pointer-events: none; /* Allow clicks to pass through to content */

  &.is-loading {
    z-index: 100; /* Show loader on top initially if needed, or keep -1 */
    background: var(--c-bg);
  }
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.bio-3d-loader {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--c-text);
  font-family: var(--font-family);
  z-index: 10;
}

.bio-3d-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--c-brand);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.bio-3d-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background:
    radial-gradient(1200px circle at 80% 20%, rgba(226, 244, 255, 0.55), transparent 62%),
    radial-gradient(1000px circle at 20% 80%, rgba(102, 214, 164, 0.24), transparent 64%);
  opacity: 0.6;
  pointer-events: none;
}

.bio-3d-label {
  position: absolute;
  min-width: 120px;
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.25);
  background: rgba(255, 255, 255, 0.85);
  color: #1a365d;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  transform: translate(-50%, -100%);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
  pointer-events: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
</style>
