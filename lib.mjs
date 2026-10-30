// Logika murni aplikasi: baca Excel/CSV, normalisasi nomor, isi template,
// aturan status dan kuota. Tidak menyentuh jaringan; yang menulis file ada di server.mjs.
import path from 'node:path';
import ExcelJS from 'exceljs';

export const STATUS = [
  'Belum dihubungi',
  'Terkirim',
  'Dibalas',
  'Tertarik',
  'Menolak',
  'Jangan hubungi lagi',
  'Nomor tidak terdaftar',
];

// Klien dengan status ini tidak boleh masuk antrean jenis apa pun.
export const STATUS_BLOKIR = ['Menolak', 'Jangan hubungi lagi', 'Nomor tidak terdaftar'];

export const HARI_FOLLOW_UP = 3;
export const MAKS_FOLLOW_UP = 1;
export const BATAS_HARIAN_DEFAULT = 20;

export const TEMPLATE_PERTAMA_DEFAULT = [
  'Halo, selamat siang. Saya {nama_saya}, pembuat website untuk usaha lokal di Yogyakarta.',
  'Saya lihat {nama} punya rating {rating} dari {jumlah_rating} ulasan di Google Maps, tapi belum punya website sendiri.',
  'Website bisa membantu pelanggan baru menemukan menu, lokasi, dan kontak {nama} dengan lebih mudah.',
  'Proposal singkatnya bisa dilihat di sini: {link_proposal}',
  'Kalau tidak berminat, cukup balas "tidak" dan saya tidak akan menghubungi lagi. Terima kasih.',
].join('\n');

export const TEMPLATE_FOLLOW_UP_DEFAULT = [
  'Halo, saya {nama_saya} lagi. Mau menanyakan apakah sempat melihat proposal website untuk {nama} kemarin?',
  'Kalau tidak berminat, cukup balas "tidak" ya. Terima kasih.',
].join('\n');

export const PENGATURAN_DEFAULT = {
  namaSaya: '',
  linkProposal: '',
  bukaDengan: 'desktop',
  batasHarian: BATAS_HARIAN_DEFAULT,
  templatePertama: TEMPLATE_PERTAMA_DEFAULT,
  templateFollowUp: TEMPLATE_FOLLOW_UP_DEFAULT,
};

export function storeBaru() {
  return {
    versi: 1,
    pengaturan: { ...PENGATURAN_DEFAULT },
    harian: { tanggal: tanggalLokal(), terpakai: 0 },
    klien: {},
  };
}

/* ---------------------------------------------------------------- */
/* Waktu                                                            */
/* ---------------------------------------------------------------- */

const dua = (n) => String(n).padStart(2, '0');

