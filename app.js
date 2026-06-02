/* -------------------------------------------------------------
 * BATTERY GUARDIAN - CORE APPLICATION ENGINE
 * ------------------------------------------------------------- */

// State Management Object
const state = {
  isGuardActive: false,
  isSimulatorMode: false,
  isAlarmRinging: false,
  highLimit: 80,
  lowLimit: 20,
  volume: 70, // 0 to 100
  selectedTone: 'cyber',
  unplugAlertActive: false, // Premature unplug alert (anti-theft)
  
  // Real Battery state
  real: {
    level: 100,
    charging: false,
    wasCharging: false,
    apiSupported: false
  },
  
  // Simulated Battery state
  sim: {
    level: 50,
    charging: false,
    wasCharging: false
  },

  // Wake Lock object
  unplugAlertActive: true, // Early unplug alert active by default

};

// UI Element Selectors
const el = {
  systemStatusBadge: document.getElementById('system-status-badge'),
  systemStatusText: document.querySelector('#system-status-badge .badge-label'),
  dashboardModePill: document.getElementById('dashboard-mode-pill'),
  
  // Visualizer displays
  canvas: document.getElementById('battery-fluid-canvas'),
  percentageDisplay: document.getElementById('battery-percentage-display'),
  statusTextDisplay: document.getElementById('battery-status-text'),
  chargingRateText: document.getElementById('charging-rate-text'),
  healthRating: document.getElementById('battery-health-rating'),
  
  // Metrics grid
  valChargeLevel: document.getElementById('val-charge-level'),
  valPowerSource: document.getElementById('val-power-source'),
  valWakeLock: document.getElementById('val-wake-lock'),
  valNotifications: document.getElementById('val-notifications'),
  
  // Core control shield
  shieldBtn: document.getElementById('shield-activation-btn'),
  shieldSublabel: document.getElementById('shield-desc-sub'),
  
  // Threshold sliders
  highSlider: document.getElementById('high-limit-slider'),
  highDisplay: document.getElementById('val-high-limit'),
  lowSlider: document.getElementById('low-limit-slider'),
  lowDisplay: document.getElementById('val-low-limit'),
  unplugAlertToggle: document.getElementById('unplug-alert-toggle'),
  
  // Audio panel
  toneSelect: document.getElementById('alarm-tone-select'),
  testAudioBtn: document.getElementById('test-audio-btn'),
  volumeSlider: document.getElementById('volume-slider'),
  volumeDisplay: document.getElementById('val-volume'),
  alarmStateDisplay: document.getElementById('alarm-state-indicator'),
  dismissAlarmBtn: document.getElementById('dismiss-alarm-btn'),
  customToneFileInput: document.getElementById('custom-tone-file-input'),
  customToneName: document.getElementById('custom-tone-name'),
  customToneOption: document.getElementById('custom-tone-option'),
  
  // Simulator panel
  simulatorToggle: document.getElementById('simulator-mode-toggle'),
  simControls: document.getElementById('simulator-controls-container'),
  simPercentSlider: document.getElementById('sim-percentage-slider'),
  simPercentDisplay: document.getElementById('val-sim-percentage'),
  simChargingToggle: document.getElementById('sim-charging-toggle'),
  
  // Console logs screen
  consoleScreen: document.getElementById('activity-log-screen'),
  clearConsoleBtn: document.getElementById('clear-console-btn'),
  
  // PWA & Modals
  pwaInstallBtn: document.getElementById('pwa-install-btn'),
  helpBtn: document.getElementById('help-btn'),
  helpModal: document.getElementById('help-modal'),
  closeModalBtn: document.getElementById('close-modal-btn')
};

// -------------------------------------------------------------
// SERVICE WORKER REGISTRATION (Offline Capability)
// -------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[Service Worker] Registered successfully', reg.scope);
      // Request Notification permission
      if (Notification.permission !== 'granted') {
        await Notification.requestPermission();
      }
      // Subscribe to push notifications if supported
      if ('PushManager' in window && reg) {
        const publicVapidKey = 'BKX2n1Nu67yX5EbjHTSwlGOy49xo0aJajRHUzbwIg4ztr4WH7VD02_K_TV9STqBRK4SnIoqB0cG_-Q0so9hFz78'; // Generated VAPID public key
        const convertedKey = urlBase64ToUint8Array(publicVapidKey);
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey
        });
        console.log('Push subscription:', JSON.stringify(subscription));
        // Send subscription to local push server
        fetch('http://localhost:3000/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription)
        }).catch(err => console.error('Push subscription failed', err));
      }
    } catch (err) {
      console.error('[Service Worker] Registration failed', err);
    }
  });
}

// Utility to convert base64 VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Listen for push messages from service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.action === 'playAlarm') {
      AudioSynth.play();
      NotificationEngine.dispatch('Battery Guardian Alarm', 'Alarm triggered');
    }
  });
}

// -------------------------------------------------------------
// MATRIX EVENT LOGGER UTILITY
// -------------------------------------------------------------
function logToMatrix(message, type = 'sys') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  
  logEntry.innerHTML = `
    <span class="log-time">[${timestamp}]</span>
    <span class="log-msg log-${type}">${message}</span>
  `;
  
  el.consoleScreen.appendChild(logEntry);
  el.consoleScreen.scrollTop = el.consoleScreen.scrollHeight;
}

