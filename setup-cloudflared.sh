#!/bin/bash

# Exit jika terjadi error
set -e

# Warna untuk output terminal
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Cloudflare Tunnel Automated Setup ===${NC}"

# 1. Cek apakah dijalankan sebagai root / sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Harap jalankan script ini menggunakan sudo atau sebagai root!${NC}"
  exit 1
fi

# 2. Tangkap token dari parameter atau prompt input
TUNNEL_TOKEN="$1"

if [ -z "$TUNNEL_TOKEN" ]; then
  echo -n "Masukkan Cloudflare Tunnel Token Anda: "
  read -r TUNNEL_TOKEN
fi

if [ -z "$TUNNEL_TOKEN" ]; then
  echo -e "${RED}Error: Token tidak boleh kosong!${NC}"
  exit 1
fi

# 3. Tambahkan Repository Cloudflare & GPG Key
echo -e "${GREEN}[1/4] Menambahkan repository Cloudflare...${NC}"
mkdir -p /etc/apt/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /etc/apt/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main" | tee /etc/apt/sources.list.d/cloudflared.list

# 4. Install cloudflared
echo -e "${GREEN}[2/4] Menginstal paket cloudflared...${NC}"
apt-get update -qq
apt-get install -y cloudflared

# 5. Install dan jalankan systemd service
echo -e "${GREEN}[3/4] Mendaftarkan dan menjalankan service...${NC}"
# Hapus service lama jika ada
cloudflared service uninstall >/dev/null 2>&1 || true

# Install service baru dengan token
cloudflared service install "$TUNNEL_TOKEN"

# 6. Verifikasi status service
echo -e "${GREEN}[4/4] Memeriksa status service...${NC}"
systemctl daemon-reload
systemctl enable cloudflared
systemctl restart cloudflared

if systemctl is-active --quiet cloudflared; then
  echo -e "${GREEN}=== BERHASIL: Cloudflare Tunnel Service telah aktif dan running! ===${NC}"
  systemctl status cloudflared --no-pager
else
  echo -e "${RED}=== GAGAL: Service cloudflared tidak berhasil berjalan. Cek log dengan: journalctl -u cloudflared -f ===${NC}"
fi