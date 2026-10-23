const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- Blackboard config ---
const BLACKBOARD_COLOR = '#1a2921';

// Chalk color palette: index = mode selector (1-based via keyboard)
const CHALK_COLORS = [
  { name: 'White',  hex: '#fcf9ea' },
  { name: 'Yellow', hex: '#ffeb79' },
  { name: 'Cyan',   hex: '#93d4e8' },
  { name: 'Pink',   hex: '#fca1a1' }
];

let chalkColorIndex = 0;   // default: White
let eraserMode = false;
let penDown = false;         // true when pinch detected or space held
let spaceHeld = false;

// Pinch detection
const PINCH_THRESHOLD = 0.055; // normalized distance between thumb tip (4) & index tip (8)
let wasPinching = false;

// Stroke storage
let strokes = [];           // array of { color, width, eraser, points: [{x,y}] }
let currentStroke = null;

// Smoothing
let smoothX = null;
let smoothY = null;
let prevX = null;
let prevY = null;

// HUD elements
const hudMode = document.getElementById('hud-mode');
const hudStatus = document.getElementById('hud-status');

// ------------------------------------------------------------------
// Canvas resize — preserves stroke positions proportionally
// ------------------------------------------------------------------
function resizeCanvas() {
  const oldWidth = canvas.width || window.innerWidth;
  const oldHeight = canvas.height || window.innerHeight;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

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
window.addEventListener('resize', resizeCanvas);

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
// Keyboard controls
// ------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();

  // Color switching
  if (key === '1') { chalkColorIndex = 0; eraserMode = false; updateHUD(); }
  if (key === '2') { chalkColorIndex = 1; eraserMode = false; updateHUD(); }
  if (key === '3') { chalkColorIndex = 2; eraserMode = false; updateHUD(); }
  if (key === '4') { chalkColorIndex = 3; eraserMode = false; updateHUD(); }

  // Eraser
  if (key === 'e') { eraserMode = !eraserMode; updateHUD(); }

  // Clear
  if (key === 'c' || e.key === 'Backspace') {
    e.preventDefault();
    clearBlackboard();
  }

  // Space — fallback pen-down
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
    }
  }

  // Fullscreen
  if (key === 'f' && !e.repeat) {
    toggleFullscreen();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
  }
});

window.addEventListener('blur', () => {
  spaceHeld = false;
  wasPinching = false;
});

// ------------------------------------------------------------------
// HUD update
// ------------------------------------------------------------------
function updateHUD() {
  if (eraserMode) {
    hudMode.textContent = 'Mode: Eraser';
  } else {
    hudMode.textContent = `Mode: Chalk [${CHALK_COLORS[chalkColorIndex].name}]`;
  }
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

  // Reset composite for other drawing
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
    // Pen is down — glowing filled dot
    ctx.fillStyle = eraserMode ? 'rgba(255,255,255,0.8)' : CHALK_COLORS[chalkColorIndex].hex;
    ctx.shadowColor = eraserMode ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(smoothX, smoothY, 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Hovering — faint ring
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
// Pinch detection — distance between landmark 4 (thumb tip) & 8 (index tip)
// ------------------------------------------------------------------
function isPinching(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < PINCH_THRESHOLD;
}

// ------------------------------------------------------------------
// Main callback from MediaPipe Hands
// ------------------------------------------------------------------
function onResults(results) {
  // Paint blackboard background
  ctx.fillStyle = BLACKBOARD_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw all stored strokes
  drawStrokes();

  // No hand detected
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    wasPinching = false;
    penDown = false;
    smoothX = null;
    smoothY = null;
    prevX = null;
    prevY = null;
    updateHUD();
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const tip = landmarks[8]; // index fingertip

  // Mirror coordinate inversion: canvasX = (1 - landmark.x) * canvas.width
  const x = (1 - tip.x) * canvas.width;
  const y = tip.y * canvas.height;

  // Smooth the cursor position
  if (smoothX === null) {
    smoothX = x;
    smoothY = y;
  } else {
    smoothX += (x - smoothX) * 0.45;
    smoothY += (y - smoothY) * 0.45;
  }

  // Pinch detection
  const pinching = isPinching(landmarks);

  // Pen is down if pinching OR space held
  const shouldDraw = pinching || spaceHeld;

  // State machine
  if (shouldDraw && !penDown) {
    // Pen just went down — start a new stroke
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
    // Add point to current stroke
    currentStroke.points.push({ x: smoothX, y: smoothY });
    prevX = smoothX;
    prevY = smoothY;
  }

  if (!shouldDraw && penDown) {
    // Pen just went up — stop drawing
    penDown = false;
    currentStroke = null;
    prevX = null;
    prevY = null;
  }

  // Draw cursor indicator
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
// Camera feed
// ------------------------------------------------------------------
const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({ image: video });
  },
  width: 1280,
  height: 720
});

camera.start();