// -------------------------------------------------------------
// PERSISTENT INDEXEDDB CUSTOM TONE DATABASE
// -------------------------------------------------------------
const ToneStore = {
  dbName: 'BatteryGuardianDB',
  dbVersion: 1,
  db: null,

  init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tones')) {
          db.createObjectStore('tones');
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => reject(e);
    });
  },

  save(key, buffer, filename) {
    return this.init().then(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['tones'], 'readwrite');
        const store = transaction.objectStore('tones');
        const request = store.put({ buffer, filename }, key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
      });
    });
  },

  get(key) {
    return this.init().then(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['tones'], 'readonly');
        const store = transaction.objectStore('tones');
        const request = store.get(key);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e);
      });
    });
  }
};

// -------------------------------------------------------------
// PROGRAMMATIC WEB AUDIO SYNTHESIZER
// -------------------------------------------------------------
const AudioSynth = {
  ctx: null,
  activeNodes: [],
  testTimeout: null,
  customAudioBuffer: null,
  silentKeepAliveNode: null,

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      } else {
        logToMatrix('Web Audio API not supported in this browser.', 'alert');
      }
    }
  },

  play() {
    this.init();
    if (!this.ctx) return;
    
    // Stop any currently running synth generators first
    this.stop();

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const volumeGain = state.volume / 100;
    
    logToMatrix(`Acoustic alarm activated: Tone preset [${state.selectedTone}]`, 'warn');

    if (state.selectedTone === 'custom') {
      if (this.customAudioBuffer) {
        this.playCustomBuffer(volumeGain);
      } else {
        logToMatrix('No custom audio tone has been loaded yet. Falling back to Cyber Alert.', 'warn');
        this.playCyberAlert(volumeGain);
      }
    } else if (state.selectedTone === 'cyber') {
      this.playCyberAlert(volumeGain);
    } else if (state.selectedTone === 'radar') {
      this.playDigitalRadar(volumeGain);
    } else if (state.selectedTone === 'chime') {
      this.playPulseChime(volumeGain);
    } else if (state.selectedTone === 'siren') {
      this.playSpaceSiren(volumeGain);
    }
  },

  // Renders a continuous, inaudible 1Hz sub-acoustic wave at negligible gain (0.00001)
  // to trick the OS into keeping the audio session alive in the background
  startSilentKeepAlive() {
    this.init();
    if (!this.ctx) return;
    if (this.silentKeepAliveNode) return; // Already active

    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1, this.ctx.currentTime); // Inaudible sub-acoustic
      gain.gain.setValueAtTime(0.00001, this.ctx.currentTime); // Negligible, virtually silent

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      this.silentKeepAliveNode = osc;
      
      logToMatrix('Silent audio keep-alive activated. Background monitoring protection engaged.', 'cyan');

      // Hook up the Media Session API to register lock screen media notifications
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Battery Guardian',
          artist: 'Battery Health Protection Active',
          album: 'Continuous Guard Mode',
          artwork: [
            { src: './icon.svg', sizes: '512x512', type: 'image/svg+xml' }
          ]
        });

        navigator.mediaSession.setActionHandler('play', () => {
          if (this.ctx.state === 'suspended') this.ctx.resume();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          // Do not permit pausing of guard routine
        });
      }
    } catch (e) {
      console.warn('Could not launch silent background keep-alive:', e);
    }
  },

  stopSilentKeepAlive() {
    if (this.silentKeepAliveNode) {
      try {
        this.silentKeepAliveNode.stop();
      } catch (e) {}
      this.silentKeepAliveNode = null;
      logToMatrix('Silent audio keep-alive deactivated.', 'sys');
    }
  },

  // Repeatedly play custom loaded alert buffers
  playCustomBuffer(volume) {
    const playOnce = () => {
      this.init();
      if (!this.ctx || !this.customAudioBuffer) return;

      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      
      source.buffer = this.customAudioBuffer;
      gain.gain.setValueAtTime(volume * 0.8, this.ctx.currentTime);
      
      source.connect(gain);
      gain.connect(this.ctx.destination);
      
      source.start();
      this.activeNodes.push(source);
    };

    // Play immediately
    playOnce();

    // Loop interval based on audio duration plus a short delay
    const intervalTime = (this.customAudioBuffer.duration * 1000) + 700;
    const bufferInterval = setInterval(() => {
      if (state.isAlarmRinging === false && !this.testTimeout) {
        clearInterval(bufferInterval);
        return;
      }
      playOnce();
    }, intervalTime);

    const stopNode = {
      stop: () => clearInterval(bufferInterval)
    };
    this.activeNodes.push(stopNode);
  },

  stop() {
    // Terminate all oscillators and clear track lists
    this.activeNodes.forEach(node => {
      try {
        node.stop();
      } catch (e) {}
    });
    this.activeNodes = [];
    if (this.testTimeout) {
      clearTimeout(this.testTimeout);
      this.testTimeout = null;
    }
  },

  // Cyber Alert Beeps (Square wave alternate beep-beep)
  playCyberAlert(volume) {
    const interval = 250; // ms
    let highFreq = true;
    
    const alarmInterval = setInterval(() => {
      if (state.isAlarmRinging === false && !this.testTimeout) {
        clearInterval(alarmInterval);
        return;
      }
      
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'square';
      osc.frequency.value = highFreq ? 880 : 980;
      highFreq = !highFreq;

      gain.gain.setValueAtTime(volume * 0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + 0.22);
      
      this.activeNodes.push(osc);
    }, interval);
    
    // Store dummy interval reference to close during dismissal
    const stopNode = {
      stop: () => clearInterval(alarmInterval)
    };
    this.activeNodes.push(stopNode);
  },

  // Sonar Radar Sweep (Triangle sweep up)
  playDigitalRadar(volume) {
    const sweepInterval = setInterval(() => {
      if (state.isAlarmRinging === false && !this.testTimeout) {
        clearInterval(sweepInterval);
        return;
      }
      
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(800, this.ctx.currentTime + 0.6);

      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume * 0.5, this.ctx.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + 0.8);
      
      this.activeNodes.push(osc);
    }, 900);

    const stopNode = {
      stop: () => clearInterval(sweepInterval)
    };
    this.activeNodes.push(stopNode);
  },

  // Soft Melodic Sine Chime (Decaying Bell)
  playPulseChime(volume) {
    const chimeInterval = setInterval(() => {
      if (state.isAlarmRinging === false && !this.testTimeout) {
        clearInterval(chimeInterval);
        return;
      }

      this.init();
      if (!this.ctx) return;

      // Make a simple bell chime with minor harmonics
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.value = 523.25; // C5 Note
      
      osc2.type = 'sine';
      osc2.frequency.value = 783.99; // G5 Note (Perfect Fifth)

      gain.gain.setValueAtTime(volume * 0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(this.ctx.currentTime + 1.3);
      osc2.stop(this.ctx.currentTime + 1.3);

      this.activeNodes.push(osc1, osc2);
    }, 1500);

    const stopNode = {
      stop: () => clearInterval(chimeInterval)
    };
    this.activeNodes.push(stopNode);
  },

  // Cyber Siren (LFO modulated sweep)
  playSpaceSiren(volume) {
    this.init();
    if (!this.ctx) return;

    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modulatorGain = this.ctx.createGain();
    const mainGain = this.ctx.createGain();

    carrier.type = 'sawtooth';
    carrier.frequency.value = 440;

    modulator.type = 'sine';
    modulator.frequency.value = 2.5; // LFO modulation rate (2.5Hz)
    
    modulatorGain.gain.value = 180; // Depth of pitch sweep (180Hz offset)

    mainGain.gain.setValueAtTime(volume * 0.15, this.ctx.currentTime);

    // Modulate carrier frequency
    modulator.connect(modulatorGain);
    modulatorGain.connect(carrier.frequency);

    carrier.connect(mainGain);
    mainGain.connect(this.ctx.destination);

    modulator.start();
    carrier.start();

    this.activeNodes.push(modulator, carrier);
  }
};

