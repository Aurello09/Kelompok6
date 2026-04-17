// ========== CONFIGURATION ==========
function getBaseUrl() {
  const urlInput = document.getElementById('global-base-url');
  return urlInput ? urlInput.value.trim() : '';
}

// Utilities
const getTs = () => new Date().toISOString();
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return alert(msg);
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Custom Fetch Wrapper 
async function apiFetch(endpoint, options = {}) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    showToast('BASE URL Server tidak boleh kosong!', 'error');
    throw new Error('BASE URL is empty');
  }

  // Membersihkan endpoint (misal: `/presence/status?user_id=123` menjadi `presence/status` dan parameternya)
  let cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  let path = cleanEndpoint;
  let queryStr = "";
  if (cleanEndpoint.includes('?')) {
    [path, queryStr] = cleanEndpoint.split('?');
    queryStr = "&" + queryStr; // parameter tambahan
  }

  // Format URL khusus untuk GAS Swap Test
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // 1. urlPrimary: menggunakan parameter query
  let urlPrimary = `${cleanBaseUrl}?endpoint=${path}${queryStr}`;
  // 2. urlFallback: menggunakan REST style (path)
  let fallbackQueryStr = queryStr ? "?" + queryStr.substring(1) : "";
  let urlFallback = `${cleanBaseUrl}/${path}${fallbackQueryStr}`;

  const isPost = options.method === 'POST';
  const fetchOptions = {
    method: options.method || 'GET',
    redirect: 'follow', // required for Google Apps Script
    ...options
  };

  // GAS Specific logic: if POST, use content-type text/plain to avoid CORS preflight issues 
  if (isPost) {
    if (!fetchOptions.headers) fetchOptions.headers = {};
    fetchOptions.headers['Content-Type'] = 'text/plain';
  }

  const doFetch = async (url) => {
    console.log(`[API Request] ${fetchOptions.method} ${url}`, isPost && options.body ? JSON.parse(options.body) : '');

    const response = await fetch(url, fetchOptions);
    const rawText = await response.text();
    console.log(`[API Raw Response from ${url}]`, rawText);

    let result;
    try {
      result = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`InvalidJSON: ${rawText.substring(0, 50)}`);
    }

    if (result && !result.ok && result.error) {
      const errLower = result.error.toLowerCase();
      if (errLower.includes('unknown endpoint') || errLower.includes('unknown_endpoint')) {
        throw new Error(`EndpointError: ${result.error}`);
      }
      throw new Error(`ServerError: ${result.error}`);
    }

    return result;
  };

  try {
    // Coba target utama dulu (Query Mode)
    return await doFetch(urlPrimary);
  } catch (error) {
    console.warn(`[Fallback Triggered] Primary URL failed (${error.message}). Retrying with Fallback URL...`);

    // Jika benar-benar error dari logic bisnis server (seperti token_expired), jangan di-retry ke fallback
    if (error.message.startsWith('ServerError:')) {
      const actualError = error.message.replace('ServerError: ', '');
      showToast(`${actualError}`, 'error'); // Tampilkan error asli server
      throw new Error(actualError);
    }

    // Coba fallback target (Path Mode)
    try {
      return await doFetch(urlFallback);
    } catch (fallbackError) {
      console.error('Fetch Fallback Error:', fallbackError);
      let finalMsg = fallbackError.message;

      if (finalMsg.startsWith('ServerError:')) {
        finalMsg = finalMsg.replace('ServerError: ', '');
        showToast(`${finalMsg}`, 'error');
      } else if (finalMsg.startsWith('InvalidJSON:')) {
        showToast('Response Server bukan format JSON yang valid.', 'error');
        finalMsg = "Invalid JSON Response";
      } else {
        showToast(`Gagal menghubungi server: ${finalMsg}`, 'error');
      }
      throw new Error(finalMsg);
    }
  }
}

function getDeviceId() {
  const el = document.getElementById('global-device-id');
  return el ? (el.value || 'dev-unknown') : 'dev-unknown';
}

