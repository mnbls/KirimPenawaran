# Kirim Penawaran

Aplikasi lokal untuk menghubungi calon klien jasa pembuatan website lewat WhatsApp yang sudah login di PC ini,
secepat mungkin tetapi **tetap Anda sendiri yang menekan kirim**.

Cara kerjanya: aplikasi membuka chat klien di WhatsApp Desktop atau WhatsApp Web dengan pesan yang sudah terisi.
Anda membaca pesannya, menekan Enter di WhatsApp, lalu kembali ke aplikasi dan menekan "Terkirim, lanjut".

Yang **tidak** dilakukan aplikasi ini: memakai library WhatsApp tidak resmi (whatsapp-web.js, Baileys, dan sejenisnya),
mengklik tombol kirim, mengirim pesan tanpa tindakan Anda, atau mengirim data klien ke layanan luar. Server hanya
mendengarkan di `127.0.0.1` (komputer ini saja).

## Kebutuhan

- Windows dengan [Node.js](https://nodejs.org) 18 atau lebih baru (versi LTS).
- WhatsApp Desktop yang sudah login, **atau** akun WhatsApp yang sudah login di <https://web.whatsapp.com>.
- Koneksi internet hanya diperlukan sekali, untuk `npm install` (satu-satunya dependensi: `exceljs`).

## Memasang dan menjalankan

Klik dua kali **`start.bat`**. Skrip ini akan:

1. memeriksa Node.js (dan membuka halaman unduhnya bila belum terpasang),
2. menjalankan `npm install` otomatis bila folder `node_modules` belum ada,
3. membuka browser ke <http://localhost:3838>,
4. menjalankan server.

Biarkan jendela hitamnya tetap terbuka selama memakai aplikasi. Tutup jendela itu (atau tekan Ctrl+C) untuk berhenti.

Cara manual: `npm install` lalu `node server.mjs`. Untuk memakai port lain: `set PORT=4000` sebelum menjalankan.

## Aplikasi desktop (Windows)

Selain lewat browser, aplikasi ini bisa dipasang sebagai aplikasi desktop Windows: jendela sendiri, tanpa jendela hitam,
dengan ikon di desktop dan Start Menu.

- **Memasang**: jalankan `Kirim-Penawaran-Setup-1.0.0.exe` dari folder `dist/` (hasil build, lihat di bawah). Windows
  SmartScreen bisa memperingatkan karena installer belum ditandatangani; klik "More info" lalu "Run anyway".
- **Data** (status, catatan, template, setelan, dan PDF proposal) disimpan di `%APPDATA%\Kirim Penawaran\` pada subfolder
  `data` dan `proposal`. Ini **terpisah** dari versi browser (`start.bat`), dan tidak ikut terhapus saat aplikasi di-uninstall.
- **WhatsApp**: link WhatsApp dibuka oleh Windows (WhatsApp Desktop, atau browser bawaan untuk WhatsApp Web). Hanya link
  `whatsapp://` dan `https://web.whatsapp.com/` yang boleh dibuka dari jendela aplikasi.
- **Hanya satu jendela**: membuka aplikasi untuk kedua kalinya akan memunculkan jendela yang sudah ada.
- **Membangun sendiri**: `npm install`, lalu `npm run dist` (hasil di `dist/`). `npm run desktop` menjalankan versi desktop
  langsung tanpa installer. Electron dan electron-builder hanya dipakai untuk membungkus aplikasi (devDependencies);
  dependensi aplikasinya tetap `exceljs`.

## Cara pakai

1. **Upload daftar klien.** Di bagian 1, klik "Upload Excel / CSV". Tabel klien muncul.
2. **Isi pengaturan** (bagian 2), lalu "Simpan pengaturan":
   - **Nama saya**: mengisi `{nama_saya}`.
   - **Link proposal publik**: mengisi `{link_proposal}`. Klien tidak bisa membuka link localhost, jadi isi dengan link
     publik seperti Google Drive. Bila kosong, aplikasi menampilkan peringatan dan menolak memulai antrean.
   - **Buka dengan**: WhatsApp Desktop (bawaan) atau WhatsApp Web.
   - **Batas harian**: jumlah klien per hari (bawaan 20).
   - **Template** pesan pertama dan follow-up. Bisa diketik langsung atau diunggah dari file `.txt`.
3. **Periksa pesan.** Di tabel, klik "Lihat" pada baris klien untuk melihat hasil template dan mengedit pesannya
   satu per satu (pilih "Simpan pesan ini"). "Kembalikan ke template" membatalkan edit.
4. **Pilih klien**, lalu klik **Mulai antrean**. Gunakan filter (potensi, skor minimal, hanya nomor HP,
   sembunyikan yang sudah dihubungi), lalu "Pilih yang layak" untuk memilih semua baris yang boleh masuk antrean.
   Antrean mengurutkan klien terpilih dari skor tertinggi (bila file punya kolom Skor) dan membuka chat klien pertama.
5. **Di WhatsApp**: periksa pesan yang sudah terisi, tekan Enter untuk mengirim.
6. **Kembali ke aplikasi.** Panel besar "Sudah terkirim ke ...?" muncul:

   | Tombol | Pintasan | Efek |
   | --- | --- | --- |
   | Terkirim, lanjut | Enter | Status menjadi Terkirim, waktu dicatat, chat klien berikutnya dibuka |
   | Lewati | S | Pindah ke klien berikutnya tanpa mengubah status |
   | Nomor tidak terdaftar | | Status menjadi "Nomor tidak terdaftar", lanjut ke berikutnya |
   | Berhenti | Esc | Menghentikan antrean |

   Tombol "Salin pesan" dan "Buka lagi chat" ada di panel yang sama sebagai cadangan bila pesan tidak terisi otomatis.
   Pintasan keyboard tidak aktif saat Anda sedang mengetik di kolom isian atau membuka jendela pesan.
7. **Ubah status manual** dari tabel untuk Dibalas, Tertarik, Menolak, dan lainnya, serta tulis catatan.
8. **Unduh laporan** (bagian 3) menghasilkan Excel berisi semua kolom asli ditambah nomor WhatsApp, status, catatan,
   dan tanggal kontak.

Klien yang minta file PDF-nya langsung: klik "Buka folder proposal" (membuka Explorer) dan kirim file dari sana.
File PDF bisa diupload lewat tombol "Upload proposal (PDF)" supaya tersimpan di folder `proposal/`.

### Browser meminta izin membuka WhatsApp

Saat pertama kali memakai WhatsApp Desktop, browser bertanya apakah boleh membuka aplikasi WhatsApp. Pilih izinkan
(centang "selalu izinkan" bila ada). Bila memakai WhatsApp Web, chat dibuka di tab baru; kembali ke tab Kirim Penawaran
setelah mengirim.

## Format file klien

Sheet pertama, baris pertama adalah header. Kolom dicocokkan **berdasarkan nama header**, bukan urutan; huruf besar/kecil,
spasi, dan garis bawah diabaikan (`jumlah_rating` sama dengan `Jumlah Rating`). Kolom yang dikenali:

`Nama Usaha`, `Potensi`, `Skor`, `Telepon`, `Website`, `Jenis Website`, `Kategori`, `Alamat`, `Rating`,
`Jumlah Rating`, `Alasan`, `Link Maps`. Kolom lain tetap ikut ke laporan.

- **Wajib**: `Nama Usaha` dan `Telepon`. Kolom lain boleh tidak ada; placeholder-nya diisi kosong.
- Sel berisi hyperlink dibaca teksnya; untuk `Link Maps` yang dipakai adalah alamat tautannya.
- File `.csv` juga didukung (UTF-8, boleh ada BOM, pemisah koma atau titik koma).
- **Kunci unik klien** adalah `Link Maps`. Bila kosong dipakai nomor telepon yang sudah dinormalisasi. Baris dengan kunci
  yang sama hanya dihitung sekali.

### Normalisasi nomor

Spasi dan tanda dihapus; `08xx` menjadi `628xx`; `+62` menjadi `62`. Nomor `8xx` tanpa angka 0 dianggap nomor HP.
Nomor yang bukan nomor HP (telepon rumah seperti `0274...`, layanan `0800`), terlalu pendek atau panjang, atau kosong
ditandai "Tidak dipakai" dan **tidak bisa masuk antrean**. Bila satu sel berisi beberapa nomor (dipisah `/`, `,`, `;`),
yang dipakai adalah nomor HP valid yang pertama.

## Placeholder template

`{nama}` `{kategori}` `{rating}` `{jumlah_rating}` `{alamat}` `{alasan}` `{link_proposal}` `{nama_saya}`

Rating ditulis dengan koma (4,5) dan jumlah ulasan dengan titik ribuan (1.234). `{alasan}` diisi apa adanya dari kolom
Alasan di file. Aplikasi memberi peringatan bila template tidak memuat `{nama}`, `{link_proposal}` (hanya pesan pertama),
atau kalimat opsi berhenti seperti "cukup balas tidak".

Template bawaan menyebut identitas Anda dan ditutup dengan kalimat opsi berhenti. Template bawaan juga menyebut klien
"belum punya website"; tabel menandai klien yang kolom Website-nya terisi dengan label "Ada website", periksa dulu sebelum mengirim.

## Aturan agar tidak jadi spam

- **Batas harian** (bawaan 20 klien per hari, bisa diubah). Hitungannya bertambah setiap kali Anda menekan
  "Terkirim, lanjut" atau "Nomor tidak terdaftar" dan kembali nol tiap pergantian hari. Antrean berhenti sendiri saat
  kuota habis, dan antrean baru tidak bisa dimulai bila kuota sudah habis.
- Klien berstatus **Menolak**, **Jangan hubungi lagi**, atau **Nomor tidak terdaftar** tidak bisa masuk antrean.
- Klien yang sudah **Terkirim** (atau status lain selain "Belum dihubungi") tidak bisa dikirimi **pesan pertama** lagi.
- **Follow-up** memakai template terpisah, hanya untuk klien berstatus Terkirim, baru bisa dipakai **3 hari** setelah
  kontak terakhir tanpa balasan, dan **maksimal 1 kali** per klien. Pilih "Follow-up" di "Jenis antrean".
- Mengubah status secara manual kembali ke "Belum dihubungi" adalah keputusan Anda sendiri dan membuka kemungkinan
  pesan pertama dikirim lagi, jadi lakukan hanya bila memang keliru menandai.

## Penyimpanan data

Semua tersimpan di PC ini dan tidak dikirim ke layanan luar mana pun.

- `data/kontak.json` (dibuat otomatis): template, setelan, kuota hari ini, serta status, catatan, tanggal kontak, dan
  pesan hasil edit per klien, dengan kunci unik klien. File ditulis ke file sementara lalu di-rename supaya aman.
  Karena kuncinya `Link Maps`, status tetap muncul saat Anda mengupload file yang sama atau versi barunya.
  Bila file ini rusak, ia dipindah ke `kontak.rusak-<waktu>.json` dan aplikasi mulai dengan data baru.
- Isi file Excel/CSV **tidak disimpan**; upload ulang setelah aplikasi dijalankan ulang, lalu status dan catatan
  otomatis tergabung kembali.
- `proposal/`: file PDF yang Anda upload.
- Folder `data/`, `proposal/`, dan `node_modules/` masuk `.gitignore`.

## Struktur folder

```
server.mjs        server lokal dan route API
lib.mjs           baca Excel/CSV, normalisasi nomor, isi template, aturan status dan kuota
index.html        tampilan
data/kontak.json  status, catatan, template, setelan (dibuat otomatis)
proposal/         file PDF proposal
start.bat         pemasang dan peluncur
desktop/main.cjs  pembungkus aplikasi desktop (Electron)
build/icon.png    ikon aplikasi desktop
```

## Pemecahan masalah

- **WhatsApp tidak terbuka / pesan tidak terisi**: klik "Buka lagi chat", atau pakai "Salin pesan" lalu tempel di chat.
  Pastikan WhatsApp Desktop sudah login, atau ganti "Buka dengan" ke WhatsApp Web.
- **WhatsApp Web menampilkan "nomor tidak valid"**: nomor itu tidak terdaftar di WhatsApp. Pilih "Nomor tidak terdaftar".
- **Port 3838 sudah dipakai**: tutup instance lain, atau jalankan dengan `set PORT=3839` sebelum `node server.mjs`.
- **"Link proposal tidak valid"**: tulis lengkap dengan `https://` dan jangan pakai alamat localhost.
- **Folder data lain** (untuk uji coba): `set DATA_DIR=C:\folder\lain` sebelum menjalankan server.