// -------------------------------------------------------------
// FLUID CANVAS ANIMATION ENGINE
// -------------------------------------------------------------
const CanvasVisualizer = {
  ctx: null,
  animationId: null,
  wavePhase: 0,
  bubbles: [],

  init() {
    this.ctx = el.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.generateBubbles();
    this.startAnimationLoop();
  },

  resize() {
    const parent = el.canvas.parentElement;
    el.canvas.width = parent.clientWidth;
    el.canvas.height = 250;
  },

  generateBubbles() {
    this.bubbles = [];
    for (let i = 0; i < 22; i++) {
      this.bubbles.push({
        x: Math.random() * 200 - 100, // Relative x offset from center
        y: Math.random() * 200,
        r: Math.random() * 3.5 + 1.2,
        speed: Math.random() * 0.8 + 0.4,
        opacity: Math.random() * 0.4 + 0.2
      });
    }
  },

  startAnimationLoop() {
    const render = () => {
      this.draw();
      this.wavePhase += 0.035;
      this.animationId = requestAnimationFrame(render);
    };
    render();
  },

  draw() {
    if (!this.ctx) return;
    const w = el.canvas.width;
    const h = el.canvas.height;
    
    // Clear canvas with a very soft radial vignette
    this.ctx.fillStyle = '#05070e';
    this.ctx.fillRect(0, 0, w, h);

    const level = state.isSimulatorMode ? state.sim.level : state.real.level;
    const charging = state.isSimulatorMode ? state.sim.charging : state.real.charging;

    // Define colors depending on level and charging state
    let accentHSL = 'var(--accent-cyan)';
    let primaryGlow = 'rgba(14, 165, 233, 0.4)';
    let darkLiquid = '#0c4a6e';
    let lightLiquid = '#0ea5e9';

    if (charging) {
      accentHSL = 'var(--accent-green)';
      primaryGlow = 'rgba(16, 185, 129, 0.4)';
      darkLiquid = '#064e3b';
      lightLiquid = '#10b981';
    } else if (level <= state.lowLimit) {
      accentHSL = 'var(--accent-red)';
      primaryGlow = 'rgba(244, 63, 94, 0.45)';
      darkLiquid = '#4c0519';
      lightLiquid = '#f43f5e';
    } else if (level >= state.highLimit) {
      accentHSL = 'var(--accent-amber)';
      primaryGlow = 'rgba(245, 158, 11, 0.4)';
      darkLiquid = '#451a03';
      lightLiquid = '#f59e0b';
    }

    // Centered battery frame size parameters
    const batW = 120;
    const batH = 190;
    const batX = (w - batW) / 2;
    const batY = (h - batH) / 2 + 10;
    const rx = 20;

    // Drawing shadow and outer glow if alarm is active
    if (state.isAlarmRinging) {
      this.ctx.shadowBlur = 20 + Math.sin(this.wavePhase * 3) * 10;
      this.ctx.shadowColor = level <= state.lowLimit ? 'rgba(244, 63, 94, 0.7)' : 'rgba(245, 158, 11, 0.7)';
    } else {
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = primaryGlow;
    }

    // DRAW BATTERY TIP (Positive Terminal)
    this.ctx.fillStyle = lightLiquid;
    this.ctx.beginPath();
    this.ctx.roundRect(w/2 - 25, batY - 14, 50, 15, [6, 6, 0, 0]);
    this.ctx.fill();

    // DRAW OUTER GLASS CANISTER
    this.ctx.strokeStyle = lightLiquid;
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.roundRect(batX, batY, batW, batH, rx);
    this.ctx.stroke();

    // Remove shadow blur to avoid double-blurs
    this.ctx.shadowBlur = 0;

    // Clip internal liquid drawing inside the battery bounds
    this.ctx.save();
    this.ctx.beginPath();
    // Inner margin padding 4px
    this.ctx.roundRect(batX + 5, batY + 5, batW - 10, batH - 10, rx - 4);
    this.ctx.clip();

    // Compute Y coordinate matching battery charge ratio
    const chargeRatio = level / 100;
    const fillH = (batH - 10) * chargeRatio;
    const waveY = (batY + batH - 5) - fillH;

    // Drawing Fluid Wave Back Layer
    this.ctx.fillStyle = darkLiquid;
    this.ctx.beginPath();
    this.ctx.moveTo(batX - 20, batY + batH + 10);
    for (let x = batX - 20; x <= batX + batW + 20; x += 10) {
      const y = waveY + Math.sin(this.wavePhase + (x * 0.04)) * 6 - 2;
      this.ctx.lineTo(x, y);
    }
    this.ctx.lineTo(batX + batW + 20, batY + batH + 10);
    this.ctx.closePath();
    this.ctx.fill();

    // Draw rising ambient bubbles inside canister
    this.ctx.fillStyle = lightLiquid;
    this.bubbles.forEach(bubble => {
      // Speed up bubbles when charging
      bubble.y -= bubble.speed * (charging ? 2.5 : 1);
      
      // Reset bubbles back to bottom when they pass the wave line or top
      const absoluteX = w/2 + bubble.x;
      const bubbleMaxY = Math.max(waveY, batY + 12);
      
      if (bubble.y < bubbleMaxY || bubble.y < batY + 12) {
        bubble.y = batY + batH - 15;
        bubble.x = Math.random() * (batW - 25) - (batW - 25)/2;
      }

      this.ctx.save();
      this.ctx.globalAlpha = bubble.opacity;
      this.ctx.beginPath();
      this.ctx.arc(absoluteX, bubble.y, bubble.r, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    // Drawing Fluid Wave Front Layer
    this.ctx.fillStyle = lightLiquid;
    this.ctx.beginPath();
    this.ctx.moveTo(batX - 20, batY + batH + 10);
    for (let x = batX - 20; x <= batX + batW + 20; x += 10) {
      const y = waveY + Math.cos(this.wavePhase + (x * 0.035)) * 6;
      this.ctx.lineTo(x, y);
    }
    this.ctx.lineTo(batX + batW + 20, batY + batH + 10);
    this.ctx.closePath();
    this.ctx.fill();

    // Draw glass shine highlight overlay (Glossy Reflection effect)
    const shineGrad = this.ctx.createLinearGradient(batX, batY, batX + batW, batY);
    shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    shineGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.16)');
    shineGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.0)');
    shineGrad.addColorStop(0.85, 'rgba(255, 255, 255, 0.0)');
    shineGrad.addColorStop(0.95, 'rgba(255, 255, 255, 0.08)');
    
    this.ctx.fillStyle = shineGrad;
    this.ctx.fillRect(batX, batY, batW, batH);

    this.ctx.restore();
  }
};

// -------------------------------------------------------------
// NOTIFICATIONS DISPATCHER ENGINE
// -------------------------------------------------------------
const NotificationEngine = {
  requestPermission() {
    if ('Notification' in window) {
      Notification.requestPermission().then(status => {
        this.updatePermissionUI(status);
        if (status === 'granted') {
          logToMatrix('Desktop System Notification capability authorized.', 'success');
          // Send friendly test welcome alert
          new Notification('Battery Guardian Active', {
            body: 'We will guard your device against overcharging and deep discharge.',
            icon: './icon.svg'
          });
        } else {
          logToMatrix('Desktop System Notification capability rejected/denied.', 'warn');
        }
      });
    }
  },

  updatePermissionUI(status = Notification.permission) {
    if (!('Notification' in window)) {
      el.valNotifications.textContent = 'Unsupported';
      el.valNotifications.parentElement.parentElement.classList.add('disabled');
      return;
    }
    
    if (status === 'granted') {
      el.valNotifications.textContent = 'Authorized';
      el.valNotifications.style.color = 'hsl(var(--accent-green))';
    } else if (status === 'denied') {
      el.valNotifications.textContent = 'Denied';
      el.valNotifications.style.color = 'hsl(var(--accent-red))';
    } else {
      el.valNotifications.textContent = 'Tap to Grant';
      el.valNotifications.style.color = 'hsl(var(--accent-cyan))';
      el.valNotifications.style.cursor = 'pointer';
    }
  },

  dispatch(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: './icon.svg',
        tag: 'battery-alarm-alert',
        renotify: true
      });
    }
  }
};

