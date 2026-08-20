# RevoFlip

PDF flipbook dengan unggah drag-and-drop, navigasi halaman, mode layar penuh, dan batas file 1 GB.

## Jalankan lokal

```powershell
npm install
npm start
```

Buka `http://localhost:3000`.

## Deploy ke Synology NAS

1. Instal **Container Manager** dari Package Center.
2. Salin proyek ke `/volume1/docker/revo-flipbook`.
3. Di Container Manager, buka **Project** → **Create**, pilih folder proyek, lalu gunakan `compose.yaml`.
4. Jalankan project dan buka `http://IP-NAS:3000`.

Untuk domain publik gunakan Reverse Proxy Synology + HTTPS. Jangan membuka port 3000 langsung ke internet.

> Batas browser adalah 1 GB. Jika ingin lebih tinggi, ubah `maxSize` di `app.js`, `bodyLimit` di `server.js`, dan batas reverse proxy.