// Server lokal Kirim Penawaran. Hanya mendengarkan di 127.0.0.1, tanpa framework.
// Aplikasi ini TIDAK mengirim pesan: ia hanya menyiapkan link WhatsApp yang dibuka
// di browser, lalu Anda sendiri yang menekan Enter/kirim di WhatsApp.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as lib from './lib.mjs';

const FOLDER = path.dirname(fileURLToPath(import.meta.url));
const FOLDER_DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(FOLDER, 'data');
const FILE_DATA = path.join(FOLDER_DATA, 'kontak.json');
const FOLDER_PROPOSAL = path.join(FOLDER, 'proposal');
const PORT = Number(process.env.PORT) || 3838;
const BATAS_EXCEL = 25 * 1024 * 1024;
const BATAS_PDF = 50 * 1024 * 1024;
const BATAS_JSON = 1024 * 1024;

class GalatHttp extends Error {
  constructor(status, pesan, detail) {
    super(pesan);
    this.status = status;
    this.detail = detail;
  }
}

/* ---------------------------------------------------------------- */
/* Penyimpanan data/kontak.json                                     */
/* ---------------------------------------------------------------- */

let store = lib.storeBaru();
let antrianTulis = Promise.resolve();

async function muatStore() {
  let teks;
  try {
    teks = await fs.readFile(FILE_DATA, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  try {
    const dibaca = JSON.parse(teks);
    store = {
      ...lib.storeBaru(),
      ...dibaca,
      pengaturan: { ...lib.PENGATURAN_DEFAULT, ...dibaca.pengaturan },
      klien: dibaca.klien && typeof dibaca.klien === 'object' ? dibaca.klien : {},
    };
  } catch {
    const cadangan = FILE_DATA.replace(/\.json$/, `.rusak-${Date.now()}.json`);
    await fs.rename(FILE_DATA, cadangan);
    console.warn(`kontak.json rusak dan dipindah ke ${path.basename(cadangan)}. Memulai data baru.`);
  }
}

// Tulis ke file sementara lalu rename, supaya file lama tidak setengah tertulis bila PC mati.
async function tulisAman(file, isi) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const sementara = `${file}.${process.pid}.tmp`;
  await fs.writeFile(sementara, isi, 'utf8');
  for (let i = 0; ; i++) {
    try {
      await fs.rename(sementara, file);
      return;
    } catch (e) {
      // Di Windows, rename kadang ditolak sesaat karena antivirus/indeks sedang membaca file.
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        await fs.rm(sementara, { force: true });
        throw e;
      }
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

function simpan() {
  const isi = JSON.stringify(store, null, 2); // foto keadaan saat ini; penulisan diurutkan satu per satu
  antrianTulis = antrianTulis.catch(() => {}).then(() => tulisAman(FILE_DATA, isi));
  return antrianTulis.catch((e) => {
    throw new GalatHttp(500, `Gagal menyimpan data: ${e.message}`);
  });
}

function rekam(k) {
  if (!Object.hasOwn(store.klien, k.kunci)) {
    store.klien[k.kunci] = { namaUsaha: k.namaUsaha, status: 'Belum dihubungi', catatan: '', followUpKe: 0 };
  }
  return store.klien[k.kunci];
}

/* ---------------------------------------------------------------- */
/* Data klien dari file yang diupload (disimpan di memori)          */
/* ---------------------------------------------------------------- */

let sesi = null; // { namaFile, kolom, kolomTerbaca, adaSkor, adaPotensi, dilewati, klien, indeks }
let antrean = null; // { jenis, daftar: [kunci], posisi, hasil }

function gabung(k) {
  const c = Object.hasOwn(store.klien, k.kunci) ? store.klien[k.kunci] : {};
  return {
    ...k,
    status: c.status || 'Belum dihubungi',
    catatan: c.catatan || '',
    tanggalKirim: c.tanggalKirim || '',
    tanggalKontakTerakhir: c.tanggalKontakTerakhir || '',
    followUpKe: c.followUpKe || 0,
    pesanKustom: c.pesanKustom || {},
  };
}

function barisUi(k) {
  const g = gabung(k);
  return {
    kunci: g.kunci,
    namaUsaha: g.namaUsaha,
    potensi: g.potensi,
    skor: g.skor,
    telepon: g.telepon,
    nomor: g.nomor,
    nomorAlasan: g.nomorAlasan,
    website: g.website,
    kategori: g.kategori,
    rating: g.rating,
    jumlahRating: g.jumlahRating,
    alamat: g.alamat,
    linkMaps: g.linkMaps,
    status: g.status,
    catatan: g.catatan,
    tanggalKontakTerakhir: g.tanggalKontakTerakhir,
    followUpKe: g.followUpKe,
    kustom: { pertama: Boolean(g.pesanKustom.pertama), followUp: Boolean(g.pesanKustom.followUp) },
    layak: { pertama: lib.cekKelayakan(g, 'pertama'), followUp: lib.cekKelayakan(g, 'followUp') },
  };
}

function ringkasan() {
  const perStatus = Object.fromEntries(lib.STATUS.map((s) => [s, 0]));
  let validHp = 0;
  if (sesi) {
    for (const k of sesi.klien) {
      perStatus[gabung(k).status]++;
      if (k.nomor) validHp++;
    }
  }
  return {
    total: sesi ? sesi.klien.length : 0,
    validHp,
    tidakValid: sesi ? sesi.klien.length - validHp : 0,
    perStatus,
    sisaAntrean: antrean ? antrean.daftar.length - antrean.posisi : 0,
  };
}

async function daftarProposal() {
  let nama;
  try {
    nama = await fs.readdir(FOLDER_PROPOSAL);
  } catch {
    return [];
  }
  const hasil = [];
  for (const n of nama.filter((x) => x.toLowerCase().endsWith('.pdf'))) {
    const st = await fs.stat(path.join(FOLDER_PROPOSAL, n));
    hasil.push({ nama: n, ukuran: st.size, diubah: st.mtime.toISOString() });
  }
  return hasil;
}

function langkahAktif() {
  if (!antrean) return null;
  const k = sesi.indeks.get(antrean.daftar[antrean.posisi]);
  const g = gabung(k);
  const p = store.pengaturan;
  const pesan = lib.pesanUntuk(g, antrean.jenis, p);
  return {
    kunci: g.kunci,
    namaUsaha: g.namaUsaha,
    nomor: g.nomor,
    status: g.status,
    pesan,
    bukaDengan: p.bukaDengan,
    link: lib.buatLinkWhatsApp(g.nomor, pesan, p.bukaDengan),
  };
}

function antreanUi() {
  if (!antrean) return null;
  return {
    jenis: antrean.jenis,
    posisi: antrean.posisi + 1,
    total: antrean.daftar.length,
    hasil: antrean.hasil,
    langkah: langkahAktif(),
  };
}

async function bentukState() {
  const p = store.pengaturan;
  return {
    adaData: Boolean(sesi),
    namaFile: sesi?.namaFile ?? '',
    kolomTerbaca: sesi?.kolomTerbaca ?? {},
    adaSkor: sesi?.adaSkor ?? false,
    adaPotensi: sesi?.adaPotensi ?? false,
    dilewati: sesi?.dilewati ?? { tanpaNama: 0, duplikat: 0 },
    klien: sesi ? sesi.klien.map(barisUi) : [],
    daftarStatus: lib.STATUS,
    ringkasan: ringkasan(),
    kuota: lib.segarkanKuota(store),
    pengaturan: p,
    peringatan: {
      pertama: lib.periksaTemplate(p.templatePertama, 'pertama'),
      followUp: lib.periksaTemplate(p.templateFollowUp, 'followUp'),
    },
    proposal: await daftarProposal(),
    antrean: antreanUi(),
    hariFollowUp: lib.HARI_FOLLOW_UP,
  };
}

/* ---------------------------------------------------------------- */
/* Antrean                                                          */
/* ---------------------------------------------------------------- */

function akhiriAntrean(alasan) {
  const { hasil } = antrean;
  antrean = null;
  return { alasan, hasil };
}

// Maju ke klien berikutnya yang masih layak. Kembalikan info "selesai" bila antrean berakhir.
function lanjutkan() {
  const kuota = lib.segarkanKuota(store);
  while (antrean.posisi < antrean.daftar.length) {
    if (kuota.sisa <= 0) {
      const belum = antrean.daftar.length - antrean.posisi;
      return akhiriAntrean(
        `Kuota hari ini habis (${kuota.terpakai}/${kuota.batas}). Antrean berhenti; ${belum} klien belum dikirimi.`,
      );
    }
    const k = sesi.indeks.get(antrean.daftar[antrean.posisi]);
    if (k && lib.cekKelayakan(gabung(k), antrean.jenis).boleh) return null;
    antrean.posisi++;
  }
  return akhiriAntrean('Antrean selesai.');
}

function mulaiAntrean({ jenis, kunci }) {
  if (!sesi) throw new GalatHttp(400, 'Upload file daftar klien dulu.');
  if (!['pertama', 'followUp'].includes(jenis)) throw new GalatHttp(400, 'Jenis antrean tidak dikenal.');
  if (antrean) throw new GalatHttp(409, 'Antrean masih berjalan. Selesaikan atau hentikan dulu.');
  if (!Array.isArray(kunci) || !kunci.length) throw new GalatHttp(400, 'Pilih minimal satu klien di tabel.');

  const p = store.pengaturan;
  const kuota = lib.segarkanKuota(store);
  if (kuota.sisa <= 0) {
    throw new GalatHttp(
      409,
      `Kuota hari ini sudah habis (${kuota.terpakai}/${kuota.batas}). Coba lagi besok, atau naikkan batas harian di pengaturan.`,
    );
  }
  const template = jenis === 'followUp' ? p.templateFollowUp : p.templatePertama;
  const kurang = lib.isianBelumLengkap(template, p);
  if (kurang.length) throw new GalatHttp(400, `Isi dulu sebelum memulai antrean: ${kurang.join(', ')}.`);

  const layak = [];
  const ditolak = [];
  for (const kk of new Set(kunci)) {
    const k = sesi.indeks.get(kk);
    if (!k) continue;
    const g = gabung(k);
    const cek = lib.cekKelayakan(g, jenis);
    if (cek.boleh) layak.push(g);
    else ditolak.push({ nama: g.namaUsaha, alasan: cek.alasan });
  }
  if (!layak.length) {
    throw new GalatHttp(400, 'Tidak ada klien terpilih yang boleh masuk antrean.', { ditolak });
  }
  antrean = {
    jenis,
    daftar: lib.urutkanAntrean(layak).map((k) => k.kunci),
    posisi: 0,
    hasil: { terkirim: 0, lewati: 0, tidakTerdaftar: 0 },
  };
  return ditolak;
}

async function aksiAntrean({ aksi, kunci }) {
  if (!antrean) throw new GalatHttp(409, 'Tidak ada antrean yang berjalan.');
  if (aksi === 'berhenti') {
    return { selesai: akhiriAntrean('Antrean dihentikan.') };
  }

  // Cegah klik ganda: aksi harus untuk klien yang sedang tampil, bukan klien berikutnya.
  if (kunci !== antrean.daftar[antrean.posisi]) {
    throw new GalatHttp(409, 'Antrean sudah berpindah ke klien lain. Muat ulang halaman bila tampilannya belum berubah.');
  }
  const k = sesi.indeks.get(kunci);
  const sekarang = new Date();
  const iso = sekarang.toISOString();

  if (aksi === 'terkirim' || aksi === 'tidakTerdaftar') {
    const cek = lib.cekKelayakan(gabung(k), antrean.jenis, sekarang);
    if (!cek.boleh) throw new GalatHttp(409, `Klien ini tidak bisa diubah dari antrean: ${cek.alasan}. Pilih Lewati atau Berhenti.`);
    const rek = rekam(k);
    if (aksi === 'terkirim') {
      if (antrean.jenis === 'pertama') {
        rek.status = 'Terkirim';
        rek.tanggalKirim = iso;
        rek.followUpKe = 0;
      } else {
        rek.followUpKe = (rek.followUpKe || 0) + 1;
      }
      antrean.hasil.terkirim++;
    } else {
      rek.status = 'Nomor tidak terdaftar';
      antrean.hasil.tidakTerdaftar++;
    }
    rek.tanggalKontakTerakhir = iso;
    lib.segarkanKuota(store, sekarang);
    store.harian.terpakai++;
  } else if (aksi === 'lewati') {
    antrean.hasil.lewati++;
  } else {
    throw new GalatHttp(400, 'Aksi antrean tidak dikenal.');
  }

  antrean.posisi++;
  const selesai = lanjutkan();
  await simpan();
  return selesai ? { selesai } : {};
}

/* ---------------------------------------------------------------- */
/* HTTP                                                             */
/* ---------------------------------------------------------------- */

function kirim(res, status, tubuh, jenis = 'application/json; charset=utf-8', tambahan = {}) {
  res.writeHead(status, {
    'Content-Type': jenis,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...tambahan,
  });
  res.end(tubuh);
}

const kirimJson = (res, status, objek) => kirim(res, status, JSON.stringify(objek));

function bacaBody(req, batas) {
  return new Promise((resolve, reject) => {
    const potongan = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > batas) {
        reject(new GalatHttp(413, `File terlalu besar (maksimal ${Math.round(batas / 1024 / 1024)} MB).`));
        req.destroy();
        return;
      }
      potongan.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(potongan)));
    req.on('error', reject);
  });
}