// -------------------------------------------------------------
// SCREEN WAKE LOCK MANAGER
// -------------------------------------------------------------
const WakeLockManager = {
  async acquire() {
    if (!('wakeLock' in navigator)) {
      el.valWakeLock.textContent = 'Unsupported';
      el.valWakeLock.style.color = 'var(--text-muted)';
      return;
    }

    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      el.valWakeLock.textContent = 'Locked Active';
      el.valWakeLock.style.color = 'hsl(var(--accent-purple))';
      logToMatrix('Prevent-Sleep Wake Lock successfully acquired.', 'cyan');
      
      // Listener for release event (system can terminate locks automatically)
      state.wakeLock.addEventListener('release', () => {
        if (state.isGuardActive) {
          // If system released it, try to re-acquire
          el.valWakeLock.textContent = 'Release Pending';
        } else {
          el.valWakeLock.textContent = 'Inactive';
          el.valWakeLock.style.color = 'var(--text-secondary)';
        }
      });
    } catch (err) {
      console.error('Wake Lock acquisition failure:', err);
      el.valWakeLock.textContent = 'Acquire Failed';
      el.valWakeLock.style.color = 'hsl(var(--accent-red))';
    }
  },

  release() {
    if (state.wakeLock) {
      state.wakeLock.release().then(() => {
        state.wakeLock = null;
        el.valWakeLock.textContent = 'Inactive';
        el.valWakeLock.style.color = 'var(--text-secondary)';
        logToMatrix('Wake Lock released.', 'sys');
      });
    }
  }
};

