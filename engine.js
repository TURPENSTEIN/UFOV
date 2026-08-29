const stage = document.getElementById('stage');
const mask = document.getElementById('mask');
const overlay = document.getElementById('overlay');
const instructions = document.getElementById('instructions');

let audioCtx;
let startTimestamp = null;
const exposureLimit = 16.67; 
let isRunning = false;

// Generate zero-latency beep
function playDistractorBeep() {
    if (!audioCtx) return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // 440Hz
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

function spawnPeripheralTarget() {
    // Remove old target
    const old = document.querySelector('.peripheral-target');
    if (old) old.remove();

    // Calculate random radial position
    const angle = Math.random() * Math.PI * 2;
    const distance = 200 + Math.random() * 150; // Distance from center
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    const target = document.createElement('div');
    target.className = 'peripheral-target';
    target.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    stage.appendChild(target);
}

function renderTrial(timestamp) {
    if (!startTimestamp) startTimestamp = timestamp;
    const elapsed = timestamp - startTimestamp;

    if (elapsed < exposureLimit) {
        requestAnimationFrame(renderTrial);
    } else {
        // Exposure complete: mask immediately
        stage.classList.remove('active');
        mask.classList.add('visible');
        
        // Hold mask for 200ms to clear retinal afterimage
        setTimeout(() => {
            mask.classList.remove('visible');
            overlay.classList.add('visible');
            isRunning = false;
        }, 200); 
    }
}

function initiateTrial() {
    if (isRunning) return;
    isRunning = true;
    instructions.style.display = 'none';
    overlay.classList.remove('visible');
    
    spawnPeripheralTarget();
    playDistractorBeep();
    
    stage.classList.add('active');
    startTimestamp = null;
    requestAnimationFrame(renderTrial);
}

// Initialize on first user interaction to satisfy browser auto-play policies
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        initiateTrial();
    }
});
