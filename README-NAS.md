# Revo Flip V1.3 NAS Edition

Revo Flip berjalan di Synology Container Manager. PDF disimpan pada NAS dan metadata disimpan pada PostgreSQL.

## Folder yang harus dipertahankan

Untuk instalasi ini gunakan folder project:

```text
/volume1/docker/RevoFlip
```

Data berikut tidak ikut diganti saat auto update:

```text
storage/     # file PDF dan data aplikasi
postgres/    # database PostgreSQL
backups/     # backup source sebelum update
.env         # jika digunakan
```

## Auto Update NAS

Repository menyediakan `nas-update.sh`. Script akan:

1. Mengecek commit terbaru pada branch `main`.
2. Berhenti jika NAS sudah memakai versi terbaru.
3. Membuat backup source saat ini.
4. Mengganti source aplikasi dengan versi terbaru dari GitHub.
5. Mempertahankan konfigurasi `docker-compose.yml` lokal dan folder data.
6. Rebuild container `app`.
7. Restart hanya container aplikasi.

Jalankan dari Task Scheduler atau SSH:

```sh
cd /volume1/docker/RevoFlip
sh nas-update.sh
```

Untuk otomatis setiap hari, buat Scheduled Task di DSM yang menjalankan perintah di atas. Jalankan sebagai user yang memiliki akses ke Docker.

> Update tidak menghapus `storage/` atau `postgres/`. Backup source dibuat di `backups/`.

## Upload besar

Frontend memecah PDF menjadi beberapa chunk agar upload besar dapat dilanjutkan. Ukuran maksimum aplikasi saat ini dikonfigurasi hingga 10 GB.

## Akses internet

Jangan membuka port 3000 langsung ke internet. Untuk produksi gunakan Synology Reverse Proxy + HTTPS.