export function tanggalLokal(d = new Date()) {
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

export function formatWaktu(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${tanggalLokal(d)} ${dua(d.getHours())}:${dua(d.getMinutes())}`;
}

export function hariSejak(iso, sekarang = new Date()) {
  return (sekarang.getTime() - new Date(iso).getTime()) / 86400000;
}

/* ---------------------------------------------------------------- */
/* Nomor telepon                                                    */
/* ---------------------------------------------------------------- */

function normalisasiSatu(teks) {
  const adaPlus = teks.includes('+');
  let digit = teks.replace(/\D/g, '');
  if (!digit) return { nomor: '', alasan: 'Format nomor tidak valid' };
  if (digit.startsWith('00')) digit = digit.slice(2);

  let lokal;
  if (digit.startsWith('62')) lokal = digit.slice(2);
  else if (digit.startsWith('0')) lokal = digit.slice(1);
  else if (digit.startsWith('8')) lokal = digit; // 8xx tanpa angka 0 di depan
  else {
    return {
      nomor: '',
      alasan: adaPlus ? 'Kode negara bukan Indonesia (+62)' : 'Format nomor tidak valid',
    };
  }
  lokal = lokal.replace(/^0+/, ''); // "+62 0812..." sering salah ketik

  if (!lokal.startsWith('8') || lokal.startsWith('80')) {
    return { nomor: '', alasan: 'Bukan nomor HP (telepon rumah atau layanan)' };
  }
  if (lokal.length < 9 || lokal.length > 12) {
    return { nomor: '', alasan: 'Panjang nomor HP tidak wajar' };
  }
  return { nomor: `62${lokal}`, alasan: '' };
}

// Hasil: { nomor: '628xxx' | '', alasan: '' | penjelasan kenapa tidak bisa dipakai }
export function normalisasiNomor(mentah) {
  const teks = String(mentah ?? '').trim();
  if (!teks) return { nomor: '', alasan: 'Nomor kosong' };
  // Satu sel kadang berisi beberapa nomor; pakai yang pertama yang valid.
  const kandidat = teks.split(/[/;,]|\s+atau\s+/i).map((s) => s.trim()).filter(Boolean);
  let alasan = '';
  for (const k of kandidat) {
    const hasil = normalisasiSatu(k);
    if (hasil.nomor) return hasil;
    alasan ||= hasil.alasan;
  }
  return { nomor: '', alasan: alasan || 'Format nomor tidak valid' };
}

/* ---------------------------------------------------------------- */
/* Baca Excel / CSV                                                 */
/* ---------------------------------------------------------------- */

export function normalisasiHeader(teks) {
  return String(teks ?? '').toLowerCase().replace(/[\s_]+/g, '');
}

const KOLOM = {
  namausaha: 'namaUsaha',
  potensi: 'potensi',
  skor: 'skor',
  telepon: 'telepon',
  website: 'website',
  jeniswebsite: 'jenisWebsite',
  kategori: 'kategori',
  alamat: 'alamat',
  rating: 'rating',
  jumlahrating: 'jumlahRating',
  alasan: 'alasan',
  linkmaps: 'linkMaps',
};

const NAMA_KOLOM_WAJIB = { namaUsaha: 'Nama Usaha', telepon: 'Telepon' };

// Nilai sel exceljs -> string/angka biasa, atau { text, hyperlink } bila sel berisi tautan.
function nilaiSel(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('');
  if (v.hyperlink) {
    const teks = typeof v.text === 'object' ? nilaiSel(v.text) : v.text;
    return { text: String(teks ?? v.hyperlink), hyperlink: String(v.hyperlink) };
  }
  if ('result' in v) return nilaiSel(v.result);
  if ('error' in v) return '';
  if ('text' in v) return String(v.text ?? '');
  return '';
}

export function teksNilai(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return String(v.text ?? '').trim();
  return String(v).trim();
}

export function parseCsv(teks) {
  if (teks.charCodeAt(0) === 0xfeff) teks = teks.slice(1);
  const barisPertama = teks.split(/\r?\n/, 1)[0];
  const hitung = (c) => barisPertama.split(c).length - 1;
  const pemisah = hitung(';') > hitung(',') ? ';' : ',';

  const hasil = [];
  let baris = [];
  let sel = '';
  let dalamKutip = false;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (dalamKutip) {
      if (c === '"') {
        if (teks[i + 1] === '"') {
          sel += '"';
          i++;
        } else dalamKutip = false;
      } else sel += c;
    } else if (c === '"') dalamKutip = true;
    else if (c === pemisah) {
      baris.push(sel);
      sel = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && teks[i + 1] === '\n') i++;
      baris.push(sel);
      hasil.push(baris);
      baris = [];
      sel = '';
    } else sel += c;
  }
  if (sel !== '' || baris.length) {
    baris.push(sel);
    hasil.push(baris);
  }
  return hasil;
}

async function bacaXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('File Excel tidak bisa dibaca. Pastikan file .xlsx yang utuh (bukan .xls lama).');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('File Excel tidak punya sheet.');
  const lebar = ws.columnCount;
  const tabel = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    tabel.push(Array.from({ length: lebar }, (_, i) => nilaiSel(row.getCell(i + 1).value)));
  }
  return tabel;
}

function susunKlien(tabel) {
  const [barisHeader, ...data] = tabel;
  if (!barisHeader) throw new Error('File kosong: baris pertama harus berisi header kolom.');

  const header = barisHeader.map((h) => teksNilai(h));
  const peta = {}; // nama kanonik -> indeks kolom
  header.forEach((h, i) => {
    const kanonik = KOLOM[normalisasiHeader(h)];
    if (kanonik && !(kanonik in peta)) peta[kanonik] = i;
  });

  // CSV dari aplikasi pencari klien memakai header "nama"; dipakai hanya bila "Nama Usaha" tidak ada.
  if (!('namaUsaha' in peta)) {
    const i = header.findIndex((h) => normalisasiHeader(h) === 'nama');
    if (i >= 0) peta.namaUsaha = i;
  }

  const hilang = Object.keys(NAMA_KOLOM_WAJIB).filter((k) => !(k in peta));
  if (hilang.length) {
    throw new Error(
      `Kolom wajib tidak ditemukan: ${hilang.map((k) => NAMA_KOLOM_WAJIB[k]).join(', ')}. ` +
        'Baris pertama harus berisi nama kolom (header).',
    );
  }

  const kolom = header.map((nama, indeks) => ({ nama, indeks })).filter((k) => k.nama);
  const klien = [];
  const sudahAda = new Set();
  const dilewati = { tanpaNama: 0, duplikat: 0 };

  for (const baris of data) {
    if (baris.every((v) => teksNilai(v) === '')) continue;
    const ambil = (k) => (k in peta ? teksNilai(baris[peta[k]]) : '');

    const namaUsaha = ambil('namaUsaha');
    if (!namaUsaha) {
      dilewati.tanpaNama++;
      continue;
    }

    const mentahMaps = 'linkMaps' in peta ? baris[peta.linkMaps] : '';
    const linkMaps = (typeof mentahMaps === 'object' && mentahMaps?.hyperlink
      ? mentahMaps.hyperlink
      : teksNilai(mentahMaps)
    ).trim();

    const telepon = ambil('telepon');
    const { nomor, alasan: nomorAlasan } = normalisasiNomor(telepon);
    const kunci = linkMaps || nomor || `nama:${namaUsaha.toLowerCase()}`;
    if (sudahAda.has(kunci)) {
      dilewati.duplikat++;
      continue;
    }
    sudahAda.add(kunci);

    const skorTeks = ambil('skor');
    const skorAngka = skorTeks === '' ? NaN : Number(skorTeks.replace(',', '.'));

    klien.push({
      kunci,
      namaUsaha,
      potensi: ambil('potensi'),
      skor: Number.isFinite(skorAngka) ? skorAngka : null,
      telepon,
      nomor,
      nomorAlasan,
      website: ambil('website'),
      jenisWebsite: ambil('jenisWebsite'),
      kategori: ambil('kategori'),
      alamat: ambil('alamat'),
      rating: ambil('rating'),
      jumlahRating: ambil('jumlahRating'),
      alasan: ambil('alasan'),
      linkMaps,
      asli: kolom.map((k) => baris[k.indeks] ?? ''),
    });
  }

  const kolomTerbaca = Object.fromEntries(Object.entries(peta).map(([k, i]) => [k, header[i]]));
  return {
    kolom: kolom.map((k) => k.nama),
    kolomTerbaca,
    adaSkor: 'skor' in peta,
    adaPotensi: 'potensi' in peta,
    klien,
    dilewati,
  };
}

export async function bacaDaftarKlien(buffer, namaFile) {
  const ekstensi = path.extname(namaFile || '').toLowerCase();
  let tabel;
  if (ekstensi === '.csv') tabel = parseCsv(buffer.toString('utf8'));
  else if (ekstensi === '.xlsx') tabel = await bacaXlsx(buffer);
  else throw new Error('Format file tidak didukung. Upload file .xlsx atau .csv.');
  return susunKlien(tabel);
}

// Laporan: semua kolom asli + status, catatan, dan tanggal kontak.
export async function buatLaporan(kolom, daftar) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Laporan');
  const tambahan = ['Nomor WhatsApp', 'Status', 'Catatan', 'Tanggal kirim pertama', 'Tanggal kontak terakhir', 'Follow-up terkirim'];
  ws.addRow([...kolom, ...tambahan]).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const k of daftar) {
    ws.addRow([
      ...k.asli,
      k.nomor,
      k.status,
      k.catatan,
      formatWaktu(k.tanggalKirim),
      formatWaktu(k.tanggalKontakTerakhir),
      k.followUpKe ? 'Ya' : '',
    ]);
  }
  // Nomor WhatsApp harus tetap teks supaya angka 62 di depan tidak diubah.
  ws.getColumn(kolom.length + 1).numFmt = '@';
  kolom.forEach((nama, i) => {
    ws.getColumn(i + 1).width = Math.min(45, Math.max(12, nama.length + 4));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------------------------------------------- */
/* Template                                                         */
/* ---------------------------------------------------------------- */

export function rapikanTeks(teks) {
  return String(teks ?? '').replace(/\r\n?/g, '\n');
}

function formatRating(r) {
  if (r === '' || Number.isNaN(Number(r))) return r;
  return String(Number(r)).replace('.', ',');
}

function formatJumlah(j) {
  return /^\d+$/.test(j) ? Number(j).toLocaleString('id-ID') : j;
}

export function isiTemplate(template, klien, pengaturan) {
  const nilai = {
    nama: klien.namaUsaha,
    kategori: klien.kategori,
    rating: formatRating(klien.rating),
    jumlah_rating: formatJumlah(klien.jumlahRating),
    alamat: klien.alamat,
    alasan: klien.alasan,
    link_proposal: pengaturan.linkProposal,
    nama_saya: pengaturan.namaSaya,
  };
  return rapikanTeks(template).replace(/\{(\w+)\}/g, (utuh, k) =>
    Object.hasOwn(nilai, k) ? (nilai[k] ?? '') : utuh,
  );
}

// jenis: 'pertama' | 'followUp'. Pesan yang diedit manual menggantikan template.
export function pesanUntuk(klien, jenis, pengaturan) {
  const kustom = klien.pesanKustom?.[jenis];
  if (typeof kustom === 'string' && kustom !== '') return rapikanTeks(kustom);
  const template = jenis === 'followUp' ? pengaturan.templateFollowUp : pengaturan.templatePertama;
  return isiTemplate(template, klien, pengaturan);
}

const OPSI_BERHENTI =
  /berhenti|tidak\s+berminat|tidak\s+akan\s+(?:menghubungi|mengirim)|jangan\s+(?:di)?hubungi|balas\s+["“”']?\s*tidak/i;

export function periksaTemplate(template, jenis) {
  const peringatan = [];
  if (!template.includes('{nama}')) {
    peringatan.push('Template tidak memuat {nama}, jadi pesan tidak menyebut nama usaha.');
  }
  if (jenis === 'pertama' && !template.includes('{link_proposal}')) {
    peringatan.push('Template tidak memuat {link_proposal}, jadi klien tidak menerima link proposal.');
  }
  if (!OPSI_BERHENTI.test(template)) {
    peringatan.push('Template tidak memuat kalimat opsi berhenti (mis. "cukup balas tidak"). Ini penting supaya tidak dianggap spam.');
  }
  return peringatan;
}

// Isian pengaturan yang masih kosong padahal dipakai template.
export function isianBelumLengkap(template, pengaturan) {
  const kurang = [];
  if (template.includes('{link_proposal}') && !pengaturan.linkProposal) kurang.push('Link proposal publik');
  if (template.includes('{nama_saya}') && !pengaturan.namaSaya) kurang.push('Nama saya');
  return kurang;
}

export function buatLinkWhatsApp(nomor, pesan, bukaDengan = 'desktop') {
  const teks = encodeURIComponent(pesan);
  return bukaDengan === 'web'
    ? `https://web.whatsapp.com/send?phone=${nomor}&text=${teks}`
    : `whatsapp://send?phone=${nomor}&text=${teks}`;
}

/* ---------------------------------------------------------------- */
/* Pengaturan                                                       */
/* ---------------------------------------------------------------- */

function periksaLinkProposal(link) {
  if (!link) return;
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error('Link proposal tidak valid. Tulis lengkap, mis. https://drive.google.com/...');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Link proposal harus diawali http:// atau https://');
  }
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url.hostname)) {
    throw new Error('Link proposal tidak boleh localhost: klien tidak bisa membukanya. Pakai link publik, mis. Google Drive.');
  }
}

