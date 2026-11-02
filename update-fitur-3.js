const fs = require('fs');
const path = require('path');

console.log("Membuat file tampilan views/cabang/index.ejs...");

const dirPath = path.join(__dirname, 'views/cabang');
if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
}

const cabangEjsContent = `<%- include('../layouts/header') %>
<div class='p-4'>
  <div class='d-flex justify-content-between mb-3'>
    <h2>Manajemen Cabang Toko</h2>
    <button class='btn btn-primary' data-bs-toggle='modal' data-bs-target='#modalAddBranch' style='background-color: var(--navy);'>+ Tambah Cabang</button>
  </div>
  <div class='card shadow-sm'>
    <div class='card-body table-responsive'>
      <table class='table table-hover align-middle'>
        <thead class='table-light'>
          <tr>
            <th>Kode</th>
            <th>Nama Cabang</th>
            <th>Penanggung Jawab (PIC)</th>
            <th>Telepon</th>
            <th>Alamat</th>
            <th>Total User</th>
            <th>Status</th>
            <th class='text-center'>Aksi</th>
          </tr>
        </thead>
        <tbody>
          <% if (branches && branches.length > 0) { %>
            <% branches.forEach(b => { %>
              <tr>
                <td><code><%= b.code %></code></td>
                <td><strong><%= b.name %></strong></td>
                <td><span class='badge bg-secondary'><i class='bi bi-person'></i> <%= b.pic_name || '-' %></span></td>
                <td><%= b.phone || '-' %></td>
                <td><%= b.address || '-' %></td>
                <td><%= b.user_count || 0 %> Pengguna</td>
                <td>
                  <form action='/cabang/toggle-status' method='POST' class='d-inline'>
                    <input type='hidden' name='id' value='<%= b.id %>'>
                    <input type='hidden' name='is_active' value='<%= b.is_active === 1 ? 0 : 1 %>'>
                    <button type='submit' class='btn btn-sm <%= b.is_active === 1 ? "btn-success" : "btn-danger" %>'>
                      <%= b.is_active === 1 ? "ON (Aktif)" : "OFF (Nonaktif)" %>
                    </button>
                  </form>
                </td>
                <td class='text-center'>
                  <button class='btn btn-sm btn-warning me-1' onclick='editBranch(<%= JSON.stringify(b) %>)'><i class='bi bi-pencil'></i> Edit</button>
                </td>
              </tr>
            <% }) %>
          <% } else { %>
            <tr><td colspan='8' class='text-center p-4 text-muted'>Belum ada data cabang toko.</td></tr>
          <% } %>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Modal Tambah Cabang -->
<div class='modal fade' id='modalAddBranch' tabindex='-1'>
  <div class='modal-dialog'>
    <form action='/cabang/add' method='POST' class='modal-content'>
      <div class='modal-header'><h5 class='modal-title'>Tambah Cabang Toko Baru</h5><button type='button' class='btn-close' data-bs-dismiss='modal'></button></div>
      <div class='modal-body'>
        <div class='mb-2'><label>Kode Cabang</label><input type='text' name='code' class='form-control text-uppercase' required placeholder='Contoh: CBG-002'></div>
        <div class='mb-2'><label>Nama Cabang</label><input type='text' name='name' class='form-control' required placeholder='Contoh: Cabang Surabaya'></div>
        <div class='mb-2'><label>Penanggung Jawab (PIC / Manager)</label><input type='text' name='pic_name' class='form-control' required placeholder='Contoh: Ahmad Subagyo'></div>
        <div class='mb-2'><label>Nomor Telepon</label><input type='text' name='phone' class='form-control' placeholder='0812...'></div>
        <div class='mb-2'><label>Alamat Lengkap</label><textarea name='address' class='form-control' rows='2'></textarea></div>
      </div>
      <div class='modal-footer'><button type='submit' class='btn btn-primary'>Simpan Cabang</button></div>
    </form>
  </div>
</div>

<!-- Modal Edit Cabang -->
<div class='modal fade' id='modalEditBranch' tabindex='-1'>
  <div class='modal-dialog'>
    <form action='/cabang/edit' method='POST' class='modal-content'>
      <div class='modal-header'><h5 class='modal-title'>Edit Cabang Toko</h5><button type='button' class='btn-close' data-bs-dismiss='modal'></button></div>
      <div class='modal-body'>
        <input type='hidden' name='id' id='edit_b_id'>
        <div class='mb-2'><label>Kode Cabang</label><input type='text' name='code' id='edit_b_code' class='form-control' required></div>
        <div class='mb-2'><label>Nama Cabang</label><input type='text' name='name' id='edit_b_name' class='form-control' required></div>
        <div class='mb-2'><label>Penanggung Jawab (PIC)</label><input type='text' name='pic_name' id='edit_b_pic' class='form-control' required></div>
        <div class='mb-2'><label>Nomor Telepon</label><input type='text' name='phone' id='edit_b_phone' class='form-control'></div>
        <div class='mb-2'><label>Alamat Lengkap</label><textarea name='address' id='edit_b_address' class='form-control' rows='2'></textarea></div>
      </div>
      <div class='modal-footer'><button type='submit' class='btn btn-warning'>Update Cabang</button></div>
    </form>
  </div>
</div>

<script>
function editBranch(b) {
    document.getElementById('edit_b_id').value = b.id;
    document.getElementById('edit_b_code').value = b.code;
    document.getElementById('edit_b_name').value = b.name;
    document.getElementById('edit_b_pic').value = b.pic_name || '';
    document.getElementById('edit_b_phone').value = b.phone || '';
    document.getElementById('edit_b_address').value = b.address || '';
    new bootstrap.Modal(document.getElementById('modalEditBranch')).show();
}
</script>
<%- include('../layouts/footer') %>`;

fs.writeFileSync(path.join(dirPath, 'index.ejs'), cabangEjsContent.trim(), 'utf8');

console.log("\n========================================================");
console.log(" PEMBUATAN VIEW CABANG BERHASIL ");
console.log("========================================================");