async function bacaJson(req) {
  const buf = await bacaBody(req, BATAS_JSON);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new GalatHttp(400, 'Data yang dikirim bukan JSON yang valid.');
  }
}

function namaFileDariHeader(req) {
  try {
    return decodeURIComponent(String(req.headers['x-nama-file'] || ''));
  } catch {
    return '';
  }
}

function bukaFolder(folder) {
  const [perintah, argumen] =
    process.platform === 'win32'
      ? ['explorer.exe', [folder]]
      : process.platform === 'darwin'
        ? ['open', [folder]]
        : ['xdg-open', [folder]];
  return new Promise((resolve, reject) => {
    const anak = spawn(perintah, argumen, { detached: true, stdio: 'ignore' });
    anak.once('error', (e) => reject(new GalatHttp(500, `Folder tidak bisa dibuka: ${e.message}`)));
    anak.once('spawn', () => {
      anak.unref();
      resolve();
    });
  });
}

// Tolak permintaan dari halaman web lain (DNS rebinding / CSRF ke localhost).
function asalDiizinkan(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  const asal = req.headers.origin;
  if (asal) {
    try {
      return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(asal).hostname);
    } catch {
      return false;
    }
  }
  return true;
}

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

async function tangani(req, res) {
  if (!asalDiizinkan(req)) throw new GalatHttp(403, 'Permintaan ditolak: hanya boleh dari komputer ini.');
  const url = new URL(req.url, 'http://localhost');
  const rute = `${req.method} ${url.pathname}`;

  if (rute === 'GET /' || rute === 'GET /index.html') {
    const html = await fs.readFile(path.join(FOLDER, 'index.html'));
    return kirim(res, 200, html, 'text/html; charset=utf-8', { 'Content-Security-Policy': CSP });
  }

  if (rute === 'GET /api/state') return kirimJson(res, 200, await bentukState());

  if (rute === 'GET /api/template-bawaan') {
    return kirimJson(res, 200, { pertama: lib.TEMPLATE_PERTAMA_DEFAULT, followUp: lib.TEMPLATE_FOLLOW_UP_DEFAULT });
  }

  if (rute === 'POST /api/upload') {
    const nama = namaFileDariHeader(req);
    const hasil = await lib.bacaDaftarKlien(await bacaBody(req, BATAS_EXCEL), nama).catch((e) => {
      throw e instanceof GalatHttp ? e : new GalatHttp(400, e.message);
    });
    sesi = { namaFile: nama, ...hasil, indeks: new Map(hasil.klien.map((k) => [k.kunci, k])) };
    antrean = null; // data diganti, antrean lama tidak berlaku lagi
    return kirimJson(res, 200, await bentukState());
  }

  if (rute === 'PUT /api/pengaturan') {
    const masuk = await bacaJson(req);
    try {
      store.pengaturan = lib.rapikanPengaturan(masuk, store.pengaturan);
    } catch (e) {
      throw new GalatHttp(400, e.message);
    }
    await simpan();
    return kirimJson(res, 200, await bentukState());
  }

  if (rute === 'POST /api/periksa-template') {
    const { template, jenis } = await bacaJson(req);
    const teks = lib.rapikanTeks(typeof template === 'string' ? template : '');
    return kirimJson(res, 200, { peringatan: lib.periksaTemplate(teks, jenis === 'followUp' ? 'followUp' : 'pertama') });
  }

  if (rute === 'PUT /api/klien') {
    const masuk = await bacaJson(req);
    const k = sesi?.indeks.get(masuk.kunci);
    if (!k) throw new GalatHttp(404, 'Klien tidak ditemukan. Upload ulang file bila halaman sudah lama terbuka.');
    const rek = rekam(k);
    if (masuk.status !== undefined && masuk.status !== rek.status) {
      if (!lib.STATUS.includes(masuk.status)) throw new GalatHttp(400, 'Status tidak dikenal.');
      rek.status = masuk.status;
      if (masuk.status !== 'Belum dihubungi') {
        const iso = new Date().toISOString();
        rek.tanggalKontakTerakhir = iso;
        if (masuk.status === 'Terkirim' && !rek.tanggalKirim) rek.tanggalKirim = iso;
      }
    }
    if (masuk.catatan !== undefined) {
      if (typeof masuk.catatan !== 'string' || masuk.catatan.length > 1000) {
        throw new GalatHttp(400, 'Catatan harus berupa teks, maksimal 1000 karakter.');
      }
      rek.catatan = masuk.catatan;
    }
    if (masuk.pesanKustom && typeof masuk.pesanKustom === 'object') {
      rek.pesanKustom ??= {};
      for (const jenis of ['pertama', 'followUp']) {
        if (!(jenis in masuk.pesanKustom)) continue;
        const isi = masuk.pesanKustom[jenis];
        if (isi === null || isi === '') delete rek.pesanKustom[jenis];
        else if (typeof isi === 'string' && isi.length <= 4000) rek.pesanKustom[jenis] = lib.rapikanTeks(isi);
        else throw new GalatHttp(400, 'Pesan harus berupa teks, maksimal 4000 karakter.');
      }
    }
    await simpan();
    return kirimJson(res, 200, { klien: barisUi(k), ringkasan: ringkasan(), kuota: lib.segarkanKuota(store) });
  }

  if (rute === 'POST /api/pesan') {
    const { kunci, jenis } = await bacaJson(req);
    const k = sesi?.indeks.get(kunci);
    if (!k) throw new GalatHttp(404, 'Klien tidak ditemukan.');
    const j = jenis === 'followUp' ? 'followUp' : 'pertama';
    const g = gabung(k);
    const p = store.pengaturan;
    const pesan = lib.pesanUntuk(g, j, p);
    return kirimJson(res, 200, {
      pesan,
      kustom: Boolean(g.pesanKustom[j]),
      dariTemplate: lib.isiTemplate(j === 'followUp' ? p.templateFollowUp : p.templatePertama, g, p),
      linkDesktop: g.nomor ? lib.buatLinkWhatsApp(g.nomor, pesan, 'desktop') : '',
      linkWeb: g.nomor ? lib.buatLinkWhatsApp(g.nomor, pesan, 'web') : '',
      kurang: lib.isianBelumLengkap(j === 'followUp' ? p.templateFollowUp : p.templatePertama, p),
    });
  }

  if (rute === 'POST /api/antrean/mulai') {
    const masuk = await bacaJson(req);
    const ditolak = mulaiAntrean(masuk);
    return kirimJson(res, 200, { ditolak, buka: langkahAktif(), state: await bentukState() });
  }

  if (rute === 'POST /api/antrean/aksi') {
    const masuk = await bacaJson(req);
    const hasil = await aksiAntrean(masuk);
    return kirimJson(res, 200, { ...hasil, buka: langkahAktif(), state: await bentukState() });
  }

  if (rute === 'POST /api/proposal') {
    const nama = path.basename(namaFileDariHeader(req)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!nama.toLowerCase().endsWith('.pdf')) throw new GalatHttp(400, 'Proposal harus berupa file .pdf.');
    const isi = await bacaBody(req, BATAS_PDF);
    if (isi.subarray(0, 5).toString('latin1') !== '%PDF-') throw new GalatHttp(400, 'Isi file bukan PDF yang valid.');
    await fs.mkdir(FOLDER_PROPOSAL, { recursive: true });
    await fs.writeFile(path.join(FOLDER_PROPOSAL, nama), isi);
    return kirimJson(res, 200, await bentukState());
  }

  if (rute === 'POST /api/buka-folder-proposal') {
    await fs.mkdir(FOLDER_PROPOSAL, { recursive: true });
    await bukaFolder(FOLDER_PROPOSAL);
    return kirimJson(res, 200, { ok: true });
  }

  if (rute === 'GET /api/laporan') {
    if (!sesi) throw new GalatHttp(400, 'Upload file daftar klien dulu supaya laporan bisa dibuat.');
    const buf = await lib.buatLaporan(sesi.kolom, sesi.klien.map(gabung));
    return kirim(
      res,
      200,
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      { 'Content-Disposition': `attachment; filename="laporan-kirim-penawaran-${lib.tanggalLokal()}.xlsx"` },
    );
  }

  throw new GalatHttp(404, 'Halaman tidak ditemukan.');
}

const server = http.createServer((req, res) => {
  tangani(req, res).catch((e) => {
    if (res.headersSent) return res.destroy();
    if (e instanceof GalatHttp) return kirimJson(res, e.status, { galat: e.message, ...e.detail });
    console.error(e);
    kirimJson(res, 500, { galat: `Kesalahan di server: ${e.message}` });
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah dipakai. Tutup aplikasi lain yang memakainya, atau jalankan dengan PORT=<nomor lain>.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

await muatStore();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Kirim Penawaran berjalan di http://localhost:${PORT}`);
  console.log('Data hanya tersimpan di PC ini. Tekan Ctrl+C untuk berhenti.');
});

process.on('SIGINT', () => {
  antrianTulis.catch(() => {}).finally(() => process.exit(0));
});
