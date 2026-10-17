const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const penColor = 'rgb(176, 225, 255)';

let strokes = [];
let currentStroke = [];
let shiftHeld = false;
let drawing = false;
let smoothX = null;
let smoothY = null;

function resizeCanvas() {
  const oldWidth = canvas.width || window.innerWidth;
  const oldHeight = canvas.height || window.innerHeight;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const scaleX = canvas.width / oldWidth;
  const scaleY = canvas.height / oldHeight;

  for (const stroke of strokes) {
    for (const point of stroke) {
      point.x *= scaleX;
      point.y *= scaleY;
    }
  }

  if (smoothX !== null) smoothX *= scaleX;
  if (smoothY !== null) smoothY *= scaleY;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    shiftHeld = true;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    strokes = [];
    currentStroke = [];
    drawing = false;
  }

  if (e.key.toLowerCase() === 'f' && !e.repeat) {
    toggleFullscreen();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    shiftHeld = false;
    drawing = false;
  }
});

window.addEventListener('blur', () => {
  shiftHeld = false;
  drawing = false;
});

function drawStrokes() {
  ctx.shadowColor = penColor;
  ctx.shadowBlur = 15;
  ctx.strokeStyle = penColor;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    ctx.beginPath();
    for (let i = 0; i < stroke.length; i++) {
      if (i === 0) ctx.moveTo(stroke[i].x, stroke[i].y);
      else ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  }
}

function drawCursor() {
  ctx.beginPath();
  ctx.arc(smoothX, smoothY, 6, 0, Math.PI * 2);
  ctx.shadowColor = penColor;
  ctx.shadowBlur = 15;
  ctx.fillStyle = shiftHeld ? '#FFFFFF' : penColor;
  ctx.fill();
}

function onResults(results) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawStrokes();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    drawing = false;
    smoothX = null;
    smoothY = null;
    ctx.shadowBlur = 0;
    return;
  }

  const tip = results.multiHandLandmarks[0][8];
  const x = tip.x * canvas.width;
  const y = tip.y * canvas.height;

  if (smoothX === null) {
    smoothX = x;
    smoothY = y;
  } else {
    smoothX += (x - smoothX) * 0.45;
    smoothY += (y - smoothY) * 0.45;
  }

  drawCursor();

  if (shiftHeld) {
    if (!drawing) {
      drawing = true;
      currentStroke = [];
      strokes.push(currentStroke);
    }
    currentStroke.push({ x: smoothX, y: smoothY });
  } else {
    drawing = false;
  }

  ctx.shadowBlur = 0;
}

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

const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({ image: video });
  },
  width: 1280,
  height: 720
});

camera.start();