// -------------------------------------------------------------
// CORE ALARM CONTROLLER
// -------------------------------------------------------------
function ringAlarm() {
  if (state.isAlarmRinging) return; // Already ringing

  state.isAlarmRinging = true;
  el.alarmStateDisplay.textContent = 'RINGING!';
  el.alarmStateDisplay.className = 'sound-state-badge ringing';
  el.dismissAlarmBtn.classList.remove('hidden');
  
  // Play the programmatic synthesizer tone loop
  AudioSynth.play();
  // Show desktop notification
  NotificationEngine.dispatch('Battery Guardian Alarm', 'Alarm triggered');
}

function silenceAlarm(userDismissed = false) {
  if (!state.isAlarmRinging) return;
  
  state.isAlarmRinging = false;
  el.alarmStateDisplay.textContent = 'Idle';
  el.alarmStateDisplay.className = 'sound-state-badge';
  el.dismissAlarmBtn.classList.add('hidden');
  
  AudioSynth.stop();
  
  if (userDismissed) {
    logToMatrix('Acoustic alert silenced by user. Monitoring continues...', 'sys');
  } else {
    logToMatrix('Acoustic alarm cleared automatically. Battery metrics normalized.', 'success');
  }
}

// -------------------------------------------------------------
// CORE LIMIT CHECKER (The Guard Routine)
// -------------------------------------------------------------
let highAlertSent = false;
let lowAlertSent = false;

function checkBatteryLimits() {
  const level = state.isSimulatorMode ? state.sim.level : state.real.level;
  const charging = state.isSimulatorMode ? state.sim.charging : state.real.charging;
  const wasCharging = state.isSimulatorMode ? state.sim.wasCharging : state.real.wasCharging;
  
  // Update state card elements
  el.valChargeLevel.textContent = `${level}%`;
  
  let sourceText = charging ? 'AC Power (Fast)' : 'Battery (Discharging)';
  if (state.isSimulatorMode) {
    sourceText = charging ? 'Plugged-In (Sim)' : 'Unplugged (Sim)';
  }
  el.valPowerSource.textContent = sourceText;

  // Render Visualizer Overlay text
  el.percentageDisplay.textContent = `${level}%`;
  el.statusTextDisplay.textContent = charging ? 'CHARGING CELL' : 'DISCHARGING CELL';
  el.chargingRateText.textContent = charging ? 'Energy inflow charging Lithium battery' : 'Depleting stored backup chemistry';

  // Guard Actions
  if (!state.isGuardActive) {
    silenceAlarm();
    // Update wasCharging tracking
    if (state.isSimulatorMode) {
      state.sim.wasCharging = charging;
    } else {
      state.real.wasCharging = charging;
    }
    return;
  }

  // Check premature unplug event (Charger disconnected before hitting High threshold)
  let isEarlyUnplugged = false;
  if (wasCharging === true && charging === false && level < state.highLimit && state.unplugAlertActive) {
    isEarlyUnplugged = true;
  }

  // CASE 1: Charger is plugged in and battery level EXCEEDS the high limit
  if (charging && level >= state.highLimit) {
    ringAlarm();
    if (!highAlertSent) {
      NotificationEngine.dispatch(
        '🚨 Battery Overcharge Warning!',
        `Your device has charged up to ${level}% (Limit: ${state.highLimit}%). Unplug charger now!`
      );
      logToMatrix(`CRITICAL EXPOSURE: Battery reached ${level}% under active charge! Limit threshold of ${state.highLimit}% exceeded.`, 'alert');
      highAlertSent = true;
    }
  } 
  // CASE 2: Charger is unplugged and battery level DROPS below the low limit
  else if (!charging && level <= state.lowLimit) {
    ringAlarm();
    if (!lowAlertSent) {
      NotificationEngine.dispatch(
        '🔌 Deep Discharge Alert!',
        `Battery depleted to ${level}% (Limit: ${state.lowLimit}%). Please connect the charger immediately!`
      );
      logToMatrix(`CRITICAL EXPOSURE: Battery depleted to ${level}%! Minimum capacity limit of ${state.lowLimit}% breached.`, 'alert');
      lowAlertSent = true;
    }
  } 
  // CASE 3: Premature unplugged alert triggered (Anti-Theft)
  else if (isEarlyUnplugged) {
    ringAlarm();
    NotificationEngine.dispatch(
      '🚨 Early Unplugged Security Breach!',
      `Device disconnected at ${level}% before reaching target limit of ${state.highLimit}%. Secure your device!`
    );
    logToMatrix(`🚨 SECURITY ALERT: Charger disconnected prematurely at ${level}%! Target limit set to ${state.highLimit}%.`, 'alert');
  }
  // CASE 4: Normal operations (between thresholds, no early unplug)
  else {
    // Only silence if we are NOT in an early unplug warning state
    if (!isEarlyUnplugged) {
      silenceAlarm();
    }
    
    // Reset alert flags if thresholds normalized
    if (level < state.highLimit) highAlertSent = false;
    if (level > state.lowLimit) lowAlertSent = false;
  }

  // Update wasCharging tracking for next loop
  if (state.isSimulatorMode) {
    state.sim.wasCharging = charging;
  } else {
    state.real.wasCharging = charging;
  }
}

