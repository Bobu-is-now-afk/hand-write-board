const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- Camera preview overlay ---
const cameraPreview = document.getElementById('camera-preview');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
let previewVisible = false;

// ------------------------------------------------------------------
// Camera preview rendering — draws video + landmarks on small overlay
// ------------------------------------------------------------------
function drawCameraPreview(results) {
  if (!previewVisible) {
    cameraPreview.classList.remove('hidden');
    previewVisible = true;
  }

  const pw = cameraPreview.clientWidth;
  const ph = cameraPreview.clientHeight;
  // Match canvas to container
  if (previewCanvas.width !== pw || previewCanvas.height !== ph) {
    previewCanvas.width = pw;
    previewCanvas.height = ph;
  }

  previewCtx.save();

  // Clear
  previewCtx.clearRect(0, 0, pw, ph);

  // Draw video frame (mirrored if front camera)
  if (isMirrored) {
    previewCtx.translate(pw, 0);
    previewCtx.scale(-1, 1);
    previewCtx.drawImage(video, 0, 0, pw, ph);
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    previewCtx.drawImage(video, 0, 0, pw, ph);
  }

  // Draw landmarks if hand detected
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    const indexUp = isIndexUpGesture(landmarks);
    drawLandmarksOnPreview(landmarks, pw, ph, indexUp);

    // Visual status indicator — green border when Index Up gesture detected
    if (indexUp) {
      cameraPreview.style.borderColor = 'rgba(100, 255, 100, 0.8)';
      cameraPreview.style.boxShadow = '0 0 16px rgba(100, 255, 100, 0.4)';
    } else {
      cameraPreview.style.borderColor = 'rgba(255, 200, 50, 0.5)';
      cameraPreview.style.boxShadow = '0 0 8px rgba(255, 200, 50, 0.2)';
    }
  } else {
    // Red border when no hand
    cameraPreview.style.borderColor = 'rgba(255, 80, 80, 0.5)';
    cameraPreview.style.boxShadow = '0 0 8px rgba(255, 80, 80, 0.2)';
  }

  previewCtx.restore();
}

// MediaPipe hand skeleton connections
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],       // thumb
  [0,5],[5,6],[6,7],[7,8],       // index
  [5,9],[9,10],[10,11],[11,12],  // middle
  [9,13],[13,14],[14,15],[15,16],// ring
  [13,17],[17,18],[18,19],[19,20],// pinky
  [0,17]                           // palm base
];

function drawLandmarksOnPreview(landmarks, pw, ph, indexUp) {
  previewCtx.save();

  // Mirror x-coordinates for preview if front camera
  const getX = (lm) => isMirrored ? (1 - lm.x) * pw : lm.x * pw;
  const getY = (lm) => lm.y * ph;

  // Draw skeleton connections
  previewCtx.strokeStyle = 'rgba(0, 255, 150, 0.7)';
  previewCtx.lineWidth = 2;
  previewCtx.lineCap = 'round';
  previewCtx.lineJoin = 'round';

  for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
    const start = landmarks[startIdx];
    const end = landmarks[endIdx];
    previewCtx.beginPath();
    previewCtx.moveTo(getX(start), getY(start));
    previewCtx.lineTo(getX(end), getY(end));
    previewCtx.stroke();
  }

  // Draw landmark dots
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const x = getX(lm);
    const y = getY(lm);

    // Highlight index tip (8) specially — the writing tip
    const isIndexTip = (i === 8);
    const radius = isIndexTip ? 6 : 3;
    const color = isIndexTip
      ? (indexUp ? 'rgba(100, 255, 100, 0.95)' : 'rgba(255, 200, 50, 0.95)')
      : 'rgba(0, 255, 150, 0.8)';

    previewCtx.fillStyle = color;
    previewCtx.beginPath();
    previewCtx.arc(x, y, radius, 0, Math.PI * 2);
    previewCtx.fill();

    // White outline for index tip
    if (isIndexTip) {
      previewCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      previewCtx.lineWidth = 2;
      previewCtx.stroke();
    }
  }

  // Draw gesture indicator text
  previewCtx.fillStyle = indexUp ? 'rgba(100, 255, 100, 0.9)' : 'rgba(255, 200, 50, 0.7)';
  previewCtx.font = 'bold 11px "SF Mono", monospace';
  previewCtx.textAlign = 'center';
  previewCtx.fillText(indexUp ? 'INDEX UP ✓' : 'INDEX UP ?', pw / 2, ph - 6);

  previewCtx.restore();
}

