guard('worker');
setupSections();

let stream = null;
let latestImage = null;
let latestLocation = null;
let products = [];

async function bootWorker() {
  const me = await api('/api/me');
  const u = me.user;
  document.getElementById('welcomeText').textContent = `${u.name} | ${u.employee_code || u.email}`;
  document.getElementById('faceBadge').textContent = 'Manual selfie review mode';
  document.getElementById('faceBadge').className = 'badge warn';
  await loadStores();
  await loadProducts();
  await loadOpenAttendance();
  await loadAttendance();
  await loadReports();
  setInterval(() => document.getElementById('logoutPreview').textContent = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 1000);
}

async function loadStores() {
  const data = await api('/api/stores');
  storeSelect.innerHTML = data.stores.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${s.code})</option>`).join('');
}

async function loadProducts() {
  const data = await api('/api/products');
  products = data.products;
  salesItems.innerHTML = products.map(p => `
    <tr data-product-id="${p.id}">
      <td>${escapeHtml(p.model)}</td>
      <td><input class="qty" type="number" min="0" value="0" oninput="recalcSales()"></td>
      <td><input class="price" type="number" min="0" step="0.01" value="${Number(p.default_price || 0)}" oninput="recalcSales()"></td>
      <td class="amount value">0.00</td>
    </tr>
  `).join('');
  recalcSales();
}

function recalcSales() {
  let qty = 0, value = 0;
  document.querySelectorAll('#salesItems tr').forEach(tr => {
    const q = Math.max(0, Number(tr.querySelector('.qty').value || 0));
    const price = Math.max(0, Number(tr.querySelector('.price').value || 0));
    const rowValue = q * price;
    tr.querySelector('.value').textContent = rowValue.toFixed(2);
    qty += q;
    value += rowValue;
  });
  totalQty.textContent = qty;
  totalValue.textContent = value.toFixed(2);
  const customers = Math.max(0, Number(totalCustomers.value || 0));
  const converted = Math.max(0, Number(convertedCustomers.value || 0));
  conversionRate.textContent = customers ? `${((converted / customers) * 100).toFixed(2)}%` : '0%';
}

totalCustomers.addEventListener('input', recalcSales);
convertedCustomers.addEventListener('input', recalcSales);

async function loadOpenAttendance() {
  const data = await api('/api/worker/attendance/open');
  if (data.attendance) {
    currentStatus.textContent = 'Checked In';
    openAttendanceId.textContent = `#${data.attendance.id}`;
  } else {
    currentStatus.textContent = 'Not Checked In';
    openAttendanceId.textContent = 'None';
  }
}

async function loadAttendance() {
  const data = await api('/api/worker/attendance');
  attendanceRows.innerHTML = data.attendance.map(r => `
    <tr>
      <td>${fmtDate(r.check_in_time)}</td>
      <td>${escapeHtml(r.store_name)}</td>
      <td>${fmtTime(r.check_in_time)}</td>
      <td>${fmtTime(r.check_out_time)}</td>
      <td>${fmtMinutes(r.total_work_minutes)}</td>
      <td>${r.total_qty ?? '-'}</td>
      <td>${Number(r.total_value || 0).toFixed(2)}</td>
      <td>${renderReviewStatus(r)}</td>
      <td><span class="badge ${r.status === 'closed' ? 'ok' : 'warn'}">${escapeHtml(r.status)}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="9">No attendance yet.</td></tr>';
}

async function loadReports() {
  const data = await api('/api/worker/reports/monthly');
  reportRows.innerHTML = data.reports.map(r => `
    <tr>
      <td>${escapeHtml(r.report_id)}</td>
      <td>${fmtMonth(r.month, r.year)}</td>
      <td>${r.total_present_days}</td>
      <td>${r.total_absent_days}</td>
      <td>${fmtMinutes(r.total_work_minutes)}</td>
      <td>${Number(r.total_sales_value || 0).toFixed(2)}</td>
      <td><button class="small" onclick="downloadReport('${r.report_id}')">PDF</button></td>
    </tr>
  `).join('') || '<tr><td colspan="7">No monthly reports generated yet.</td></tr>';
}


function badgeClass(status) {
  if (status === 'approved') return 'ok';
  if (status === 'rejected' || status === 'expired') return 'bad';
  return 'warn';
}

function reviewLabel(status) {
  if (!status) return '-';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function renderReviewStatus(r) {
  const inStatus = r.in_face_review_status || 'pending';
  const outStatus = r.out_face_review_status || (r.check_out_time ? 'pending' : null);
  return `<span class="badge ${badgeClass(inStatus)}">IN: ${reviewLabel(inStatus)}</span><br>` +
    `<span class="badge ${badgeClass(outStatus)}">OUT: ${reviewLabel(outStatus)}</span>`;
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    camera.srcObject = stream;
  } catch (err) {
    alert('Camera permission failed: ' + err.message);
  }
}

async function captureSnapshot() {
  if (!stream) await startCamera();
  await new Promise(resolve => setTimeout(resolve, 250));
  const ctx = snapshot.getContext('2d');
  ctx.drawImage(camera, 0, 0, snapshot.width, snapshot.height);
  latestImage = snapshot.toDataURL('image/jpeg', 0.88);
  if ('FaceDetector' in window) {
    try {
      const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await detector.detect(snapshot);
      if (!faces.length) alert('No face detected by browser. Please retake the selfie with your face and store background visible.');
    } catch {}
  }
  return latestImage;
}

function getLocationNow() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported on this device.'));
    navigator.geolocation.getCurrentPosition(pos => {
      latestLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      locationStatus.textContent = `${Math.round(pos.coords.accuracy)}m accuracy`;
      resolve(latestLocation);
    }, err => {
      locationStatus.textContent = 'Location failed';
      reject(err);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

async function ensureLocationAndImage() {
  const image = latestImage || await captureSnapshot();
  const loc = latestLocation || await getLocationNow();
  return { image, loc };
}

async function checkIn() {
  try {
    const { image, loc } = await ensureLocationAndImage();
    const data = await api('/api/attendance/check-in', { method: 'POST', body: JSON.stringify({ store_id: storeSelect.value, ...loc, image }) });
    alert(`Checked in successfully. Store selfie submitted for manual admin review. Distance: ${data.location.distance_m}m.`);
    latestImage = null;
    await loadOpenAttendance(); await loadAttendance();
  } catch (err) { alert(err.message); }
}

function buildSalesItems() {
  return [...document.querySelectorAll('#salesItems tr')].map(tr => ({
    product_id: Number(tr.dataset.productId),
    quantity: Number(tr.querySelector('.qty').value || 0),
    unit_price: Number(tr.querySelector('.price').value || 0)
  }));
}

async function checkOut() {
  try {
    recalcSales();
    const { image, loc } = await ensureLocationAndImage();
    const payload = {
      ...loc,
      image,
      total_customers: Number(totalCustomers.value || 0),
      converted_customers: Number(convertedCustomers.value || 0),
      items: buildSalesItems()
    };
    const data = await api('/api/attendance/check-out', { method: 'POST', body: JSON.stringify(payload) });
    alert(`Checked out successfully. Store selfie submitted for manual admin review. Total value: ${Number(data.total_value).toFixed(2)}. Work time: ${fmtMinutes(data.total_work_minutes)}.`);
    document.querySelectorAll('#salesItems .qty').forEach(i => i.value = 0);
    totalCustomers.value = 0; convertedCustomers.value = 0; latestImage = null; latestLocation = null; recalcSales();
    await loadOpenAttendance(); await loadAttendance();
  } catch (err) { alert(err.message); }
}

bootWorker().catch(err => alert(err.message));
