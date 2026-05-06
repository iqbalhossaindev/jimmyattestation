guard('admin');
setupSections();

let storesCache = [];

async function bootAdmin() {
  const user = currentUser();
  adminWelcome.textContent = `${user.name || 'Admin'} | Backend control panel`;
  const now = new Date();
  reportMonth.value = now.getMonth() === 0 ? 12 : now.getMonth();
  reportYear.value = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  await refreshAll();
}

async function refreshAll() {
  await loadStores();
  await loadUsers();
  await loadProducts();
  await loadAttendance();
  await loadReports();
}

async function loadUsers() {
  const data = await api('/api/admin/users');
  const workers = data.users.filter(u => u.role === 'worker');
  statWorkers.textContent = workers.length;
  usersRows.innerHTML = data.users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}<br><span class="muted">${escapeHtml(u.employee_code || '')}</span></td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td>${escapeHtml(u.store_name || '-')}</td>
      <td><span class="badge warn">Manual Review</span></td>
      <td><span class="badge ${u.active ? 'ok' : 'bad'}">${u.active ? 'Active' : 'Inactive'}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="6">No users.</td></tr>';
}

async function loadStores() {
  const data = await api('/api/admin/stores');
  storesCache = data.stores;
  statStores.textContent = data.stores.filter(s => s.active).length;
  const opts = data.stores.filter(s => s.active).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  workerStoreSelect.innerHTML = `<option value="">No store</option>${opts}`;
  storesRows.innerHTML = data.stores.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.code)}</td>
      <td>${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)}</td>
      <td>${s.radius_m}m</td>
      <td>${escapeHtml(s.opening_time)} - ${escapeHtml(s.closing_time)}</td>
      <td><span class="badge ${s.active ? 'ok' : 'bad'}">${s.active ? 'Active' : 'Inactive'}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="6">No stores.</td></tr>';
}