// -------------------------------------------------------------
// REAL BATTERY API INTEGRATION
// -------------------------------------------------------------
function initializeRealBatteryAPI() {
  if ('getBattery' in navigator) {
    navigator.getBattery().then((battery) => {
      state.real.apiSupported = true;
      state.real.level = Math.round(battery.level * 100);
      state.real.charging = battery.charging;
      
      logToMatrix(`Smart Battery API detected: Initial Level: ${state.real.level}%, Charging: ${state.real.charging}`, 'success');

      // Hook up live listeners
      battery.addEventListener('levelchange', () => {
        state.real.level = Math.round(battery.level * 100);
        logToMatrix(`Battery level event: ${state.real.level}%`, 'sys');
        checkBatteryLimits();
      });

      battery.addEventListener('chargingchange', () => {
        state.real.charging = battery.charging;
        logToMatrix(`Power state event: Charger is ${state.real.charging ? 'CONNECTED' : 'DISCONNECTED'}`, 'cyan');
        checkBatteryLimits();
      });

      checkBatteryLimits();
    }).catch(err => {
      console.warn('Battery API promise rejected:', err);
      setupAPIUnsupportedState();
    });
  } else {
    setupAPIUnsupportedState();
  }
}

function setupAPIUnsupportedState() {
  state.real.apiSupported = false;
  logToMatrix('Web Battery Status API is unsupported on this browser/OS (e.g. iOS Safari). Toggling to interactive Simulation console.', 'warn');
  
  // Set simulator to true on start since real sensor is unavailable
  state.isSimulatorMode = true;
  el.simulatorToggle.checked = true;
  el.simControls.classList.add('expanded');
  el.dashboardModePill.textContent = 'Simulated Matrix';
  el.dashboardModePill.style.color = 'hsl(var(--accent-cyan))';
  el.dashboardModePill.style.borderColor = 'hsla(var(--accent-cyan), 0.2)';
  
  checkBatteryLimits();
}