// --- Blackboard config ---
const BLACKBOARD_COLOR = '#1a2921';

// Chalk color palette
const CHALK_COLORS = [
  { name: 'White',  hex: '#fcf9ea' },
  { name: 'Yellow', hex: '#ffeb79' },
  { name: 'Cyan',   hex: '#93d4e8' },
  { name: 'Pink',   hex: '#fca1a1' }
];

let chalkColorIndex = 0;
let eraserMode = false;
let penDown = false;
let spaceHeld = false;

// Gesture detection: "Index Up / Number 1" — index extended, others curled
let wasDrawing = false;

// Stroke storage
let strokes = [];
let currentStroke = null;

// Smoothing — EMA (Exponential Moving Average) for anti-jitter
let smoothX = null;
let smoothY = null;
const SMOOTH_ALPHA = 0.55; // 0.0 = max smoothing, 1.0 = raw

let prevX = null;
let prevY = null;

// --- Camera state ---
let currentFacingMode = 'user'; // "user" (front) or "environment" (rear)
let isMirrored = true;          // mirror only when front camera
let cameraStream = null;
let cameraStarted = false;
let isMobile = false;

// --- Wake lock ---
let wakeLock = null;

// --- DOM elements ---
const hudMode = document.getElementById('hud-mode');
const hudStatus = document.getElementById('hud-status');
const hudCamera = document.getElementById('hud-camera');
const toolbar = document.getElementById('toolbar');
const toolbarCollapsed = document.getElementById('toolbar-collapsed');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const landscapeHint = document.getElementById('landscape-hint');
const btnCollapse = document.getElementById('btn-collapse');
const btnEraser = document.getElementById('btn-eraser');
const btnUndo = document.getElementById('btn-undo');
const btnClear = document.getElementById('btn-clear');
const btnCamera = document.getElementById('btn-camera');
const btnFullscreen = document.getElementById('btn-fullscreen');
const colorSwatches = document.querySelectorAll('.color-swatch');

// ------------------------------------------------------------------
// Mobile detection
// ------------------------------------------------------------------
function detectMobile() {
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}
isMobile = detectMobile();

// ------------------------------------------------------------------
// Canvas resize — preserves stroke positions proportionally
// ------------------------------------------------------------------
function resizeCanvas() {
  const oldWidth = canvas.width || window.innerWidth;
  const oldHeight = canvas.height || window.innerHeight;

  // Use visualViewport for accurate mobile dimensions (accounts for address bar)
  const w = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;

  canvas.width = w;
  canvas.height = h;

  const scaleX = canvas.width / oldWidth;
  const scaleY = canvas.height / oldHeight;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      point.x *= scaleX;
      point.y *= scaleY;
    }
  }

  if (smoothX !== null) smoothX *= scaleX;
  if (smoothY !== null) smoothY *= scaleY;
  if (prevX !== null) prevX *= scaleX;
  if (prevY !== null) prevY *= scaleY;
}

resizeCanvas();

// Use visualViewport resize for mobile address bar changes
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeCanvas);
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 200);
  checkOrientation();
});

// ------------------------------------------------------------------
// Orientation check — show landscape hint in portrait on mobile
// ------------------------------------------------------------------
function checkOrientation() {
  if (!isMobile) {
    landscapeHint.classList.add('hidden');
    return;
  }
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  if (isPortrait && cameraStarted) {
    landscapeHint.classList.remove('hidden');
  } else {
    landscapeHint.classList.add('hidden');
  }
}

// ------------------------------------------------------------------
// Screen Wake Lock — prevents auto-lock during drawing sessions
// ------------------------------------------------------------------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      // Re-acquire on visibility change (e.g. tab switch)
      document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
          try {
            wakeLock = await navigator.wakeLock.request('screen');
          } catch (err) {
            console.warn('Wake lock re-acquire failed:', err);
          }
        }
      });
    }
  } catch (err) {
    console.warn('Wake lock failed:', err);
  }
}

// ------------------------------------------------------------------
// Fullscreen toggle
// ------------------------------------------------------------------
async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.error('Fullscreen failed:', err);
  }
}

// ------------------------------------------------------------------
// Clear blackboard
// ------------------------------------------------------------------
function clearBlackboard() {
  strokes = [];
  currentStroke = null;
  prevX = null;
  prevY = null;
}