// Gabungkan perubahan dari UI ke pengaturan lama; lempar Error bila ada isian yang salah.
export function rapikanPengaturan(masuk, lama) {
  const baru = { ...lama };
  const teks = (k, maks) => {
    if (masuk[k] === undefined) return;
    if (typeof masuk[k] !== 'string') throw new Error(`Isian "${k}" harus berupa teks.`);
    const nilai = rapikanTeks(masuk[k]);
    if (nilai.length > maks) throw new Error(`Isian "${k}" terlalu panjang (maksimal ${maks} karakter).`);
    baru[k] = nilai;
  };
  teks('namaSaya', 100);
  teks('linkProposal', 500);
  teks('templatePertama', 4000);
  teks('templateFollowUp', 4000);
  baru.namaSaya = baru.namaSaya.trim();
  baru.linkProposal = baru.linkProposal.trim();
  periksaLinkProposal(baru.linkProposal);

  if (masuk.bukaDengan !== undefined) {
    if (!['desktop', 'web'].includes(masuk.bukaDengan)) throw new Error('"Buka dengan" harus WhatsApp Desktop atau WhatsApp Web.');
    baru.bukaDengan = masuk.bukaDengan;
  }
  if (masuk.batasHarian !== undefined) {
    const n = Number(masuk.batasHarian);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error('Batas harian harus bilangan bulat 1 sampai 500.');
    baru.batasHarian = n;
  }
  return baru;
}

