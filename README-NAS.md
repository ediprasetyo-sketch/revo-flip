# Revo Flip V1.2 NAS Edition

Backend V1.2 menyimpan PDF langsung pada shared folder Synology dan metadata pada PostgreSQL.

## Storage

Di Synology buat shared folder `RevoFlip` sehingga path host menjadi:

```text
/volume1/RevoFlip
```

Aplikasi otomatis membuat:

```text
/volume1/RevoFlip/temp
/volume1/RevoFlip/books
/volume1/RevoFlip/covers
/volume1/RevoFlip/thumbnails
```

## Deploy di Synology DS923+

1. Install Container Manager.
2. Clone atau download repository ke folder NAS, misalnya `/volume1/docker/revo-flip/app`.
3. Salin `.env.example` menjadi `.env` dan ganti `POSTGRES_PASSWORD` dengan password kuat.
4. Pastikan shared folder `RevoFlip` tersedia.
5. Dari Container Manager atau terminal jalankan:

```bash
docker compose up -d --build
```

6. Buka `http://IP-NAS:3000`.
7. Endpoint health: `/api/health`.

## Upload besar

Frontend memecah PDF menjadi chunk 50 MiB. Setiap chunk disimpan sementara pada `/volume1/RevoFlip/temp/<upload-id>`. Endpoint status dapat membaca part yang sudah diterima sehingga frontend dapat melanjutkan mekanisme resume.

Saat selesai, server memverifikasi total ukuran, menggabungkan part secara berurutan, lalu menyimpan PDF final di `/volume1/RevoFlip/books`. Metadata buku masuk ke PostgreSQL.

## Catatan keamanan

Jangan membuka port 3000 langsung ke internet. Untuk produksi gunakan Synology Reverse Proxy + HTTPS, dan tambahkan autentikasi admin pada tahap berikutnya.