// ------------------------------------------------------------------
// Undo — remove last stroke
// ------------------------------------------------------------------
function undoStroke() {
  if (strokes.length > 0) {
    strokes.pop();
    currentStroke = null;
    penDown = false;
    prevX = null;
    prevY = null;
  }
}

// ------------------------------------------------------------------
// Set chalk color
// ------------------------------------------------------------------
function setChalkColor(index) {
  chalkColorIndex = index;
  eraserMode = false;
  // Update UI
  colorSwatches.forEach((sw, i) => {
    sw.classList.toggle('active', i === index);
  });
  btnEraser.classList.remove('active');
  updateHUD();
}

// ------------------------------------------------------------------
// Toggle eraser
// ------------------------------------------------------------------
function toggleEraser() {
  eraserMode = !eraserMode;
  btnEraser.classList.toggle('active', eraserMode);
  updateHUD();
}

// ------------------------------------------------------------------
// Camera switching — front <-> rear with track cleanup
// ------------------------------------------------------------------
async function switchCamera() {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  isMirrored = (currentFacingMode === 'user');
  hudCamera.textContent = `Cam: ${currentFacingMode === 'user' ? 'Front' : 'Rear'}`;

  // Update video mirror CSS
  video.style.transform = isMirrored ? 'scaleX(-1)' : 'scaleX(1)';

  // Stop existing camera
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (typeof camera !== 'undefined' && camera) {
    try { camera.stop(); } catch (e) {}
  }

  await startCamera();
}

// ------------------------------------------------------------------
// Start camera stream with facingMode constraint
// ------------------------------------------------------------------
async function startCamera() {
  const constraints = {
    video: {
      facingMode: { ideal: currentFacingMode },
      width: { ideal: 640 },
      height: { ideal: 480 }
    },
    audio: false
  };

  // Use lower resolution on mobile to reduce thermal throttling
  if (isMobile) {
    constraints.video.width = { ideal: 640 };
    constraints.video.height = { ideal: 480 };
  } else {
    constraints.video.width = { ideal: 1280 };
    constraints.video.height = { ideal: 720 };
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = cameraStream;

    // Wait for video to be ready
    await new Promise(resolve => {
      if (video.readyState >= 2) resolve();
      else video.addEventListener('loadeddata', resolve, { once: true });
    });

    cameraStarted = true;
    checkOrientation();

    // Start MediaPipe processing loop
    startProcessingLoop();
  } catch (err) {
    console.error('Camera start failed:', err);
    // Fallback: try without facingMode constraint
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = cameraStream;
      await new Promise(resolve => {
        if (video.readyState >= 2) resolve();
        else video.addEventListener('loadeddata', resolve, { once: true });
      });
      cameraStarted = true;
      startProcessingLoop();
    } catch (err2) {
      console.error('Camera fallback failed:', err2);
    }
  }
}

// ------------------------------------------------------------------
// Processing loop — sends video frames to MediaPipe Hands
// Uses requestAnimationFrame for rendering decoupled from processing
// ------------------------------------------------------------------
let processingActive = false;
async function processFrame() {
  if (!cameraStarted || !video.videoWidth) {
    requestAnimationFrame(processFrame);
    return;
  }
  try {
    await hands.send({ image: video });
  } catch (e) {
    // Hands not ready yet
  }
  requestAnimationFrame(processFrame);
}

function startProcessingLoop() {
  if (processingActive) return;
  processingActive = true;
  processFrame();
}

// ------------------------------------------------------------------
// Countdown before tracking starts (mobile UX — time to position)
// ------------------------------------------------------------------
function runCountdown(callback) {
  if (!isMobile) {
    callback();
    return;
  }
  let count = 3;
  countdownOverlay.classList.remove('hidden');
  countdownNumber.textContent = count;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      countdownNumber.textContent = count;
    } else {
      clearInterval(interval);
      countdownOverlay.classList.add('hidden');
      callback();
    }
  }, 1000);
}

// ------------------------------------------------------------------
// Keyboard controls (desktop)
// ------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();

  if (key === '1') setChalkColor(0);
  if (key === '2') setChalkColor(1);
  if (key === '3') setChalkColor(2);
  if (key === '4') setChalkColor(3);

  if (key === 'e') toggleEraser();

  if (key === 'c' || e.key === 'Backspace') {
    e.preventDefault();
    clearBlackboard();
  }

  if (key === 'z' && !e.repeat) {
    e.preventDefault();
    undoStroke();
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceHeld) spaceHeld = true;
  }

  if (key === 'f' && !e.repeat) toggleFullscreen();
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false;
});