/* ---------------------------------------------------------------- */
/* Aturan status dan kuota                                          */
/* ---------------------------------------------------------------- */

// Reset hitungan bila sudah ganti hari, lalu kembalikan keadaan kuota hari ini.
export function segarkanKuota(store, sekarang = new Date()) {
  const tanggal = tanggalLokal(sekarang);
  if (!store.harian || store.harian.tanggal !== tanggal) store.harian = { tanggal, terpakai: 0 };
  const batas = store.pengaturan.batasHarian;
  const terpakai = store.harian.terpakai;
  return { tanggal, batas, terpakai, sisa: Math.max(0, batas - terpakai) };
}

// k: klien yang sudah digabung dengan status dari penyimpanan.
// jenis: 'pertama' | 'followUp'. Hasil: { boleh, alasan }.
export function cekKelayakan(k, jenis, sekarang = new Date()) {
  if (!k.nomor) return { boleh: false, alasan: `Nomor tidak bisa dipakai: ${k.nomorAlasan || 'tidak valid'}` };
  if (STATUS_BLOKIR.includes(k.status)) return { boleh: false, alasan: `Status "${k.status}"` };

  if (jenis === 'followUp') {
    if (k.status !== 'Terkirim') {
      return {
        boleh: false,
        alasan:
          k.status === 'Belum dihubungi'
            ? 'Belum pernah dikirimi pesan pertama'
            : `Status "${k.status}": follow-up hanya untuk yang belum membalas`,
      };
    }
    if ((k.followUpKe || 0) >= MAKS_FOLLOW_UP) {
      return { boleh: false, alasan: `Follow-up sudah dikirim (maksimal ${MAKS_FOLLOW_UP} kali)` };
    }
    if (!(hariSejak(k.tanggalKontakTerakhir, sekarang) >= HARI_FOLLOW_UP)) {
      return { boleh: false, alasan: `Follow-up baru bisa setelah ${HARI_FOLLOW_UP} hari tanpa balasan` };
    }
    return { boleh: true, alasan: '' };
  }

  if (k.status !== 'Belum dihubungi') {
    return { boleh: false, alasan: `Sudah dihubungi (status "${k.status}"), pesan pertama tidak bisa dikirim lagi` };
  }
  return { boleh: true, alasan: '' };
}

// Skor tertinggi dulu; tanpa skor ditaruh di belakang. Urutan awal dipertahankan bila sama.
export function urutkanAntrean(daftar) {
  return daftar
    .map((k, i) => ({ k, i }))
    .sort((a, b) => (b.k.skor ?? -Infinity) - (a.k.skor ?? -Infinity) || a.i - b.i)
    .map((x) => x.k);
}
