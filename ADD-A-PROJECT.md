# Cara nambah project baru

Semua project di web dibaca dari satu file: `projects.json`. Kartu di halaman depan, halaman detail, filter rak, sama tombol project sebelum dan berikutnya kebentuk sendiri dari file itu. Ga perlu ngedit HTML.

## Langkahnya

1. Buka `projects.json` di GitHub, klik ikon pensil (Edit this file).
2. Cari project terakhir di daftar `"projects": [ ... ]`. Salin satu blok utuh, dari `{` sampai `}`.
3. Tempel di bawahnya. Kasih koma di antara blok lama dan blok baru.
4. Ganti isinya (lihat contoh di bawah).
5. Klik **Commit changes**. Cloudflare update sendiri, biasanya kurang dari semenit.
6. Buka `https://ferdy-portfolio.pages.dev/project.html?p=SLUG-BARU` buat ngecek.

Urutan di file = urutan di web.

## Contoh blok

```json
{
  "slug": "dock-scheduling",
  "code": "R1-03",
  "rack": "ops",
  "kind": "Synthetic data",
  "year": "2026",
  "doc": "delivery",
  "title": "Dock",
  "titleAccent": "scheduling",
  "short": "Dock scheduling",
  "summary": "Satu kalimat buat kartu di halaman depan.",
  "cardPoints": ["Poin pertama, bagian penting pakai **tebal**", "Poin kedua"],
  "lede": "Satu sampai dua kalimat pembuka di halaman detail.",
  "meta": [
    {"label": "Stack", "value": "Google Sheets, Apps Script"},
    {"label": "Data", "value": "Synthetic"},
    {"label": "Scale", "value": "120 trucks a week"}
  ],
  "visual": "bars",
  "visualCaption": "DOCK · slots per hour",
  "numbers": [
    {"value": 120, "prefix": "", "suffix": "", "comma": false, "label": "trucks a week"},
    {"value": 35, "prefix": "", "suffix": "%", "comma": false, "label": "less waiting time"}
  ],
  "problem": {"title": "Judul masalah", "text": "Penjelasan masalahnya."},
  "approach": {"title": "Judul pendekatan", "text": "Apa yang dibikin."},
  "result": {"title": "Judul hasil", "text": "Apa hasilnya."},
  "detailTitle": "Bagian detail,",
  "detailAccent": "yang oren",
  "details": [
    {"type": "cards", "items": [{"title": "Judul", "text": "Isi", "fix": "Opsional"}]}
  ],
  "tags": ["Apps Script", "Scheduling"],
  "link": {"label": "View code on GitHub", "url": "https://github.com/Ferdyfi24/nama-repo"},
  "note": "Catatan soal datanya."
}
```

## Pilihan isian

| Kolom | Pilihan |
|---|---|
| `rack` | `ops` (Ops & supply chain), `hack` (Hackathons), `data` (Data analytics). Mau rak baru? Tambah kunci baru di `"racks"` paling atas, misalnya `"fin": "Finance"`. |
| `doc` | Bentuk halaman detailnya: `count` (Stock Count Sheet), `po` (Purchase Order), `picking` (Picking List), `delivery` (Delivery Note), `receipt` (Goods Receipt). |
| `visual` | Animasi di kartu dan halaman detail: `line`, `bars`, `network`, `lanes`, `scatter`, `clusters`, `dashboard`, `document`. Mau pakai screenshot sendiri? Tulis `"visual": "image"` dan `"image": "namafile.jpg"`, lalu upload gambarnya ke repo (di folder paling luar, jangan di subfolder). |
| `link` | Tulis `null` kalau ga ada link. |
| `numbers` | `comma: true` biar 42446 tampil jadi 42,446. |

Blok di `details` bisa dicampur:

- `{"type": "table", "columns": ["Kolom 1", "Kolom 2"], "rows": [["01", "Isi kiri", "Isi kanan"]]}`
- `{"type": "cards", "items": [{"title": "...", "text": "...", "fix": "..."}]}`
- `{"type": "bars", "items": [{"label": "...", "value": 60, "suffix": "%"}]}`
- `{"type": "code", "text": "baris kode"}`
- `{"type": "callout", "title": "...", "text": "..."}`

## Kalau salah ketik

Kalau ada koma atau kurung yang kurang, rak project di halaman depan cuma nampilin tulisan "The rack could not be loaded", dan halaman detail project jadi "Not found". Bagian lain halaman depan sama halaman WMS tetap jalan. Buka `projects.json` lagi, cek di sekitar blok yang barusan ditambah, perbaiki, commit lagi. GitHub nyimpen semua versi, jadi selalu bisa balik ke versi sebelumnya lewat tab History.

Hindari tanda pisah panjang di teks. Pakai koma atau titik dua.