window.addEventListener('blur', () => {
  spaceHeld = false;
  wasDrawing = false;
});

// ------------------------------------------------------------------
// Touch toolbar event listeners
// ------------------------------------------------------------------
btnCollapse.addEventListener('click', () => {
  toolbar.classList.add('hidden');
  toolbarCollapsed.classList.remove('hidden');
});

toolbarCollapsed.addEventListener('click', () => {
  toolbarCollapsed.classList.add('hidden');
  toolbar.classList.remove('hidden');
});

colorSwatches.forEach((sw) => {
  sw.addEventListener('click', () => {
    const idx = parseInt(sw.dataset.color, 10);
    setChalkColor(idx);
  });
});

btnEraser.addEventListener('click', toggleEraser);
btnUndo.addEventListener('click', undoStroke);
btnClear.addEventListener('click', clearBlackboard);
btnCamera.addEventListener('click', switchCamera);
btnFullscreen.addEventListener('click', toggleFullscreen);

// Auto-hide toolbar after inactivity (mobile)
let toolbarHideTimer = null;
function resetToolbarHideTimer() {
  if (toolbarHideTimer) clearTimeout(toolbarHideTimer);
  if (isMobile) {
    toolbarHideTimer = setTimeout(() => {
      if (!eraserMode) { // Don't auto-hide if eraser is active
        toolbar.classList.add('hidden');
        toolbarCollapsed.classList.remove('hidden');
      }
    }, 4000);
  }
}
// Touch anywhere shows toolbar again
document.addEventListener('touchstart', () => {
  if (toolbar.classList.contains('hidden')) {
    toolbar.classList.remove('hidden');
    toolbarCollapsed.classList.add('hidden');
  }
  resetToolbarHideTimer();
}, { passive: true });

// ------------------------------------------------------------------
// HUD update
// ------------------------------------------------------------------
function updateHUD() {
  if (eraserMode) {
    hudMode.textContent = 'Mode: Eraser';
  } else {
    hudMode.textContent = `Mode: Chalk [${CHALK_COLORS[chalkColorIndex].name}]`;
  }
  hudCamera.textContent = `Cam: ${currentFacingMode === 'user' ? 'Front' : 'Rear'}`;
  if (penDown) {
    hudStatus.textContent = 'Status: Drawing';
  } else if (smoothX !== null) {
    hudStatus.textContent = 'Status: Hovering';
  } else {
    hudStatus.textContent = 'Status: Idle';
  }
}