// -------------------------------------------------------------
// UI CONTROLS BINDING
// -------------------------------------------------------------
function bindUIEventListeners() {
  
  // High Limit Slider
  el.highSlider.addEventListener('input', (e) => {
    state.highLimit = parseInt(e.target.value);
    el.highDisplay.textContent = `${state.highLimit}%`;
    localStorage.setItem('highLimit', state.highLimit);
    checkBatteryLimits();
  });

  // Low Limit Slider
  el.lowSlider.addEventListener('input', (e) => {
    state.lowLimit = parseInt(e.target.value);
    el.lowDisplay.textContent = `${state.lowLimit}%`;
    localStorage.setItem('lowLimit', state.lowLimit);
    checkBatteryLimits();
  });

  // Volume Slider
  el.volumeSlider.addEventListener('input', (e) => {
    state.volume = parseInt(e.target.value);
    el.volumeDisplay.textContent = `${state.volume}%`;
    localStorage.setItem('volume', state.volume);
    
    // Dynamically alter ringing synth volume if active
    if (state.isAlarmRinging) {
      AudioSynth.play();
    }
  });

  // Tone Selection
  el.toneSelect.addEventListener('change', (e) => {
    state.selectedTone = e.target.value;
    localStorage.setItem('selectedTone', state.selectedTone);
    logToMatrix(`Synthesizer profile adjusted: ${state.selectedTone}`, 'sys');
    
    // Instantly apply tone change if ringing
    if (state.isAlarmRinging) {
      AudioSynth.play();
    }
  });

  // Test Sound Audio Action
  let isTesting = false;
  el.testAudioBtn.addEventListener('click', () => {
    AudioSynth.init();
    if (isTesting) {
      AudioSynth.stop();
      isTesting = false;
      el.testAudioBtn.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 18.796L7.213 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h3.213L12 5.204v13.592z"/></svg>
        Test Sound
      `;
      logToMatrix('Synthesizer acoustic diagnostic completed.', 'sys');
    } else {
      isTesting = true;
      el.testAudioBtn.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
        Stop Test
      `;
      logToMatrix(`Playing diagnostic acoustic sweep preset: [${state.selectedTone}]`, 'sys');
      
      AudioSynth.play();
      
      // Auto cut testing sound after 4.5 seconds
      AudioSynth.testTimeout = setTimeout(() => {
        AudioSynth.stop();
        isTesting = false;
        el.testAudioBtn.innerHTML = `
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 18.796L7.213 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h3.213L12 5.204v13.592z"/></svg>
          Test Sound
        `;
        AudioSynth.testTimeout = null;
      }, 4500);
    }
  });

  // Manual Alarm Dismissal Button
  el.dismissAlarmBtn.addEventListener('click', () => {
    silenceAlarm(true);
  });

  // Clear Matrix logs
  el.clearConsoleBtn.addEventListener('click', () => {
    el.consoleScreen.innerHTML = '';
    logToMatrix('Console logs screen cleared.', 'sys');
  });

  // Simulator Toggle Checkbox
  el.simulatorToggle.addEventListener('change', (e) => {
    state.isSimulatorMode = e.target.checked;
    
    if (state.isSimulatorMode) {
      el.simControls.classList.add('expanded');
      el.dashboardModePill.textContent = 'Simulated Matrix';
      el.dashboardModePill.style.color = 'hsl(var(--accent-cyan))';
      el.dashboardModePill.style.borderColor = 'hsla(var(--accent-cyan), 0.2)';
      logToMatrix('Simulation core enabled. Disconnected real hardware sensor feed.', 'cyan');
    } else {
      if (!state.real.apiSupported) {
        // Prevent disabling if API is not supported
        el.simulatorToggle.checked = true;
        state.isSimulatorMode = true;
        logToMatrix('Sim mode cannot be disabled because Battery Status API is unsupported on this browser.', 'warn');
        return;
      }
      el.simControls.classList.remove('expanded');
      el.dashboardModePill.textContent = 'Real-time Sensor';
      el.dashboardModePill.style.color = 'hsl(var(--accent-green))';
      el.dashboardModePill.style.borderColor = 'hsla(var(--accent-green), 0.2)';
      logToMatrix('Simulation core disabled. Hooked real hardware sensor feed back.', 'success');
    }
    checkBatteryLimits();
  });

  // Simulator Range slider percentage
  el.simPercentSlider.addEventListener('input', (e) => {
    state.sim.level = parseInt(e.target.value);
    el.simPercentDisplay.textContent = `${state.sim.level}%`;
    checkBatteryLimits();
  });

  // Simulator Charging Checkbox
  el.simChargingToggle.addEventListener('change', (e) => {
    state.sim.charging = e.target.checked;
    checkBatteryLimits();
  });

  // Click on notifications metric icon triggers Permission request
  el.valNotifications.addEventListener('click', () => {
    if (Notification.permission === 'default') {
      NotificationEngine.requestPermission();
    }
  });

  // Floating Help button Modal drawer actions
  el.helpBtn.addEventListener('click', () => {
    el.helpModal.showModal();
  });
  
  el.closeModalBtn.addEventListener('click', () => {
    el.helpModal.close();
  });

  // Close dialog on clicking backdrop
  el.helpModal.addEventListener('click', (e) => {
    const dialogBounds = el.helpModal.getBoundingClientRect();
    if (
      e.clientX < dialogBounds.left ||
      e.clientX > dialogBounds.right ||
      e.clientY < dialogBounds.top ||
      e.clientY > dialogBounds.bottom
    ) {
      el.helpModal.close();
    }
  });

  // Main Neon Guard Activation Shield Button
  el.shieldBtn.addEventListener('click', () => {
    // Web audio API context registration must follow click/touch event
    AudioSynth.init();
    
    state.isGuardActive = !state.isGuardActive;

    if (state.isGuardActive) {
      // Engage Guard
      el.shieldBtn.classList.remove('deactivated');
      el.shieldBtn.classList.add('activated');
      el.shieldSublabel.textContent = 'SHIELD ENGAGED - MONITORING ACTIVE';
      
      el.systemStatusBadge.className = 'status-indicator-badge connected';
      el.systemStatusText.textContent = 'Guard Active';
      
      logToMatrix('GUARDIAN SHIELD ENGAGED. Active battery parameters monitoring initialized.', 'success');
      
      // Request Desktop notifications permission on first activate if default
      if ('Notification' in window && Notification.permission === 'default') {
        NotificationEngine.requestPermission();
      }

      // Lock Screen prevention WakeLock initiation
      WakeLockManager.acquire();

      // Launch background silent audio loop & lock screen media session metadata!
      AudioSynth.startSilentKeepAlive();
    } else {
      // Disengage Guard
      el.shieldBtn.classList.remove('activated');
      el.shieldBtn.classList.add('deactivated');
      el.shieldSublabel.textContent = 'Tap to initialize monitoring & sound';
      
      el.systemStatusBadge.className = 'status-indicator-badge disconnected';
      el.systemStatusText.textContent = 'Guard Offline';
      
      logToMatrix('GUARDIAN SHIELD DISENGAGED. Monitoring ceased.', 'sys');
      
      // Clear alerts and silence alarm
      silenceAlarm();
      WakeLockManager.release();

      // Deactivate background silent audio loop
      AudioSynth.stopSilentKeepAlive();
    }
    
    checkBatteryLimits();
  });

  // Anti-Theft Unplug Toggle
  el.unplugAlertToggle.addEventListener('change', (e) => {
    state.unplugAlertActive = e.target.checked;
    localStorage.setItem('unplugAlertActive', state.unplugAlertActive);
    logToMatrix(`Early Unplugged Alarm (Anti-Theft) is now: ${state.unplugAlertActive ? 'ENABLED' : 'DISABLED'}`, 'sys');
  });

  // Custom Alert Tone File Uploader
  el.customToneFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    el.customToneName.textContent = 'Decoding audio...';
    
    const reader = new FileReader();
    reader.onload = function(evt) {
      const arrayBuffer = evt.target.result;
      
      // Initialize AudioContext
      AudioSynth.init();
      
      // Decode audio binary array data
      AudioSynth.ctx.decodeAudioData(arrayBuffer.slice(0), (decodedBuffer) => {
        // Save decoded buffer in memory
        AudioSynth.customAudioBuffer = decodedBuffer;
        
        // Save raw array buffer in IndexedDB persistently
        ToneStore.save('custom-tone', arrayBuffer, file.name)
          .then(() => {
            logToMatrix(`Custom tone file [${file.name}] successfully saved in persistent browser IndexedDB.`, 'success');
          })
          .catch(err => {
            console.error('IndexedDB save failed:', err);
          });

        el.customToneName.textContent = file.name;
        el.customToneOption.classList.remove('hidden');
        el.toneSelect.value = 'custom';
        state.selectedTone = 'custom';
        localStorage.setItem('selectedTone', 'custom');
        logToMatrix(`Decoded and loaded custom tone successfully: ${file.name}`, 'success');
      }, (err) => {
        logToMatrix(`Error decoding audio file: ${err.message || 'Unsupported format'}`, 'alert');
        el.customToneName.textContent = 'Error decoding file';
      });
    };
    reader.readAsArrayBuffer(file);
  });
}