// ========== NAVIGATION ==========
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.module-section').forEach(s => s.classList.remove('active'));

    e.currentTarget.classList.add('active');
    const target = e.currentTarget.getAttribute('data-target');
    document.getElementById(target).classList.add('active');

    // Lazy attach map if it's map section
    if (target === 'modul-3') {
      if (!mapInitialized && typeof initMap === 'function') {
        initMap();
      }
      setTimeout(() => {
        if (typeof map !== 'undefined' && map) map.invalidateSize();
      }, 200);
    }
  });
});

// ========== MODULE 1: PRESENSI QR ==========
// Dosen View
const btnGenQR = document.getElementById('btn-generate-qr');
if (btnGenQR) {
  btnGenQR.addEventListener('click', async () => {
    const course_id = document.getElementById('course-id').value;
    const session_id = document.getElementById('session-id').value;

    if (!course_id || !session_id) return showToast('Isi Course ID & Session ID!', 'error');

    const payload = {
      course_id, session_id,
      ts: getTs()
    };

    const btn = document.getElementById('btn-generate-qr');
    btn.innerText = 'Generating...';

    try {
      const res = await apiFetch('/presence/qr/generate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const { qr_token, expires_at } = res.data;
        document.getElementById('qr-result').classList.remove('hidden');
        document.getElementById('lbl-qr-token').innerText = qr_token;
        document.getElementById('lbl-qr-expiry').innerText = new Date(expires_at).toLocaleTimeString();

        // Render QR
        const qrBox = document.getElementById('qrcode-display');
        qrBox.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
          // Menggunakan qrcodejs (Library standar Google Apps Script & web pure)
          new QRCode(qrBox, {
            text: qr_token,
            width: 250, 
            height: 250, 
            colorDark: "#0b0f19", 
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
          });
        }
        showToast('QR Token Generated!', 'success');
      } else {
        showToast(`Error: ${res.error}`, 'error');
      }
    } catch (e) { console.error(e); } finally {
      btn.innerText = 'Generate QR Token';
    }
  });
}

// Scanner Logic
let html5QrcodeScanner = null;
const btnStartScan = document.getElementById('btn-start-scan');
if (btnStartScan) {
  btnStartScan.addEventListener('click', () => {
    document.getElementById('reader').classList.remove('hidden');
    document.getElementById('btn-start-scan').classList.add('hidden');
    document.getElementById('btn-stop-scan').classList.remove('hidden');

    if (typeof Html5QrcodeScanner !== 'undefined') {
      html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
      html5QrcodeScanner.render(onScanSuccess, onScanFailure);
    }
  });
}

const btnStopScan = document.getElementById('btn-stop-scan');
if (btnStopScan) {
  btnStopScan.addEventListener('click', () => {
    if (html5QrcodeScanner) {
      html5QrcodeScanner.clear().then(() => {
        document.getElementById('reader').classList.add('hidden');
        document.getElementById('btn-start-scan').classList.remove('hidden');
        document.getElementById('btn-stop-scan').classList.add('hidden');
      });
    }
  });
}

function onScanFailure(error) { /* ignore frequent fail events */ }
function onScanSuccess(decodedText, decodedResult) {
  document.getElementById('manual-token').value = decodedText;
  showToast(`Token Scanned: ${decodedText}`, 'success');
  if (html5QrcodeScanner) {
    document.getElementById('btn-stop-scan').click();
  }
  document.getElementById('btn-checkin').click();
}

// Checkin Request
const btnCheckin = document.getElementById('btn-checkin');
if (btnCheckin) {
  btnCheckin.addEventListener('click', async () => {
    const qr_token = document.getElementById('manual-token').value;
    const user_id = document.getElementById('user-id').value;
    const course_id = document.getElementById('course-id').value;
    const session_id = document.getElementById('session-id').value;

    if (!qr_token || !user_id) return showToast('NIM & Token wajib diisi!', 'error');

    const payload = {
      user_id, device_id: getDeviceId(),
      course_id, session_id,
      qr_token, ts: getTs()
    };

    const btn = document.getElementById('btn-checkin');
    btn.innerText = 'Sending...';

    try {
      const res = await apiFetch('/presence/checkin', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res && res.ok) {
        showToast('Check-in Berhasil!', 'success');
        document.getElementById('status-result').classList.remove('hidden');
        const badge = document.getElementById('lbl-status');
        badge.innerText = res.data.status;
        badge.className = `badge status-${res.data.status}`;
      }
    } catch (e) { console.error(e); } finally { btn.innerText = 'Check-in'; }
  });
}