// ------------------------------------------------------------------
// Draw stored strokes
// ------------------------------------------------------------------
function drawStrokes() {
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;

    if (stroke.eraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = BLACKBOARD_COLOR;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
      ctx.shadowBlur = 2;
    }

    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------
// Draw cursor (chalk aim dot)
// ------------------------------------------------------------------
function drawCursor() {
  if (smoothX === null) return;

  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;

  if (penDown) {
    ctx.fillStyle = eraserMode ? 'rgba(255,255,255,0.8)' : CHALK_COLORS[chalkColorIndex].hex;
    ctx.shadowColor = eraserMode ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(smoothX, smoothY, 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,255,255,0.3)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(smoothX, smoothY, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
}

// ------------------------------------------------------------------
// "Index Up / Number 1" gesture detection
// Index finger extended upward, middle/ring/pinky curled into fist
// Thumb state is ignored for natural writing feel
// ------------------------------------------------------------------
function isIndexUpGesture(lm) {
  const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

  // Index extended: Tip (8) is further from Wrist (0) than PIP joint (6)
  // AND tip is above PIP (y is smaller in normalized coords)
  const indexExtended = dist(lm[8], lm[0]) > dist(lm[6], lm[0]) && lm[8].y < lm[6].y;

  // Middle, Ring, and Pinky are curled: Tips are closer to wrist than their PIP joints
  const middleCurled = dist(lm[12], lm[0]) < dist(lm[10], lm[0]);
  const ringCurled   = dist(lm[16], lm[0]) < dist(lm[14], lm[0]);
  const pinkyCurled  = dist(lm[20], lm[0]) < dist(lm[18], lm[0]);

  return indexExtended && middleCurled && ringCurled && pinkyCurled;
}

// ------------------------------------------------------------------
// EMA smoothing — apply low-pass filter to raw coordinates
// ------------------------------------------------------------------
function smoothPoint(targetX, targetY) {
  if (smoothX === null) {
    smoothX = targetX;
    smoothY = targetY;
  } else {
    smoothX = SMOOTH_ALPHA * targetX + (1 - SMOOTH_ALPHA) * smoothX;
    smoothY = SMOOTH_ALPHA * targetY + (1 - SMOOTH_ALPHA) * smoothY;
  }
  return { x: smoothX, y: smoothY };
}

function resetSmoothing() {
  smoothX = null;
  smoothY = null;
}

// ------------------------------------------------------------------
// Pinch detection — dynamic threshold based on hand depth
// Uses wrist (landmark 0) to middle knuckle (landmark 9) as reference scalar
// ------------------------------------------------------------------
function isPinching(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const wrist = landmarks[0];
  const midKnuckle = landmarks[9];

  // Reference distance = wrist to middle knuckle (hand size proxy)
  const refDx = wrist.x - midKnuckle.x;
  const refDy = wrist.y - midKnuckle.y;
  const refDist = Math.sqrt(refDx * refDx + refDy * refDy);

  // Pinch distance
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const pinchDist = Math.sqrt(dx * dx + dy * dy);

  // Dynamic threshold: ~0.65 of the reference distance, clamped
  // (accounts for hand being closer/farther from camera)
  const dynamicThreshold = Math.max(0.04, Math.min(0.08, refDist * 0.65));

  return pinchDist < dynamicThreshold;
}

// ------------------------------------------------------------------
// Main callback from MediaPipe Hands
// ------------------------------------------------------------------
function onResults(results) {
  // Draw camera preview first (with landmarks)
  drawCameraPreview(results);

  // Paint blackboard background
  ctx.fillStyle = BLACKBOARD_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw all stored strokes
  drawStrokes();

  // No hand detected
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    wasDrawing = false;
    penDown = false;
    resetSmoothing();
    prevX = null;
    prevY = null;
    updateHUD();
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const tip = landmarks[8]; // index fingertip

  // Mirror coordinate inversion — only when using front camera
  const rawX = isMirrored ? (1 - tip.x) * canvas.width : tip.x * canvas.width;
  const rawY = tip.y * canvas.height;

  // Apply EMA smoothing to kill micro-jitter
  const smoothed = smoothPoint(rawX, rawY);

  // "Index Up / Number 1" gesture detection
  const indexUp = isIndexUpGesture(landmarks);

  // Pen is down if Index Up gesture OR space held
  const shouldDraw = indexUp || spaceHeld;

  // State machine
  if (shouldDraw && !penDown) {
    penDown = true;
    currentStroke = {
      color: CHALK_COLORS[chalkColorIndex].hex,
      width: eraserMode ? 40 : 5,
      eraser: eraserMode,
      points: []
    };
    strokes.push(currentStroke);
    prevX = null;
    prevY = null;
  }

  if (shouldDraw && currentStroke) {
    currentStroke.points.push({ x: smoothed.x, y: smoothed.y });
    prevX = smoothed.x;
    prevY = smoothed.y;
  }

  if (!shouldDraw && penDown) {
    penDown = false;
    currentStroke = null;
    prevX = null;
    prevY = null;
    resetSmoothing();
  }

  drawCursor();
  updateHUD();
}

// ------------------------------------------------------------------
// MediaPipe Hands setup
// ------------------------------------------------------------------
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults(onResults);

// ------------------------------------------------------------------
// Initialize — show toolbar, start wake lock, run countdown, start camera
// ------------------------------------------------------------------
async function init() {
  // Show toolbar
  toolbar.classList.remove('hidden');

  // Request wake lock to prevent screen sleep
  await requestWakeLock();

  // Try to lock orientation to landscape on mobile (where supported)
  if (isMobile && screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock('landscape');
    } catch (e) {
      // Not supported or denied — show landscape hint instead
      console.log('Orientation lock not available, will show hint instead');
    }
  }

  // Run countdown (mobile only) then start camera
  runCountdown(async () => {
    await startCamera();
    updateHUD();
  });
}

// Start everything
init();