// -------------------------------------------------------------
// LOCAL STORAGE & INITIAL SETUPS
// -------------------------------------------------------------
function loadSavedSettings() {
  if (localStorage.getItem('highLimit')) {
    state.highLimit = parseInt(localStorage.getItem('highLimit'));
    el.highSlider.value = state.highLimit;
    el.highDisplay.textContent = `${state.highLimit}%`;
  }
  
  if (localStorage.getItem('lowLimit')) {
    state.lowLimit = parseInt(localStorage.getItem('lowLimit'));
    el.lowSlider.value = state.lowLimit;
    el.lowDisplay.textContent = `${state.lowLimit}%`;
  }
  
  if (localStorage.getItem('volume')) {
    state.volume = parseInt(localStorage.getItem('volume'));
    el.volumeSlider.value = state.volume;
    el.volumeDisplay.textContent = `${state.volume}%`;
  }
  
  if (localStorage.getItem('selectedTone')) {
    state.selectedTone = localStorage.getItem('selectedTone');
    el.toneSelect.value = state.selectedTone;
  }

  if (localStorage.getItem('unplugAlertActive')) {
    state.unplugAlertActive = localStorage.getItem('unplugAlertActive') === 'true';
    el.unplugAlertToggle.checked = state.unplugAlertActive;
  }
}

// -------------------------------------------------------------
// PWA CUSTOM INSTALL TRIGGER
// -------------------------------------------------------------
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent default installation prompt bar showing
  e.preventDefault();
  deferredInstallPrompt = e;
  
  // Show customized in-app install button
  el.pwaInstallBtn.classList.remove('hidden');
  logToMatrix('Progressive Web App installation package recognized.', 'cyan');
});

el.pwaInstallBtn.addEventListener('click', () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        logToMatrix('User accepted the PWA installation package. Adding to home screen.', 'success');
        el.pwaInstallBtn.classList.add('hidden');
      } else {
        logToMatrix('User declined PWA install prompt.', 'sys');
      }
      deferredInstallPrompt = null;
    });
  }
});

window.addEventListener('appinstalled', () => {
  el.pwaInstallBtn.classList.add('hidden');
  logToMatrix('Battery Guardian successfully installed into application matrix!', 'success');
});

// -------------------------------------------------------------
// APP INITIALIZATION ROUTINE
// -------------------------------------------------------------
function initApp() {
  logToMatrix('Initializing Battery Guardian System Matrix...', 'sys');
  
  loadSavedSettings();
  
  // Restore custom alert tone from IndexedDB if present
  ToneStore.init().then(() => {
    return ToneStore.get('custom-tone');
  }).then((data) => {
    if (data) {
      el.customToneName.textContent = data.filename;
      el.customToneOption.classList.remove('hidden');
      
      // Decode save buffer data in background
      AudioSynth.init();
      AudioSynth.ctx.decodeAudioData(data.buffer.slice(0), (decodedBuffer) => {
        AudioSynth.customAudioBuffer = decodedBuffer;
        logToMatrix(`Restored custom alert tone [${data.filename}] from persistent IndexedDB store.`, 'sys');
        
        // Refresh UI state to custom if saved
        if (state.selectedTone === 'custom') {
          el.toneSelect.value = 'custom';
        }
      }, (err) => {
        console.warn('Cached audio data could not be decoded:', err);
      });
    }
  }).catch(err => {
    console.warn('ToneStore IndexedDB initialization failure:', err);
  });

  CanvasVisualizer.init();
  NotificationEngine.updatePermissionUI();
  bindUIEventListeners();
  initializeRealBatteryAPI();
  
  // Handle wake lock re-acquisition when app regains focus/visibility
  document.addEventListener('visibilitychange', () => {
    if (state.isGuardActive && document.visibilityState === 'visible') {
      WakeLockManager.acquire();
    }
  });

  logToMatrix('System status: STANDBY. Secure boundary limits set.', 'sys');
}

// Boot up sequence
window.addEventListener('DOMContentLoaded', initApp);