// Check Status
const btnCheckStatus = document.getElementById('btn-check-status');
if (btnCheckStatus) {
  btnCheckStatus.addEventListener('click', async () => {
    const user_id = document.getElementById('user-id').value;
    const course_id = document.getElementById('course-id').value;
    const session_id = document.getElementById('session-id').value;

    if (!user_id) return showToast('NIM wajib diisi untuk cek status', 'error');

    const btn = document.getElementById('btn-check-status');
    btn.innerText = 'Mengecek...';

    try {
      const qs = new URLSearchParams({ user_id, course_id, session_id }).toString();
      const res = await apiFetch(`/presence/status?${qs}`, { method: 'GET' });

      if (res && res.ok) {
        document.getElementById('status-result').classList.remove('hidden');
        const badge = document.getElementById('lbl-status');
        badge.innerText = res.data.status;
        badge.className = `badge status-${res.data.status}`;
        showToast('Status ditarik dari server', 'success');
      }
    } catch (e) { console.error(e); } finally { btn.innerText = 'Cek Status Saya'; }
  });
}

// ========== MODULE 2: ACCELEROMETER ==========
let accelChartInit = null;
let accelInterval = null;
let accelBatch = [];
let lastMotion = { x: 0, y: 0, z: 0 };
const BATCH_LIMIT = 5; // Send every 5 samples
const SAMPLE_RATE_MS = 1000; // Take sample every 1s

// Listen device motion, save to latest memory
window.addEventListener('devicemotion', (event) => {
  if (event.accelerationIncludingGravity) {
    lastMotion.x = event.accelerationIncludingGravity.x || 0;
    lastMotion.y = event.accelerationIncludingGravity.y || 0;
    lastMotion.z = event.accelerationIncludingGravity.z || 0;
  }
});

// For PC Demo Simulation if no accelerometer
function simulateMotion() {
  lastMotion.x = Math.sin(Date.now() / 1000) * 10;
  lastMotion.y = Math.cos(Date.now() / 1000) * 10;
  lastMotion.z = 9.8 + (Math.random() - 0.5);
}

const btnStartAccel = document.getElementById('btn-start-accel');
if (btnStartAccel) {
  btnStartAccel.addEventListener('click', () => {
    document.getElementById('btn-start-accel').classList.add('hidden');
    document.getElementById('btn-stop-accel').classList.remove('hidden');
    document.getElementById('sensor-dot').classList.add('active');

    // Create chart if not exists
    if (!accelChartInit && typeof Chart !== 'undefined') initAccelChart();

    accelInterval = setInterval(() => {
      // Check if real device motion exists, otherwise inject simulated fallback for testing in PC browser
      if (lastMotion.x === 0 && lastMotion.y === 0 && lastMotion.z === 0) simulateMotion();

      // Update UI Realtime
      document.getElementById('sens-x').innerText = lastMotion.x.toFixed(2);
      document.getElementById('sens-y').innerText = lastMotion.y.toFixed(2);
      document.getElementById('sens-z').innerText = lastMotion.z.toFixed(2);

      // Push target
      accelBatch.push({
        t: getTs(),
        x: parseFloat(lastMotion.x.toFixed(3)),
        y: parseFloat(lastMotion.y.toFixed(3)),
        z: parseFloat(lastMotion.z.toFixed(3))
      });

      const count = accelBatch.length;
      document.getElementById('batch-count').innerText = count;
      document.getElementById('batch-progress').value = count;
      document.getElementById('batch-progress').max = BATCH_LIMIT;

      if (accelBatch.length >= BATCH_LIMIT) {
        sendAccelBatch([...accelBatch]); // Send copy
        accelBatch = []; // Reset array  
        document.getElementById('batch-count').innerText = 0;
        document.getElementById('batch-progress').value = 0;
      }
    }, SAMPLE_RATE_MS);
  });
}