async function loadProducts() {
  const data = await api('/api/admin/products');
  statProducts.textContent = data.products.filter(p => p.active).length;
  productsRows.innerHTML = data.products.map(p => `
    <tr>
      <td>${escapeHtml(p.model)}</td>
      <td>${escapeHtml(p.category || '-')}</td>
      <td><input style="width:110px" type="number" step="0.01" value="${Number(p.default_price || 0)}" onchange="updateProduct(${p.id}, {default_price: this.value})"></td>
      <td><input style="width:80px" type="number" value="${Number(p.display_order || 0)}" onchange="updateProduct(${p.id}, {display_order: this.value})"></td>
      <td><span class="badge ${p.active ? 'ok' : 'bad'}">${p.active ? 'Active' : 'Inactive'}</span></td>
      <td>${p.active ? `<button class="small danger" onclick="disableProduct(${p.id})">Disable</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="6">No products.</td></tr>';
}


function faceBadgeClass(status) {
  if (status === 'approved') return 'ok';
  if (status === 'rejected' || status === 'expired') return 'bad';
  return 'warn';
}

function faceLabel(status) {
  if (!status) return 'Pending';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function selfieCell(path, id, type, status) {
  const current = status || 'pending';
  const view = path ? `<a class="small" target="_blank" href="${path}">View Photo</a>` : '<span class="muted">No photo</span>';
  const controls = path ? `<div class="toolbar" style="margin-top:8px"><button class="small" onclick="updateFaceReview(${id}, '${type}', 'approved')">Approve</button><button class="small danger" onclick="updateFaceReview(${id}, '${type}', 'rejected')">Reject</button></div>` : '';
  return `${view}<br><span class="badge ${faceBadgeClass(current)}">${faceLabel(current)}</span>${controls}`;
}

function manualReviewCell(r) {
  const inStatus = r.in_face_review_status || 'pending';
  const outStatus = r.out_face_review_status || (r.check_out_time ? 'pending' : null);
  return `<span class="badge ${faceBadgeClass(inStatus)}">IN: ${faceLabel(inStatus)}</span><br>` +
    `<span class="badge ${faceBadgeClass(outStatus)}">OUT: ${outStatus ? faceLabel(outStatus) : '-'}</span>` +
    `${r.face_review_notes ? `<br><span class="muted">${escapeHtml(r.face_review_notes).replace(/\n/g, '<br>')}</span>` : ''}`;
}

async function loadAttendance() {
  const data = await api('/api/admin/attendance');
  statAttendance.textContent = data.attendance.length;
  adminAttendanceRows.innerHTML = data.attendance.map(r => `
    <tr>
      <td>${escapeHtml(r.worker_name)}<br><span class="muted">${escapeHtml(r.employee_code || '')}</span></td>
      <td>${escapeHtml(r.store_name)}</td>
      <td>${fmtDate(r.check_in_time)}</td>
      <td>${fmtDate(r.check_out_time)}</td>
      <td>${fmtMinutes(r.total_work_minutes)}</td>
      <td>${r.total_customers ?? '-'}</td>
      <td>${r.converted_customers ?? '-'}</td>
      <td>${r.total_qty ?? '-'}</td>
      <td>${Number(r.total_value || 0).toFixed(2)}</td>
      <td>${selfieCell(r.in_face_image_path, r.id, 'in', r.in_face_review_status)}</td>
      <td>${selfieCell(r.out_face_image_path, r.id, 'out', r.out_face_review_status)}</td>
      <td>${manualReviewCell(r)}</td>
      <td><span class="badge ${r.status === 'closed' ? 'ok' : 'warn'}">${escapeHtml(r.status)}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="13">No attendance records.</td></tr>';
}

async function loadReports() {
  const data = await api('/api/admin/reports/monthly');
  adminReportRows.innerHTML = data.reports.map(r => `
    <tr>
      <td>${escapeHtml(r.report_id)}</td>
      <td>${escapeHtml(r.worker_name)}<br><span class="muted">${escapeHtml(r.employee_code || '')}</span></td>
      <td>${fmtMonth(r.month, r.year)}</td>
      <td>${r.total_present_days}</td>
      <td>${r.total_absent_days}</td>
      <td>${fmtMinutes(r.total_work_minutes)}</td>
      <td>${r.total_sales_qty}</td>
      <td>${Number(r.total_sales_value || 0).toFixed(2)}</td>
      <td><button class="small" onclick="downloadReport('${r.report_id}')">PDF</button></td>
      <td><a target="_blank" href="/verify-report/${encodeURIComponent(r.report_id)}">Verify</a></td>
    </tr>
  `).join('') || '<tr><td colspan="10">No reports generated yet.</td></tr>';
}

workerForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const payload = formToObject(workerForm);
    if (!payload.assigned_store_id) delete payload.assigned_store_id;
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    workerForm.reset();
    await loadUsers();
    alert('User created.');
  } catch (err) { alert(err.message); }
});

storeForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const payload = formToObject(storeForm);
    await api('/api/admin/stores', { method: 'POST', body: JSON.stringify(payload) });
    storeForm.reset();
    await loadStores();
    alert('Store added.');
  } catch (err) { alert(err.message); }
});

productForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const payload = formToObject(productForm);
    await api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
    productForm.reset();
    await loadProducts();
    alert('Product added.');
  } catch (err) { alert(err.message); }
});

async function updateProduct(id, patch) {
  try {
    await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await loadProducts();
  } catch (err) { alert(err.message); }
}

async function disableProduct(id) {
  if (!confirm('Disable this product from the active logout sales list? Old reports will stay unchanged.')) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    await loadProducts();
  } catch (err) { alert(err.message); }
}


async function updateFaceReview(id, checkType, status) {
  const note = status === 'rejected' ? prompt('Optional rejection note:', '') : '';
  try {
    await api(`/api/admin/attendance/${id}/face-review`, {
      method: 'PATCH',
      body: JSON.stringify({ check_type: checkType, status, note })
    });
    await loadAttendance();
  } catch (err) { alert(err.message); }
}

async function generateReports() {
  try {
    const month = Number(reportMonth.value);
    const year = Number(reportYear.value);
    if (!month || !year) return alert('Month and year are required.');
    const data = await api('/api/admin/reports/monthly/generate', { method: 'POST', body: JSON.stringify({ month, year }) });
    alert(`Generated ${data.reports.length} report(s).`);
    await loadReports();
  } catch (err) { alert(err.message); }
}

bootAdmin().catch(err => alert(err.message));