const btnStopAccel = document.getElementById('btn-stop-accel');
if (btnStopAccel) {
  btnStopAccel.addEventListener('click', () => {
    clearInterval(accelInterval);
    document.getElementById('btn-start-accel').classList.remove('hidden');
    document.getElementById('btn-stop-accel').classList.add('hidden');
    document.getElementById('sensor-dot').classList.remove('active');
  });
}

async function sendAccelBatch(samples) {
  const payload = {
    device_id: getDeviceId(),
    ts: getTs(),
    samples: samples
  };

  try {
    const res = await apiFetch('/telemetry/accel', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res && res.ok) {
      showToast(`Batch sent: ${samples.length} records`, 'success');
    }
  } catch (e) { console.error(e); }
}

// Chart Instance
function initAccelChart() {
  const ctx = document.getElementById('accelChart').getContext('2d');
  accelChartInit = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'X', borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68,0.1)', data: [], borderWidth: 2, pointRadius: 2 },
        { label: 'Y', borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94,0.1)', data: [], borderWidth: 2, pointRadius: 2 },
        { label: 'Z', borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246,0.1)', data: [], borderWidth: 2, pointRadius: 2 }
      ]
    },
    options: {
      responsive: true,
      animation: { duration: 300 },
      scales: {
        x: { display: false },
        y: { beginAtZero: false }
      },
      plugins: { legend: { labels: { color: '#f1f5f9' } } }
    }
  });
}

const btnFetchAccel = document.getElementById('btn-fetch-accel');
if (btnFetchAccel) {
  btnFetchAccel.addEventListener('click', async () => {
    const btn = document.getElementById('btn-fetch-accel');
    btn.innerHTML = `<i class="ph ph-spinner-gap"></i> Fetching...`;
    try {
      const res = await apiFetch(`/telemetry/accel/latest?device_id=${getDeviceId()}`);
      if (res && res.ok && res.data) {
        const d = res.data;
        document.getElementById('lbl-accel-time').innerText = new Date(d.t).toLocaleTimeString();

        // Add point to chart
        if (accelChartInit) {
          const timeLab = new Date(d.t).getSeconds();
          accelChartInit.data.labels.push(timeLab);
          accelChartInit.data.datasets[0].data.push(d.x);
          accelChartInit.data.datasets[1].data.push(d.y);
          accelChartInit.data.datasets[2].data.push(d.z);

          if (accelChartInit.data.labels.length > 20) {
            accelChartInit.data.labels.shift();
            accelChartInit.data.datasets.forEach(ds => ds.data.shift());
          }
          accelChartInit.update();
        }
        showToast('Data sensor diperbarui', 'success');
      }
    } catch (e) { console.error(e); } finally { btn.innerHTML = `<i class="ph ph-arrows-clockwise"></i> Fetch Latest`; }
  });
}

// ========== MODULE 3: GPS TRACKING ==========
let map;
let mapInitialized = false;
let globalMarker, polylineLayer;
let gpsWatchId = null;
let lastGpsPoint = null;

function initMap() {
  if (typeof L === 'undefined') return;
  map = L.map('map').setView([-7.2504, 112.7688], 13); // Default Surabaya
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);

  globalMarker = L.marker([-7.2504, 112.7688]).addTo(map);
  polylineLayer = L.polyline([], { color: '#6366f1', weight: 4 }).addTo(map);
  mapInitialized = true;
}

// Start tracking via Geolocation
const btnStartGps = document.getElementById('btn-start-gps');
if (btnStartGps) {
  btnStartGps.addEventListener('click', () => {
    if (!navigator.geolocation) return showToast('GPS not supported on device', 'error');

    document.getElementById('btn-start-gps').classList.add('hidden');
    document.getElementById('btn-stop-gps').classList.remove('hidden');

    const sts = document.getElementById('gps-status-text');
    sts.innerText = "Tracking Active";
    sts.parentElement.classList.add('active');

    gpsWatchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude, longitude, accuracy } = position.coords;
        document.getElementById('lbl-lat').innerText = latitude.toFixed(6);
        document.getElementById('lbl-lng').innerText = longitude.toFixed(6);
        document.getElementById('lbl-acc').innerText = Math.round(accuracy);

        // Update local marker immediately to feel fast
        if (globalMarker) {
          globalMarker.setLatLng([latitude, longitude]);
          map.setView([latitude, longitude]); // pan to current
        }

        lastGpsPoint = { lat: latitude, lng: longitude, accuracy };

        // Post to Backend
        postGpsData(latitude, longitude, accuracy);
      },
      err => showToast(`GPS Error: ${err.message}`, 'error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function postGpsData(lat, lng, accuracy) {
  const payload = {
    device_id: getDeviceId(),
    ts: getTs(),
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    accuracy_m: parseFloat(accuracy)
  };
  try {
    const res = await apiFetch('/telemetry/gps', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res && res.ok) console.log('✅ GPS logged to GAS');
  } catch (e) { console.error(e); }
}

const btnStopGps = document.getElementById('btn-stop-gps');
if (btnStopGps) {
  btnStopGps.addEventListener('click', () => {
    if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
    document.getElementById('btn-start-gps').classList.remove('hidden');
    document.getElementById('btn-stop-gps').classList.add('hidden');

    const sts = document.getElementById('gps-status-text');
    sts.innerText = "Standby";
    sts.parentElement.classList.remove('active');
  });
}

// Fetch Latest Mapper
const btnFetchGpsLatest = document.getElementById('btn-fetch-gps-latest');
if (btnFetchGpsLatest) {
  btnFetchGpsLatest.addEventListener('click', async () => {
    const btn = document.getElementById('btn-fetch-gps-latest');
    btn.innerText = 'Working...';
    try {
      const res = await apiFetch(`/telemetry/gps/latest?device_id=${getDeviceId()}`);
      if (res && res.ok && res.data) {
        let { lat, lng } = res.data;
        lat = parseFloat(lat);
        lng = parseFloat(lng);
        if (globalMarker && !isNaN(lat) && !isNaN(lng)) {
          globalMarker.setLatLng([lat, lng]);
          globalMarker.bindPopup(`Last seen: ${new Date(res.data.ts).toLocaleTimeString()}`).openPopup();
          map.flyTo([lat, lng], 15);
        }
        showToast('Posisi terbaru ditarik', 'success');
      }
    } catch (e) { console.error(e); } finally { btn.innerText = 'Ambil Latest (Marker)'; }
  });
}

// Fetch History Polyline
const btnFetchGpsHistory = document.getElementById('btn-fetch-gps-history');
if (btnFetchGpsHistory) {
  btnFetchGpsHistory.addEventListener('click', async () => {
    const btn = document.getElementById('btn-fetch-gps-history');
    btn.innerText = 'Working...';
    try {
      const res = await apiFetch(`/telemetry/gps/history?device_id=${getDeviceId()}&limit=50`);
      if (res && res.ok && res.data && res.data.items) {
        const g_points = res.data.items
          .map(i => [parseFloat(i.lat), parseFloat(i.lng)])
          .filter(p => !isNaN(p[0]) && !isNaN(p[1])); // Pastikan angka valid

        if (polylineLayer && g_points.length > 0) {
          polylineLayer.setLatLngs(g_points);
          map.fitBounds(polylineLayer.getBounds(), { padding: [20, 20] });
        }
        showToast(`Riwayat lokasi berhasil digambar (${g_points.length} titik)`, 'success');
      }
    } catch (e) { console.error(e); } finally { btn.innerText = 'Ambil History (Polyline)'; }
  });
}
