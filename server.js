// server.ts
import "dotenv/config";
import express from "express";
import fs3 from "node:fs";
import path4 from "node:path";
import crypto3 from "node:crypto";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";

// server/store.ts
import fs2 from "node:fs";
import path2 from "node:path";
import crypto2 from "node:crypto";

// server/auth.ts
import crypto from "node:crypto";
var devFallbackSecret = null;
var warnedDevSecret = false;
function getSessionSecret() {
  const configured = String(process.env.SESSION_SECRET ?? "").trim();
  if (configured) return configured;
  if (String(process.env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error("SESSION_SECRET wajib diisi pada NODE_ENV=production.");
  }
  if (!devFallbackSecret) {
    devFallbackSecret = crypto.randomBytes(48).toString("hex");
  }
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn(
      "[security] SESSION_SECRET kosong; memakai secret acak sementara untuk development. Token login akan hangus saat server restart."
    );
  }
  return devFallbackSecret;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  if (!storedHash.startsWith("scrypt:")) {
    return password === storedHash;
  }
  const parts = storedHash.split(":");
  if (parts.length !== 3) return false;
  const [, salt, hexKey] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(hexKey, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}
function signSessionToken(uid, role) {
  const payload = {
    uid,
    role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

// server/mysql-adapter.ts
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
var SYNC_TABLES = [
  "users",
  "instansis",
  "customers",
  "products",
  "finishings",
  "material_rolls",
  "material_offcuts",
  "print_machines",
  "supplies",
  "stok_cattoff",
  "tinta_warna",
  "shifts",
  "suppliers",
  "orders",
  "order_items",
  "cetak_grup",
  "cetak_grup_item",
  "pemakaian_tinta",
  "supply_usages",
  "print_batches",
  "order_payments",
  "design_revisions",
  "advertising_spks",
  "material_logs",
  "operational_expenses",
  "purchase_orders",
  "goods_receipts",
  "supplier_payments",
  "whatsapp_outbox",
  "whatsapp_gateway_config",
  "tax_settings",
  "insentif_rates",
  "audit_logs"
];
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
var MySqlAdapter = class {
  constructor() {
    this.pool = null;
    this.syncQueue = Promise.resolve();
    this.lastPersisted = null;
    this.tableColumns = /* @__PURE__ */ new Map();
    this.tableColumnsLoaded = false;
  }
  isEnabled() {
    return (process.env.DB_DRIVER ?? "json").toLowerCase() === "mysql";
  }
  getConfig() {
    return {
      host: process.env.MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "root",
      password: process.env.MYSQL_PASSWORD ?? "",
      database: process.env.MYSQL_DATABASE ?? "reffo_printflow"
    };
  }
  async initialize(createSeed) {
    const cfg = this.getConfig();
    const bootstrapConn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      multipleStatements: true
    });
    const schemaPath = path.resolve(process.cwd(), "database", "schema.sql");
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, "utf-8");
      await bootstrapConn.query(sql);
    } else {
      await bootstrapConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    }
    await bootstrapConn.end();
    this.pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 10
    });
    await this.migrateSchema();
    await this.loadTableColumns();
    const [userRows] = await this.pool.query("SELECT COUNT(*) AS cnt FROM users");
    const count = Number(userRows[0]?.cnt ?? 0);
    if (count === 0) {
      const seedState = createSeed();
      await this.writeSnapshot(seedState);
      this.lastPersisted = cloneState(seedState);
      return seedState;
    }
    const loaded = await this.loadSnapshot();
    this.lastPersisted = cloneState(loaded);
    return loaded;
  }
  queuePersist(state) {
    if (!this.pool) return;
    const cloned = cloneState(state);
    this.syncQueue = this.syncQueue.then(async () => {
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        await this.persistDiff(conn, cloned);
        await conn.commit();
        this.lastPersisted = cloned;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }).catch((err) => {
      console.error("Gagal sinkronisasi CRUD ke MySQL:", err);
    });
  }
  async migrateSchema() {
    if (!this.pool) return;
    const columns = [
      { table: "users", column: "active", ddl: "TINYINT(1) NOT NULL DEFAULT 1" },
      { table: "instansis", column: "npwp", ddl: "VARCHAR(40) NULL" },
      { table: "instansis", column: "is_pkp", ddl: "TINYINT(1) NOT NULL DEFAULT 0" },
      { table: "instansis", column: "ppn_persen", ddl: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
      { table: "instansis", column: "pph23_persen", ddl: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
      { table: "instansis", column: "tempo_hari", ddl: "INT NOT NULL DEFAULT 0" },
      { table: "instansis", column: "credit_limit", ddl: "DECIMAL(14,2) NOT NULL DEFAULT 0" },
      { table: "instansis", column: "pajak_reklame_expired", ddl: "VARCHAR(40) NULL" },
      { table: "orders", column: "status_nota", ddl: "ENUM('aktif','batal') NOT NULL DEFAULT 'aktif'" },
      { table: "orders", column: "alasan_batal", ddl: "TEXT NULL" },
      { table: "orders", column: "diskon_persen", ddl: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
      { table: "orders", column: "diskon_nominal", ddl: "DECIMAL(12,2) NOT NULL DEFAULT 0" },
      { table: "orders", column: "ppn_persen", ddl: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
      { table: "orders", column: "ppn_nominal", ddl: "DECIMAL(12,2) NOT NULL DEFAULT 0" },
      { table: "orders", column: "pph23_persen", ddl: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
      { table: "orders", column: "pph23_nominal", ddl: "DECIMAL(12,2) NOT NULL DEFAULT 0" },
      { table: "orders", column: "tanda_tangan_pengambil", ddl: "LONGTEXT NULL" },
      { table: "orders", column: "jatuh_tempo", ddl: "VARCHAR(40) NULL" },
      { table: "orders", column: "approval_token", ddl: "VARCHAR(80) NULL" },
      {
        table: "orders",
        column: "approval_status",
        ddl: "ENUM('belum','menunggu','disetujui','revisi') NOT NULL DEFAULT 'belum'"
      },
      { table: "orders", column: "approval_note", ddl: "TEXT NULL" },
      { table: "products", column: "mesin_default_id", ddl: "INT NULL" },
      {
        table: "products",
        column: "satuan_hitung",
        ddl: "ENUM('pcs','klik') NOT NULL DEFAULT 'pcs'"
      },
      { table: "products", column: "klik_per_lembar", ddl: "INT NOT NULL DEFAULT 1" },
      { table: "products", column: "ukuran_lembar", ddl: "VARCHAR(80) NULL" },
      { table: "order_items", column: "harga_sebelum_diskon", ddl: "DECIMAL(12,2) NOT NULL DEFAULT 0" },
      { table: "order_items", column: "diskon_persen", ddl: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
      { table: "order_items", column: "diskon_nominal", ddl: "DECIMAL(12,2) NOT NULL DEFAULT 0" },
      { table: "order_items", column: "machine_id", ddl: "INT NULL" },
      { table: "order_items", column: "operator_id", ddl: "INT NULL" },
      { table: "order_items", column: "finishing_user_id", ddl: "INT NULL" },
      { table: "order_items", column: "waktu_mulai_cetak", ddl: "VARCHAR(40) NULL" },
      { table: "order_items", column: "waktu_selesai_cetak", ddl: "VARCHAR(40) NULL" },
      { table: "order_items", column: "klik_total", ddl: "INT NULL" },
      { table: "order_items", column: "estimasi_tinta_ml", ddl: "DECIMAL(10,2) NULL" },
      { table: "order_items", column: "batch_id", ddl: "INT NULL" },
      {
        table: "order_items",
        column: "satuan_hitung",
        ddl: "ENUM('pcs','klik') NOT NULL DEFAULT 'pcs'"
      },
      { table: "order_items", column: "klik_per_lembar", ddl: "INT NOT NULL DEFAULT 1" },
      { table: "order_items", column: "ukuran_lembar", ddl: "VARCHAR(80) NULL" },
      { table: "order_items", column: "ditata_at", ddl: "VARCHAR(40) NULL" },
      { table: "order_items", column: "qty_tercetak", ddl: "INT NOT NULL DEFAULT 0" },
      { table: "order_items", column: "acc_pelanggan_at", ddl: "VARCHAR(40) NULL" },
      { table: "order_items", column: "acc_pelanggan_nama", ddl: "VARCHAR(150) NULL" },
      { table: "order_items", column: "acc_pelanggan_id", ddl: "INT NULL" },
      { table: "order_items", column: "foto_finishing", ddl: "VARCHAR(255) NULL" },
      { table: "order_items", column: "foto_cetak_ulang", ddl: "VARCHAR(255) NULL" },
      { table: "order_payments", column: "shift_id", ddl: "INT NULL" },
      { table: "whatsapp_outbox", column: "media_path", ddl: "VARCHAR(255) NULL" }
    ];
    for (const item of columns) {
      const [rows] = await this.pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [item.table, item.column]
      );
      if (Number(rows[0]?.cnt ?? 0) === 0) {
        await this.pool.query(`ALTER TABLE \`${item.table}\` ADD COLUMN \`${item.column}\` ${item.ddl}`);
      }
    }
    const enumMigrations = [
      {
        table: "order_items",
        column: "status_produksi",
        ddl: "ENUM('menunggu_desain','proses_desain','menunggu_acc','revisi','antrean_cetak','siap_tata','proses_cetak','gagal_cetak','cetak_ulang','antrean_finishing','proses_finishing','siap_diambil','selesai','dibatalkan') NOT NULL DEFAULT 'menunggu_desain'",
        marker: "'cetak_ulang'"
      }
    ];
    for (const m of enumMigrations) {
      const [rows] = await this.pool.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [m.table, m.column]
      );
      const columnType = String(rows[0]?.COLUMN_TYPE ?? "");
      if (columnType && !columnType.includes(m.marker)) {
        await this.pool.query(`ALTER TABLE \`${m.table}\` MODIFY COLUMN \`${m.column}\` ${m.ddl}`);
      }
    }
    const tables = [
      {
        name: "print_machines",
        ddl: `CREATE TABLE IF NOT EXISTS \`print_machines\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          kode_mesin VARCHAR(40) NOT NULL UNIQUE,
          nama_mesin VARCHAR(120) NOT NULL UNIQUE,
          jenis ENUM('large_format','uv','digital_a3p','cutting') NOT NULL,
          lebar_max_m DECIMAL(6,3) NULL,
          konsumsi_tinta_ml_per_m2 DECIMAL(8,2) NOT NULL DEFAULT 0,
          aktif TINYINT(1) NOT NULL DEFAULT 1,
          keterangan TEXT NULL,
          created_at VARCHAR(40) NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`
      },
      {
        name: "supplies",
        ddl: `CREATE TABLE IF NOT EXISTS \`supplies\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          kode VARCHAR(50) NOT NULL UNIQUE,
          nama VARCHAR(150) NOT NULL,
          kategori ENUM('tinta','bahan_pembantu','suku_cadang') NOT NULL,
          satuan VARCHAR(20) NOT NULL DEFAULT 'pcs',
          stok DECIMAL(12,2) NOT NULL DEFAULT 0,
          stok_minimum DECIMAL(12,2) NOT NULL DEFAULT 0,
          harga_satuan DECIMAL(12,2) NOT NULL DEFAULT 0,
          konsumsi_per_m2 DECIMAL(8,2) NULL,
          aktif TINYINT(1) NOT NULL DEFAULT 1,
          created_at VARCHAR(40) NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`
      },
      {
        name: "supply_usages",
        ddl: `CREATE TABLE IF NOT EXISTS \`supply_usages\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          supply_id INT NOT NULL,
          order_item_id INT NULL,
          jumlah DECIMAL(12,2) NOT NULL,
          satuan VARCHAR(20) NOT NULL,
          keterangan TEXT NULL,
          user_id INT NOT NULL,
          created_at VARCHAR(40) NOT NULL,
          FOREIGN KEY (supply_id) REFERENCES supplies(id) ON DELETE CASCADE,
          FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`
      },
      {
        name: "print_batches",
        ddl: `CREATE TABLE IF NOT EXISTS \`print_batches\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          kode_batch VARCHAR(40) NOT NULL UNIQUE,
          machine_id INT NOT NULL,
          operator_id INT NOT NULL,
          item_ids JSON NOT NULL,
          lebar_gabungan_m DECIMAL(8,2) NOT NULL,
          panjang_tarik_m DECIMAL(8,2) NOT NULL,
          luas_terpakai_m2 DECIMAL(10,2) NOT NULL,
          luas_waste_m2 DECIMAL(10,2) NOT NULL,
          status ENUM('dihitung','diproses') NOT NULL DEFAULT 'dihitung',
          catatan TEXT NULL,
          created_at VARCHAR(40) NOT NULL,
          FOREIGN KEY (machine_id) REFERENCES print_machines(id),
          FOREIGN KEY (operator_id) REFERENCES users(id)
        )`
      },
      {
        name: "insentif_rates",
        ddl: `CREATE TABLE IF NOT EXISTS \`insentif_rates\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          role VARCHAR(30) NOT NULL,
          jenis VARCHAR(20) NOT NULL,
          nominal DECIMAL(14,2) NOT NULL DEFAULT 0,
          updated_at VARCHAR(40) NULL,
          updated_by INT NULL,
          UNIQUE KEY uq_insentif_role_jenis (role, jenis)
        )`
      },
      {
        name: "whatsapp_gateway_config",
        ddl: `CREATE TABLE IF NOT EXISTS \`whatsapp_gateway_config\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          webhook_url VARCHAR(500) NOT NULL DEFAULT '',
          webhook_token VARCHAR(500) NOT NULL DEFAULT '',
          app_url VARCHAR(500) NOT NULL DEFAULT '',
          aktif TINYINT(1) NOT NULL DEFAULT 0,
          updated_at VARCHAR(40) NULL,
          updated_by INT NULL
        )`
      },
      {
        name: "tax_settings",
        ddl: `CREATE TABLE IF NOT EXISTS \`tax_settings\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ppn_persen_default DECIMAL(5,2) NOT NULL DEFAULT 11,
          pph23_persen_default DECIMAL(5,2) NOT NULL DEFAULT 2,
          mode_harga ENUM('belum_termasuk_ppn','sudah_termasuk_ppn') NOT NULL DEFAULT 'belum_termasuk_ppn',
          ppn_termasuk_diskon TINYINT(1) NOT NULL DEFAULT 1,
          potong_pph23_otomatis TINYINT(1) NOT NULL DEFAULT 0,
          updated_at VARCHAR(40) NULL,
          updated_by INT NULL
        )`
      },
      {
        name: "stok_cattoff",
        ddl: `CREATE TABLE IF NOT EXISTS \`stok_cattoff\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          kode VARCHAR(50) NOT NULL UNIQUE,
          jenis_bahan VARCHAR(80) NOT NULL,
          lebar_m DECIMAL(5,2) NOT NULL,
          panjang_awal_m DECIMAL(8,2) NOT NULL,
          panjang_sisa_m DECIMAL(8,2) NOT NULL,
          status ENUM('aktif','habis') NOT NULL DEFAULT 'aktif',
          created_at VARCHAR(40) NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`
      },
      {
        name: "tinta_warna",
        ddl: `CREATE TABLE IF NOT EXISTS \`tinta_warna\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          kode VARCHAR(30) NOT NULL UNIQUE,
          warna VARCHAR(50) NOT NULL,
          satuan VARCHAR(20) NOT NULL DEFAULT 'ml',
          stok_ml DECIMAL(12,2) NOT NULL DEFAULT 0,
          stok_minimum_ml DECIMAL(12,2) NOT NULL DEFAULT 1000,
          kapasitas_galon_ml DECIMAL(12,2) NOT NULL DEFAULT 5000,
          roll_per_galon INT NOT NULL DEFAULT 6,
          luas_per_roll_m2 DECIMAL(8,2) NOT NULL DEFAULT 224,
          konsumsi_ml_per_m2 DECIMAL(8,2) NOT NULL DEFAULT 3.72,
          aktif TINYINT(1) NOT NULL DEFAULT 1,
          created_at VARCHAR(40) NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`
      },
      {
        name: "cetak_grup",
        ddl: `CREATE TABLE IF NOT EXISTS \`cetak_grup\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          kode_grup VARCHAR(40) NOT NULL UNIQUE,
          operator_id INT NOT NULL,
          machine_id INT NOT NULL,
          status ENUM('menunggu','dalam_proses','selesai','batal') NOT NULL DEFAULT 'menunggu',
          tanggal VARCHAR(40) NOT NULL,
          catatan TEXT NULL,
          created_at VARCHAR(40) NOT NULL,
          updated_at VARCHAR(40) NOT NULL,
          FOREIGN KEY (operator_id) REFERENCES users(id),
          FOREIGN KEY (machine_id) REFERENCES print_machines(id)
        )`
      },
      {
        name: "cetak_grup_item",
        ddl: `CREATE TABLE IF NOT EXISTS \`cetak_grup_item\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          grup_id INT NOT NULL,
          order_item_id INT NOT NULL,
          qty_cetak INT NOT NULL,
          panjang_file_m DECIMAL(8,2) NULL,
          lebar_file_m DECIMAL(8,2) NULL,
          sumber_bahan ENUM('roll','cattoff','offcut') NOT NULL DEFAULT 'roll',
          roll_id INT NULL,
          cattoff_id INT NULL,
          offcut_id INT NULL,
          offcut_lebar_m DECIMAL(5,2) NULL,
          offcut_panjang_m DECIMAL(8,2) NULL,
          masuk_wos_m2 DECIMAL(10,2) NOT NULL DEFAULT 0,
          status ENUM('menunggu','selesai','kendala') NOT NULL DEFAULT 'menunggu',
          catatan TEXT NULL,
          updated_at VARCHAR(40) NOT NULL,
          FOREIGN KEY (grup_id) REFERENCES cetak_grup(id) ON DELETE CASCADE,
          FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
        )`
      },
      {
        name: "pemakaian_tinta",
        ddl: `CREATE TABLE IF NOT EXISTS \`pemakaian_tinta\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_item_id INT NOT NULL,
          grup_id INT NULL,
          tinta_warna_id INT NOT NULL,
          warna VARCHAR(50) NOT NULL,
          jumlah_ml DECIMAL(10,2) NOT NULL,
          luas_cetak_m2 DECIMAL(10,2) NOT NULL,
          created_at VARCHAR(40) NOT NULL,
          FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
          FOREIGN KEY (tinta_warna_id) REFERENCES tinta_warna(id)
        )`
      }
    ];
    for (const table of tables) {
      await this.pool.query(table.ddl);
    }
    const indexes = [
      { table: "orders", name: "idx_orders_created_status", columns: "created_at, status_bayar" },
      { table: "orders", name: "idx_orders_status_nota", columns: "status_nota" },
      { table: "order_items", name: "idx_order_items_status_order", columns: "status_produksi, order_id" },
      { table: "order_payments", name: "idx_order_payments_order_date", columns: "order_id, tanggal" },
      { table: "order_payments", name: "idx_order_payments_shift", columns: "shift_id" },
      { table: "material_logs", name: "idx_material_logs_created", columns: "created_at" },
      { table: "design_revisions", name: "idx_design_revisions_order", columns: "order_id" },
      { table: "audit_logs", name: "idx_audit_logs_created", columns: "created_at" },
      { table: "order_items", name: "idx_order_items_machine", columns: "machine_id, status_produksi" },
      { table: "order_items", name: "idx_order_items_operator", columns: "operator_id" },
      { table: "supply_usages", name: "idx_supply_usages_created", columns: "created_at" },
      { table: "print_batches", name: "idx_print_batches_created", columns: "created_at" },
      { table: "purchase_orders", name: "idx_po_supplier_status", columns: "supplier_id, status, tanggal" },
      { table: "goods_receipts", name: "idx_goods_receipts_po", columns: "po_id, created_at" },
      { table: "supplier_payments", name: "idx_supplier_payments_po", columns: "purchase_order_id, tanggal" },
      { table: "whatsapp_outbox", name: "idx_wa_outbox_status", columns: "status, next_attempt_at" }
    ];
    for (const idx of indexes) {
      const [rows] = await this.pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [idx.table, idx.name]
      );
      if (Number(rows[0]?.cnt ?? 0) === 0) {
        await this.pool.query(`CREATE INDEX \`${idx.name}\` ON \`${idx.table}\` (${idx.columns})`);
      }
    }
  }
  async withTransaction(fn) {
    if (!this.pool) throw new Error("MySQL pool belum terinisialisasi.");
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
  async lockRow(conn, table, id) {
    const [rows] = await conn.query(
      `SELECT * FROM \`${table}\` WHERE id = ? FOR UPDATE`,
      [id]
    );
    return rows[0] ?? null;
  }
  /** Lock seluruh baris tabel kecil (roll, tinta, produk) selama transaksi. */
  async lockTable(conn, table) {
    await conn.query(`SELECT id FROM \`${table}\` FOR UPDATE`);
  }
  /**
   * Jalankan mutasi kritis di dalam satu transaksi MySQL:
   * lock baris -> mutasi state di memori -> tulis diff CRUD -> commit.
   * Semua persist lain diantrekan lewat syncQueue yang sama agar tidak ada
   * snapshot lama yang menimpa hasil transaksi.
   */
  async runLocked(getState, lockTables, fn) {
    if (!this.pool) return fn();
    const task = this.syncQueue.then(async () => {
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const table of lockTables) {
          await this.lockTable(conn, table);
        }
        const result = await fn();
        const state = getState();
        await this.persistDiff(conn, state);
        this.lastPersisted = cloneState(state);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    });
    this.syncQueue = task.then(
      () => void 0,
      () => void 0
    );
    return task;
  }
  async loadTableColumns() {
    if (!this.pool || this.tableColumnsLoaded) return;
    for (const table of SYNC_TABLES) {
      const [rows] = await this.pool.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [table]
      );
      this.tableColumns.set(
        table,
        rows.map((row) => String(row.name))
      );
    }
    this.tableColumnsLoaded = true;
  }
  valueForColumn(row, column) {
    if (column === "items_json") {
      return JSON.stringify(row.items ?? []);
    }
    if (column === "item_ids") {
      return JSON.stringify(row.item_ids ?? []);
    }
    const value = row[column];
    if (value === void 0 || value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "object") return JSON.stringify(value);
    return value;
  }
  rowHasColumn(row, column) {
    if (column === "items_json") return true;
    if (column === "item_ids") return true;
    return Object.prototype.hasOwnProperty.call(row, column);
  }
  rowChanged(old, next, columns) {
    for (const column of columns) {
      if (column === "id") continue;
      if (!this.rowHasColumn(next, column)) continue;
      if (JSON.stringify(this.valueForColumn(old, column)) !== JSON.stringify(this.valueForColumn(next, column))) {
        return true;
      }
    }
    return false;
  }
  /**
   * Ganti writeSnapshot() DELETE + INSERT seluruh tabel dengan CRUD per baris.
   * Hanya baris baru / berubah / terhapus yang disentuh.
   */
  async persistDiff(conn, state) {
    await this.loadTableColumns();
    const previous = this.lastPersisted;
    const rowsFor = (table) => {
      if (table === "whatsapp_gateway_config") {
        return state.whatsapp_gateway_config ? [state.whatsapp_gateway_config] : [];
      }
      if (table === "tax_settings") {
        return state.tax_settings ? [state.tax_settings] : [];
      }
      if (table === "print_machines") {
        return state.machines;
      }
      return state[table] ?? [];
    };
    const previousRowsFor = (table) => {
      if (!previous) return [];
      if (table === "whatsapp_gateway_config") {
        return previous.whatsapp_gateway_config ? [previous.whatsapp_gateway_config] : [];
      }
      if (table === "tax_settings") {
        return previous.tax_settings ? [previous.tax_settings] : [];
      }
      if (table === "print_machines") {
        return previous.machines;
      }
      return previous[table] ?? [];
    };
    for (const table of SYNC_TABLES) {
      const columns = this.tableColumns.get(table) ?? [];
      if (columns.length === 0) continue;
      const oldRows = previousRowsFor(table);
      const newRows = rowsFor(table);
      const oldById = new Map(oldRows.map((row) => [Number(row.id), row]));
      for (const row of newRows) {
        const id = Number(row.id);
        const old = oldById.get(id);
        if (!old) {
          const insertColumns = columns.filter((column) => this.rowHasColumn(row, column));
          const placeholders = insertColumns.map(() => "?").join(", ");
          await conn.query(
            `INSERT INTO \`${table}\` (${insertColumns.map((c) => `\`${c}\``).join(", ")}) VALUES (${placeholders})`,
            insertColumns.map((column) => this.valueForColumn(row, column))
          );
        } else if (this.rowChanged(old, row, columns)) {
          const updateColumns = columns.filter(
            (column) => column !== "id" && this.rowHasColumn(row, column)
          );
          if (updateColumns.length === 0) continue;
          await conn.query(
            `UPDATE \`${table}\` SET ${updateColumns.map((c) => `\`${c}\` = ?`).join(", ")} WHERE id = ?`,
            [...updateColumns.map((column) => this.valueForColumn(row, column)), id]
          );
        }
      }
    }
    for (const table of [...SYNC_TABLES].reverse()) {
      const oldRows = previousRowsFor(table);
      const newRows = rowsFor(table);
      const newIds = new Set(newRows.map((row) => Number(row.id)));
      for (const old of oldRows) {
        const id = Number(old.id);
        if (!newIds.has(id)) {
          await conn.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
        }
      }
    }
  }
  async loadSnapshot() {
    if (!this.pool) throw new Error("MySQL pool belum terinisialisasi.");
    const [users] = await this.pool.query("SELECT id, name, email, role, password, active FROM users ORDER BY id");
    const [instansis] = await this.pool.query("SELECT * FROM instansis ORDER BY id");
    const [customers] = await this.pool.query("SELECT * FROM customers ORDER BY id");
    const [products] = await this.pool.query("SELECT * FROM products ORDER BY id");
    const [finishings] = await this.pool.query("SELECT * FROM finishings ORDER BY id");
    const [material_rolls] = await this.pool.query("SELECT * FROM material_rolls ORDER BY id");
    const [material_offcuts] = await this.pool.query("SELECT * FROM material_offcuts ORDER BY id");
    const [machines] = await this.pool.query("SELECT * FROM print_machines ORDER BY id");
    const [supplies] = await this.pool.query("SELECT * FROM supplies ORDER BY id");
    const [supply_usages] = await this.pool.query("SELECT * FROM supply_usages ORDER BY id");
    const [print_batches] = await this.pool.query("SELECT * FROM print_batches ORDER BY id");
    const [stok_cattoff] = await this.pool.query("SELECT * FROM stok_cattoff ORDER BY id");
    const [tinta_warna] = await this.pool.query("SELECT * FROM tinta_warna ORDER BY id");
    const [cetak_grup] = await this.pool.query("SELECT * FROM cetak_grup ORDER BY id");
    const [cetak_grup_item] = await this.pool.query("SELECT * FROM cetak_grup_item ORDER BY id");
    const [pemakaian_tinta] = await this.pool.query("SELECT * FROM pemakaian_tinta ORDER BY id");
    const [orders] = await this.pool.query("SELECT * FROM orders ORDER BY id");
    const [order_items] = await this.pool.query("SELECT * FROM order_items ORDER BY id");
    const [order_payments] = await this.pool.query("SELECT * FROM order_payments ORDER BY id");
    const [design_revisions] = await this.pool.query("SELECT * FROM design_revisions ORDER BY id");
    const [advertising_spks] = await this.pool.query("SELECT * FROM advertising_spks ORDER BY id");
    const [material_logs] = await this.pool.query("SELECT * FROM material_logs ORDER BY id");
    const [operational_expenses] = await this.pool.query("SELECT * FROM operational_expenses ORDER BY id");
    const [shifts] = await this.pool.query("SELECT * FROM shifts ORDER BY id");
    const [audit_logs] = await this.pool.query("SELECT * FROM audit_logs ORDER BY id");
    const [suppliers] = await this.pool.query("SELECT * FROM suppliers ORDER BY id");
    const [purchase_orders] = await this.pool.query("SELECT * FROM purchase_orders ORDER BY id");
    const [goods_receipts] = await this.pool.query("SELECT * FROM goods_receipts ORDER BY id");
    const [supplier_payments] = await this.pool.query("SELECT * FROM supplier_payments ORDER BY id");
    const [whatsapp_outbox] = await this.pool.query("SELECT * FROM whatsapp_outbox ORDER BY id");
    const [whatsapp_gateway_config] = await this.pool.query("SELECT * FROM whatsapp_gateway_config ORDER BY id LIMIT 1");
    const [tax_settings] = await this.pool.query("SELECT * FROM tax_settings ORDER BY id LIMIT 1");
    const [insentif_rates] = await this.pool.query("SELECT * FROM insentif_rates ORDER BY id");
    const maxId = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const num = (v) => v === null || v === void 0 ? null : Number(v);
    return {
      users: users.map((u) => ({ ...u, active: Number(u.active ?? 1) === 1 })),
      instansis: instansis.map((i) => ({
        ...i,
        is_pkp: Number(i.is_pkp ?? 0) === 1,
        ppn_persen: Number(i.ppn_persen ?? 0),
        pph23_persen: Number(i.pph23_persen ?? 0),
        tempo_hari: Number(i.tempo_hari ?? 0),
        credit_limit: Number(i.credit_limit ?? 0)
      })),
      customers,
      products: products.map((p) => ({
        ...p,
        harga_umum: Number(p.harga_umum),
        harga_reseller: Number(p.harga_reseller),
        harga_prioritas: Number(p.harga_prioritas),
        harga_pegawai: Number(p.harga_pegawai),
        harga_modal: Number(p.harga_modal),
        stok_pcs: num(p.stok_pcs),
        mesin_default_id: num(p.mesin_default_id),
        satuan_hitung: p.satuan_hitung ?? "pcs",
        klik_per_lembar: Number(p.klik_per_lembar ?? 1),
        ukuran_lembar: p.ukuran_lembar ?? null
      })),
      finishings: finishings.map((f) => ({
        ...f,
        ekstra_kiri_cm: Number(f.ekstra_kiri_cm),
        ekstra_kanan_cm: Number(f.ekstra_kanan_cm),
        ekstra_atas_cm: Number(f.ekstra_atas_cm),
        ekstra_bawah_cm: Number(f.ekstra_bawah_cm)
      })),
      material_rolls: material_rolls.map((r) => ({
        ...r,
        lebar_m: Number(r.lebar_m),
        panjang_awal_m: Number(r.panjang_awal_m),
        panjang_sisa_m: Number(r.panjang_sisa_m)
      })),
      material_offcuts: material_offcuts.map((o) => ({
        ...o,
        lebar_m: Number(o.lebar_m),
        panjang_m: Number(o.panjang_m),
        luas_m2: Number(o.luas_m2)
      })),
      machines: machines.map((m) => ({
        ...m,
        lebar_max_m: num(m.lebar_max_m),
        konsumsi_tinta_ml_per_m2: Number(m.konsumsi_tinta_ml_per_m2 ?? 0),
        aktif: Number(m.aktif ?? 1) === 1
      })),
      supplies: supplies.map((s) => ({
        ...s,
        stok: Number(s.stok ?? 0),
        stok_minimum: Number(s.stok_minimum ?? 0),
        harga_satuan: Number(s.harga_satuan ?? 0),
        konsumsi_per_m2: num(s.konsumsi_per_m2),
        aktif: Number(s.aktif ?? 1) === 1
      })),
      supply_usages: supply_usages.map((u) => ({
        ...u,
        jumlah: Number(u.jumlah ?? 0)
      })),
      print_batches: print_batches.map((b) => ({
        ...b,
        item_ids: Array.isArray(b.item_ids) ? b.item_ids.map(Number) : (() => {
          try {
            return JSON.parse(String(b.item_ids ?? "[]")).map(Number);
          } catch {
            return [];
          }
        })(),
        lebar_gabungan_m: Number(b.lebar_gabungan_m ?? 0),
        panjang_tarik_m: Number(b.panjang_tarik_m ?? 0),
        luas_terpakai_m2: Number(b.luas_terpakai_m2 ?? 0),
        luas_waste_m2: Number(b.luas_waste_m2 ?? 0)
      })),
      stok_cattoff: stok_cattoff.map((s) => ({
        ...s,
        lebar_m: Number(s.lebar_m),
        panjang_awal_m: Number(s.panjang_awal_m),
        panjang_sisa_m: Number(s.panjang_sisa_m)
      })),
      tinta_warna: tinta_warna.map((w) => ({
        ...w,
        stok_ml: Number(w.stok_ml ?? 0),
        stok_minimum_ml: Number(w.stok_minimum_ml ?? 0),
        kapasitas_galon_ml: Number(w.kapasitas_galon_ml ?? 5e3),
        roll_per_galon: Number(w.roll_per_galon ?? 6),
        luas_per_roll_m2: Number(w.luas_per_roll_m2 ?? 224),
        konsumsi_ml_per_m2: Number(w.konsumsi_ml_per_m2 ?? 3.72),
        aktif: Number(w.aktif ?? 1) === 1
      })),
      cetak_grup: cetak_grup.map((g) => ({
        ...g,
        operator_id: Number(g.operator_id),
        machine_id: Number(g.machine_id)
      })),
      cetak_grup_item: cetak_grup_item.map((item) => ({
        ...item,
        grup_id: Number(item.grup_id),
        order_item_id: Number(item.order_item_id),
        qty_cetak: Number(item.qty_cetak),
        panjang_file_m: num(item.panjang_file_m),
        lebar_file_m: num(item.lebar_file_m),
        roll_id: num(item.roll_id),
        cattoff_id: num(item.cattoff_id),
        offcut_id: num(item.offcut_id),
        offcut_lebar_m: num(item.offcut_lebar_m),
        offcut_panjang_m: num(item.offcut_panjang_m),
        masuk_wos_m2: Number(item.masuk_wos_m2 ?? 0)
      })),
      pemakaian_tinta: pemakaian_tinta.map((p) => ({
        ...p,
        order_item_id: Number(p.order_item_id),
        grup_id: num(p.grup_id),
        tinta_warna_id: Number(p.tinta_warna_id),
        jumlah_ml: Number(p.jumlah_ml),
        luas_cetak_m2: Number(p.luas_cetak_m2)
      })),
      orders: orders.map((o) => ({
        ...o,
        total_tagihan: Number(o.total_tagihan),
        jumlah_dp: Number(o.jumlah_dp),
        diskon_persen: Number(o.diskon_persen ?? 0),
        diskon_nominal: Number(o.diskon_nominal ?? 0),
        ppn_persen: Number(o.ppn_persen ?? 0),
        ppn_nominal: Number(o.ppn_nominal ?? 0),
        pph23_persen: Number(o.pph23_persen ?? 0),
        pph23_nominal: Number(o.pph23_nominal ?? 0)
      })),
      order_items: order_items.map((i) => ({
        ...i,
        lebar_m: num(i.lebar_m),
        tinggi_m: num(i.tinggi_m),
        luas_tagihan_m2: num(i.luas_tagihan_m2),
        harga_satuan_dipakai: Number(i.harga_satuan_dipakai),
        harga_sebelum_diskon: Number(i.harga_sebelum_diskon ?? i.subtotal),
        diskon_persen: Number(i.diskon_persen ?? 0),
        diskon_nominal: Number(i.diskon_nominal ?? 0),
        subtotal: Number(i.subtotal),
        machine_id: num(i.machine_id),
        operator_id: num(i.operator_id),
        finishing_user_id: num(i.finishing_user_id),
        waktu_mulai_cetak: i.waktu_mulai_cetak ?? null,
        waktu_selesai_cetak: i.waktu_selesai_cetak ?? null,
        klik_total: num(i.klik_total),
        estimasi_tinta_ml: num(i.estimasi_tinta_ml),
        batch_id: num(i.batch_id),
        satuan_hitung: i.satuan_hitung ?? "pcs",
        klik_per_lembar: Number(i.klik_per_lembar ?? 1),
        ukuran_lembar: i.ukuran_lembar ?? null,
        ditata_at: i.ditata_at ?? null,
        qty_tercetak: Number(i.qty_tercetak ?? 0),
        acc_pelanggan_id: num(i.acc_pelanggan_id),
        foto_finishing: i.foto_finishing ?? null,
        foto_cetak_ulang: i.foto_cetak_ulang ?? null
      })),
      order_payments: order_payments.map((p) => ({
        ...p,
        nominal: Number(p.nominal),
        shift_id: p.shift_id === null || p.shift_id === void 0 ? null : Number(p.shift_id)
      })),
      design_revisions,
      advertising_spks,
      material_logs: material_logs.map((l) => ({
        ...l,
        luas_netto_m2: Number(l.luas_netto_m2),
        wos_finishing_m2: Number(l.wos_finishing_m2),
        wos_potong_m2: Number(l.wos_potong_m2),
        gagal_cetak_m2: Number(l.gagal_cetak_m2)
      })),
      operational_expenses: operational_expenses.map((e) => ({
        ...e,
        tanggal: e.tanggal instanceof Date ? e.tanggal.toISOString().slice(0, 10) : String(e.tanggal).slice(0, 10),
        nominal: Number(e.nominal)
      })),
      shifts: shifts.map((s) => ({
        ...s,
        opening_cash: Number(s.opening_cash),
        expected_tunai: Number(s.expected_tunai),
        expected_transfer: Number(s.expected_transfer),
        expected_qris: Number(s.expected_qris),
        actual_tunai: Number(s.actual_tunai),
        actual_transfer: Number(s.actual_transfer),
        actual_qris: Number(s.actual_qris),
        selisih: Number(s.selisih)
      })),
      audit_logs,
      suppliers: suppliers.map((s) => ({
        ...s,
        aktif: Number(s.aktif ?? 1) === 1
      })),
      purchase_orders: purchase_orders.map((p) => ({
        ...p,
        items: (() => {
          try {
            const parsed = JSON.parse(String(p.items_json ?? "[]"));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        total: Number(p.total ?? 0),
        sudah_dibayar: Number(p.sudah_dibayar ?? 0),
        hutang: Number(p.hutang ?? 0)
      })),
      goods_receipts,
      supplier_payments: supplier_payments.map((p) => ({
        ...p,
        nominal: Number(p.nominal ?? 0)
      })),
      whatsapp_outbox: whatsapp_outbox.map((w) => ({
        ...w,
        attempts: Number(w.attempts ?? 0)
      })),
      whatsapp_gateway_config: whatsapp_gateway_config[0] ? {
        ...whatsapp_gateway_config[0],
        id: Number(whatsapp_gateway_config[0].id) || 1,
        webhook_url: String(whatsapp_gateway_config[0].webhook_url ?? ""),
        webhook_token: String(whatsapp_gateway_config[0].webhook_token ?? ""),
        app_url: String(whatsapp_gateway_config[0].app_url ?? ""),
        aktif: Number(whatsapp_gateway_config[0].aktif ?? 0) === 1,
        updated_at: whatsapp_gateway_config[0].updated_at ?? null,
        updated_by: num(whatsapp_gateway_config[0].updated_by)
      } : null,
      tax_settings: tax_settings[0] ? {
        id: Number(tax_settings[0].id) || 1,
        ppn_persen_default: Number(tax_settings[0].ppn_persen_default ?? 11),
        pph23_persen_default: Number(tax_settings[0].pph23_persen_default ?? 2),
        mode_harga: tax_settings[0].mode_harga === "sudah_termasuk_ppn" ? "sudah_termasuk_ppn" : "belum_termasuk_ppn",
        ppn_termasuk_diskon: Number(tax_settings[0].ppn_termasuk_diskon ?? 1) === 1,
        potong_pph23_otomatis: Number(tax_settings[0].potong_pph23_otomatis ?? 0) === 1,
        updated_at: tax_settings[0].updated_at ?? null,
        updated_by: num(tax_settings[0].updated_by)
      } : null,
      insentif_rates: insentif_rates.map((r) => ({
        ...r,
        nominal: Number(r.nominal ?? 0),
        updated_at: r.updated_at ?? null,
        updated_by: num(r.updated_by)
      })),
      counters: {
        instansis: maxId(instansis),
        customers: maxId(customers),
        products: maxId(products),
        finishings: maxId(finishings),
        material_rolls: maxId(material_rolls),
        material_offcuts: maxId(material_offcuts),
        machines: maxId(machines),
        supplies: maxId(supplies),
        supply_usages: maxId(supply_usages),
        print_batches: maxId(print_batches),
        stok_cattoff: maxId(stok_cattoff),
        tinta_warna: maxId(tinta_warna),
        cetak_grup: maxId(cetak_grup),
        cetak_grup_item: maxId(cetak_grup_item),
        pemakaian_tinta: maxId(pemakaian_tinta),
        orders: maxId(orders),
        order_items: maxId(order_items),
        order_payments: maxId(order_payments),
        design_revisions: maxId(design_revisions),
        advertising_spks: maxId(advertising_spks),
        material_logs: maxId(material_logs),
        operational_expenses: maxId(operational_expenses),
        shifts: maxId(shifts),
        suppliers: maxId(suppliers),
        purchase_orders: maxId(purchase_orders),
        goods_receipts: maxId(goods_receipts),
        supplier_payments: maxId(supplier_payments),
        whatsapp_outbox: maxId(whatsapp_outbox),
        audit_logs: maxId(audit_logs),
        insentif_rates: maxId(insentif_rates)
      }
    };
  }
  async writeSnapshot(state) {
    if (!this.pool) return;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      const tables = [
        "pemakaian_tinta",
        "cetak_grup_item",
        "cetak_grup",
        "print_batches",
        "supply_usages",
        "tinta_warna",
        "stok_cattoff",
        "whatsapp_outbox",
        "whatsapp_gateway_config",
        "tax_settings",
        "insentif_rates",
        "supplier_payments",
        "goods_receipts",
        "purchase_orders",
        "suppliers",
        "audit_logs",
        "shifts",
        "operational_expenses",
        "material_logs",
        "advertising_spks",
        "design_revisions",
        "order_payments",
        "order_items",
        "orders",
        "print_machines",
        "supplies",
        "material_offcuts",
        "material_rolls",
        "finishings",
        "products",
        "customers",
        "instansis",
        "users"
      ];
      for (const t of tables) {
        await conn.query(`DELETE FROM ${t}`);
      }
      for (const u of state.users) {
        await conn.query(
          "INSERT INTO users (id, name, email, role, password, active) VALUES (?, ?, ?, ?, ?, ?)",
          [u.id, u.name, u.email, u.role, u.password, u.active === false ? 0 : 1]
        );
      }
      for (const i of state.instansis) {
        await conn.query(
          `INSERT INTO instansis (id, nama_instansi, npwp, is_pkp, ppn_persen, pph23_persen, tempo_hari, credit_limit, pajak_reklame_expired)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            i.id,
            i.nama_instansi,
            i.npwp ?? null,
            i.is_pkp ? 1 : 0,
            i.ppn_persen ?? 0,
            i.pph23_persen ?? 0,
            i.tempo_hari ?? 0,
            i.credit_limit ?? 0,
            i.pajak_reklame_expired ?? null
          ]
        );
      }
      for (const c of state.customers) {
        await conn.query(
          "INSERT INTO customers (id, instansi_id, instansi, nama_pelanggan, no_wa, kategori, alamat) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [c.id, c.instansi_id, c.instansi, c.nama_pelanggan, c.no_wa, c.kategori, c.alamat]
        );
      }
      for (const p of state.products) {
        await conn.query(
          `INSERT INTO products (id, nama_produk, kategori_produk, harga_umum, harga_reseller, harga_prioritas, harga_pegawai, harga_modal, stok_pcs,
             mesin_default_id, satuan_hitung, klik_per_lembar, ukuran_lembar)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.nama_produk,
            p.kategori_produk,
            p.harga_umum,
            p.harga_reseller,
            p.harga_prioritas,
            p.harga_pegawai,
            p.harga_modal,
            p.stok_pcs,
            p.mesin_default_id ?? null,
            p.satuan_hitung ?? "pcs",
            p.klik_per_lembar ?? 1,
            p.ukuran_lembar ?? null
          ]
        );
      }
      for (const m of state.machines) {
        await conn.query(
          `INSERT INTO print_machines (id, kode_mesin, nama_mesin, jenis, lebar_max_m, konsumsi_tinta_ml_per_m2, aktif, keterangan, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            m.kode_mesin,
            m.nama_mesin,
            m.jenis,
            m.lebar_max_m ?? null,
            m.konsumsi_tinta_ml_per_m2 ?? 0,
            m.aktif ? 1 : 0,
            m.keterangan ?? null,
            m.created_at,
            m.updated_at
          ]
        );
      }
      for (const s of state.supplies) {
        await conn.query(
          `INSERT INTO supplies (id, kode, nama, kategori, satuan, stok, stok_minimum, harga_satuan, konsumsi_per_m2, aktif, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id,
            s.kode,
            s.nama,
            s.kategori,
            s.satuan,
            s.stok,
            s.stok_minimum,
            s.harga_satuan,
            s.konsumsi_per_m2 ?? null,
            s.aktif ? 1 : 0,
            s.created_at,
            s.updated_at
          ]
        );
      }
      for (const c of state.stok_cattoff) {
        await conn.query(
          `INSERT INTO stok_cattoff (id, kode, jenis_bahan, lebar_m, panjang_awal_m, panjang_sisa_m, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id,
            c.kode,
            c.jenis_bahan,
            c.lebar_m,
            c.panjang_awal_m,
            c.panjang_sisa_m,
            c.status,
            c.created_at,
            c.updated_at
          ]
        );
      }
      for (const w of state.tinta_warna) {
        await conn.query(
          `INSERT INTO tinta_warna (id, kode, warna, satuan, stok_ml, stok_minimum_ml, kapasitas_galon_ml,
             roll_per_galon, luas_per_roll_m2, konsumsi_ml_per_m2, aktif, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            w.id,
            w.kode,
            w.warna,
            w.satuan,
            w.stok_ml,
            w.stok_minimum_ml,
            w.kapasitas_galon_ml,
            w.roll_per_galon,
            w.luas_per_roll_m2,
            w.konsumsi_ml_per_m2,
            w.aktif ? 1 : 0,
            w.created_at,
            w.updated_at
          ]
        );
      }
      for (const f of state.finishings) {
        await conn.query(
          "INSERT INTO finishings (id, nama_finishing, ekstra_kiri_cm, ekstra_kanan_cm, ekstra_atas_cm, ekstra_bawah_cm) VALUES (?, ?, ?, ?, ?, ?)",
          [f.id, f.nama_finishing, f.ekstra_kiri_cm, f.ekstra_kanan_cm, f.ekstra_atas_cm, f.ekstra_bawah_cm]
        );
      }
      for (const r of state.material_rolls) {
        await conn.query(
          "INSERT INTO material_rolls (id, kode_roll, jenis_bahan, lebar_m, panjang_awal_m, panjang_sisa_m, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [r.id, r.kode_roll, r.jenis_bahan, r.lebar_m, r.panjang_awal_m, r.panjang_sisa_m, r.status]
        );
      }
      for (const o of state.material_offcuts) {
        await conn.query(
          "INSERT INTO material_offcuts (id, material_roll_id, kode_roll, jenis_bahan, lebar_m, panjang_m, luas_m2, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [o.id, o.material_roll_id, o.kode_roll ?? null, o.jenis_bahan, o.lebar_m, o.panjang_m, o.luas_m2, o.status, o.created_at]
        );
      }
      for (const o of state.orders) {
        await conn.query(
          `INSERT INTO orders (id, no_nota, customer_id, user_id, designer_id, total_tagihan, jumlah_dp, status_bayar,
             status_nota, alasan_batal, diskon_persen, diskon_nominal, ppn_persen, ppn_nominal, pph23_persen, pph23_nominal,
             jatuh_tempo, approval_token, approval_status, approval_note,
             status_desain, catatan_desain, lampiran_briefing, file_master_arsip, waktu_terima_desain, waktu_selesai_desain,
             tanda_tangan_desainer, tanda_tangan_admin, bukti_pelunasan, foto_serah_terima, tanda_tangan_pengambil, nama_pengambil, no_wa_pengambil,
             waktu_serah_terima, catatan_pengecualian, deadline, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            o.id,
            o.no_nota,
            o.customer_id,
            o.user_id,
            o.designer_id,
            o.total_tagihan,
            o.jumlah_dp,
            o.status_bayar,
            o.status_nota ?? "aktif",
            o.alasan_batal ?? null,
            o.diskon_persen ?? 0,
            o.diskon_nominal ?? 0,
            o.ppn_persen ?? 0,
            o.ppn_nominal ?? 0,
            o.pph23_persen ?? 0,
            o.pph23_nominal ?? 0,
            o.jatuh_tempo ?? null,
            o.approval_token ?? null,
            o.approval_status ?? "belum",
            o.approval_note ?? null,
            o.status_desain,
            o.catatan_desain,
            o.lampiran_briefing,
            o.file_master_arsip,
            o.waktu_terima_desain,
            o.waktu_selesai_desain,
            o.tanda_tangan_desainer,
            o.tanda_tangan_admin,
            o.bukti_pelunasan,
            o.foto_serah_terima,
            o.tanda_tangan_pengambil ?? null,
            o.nama_pengambil,
            o.no_wa_pengambil,
            o.waktu_serah_terima,
            o.catatan_pengecualian,
            o.deadline,
            o.created_at,
            o.updated_at
          ]
        );
      }
      for (const it of state.order_items) {
        await conn.query(
          `INSERT INTO order_items (id, order_id, nama_item, product_id, finishing_id, lebar_m, tinggi_m, qty, luas_tagihan_m2,
             harga_satuan_dipakai, harga_sebelum_diskon, diskon_persen, diskon_nominal, subtotal, status_produksi,
             machine_id, operator_id, finishing_user_id, waktu_mulai_cetak, waktu_selesai_cetak, klik_total, estimasi_tinta_ml, batch_id,
             satuan_hitung, klik_per_lembar, ukuran_lembar, ditata_at, qty_tercetak,
              acc_admin_id, waktu_acc, acc_pelanggan_id, acc_pelanggan_at, acc_pelanggan_nama,
              file_preview_acc, file_cetak_tiff, file_master_arsip, foto_finishing, foto_cetak_ulang,
              created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            it.id,
            it.order_id,
            it.nama_item,
            it.product_id,
            it.finishing_id,
            it.lebar_m,
            it.tinggi_m,
            it.qty,
            it.luas_tagihan_m2,
            it.harga_satuan_dipakai,
            it.harga_sebelum_diskon ?? it.subtotal,
            it.diskon_persen ?? 0,
            it.diskon_nominal ?? 0,
            it.subtotal,
            it.status_produksi,
            it.machine_id ?? null,
            it.operator_id ?? null,
            it.finishing_user_id ?? null,
            it.waktu_mulai_cetak ?? null,
            it.waktu_selesai_cetak ?? null,
            it.klik_total ?? null,
            it.estimasi_tinta_ml ?? null,
            it.batch_id ?? null,
            it.satuan_hitung ?? "pcs",
            it.klik_per_lembar ?? 1,
            it.ukuran_lembar ?? null,
            it.ditata_at ?? null,
            it.qty_tercetak ?? 0,
            it.acc_admin_id,
            it.waktu_acc,
            it.acc_pelanggan_id ?? null,
            it.acc_pelanggan_at ?? null,
            it.acc_pelanggan_nama ?? null,
            it.file_preview_acc,
            it.file_cetak_tiff,
            it.file_master_arsip,
            it.foto_finishing ?? null,
            it.foto_cetak_ulang ?? null,
            it.created_at,
            it.updated_at
          ]
        );
      }
      for (const g of state.cetak_grup) {
        await conn.query(
          `INSERT INTO cetak_grup (id, kode_grup, operator_id, machine_id, status, tanggal, catatan, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            g.id,
            g.kode_grup,
            g.operator_id,
            g.machine_id,
            g.status,
            g.tanggal,
            g.catatan ?? null,
            g.created_at,
            g.updated_at
          ]
        );
      }
      for (const gi of state.cetak_grup_item) {
        await conn.query(
          `INSERT INTO cetak_grup_item (id, grup_id, order_item_id, qty_cetak, panjang_file_m, lebar_file_m,
             sumber_bahan, roll_id, cattoff_id, offcut_id, offcut_lebar_m, offcut_panjang_m,
             masuk_wos_m2, status, catatan, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            gi.id,
            gi.grup_id,
            gi.order_item_id,
            gi.qty_cetak,
            gi.panjang_file_m ?? null,
            gi.lebar_file_m ?? null,
            gi.sumber_bahan,
            gi.roll_id ?? null,
            gi.cattoff_id ?? null,
            gi.offcut_id ?? null,
            gi.offcut_lebar_m ?? null,
            gi.offcut_panjang_m ?? null,
            gi.masuk_wos_m2 ?? 0,
            gi.status,
            gi.catatan ?? null,
            gi.updated_at
          ]
        );
      }
      for (const p of state.pemakaian_tinta) {
        await conn.query(
          `INSERT INTO pemakaian_tinta (id, order_item_id, grup_id, tinta_warna_id, warna, jumlah_ml, luas_cetak_m2, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.order_item_id,
            p.grup_id ?? null,
            p.tinta_warna_id,
            p.warna,
            p.jumlah_ml,
            p.luas_cetak_m2,
            p.created_at
          ]
        );
      }
      for (const u of state.supply_usages) {
        await conn.query(
          `INSERT INTO supply_usages (id, supply_id, order_item_id, jumlah, satuan, keterangan, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.id, u.supply_id, u.order_item_id, u.jumlah, u.satuan, u.keterangan ?? null, u.user_id, u.created_at]
        );
      }
      for (const b of state.print_batches) {
        await conn.query(
          `INSERT INTO print_batches (id, kode_batch, machine_id, operator_id, item_ids, lebar_gabungan_m, panjang_tarik_m,
             luas_terpakai_m2, luas_waste_m2, status, catatan, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            b.id,
            b.kode_batch,
            b.machine_id,
            b.operator_id,
            JSON.stringify(b.item_ids),
            b.lebar_gabungan_m,
            b.panjang_tarik_m,
            b.luas_terpakai_m2,
            b.luas_waste_m2,
            b.status,
            b.catatan ?? null,
            b.created_at
          ]
        );
      }
      for (const pay of state.order_payments) {
        await conn.query(
          "INSERT INTO order_payments (id, order_id, tanggal, nominal, metode, keterangan, bukti_bayar, admin_id, shift_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [pay.id, pay.order_id, pay.tanggal, pay.nominal, pay.metode, pay.keterangan, pay.bukti_bayar, pay.admin_id, pay.shift_id ?? null, pay.created_at]
        );
      }
      for (const rev of state.design_revisions) {
        await conn.query(
          "INSERT INTO design_revisions (id, order_id, order_item_id, revisi_ke, catatan_revisi, file_preview, admin_id, status_revisi, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [rev.id, rev.order_id, rev.order_item_id, rev.revisi_ke, rev.catatan_revisi, rev.file_preview, rev.admin_id, rev.status_revisi, rev.created_at]
        );
      }
      for (const spk of state.advertising_spks) {
        await conn.query(
          "INSERT INTO advertising_spks (id, order_id, jenis_pekerjaan, ukuran_konstruksi, lokasi_pasang, catatan_teknis, status_lapangan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [spk.id, spk.order_id, spk.jenis_pekerjaan, spk.ukuran_konstruksi, spk.lokasi_pasang, spk.catatan_teknis, spk.status_lapangan, spk.created_at, spk.updated_at]
        );
      }
      for (const log of state.material_logs) {
        await conn.query(
          "INSERT INTO material_logs (id, order_item_id, material_roll_id, material_offcut_id, luas_netto_m2, wos_finishing_m2, wos_potong_m2, gagal_cetak_m2, keterangan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [log.id, log.order_item_id, log.material_roll_id, log.material_offcut_id, log.luas_netto_m2, log.wos_finishing_m2, log.wos_potong_m2, log.gagal_cetak_m2, log.keterangan, log.created_at]
        );
      }
      for (const exp of state.operational_expenses) {
        await conn.query(
          "INSERT INTO operational_expenses (id, tanggal, kategori_biaya, keterangan, nominal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [exp.id, exp.tanggal, exp.kategori_biaya, exp.keterangan, exp.nominal, exp.created_at]
        );
      }
      for (const shift of state.shifts) {
        await conn.query(
          `INSERT INTO shifts (id, kasir_id, opened_at, closed_at, opening_cash, expected_tunai, expected_transfer, expected_qris,
             actual_tunai, actual_transfer, actual_qris, selisih, catatan, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shift.id,
            shift.kasir_id,
            shift.opened_at,
            shift.closed_at,
            shift.opening_cash,
            shift.expected_tunai,
            shift.expected_transfer,
            shift.expected_qris,
            shift.actual_tunai,
            shift.actual_transfer,
            shift.actual_qris,
            shift.selisih,
            shift.catatan,
            shift.status
          ]
        );
      }
      for (const s of state.suppliers) {
        await conn.query(
          `INSERT INTO suppliers (id, kode_supplier, nama_supplier, kontak, no_wa, alamat, npwp, aktif, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id,
            s.kode_supplier,
            s.nama_supplier,
            s.kontak ?? null,
            s.no_wa ?? null,
            s.alamat ?? null,
            s.npwp ?? null,
            s.aktif ? 1 : 0,
            s.created_at,
            s.updated_at
          ]
        );
      }
      for (const po of state.purchase_orders) {
        await conn.query(
          `INSERT INTO purchase_orders (id, no_po, supplier_id, tanggal, expected_at, status, catatan,
             items_json, total, sudah_dibayar, hutang, diterima_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            po.id,
            po.no_po,
            po.supplier_id,
            po.tanggal,
            po.expected_at ?? null,
            po.status,
            po.catatan ?? null,
            JSON.stringify(po.items ?? []),
            po.total ?? 0,
            po.sudah_dibayar ?? 0,
            po.hutang ?? 0,
            po.diterima_at ?? null,
            po.created_at,
            po.updated_at
          ]
        );
      }
      for (const gr of state.goods_receipts) {
        await conn.query(
          `INSERT INTO goods_receipts (id, po_id, no_po, tanggal, admin_id, catatan, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [gr.id, gr.po_id, gr.no_po, gr.tanggal, gr.admin_id, gr.catatan ?? null, gr.created_at]
        );
      }
      for (const sp of state.supplier_payments) {
        await conn.query(
          `INSERT INTO supplier_payments (id, supplier_id, purchase_order_id, tanggal, nominal, metode, keterangan, admin_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sp.id,
            sp.supplier_id,
            sp.purchase_order_id,
            sp.tanggal,
            sp.nominal,
            sp.metode,
            sp.keterangan ?? null,
            sp.admin_id,
            sp.created_at
          ]
        );
      }
      for (const w of state.whatsapp_outbox) {
        await conn.query(
          `INSERT INTO whatsapp_outbox (id, event, dedupe_key, order_id, no_wa, pesan, link, media_path, status,
             attempts, last_error, next_attempt_at, created_at, updated_at, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            w.id,
            w.event,
            w.dedupe_key,
            w.order_id ?? null,
            w.no_wa,
            w.pesan,
            w.link ?? null,
            w.media_path ?? null,
            w.status,
            w.attempts ?? 0,
            w.last_error ?? null,
            w.next_attempt_at ?? null,
            w.created_at,
            w.updated_at,
            w.sent_at ?? null
          ]
        );
      }
      if (state.whatsapp_gateway_config) {
        const c = state.whatsapp_gateway_config;
        await conn.query(
          `INSERT INTO whatsapp_gateway_config (id, webhook_url, webhook_token, app_url, aktif, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id || 1,
            c.webhook_url ?? "",
            c.webhook_token ?? "",
            c.app_url ?? "",
            c.aktif === false ? 0 : 1,
            c.updated_at ?? null,
            c.updated_by ?? null
          ]
        );
      }
      if (state.tax_settings) {
        const t = state.tax_settings;
        await conn.query(
          `INSERT INTO tax_settings (id, ppn_persen_default, pph23_persen_default, mode_harga, ppn_termasuk_diskon, potong_pph23_otomatis, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            t.id || 1,
            t.ppn_persen_default,
            t.pph23_persen_default,
            t.mode_harga,
            t.ppn_termasuk_diskon ? 1 : 0,
            t.potong_pph23_otomatis ? 1 : 0,
            t.updated_at ?? null,
            t.updated_by ?? null
          ]
        );
      }
      for (const rate of state.insentif_rates) {
        await conn.query(
          `INSERT INTO insentif_rates (id, role, jenis, nominal, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            rate.id,
            rate.role,
            rate.jenis,
            rate.nominal,
            rate.updated_at ?? null,
            rate.updated_by ?? null
          ]
        );
      }
      for (const log of state.audit_logs) {
        await conn.query(
          `INSERT INTO audit_logs (id, user_id, user_name, role, action, entity, entity_id, detail, ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [log.id, log.user_id, log.user_name, log.role, log.action, log.entity, log.entity_id, log.detail, log.ip, log.created_at]
        );
      }
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
};
var mysqlAdapter = new MySqlAdapter();

// server/domain.ts
function round2(val) {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}
function clampPercent(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(round2(num), 0), 100);
}
function parsePositiveId(raw) {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const num = Number(text);
  return Number.isInteger(num) && Number.isSafeInteger(num) && num > 0 ? num : null;
}
function parseTanggalInput(raw) {
  if (raw === void 0 || raw === null) return { valid: true, iso: null };
  const text = String(raw).trim();
  if (!text) return { valid: true, iso: null };
  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const tahun = Number(dateOnlyMatch[1]);
    const bulan = Number(dateOnlyMatch[2]);
    const tanggal = Number(dateOnlyMatch[3]);
    if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) {
      return { valid: false, iso: null };
    }
    const d = new Date(Date.UTC(tahun, bulan - 1, tanggal));
    if (d.getUTCFullYear() !== tahun || d.getUTCMonth() !== bulan - 1 || d.getUTCDate() !== tanggal) {
      return { valid: false, iso: null };
    }
    return { valid: true, iso: d.toISOString() };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return { valid: false, iso: null };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, iso: null };
  }
  return { valid: true, iso: parsed.toISOString() };
}
function buildDefaultTaxSettings() {
  return {
    id: 1,
    ppn_persen_default: 11,
    pph23_persen_default: 2,
    mode_harga: "belum_termasuk_ppn",
    ppn_termasuk_diskon: true,
    potong_pph23_otomatis: false,
    updated_at: null,
    updated_by: null
  };
}
function computeEffectiveTaxRates(params) {
  const globalTax = params.taxSettings ?? buildDefaultTaxSettings();
  const inst = params.instansi;
  const instansiPpn = Number(inst?.ppn_persen);
  let defaultPpn = instansiPpn > 0 ? instansiPpn : globalTax.ppn_persen_default;
  let defaultPph23 = 0;
  if (inst) {
    if (inst.pph23_persen !== void 0 && Number(inst.pph23_persen) > 0) {
      defaultPph23 = Number(inst.pph23_persen);
    } else if (globalTax.potong_pph23_otomatis && inst.npwp) {
      defaultPph23 = globalTax.pph23_persen_default;
    }
  } else if (globalTax.potong_pph23_otomatis) {
    defaultPph23 = globalTax.pph23_persen_default;
  }
  const hasPayloadPpn = params.payloadPpn !== void 0 && params.payloadPpn !== null && String(params.payloadPpn).trim() !== "";
  const hasPayloadPph23 = params.payloadPph23 !== void 0 && params.payloadPph23 !== null && String(params.payloadPph23).trim() !== "";
  return {
    ppnPersen: clampPercent(hasPayloadPpn ? params.payloadPpn : defaultPpn),
    pph23Persen: clampPercent(hasPayloadPph23 ? params.payloadPph23 : defaultPph23)
  };
}
function hitungPajakNota(params) {
  const subtotalItems = Math.max(0, round2(params.totalSebelumDiskonNota));
  const diskonPersen = clampPercent(params.diskonNotaPersen);
  const diskonNominal = round2(subtotalItems * diskonPersen / 100);
  const ppnPersen = clampPercent(params.ppnPersen);
  const pph23Persen = clampPercent(params.pph23Persen);
  const basisSetelahDiskon = Math.max(0, round2(subtotalItems - diskonNominal));
  const basisPajak = params.ppnTermasukDiskon !== false ? basisSetelahDiskon : subtotalItems;
  if (params.modeHarga === "sudah_termasuk_ppn" && ppnPersen > 0) {
    const dpp2 = round2(basisPajak / (1 + ppnPersen / 100));
    const ppnNominal2 = round2(basisPajak - dpp2);
    const pph23Nominal2 = round2(dpp2 * pph23Persen / 100);
    const totalTagihan2 = round2(Math.max(0, basisSetelahDiskon - pph23Nominal2));
    return { diskonNominal, dpp: dpp2, ppnNominal: ppnNominal2, pph23Nominal: pph23Nominal2, totalTagihan: totalTagihan2 };
  }
  const dpp = basisPajak;
  const ppnNominal = round2(dpp * ppnPersen / 100);
  const pph23Nominal = round2(dpp * pph23Persen / 100);
  const totalTagihan = round2(Math.max(0, basisSetelahDiskon + ppnNominal - pph23Nominal));
  return { diskonNominal, dpp, ppnNominal, pph23Nominal, totalTagihan };
}
var EDITABLE_MASTER_EXTENSIONS = [".ai", ".psd", ".cdr"];
function isEditableMasterFilename(filename) {
  const lower = String(filename ?? "").trim().toLowerCase();
  return EDITABLE_MASTER_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
function isTiffFilename(filename) {
  const lower = String(filename ?? "").trim().toLowerCase();
  return lower.endsWith(".tif") || lower.endsWith(".tiff");
}
function resolveBulkTiffMapping(params) {
  const { filenames, items, explicitMap } = params;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const mappings = [];
  const unmapped = [];
  const errors = [];
  const usedItemIds = /* @__PURE__ */ new Set();
  if (explicitMap && explicitMap.length > 0) {
    const mapByFile = /* @__PURE__ */ new Map();
    for (const entry of explicitMap) {
      const key = String(entry.filename ?? "").trim();
      const itemId = parsePositiveId(entry.item_id);
      if (key && itemId) mapByFile.set(key, itemId);
    }
    for (const filename of filenames) {
      if (!isTiffFilename(filename)) {
        errors.push(`File "${filename}" bukan format .tif/.tiff.`);
        continue;
      }
      const itemId = mapByFile.get(filename);
      if (!itemId) {
        unmapped.push(filename);
        continue;
      }
      const target = itemById.get(itemId);
      if (!target) {
        errors.push(`Item ID ${itemId} untuk file "${filename}" tidak termasuk pada nota ini.`);
        continue;
      }
      if (!target.acc_admin_id) {
        errors.push(`Item #${itemId} (${target.nama_item || target.product_name || "Item"}) belum di-ACC Admin.`);
        continue;
      }
      if (usedItemIds.has(itemId)) {
        errors.push(`Item #${itemId} dipetakan ke lebih dari satu file TIFF.`);
        continue;
      }
      usedItemIds.add(itemId);
      mappings.push({ filename, itemId });
    }
  } else {
    for (const filename of filenames) {
      if (!isTiffFilename(filename)) {
        errors.push(`File "${filename}" bukan format .tif/.tiff.`);
        continue;
      }
      let matchedId = null;
      const itemIdMatch = filename.match(/(?:^|[^a-z0-9])item[-_]?(\d+)(?:[^0-9]|$)/i);
      if (itemIdMatch) {
        const candidateId = Number(itemIdMatch[1]);
        if (itemById.has(candidateId)) matchedId = candidateId;
      }
      if (!matchedId) {
        const prefixIdxMatch = filename.match(/^0*(\d+)[-_.\s]/);
        if (prefixIdxMatch) {
          const idx = Number(prefixIdxMatch[1]) - 1;
          if (idx >= 0 && idx < items.length) {
            matchedId = items[idx].id;
          }
        }
      }
      if (!matchedId) {
        unmapped.push(filename);
        continue;
      }
      const target = itemById.get(matchedId);
      if (!target.acc_admin_id) {
        errors.push(`Item #${matchedId} belum di-ACC Admin.`);
        continue;
      }
      if (usedItemIds.has(matchedId)) {
        errors.push(`Item #${matchedId} cocok ke lebih dari satu file ("${filename}").`);
        continue;
      }
      usedItemIds.add(matchedId);
      mappings.push({ filename, itemId: matchedId });
    }
  }
  return {
    ok: unmapped.length === 0 && errors.length === 0 && mappings.length === filenames.length,
    mappings,
    unmapped,
    errors
  };
}
var DEFAULT_TINTA_GALON_ML = 5e3;
var DEFAULT_ROLL_PER_GALON = 6;
var DEFAULT_ROLL_AREA_M2 = round2(3.2 * 70);
function hitungTintaMlPerM2(kapasitasGalonMl = DEFAULT_TINTA_GALON_ML, rollPerGalon = DEFAULT_ROLL_PER_GALON, luasPerRollM2 = DEFAULT_ROLL_AREA_M2) {
  const totalLuas = Number(rollPerGalon) * Number(luasPerRollM2);
  if (!(kapasitasGalonMl > 0) || !(totalLuas > 0)) return 0;
  return round2(kapasitasGalonMl / totalLuas);
}
function hitungPemakaianTintaPerWarna(luasCetakM2, warnaList) {
  const luas = Math.max(0, round2(luasCetakM2));
  const rincian = warnaList.map((w) => ({
    tinta_warna_id: w.id,
    warna: w.warna,
    jumlah_ml: round2(luas * Math.max(0, Number(w.konsumsi_ml_per_m2 ?? 0)))
  }));
  const totalMl = round2(rincian.reduce((sum, r) => sum + r.jumlah_ml, 0));
  return { rincian, totalMl };
}
function hitungPemakaianBahanPrn(params) {
  const panjang = Math.max(0, round2(params.panjangFileM));
  const lebar = Math.max(0, round2(params.lebarFileM));
  const containerW = Math.max(lebar, round2(params.containerWidthM));
  const luasFileM2 = round2(panjang * lebar);
  const luasContainerM2 = round2(containerW * panjang);
  const offL = round2(Number(params.manualOffcutLebarM ?? 0));
  const offP = round2(Number(params.manualOffcutPanjangM ?? 0));
  const createsManualOffcut = offL > 0 && offP > 0;
  const offcutLuasM2 = createsManualOffcut ? round2(offL * offP) : 0;
  const wosPotongM2 = round2(Math.max(luasContainerM2 - luasFileM2 - offcutLuasM2, 0));
  return { luasFileM2, luasContainerM2, offcutLuasM2, wosPotongM2, createsManualOffcut };
}
function statusSetelahCetak(qtyOrder, totalQtyTercetak) {
  return Number(totalQtyTercetak) + 1e-3 >= Number(qtyOrder) ? "selesai" : "antrean_cetak";
}
function resolveQcStatus(hasil) {
  if (hasil === "lolos") return "proses_finishing";
  if (hasil === "cacat") return "cetak_ulang";
  return null;
}

// server/store.ts
var DATA_DIR = path2.resolve(process.cwd(), "data");
var DB_FILE = path2.join(DATA_DIR, "db.json");
var STANDARD_ROLL_SPECS = {
  "MMT 280": { lebar_m: 3.2, panjang_m: 70 },
  "MMT 340": { lebar_m: 3.2, panjang_m: 70 },
  "MMT 440": { lebar_m: 3.2, panjang_m: 70 },
  Backlit: { lebar_m: 3.2, panjang_m: 70 },
  "Stiker 1m": { lebar_m: 1, panjang_m: 50 },
  "Stiker 1.5m": { lebar_m: 1.5, panjang_m: 50 }
};
function round22(val) {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}
var INSENTIF_ROLES = ["desainer", "operator_cetak", "finishing"];
var INSENTIF_JENIS = ["per_item", "per_job"];
var DEFAULT_INSENTIF_RATES = [
  { role: "desainer", jenis: "per_item", nominal: 1500 },
  { role: "desainer", jenis: "per_job", nominal: 5e3 },
  { role: "operator_cetak", jenis: "per_item", nominal: 2e3 },
  { role: "operator_cetak", jenis: "per_job", nominal: 5e3 },
  { role: "finishing", jenis: "per_item", nominal: 1500 },
  { role: "finishing", jenis: "per_job", nominal: 5e3 }
];
function buildDefaultInsentifRates() {
  return DEFAULT_INSENTIF_RATES.map((rate, index) => ({
    ...rate,
    id: index + 1,
    updated_at: null,
    updated_by: null
  }));
}
function buildDefaultTintaWarna() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const konsumsi = hitungTintaMlPerM2(DEFAULT_TINTA_GALON_ML, DEFAULT_ROLL_PER_GALON, DEFAULT_ROLL_AREA_M2);
  return [
    { id: 1, kode: "TINTA-C", warna: "Cyan", satuan: "ml", stok_ml: 5e3, stok_minimum_ml: 1e3, kapasitas_galon_ml: 5e3, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
    { id: 2, kode: "TINTA-M", warna: "Magenta", satuan: "ml", stok_ml: 5e3, stok_minimum_ml: 1e3, kapasitas_galon_ml: 5e3, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
    { id: 3, kode: "TINTA-Y", warna: "Yellow", satuan: "ml", stok_ml: 5e3, stok_minimum_ml: 1e3, kapasitas_galon_ml: 5e3, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
    { id: 4, kode: "TINTA-K", warna: "Black", satuan: "ml", stok_ml: 5e3, stok_minimum_ml: 1e3, kapasitas_galon_ml: 5e3, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now }
  ];
}
function buildDefaultStokCattoff() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return [
    {
      id: 1,
      kode: "CT-MMT280-01",
      jenis_bahan: "MMT 280",
      lebar_m: 3.2,
      panjang_awal_m: 15,
      panjang_sisa_m: 15,
      status: "aktif",
      created_at: now,
      updated_at: now
    }
  ];
}
function buildDefaultWhatsappGatewayConfig() {
  const webhookUrl = String(process.env.WHATSAPP_WEBHOOK_URL ?? "").trim();
  return {
    id: 1,
    webhook_url: webhookUrl.replace(/\/+$/, ""),
    webhook_token: String(process.env.WHATSAPP_WEBHOOK_TOKEN ?? "").trim(),
    app_url: String(process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3e3}`).trim().replace(/\/+$/, ""),
    aktif: Boolean(webhookUrl),
    updated_at: null,
    updated_by: null
  };
}
function priceForCategory(product, category) {
  switch (category) {
    case "reseller":
      return product.harga_reseller;
    case "prioritas":
      return product.harga_prioritas;
    case "pegawai":
      return product.harga_pegawai;
    default:
      return product.harga_umum;
  }
}
function computeUkuranKotor(lebar_m, tinggi_m, qty, finishing) {
  const ekstraKiri = finishing?.ekstra_kiri_cm ?? 0;
  const ekstraKanan = finishing?.ekstra_kanan_cm ?? 0;
  const ekstraAtas = finishing?.ekstra_atas_cm ?? 0;
  const ekstraBawah = finishing?.ekstra_bawah_cm ?? 0;
  const lebar = round22(lebar_m + (ekstraKiri + ekstraKanan) / 100);
  const tinggi = round22(tinggi_m + (ekstraAtas + ekstraBawah) / 100);
  return {
    lebar,
    tinggi,
    luas: round22(lebar * tinggi * qty)
  };
}
function isoOffsetDays(days, hour = 9) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}
function dateOffsetDays(days) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function notaDateStr(daysOffset = 0) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function generateSeedPassword() {
  return crypto2.randomBytes(12).toString("base64url");
}
var seedCredentialsWritten = false;
function writeSeedCredentials(rows) {
  if (seedCredentialsWritten || rows.length === 0) return;
  seedCredentialsWritten = true;
  const file = path2.join(DATA_DIR, "initial-credentials.txt");
  const body = [
    "# Kredensial awal Reffo PrintFlow (HAPUS setelah semua password diganti)",
    `# Dibuat: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    ...rows.map((r) => `${r.role}	${r.email}	${r.password}`),
    ""
  ].join("\n");
  fs2.writeFileSync(file, body, { encoding: "utf-8", mode: 384 });
  console.warn(`[security] Password seed acak ditulis ke ${file}. Ganti password lalu hapus file ini.`);
}
function writePasswordResetReport(rows) {
  if (rows.length === 0) return;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const file = path2.join(DATA_DIR, `credentials-reset-${stamp}.txt`);
  const body = [
    "# Password default lama terdeteksi dan sudah direset otomatis.",
    "# Simpan file ini sementara, login, ganti password, lalu hapus file.",
    ...rows.map((r) => `${r.email}	${r.password}`),
    ""
  ].join("\n");
  fs2.writeFileSync(file, body, { encoding: "utf-8", mode: 384 });
  console.warn(`[security] ${rows.length} akun memakai password default. Password baru ditulis ke ${file}.`);
}
function backupDatabaseFile(reason) {
  if (!fs2.existsSync(DB_FILE)) return null;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = path2.join(DATA_DIR, "backups");
  fs2.mkdirSync(backupDir, { recursive: true });
  const target = path2.join(backupDir, `db-${reason}-${stamp}.json`);
  fs2.copyFileSync(DB_FILE, target);
  console.warn(`[backup] db.json disalin ke ${target}`);
  return target;
}
function createInitialSeed(writeCredentials = true) {
  const credentials = [
    { id: 1, name: "Rina", email: "admin@reffoprint.id", role: "admin" },
    { id: 2, name: "Budi", email: "desainer@reffoprint.id", role: "desainer" },
    { id: 3, name: "Agus", email: "operator@reffoprint.id", role: "operator_cetak" },
    { id: 4, name: "Dedi", email: "finishing@reffoprint.id", role: "finishing" },
    { id: 5, name: "Eko", email: "advertising@reffoprint.id", role: "advertising" },
    { id: 6, name: "Pak Hendra", email: "owner@reffoprint.id", role: "owner" }
  ].map((row) => ({ ...row, password: generateSeedPassword() }));
  if (writeCredentials) writeSeedCredentials(credentials);
  const users = credentials.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    password: hashPassword(row.password),
    active: true
  }));
  const instansis = [
    { id: 1, nama_instansi: "Perorangan" },
    { id: 2, nama_instansi: "Dinas Kebudayaan & Pariwisata" },
    { id: 3, nama_instansi: "PT Graha Nusantara Mandiri" },
    { id: 4, nama_instansi: "CV Kreasindo Digital Agency" },
    { id: 5, nama_instansi: "Universitas Merdeka Nusantara" }
  ];
  const customers = [
    {
      id: 1,
      instansi_id: 2,
      instansi: "Dinas Kebudayaan & Pariwisata",
      nama_pelanggan: "Ibu Kartika Sari",
      no_wa: "081228991100",
      kategori: "prioritas",
      alamat: "Jl. Jenderal Sudirman No. 45"
    },
    {
      id: 2,
      instansi_id: 3,
      instansi: "PT Graha Nusantara Mandiri",
      nama_pelanggan: "Bpk. Pratama Wijaya",
      no_wa: "081345678901",
      kategori: "prioritas",
      alamat: "Kawasan Bisnis Sentral Blok B2"
    },
    {
      id: 3,
      instansi_id: 4,
      instansi: "CV Kreasindo Digital Agency",
      nama_pelanggan: "Mas Fajar Ramadhan",
      no_wa: "085712349876",
      kategori: "reseller",
      alamat: "Jl. Diponegoro No. 18"
    },
    {
      id: 4,
      instansi_id: 5,
      instansi: "Universitas Merdeka Nusantara",
      nama_pelanggan: "Panitia BEM / Saudara Raka",
      no_wa: "082198765432",
      kategori: "prioritas",
      alamat: "Kampus Terpadu Gedung C"
    },
    {
      id: 5,
      instansi_id: 1,
      instansi: "Perorangan",
      nama_pelanggan: "Bu Siti Rahayu",
      no_wa: "087811223344",
      kategori: "umum",
      alamat: "Perum Griya Indah Blok A7"
    }
  ];
  const products = [
    {
      id: 1,
      nama_produk: "MMT 280",
      kategori_produk: "meteran",
      harga_umum: 3e4,
      harga_reseller: 27e3,
      harga_prioritas: 25e3,
      harga_pegawai: 22e3,
      harga_modal: 18e3,
      stok_pcs: null
    },
    {
      id: 2,
      nama_produk: "MMT 340",
      kategori_produk: "meteran",
      harga_umum: 35e3,
      harga_reseller: 31e3,
      harga_prioritas: 29e3,
      harga_pegawai: 25e3,
      harga_modal: 21e3,
      stok_pcs: null
    },
    {
      id: 3,
      nama_produk: "MMT 440",
      kategori_produk: "meteran",
      harga_umum: 45e3,
      harga_reseller: 4e4,
      harga_prioritas: 37e3,
      harga_pegawai: 32e3,
      harga_modal: 27e3,
      stok_pcs: null
    },
    {
      id: 4,
      nama_produk: "Backlit",
      kategori_produk: "meteran",
      harga_umum: 6e4,
      harga_reseller: 54e3,
      harga_prioritas: 5e4,
      harga_pegawai: 45e3,
      harga_modal: 38e3,
      stok_pcs: null
    },
    {
      id: 5,
      nama_produk: "Stiker Meteran",
      kategori_produk: "meteran",
      harga_umum: 5e4,
      harga_reseller: 45e3,
      harga_prioritas: 42e3,
      harga_pegawai: 38e3,
      harga_modal: 32e3,
      stok_pcs: null
    },
    {
      id: 6,
      nama_produk: "X-Banner",
      kategori_produk: "satuan",
      harga_umum: 85e3,
      harga_reseller: 75e3,
      harga_prioritas: 7e4,
      harga_pegawai: 65e3,
      harga_modal: 55e3,
      stok_pcs: 24
    },
    {
      id: 7,
      nama_produk: "Roll Banner",
      kategori_produk: "satuan",
      harga_umum: 15e4,
      harga_reseller: 135e3,
      harga_prioritas: 125e3,
      harga_pegawai: 115e3,
      harga_modal: 95e3,
      stok_pcs: 18
    },
    {
      id: 8,
      nama_produk: "Poster",
      kategori_produk: "satuan",
      harga_umum: 15e3,
      harga_reseller: 13e3,
      harga_prioritas: 12e3,
      harga_pegawai: 1e4,
      harga_modal: 8e3,
      stok_pcs: 45
    },
    {
      id: 9,
      nama_produk: "Stiker A3",
      kategori_produk: "satuan",
      harga_umum: 2e4,
      harga_reseller: 17500,
      harga_prioritas: 16e3,
      harga_pegawai: 14e3,
      harga_modal: 11e3,
      stok_pcs: 60
    },
    {
      id: 10,
      nama_produk: "A-Board",
      kategori_produk: "satuan",
      harga_umum: 25e4,
      harga_reseller: 225e3,
      harga_prioritas: 21e4,
      harga_pegawai: 195e3,
      harga_modal: 17e4,
      stok_pcs: 8
    },
    {
      id: 11,
      nama_produk: "Kartu Nama A3+",
      kategori_produk: "satuan",
      harga_umum: 9e4,
      harga_reseller: 8e4,
      harga_prioritas: 75e3,
      harga_pegawai: 65e3,
      harga_modal: 52e3,
      stok_pcs: 120,
      mesin_default_id: 3,
      satuan_hitung: "klik",
      klik_per_lembar: 2,
      ukuran_lembar: "A3+ 329 \xD7 483 mm (bolak-balik)"
    },
    {
      id: 12,
      nama_produk: "Brosur A3+",
      kategori_produk: "satuan",
      harga_umum: 18e3,
      harga_reseller: 16e3,
      harga_prioritas: 14500,
      harga_pegawai: 13e3,
      harga_modal: 9500,
      stok_pcs: 200,
      mesin_default_id: 3,
      satuan_hitung: "klik",
      klik_per_lembar: 2,
      ukuran_lembar: "A3+ 329 \xD7 483 mm (bolak-balik)"
    },
    {
      id: 13,
      nama_produk: "Stiker A3+ UV",
      kategori_produk: "satuan",
      harga_umum: 25e3,
      harga_reseller: 22e3,
      harga_prioritas: 2e4,
      harga_pegawai: 18e3,
      harga_modal: 14e3,
      stok_pcs: 150,
      mesin_default_id: 2,
      satuan_hitung: "klik",
      klik_per_lembar: 1,
      ukuran_lembar: "A3+ 329 \xD7 483 mm"
    }
  ];
  const finishings = [
    { id: 1, nama_finishing: "Siming", ekstra_kiri_cm: 2.5, ekstra_kanan_cm: 2.5, ekstra_atas_cm: 2.5, ekstra_bawah_cm: 2.5 },
    { id: 2, nama_finishing: "Siming Keling", ekstra_kiri_cm: 2.5, ekstra_kanan_cm: 2.5, ekstra_atas_cm: 2.5, ekstra_bawah_cm: 2.5 },
    { id: 3, nama_finishing: "Kolong AB Samping Potong Press", ekstra_kiri_cm: 0, ekstra_kanan_cm: 0, ekstra_atas_cm: 7, ekstra_bawah_cm: 7 },
    { id: 4, nama_finishing: "Kolong AB Samping Siming", ekstra_kiri_cm: 2.5, ekstra_kanan_cm: 2.5, ekstra_atas_cm: 7, ekstra_bawah_cm: 7 },
    { id: 5, nama_finishing: "Kolong KK AB Siming", ekstra_kiri_cm: 7, ekstra_kanan_cm: 7, ekstra_atas_cm: 2.5, ekstra_bawah_cm: 2.5 },
    { id: 6, nama_finishing: "Kolong KK AB Samping Potong Press", ekstra_kiri_cm: 7, ekstra_kanan_cm: 7, ekstra_atas_cm: 0, ekstra_bawah_cm: 0 },
    { id: 7, nama_finishing: "Kolong Baliho", ekstra_kiri_cm: 7.5, ekstra_kanan_cm: 7.5, ekstra_atas_cm: 7.5, ekstra_bawah_cm: 7.5 }
  ];
  const material_rolls = [
    { id: 1, kode_roll: "MMT280-R01", jenis_bahan: "MMT 280", lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 54.4, status: "aktif" },
    { id: 2, kode_roll: "MMT280-R02", jenis_bahan: "MMT 280", lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 70, status: "aktif" },
    { id: 3, kode_roll: "MMT340-R01", jenis_bahan: "MMT 340", lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 61.5, status: "aktif" },
    { id: 4, kode_roll: "MMT440-R01", jenis_bahan: "MMT 440", lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 58, status: "aktif" },
    { id: 5, kode_roll: "BACKLIT-R01", jenis_bahan: "Backlit", lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 64, status: "aktif" },
    { id: 6, kode_roll: "STIKER1M-R01", jenis_bahan: "Stiker 1m", lebar_m: 1, panjang_awal_m: 50, panjang_sisa_m: 41.2, status: "aktif" },
    { id: 7, kode_roll: "STIKER15M-R01", jenis_bahan: "Stiker 1.5m", lebar_m: 1.5, panjang_awal_m: 50, panjang_sisa_m: 44.5, status: "aktif" }
  ];
  const material_offcuts = [
    {
      id: 1,
      material_roll_id: 1,
      kode_roll: "MMT280-R01",
      jenis_bahan: "MMT 280",
      lebar_m: 1.15,
      panjang_m: 6.1,
      luas_m2: 7.02,
      status: "tersedia",
      created_at: isoOffsetDays(-2, 11)
    },
    {
      id: 2,
      material_roll_id: 4,
      kode_roll: "MMT440-R01",
      jenis_bahan: "MMT 440",
      lebar_m: 0.95,
      panjang_m: 4.1,
      luas_m2: 3.9,
      status: "tersedia",
      created_at: isoOffsetDays(-1, 14)
    }
  ];
  const machines = [
    {
      id: 1,
      kode_mesin: "LF-01",
      nama_mesin: "Large Format Solvent/Eco-Solvent",
      jenis: "large_format",
      lebar_max_m: 3.2,
      konsumsi_tinta_ml_per_m2: 12,
      aktif: true,
      keterangan: "MMT, Backlit, dan Stiker Roll",
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8)
    },
    {
      id: 2,
      kode_mesin: "UV-01",
      nama_mesin: "UV Roll / Flatbed",
      jenis: "uv",
      lebar_max_m: 3.2,
      konsumsi_tinta_ml_per_m2: 16,
      aktif: true,
      keterangan: "Akrilik, PVC, Stiker UV",
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8)
    },
    {
      id: 3,
      kode_mesin: "A3P-01",
      nama_mesin: "Digital Press A3+",
      jenis: "digital_a3p",
      lebar_max_m: 0.483,
      konsumsi_tinta_ml_per_m2: 9,
      aktif: true,
      keterangan: "Art Paper, Art Carton, Stiker A3+, Brosur, Kartu Nama (hitung klik)",
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8)
    },
    {
      id: 4,
      kode_mesin: "CUT-01",
      nama_mesin: "Cutting Sticker & Laser",
      jenis: "cutting",
      lebar_max_m: 1.2,
      konsumsi_tinta_ml_per_m2: 0,
      aktif: true,
      keterangan: "Kiss-cut, die-cut, dan laser acrylic",
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8)
    }
  ];
  const supplies = [
    {
      id: 1,
      kode: "TINTA-CMYK-LF",
      nama: "Tinta Eco Solvent C/M/Y/K",
      kategori: "tinta",
      satuan: "ml",
      stok: 18e3,
      stok_minimum: 3e3,
      harga_satuan: 0.35,
      konsumsi_per_m2: 12,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    },
    {
      id: 2,
      kode: "TINTA-UV",
      nama: "Tinta UV C/M/Y/K/White",
      kategori: "tinta",
      satuan: "ml",
      stok: 9500,
      stok_minimum: 2e3,
      harga_satuan: 0.8,
      konsumsi_per_m2: 16,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    },
    {
      id: 3,
      kode: "TINTA-A3P",
      nama: "Toner Digital Press A3+",
      kategori: "tinta",
      satuan: "ml",
      stok: 4200,
      stok_minimum: 1200,
      harga_satuan: 0.5,
      konsumsi_per_m2: 9,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    },
    {
      id: 4,
      kode: "LAMINASI-DOFF",
      nama: "Plastik Laminasi Doff",
      kategori: "bahan_pembantu",
      satuan: "meter",
      stok: 120,
      stok_minimum: 30,
      harga_satuan: 6500,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    },
    {
      id: 5,
      kode: "MATA-AYAM",
      nama: "Mata Ayam / Keling",
      kategori: "bahan_pembantu",
      satuan: "pcs",
      stok: 850,
      stok_minimum: 200,
      harga_satuan: 350,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    },
    {
      id: 6,
      kode: "SELONGSONG",
      nama: "Selongsong / Bambu Roll Banner",
      kategori: "bahan_pembantu",
      satuan: "pcs",
      stok: 32,
      stok_minimum: 10,
      harga_satuan: 45e3,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    },
    {
      id: 7,
      kode: "DAMPER-LF",
      nama: "Damper Printhead Large Format",
      kategori: "suku_cadang",
      satuan: "pcs",
      stok: 6,
      stok_minimum: 4,
      harga_satuan: 85e3,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8)
    }
  ];
  const previewSpanduk = "/src/assets/images/preview_spanduk_event_1795506340738.jpg";
  const previewBackdrop = "/src/assets/images/preview_backdrop_seminar_1795506348622.jpg";
  const orders = [
    // Order 1: Waiting for Admin Design Review (ACC / Revisi)
    {
      id: 1,
      no_nota: `INV-${notaDateStr(0)}-0001`,
      customer_id: 1,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 675e3,
      jumlah_dp: 35e4,
      status_bayar: "dp",
      status_desain: "file_mentah",
      catatan_desain: "Tema Festival Komunitas Yogyakarta, warna biru cobalt & putih, sertakan logo dinas.",
      lampiran_briefing: null,
      file_master_arsip: null,
      waktu_terima_desain: isoOffsetDays(0, 8),
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(1, 17),
      created_at: isoOffsetDays(0, 8),
      updated_at: isoOffsetDays(0, 10)
    },
    // Order 2: Antrean Cetak (Operator Cetak) + SPK Advertising
    {
      id: 2,
      no_nota: `INV-${notaDateStr(-1)}-0002`,
      customer_id: 2,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 138e4,
      jumlah_dp: 138e4,
      status_bayar: "lunas",
      status_desain: "siap_cetak_tiff",
      catatan_desain: "Backdrop Seminar Corporate Governance + Standing X-Banner arah aula.",
      lampiran_briefing: null,
      file_master_arsip: "MASTER-INV-0002-FINAL.cdr",
      waktu_terima_desain: isoOffsetDays(-1, 9),
      waktu_selesai_desain: isoOffsetDays(-1, 13),
      tanda_tangan_desainer: "Budi",
      tanda_tangan_admin: "Rina",
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(1, 12),
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13)
    },
    // Order 3: Antrean Finishing (Finishing Division)
    {
      id: 3,
      no_nota: `INV-${notaDateStr(-1)}-0003`,
      customer_id: 3,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 486e3,
      jumlah_dp: 25e4,
      status_bayar: "dp",
      status_desain: "siap_cetak_tiff",
      catatan_desain: "Spanduk promosi ritel reseller, pastikan mata ayam tiap 50cm.",
      lampiran_briefing: null,
      file_master_arsip: "MASTER-INV-0003-FINAL.ai",
      waktu_terima_desain: isoOffsetDays(-1, 10),
      waktu_selesai_desain: isoOffsetDays(-1, 14),
      tanda_tangan_desainer: "Budi",
      tanda_tangan_admin: "Rina",
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(2, 16),
      created_at: isoOffsetDays(-1, 10),
      updated_at: isoOffsetDays(0, 9)
    },
    // Order 4: Siap Diambil (waiting Pelunasan -> Serah Terima)
    {
      id: 4,
      no_nota: `INV-${notaDateStr(-2)}-0004`,
      customer_id: 4,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 89e4,
      jumlah_dp: 4e5,
      status_bayar: "dp",
      status_desain: "siap_cetak_tiff",
      catatan_desain: "Spanduk Orientasi Mahasiswa Baru & Poster A3.",
      lampiran_briefing: null,
      file_master_arsip: "MASTER-INV-0004.pdf",
      waktu_terima_desain: isoOffsetDays(-2, 9),
      waktu_selesai_desain: isoOffsetDays(-2, 12),
      tanda_tangan_desainer: "Budi",
      tanda_tangan_admin: "Rina",
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(0, 17),
      created_at: isoOffsetDays(-2, 9),
      updated_at: isoOffsetDays(-1, 16)
    },
    // Order 5: Menunggu Desain (Baru masuk ke antrean Desainer)
    {
      id: 5,
      no_nota: `INV-${notaDateStr(0)}-0005`,
      customer_id: 5,
      user_id: 1,
      designer_id: null,
      total_tagihan: 33e4,
      jumlah_dp: 0,
      status_bayar: "belum_lunas",
      status_desain: "belum_ada_file",
      catatan_desain: "Banner Warung Kuliner Bu Siti: menu bakso, soto, es teh. Foto menu menyusul via WA.",
      lampiran_briefing: null,
      file_master_arsip: null,
      waktu_terima_desain: null,
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(2, 15),
      created_at: isoOffsetDays(0, 11),
      updated_at: isoOffsetDays(0, 11)
    },
    // Order 6: Selesai (Closed & Handed Over, contributes to Omzet & Profit/Loss)
    {
      id: 6,
      no_nota: `INV-${notaDateStr(-4)}-0006`,
      customer_id: 2,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 15e5,
      jumlah_dp: 15e5,
      status_bayar: "lunas",
      status_desain: "siap_cetak_tiff",
      catatan_desain: "Neonbox Backlit Lobby & Stiker Kaca Kantor.",
      lampiran_briefing: null,
      file_master_arsip: "MASTER-INV-0006.tif",
      waktu_terima_desain: isoOffsetDays(-4, 9),
      waktu_selesai_desain: isoOffsetDays(-4, 13),
      tanda_tangan_desainer: "Budi",
      tanda_tangan_admin: "Rina",
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: "Bagus (Kurir PT Graha)",
      no_wa_pengambil: "081345670000",
      kurir_nama: "Kurir PT Graha",
      resi_pengiriman: null,
      waktu_serah_terima: isoOffsetDays(-3, 16),
      catatan_pengecualian: null,
      deadline: isoOffsetDays(-3, 17),
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 16)
    }
  ];
  const order_items = [
    // Order 1 items
    {
      id: 1,
      order_id: 1,
      nama_item: "Spanduk Utama Festival",
      product_id: 1,
      // MMT 280
      finishing_id: 2,
      // Siming Keling
      lebar_m: 4.5,
      tinggi_m: 2,
      qty: 3,
      luas_tagihan_m2: 27,
      harga_satuan_dipakai: 25e3,
      subtotal: 675e3,
      status_produksi: "menunggu_acc",
      acc_admin_id: null,
      waktu_acc: null,
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: null,
      file_master_arsip: null,
      created_at: isoOffsetDays(0, 8),
      updated_at: isoOffsetDays(0, 10)
    },
    // Order 2 items
    {
      id: 2,
      order_id: 2,
      nama_item: "Backdrop Panggung Utama",
      product_id: 3,
      // MMT 440
      finishing_id: 7,
      // Kolong Baliho
      lebar_m: 6,
      tinggi_m: 3,
      qty: 1,
      luas_tagihan_m2: 18,
      harga_satuan_dipakai: 37e3,
      subtotal: 666e3,
      status_produksi: "antrean_cetak",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: "backdrop-panggung-6x3.tif",
      file_master_arsip: "MASTER-INV-0002-FINAL.cdr",
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13)
    },
    {
      id: 3,
      order_id: 2,
      nama_item: "Stiker Signboard Arah",
      product_id: 5,
      // Stiker Meteran
      finishing_id: null,
      lebar_m: 0.85,
      tinggi_m: 1.5,
      qty: 4,
      luas_tagihan_m2: 5.1,
      harga_satuan_dipakai: 42e3,
      subtotal: 214200,
      status_produksi: "antrean_cetak",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: "stiker-signboard.tif",
      file_master_arsip: "MASTER-INV-0002-FINAL.cdr",
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13)
    },
    {
      id: 4,
      order_id: 2,
      nama_item: "Roll Banner Registrasi",
      product_id: 7,
      // Roll Banner
      finishing_id: null,
      lebar_m: null,
      tinggi_m: null,
      qty: 4,
      luas_tagihan_m2: null,
      harga_satuan_dipakai: 125e3,
      subtotal: 5e5,
      status_produksi: "antrean_cetak",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: "roll-banner-reg.tif",
      file_master_arsip: "MASTER-INV-0002-FINAL.cdr",
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13)
    },
    // Order 3 items (in Finishing)
    {
      id: 5,
      order_id: 3,
      nama_item: "Spanduk Promo Ritel",
      product_id: 1,
      // MMT 280
      finishing_id: 2,
      // Siming Keling
      lebar_m: 3,
      tinggi_m: 1.5,
      qty: 4,
      luas_tagihan_m2: 18,
      harga_satuan_dipakai: 27e3,
      subtotal: 486e3,
      status_produksi: "antrean_finishing",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 13),
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: "spanduk-ritel-3x15.tif",
      file_master_arsip: "MASTER-INV-0003-FINAL.ai",
      created_at: isoOffsetDays(-1, 10),
      updated_at: isoOffsetDays(0, 9)
    },
    // Order 4 items (Siap Diambil)
    {
      id: 6,
      order_id: 4,
      nama_item: "Spanduk PKKMB Fakultas",
      product_id: 2,
      // MMT 340
      finishing_id: 4,
      // Kolong AB Samping Siming
      lebar_m: 5,
      tinggi_m: 2,
      qty: 2,
      luas_tagihan_m2: 20,
      harga_satuan_dipakai: 29e3,
      subtotal: 58e4,
      status_produksi: "siap_diambil",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-2, 11),
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: "pkkmb-5x2.tif",
      file_master_arsip: "MASTER-INV-0004.pdf",
      created_at: isoOffsetDays(-2, 9),
      updated_at: isoOffsetDays(-1, 15)
    },
    {
      id: 7,
      order_id: 4,
      nama_item: "Poster Jadwal Acara",
      product_id: 8,
      // Poster
      finishing_id: null,
      lebar_m: null,
      tinggi_m: null,
      qty: 25,
      luas_tagihan_m2: null,
      harga_satuan_dipakai: 12e3,
      subtotal: 3e5,
      status_produksi: "siap_diambil",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-2, 11),
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: "poster-acara.tif",
      file_master_arsip: "MASTER-INV-0004.pdf",
      created_at: isoOffsetDays(-2, 9),
      updated_at: isoOffsetDays(-1, 16)
    },
    // Order 5 items (Menunggu Desain)
    {
      id: 8,
      order_id: 5,
      nama_item: "Banner Menu Warung",
      product_id: 1,
      // MMT 280
      finishing_id: 1,
      // Siming
      lebar_m: 2.5,
      tinggi_m: 1.2,
      qty: 2,
      luas_tagihan_m2: 6,
      harga_satuan_dipakai: 3e4,
      subtotal: 18e4,
      status_produksi: "menunggu_desain",
      acc_admin_id: null,
      waktu_acc: null,
      file_preview_acc: null,
      file_cetak_tiff: null,
      file_master_arsip: null,
      created_at: isoOffsetDays(0, 11),
      updated_at: isoOffsetDays(0, 11)
    },
    {
      id: 9,
      order_id: 5,
      nama_item: "X-Banner Promo Minuman",
      product_id: 6,
      // X-Banner
      finishing_id: null,
      lebar_m: null,
      tinggi_m: null,
      qty: 2,
      luas_tagihan_m2: null,
      harga_satuan_dipakai: 75e3,
      subtotal: 15e4,
      status_produksi: "menunggu_desain",
      acc_admin_id: null,
      waktu_acc: null,
      file_preview_acc: null,
      file_cetak_tiff: null,
      file_master_arsip: null,
      created_at: isoOffsetDays(0, 11),
      updated_at: isoOffsetDays(0, 11)
    },
    // Order 6 items (Selesai)
    {
      id: 10,
      order_id: 6,
      nama_item: "Neonbox Backlit Lobby",
      product_id: 4,
      // Backlit
      finishing_id: 1,
      // Siming
      lebar_m: 3,
      tinggi_m: 2,
      qty: 3,
      luas_tagihan_m2: 18,
      harga_satuan_dipakai: 5e4,
      subtotal: 9e5,
      status_produksi: "selesai",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-4, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: "backlit-lobby.tif",
      file_master_arsip: "MASTER-INV-0006.tif",
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 16)
    },
    {
      id: 11,
      order_id: 6,
      nama_item: "Stiker Kaca Sandblast",
      product_id: 5,
      // Stiker Meteran
      finishing_id: null,
      lebar_m: 1.2,
      tinggi_m: 2.5,
      qty: 4,
      luas_tagihan_m2: 12,
      harga_satuan_dipakai: 42e3,
      subtotal: 504e3,
      status_produksi: "selesai",
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-4, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: "stiker-kaca.tif",
      file_master_arsip: "MASTER-INV-0006.tif",
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 16)
    }
  ];
  orders[1].total_tagihan = 1380200;
  orders[1].jumlah_dp = 1380200;
  orders[3].total_tagihan = 88e4;
  orders[5].total_tagihan = 1404e3;
  orders[5].jumlah_dp = 1404e3;
  const order_payments = [
    {
      id: 1,
      order_id: 1,
      tanggal: isoOffsetDays(0, 8),
      nominal: 35e4,
      metode: "Transfer",
      keterangan: "DP awal pembuatan nota",
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(0, 8)
    },
    {
      id: 2,
      order_id: 2,
      tanggal: isoOffsetDays(-1, 8),
      nominal: 1380200,
      metode: "Transfer",
      keterangan: "Pelunasan langsung di muka",
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-1, 8)
    },
    {
      id: 3,
      order_id: 3,
      tanggal: isoOffsetDays(-1, 10),
      nominal: 25e4,
      metode: "QRIS",
      keterangan: "DP awal",
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-1, 10)
    },
    {
      id: 4,
      order_id: 4,
      tanggal: isoOffsetDays(-2, 9),
      nominal: 4e5,
      metode: "Tunai",
      keterangan: "DP panitia BEM",
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-2, 9)
    },
    {
      id: 5,
      order_id: 6,
      tanggal: isoOffsetDays(-4, 9),
      nominal: 7e5,
      metode: "Transfer",
      keterangan: "DP Termin 1",
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-4, 9)
    },
    {
      id: 6,
      order_id: 6,
      tanggal: isoOffsetDays(-3, 15),
      nominal: 704e3,
      metode: "Transfer",
      keterangan: "Pelunasan Termin 2 sebelum serah terima",
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-3, 15)
    }
  ];
  const design_revisions = [
    {
      id: 1,
      order_id: 1,
      order_item_id: null,
      revisi_ke: 1,
      catatan_revisi: "Upload preview awal oleh Desainer",
      file_preview: previewSpanduk,
      admin_id: null,
      status_revisi: "selesai",
      created_at: isoOffsetDays(0, 10)
    },
    {
      id: 2,
      order_id: 2,
      order_item_id: null,
      revisi_ke: 1,
      catatan_revisi: "Perbesar logo sponsor di bagian bawah agar terbaca dari jauh.",
      file_preview: previewBackdrop,
      admin_id: 1,
      status_revisi: "selesai",
      created_at: isoOffsetDays(-1, 11)
    }
  ];
  const advertising_spks = [
    {
      id: 1,
      order_id: 2,
      jenis_pekerjaan: "Pemasangan Rangka Backdrop & Rigging Panggung",
      ukuran_konstruksi: "6m x 3m Besi Hollow 4x4",
      lokasi_pasang: "Ballroom Lt. 3 Hotel Mulia Sentral",
      catatan_teknis: "Akses loading dock dibuka pukul 21.00 WIB, wajib helm proyek.",
      status_lapangan: "perakitan",
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(0, 9)
    },
    {
      id: 2,
      order_id: 6,
      jenis_pekerjaan: "Instalasi Neonbox Backlit & Stiker Kaca",
      ukuran_konstruksi: "3m x 2m Frame Aluminium + LED Modul",
      lokasi_pasang: "Lobby Utama PT Graha Nusantara Mandiri",
      catatan_teknis: "Gunakan timer otomatis lampu 18.00-06.00 WIB.",
      status_lapangan: "selesai",
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 15)
    }
  ];
  const material_logs = [
    {
      id: 1,
      order_item_id: 5,
      material_roll_id: 1,
      material_offcut_id: null,
      luas_netto_m2: 18,
      wos_finishing_m2: 0.92,
      wos_potong_m2: 0.42,
      gagal_cetak_m2: 0,
      keterangan: "Selesai cetak | MMT 280 | 6.20 m",
      created_at: isoOffsetDays(0, 9)
    },
    {
      id: 2,
      order_item_id: 6,
      material_roll_id: 3,
      material_offcut_id: null,
      luas_netto_m2: 20,
      wos_finishing_m2: 1.93,
      wos_potong_m2: 0.35,
      gagal_cetak_m2: 0,
      keterangan: "Selesai cetak | MMT 340 | 4.28 m",
      created_at: isoOffsetDays(-1, 14)
    },
    {
      id: 3,
      order_item_id: 10,
      material_roll_id: 5,
      material_offcut_id: null,
      luas_netto_m2: 18,
      wos_finishing_m2: 0.76,
      wos_potong_m2: 0.28,
      gagal_cetak_m2: 0,
      keterangan: "Selesai cetak | Backlit | 6.15 m",
      created_at: isoOffsetDays(-4, 14)
    },
    {
      id: 4,
      order_item_id: 10,
      material_roll_id: 5,
      material_offcut_id: null,
      luas_netto_m2: 0,
      wos_finishing_m2: 0,
      wos_potong_m2: 0,
      gagal_cetak_m2: 1.6,
      keterangan: "Gagal cetak | Roll BACKLIT-R01 | 0.50 m (nozzle head tersumbat)",
      created_at: isoOffsetDays(-4, 13)
    },
    {
      id: 5,
      order_item_id: 11,
      material_roll_id: 7,
      material_offcut_id: null,
      luas_netto_m2: 12,
      wos_finishing_m2: 0,
      wos_potong_m2: 0.3,
      gagal_cetak_m2: 0,
      keterangan: "Selesai cetak | Stiker Meteran | 5.00 m",
      created_at: isoOffsetDays(-3, 11)
    }
  ];
  const operational_expenses = [
    {
      id: 1,
      tanggal: dateOffsetDays(-3),
      kategori_biaya: "Tinta",
      keterangan: "Pembelian Tinta Eco-Solvent CMYK 4x1 Liter",
      nominal: 85e4,
      created_at: isoOffsetDays(-3, 10)
    },
    {
      id: 2,
      tanggal: dateOffsetDays(-2),
      kategori_biaya: "Listrik & Air",
      keterangan: "Token Listrik Workshop & AC Ruang Cetak",
      nominal: 45e4,
      created_at: isoOffsetDays(-2, 9)
    },
    {
      id: 3,
      tanggal: dateOffsetDays(-1),
      kategori_biaya: "Perawatan Mesin",
      keterangan: "Pembersihan Damper & Kalibrasi Printhead Roland",
      nominal: 3e5,
      created_at: isoOffsetDays(-1, 15)
    }
  ];
  const suppliers = [
    {
      id: 1,
      kode_supplier: "SUP-01",
      nama_supplier: "CV Sinar Abadi",
      kontak: "Pak Slamet",
      no_wa: "081234567891",
      alamat: "Jl. Industri No. 12, Surabaya",
      npwp: "01.234.567.8-901.000",
      aktif: true,
      created_at: isoOffsetDays(-45, 8),
      updated_at: isoOffsetDays(-45, 8)
    },
    {
      id: 2,
      kode_supplier: "SUP-02",
      nama_supplier: "PT Maju Grafika",
      kontak: "Ibu Ratna",
      no_wa: "081234567892",
      alamat: "Jl. Raya printing No. 8, Sidoarjo",
      npwp: null,
      aktif: true,
      created_at: isoOffsetDays(-30, 9),
      updated_at: isoOffsetDays(-30, 9)
    }
  ];
  return {
    users,
    instansis,
    customers,
    products,
    finishings,
    material_rolls,
    material_offcuts,
    stok_cattoff: buildDefaultStokCattoff(),
    tinta_warna: buildDefaultTintaWarna(),
    pemakaian_tinta: [],
    cetak_grup: [],
    cetak_grup_item: [],
    machines,
    supplies,
    supply_usages: [],
    print_batches: [],
    orders,
    order_items,
    order_payments,
    design_revisions,
    advertising_spks,
    material_logs,
    operational_expenses,
    shifts: [],
    suppliers,
    purchase_orders: [],
    goods_receipts: [],
    supplier_payments: [],
    whatsapp_outbox: [],
    whatsapp_gateway_config: buildDefaultWhatsappGatewayConfig(),
    tax_settings: buildDefaultTaxSettings(),
    audit_logs: [],
    insentif_rates: buildDefaultInsentifRates(),
    counters: {
      users: 6,
      instansis: 5,
      customers: 5,
      products: 13,
      finishings: 7,
      material_rolls: 7,
      material_offcuts: 2,
      stok_cattoff: 1,
      tinta_warna: 4,
      pemakaian_tinta: 0,
      cetak_grup: 0,
      cetak_grup_item: 0,
      machines: 4,
      supplies: 7,
      supply_usages: 0,
      print_batches: 0,
      orders: 6,
      order_items: 11,
      order_payments: 6,
      design_revisions: 2,
      advertising_spks: 2,
      material_logs: 5,
      operational_expenses: 3,
      shifts: 0,
      suppliers: suppliers.length,
      purchase_orders: 0,
      goods_receipts: 0,
      supplier_payments: 0,
      whatsapp_outbox: 0,
      audit_logs: 0,
      insentif_rates: DEFAULT_INSENTIF_RATES.length
    }
  };
}
var Store = class {
  constructor() {
    this.criticalDepth = 0;
    if (!fs2.existsSync(DATA_DIR)) {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs2.existsSync(DB_FILE)) {
      try {
        const raw = fs2.readFileSync(DB_FILE, "utf-8");
        this.state = JSON.parse(raw);
        this.migrateInMemory();
      } catch (err) {
        const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
        const corruptFile = `${DB_FILE}.corrupt-${stamp}`;
        try {
          fs2.copyFileSync(DB_FILE, corruptFile);
        } catch (copyErr) {
          console.error("[backup] Gagal menyalin db.json rusak:", copyErr);
        }
        console.error(
          `[store] db.json tidak dapat dibaca (${err.message}). File asli disimpan sebagai ${corruptFile}. Data seed baru dibuat.`
        );
        this.state = createInitialSeed();
        this.persist();
      }
    } else {
      this.state = createInitialSeed();
      this.persist();
    }
  }
  migrateInMemory() {
    let changed = false;
    if (!Array.isArray(this.state.order_payments)) {
      this.state.order_payments = [];
      this.state.counters.order_payments = 0;
      changed = true;
    }
    if (!Array.isArray(this.state.shifts)) {
      this.state.shifts = [];
      this.state.counters.shifts = 0;
      changed = true;
    }
    if (!Array.isArray(this.state.audit_logs)) {
      this.state.audit_logs = [];
      this.state.counters.audit_logs = 0;
      changed = true;
    }
    const waDefault = buildDefaultWhatsappGatewayConfig();
    const waConfig = this.state.whatsapp_gateway_config;
    if (!waConfig || typeof waConfig !== "object") {
      this.state.whatsapp_gateway_config = waDefault;
      changed = true;
    } else {
      if (!Number.isFinite(Number(waConfig.id))) {
        waConfig.id = 1;
        changed = true;
      }
      if (waConfig.webhook_url === void 0 || waConfig.webhook_url === null) {
        waConfig.webhook_url = waDefault.webhook_url;
        changed = true;
      }
      if (waConfig.webhook_token === void 0 || waConfig.webhook_token === null) {
        waConfig.webhook_token = waDefault.webhook_token;
        changed = true;
      }
      if (waConfig.app_url === void 0 || waConfig.app_url === null) {
        waConfig.app_url = waDefault.app_url;
        changed = true;
      }
      if (waConfig.aktif === void 0 || waConfig.aktif === null) {
        waConfig.aktif = waDefault.aktif;
        changed = true;
      }
      if (waConfig.updated_at === void 0) {
        waConfig.updated_at = null;
        changed = true;
      }
      if (waConfig.updated_by === void 0) {
        waConfig.updated_by = null;
        changed = true;
      }
    }
    if (!this.state.tax_settings) {
      this.state.tax_settings = buildDefaultTaxSettings();
      changed = true;
    }
    if (!Array.isArray(this.state.stok_cattoff) || this.state.stok_cattoff.length === 0) {
      this.state.stok_cattoff = buildDefaultStokCattoff();
      this.state.counters.stok_cattoff = this.state.stok_cattoff.length;
      changed = true;
    }
    if (!Array.isArray(this.state.tinta_warna) || this.state.tinta_warna.length === 0) {
      this.state.tinta_warna = buildDefaultTintaWarna();
      this.state.counters.tinta_warna = this.state.tinta_warna.length;
      changed = true;
    }
    for (const key of ["pemakaian_tinta", "cetak_grup", "cetak_grup_item"]) {
      if (!Array.isArray(this.state[key])) {
        this.state[key] = [];
        this.state.counters[key] = 0;
        changed = true;
      }
    }
    const defaultRates = buildDefaultInsentifRates();
    if (!Array.isArray(this.state.insentif_rates)) {
      this.state.insentif_rates = defaultRates;
      this.state.counters.insentif_rates = defaultRates.length;
      changed = true;
    } else {
      for (const def of defaultRates) {
        const existing = this.state.insentif_rates.find(
          (r) => r.role === def.role && r.jenis === def.jenis
        );
        if (!existing) {
          this.state.insentif_rates.push(def);
          changed = true;
          continue;
        }
        if (!Number.isFinite(Number(existing.nominal))) {
          existing.nominal = def.nominal;
          changed = true;
        } else {
          existing.nominal = round22(Number(existing.nominal));
        }
        if (existing.updated_at === void 0) {
          existing.updated_at = null;
          changed = true;
        }
        if (existing.updated_by === void 0) {
          existing.updated_by = null;
          changed = true;
        }
      }
    }
    const needsMasterSeed = !Array.isArray(this.state.machines) || this.state.machines.length === 0 || !Array.isArray(this.state.supplies) || this.state.supplies.length === 0 || !Array.isArray(this.state.suppliers) || this.state.suppliers.length === 0;
    const seed = needsMasterSeed ? createInitialSeed(false) : null;
    if (seed) {
      if (!Array.isArray(this.state.machines) || this.state.machines.length === 0) {
        this.state.machines = seed.machines;
        this.state.counters.machines = seed.machines.length;
        changed = true;
      }
      if (!Array.isArray(this.state.supplies) || this.state.supplies.length === 0) {
        this.state.supplies = seed.supplies;
        this.state.counters.supplies = seed.supplies.length;
        changed = true;
      }
      if (!Array.isArray(this.state.suppliers) || this.state.suppliers.length === 0) {
        this.state.suppliers = seed.suppliers;
        this.state.counters.suppliers = seed.suppliers.length;
        changed = true;
      }
      for (const p of seed.products.filter((sp) => sp.id >= 11)) {
        if (!this.state.products.some((existing) => existing.nama_produk === p.nama_produk)) {
          this.state.products.push(p);
          changed = true;
        }
      }
    }
    if (!Array.isArray(this.state.supply_usages)) {
      this.state.supply_usages = [];
      this.state.counters.supply_usages = 0;
      changed = true;
    }
    if (!Array.isArray(this.state.print_batches)) {
      this.state.print_batches = [];
      this.state.counters.print_batches = 0;
      changed = true;
    }
    for (const key of ["purchase_orders", "goods_receipts", "supplier_payments", "whatsapp_outbox"]) {
      if (!Array.isArray(this.state[key])) {
        this.state[key] = [];
        this.state.counters[key] = 0;
        changed = true;
      }
    }
    const resetPasswords = [];
    for (const u of this.state.users) {
      if (!u.password.startsWith("scrypt:")) {
        if (u.password === "password123") {
          const replacement = generateSeedPassword();
          resetPasswords.push({ email: u.email, password: replacement });
          u.password = hashPassword(replacement);
        } else {
          u.password = hashPassword(u.password);
        }
        changed = true;
      } else {
        let isDefault = false;
        try {
          isDefault = verifyPassword("password123", u.password);
        } catch {
          isDefault = false;
        }
        if (isDefault) {
          const replacement = generateSeedPassword();
          resetPasswords.push({ email: u.email, password: replacement });
          u.password = hashPassword(replacement);
          changed = true;
        }
      }
      if (typeof u.active !== "boolean") {
        u.active = true;
        changed = true;
      }
    }
    writePasswordResetReport(resetPasswords);
    for (const inst of this.state.instansis) {
      if (inst.npwp === void 0) {
        inst.npwp = null;
        inst.is_pkp = false;
        inst.ppn_persen = 0;
        inst.pph23_persen = 0;
        inst.tempo_hari = 0;
        inst.credit_limit = 0;
        inst.pajak_reklame_expired = null;
        changed = true;
      }
    }
    for (const p of this.state.products) {
      if (p.mesin_default_id === void 0) {
        const name = p.nama_produk.toLowerCase();
        p.mesin_default_id = p.kategori_produk === "meteran" ? 1 : name.includes("a3") ? 3 : null;
        changed = true;
      }
      if (p.satuan_hitung === void 0) {
        p.satuan_hitung = "pcs";
        changed = true;
      }
      if (p.klik_per_lembar === void 0) {
        p.klik_per_lembar = p.satuan_hitung === "klik" ? 2 : 1;
        changed = true;
      }
      if (p.ukuran_lembar === void 0) {
        p.ukuran_lembar = null;
        changed = true;
      }
    }
    this.state.counters.products = Math.max(
      this.state.counters.products ?? 0,
      ...this.state.products.map((p) => p.id)
    );
    for (const order of this.state.orders) {
      if (order.status_nota === void 0) {
        order.status_nota = "aktif";
        order.alasan_batal = null;
        order.diskon_persen = 0;
        order.diskon_nominal = 0;
        order.ppn_persen = 0;
        order.ppn_nominal = 0;
        order.pph23_persen = 0;
        order.pph23_nominal = 0;
        order.jatuh_tempo = null;
        order.approval_token = null;
        order.approval_status = "belum";
        order.approval_note = null;
        changed = true;
      }
      if (order.tanda_tangan_pengambil === void 0) {
        order.tanda_tangan_pengambil = null;
        changed = true;
      }
      if (order.kurir_nama === void 0) {
        order.kurir_nama = null;
        changed = true;
      }
      if (order.resi_pengiriman === void 0) {
        order.resi_pengiriman = null;
        changed = true;
      }
      if (order.biaya_desain === void 0) {
        order.biaya_desain = 0;
        changed = true;
      }
    }
    for (const item of this.state.order_items) {
      if (item.diskon_persen === void 0) {
        item.diskon_persen = 0;
        item.diskon_nominal = 0;
        item.harga_sebelum_diskon = item.subtotal;
        changed = true;
      }
      const product = this.state.products.find((p) => p.id === item.product_id);
      if (item.machine_id === void 0) {
        item.machine_id = product?.mesin_default_id ?? null;
        changed = true;
      }
      if (item.operator_id === void 0) {
        item.operator_id = null;
        item.waktu_mulai_cetak = null;
        item.waktu_selesai_cetak = null;
        changed = true;
      }
      if (item.finishing_user_id === void 0) {
        item.finishing_user_id = null;
        changed = true;
      }
      if (item.klik_total === void 0) {
        item.klik_total = null;
        item.estimasi_tinta_ml = null;
        item.batch_id = null;
        changed = true;
      }
      if (item.satuan_hitung === void 0) {
        item.satuan_hitung = product?.satuan_hitung ?? "pcs";
        item.klik_per_lembar = product?.klik_per_lembar ?? 1;
        item.ukuran_lembar = product?.ukuran_lembar ?? null;
        changed = true;
      }
      if (item.preflight_dpi_ok === void 0) {
        item.preflight_dpi_ok = null;
        item.preflight_cmyk_ok = null;
        item.preflight_bleed_ok = null;
        item.preflight_catatan = null;
        changed = true;
      }
    }
    for (const payment of this.state.order_payments) {
      if (payment.shift_id === void 0) {
        payment.shift_id = null;
        changed = true;
      }
    }
    for (const [key, value] of Object.entries(this.state)) {
      if (!Array.isArray(value)) continue;
      const rows = value;
      const maxId = rows.reduce(
        (max, row) => Math.max(max, Number.isFinite(Number(row?.id)) ? Number(row?.id) : 0),
        0
      );
      this.state.counters[key] = Math.max(this.state.counters[key] ?? 0, maxId);
    }
    if (changed) {
      this.persist();
    }
  }
  async init() {
    if (mysqlAdapter.isEnabled()) {
      this.state = await mysqlAdapter.initialize(() => createInitialSeed(true));
      this.migrateInMemory();
      console.log("Reffo PrintFlow terhubung ke MySQL localhost.");
    }
  }
  getState() {
    return this.state;
  }
  nextId(table) {
    const current = this.state.counters[table] ?? 0;
    const next = current + 1;
    this.state.counters[table] = next;
    return next;
  }
  persist() {
    if (mysqlAdapter.isEnabled()) {
      if (this.criticalDepth > 0) return;
      mysqlAdapter.queuePersist(this.state);
      return;
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs2.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), "utf-8");
    fs2.renameSync(tmpFile, DB_FILE);
  }
  /**
   * Jalankan mutasi stok/transaksi kritis dengan lock baris MySQL
   * (SELECT ... FOR UPDATE) dan persist CRUD per entitas dalam satu transaksi.
   * Bila gagal, state di memori dikembalikan ke snapshot sebelumnya.
   */
  async critical(tables, fn) {
    if (!mysqlAdapter.isEnabled()) {
      const snapshot2 = JSON.parse(JSON.stringify(this.state));
      try {
        return await fn();
      } catch (err) {
        this.state = snapshot2;
        throw err;
      }
    }
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this.criticalDepth += 1;
    try {
      return await mysqlAdapter.runLocked(() => this.state, tables, fn);
    } catch (err) {
      this.state = snapshot;
      throw err;
    } finally {
      this.criticalDepth -= 1;
    }
  }
  resetSeed() {
    backupDatabaseFile("pre-reset");
    this.state = createInitialSeed();
    this.persist();
  }
  hydrateItem(raw) {
    const product = this.state.products.find((p) => p.id === raw.product_id);
    const finishing = raw.finishing_id ? this.state.finishings.find((f) => f.id === raw.finishing_id) ?? null : null;
    const accAdmin = raw.acc_admin_id ? this.state.users.find((u) => u.id === raw.acc_admin_id) : null;
    const machine = raw.machine_id ? this.state.machines.find((m) => m.id === raw.machine_id) ?? null : null;
    const operator = raw.operator_id ? this.state.users.find((u) => u.id === raw.operator_id) : null;
    const finishingUser = raw.finishing_user_id ? this.state.users.find((u) => u.id === raw.finishing_user_id) : null;
    const isMeteran = product?.kategori_produk === "meteran";
    const ukuranKotor = isMeteran && raw.lebar_m && raw.tinggi_m ? computeUkuranKotor(raw.lebar_m, raw.tinggi_m, raw.qty, finishing) : null;
    let rekomendasiRoll = null;
    if (isMeteran && product?.nama_produk.toLowerCase().includes("stiker") && ukuranKotor) {
      if (ukuranKotor.lebar <= 1) rekomendasiRoll = "Stiker 1m";
      else if (ukuranKotor.lebar <= 1.5) rekomendasiRoll = "Stiker 1.5m";
    }
    return {
      ...raw,
      harga_sebelum_diskon: raw.harga_sebelum_diskon ?? raw.subtotal,
      diskon_persen: raw.diskon_persen ?? 0,
      diskon_nominal: raw.diskon_nominal ?? 0,
      product_name: product?.nama_produk ?? "Produk",
      product_category: product?.kategori_produk ?? "meteran",
      stok_pcs: product?.stok_pcs ?? null,
      finishing_name: finishing?.nama_finishing ?? null,
      ekstra_finishing: finishing ? {
        kiri_cm: finishing.ekstra_kiri_cm,
        kanan_cm: finishing.ekstra_kanan_cm,
        atas_cm: finishing.ekstra_atas_cm,
        bawah_cm: finishing.ekstra_bawah_cm
      } : void 0,
      ukuran_kotor: ukuranKotor,
      rekomendasi_roll: rekomendasiRoll,
      machine_name: machine?.nama_mesin ?? null,
      operator_name: operator?.name ?? null,
      finishing_user_name: finishingUser?.name ?? null,
      satuan_hitung: raw.satuan_hitung ?? product?.satuan_hitung ?? "pcs",
      klik_per_lembar: raw.klik_per_lembar ?? product?.klik_per_lembar ?? 1,
      ukuran_lembar: raw.ukuran_lembar ?? product?.ukuran_lembar ?? null,
      acc_admin_name: accAdmin?.name ?? null
    };
  }
  hydrateOrder(raw) {
    const customer = this.state.customers.find((c) => c.id === raw.customer_id);
    const admin = this.state.users.find((u) => u.id === raw.user_id);
    const designer = raw.designer_id ? this.state.users.find((u) => u.id === raw.designer_id) : null;
    const items = this.state.order_items.filter((i) => i.order_id === raw.id).map((i) => this.hydrateItem(i));
    const revisions = this.state.design_revisions.filter((r) => r.order_id === raw.id).sort((a, b) => b.revisi_ke - a.revisi_ke).map((r) => ({
      ...r,
      admin_name: r.admin_id ? this.state.users.find((u) => u.id === r.admin_id)?.name ?? null : null
    }));
    const spks = this.state.advertising_spks.filter((s) => s.order_id === raw.id).map((s) => ({
      ...s,
      no_nota: raw.no_nota,
      instansi: customer?.instansi ?? "Perorangan",
      nama_pelanggan: customer?.nama_pelanggan ?? "-",
      deadline: raw.deadline
    }));
    const payments = (this.state.order_payments ?? []).filter((p) => p.order_id === raw.id).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((p) => ({
      ...p,
      admin_name: this.state.users.find((u) => u.id === p.admin_id)?.name ?? "Admin"
    }));
    const statusNota = raw.status_nota ?? "aktif";
    return {
      ...raw,
      status_nota: statusNota,
      alasan_batal: raw.alasan_batal ?? null,
      diskon_persen: raw.diskon_persen ?? 0,
      diskon_nominal: raw.diskon_nominal ?? 0,
      ppn_persen: raw.ppn_persen ?? 0,
      ppn_nominal: raw.ppn_nominal ?? 0,
      pph23_persen: raw.pph23_persen ?? 0,
      pph23_nominal: raw.pph23_nominal ?? 0,
      jatuh_tempo: raw.jatuh_tempo ?? null,
      approval_token: raw.approval_token ?? null,
      approval_status: raw.approval_status ?? "belum",
      approval_note: raw.approval_note ?? null,
      tanda_tangan_pengambil: raw.tanda_tangan_pengambil ?? null,
      customer,
      admin_name: admin?.name ?? "Admin",
      designer_name: designer?.name ?? null,
      sisa_tagihan: statusNota === "batal" ? 0 : round22(Math.max(raw.total_tagihan - raw.jumlah_dp, 0)),
      items,
      design_revisions: revisions,
      advertising_spks: spks,
      payments
    };
  }
  generateNoNota() {
    const today = notaDateStr(0);
    const prefix = `INV-${today}-`;
    const matching = this.state.orders.filter((o) => o.no_nota.startsWith(prefix)).map((o) => parseInt(o.no_nota.slice(-4), 10) || 0);
    const maxSeq = matching.length > 0 ? Math.max(...matching) : 0;
    return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
  }
  isOrderSiapDiambil(order) {
    if (order.status_nota === "batal") return false;
    if (order.items.length === 0 || order.waktu_serah_terima !== null) return false;
    const hasReady = order.items.some((i) => i.status_produksi === "siap_diambil");
    const allFinishedOrReady = order.items.every(
      (i) => i.status_produksi === "siap_diambil" || i.status_produksi === "selesai"
    );
    return hasReady && allFinishedOrReady;
  }
  isOrderSelesai(order) {
    return order.status_nota !== "batal" && order.items.length > 0 && order.items.every((i) => i.status_produksi === "selesai");
  }
};
var store = new Store();

// server/security.ts
var MIN_SESSION_SECRET_LENGTH = 32;
var PLACEHOLDER_SECRETS = /* @__PURE__ */ new Set([
  "change-this-secret-in-production",
  "change-me",
  "secret",
  "password",
  "password123",
  "my_secret",
  "my-secret",
  "reffo"
]);
function isProduction(env) {
  return String(env.NODE_ENV ?? "").toLowerCase() === "production";
}
function filled(value) {
  return String(value ?? "").trim();
}
function validateSecurityEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = isProduction(env);
  const sessionSecret = filled(env.SESSION_SECRET);
  if (!sessionSecret) {
    (production ? errors : warnings).push(
      "SESSION_SECRET belum diisi. Di produksi server menolak berjalan tanpa secret acak."
    );
  } else if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    (production ? errors : warnings).push(
      `SESSION_SECRET terlalu pendek (${sessionSecret.length} karakter). Gunakan minimal ${MIN_SESSION_SECRET_LENGTH} karakter acak.`
    );
  } else if (PLACEHOLDER_SECRETS.has(sessionSecret.toLowerCase())) {
    (production ? errors : warnings).push(
      "SESSION_SECRET masih memakai nilai contoh. Ganti dengan string acak sebelum go-live."
    );
  }
  const waToken = filled(env.WHATSAPP_WEBHOOK_TOKEN);
  const bridgeToken = filled(env.WA_BRIDGE_TOKEN);
  if (!waToken) {
    (production ? errors : warnings).push(
      "WHATSAPP_WEBHOOK_TOKEN kosong. Bridge WhatsApp akan menolak start agar endpoint /send tidak terbuka."
    );
  }
  if (!bridgeToken) {
    (production ? errors : warnings).push(
      "WA_BRIDGE_TOKEN kosong. Isi token yang sama dengan WHATSAPP_WEBHOOK_TOKEN agar bridge aman."
    );
  }
  if (waToken && bridgeToken && waToken !== bridgeToken) {
    warnings.push(
      "WA_BRIDGE_TOKEN berbeda dengan WHATSAPP_WEBHOOK_TOKEN. Bridge memakai WA_BRIDGE_TOKEN; pastikan keduanya sama."
    );
  }
  const demoSwitch = String(env.ENABLE_DEMO_SWITCH ?? "false").trim().toLowerCase();
  if (production && demoSwitch !== "false") {
    errors.push(
      'ENABLE_DEMO_SWITCH harus "false" di produksi agar login cepat divisi tanpa kata sandi tidak aktif.'
    );
  }
  return { errors, warnings };
}
function assertSecurityEnv(env = process.env) {
  const { errors, warnings } = validateSecurityEnv(env);
  for (const warning of warnings) {
    console.warn(`[security] ${warning}`);
  }
  if (errors.length > 0) {
    throw new Error(
      `Konfigurasi keamanan belum aman untuk produksi:
- ${errors.join("\n- ")}
Perbaiki .env lalu jalankan ulang server.`
    );
  }
}

// server/uploads.ts
import path3 from "node:path";
function safeUploadFilename(value) {
  const name = path3.basename(value);
  if (!name || name === "." || name === "..") return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  return name;
}
function toPublicPreviewUrl(stored, token) {
  if (!stored) return null;
  if (!stored.startsWith("/uploads/")) return stored;
  const name = safeUploadFilename(stored.slice("/uploads/".length));
  return name ? `/api/public/approval/${encodeURIComponent(token)}/file/${encodeURIComponent(name)}` : null;
}

// server.ts
var PORT = Number(process.env.PORT ?? 3e3);
var SESSION_COOKIE = "reffo_session";
var UPLOADS_DIR = path4.resolve(process.cwd(), "uploads");
var MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 20));
var AUTO_CLEAN_TIFF_HARI = Math.max(1, Number(process.env.AUTO_CLEAN_TIFF_HARI ?? 90));
var PAJAK_REKLAME_HARI = Math.min(365, Math.max(0, Number(process.env.PAJAK_REKLAME_HARI ?? 30)));
if (!fs3.existsSync(UPLOADS_DIR)) {
  fs3.mkdirSync(UPLOADS_DIR, { recursive: true });
}
function demoSwitchEnabled() {
  return (process.env.ENABLE_DEMO_SWITCH ?? "false").trim().toLowerCase() === "true";
}
var ALLOWED_UPLOAD_EXTENSIONS = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".pdf",
  ".tif",
  ".tiff",
  ".ai",
  ".psd",
  ".cdr",
  ".zip",
  ".rar"
]);
var uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});
var upload = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path4.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype ?? "").toLowerCase();
    const mimeOk = mime === "" || mime.startsWith("image/") || [
      "application/pdf",
      "application/postscript",
      "application/illustrator",
      "application/photoshop",
      "application/zip",
      "application/x-zip-compressed",
      "application/x-rar-compressed",
      "application/vnd.rar",
      "application/octet-stream",
      "application/x-coreldraw",
      "application/vnd.corel-draw"
    ].includes(mime);
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext) || !mimeOk) {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    cb(null, true);
  }
});
var uploadPhoto = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path4.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype ?? "").toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext) || !mime.startsWith("image/")) {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    cb(null, true);
  }
});
var uploadBulkTiff = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    const ext = path4.extname(file.originalname).toLowerCase();
    if (ext !== ".tif" && ext !== ".tiff") {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    cb(null, true);
  }
});
function cleanupUploadedFiles(files) {
  for (const f of files ?? []) {
    if (!f?.path) continue;
    try {
      if (fs3.existsSync(f.path)) fs3.unlinkSync(f.path);
    } catch {
    }
  }
}
var sseClients = /* @__PURE__ */ new Set();
function broadcastEvent(type, detail = {}) {
  if (sseClients.size === 0) return;
  const payload = JSON.stringify({
    type,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ...detail
  });
  for (const client of sseClients) {
    try {
      client.write(`event: domain_update
data: ${payload}

`);
    } catch {
      sseClients.delete(client);
    }
  }
}
function sanitizeUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false };
}
function extractToken(req) {
  const authHeader = req.header("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = parseCookie(req.header("cookie"), SESSION_COOKIE);
  return cookieToken || null;
}
function getActiveUser(req) {
  const token = extractToken(req);
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const user = store.getState().users.find((u) => u.id === payload.uid) ?? null;
  if (!user || user.active === false) return null;
  return user;
}
function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
  );
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function requireAuth(roles) {
  return (req, res, next) => {
    const user = getActiveUser(req);
    if (!user) {
      res.status(401).json({ error: "Sesi tidak valid atau telah berakhir. Silakan masuk kembali." });
      return;
    }
    if (roles && !roles.includes(user.role)) {
      res.status(403).json({ error: `Akses ditolak untuk peran ${user.role}.` });
      return;
    }
    req.currentUser = user;
    next();
  };
}
function getCurrentUser(req) {
  return req.currentUser;
}
function clientIp(req) {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}
async function runTransactional(res, work, errorMessage) {
  const capture = { value: null };
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  res.status = ((code) => {
    capture.value = { status: code, body: capture.value?.body };
    return res;
  });
  res.json = ((body) => {
    capture.value = { status: capture.value?.status ?? 200, body };
    return res;
  });
  try {
    await work();
  } catch (err) {
    console.error("[transaction]", err);
    res.status = originalStatus;
    res.json = originalJson;
    if (!res.headersSent) {
      originalStatus(500).json({ error: errorMessage });
    }
    return;
  }
  res.status = originalStatus;
  res.json = originalJson;
  if (capture.value) {
    originalStatus(capture.value.status).json(capture.value.body);
  }
}
function recordAudit(user, action, entity, entityId, detail, ip = null) {
  const db = store.getState();
  const log = {
    id: store.nextId("audit_logs"),
    user_id: user?.id ?? 0,
    user_name: user?.name ?? "Publik/Sistem",
    role: user?.role ?? "admin",
    action,
    entity,
    entity_id: entityId,
    detail,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    ip
  };
  db.audit_logs.push(log);
  if (db.audit_logs.length > 5e3) {
    db.audit_logs.splice(0, db.audit_logs.length - 5e3);
  }
  return log;
}
function auditRequest(req, action, entity, entityId, detail) {
  const current = req.currentUser ?? null;
  return recordAudit(current, action, entity, entityId, detail, clientIp(req));
}
function getWaConfig() {
  const config = store.getState().whatsapp_gateway_config;
  const fallbackUrl = String(process.env.WHATSAPP_WEBHOOK_URL ?? "").trim();
  const rawUrl = config?.webhook_url ?? fallbackUrl;
  return {
    url: String(rawUrl).trim().replace(/\/+$/, ""),
    token: String(config?.webhook_token ?? process.env.WHATSAPP_WEBHOOK_TOKEN ?? "").trim(),
    appUrl: String(config?.app_url ?? process.env.APP_URL ?? `http://localhost:${PORT}`).trim().replace(/\/+$/, ""),
    aktif: config?.aktif ?? Boolean(rawUrl)
  };
}
function appBaseUrl() {
  return getWaConfig().appUrl;
}
function normalizeGatewayUrl(value, label) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Protokol harus http atau https.");
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`${label} harus berupa URL http/https yang valid.`);
  }
}
function normalizeWaNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}
function enqueueWa(event, dedupeKey, noWa, pesan, orderId = null, link = null, mediaPath = null) {
  const db = store.getState();
  const nomor = normalizeWaNumber(noWa);
  if (!nomor || db.whatsapp_outbox.some((w) => w.dedupe_key === dedupeKey)) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const waConfig = getWaConfig();
  const row = {
    id: store.nextId("whatsapp_outbox"),
    event,
    dedupe_key: dedupeKey,
    order_id: orderId,
    no_wa: nomor,
    pesan,
    link,
    media_path: mediaPath,
    status: "pending",
    attempts: 0,
    last_error: waConfig.aktif && waConfig.url ? null : "Gateway WhatsApp belum dikonfigurasi atau dinonaktifkan.",
    next_attempt_at: null,
    created_at: now,
    updated_at: now,
    sent_at: null
  };
  db.whatsapp_outbox.push(row);
  store.persist();
  broadcastEvent("whatsapp_outbox_updated", { orderId });
  return row;
}
function enqueueSiapDiambil(orderId) {
  const db = store.getState();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order || !store.isOrderSiapDiambil(store.hydrateOrder(order))) return;
  const customer = db.customers.find((c) => c.id === order.customer_id);
  enqueueWa(
    "siap_diambil",
    `siap_diambil:${order.id}`,
    customer?.no_wa ?? "",
    `Nota ${order.no_nota} sudah siap diambil. Silakan datang ke Reffo PrintFlow.`,
    order.id,
    `${appBaseUrl()}/?nota=${order.no_nota}`
  );
}
var waWorkerRunning = false;
async function deliverWaOutbox() {
  if (waWorkerRunning) return;
  waWorkerRunning = true;
  try {
    const db = store.getState();
    const now = Date.now();
    const pending = db.whatsapp_outbox.filter(
      (w) => w.status === "pending" && (!w.next_attempt_at || new Date(w.next_attempt_at).getTime() <= now)
    );
    if (pending.length === 0) return;
    const waConfig = getWaConfig();
    let changed = false;
    for (const w of pending) {
      if (!waConfig.aktif || !waConfig.url) {
        const error = "Gateway WhatsApp belum dikonfigurasi atau dinonaktifkan.";
        if (w.last_error !== error) {
          w.last_error = error;
          w.updated_at = (/* @__PURE__ */ new Date()).toISOString();
          changed = true;
        }
        continue;
      }
      try {
        const response = await fetch(waConfig.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...waConfig.token ? { Authorization: `Bearer ${waConfig.token}` } : {}
          },
          body: JSON.stringify({
            event: w.event,
            to: w.no_wa,
            message: w.pesan,
            link: w.link,
            media_path: w.media_path ?? null,
            dedupe_key: w.dedupe_key
          })
        });
        if (!response.ok) throw new Error(`Gateway menjawab HTTP ${response.status}`);
        w.status = "terkirim";
        w.sent_at = (/* @__PURE__ */ new Date()).toISOString();
        w.last_error = null;
        w.next_attempt_at = null;
        changed = true;
      } catch (err) {
        w.attempts = (w.attempts ?? 0) + 1;
        w.last_error = err instanceof Error ? err.message : String(err);
        w.status = w.attempts >= 3 ? "gagal" : "pending";
        w.next_attempt_at = new Date(Date.now() + w.attempts * 6e4).toISOString();
        changed = true;
      }
      w.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (changed) {
      store.persist();
      broadcastEvent("whatsapp_outbox_updated");
    }
  } finally {
    waWorkerRunning = false;
  }
}
function hapusTiffLama(hari, pelaku, keringanan) {
  const db = store.getState();
  const batas = Date.now() - Math.max(1, hari) * 864e5;
  const hasil = [];
  const sudahDihapus = /* @__PURE__ */ new Set();
  let berubah = false;
  for (const item of db.order_items) {
    if (!item.file_cetak_tiff || item.status_produksi !== "selesai") continue;
    const order = db.orders.find((o) => o.id === item.order_id);
    if (!order || !activeOrderRaw(order) || !order.waktu_serah_terima) continue;
    if (new Date(order.waktu_serah_terima).getTime() > batas) continue;
    const namaFile = path4.basename(item.file_cetak_tiff);
    const target = path4.join(UPLOADS_DIR, namaFile);
    let aman = false;
    try {
      aman = fs3.statSync(target).isFile();
    } catch {
      aman = false;
    }
    const alasan = !namaFile || namaFile.startsWith(".") ? "Nama file TIFF tidak valid." : !aman ? "File tidak ditemukan di folder uploads/." : sudahDihapus.has(namaFile) ? "File sudah dihapus dari entri sebelumnya." : null;
    let dihapus = false;
    if (!keringanan && aman && !alasan) {
      fs3.unlinkSync(target);
      sudahDihapus.add(namaFile);
      item.file_cetak_tiff = null;
      item.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      recordAudit(pelaku, "auto_clean_tiff", "order_item", item.id, `TIFF lama dihapus: ${namaFile} (${order.no_nota})`);
      dihapus = true;
      berubah = true;
    }
    hasil.push({
      order_id: order.id,
      item_id: item.id,
      no_nota: order.no_nota,
      file: namaFile,
      dihapus,
      alasan
    });
  }
  if (berubah) {
    store.persist();
    broadcastEvent("maintenance_updated");
  }
  return hasil;
}
function clampPercent2(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(round22(num), 0), 100);
}
function generateApprovalToken() {
  return crypto3.randomBytes(18).toString("hex");
}
function getOpenShiftFor(kasirId) {
  const db = store.getState();
  return db.shifts.find((s) => s.kasir_id === kasirId && s.status === "buka") ?? null;
}
function ensureAdminOpenShift(user, ip) {
  if (user.role !== "admin") return null;
  const existing = getOpenShiftFor(user.id);
  if (existing) return existing;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const shift = {
    id: store.nextId("shifts"),
    kasir_id: user.id,
    opened_at: now,
    closed_at: null,
    opening_cash: 0,
    expected_tunai: 0,
    expected_transfer: 0,
    expected_qris: 0,
    actual_tunai: 0,
    actual_transfer: 0,
    actual_qris: 0,
    selisih: 0,
    catatan: "Dibuka otomatis saat login admin",
    status: "buka"
  };
  store.getState().shifts.push(shift);
  recordAudit(user, "shift_auto_open", "shift", shift.id, "Shift dibuka otomatis saat Admin login", ip);
  broadcastEvent("shift_updated", { shiftId: shift.id });
  return shift;
}
function computeShiftExpectation(shift) {
  const db = store.getState();
  const payments = db.order_payments.filter((p) => p.shift_id === shift.id);
  const tunai = round22(
    shift.opening_cash + payments.filter((p) => p.metode === "Tunai").reduce((s, p) => s + p.nominal, 0)
  );
  const transfer = round22(
    payments.filter((p) => p.metode === "Transfer").reduce((s, p) => s + p.nominal, 0)
  );
  const qris = round22(
    payments.filter((p) => p.metode === "QRIS").reduce((s, p) => s + p.nominal, 0)
  );
  return { tunai, transfer, qris };
}
function hydrateShift(shift) {
  const kasir = store.getState().users.find((u) => u.id === shift.kasir_id);
  return { ...shift, kasir_name: kasir?.name ?? "Kasir" };
}
function activeOrderRaw(order) {
  return (order.status_nota ?? "aktif") !== "batal";
}
function tanggalQuery(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
function dalamRentang(iso, dari, sampai) {
  const tanggal = String(iso ?? "").slice(0, 10);
  return (!dari || tanggal >= dari) && (!sampai || tanggal <= sampai);
}
var STATUS_ITEM_SELESAI = {
  desainer: /* @__PURE__ */ new Set(["antrean_cetak", "proses_cetak", "antrean_finishing", "proses_finishing", "siap_diambil", "selesai"]),
  operator_cetak: /* @__PURE__ */ new Set(["antrean_finishing", "proses_finishing", "siap_diambil", "selesai"]),
  finishing: /* @__PURE__ */ new Set(["siap_diambil", "selesai"])
};
function hitungInsentif(db, dari, sampai) {
  const rates = Array.isArray(db.insentif_rates) ? db.insentif_rates : [];
  const tarif = (role, jenis) => Number(rates.find((r) => r.role === role && r.jenis === jenis)?.nominal ?? 0);
  const staf = db.users.filter((u) => u.active !== false && INSENTIF_ROLES.includes(u.role)).map((u) => {
    const role = u.role;
    return {
      user_id: u.id,
      nama: u.name,
      role,
      total_item: 0,
      item_selesai: 0,
      job_selesai: 0,
      tarif_item: round22(tarif(role, "per_item")),
      tarif_job: round22(tarif(role, "per_job")),
      insentif_item: 0,
      insentif_job: 0,
      total_insentif: 0
    };
  });
  const stafMap = new Map(staf.map((row) => [row.user_id, row]));
  const selesaiPerStaf = /* @__PURE__ */ new Map();
  for (const raw of db.orders) {
    if (!activeOrderRaw(raw) || !dalamRentang(raw.created_at, dari, sampai)) continue;
    const order = store.hydrateOrder(raw);
    for (const item of order.items) {
      for (const row of staf) {
        const ditugaskan = row.role === "desainer" ? order.designer_id === row.user_id : row.role === "operator_cetak" ? item.operator_id === row.user_id : item.finishing_user_id === row.user_id;
        if (!ditugaskan) continue;
        row.total_item += 1;
        if (!STATUS_ITEM_SELESAI[row.role].has(item.status_produksi)) continue;
        row.item_selesai += 1;
        if (!selesaiPerStaf.has(row.user_id)) selesaiPerStaf.set(row.user_id, /* @__PURE__ */ new Set());
        selesaiPerStaf.get(row.user_id).add(order.id);
      }
    }
  }
  for (const row of staf) {
    row.job_selesai = selesaiPerStaf.get(row.user_id)?.size ?? 0;
    row.insentif_item = round22(row.item_selesai * row.tarif_item);
    row.insentif_job = round22(row.job_selesai * row.tarif_job);
    row.total_insentif = round22(row.insentif_item + row.insentif_job);
  }
  staf.sort((a, b) => b.total_insentif - a.total_insentif || a.nama.localeCompare(b.nama));
  return {
    dari,
    sampai,
    rates,
    staf,
    ringkasan: {
      jumlah_staf: stafMap.size,
      total_item: round22(staf.reduce((s, row) => s + row.total_item, 0)),
      total_item_selesai: round22(staf.reduce((s, row) => s + row.item_selesai, 0)),
      total_job_selesai: round22(staf.reduce((s, row) => s + row.job_selesai, 0)),
      total_insentif: round22(staf.reduce((s, row) => s + row.total_insentif, 0))
    }
  };
}
function parseTanggalIso(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const tahun = Number(match[1]);
  const bulan = Number(match[2]);
  const tanggal = Number(match[3]);
  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;
  const cek = new Date(Date.UTC(tahun, bulan - 1, tanggal));
  if (cek.getUTCFullYear() !== tahun || cek.getUTCMonth() !== bulan - 1 || cek.getUTCDate() !== tanggal) {
    return null;
  }
  return { tahun, bulan, tanggal };
}
function jatuhTempoReklameBerikutnya(expired, sekarang = /* @__PURE__ */ new Date()) {
  const parsed = parseTanggalIso(expired);
  if (!parsed) return null;
  const hariIniUtc = Date.UTC(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate());
  const akhirBulan = (tahun2) => new Date(Date.UTC(tahun2, parsed.bulan, 0)).getUTCDate();
  const buatUtc = (tahun2) => Date.UTC(tahun2, parsed.bulan - 1, Math.min(parsed.tanggal, akhirBulan(tahun2)));
  let tahun = parsed.tahun;
  let tempoUtc = buatUtc(tahun);
  if (tempoUtc < hariIniUtc) {
    tahun += 1;
    tempoUtc = buatUtc(tahun);
  }
  return {
    jatuh_tempo: new Date(tempoUtc).toISOString().slice(0, 10),
    tahun,
    hari_tersisa: Math.round((tempoUtc - hariIniUtc) / 864e5)
  };
}
function hitungPajakReklame(db, hari, sekarang = /* @__PURE__ */ new Date()) {
  const semua = [];
  for (const inst of db.instansis) {
    const tempo = jatuhTempoReklameBerikutnya(inst.pajak_reklame_expired, sekarang);
    if (!tempo) continue;
    const pelanggan = db.customers.find(
      (c) => c.instansi_id === inst.id && normalizeWaNumber(c.no_wa)
    );
    semua.push({
      instansi_id: inst.id,
      nama_instansi: inst.nama_instansi,
      pajak_reklame_expired: inst.pajak_reklame_expired ?? null,
      jatuh_tempo_berikutnya: tempo.jatuh_tempo,
      tahun: tempo.tahun,
      hari_tersisa: tempo.hari_tersisa,
      no_wa: pelanggan?.no_wa ?? "",
      nama_pelanggan: pelanggan?.nama_pelanggan ?? null
    });
  }
  semua.sort((a, b) => a.hari_tersisa - b.hari_tersisa || a.nama_instansi.localeCompare(b.nama_instansi));
  return { semua, items: semua.filter((row) => row.hari_tersisa <= hari) };
}
function hitungProfitabilitas(db, dari, sampai) {
  const produkMap = /* @__PURE__ */ new Map();
  const klienMap = /* @__PURE__ */ new Map();
  let jumlahNota = 0;
  for (const raw of db.orders) {
    if (!activeOrderRaw(raw) || !dalamRentang(raw.created_at, dari, sampai)) continue;
    const order = store.hydrateOrder(raw);
    jumlahNota += 1;
    const instansiId = order.customer?.instansi_id ?? 0;
    const namaInstansi = order.customer?.instansi ?? "Perorangan";
    if (!klienMap.has(instansiId)) {
      klienMap.set(instansiId, {
        instansi_id: instansiId,
        instansi: namaInstansi,
        jumlah_nota: 0,
        jumlah_item: 0,
        omzet: 0,
        hpp: 0,
        laba_kotor: 0,
        margin_persen: 0,
        total_tagihan: 0,
        piutang: 0
      });
    }
    const klien = klienMap.get(instansiId);
    klien.jumlah_nota += 1;
    klien.total_tagihan = round22(klien.total_tagihan + order.total_tagihan);
    klien.piutang = round22(klien.piutang + order.sisa_tagihan);
    for (const item of order.items) {
      const product = db.products.find((p) => p.id === item.product_id);
      const qtyBasis = product?.kategori_produk === "meteran" ? Number(item.luas_tagihan_m2 ?? 0) : Number(item.qty ?? 0);
      const hpp2 = round22(qtyBasis * Number(product?.harga_modal ?? 0));
      const productId = product?.id ?? item.product_id;
      if (!produkMap.has(productId)) {
        produkMap.set(productId, {
          product_id: productId,
          nama_produk: product?.nama_produk ?? item.nama_item ?? `Produk #${productId}`,
          kategori_produk: product?.kategori_produk ?? "-",
          jumlah_item: 0,
          qty: 0,
          omzet: 0,
          hpp: 0,
          laba_kotor: 0,
          margin_persen: 0
        });
      }
      const produk = produkMap.get(productId);
      produk.jumlah_item += 1;
      produk.qty = round22(produk.qty + qtyBasis);
      produk.omzet = round22(produk.omzet + item.subtotal);
      produk.hpp = round22(produk.hpp + hpp2);
      klien.jumlah_item += 1;
      klien.omzet = round22(klien.omzet + item.subtotal);
      klien.hpp = round22(klien.hpp + hpp2);
    }
  }
  const finalisasi = (row) => {
    row.laba_kotor = round22(row.omzet - row.hpp);
    row.margin_persen = row.omzet > 0 ? round22(row.laba_kotor / row.omzet * 100) : 0;
    return row;
  };
  const perProduk = Array.from(produkMap.values()).map(finalisasi).sort((a, b) => b.laba_kotor - a.laba_kotor || a.nama_produk.localeCompare(b.nama_produk));
  const perKlien = Array.from(klienMap.values()).map(finalisasi).sort((a, b) => b.laba_kotor - a.laba_kotor || a.instansi.localeCompare(b.instansi));
  const omzet = round22(perProduk.reduce((s, row) => s + row.omzet, 0));
  const hpp = round22(perProduk.reduce((s, row) => s + row.hpp, 0));
  const labaKotor = round22(omzet - hpp);
  return {
    dari,
    sampai,
    ringkasan: {
      jumlah_nota: jumlahNota,
      jumlah_item: perProduk.reduce((s, row) => s + row.jumlah_item, 0),
      omzet,
      hpp,
      laba_kotor: labaKotor,
      margin_persen: omzet > 0 ? round22(labaKotor / omzet * 100) : 0
    },
    per_produk: perProduk,
    per_klien: perKlien
  };
}
var A3_PLUS_AREA_M2 = 0.159;
function selectInkSupply(db, machine) {
  const inks = db.supplies.filter((s) => s.aktif && s.kategori === "tinta" && s.stok > 0);
  if (inks.length === 0) return null;
  const keyword = machine?.jenis === "digital_a3p" ? "a3p" : machine?.jenis === "uv" ? "uv" : machine?.jenis === "large_format" ? "solvent" : "";
  const preferred = keyword ? inks.find((s) => `${s.kode} ${s.nama}`.toLowerCase().includes(keyword)) : null;
  return preferred ?? inks[0] ?? null;
}
function computeBatchNesting(items, rollWidth) {
  const widths = [];
  const pulls = [];
  for (const item of items) {
    const kotor = item.ukuran_kotor;
    if (!kotor) continue;
    widths.push(round22(kotor.lebar));
    pulls.push(round22(kotor.tinggi * item.qty));
  }
  const lebarGabungan = round22(widths.reduce((a, b) => a + b, 0));
  const panjangTarik = round22(Math.max(0, ...pulls));
  const luasTerpakai = round22(
    items.reduce((acc, item) => acc + (item.ukuran_kotor?.luas ?? 0) * item.qty, 0)
  );
  const lebarSisa = rollWidth === null ? null : round22(Math.max(rollWidth - lebarGabungan, 0));
  const luasWaste = lebarSisa === null ? 0 : round22(lebarSisa * panjangTarik);
  const penghematanPanjang = round22(pulls.reduce((a, b) => a + b, 0) - panjangTarik);
  return {
    lebar_gabungan_m: lebarGabungan,
    panjang_tarik_m: panjangTarik,
    luas_terpakai_m2: luasTerpakai,
    luas_waste_m2: luasWaste,
    penghematan_panjang_m: penghematanPanjang,
    penghematan_luas_m2: round22(penghematanPanjang * lebarGabungan),
    lebar_sisa_m: lebarSisa
  };
}
function csvEscape(value) {
  const text = value === null || value === void 0 ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n");
}
function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.param(["id", "orderId", "itemId"], (_req, res, next, val) => {
    if (!parsePositiveId(val)) {
      res.status(422).json({ error: "Parameter ID harus berupa bilangan bulat positif." });
      return;
    }
    next();
  });
  app.get("/api/public/approval/:token/file/:filename", (req, res) => {
    const token = String(req.params.token ?? "").trim();
    const name = safeUploadFilename(String(req.params.filename ?? ""));
    const db = store.getState();
    const order = db.orders.find((row) => row.approval_token && row.approval_token === token);
    if (!order || !name) {
      res.status(404).json({ error: "File tidak ditemukan." });
      return;
    }
    const allowed = /* @__PURE__ */ new Set();
    const add = (stored) => {
      if (stored?.startsWith("/uploads/")) {
        const base = safeUploadFilename(stored.slice("/uploads/".length));
        if (base) allowed.add(base);
      }
    };
    add(order.lampiran_briefing);
    for (const item of db.order_items.filter((row) => row.order_id === order.id)) {
      add(item.file_preview_acc);
    }
    for (const revision of db.design_revisions.filter((row) => row.order_id === order.id)) {
      add(revision.file_preview);
    }
    for (const payment of db.order_payments.filter((row) => row.order_id === order.id)) {
      add(payment.bukti_bayar);
    }
    if (!allowed.has(name)) {
      res.status(404).json({ error: "File bukan milik nota ini." });
      return;
    }
    res.sendFile(path4.join(UPLOADS_DIR, name), {
      headers: { "Cache-Control": "private, max-age=300" }
    });
  });
  app.use(
    "/uploads",
    requireAuth(),
    express.static(UPLOADS_DIR, { index: false, dotfiles: "deny", fallthrough: true })
  );
  app.get("/api/auth/accounts", (_req, res) => {
    const accounts = demoSwitchEnabled() ? store.getState().users.filter((u) => u.active !== false).map(sanitizeUser) : [];
    res.json({ accounts, demo_switch_enabled: demoSwitchEnabled() });
  });
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = store.getState().users.find(
      (u) => u.email.toLowerCase() === (email ?? "").trim().toLowerCase()
    );
    if (!user || !verifyPassword(password ?? "", user.password)) {
      res.status(401).json({ error: "Email atau kata sandi tidak sesuai." });
      return;
    }
    if (user.active === false) {
      res.status(403).json({ error: "Akun staf ini sudah dinonaktifkan. Hubungi Owner." });
      return;
    }
    const token = signSessionToken(user.id, user.role);
    setSessionCookie(res, token);
    const activeShift = ensureAdminOpenShift(user, clientIp(req));
    recordAudit(user, "login", "auth", user.id, `Login berhasil sebagai ${user.role}`, clientIp(req));
    store.persist();
    res.json({ user: sanitizeUser(user), token, shift: activeShift ? hydrateShift(activeShift) : null });
  });
  app.post("/api/auth/switch", (req, res) => {
    if (!demoSwitchEnabled()) {
      res.status(403).json({
        error: "Demo switch dinonaktifkan pada mode produksi. Silakan login dengan email dan kata sandi."
      });
      return;
    }
    const { userId } = req.body;
    const user = store.getState().users.find((u) => u.id === Number(userId));
    if (!user) {
      res.status(404).json({ error: "Akun divisi tidak ditemukan." });
      return;
    }
    if (user.active === false) {
      res.status(403).json({ error: "Akun staf ini sudah dinonaktifkan." });
      return;
    }
    const token = signSessionToken(user.id, user.role);
    setSessionCookie(res, token);
    const activeShift = ensureAdminOpenShift(user, clientIp(req));
    recordAudit(user, "login_switch", "auth", user.id, "Login via demo switch", clientIp(req));
    store.persist();
    res.json({ user: sanitizeUser(user), token, shift: activeShift ? hydrateShift(activeShift) : null });
  });
  app.post("/api/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });
  app.get("/api/events", requireAuth(), (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`event: connected
data: ${JSON.stringify({ ok: true })}

`);
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25e3);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });
  app.get("/api/bootstrap", requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const shifts = user.role === "owner" ? [...db.shifts].sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()).slice(0, 60).map(hydrateShift) : user.role === "admin" ? db.shifts.filter((s) => s.kasir_id === user.id).sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()).slice(0, 20).map(hydrateShift) : [];
    res.json({
      user: sanitizeUser(user),
      products: db.products,
      finishings: db.finishings,
      instansis: db.instansis,
      customers: db.customers,
      rolls: db.material_rolls,
      offcuts: db.material_offcuts,
      cattoffs: db.stok_cattoff ?? [],
      tinta_warna: db.tinta_warna ?? [],
      machines: db.machines ?? [],
      supplies: db.supplies ?? [],
      demo_switch_enabled: demoSwitchEnabled(),
      shifts,
      tax_settings: db.tax_settings ?? buildDefaultTaxSettings()
    });
  });
  app.get("/api/badges", requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const activeOrders = db.orders.filter(activeOrderRaw);
    const activeOrderIds = new Set(activeOrders.map((o) => o.id));
    const designStatuses = /* @__PURE__ */ new Set([
      "menunggu_desain",
      "proses_desain",
      "menunggu_acc",
      "revisi"
    ]);
    const printStatuses = /* @__PURE__ */ new Set([
      "antrean_cetak",
      "siap_tata",
      "proses_cetak",
      "gagal_cetak",
      "cetak_ulang"
    ]);
    const adminReviews = activeOrders.filter(
      (o) => db.order_items.some(
        (i) => i.order_id === o.id && i.status_produksi === "menunggu_acc" && !i.acc_admin_id
      )
    ).length;
    const desainerQueue = activeOrders.filter(
      (o) => db.order_items.some((i) => i.order_id === o.id && designStatuses.has(i.status_produksi))
    ).length;
    const operatorQueue = db.order_items.filter(
      (i) => activeOrderIds.has(i.order_id) && printStatuses.has(i.status_produksi)
    ).length;
    const finishingQueue = db.order_items.filter(
      (i) => activeOrderIds.has(i.order_id) && (i.status_produksi === "antrean_finishing" || i.status_produksi === "proses_finishing")
    ).length;
    const advertisingSpk = db.advertising_spks.filter((s) => s.status_lapangan !== "selesai").length;
    const serahTerima = activeOrders.map((o) => store.hydrateOrder(o)).filter((o) => store.isOrderSiapDiambil(o)).length;
    res.json({
      badges: {
        admin_reviews: adminReviews,
        desainer_queue: desainerQueue,
        operator_queue: operatorQueue,
        finishing_queue: finishingQueue,
        advertising_spk: advertisingSpk,
        serah_terima: serahTerima
      },
      shift_aktif: user.role === "admin" ? Boolean(getOpenShiftFor(user.id)) : false
    });
  });
  app.get("/api/settings/tax", requireAuth(), (_req, res) => {
    const db = store.getState();
    res.json({ tax_settings: db.tax_settings ?? buildDefaultTaxSettings() });
  });
  app.put("/api/owner/settings/tax", requireAuth(["owner"]), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const body = req.body ?? {};
    const current = db.tax_settings ?? buildDefaultTaxSettings();
    const mode = body.mode_harga === "sudah_termasuk_ppn" ? "sudah_termasuk_ppn" : "belum_termasuk_ppn";
    const next = {
      id: 1,
      ppn_persen_default: clampPercent2(body.ppn_persen_default ?? current.ppn_persen_default),
      pph23_persen_default: clampPercent2(body.pph23_persen_default ?? current.pph23_persen_default),
      mode_harga: mode,
      ppn_termasuk_diskon: body.ppn_termasuk_diskon !== void 0 ? Boolean(body.ppn_termasuk_diskon) : current.ppn_termasuk_diskon,
      potong_pph23_otomatis: body.potong_pph23_otomatis !== void 0 ? Boolean(body.potong_pph23_otomatis) : current.potong_pph23_otomatis,
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_by: user.id
    };
    db.tax_settings = next;
    auditRequest(
      req,
      "tax_settings_update",
      "settings",
      1,
      `Pengaturan pajak diperbarui: PPN ${next.ppn_persen_default}%, PPh23 ${next.pph23_persen_default}%, mode ${next.mode_harga}.`
    );
    store.persist();
    broadcastEvent("settings_updated");
    res.json({ tax_settings: next });
  });
  app.post("/api/ai/parse-order", requireAuth(["admin"]), async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
      res.status(400).json({ error: "Teks pesan order tidak boleh kosong." });
      return;
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: "GEMINI_API_KEY belum dikonfigurasi pada Secrets panel untuk fitur ekstrak otomatis."
      });
      return;
    }
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } }
      });
      const db = store.getState();
      const productList = db.products.map((p) => `${p.id}:${p.nama_produk}(${p.kategori_produk})`).join(", ");
      const finishingList = db.finishings.map((f) => `${f.id}:${f.nama_finishing}`).join(", ");
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Ekstrak data order percetakan dari pesan pelanggan berikut ke dalam JSON terstruktur.
Daftar Produk (id:nama): ${productList}
Daftar Finishing (id:nama): ${finishingList}

Pesan Pelanggan:
${text}`,
        config: {
          systemInstruction: 'Anda adalah asisten parsing order percetakan Indonesia. Cocokkan nama produk dan finishing ke ID yang paling mendekati. Ukuran selalu dalam meter (misal 300x100cm = 3.0 x 1.0 m). Jika kategori pelanggan tidak disebut, gunakan "umum".',
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              instansi: { type: Type.STRING, description: "Nama instansi/perusahaan atau Perorangan" },
              nama_pelanggan: { type: Type.STRING },
              no_wa: { type: Type.STRING },
              kategori: { type: Type.STRING, description: "umum | reseller | prioritas | pegawai" },
              catatan_desain: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nama_item: { type: Type.STRING },
                    product_id: { type: Type.INTEGER },
                    finishing_id: { type: Type.INTEGER, nullable: true },
                    lebar_m: { type: Type.NUMBER, nullable: true },
                    tinggi_m: { type: Type.NUMBER, nullable: true },
                    qty: { type: Type.INTEGER }
                  }
                }
              }
            }
          }
        }
      });
      const parsed = JSON.parse((response.text ?? "{}").trim());
      res.json({ parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal memproses pesan dengan Gemini AI.";
      res.status(502).json({ error: msg });
    }
  });
  app.post("/api/instansis", requireAuth(["admin", "owner"]), (req, res) => {
    const body = req.body;
    const nama = String(body.nama_instansi ?? "").trim();
    if (!nama) {
      res.status(400).json({ error: "Nama instansi wajib diisi." });
      return;
    }
    const db = store.getState();
    const existing = db.instansis.find(
      (i) => i.nama_instansi.toLowerCase() === nama.toLowerCase()
    );
    if (existing) {
      res.json({ instansi: existing });
      return;
    }
    const instansi = {
      id: store.nextId("instansis"),
      nama_instansi: nama,
      npwp: body.npwp?.trim() || null,
      is_pkp: Boolean(body.is_pkp),
      ppn_persen: clampPercent2(body.ppn_persen),
      pph23_persen: clampPercent2(body.pph23_persen),
      tempo_hari: Math.max(0, Math.floor(Number(body.tempo_hari ?? 0)) || 0),
      credit_limit: Math.max(0, round22(Number(body.credit_limit ?? 0))),
      pajak_reklame_expired: body.pajak_reklame_expired || null
    };
    db.instansis.push(instansi);
    auditRequest(req, "instansi_create", "instansi", instansi.id, `Instansi ${instansi.nama_instansi} dibuat`);
    store.persist();
    res.status(201).json({ instansi });
  });
  app.put("/api/instansis/:id", requireAuth(["admin", "owner"]), (req, res) => {
    const body = req.body;
    const db = store.getState();
    const instansi = db.instansis.find((i) => i.id === Number(req.params.id));
    if (!instansi) {
      res.status(404).json({ error: "Instansi tidak ditemukan." });
      return;
    }
    if (body.nama_instansi !== void 0) {
      const nama = body.nama_instansi.trim();
      if (!nama) {
        res.status(422).json({ error: "Nama instansi tidak boleh kosong." });
        return;
      }
      instansi.nama_instansi = nama;
    }
    if (body.npwp !== void 0) instansi.npwp = body.npwp?.trim() || null;
    if (body.is_pkp !== void 0) instansi.is_pkp = Boolean(body.is_pkp);
    if (body.ppn_persen !== void 0) instansi.ppn_persen = clampPercent2(body.ppn_persen);
    if (body.pph23_persen !== void 0) instansi.pph23_persen = clampPercent2(body.pph23_persen);
    if (body.tempo_hari !== void 0) {
      instansi.tempo_hari = Math.max(0, Math.floor(Number(body.tempo_hari) || 0));
    }
    if (body.credit_limit !== void 0) {
      instansi.credit_limit = Math.max(0, round22(Number(body.credit_limit) || 0));
    }
    if (body.pajak_reklame_expired !== void 0) {
      instansi.pajak_reklame_expired = body.pajak_reklame_expired || null;
    }
    auditRequest(req, "instansi_update", "instansi", instansi.id, `Data pajak/kredit ${instansi.nama_instansi} diperbarui`);
    store.persist();
    res.json({ instansi });
  });
  app.get("/api/orders", requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const tab = String(req.query.tab ?? "semua");
    if (user.role === "advertising") {
      res.status(403).json({ error: "Gunakan endpoint SPK Advertising untuk divisi Advertising." });
      return;
    }
    let hydrated = db.orders.map((o) => store.hydrateOrder(o)).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (q) {
      hydrated = hydrated.filter(
        (o) => o.no_nota.toLowerCase().includes(q) || (o.customer?.instansi ?? "").toLowerCase().includes(q) || (o.customer?.nama_pelanggan ?? "").toLowerCase().includes(q)
      );
    }
    const counts = {
      semua: hydrated.filter((o) => o.status_nota !== "batal").length,
      produksi: hydrated.filter(
        (o) => activeOrderRaw(o) && o.status_nota !== "batal" && !store.isOrderSiapDiambil(o) && !store.isOrderSelesai(o)
      ).length,
      siap_diambil: hydrated.filter((o) => o.status_nota !== "batal" && store.isOrderSiapDiambil(o)).length,
      selesai: hydrated.filter((o) => o.status_nota !== "batal" && store.isOrderSelesai(o)).length,
      batal: hydrated.filter((o) => o.status_nota === "batal").length,
      piutang: hydrated.filter((o) => activeOrderRaw(o) && o.status_nota !== "batal" && o.sisa_tagihan > 0).length
    };
    if (tab === "semua") {
      hydrated = hydrated.filter((o) => o.status_nota !== "batal");
    } else if (tab === "produksi") {
      hydrated = hydrated.filter((o) => activeOrderRaw(o) && !store.isOrderSiapDiambil(o) && !store.isOrderSelesai(o));
    } else if (tab === "siap_diambil") {
      hydrated = hydrated.filter((o) => store.isOrderSiapDiambil(o));
    } else if (tab === "selesai") {
      hydrated = hydrated.filter((o) => store.isOrderSelesai(o));
    } else if (tab === "batal") {
      hydrated = hydrated.filter((o) => o.status_nota === "batal");
    } else if (tab === "piutang") {
      hydrated = hydrated.filter((o) => activeOrderRaw(o) && o.sisa_tagihan > 0);
    }
    res.json({ orders: hydrated, counts });
  });
  app.get("/api/orders/by-nota/:noNota", requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const target = decodeURIComponent(String(req.params.noNota ?? "")).trim().toLowerCase();
    const raw = store.getState().orders.find((o) => o.no_nota.toLowerCase() === target);
    if (!raw) {
      res.status(404).json({ error: `Nota ${req.params.noNota} tidak ditemukan.` });
      return;
    }
    const order = store.hydrateOrder(raw);
    if (user.role === "advertising") {
      res.json({
        order: {
          ...order,
          total_tagihan: 0,
          jumlah_dp: 0,
          sisa_tagihan: 0,
          payments: [],
          items: order.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 }))
        }
      });
      return;
    }
    res.json({ order });
  });
  app.get("/api/orders/:id", requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const id = Number(req.params.id);
    const raw = store.getState().orders.find((o) => o.id === id);
    if (!raw) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    const order = store.hydrateOrder(raw);
    if (user.role === "advertising") {
      res.json({
        order: {
          ...order,
          total_tagihan: 0,
          jumlah_dp: 0,
          sisa_tagihan: 0,
          payments: [],
          items: order.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 }))
        }
      });
      return;
    }
    res.json({ order });
  });
  app.post("/api/orders", requireAuth(["admin"]), upload.single("lampiran_briefing"), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    let payload;
    try {
      payload = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body;
    } catch {
      res.status(400).json({ error: "Format data order tidak valid." });
      return;
    }
    if (!payload.nama_pelanggan?.trim() || !payload.no_wa?.trim()) {
      res.status(422).json({ error: "Nama pelanggan dan nomor WhatsApp wajib diisi." });
      return;
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      res.status(422).json({ error: "Minimal harus ada 1 item pada nota." });
      return;
    }
    const parsedJatuhTempo = parseTanggalInput(payload.jatuh_tempo);
    if (!parsedJatuhTempo.valid) {
      res.status(422).json({ error: "Format tanggal jatuh tempo tidak valid. Gunakan format YYYY-MM-DD." });
      return;
    }
    const parsedDeadline = parseTanggalInput(payload.deadline);
    if (!parsedDeadline.valid) {
      res.status(422).json({ error: "Format tanggal deadline tidak valid. Gunakan format YYYY-MM-DD." });
      return;
    }
    if (payload.spk_enabled) {
      if (!payload.spk_jenis_pekerjaan?.trim() || !payload.spk_ukuran_konstruksi?.trim() || !payload.spk_lokasi_pasang?.trim()) {
        res.status(422).json({ error: "Jenis pekerjaan, ukuran konstruksi, dan lokasi pasang SPK Advertising wajib diisi." });
        return;
      }
    }
    let instansiName = (payload.instansi ?? "").trim() || "Perorangan";
    let instansiObj = payload.instansi_id ? db.instansis.find((i) => i.id === Number(payload.instansi_id)) : db.instansis.find((i) => i.nama_instansi.toLowerCase() === instansiName.toLowerCase());
    if (!instansiObj) {
      instansiObj = { id: store.nextId("instansis"), nama_instansi: instansiName };
      db.instansis.push(instansiObj);
    } else {
      instansiName = instansiObj.nama_instansi;
    }
    let customer = payload.customer_id ? db.customers.find((c) => c.id === Number(payload.customer_id)) : db.customers.find(
      (c) => c.nama_pelanggan.toLowerCase() === payload.nama_pelanggan.trim().toLowerCase() && c.instansi_id === instansiObj.id
    );
    if (!customer) {
      customer = {
        id: store.nextId("customers"),
        instansi_id: instansiObj.id,
        instansi: instansiName,
        nama_pelanggan: payload.nama_pelanggan.trim(),
        no_wa: payload.no_wa.trim(),
        kategori: payload.kategori ?? "umum",
        alamat: payload.alamat?.trim() || null
      };
      db.customers.push(customer);
    } else {
      customer.instansi_id = instansiObj.id;
      customer.instansi = instansiName;
      customer.nama_pelanggan = payload.nama_pelanggan.trim();
      customer.no_wa = payload.no_wa.trim();
      customer.kategori = payload.kategori ?? customer.kategori;
      customer.alamat = payload.alamat?.trim() || customer.alamat;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let totalSebelumDiskonNota = 0;
    const builtItems = [];
    for (const row of payload.items) {
      const product = db.products.find((p) => p.id === Number(row.product_id));
      if (!product) {
        res.status(422).json({ error: `Produk ID ${row.product_id} tidak ditemukan.` });
        return;
      }
      const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
      const hargaSatuan = priceForCategory(product, customer.kategori);
      let lebar = null;
      let tinggi = null;
      let luasTagihan = null;
      let finishingId = null;
      let hargaSebelumDiskon = 0;
      if (product.kategori_produk === "meteran") {
        lebar = round22(Number(row.lebar_m));
        tinggi = round22(Number(row.tinggi_m));
        if (!(lebar > 0) || !(tinggi > 0)) {
          res.status(422).json({ error: `Lebar dan tinggi wajib > 0 untuk produk meteran (${product.nama_produk}).` });
          return;
        }
        luasTagihan = round22(lebar * tinggi * qty);
        finishingId = row.finishing_id ? Number(row.finishing_id) : null;
        hargaSebelumDiskon = round22(hargaSatuan * luasTagihan);
      } else {
        hargaSebelumDiskon = round22(hargaSatuan * qty);
      }
      const itemDiskonPersen = clampPercent2(row.diskon_persen);
      const itemDiskonNominal = round22(hargaSebelumDiskon * itemDiskonPersen / 100);
      const subtotal = round22(hargaSebelumDiskon - itemDiskonNominal);
      totalSebelumDiskonNota = round22(totalSebelumDiskonNota + subtotal);
      builtItems.push({
        id: 0,
        order_id: 0,
        nama_item: row.nama_item?.trim() || null,
        product_id: product.id,
        finishing_id: finishingId,
        lebar_m: lebar,
        tinggi_m: tinggi,
        qty,
        luas_tagihan_m2: luasTagihan,
        harga_satuan_dipakai: hargaSatuan,
        harga_sebelum_diskon: hargaSebelumDiskon,
        diskon_persen: itemDiskonPersen,
        diskon_nominal: itemDiskonNominal,
        subtotal,
        status_produksi: "menunggu_desain",
        machine_id: product.mesin_default_id ?? null,
        operator_id: null,
        finishing_user_id: null,
        waktu_mulai_cetak: null,
        waktu_selesai_cetak: null,
        klik_total: (product.satuan_hitung ?? "pcs") === "klik" ? qty * (product.klik_per_lembar ?? 1) : null,
        estimasi_tinta_ml: null,
        batch_id: null,
        satuan_hitung: product.satuan_hitung ?? "pcs",
        klik_per_lembar: product.klik_per_lembar ?? 1,
        ukuran_lembar: product.ukuran_lembar ?? null,
        acc_admin_id: null,
        waktu_acc: null,
        file_preview_acc: null,
        file_cetak_tiff: null,
        file_master_arsip: null,
        preflight_dpi_ok: null,
        preflight_cmyk_ok: null,
        preflight_bleed_ok: null,
        preflight_catatan: null,
        created_at: now,
        updated_at: now
      });
    }
    const biayaDesain = round22(Math.max(0, Number(payload.biaya_desain ?? 0) || 0));
    totalSebelumDiskonNota = round22(totalSebelumDiskonNota + biayaDesain);
    const taxSettings = db.tax_settings ?? buildDefaultTaxSettings();
    const diskonPersen = clampPercent2(payload.diskon_persen);
    const { ppnPersen, pph23Persen } = computeEffectiveTaxRates({
      payloadPpn: payload.ppn_persen,
      payloadPph23: payload.pph23_persen,
      instansi: instansiObj,
      taxSettings
    });
    const taxCalc = hitungPajakNota({
      totalSebelumDiskonNota,
      diskonNotaPersen: diskonPersen,
      ppnPersen,
      pph23Persen,
      modeHarga: taxSettings.mode_harga,
      ppnTermasukDiskon: taxSettings.ppn_termasuk_diskon
    });
    const diskonNominal = taxCalc.diskonNominal;
    const ppnNominal = taxCalc.ppnNominal;
    const pph23Nominal = taxCalc.pph23Nominal;
    const totalTagihan = taxCalc.totalTagihan;
    const tempoHari = Math.max(0, Math.floor(Number(instansiObj.tempo_hari ?? 0)) || 0);
    const jatuhTempo = parsedJatuhTempo.iso ? parsedJatuhTempo.iso : tempoHari > 0 ? new Date(Date.now() + tempoHari * 864e5).toISOString() : null;
    const creditLimit = Number(instansiObj.credit_limit ?? 0);
    if (creditLimit > 0 && (payload.status_bayar ?? "belum_lunas") !== "lunas") {
      const piutangAktif = round22(
        db.orders.filter((o) => o.customer_id === customer.id && activeOrderRaw(o)).reduce((sum, o) => sum + Math.max(o.total_tagihan - o.jumlah_dp, 0), 0)
      );
      if (piutangAktif + totalTagihan > creditLimit && !payload.override_credit) {
        res.status(422).json({
          error: `Batas kredit ${instansiObj.nama_instansi} terlampaui. Piutang aktif Rp ${piutangAktif.toLocaleString("id-ID")} + nota baru Rp ${totalTagihan.toLocaleString("id-ID")} melebihi limit Rp ${creditLimit.toLocaleString("id-ID")}. Gunakan override kredit bila disetujui Owner.`,
          credit: { piutang_aktif: piutangAktif, limit: creditLimit, total_baru: totalTagihan }
        });
        return;
      }
    }
    let statusBayar = payload.status_bayar ?? "belum_lunas";
    let jumlahDp = round22(Number(payload.jumlah_dp ?? 0));
    if (statusBayar === "lunas") {
      jumlahDp = totalTagihan;
    } else if (statusBayar === "belum_lunas") {
      jumlahDp = 0;
    } else {
      if (jumlahDp <= 0) {
        res.status(422).json({ error: "Jumlah DP wajib lebih besar dari Rp 0 saat memilih status DP." });
        return;
      }
      if (jumlahDp > totalTagihan) {
        res.status(422).json({ error: "Jumlah DP tidak boleh melebihi total tagihan." });
        return;
      }
      if (jumlahDp >= totalTagihan) {
        statusBayar = "lunas";
        jumlahDp = totalTagihan;
      }
    }
    const orderId = store.nextId("orders");
    const approvalToken = payload.self_acc === false ? null : generateApprovalToken();
    const orderRecord = {
      id: orderId,
      no_nota: store.generateNoNota(),
      customer_id: customer.id,
      user_id: admin.id,
      designer_id: null,
      total_tagihan: totalTagihan,
      jumlah_dp: jumlahDp,
      biaya_desain: biayaDesain,
      status_bayar: statusBayar,
      status_nota: "aktif",
      alasan_batal: null,
      diskon_persen: diskonPersen,
      diskon_nominal: diskonNominal,
      ppn_persen: ppnPersen,
      ppn_nominal: ppnNominal,
      pph23_persen: pph23Persen,
      pph23_nominal: pph23Nominal,
      jatuh_tempo: jatuhTempo,
      approval_token: approvalToken,
      approval_status: approvalToken ? "menunggu" : "belum",
      approval_note: null,
      status_desain: payload.status_desain ?? "belum_ada_file",
      catatan_desain: payload.catatan_desain?.trim() || null,
      lampiran_briefing: req.file ? `/uploads/${req.file.filename}` : null,
      file_master_arsip: null,
      waktu_terima_desain: null,
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: parsedDeadline.iso,
      created_at: now,
      updated_at: now
    };
    db.orders.push(orderRecord);
    for (const item of builtItems) {
      item.id = store.nextId("order_items");
      item.order_id = orderId;
      db.order_items.push(item);
    }
    if (jumlahDp > 0) {
      const openShift = getOpenShiftFor(admin.id);
      db.order_payments.push({
        id: store.nextId("order_payments"),
        order_id: orderId,
        tanggal: now.slice(0, 10),
        nominal: jumlahDp,
        metode: "Tunai",
        keterangan: statusBayar === "lunas" ? "Pelunasan awal saat pembuatan nota" : "Uang muka (DP) awal",
        bukti_bayar: null,
        admin_id: admin.id,
        shift_id: openShift?.id ?? null,
        created_at: now
      });
    }
    if (payload.spk_enabled) {
      db.advertising_spks.push({
        id: store.nextId("advertising_spks"),
        order_id: orderId,
        jenis_pekerjaan: payload.spk_jenis_pekerjaan.trim(),
        ukuran_konstruksi: payload.spk_ukuran_konstruksi.trim(),
        lokasi_pasang: payload.spk_lokasi_pasang.trim(),
        catatan_teknis: payload.spk_catatan_teknis?.trim() || null,
        status_lapangan: "antrean",
        created_at: now,
        updated_at: now
      });
    }
    recordAudit(
      admin,
      "order_create",
      "order",
      orderId,
      `Nota ${orderRecord.no_nota} dibuat untuk ${customer.nama_pelanggan} senilai Rp ${totalTagihan.toLocaleString("id-ID")}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("order_created", { orderId });
    enqueueWa(
      "nota_dibuat",
      `nota_dibuat:${orderId}`,
      customer.no_wa,
      `Nota ${orderRecord.no_nota} telah dibuat. Total tagihan Rp ${totalTagihan.toLocaleString("id-ID")}.`,
      orderId,
      approvalToken ? `${appBaseUrl()}/acc/${approvalToken}` : `${appBaseUrl()}/?nota=${orderRecord.no_nota}`
    );
    res.status(201).json({ order: store.hydrateOrder(orderRecord) });
  });
  app.get("/api/admin/design-reviews", requireAuth(["admin"]), (_req, res) => {
    const db = store.getState();
    const orders = db.orders.map((o) => store.hydrateOrder(o)).filter(
      (o) => o.items.some((i) => i.status_produksi === "menunggu_acc" || i.status_produksi === "revisi")
    ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    res.json({ orders });
  });
  app.post("/api/admin/design-reviews/:orderId/approve", requireAuth(["admin"]), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const orderId = Number(req.params.orderId);
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    const waitingItems = db.order_items.filter(
      (i) => i.order_id === orderId && i.status_produksi === "menunggu_acc"
    );
    if (waitingItems.length === 0) {
      res.status(422).json({ error: "Tidak ada item yang sedang menunggu ACC Admin." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const item of waitingItems) {
      item.acc_admin_id = admin.id;
      item.waktu_acc = now;
      item.updated_at = now;
    }
    order.tanda_tangan_admin = admin.name;
    order.updated_at = now;
    store.persist();
    broadcastEvent("design_reviewed", { orderId });
    res.json({ order: store.hydrateOrder(order) });
  });
  app.post("/api/admin/design-reviews/:orderId/revise", requireAuth(["admin"]), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const orderId = Number(req.params.orderId);
    const catatan = String(req.body.catatan_revisi ?? "").trim();
    if (!catatan) {
      res.status(422).json({ error: "Catatan revisi wajib diisi agar desainer mengetahui perbaikannya." });
      return;
    }
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    const items = db.order_items.filter(
      (i) => i.order_id === orderId && (i.status_produksi === "menunggu_acc" || i.status_produksi === "proses_desain")
    );
    if (items.length === 0) {
      res.status(422).json({ error: "Tidak ada item yang dapat diajukan revisi." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const maxRev = db.design_revisions.filter((r) => r.order_id === orderId).reduce((acc, r) => Math.max(acc, r.revisi_ke), 0);
    db.design_revisions.push({
      id: store.nextId("design_revisions"),
      order_id: orderId,
      order_item_id: null,
      revisi_ke: maxRev + 1,
      catatan_revisi: catatan,
      file_preview: items[0]?.file_preview_acc ?? null,
      admin_id: admin.id,
      status_revisi: "menunggu",
      created_at: now
    });
    for (const item of items) {
      item.status_produksi = "revisi";
      item.acc_admin_id = null;
      item.waktu_acc = null;
      item.updated_at = now;
    }
    order.updated_at = now;
    store.persist();
    broadcastEvent("design_reviewed", { orderId });
    res.json({ order: store.hydrateOrder(order) });
  });
  app.post("/api/orders/:id/payments", requireAuth(["admin"]), upload.single("bukti_bayar"), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    if (order.status_nota === "batal") {
      res.status(422).json({ error: "Nota sudah dibatalkan (void) dan tidak dapat menerima pembayaran." });
      return;
    }
    const sisa = round22(Math.max(order.total_tagihan - order.jumlah_dp, 0));
    if (order.status_bayar === "lunas" || sisa <= 0) {
      res.status(422).json({ error: "Tagihan nota ini sudah berstatus lunas." });
      return;
    }
    const nominal = round22(Number(req.body.nominal ?? 0));
    const metodeRaw = String(req.body.metode ?? "Tunai");
    const metode = ["Tunai", "Transfer", "QRIS"].includes(metodeRaw) ? metodeRaw : "Tunai";
    const keterangan = String(req.body.keterangan ?? "").trim() || null;
    if (!(nominal > 0)) {
      res.status(422).json({ error: "Nominal pembayaran termin wajib lebih dari Rp 0." });
      return;
    }
    if (nominal > sisa + 1) {
      res.status(422).json({ error: `Nominal melebihi sisa tagihan (Rp ${sisa.toLocaleString("id-ID")}).` });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const actualNominal = Math.min(nominal, sisa);
    const buktiPath = req.file ? `/uploads/${req.file.filename}` : null;
    const openShift = getOpenShiftFor(admin.id);
    db.order_payments.push({
      id: store.nextId("order_payments"),
      order_id: order.id,
      tanggal: now.slice(0, 10),
      nominal: actualNominal,
      metode,
      keterangan,
      bukti_bayar: buktiPath,
      admin_id: admin.id,
      shift_id: openShift?.id ?? null,
      created_at: now
    });
    order.jumlah_dp = round22(Math.min(order.total_tagihan, order.jumlah_dp + actualNominal));
    order.status_bayar = order.jumlah_dp >= order.total_tagihan ? "lunas" : "dp";
    if (order.status_bayar === "lunas" && buktiPath) {
      order.bukti_pelunasan = buktiPath;
    }
    if (keterangan && order.status_bayar === "lunas" && !order.catatan_pengecualian) {
      order.catatan_pengecualian = keterangan;
    }
    order.updated_at = now;
    recordAudit(
      admin,
      "payment_record",
      "order",
      order.id,
      `Pembayaran ${metode} Rp ${actualNominal.toLocaleString("id-ID")} untuk ${order.no_nota}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("payment_recorded", { orderId: order.id });
    res.status(201).json({ order: store.hydrateOrder(order) });
  });
  app.post("/api/orders/:id/pelunasan", requireAuth(["admin"]), upload.single("bukti_pelunasan"), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    if (order.status_nota === "batal") {
      res.status(422).json({ error: "Nota sudah dibatalkan (void) dan tidak dapat dilunasi." });
      return;
    }
    if (order.status_bayar === "lunas" && order.bukti_pelunasan) {
      res.status(403).json({ error: "Nota ini sudah lunas dan memiliki bukti pelunasan." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const catatan = String(req.body.catatan_pengecualian ?? "").trim();
    const metodeRaw = String(req.body.metode ?? "Tunai");
    const metode = ["Tunai", "Transfer", "QRIS"].includes(metodeRaw) ? metodeRaw : "Tunai";
    const sisa = round22(Math.max(order.total_tagihan - order.jumlah_dp, 0));
    const buktiPath = req.file ? `/uploads/${req.file.filename}` : null;
    const openShift = getOpenShiftFor(admin.id);
    if (sisa > 0) {
      db.order_payments.push({
        id: store.nextId("order_payments"),
        order_id: order.id,
        tanggal: now.slice(0, 10),
        nominal: sisa,
        metode,
        keterangan: catatan || "Pelunasan penuh tagihan",
        bukti_bayar: buktiPath,
        admin_id: admin.id,
        shift_id: openShift?.id ?? null,
        created_at: now
      });
    }
    order.jumlah_dp = order.total_tagihan;
    order.status_bayar = "lunas";
    if (buktiPath) {
      order.bukti_pelunasan = buktiPath;
    }
    if (catatan) {
      order.catatan_pengecualian = catatan;
    }
    order.updated_at = now;
    recordAudit(
      admin,
      "payment_settle",
      "order",
      order.id,
      `Pelunasan ${metode} untuk ${order.no_nota} sebesar Rp ${sisa.toLocaleString("id-ID")}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("payment_recorded", { orderId: order.id });
    res.json({ order: store.hydrateOrder(order) });
  });
  app.post("/api/orders/:id/void", requireAuth(["admin", "owner"]), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    if (order.status_nota === "batal") {
      res.status(422).json({ error: "Nota ini sudah berstatus batal/void." });
      return;
    }
    const alasan = String(req.body.alasan_batal ?? "").trim();
    if (!alasan) {
      res.status(422).json({ error: "Alasan pembatalan wajib diisi untuk audit." });
      return;
    }
    const sudahDibayar = round22(order.jumlah_dp);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    order.status_nota = "batal";
    order.alasan_batal = alasan;
    order.updated_at = now;
    if (sudahDibayar > 0) {
      order.catatan_pengecualian = `VOID/REFUND: ${alasan}. Dana diterima Rp ${sudahDibayar.toLocaleString("id-ID")} wajib direfund.`;
    }
    let cancelledItems = 0;
    for (const item of db.order_items) {
      if (item.order_id === order.id && item.status_produksi !== "selesai" && item.status_produksi !== "dibatalkan") {
        item.status_produksi = "dibatalkan";
        item.updated_at = now;
        cancelledItems += 1;
      }
    }
    recordAudit(
      actor,
      "order_void",
      "order",
      order.id,
      `Nota ${order.no_nota} dibatalkan. Alasan: ${alasan}. Nilai dibayar Rp ${sudahDibayar.toLocaleString("id-ID")}. Item dibatalkan: ${cancelledItems}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("order_voided", { orderId: order.id });
    res.json({ order: store.hydrateOrder(order), refund_nominal: sudahDibayar });
  });
  app.post("/api/orders/:id/reorder", requireAuth(["admin"]), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const source = db.orders.find((o) => o.id === Number(req.params.id));
    if (!source) {
      res.status(404).json({ error: "Nota sumber tidak ditemukan." });
      return;
    }
    const sourceCustomer = db.customers.find((c) => c.id === source.customer_id);
    if (!sourceCustomer) {
      res.status(422).json({ error: "Data pelanggan nota sumber tidak ditemukan." });
      return;
    }
    const sourceItems = db.order_items.filter((i) => i.order_id === source.id);
    if (sourceItems.length === 0) {
      res.status(422).json({ error: "Nota sumber tidak memiliki item untuk di-reorder." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let totalSebelumDiskonNota = 0;
    const built = [];
    for (const old of sourceItems) {
      const product = db.products.find((p) => p.id === old.product_id);
      if (!product) continue;
      const hargaSatuan = priceForCategory(product, sourceCustomer.kategori);
      const hargaSebelumDiskon = product.kategori_produk === "meteran" ? round22(hargaSatuan * (old.luas_tagihan_m2 ?? 0)) : round22(hargaSatuan * old.qty);
      const diskonPersen2 = clampPercent2(old.diskon_persen);
      const diskonNominal2 = round22(hargaSebelumDiskon * diskonPersen2 / 100);
      const subtotal = round22(hargaSebelumDiskon - diskonNominal2);
      totalSebelumDiskonNota = round22(totalSebelumDiskonNota + subtotal);
      built.push({
        ...old,
        id: 0,
        order_id: 0,
        harga_satuan_dipakai: hargaSatuan,
        harga_sebelum_diskon: hargaSebelumDiskon,
        diskon_persen: diskonPersen2,
        diskon_nominal: diskonNominal2,
        subtotal,
        status_produksi: "menunggu_desain",
        acc_admin_id: null,
        waktu_acc: null,
        file_preview_acc: null,
        file_cetak_tiff: null,
        file_master_arsip: null,
        preflight_dpi_ok: null,
        preflight_cmyk_ok: null,
        preflight_bleed_ok: null,
        preflight_catatan: null,
        created_at: now,
        updated_at: now
      });
    }
    if (built.length === 0) {
      res.status(422).json({ error: "Produk pada nota sumber sudah tidak tersedia." });
      return;
    }
    const biayaDesain = round22(Math.max(0, Number(source.biaya_desain ?? 0) || 0));
    totalSebelumDiskonNota = round22(totalSebelumDiskonNota + biayaDesain);
    const taxSettings = db.tax_settings ?? buildDefaultTaxSettings();
    const diskonPersen = clampPercent2(source.diskon_persen);
    const ppnPersen = clampPercent2(source.ppn_persen);
    const pph23Persen = clampPercent2(source.pph23_persen);
    const taxCalc = hitungPajakNota({
      totalSebelumDiskonNota,
      diskonNotaPersen: diskonPersen,
      ppnPersen,
      pph23Persen,
      modeHarga: taxSettings.mode_harga,
      ppnTermasukDiskon: taxSettings.ppn_termasuk_diskon
    });
    const diskonNominal = taxCalc.diskonNominal;
    const ppnNominal = taxCalc.ppnNominal;
    const pph23Nominal = taxCalc.pph23Nominal;
    const totalTagihan = taxCalc.totalTagihan;
    const orderId = store.nextId("orders");
    const approvalToken = generateApprovalToken();
    const record = {
      id: orderId,
      no_nota: store.generateNoNota(),
      customer_id: source.customer_id,
      user_id: admin.id,
      designer_id: null,
      total_tagihan: totalTagihan,
      jumlah_dp: 0,
      biaya_desain: biayaDesain,
      status_bayar: "belum_lunas",
      status_nota: "aktif",
      alasan_batal: null,
      diskon_persen: diskonPersen,
      diskon_nominal: diskonNominal,
      ppn_persen: ppnPersen,
      ppn_nominal: ppnNominal,
      pph23_persen: pph23Persen,
      pph23_nominal: pph23Nominal,
      jatuh_tempo: null,
      approval_token: approvalToken,
      approval_status: "menunggu",
      approval_note: null,
      status_desain: "belum_ada_file",
      catatan_desain: source.catatan_desain,
      lampiran_briefing: null,
      file_master_arsip: null,
      waktu_terima_desain: null,
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: `Reorder dari ${source.no_nota}`,
      deadline: null,
      created_at: now,
      updated_at: now
    };
    db.orders.push(record);
    for (const item of built) {
      item.id = store.nextId("order_items");
      item.order_id = orderId;
      db.order_items.push(item);
    }
    recordAudit(
      admin,
      "order_reorder",
      "order",
      orderId,
      `Reorder ${record.no_nota} dari ${source.no_nota}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("order_created", { orderId });
    const reordered = store.hydrateOrder(record);
    enqueueWa(
      "nota_dibuat",
      `nota_dibuat:${orderId}`,
      reordered.customer?.no_wa ?? "",
      `Nota ${record.no_nota} dibuat ulang dari ${source.no_nota}. Total tagihan Rp ${record.total_tagihan.toLocaleString("id-ID")}.`,
      orderId,
      record.approval_token ? `${appBaseUrl()}/acc/${record.approval_token}` : `${appBaseUrl()}/?nota=${record.no_nota}`
    );
    res.status(201).json({ order: reordered, source_no_nota: source.no_nota });
  });
  app.get("/api/public/approval/:token", (req, res) => {
    const token = String(req.params.token ?? "").trim();
    const db = store.getState();
    const raw = db.orders.find((o) => o.approval_token && o.approval_token === token);
    if (!raw) {
      res.status(404).json({ error: "Link persetujuan tidak valid atau sudah kedaluwarsa." });
      return;
    }
    const order = store.hydrateOrder(raw);
    const customer = order.customer;
    const disetujui = order.approval_status === "disetujui";
    const instansiId = customer?.instansi_id ?? null;
    const tagihanLain = db.orders.filter((o) => o.id !== raw.id && (o.status_nota ?? "aktif") !== "batal").map((o) => store.hydrateOrder(o)).filter((o) => o.sisa_tagihan > 0).filter(
      (o) => o.customer_id === raw.customer_id || instansiId !== null && o.customer?.instansi_id === instansiId
    ).sort(
      (a, b) => (a.jatuh_tempo ?? a.created_at).localeCompare(b.jatuh_tempo ?? b.created_at)
    ).slice(0, 10).map((o) => ({
      no_nota: o.no_nota,
      created_at: o.created_at,
      jatuh_tempo: o.jatuh_tempo ?? null,
      total_tagihan: o.total_tagihan,
      jumlah_dp: o.jumlah_dp,
      sisa_tagihan: o.sisa_tagihan,
      status_bayar: o.status_bayar
    }));
    const sisaLain = round22(tagihanLain.reduce((sum, row) => sum + row.sisa_tagihan, 0));
    res.json({
      order: {
        no_nota: order.no_nota,
        instansi: customer?.instansi ?? "Perorangan",
        nama_pelanggan: customer?.nama_pelanggan ?? "-",
        status_nota: order.status_nota ?? "aktif",
        approval_status: order.approval_status ?? "belum",
        approval_note: order.approval_note ?? null,
        approved_by: order.tanda_tangan_admin ?? null,
        catatan_desain: order.catatan_desain ?? null,
        lampiran_briefing: toPublicPreviewUrl(order.lampiran_briefing, token),
        created_at: order.created_at,
        updated_at: order.updated_at,
        total_tagihan: disetujui ? order.total_tagihan : 0,
        jumlah_dp: disetujui ? order.jumlah_dp : 0,
        sisa_tagihan: disetujui ? order.sisa_tagihan : 0,
        status_bayar: disetujui ? order.status_bayar : "belum_lunas",
        diskon_persen: disetujui ? order.diskon_persen ?? 0 : 0,
        diskon_nominal: disetujui ? order.diskon_nominal ?? 0 : 0,
        ppn_persen: disetujui ? order.ppn_persen ?? 0 : 0,
        ppn_nominal: disetujui ? order.ppn_nominal ?? 0 : 0,
        pph23_persen: disetujui ? order.pph23_persen ?? 0 : 0,
        pph23_nominal: disetujui ? order.pph23_nominal ?? 0 : 0,
        dpp: disetujui ? round22(order.total_tagihan - (order.ppn_nominal ?? 0) + (order.pph23_nominal ?? 0)) : 0,
        jatuh_tempo: order.jatuh_tempo ?? null,
        items: order.items.map((i) => ({
          id: i.id,
          nama_item: i.nama_item,
          product_name: i.product_name,
          product_category: i.product_category,
          qty: i.qty,
          lebar_m: i.lebar_m,
          tinggi_m: i.tinggi_m,
          luas_tagihan_m2: i.luas_tagihan_m2,
          satuan_hitung: i.satuan_hitung,
          klik_total: i.klik_total,
          finishing_name: i.finishing_name,
          harga_satuan: disetujui ? i.harga_satuan_dipakai : 0,
          harga_sebelum_diskon: disetujui ? i.harga_sebelum_diskon ?? i.harga_satuan_dipakai : 0,
          diskon_persen: disetujui ? i.diskon_persen ?? 0 : 0,
          diskon_nominal: disetujui ? i.diskon_nominal ?? 0 : 0,
          subtotal: disetujui ? i.subtotal : 0,
          file_preview_acc: toPublicPreviewUrl(i.file_preview_acc, token),
          status_produksi: i.status_produksi
        })),
        design_revisions: order.design_revisions.slice(0, 5).map((revision) => ({
          ...revision,
          file_preview: toPublicPreviewUrl(revision.file_preview, token)
        })),
        payments: disetujui ? order.payments.map((p) => ({
          id: p.id,
          tanggal: p.tanggal,
          nominal: p.nominal,
          metode: p.metode,
          keterangan: p.keterangan ?? null,
          bukti_bayar: toPublicPreviewUrl(p.bukti_bayar, token),
          admin_name: p.admin_name ?? null
        })) : [],
        tagihan_lain: disetujui ? tagihanLain : [],
        ringkasan_tagihan: {
          total_tagihan: disetujui ? order.total_tagihan : 0,
          sudah_dibayar: disetujui ? order.jumlah_dp : 0,
          sisa_tagihan: disetujui ? order.sisa_tagihan : 0,
          sisa_tagihan_lain: disetujui ? sisaLain : 0,
          total_harus_dibayar: disetujui ? round22(order.sisa_tagihan + sisaLain) : 0
        }
      }
    });
  });
  app.post("/api/public/approval/:token", (req, res) => {
    const token = String(req.params.token ?? "").trim();
    const body = req.body;
    const db = store.getState();
    const order = db.orders.find((o) => o.approval_token && o.approval_token === token);
    if (!order) {
      res.status(404).json({ error: "Link persetujuan tidak valid atau sudah kedaluwarsa." });
      return;
    }
    if (order.status_nota === "batal") {
      res.status(422).json({ error: "Nota ini sudah dibatalkan." });
      return;
    }
    if (order.approval_status === "disetujui") {
      res.status(409).json({ error: "Nota ini sudah disetujui. Keputusan tidak dapat diubah." });
      return;
    }
    const decision = body.decision;
    if (decision !== "disetujui" && decision !== "revisi") {
      res.status(422).json({ error: 'Keputusan harus "disetujui" atau "revisi".' });
      return;
    }
    const note = String(body.note ?? "").trim();
    if (decision === "revisi" && !note) {
      res.status(422).json({ error: "Mohon tuliskan catatan revisi yang diinginkan." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    order.approval_status = decision;
    order.approval_note = note || null;
    order.updated_at = now;
    const items = db.order_items.filter((i) => i.order_id === order.id);
    if (decision === "disetujui") {
      const namaPic = body.nama?.trim() || "Pelanggan";
      order.tanda_tangan_admin = body.nama?.trim() || order.tanda_tangan_admin;
      for (const item of items) {
        item.acc_pelanggan_at = now;
        item.acc_pelanggan_nama = namaPic;
        item.acc_pelanggan_id = order.customer_id ?? null;
        item.updated_at = now;
      }
    } else {
      for (const item of items) {
        if (item.status_produksi === "menunggu_acc" || item.status_produksi === "proses_desain") {
          item.status_produksi = "revisi";
          item.updated_at = now;
        }
      }
      const maxRev = db.design_revisions.filter((r) => r.order_id === order.id).reduce((acc, r) => Math.max(acc, r.revisi_ke), 0);
      db.design_revisions.push({
        id: store.nextId("design_revisions"),
        order_id: order.id,
        order_item_id: null,
        revisi_ke: maxRev + 1,
        catatan_revisi: `Revisi dari pelanggan${body.nama ? ` (${body.nama})` : ""}: ${note}`,
        file_preview: items[0]?.file_preview_acc ?? null,
        admin_id: null,
        status_revisi: "menunggu",
        created_at: now
      });
    }
    recordAudit(
      null,
      `self_acc_${decision}`,
      "order",
      order.id,
      `Pelanggan ${body.nama ?? order.no_nota} memberi keputusan ${decision}${note ? `: ${note}` : ""}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("design_reviewed", { orderId: order.id });
    res.json({
      ok: true,
      approval_status: decision,
      message: decision === "disetujui" ? "Pesanan disetujui. Nota elektronik dan rincian tagihan kini ditampilkan." : "Catatan revisi terkirim ke tim desain."
    });
  });
  app.get("/api/shifts/current", requireAuth(["admin"]), (req, res) => {
    const user = getCurrentUser(req);
    const shift = getOpenShiftFor(user.id);
    if (!shift) {
      res.json({ shift: null });
      return;
    }
    const expected = computeShiftExpectation(shift);
    res.json({
      shift: hydrateShift({
        ...shift,
        expected_tunai: expected.tunai,
        expected_transfer: expected.transfer,
        expected_qris: expected.qris
      })
    });
  });
  app.get("/api/shifts", requireAuth(["admin", "owner"]), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    let shifts = db.shifts.filter((s) => user.role === "owner" ? true : s.kasir_id === user.id);
    if (dari) shifts = shifts.filter((s) => s.opened_at.slice(0, 10) >= dari);
    if (sampai) shifts = shifts.filter((s) => s.opened_at.slice(0, 10) <= sampai);
    shifts = shifts.sort(
      (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
    );
    res.json({ shifts: shifts.map(hydrateShift) });
  });
  app.post("/api/shifts/open", requireAuth(["admin"]), (req, res) => {
    const user = getCurrentUser(req);
    const openingCash = round22(Number(req.body.opening_cash ?? 0));
    if (openingCash < 0) {
      res.status(422).json({ error: "Saldo awal kas tidak boleh negatif." });
      return;
    }
    if (getOpenShiftFor(user.id)) {
      res.status(422).json({ error: "Masih ada shift terbuka. Tutup shift sebelumnya terlebih dahulu." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const shift = {
      id: store.nextId("shifts"),
      kasir_id: user.id,
      opened_at: now,
      closed_at: null,
      opening_cash: openingCash,
      expected_tunai: openingCash,
      expected_transfer: 0,
      expected_qris: 0,
      actual_tunai: 0,
      actual_transfer: 0,
      actual_qris: 0,
      selisih: 0,
      catatan: null,
      status: "buka"
    };
    store.getState().shifts.push(shift);
    recordAudit(user, "shift_open", "shift", shift.id, `Shift dibuka dengan kas awal Rp ${openingCash.toLocaleString("id-ID")}`, clientIp(req));
    store.persist();
    broadcastEvent("shift_updated", { shiftId: shift.id });
    res.status(201).json({ shift: hydrateShift(shift) });
  });
  app.post("/api/shifts/:id/close", requireAuth(["admin", "owner"]), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const shift = db.shifts.find((s) => s.id === Number(req.params.id));
    if (!shift) {
      res.status(404).json({ error: "Shift tidak ditemukan." });
      return;
    }
    if (user.role === "admin" && shift.kasir_id !== user.id) {
      res.status(403).json({ error: "Anda hanya dapat menutup shift milik sendiri." });
      return;
    }
    if (shift.status === "tutup") {
      res.status(422).json({ error: "Shift ini sudah ditutup." });
      return;
    }
    const body = req.body;
    const expected = computeShiftExpectation(shift);
    const actualTunai = round22(Number(body.actual_tunai ?? expected.tunai));
    const actualTransfer = round22(Number(body.actual_transfer ?? expected.transfer));
    const actualQris = round22(Number(body.actual_qris ?? expected.qris));
    if ([actualTunai, actualTransfer, actualQris].some((n) => !Number.isFinite(n) || n < 0)) {
      res.status(422).json({ error: "Nominal hitung fisik kas tidak boleh negatif." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    shift.closed_at = now;
    shift.expected_tunai = expected.tunai;
    shift.expected_transfer = expected.transfer;
    shift.expected_qris = expected.qris;
    shift.actual_tunai = actualTunai;
    shift.actual_transfer = actualTransfer;
    shift.actual_qris = actualQris;
    shift.selisih = round22(
      actualTunai + actualTransfer + actualQris - (expected.tunai + expected.transfer + expected.qris)
    );
    shift.catatan = String(body.catatan ?? "").trim() || null;
    shift.status = "tutup";
    recordAudit(
      user,
      "shift_close",
      "shift",
      shift.id,
      `Shift ditutup. Ekspektasi Rp ${(expected.tunai + expected.transfer + expected.qris).toLocaleString("id-ID")}, aktual Rp ${(actualTunai + actualTransfer + actualQris).toLocaleString("id-ID")}, selisih Rp ${shift.selisih.toLocaleString("id-ID")}`,
      clientIp(req)
    );
    store.persist();
    broadcastEvent("shift_updated", { shiftId: shift.id });
    res.json({ shift: hydrateShift(shift) });
  });
  app.get("/api/desainer/queue", requireAuth(["desainer"]), (_req, res) => {
    const db = store.getState();
    const designStatuses = ["menunggu_desain", "proses_desain", "menunggu_acc", "revisi"];
    const orders = db.orders.map((o) => store.hydrateOrder(o)).filter((o) => activeOrderRaw(o)).filter((o) => o.items.some((i) => designStatuses.includes(i.status_produksi))).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ orders });
  });
  app.post("/api/desainer/orders/:id/terima", requireAuth(["desainer"]), (req, res) => {
    const desainer = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    order.designer_id = order.designer_id ?? desainer.id;
    order.waktu_terima_desain = order.waktu_terima_desain ?? now;
    order.updated_at = now;
    for (const item of db.order_items) {
      if (item.order_id === order.id && item.status_produksi === "menunggu_desain") {
        item.status_produksi = "proses_desain";
        item.updated_at = now;
      }
    }
    store.persist();
    broadcastEvent("design_updated", { orderId: order.id });
    res.json({ order: store.hydrateOrder(order) });
  });
  app.post("/api/desainer/orders/:id/preview", requireAuth(["desainer"]), upload.single("file_preview"), (req, res) => {
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    if (!order.designer_id && !order.waktu_terima_desain) {
      res.status(403).json({ error: "Terima job terlebih dahulu sebelum mengunggah preview." });
      return;
    }
    if (!req.file) {
      res.status(422).json({ error: "File gambar preview (JPG/PNG/WEBP) wajib diunggah." });
      return;
    }
    const previewUrl = `/uploads/${req.file.filename}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const rev of db.design_revisions) {
      if (rev.order_id === order.id && rev.status_revisi === "menunggu") {
        rev.status_revisi = "selesai";
        rev.file_preview = previewUrl;
      }
    }
    const maxRev = db.design_revisions.filter((r) => r.order_id === order.id).reduce((acc, r) => Math.max(acc, r.revisi_ke), 0);
    db.design_revisions.push({
      id: store.nextId("design_revisions"),
      order_id: order.id,
      order_item_id: null,
      revisi_ke: maxRev + 1,
      catatan_revisi: String(req.body.catatan ?? "Upload preview oleh Desainer").trim(),
      file_preview: previewUrl,
      admin_id: null,
      status_revisi: "selesai",
      created_at: now
    });
    for (const item of db.order_items) {
      if (item.order_id === order.id && ["proses_desain", "revisi", "menunggu_acc"].includes(item.status_produksi)) {
        item.file_preview_acc = previewUrl;
        item.status_produksi = "menunggu_acc";
        item.acc_admin_id = null;
        item.waktu_acc = null;
        item.updated_at = now;
      }
    }
    if (order.approval_status === "revisi") {
      order.approval_status = "menunggu";
      order.approval_note = null;
      order.tanda_tangan_admin = null;
    }
    order.updated_at = now;
    store.persist();
    broadcastEvent("design_updated", { orderId: order.id });
    const previewOrder = store.hydrateOrder(order);
    enqueueWa(
      "preview_siap_acc",
      `preview_siap_acc:${order.id}:${previewUrl}`,
      previewOrder.customer?.no_wa ?? "",
      `Preview desain Nota ${order.no_nota} siap di-ACC. Silakan cek & koreksi melalui tautan Self-ACC berikut.`,
      order.id,
      order.approval_token ? `${appBaseUrl()}/acc/${order.approval_token}` : `${appBaseUrl()}/?nota=${order.no_nota}`,
      previewUrl
    );
    res.json({ order: previewOrder });
  });
  app.post("/api/desainer/items/:itemId/tiff", requireAuth(["desainer"]), upload.single("file_cetak_tiff"), (req, res) => {
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.itemId));
    if (!item) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(404).json({ error: "Item tidak ditemukan." });
      return;
    }
    if (!item.acc_admin_id) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(422).json({ error: "Item wajib disetujui (ACC) Admin terlebih dahulu sebelum unggah TIFF." });
      return;
    }
    if (req.file && !isTiffFilename(req.file.originalname)) {
      cleanupUploadedFiles([req.file]);
      res.status(422).json({ error: "File cetak item wajib berformat .tif atau .tiff." });
      return;
    }
    const tiffName = req.file ? `/uploads/${req.file.filename}` : String(req.body.filename ?? "").trim() || `cetak-item-${item.id}.tif`;
    const body = req.body ?? {};
    const parseBool = (v) => {
      if (v === void 0 || v === null || v === "") return null;
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      if (["true", "1", "ya", "yes", "ok"].includes(s)) return true;
      if (["false", "0", "tidak", "no"].includes(s)) return false;
      return null;
    };
    if (body.preflight_dpi_ok !== void 0) item.preflight_dpi_ok = parseBool(body.preflight_dpi_ok);
    if (body.preflight_cmyk_ok !== void 0) item.preflight_cmyk_ok = parseBool(body.preflight_cmyk_ok);
    if (body.preflight_bleed_ok !== void 0) item.preflight_bleed_ok = parseBool(body.preflight_bleed_ok);
    if (body.preflight_catatan !== void 0) item.preflight_catatan = String(body.preflight_catatan ?? "").trim() || null;
    item.file_cetak_tiff = tiffName;
    item.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    store.persist();
    broadcastEvent("design_updated", { orderId: item.order_id });
    const order = db.orders.find((o) => o.id === item.order_id);
    res.json({ order: store.hydrateOrder(order) });
  });
  app.post(
    "/api/desainer/orders/:id/tiff-massal",
    requireAuth(["desainer"]),
    uploadBulkTiff.array("files", 30),
    (req, res) => {
      const files = req.files ?? [];
      const db = store.getState();
      const order = db.orders.find((o) => o.id === Number(req.params.id));
      if (!order) {
        cleanupUploadedFiles(files);
        res.status(404).json({ error: "Nota tidak ditemukan." });
        return;
      }
      if (files.length === 0) {
        res.status(422).json({ error: "Pilih minimal 1 file .TIFF untuk diunggah." });
        return;
      }
      let explicitMap;
      const rawMap = req.body.peta;
      if (typeof rawMap === "string" && rawMap.trim()) {
        try {
          const parsed = JSON.parse(rawMap);
          if (Array.isArray(parsed)) explicitMap = parsed;
        } catch {
          cleanupUploadedFiles(files);
          res.status(422).json({ error: "Format peta pemetaan file TIFF tidak valid." });
          return;
        }
      }
      const orderItems = db.order_items.filter((i) => i.order_id === order.id);
      const hydratedItems = orderItems.map((i) => store.hydrateItem(i));
      const resolution = resolveBulkTiffMapping({
        filenames: files.map((f) => f.originalname),
        items: hydratedItems,
        explicitMap
      });
      if (!resolution.ok) {
        cleanupUploadedFiles(files);
        res.status(422).json({
          error: resolution.errors[0] || `File berikut belum memiliki pasangan item yang valid: ${resolution.unmapped.join(", ")}`,
          unmapped: resolution.unmapped,
          errors: resolution.errors
        });
        return;
      }
      const fileByOriginal = new Map(files.map((f) => [f.originalname, f]));
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const body = req.body ?? {};
      const parseBool = (v) => {
        if (v === void 0 || v === null || v === "") return null;
        if (typeof v === "boolean") return v;
        const s = String(v).trim().toLowerCase();
        if (["true", "1", "ya", "yes", "ok"].includes(s)) return true;
        if (["false", "0", "tidak", "no"].includes(s)) return false;
        return null;
      };
      const preflight = {
        dpi: body.preflight_dpi_ok !== void 0 ? parseBool(body.preflight_dpi_ok) : void 0,
        cmyk: body.preflight_cmyk_ok !== void 0 ? parseBool(body.preflight_cmyk_ok) : void 0,
        bleed: body.preflight_bleed_ok !== void 0 ? parseBool(body.preflight_bleed_ok) : void 0,
        catatan: body.preflight_catatan !== void 0 ? String(body.preflight_catatan ?? "").trim() || null : void 0
      };
      for (const pair of resolution.mappings) {
        const file = fileByOriginal.get(pair.filename);
        const target = orderItems.find((i) => i.id === pair.itemId);
        target.file_cetak_tiff = `/uploads/${file.filename}`;
        if (preflight.dpi !== void 0) target.preflight_dpi_ok = preflight.dpi;
        if (preflight.cmyk !== void 0) target.preflight_cmyk_ok = preflight.cmyk;
        if (preflight.bleed !== void 0) target.preflight_bleed_ok = preflight.bleed;
        if (preflight.catatan !== void 0) target.preflight_catatan = preflight.catatan;
        target.updated_at = now;
      }
      order.updated_at = now;
      auditRequest(
        req,
        "tiff_massal_upload",
        "order",
        order.id,
        `${resolution.mappings.length} file TIFF diunggah massal untuk Nota ${order.no_nota}.`
      );
      store.persist();
      broadcastEvent("design_updated", { orderId: order.id });
      res.json({ order: store.hydrateOrder(order), uploaded: resolution.mappings.length });
    }
  );
  app.post("/api/desainer/orders/:id/master", requireAuth(["desainer"]), upload.single("file_master_arsip"), (req, res) => {
    const desainer = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(404).json({ error: "Nota tidak ditemukan." });
      return;
    }
    const items = db.order_items.filter((i) => i.order_id === order.id);
    if (items.length === 0 || !items.every((i) => Boolean(i.file_cetak_tiff))) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(422).json({ error: "Seluruh item dalam nota wajib memiliki file cetak .TIFF sebelum finalisasi master." });
      return;
    }
    if (!req.file) {
      res.status(422).json({ error: "Wajib mengunggah file master editable (.AI / .PSD / .CDR) saat finalisasi master." });
      return;
    }
    if (!isEditableMasterFilename(req.file.originalname)) {
      cleanupUploadedFiles([req.file]);
      res.status(422).json({ error: "Format master wajib editable (.ai, .psd, atau .cdr). Format lain ditolak." });
      return;
    }
    const masterFile = `/uploads/${req.file.filename}`;
    const ttd = String(req.body.tanda_tangan ?? "").trim() || desainer.name;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    order.file_master_arsip = masterFile;
    order.tanda_tangan_desainer = ttd;
    order.waktu_selesai_desain = now;
    order.status_desain = "siap_cetak_tiff";
    order.updated_at = now;
    for (const item of items) {
      item.file_master_arsip = masterFile;
      item.status_produksi = "antrean_cetak";
      item.updated_at = now;
    }
    store.persist();
    broadcastEvent("production_updated", { orderId: order.id });
    res.json({ order: store.hydrateOrder(order) });
  });
  const mesinUtamaCetak = (db, product) => {
    const aktif = db.machines.find((m) => m.aktif);
    if (aktif) return aktif;
    if (product?.mesin_default_id) {
      return db.machines.find((m) => m.id === product.mesin_default_id) ?? null;
    }
    return null;
  };
  const catatTintaPerWarna = (db, params) => {
    const ids = [...new Set(params.warnaIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) {
      return { totalMl: 0, rincian: [], peringatan: null };
    }
    const warnaList = ids.map((id) => db.tinta_warna.find((w) => w.id === id && w.aktif)).filter((w) => Boolean(w)).map((w) => ({
      id: w.id,
      warna: w.warna,
      konsumsi_ml_per_m2: Number(w.konsumsi_ml_per_m2 ?? 0) || hitungTintaMlPerM2()
    }));
    const hitung = hitungPemakaianTintaPerWarna(params.luasCetakM2, warnaList);
    let peringatan = null;
    const rincian = [];
    for (const row of hitung.rincian) {
      const tinta = db.tinta_warna.find((w) => w.id === row.tinta_warna_id);
      if (!tinta) continue;
      const pakai = Math.min(Number(tinta.stok_ml ?? 0), row.jumlah_ml);
      tinta.stok_ml = round22(Number(tinta.stok_ml ?? 0) - pakai);
      tinta.updated_at = params.now;
      if (pakai + 1e-3 < row.jumlah_ml) {
        peringatan = `Stok tinta ${tinta.warna} tidak mencukupi; pemakaian dibatasi.`;
      }
      db.pemakaian_tinta.push({
        id: store.nextId("pemakaian_tinta"),
        order_item_id: params.orderItemId,
        grup_id: params.grupId,
        tinta_warna_id: tinta.id,
        warna: tinta.warna,
        jumlah_ml: round22(pakai),
        luas_cetak_m2: round22(params.luasCetakM2),
        created_at: params.now
      });
      rincian.push({ warna: tinta.warna, jumlah_ml: round22(pakai) });
    }
    if (warnaList.length < ids.length) {
      peringatan = peringatan ?? "Sebagian warna tinta tidak aktif atau tidak ditemukan.";
    }
    return { totalMl: round22(rincian.reduce((sum, r) => sum + r.jumlah_ml, 0)), rincian, peringatan };
  };
  app.get("/api/operator/queue", requireAuth(["operator_cetak"]), (_req, res) => {
    const db = store.getState();
    const items = db.order_items.filter((i) => ["antrean_cetak", "siap_tata", "proses_cetak", "gagal_cetak", "cetak_ulang"].includes(i.status_produksi)).filter((i) => {
      const order = db.orders.find((o) => o.id === i.order_id);
      return order ? activeOrderRaw(order) : false;
    }).map((i) => {
      const order = db.orders.find((o) => o.id === i.order_id);
      const customer = order ? db.customers.find((c) => c.id === order.customer_id) : null;
      return {
        ...store.hydrateItem(i),
        no_nota: order?.no_nota ?? "-",
        instansi: customer?.instansi ?? "Perorangan",
        nama_pelanggan: customer?.nama_pelanggan ?? "-",
        deadline: order?.deadline ?? null
      };
    });
    res.json({
      items,
      rolls: db.material_rolls.filter((r) => r.status === "aktif"),
      offcuts: db.material_offcuts.filter((o) => o.status === "tersedia"),
      machines: db.machines.filter((m) => m.aktif),
      supplies: db.supplies.filter((s) => s.aktif),
      batches: db.print_batches.slice(-20).reverse(),
      cattoffs: db.stok_cattoff.filter((c) => c.status === "aktif"),
      tinta_warna: db.tinta_warna.filter((w) => w.aktif),
      grup: db.cetak_grup.slice(-20).reverse().map((g) => ({
        ...g,
        operator_name: db.users.find((u) => u.id === g.operator_id)?.name ?? null,
        machine_name: db.machines.find((m) => m.id === g.machine_id)?.nama_mesin ?? null,
        items: db.cetak_grup_item.filter((gi) => gi.grup_id === g.id).map((gi) => ({
          ...gi,
          no_nota: db.orders.find((o) => o.id === db.order_items.find((it) => it.id === gi.order_item_id)?.order_id)?.no_nota ?? "-",
          nama_item: db.order_items.find((it) => it.id === gi.order_item_id)?.nama_item ?? null,
          qty_order: db.order_items.find((it) => it.id === gi.order_item_id)?.qty ?? 0
        }))
      }))
    });
  });
  app.post("/api/operator/items/:id/mulai", requireAuth(["operator_cetak"]), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.id));
    if (!item || !["antrean_cetak", "siap_tata", "gagal_cetak", "cetak_ulang"].includes(item.status_produksi)) {
      res.status(403).json({ error: "Item tidak berada pada status siap cetak." });
      return;
    }
    const product = db.products.find((p) => p.id === item.product_id);
    const machine = mesinUtamaCetak(db, product);
    if (!machine) {
      res.status(422).json({ error: "Mesin cetak aktif belum tersedia." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    item.status_produksi = "proses_cetak";
    item.machine_id = machine.id;
    item.operator_id = operator.id;
    item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
    item.updated_at = now;
    store.persist();
    broadcastEvent("production_updated", { orderId: item.order_id });
    res.json({ item: store.hydrateItem(item) });
  });
  app.post("/api/operator/items/:id/siap-tata", requireAuth(["operator_cetak"]), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === parsePositiveId(req.params.id));
    if (!item || !["antrean_cetak", "cetak_ulang"].includes(item.status_produksi)) {
      res.status(422).json({ error: "Item tidak berada di antrean penataan." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    item.status_produksi = "siap_tata";
    item.ditata_at = now;
    item.operator_id = operator.id;
    item.updated_at = now;
    store.persist();
    auditRequest(req, "operator_siap_tata", "order_item", item.id, `${operator.name} menandai ${item.nama_item ?? "item"} siap ditata.`);
    broadcastEvent("production_updated", { orderId: item.order_id });
    res.json({ item: store.hydrateItem(item) });
  });
  app.post("/api/operator/items/:id/selesai", requireAuth(["operator_cetak"]), async (req, res) => {
    await runTransactional(
      res,
      () => store.critical(
        [
          "order_items",
          "material_rolls",
          "material_offcuts",
          "stok_cattoff",
          "products",
          "supplies",
          "tinta_warna",
          "pemakaian_tinta",
          "audit_logs"
        ],
        () => {
          const db = store.getState();
          const item = db.order_items.find((i) => i.id === Number(req.params.id));
          if (!item) {
            res.status(404).json({ error: "Item tidak ditemukan." });
            return;
          }
          if (item.status_produksi === "gagal_cetak") {
            res.status(422).json({ error: "Item berstatus Gagal Cetak wajib dimulai cetak ulang sebelum diselesaikan." });
            return;
          }
          if (!["antrean_cetak", "siap_tata", "proses_cetak", "cetak_ulang"].includes(item.status_produksi)) {
            res.status(403).json({ error: "Item tidak berada di antrean cetak." });
            return;
          }
          const parentOrder = db.orders.find((o) => o.id === item.order_id);
          if (!parentOrder || !activeOrderRaw(parentOrder)) {
            res.status(422).json({ error: "Nota sudah dibatalkan (void). Produksi tidak dapat dilanjutkan." });
            return;
          }
          const product = db.products.find((p) => p.id === item.product_id);
          if (!product) {
            res.status(404).json({ error: "Produk tidak ditemukan." });
            return;
          }
          const {
            sumber_bahan,
            material_roll_id,
            cattoff_id,
            material_offcut_id,
            orientasi_potong,
            panjang_file_m,
            lebar_file_m,
            offcut_lebar_m,
            offcut_panjang_m,
            warna_tinta_ids
          } = req.body;
          const machine = mesinUtamaCetak(db, product);
          if (!machine) {
            res.status(422).json({ error: "Mesin cetak aktif belum ditentukan untuk item ini." });
            return;
          }
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const qtySisa = Math.max(1, Math.floor(Number(item.qty) || 1) - (Number(item.qty_tercetak) || 0));
          let luasCetakM2 = 0;
          let catatanBahan = "";
          if (product.kategori_produk === "meteran") {
            const finishing = item.finishing_id ? db.finishings.find((f) => f.id === item.finishing_id) ?? null : null;
            const ukuranKotor = computeUkuranKotor(item.lebar_m ?? 0, item.tinggi_m ?? 0, qtySisa, finishing);
            const panjangFile = Math.max(0, round22(Number(panjang_file_m ?? 0)));
            const lebarFile = Math.max(0, round22(Number(lebar_file_m ?? 0)));
            const pakaiFile = panjangFile > 0 && lebarFile > 0;
            const orientasi = orientasi_potong === "lebar" ? "lebar" : "panjang";
            const panjangPakai = pakaiFile ? round22(panjangFile * qtySisa) : round22(orientasi === "lebar" ? ukuranKotor.lebar * qtySisa : ukuranKotor.tinggi * qtySisa);
            const lebarPakai = pakaiFile ? lebarFile : round22(orientasi === "lebar" ? ukuranKotor.tinggi : ukuranKotor.lebar);
            const luasNetto = pakaiFile ? round22(panjangFile * lebarFile * qtySisa) : round22((item.lebar_m ?? 0) * (item.tinggi_m ?? 0) * qtySisa);
            if (!(panjangPakai > 0) || !(lebarPakai > 0)) {
              res.status(422).json({ error: "Dimensi file .prn tidak valid." });
              return;
            }
            luasCetakM2 = luasNetto;
            const wosFinishing = round22(Math.max(ukuranKotor.luas - luasNetto, 0));
            const offLebar = Math.max(0, round22(Number(offcut_lebar_m ?? 0)));
            const offPanjangInput = Math.max(0, round22(Number(offcut_panjang_m ?? 0)));
            let containerWidthM = 0;
            let rollId = null;
            let offcutId = null;
            let cattoffId = null;
            if (sumber_bahan === "offcut") {
              const offcut = db.material_offcuts.find((o) => o.id === Number(material_offcut_id));
              if (!offcut || offcut.status !== "tersedia") {
                res.status(422).json({ error: "Stok potongan (offcut) tidak tersedia." });
                return;
              }
              if (offcut.lebar_m + 1e-3 < lebarPakai) {
                res.status(422).json({ error: `Lebar potongan (${offcut.lebar_m} m) kurang dari kebutuhan (${lebarPakai} m).` });
                return;
              }
              if (offcut.panjang_m + 1e-3 < panjangPakai) {
                res.status(422).json({ error: `Panjang potongan (${offcut.panjang_m} m) kurang dari kebutuhan (${panjangPakai} m).` });
                return;
              }
              offcut.status = "terpakai";
              offcutId = offcut.id;
              containerWidthM = offcut.lebar_m;
              catatanBahan = `offcut ${offcut.kode_roll ?? offcut.id}`;
            } else if (sumber_bahan === "cattoff") {
              const cattoff = db.stok_cattoff.find((c) => c.id === Number(cattoff_id));
              if (!cattoff || cattoff.status !== "aktif") {
                res.status(422).json({ error: "Stok cattoff aktif wajib dipilih." });
                return;
              }
              if (cattoff.lebar_m + 1e-3 < lebarPakai) {
                res.status(422).json({ error: `Lebar cattoff (${cattoff.lebar_m} m) kurang dari kebutuhan (${lebarPakai} m).` });
                return;
              }
              if (cattoff.panjang_sisa_m + 1e-3 < panjangPakai) {
                res.status(422).json({ error: `Sisa panjang cattoff (${cattoff.panjang_sisa_m} m) tidak mencukupi (${panjangPakai} m).` });
                return;
              }
              const sisa = round22(cattoff.panjang_sisa_m - panjangPakai);
              cattoff.panjang_sisa_m = sisa;
              cattoff.status = sisa <= 0 ? "habis" : "aktif";
              cattoff.updated_at = now;
              cattoffId = cattoff.id;
              containerWidthM = cattoff.lebar_m;
              catatanBahan = `cattoff ${cattoff.kode}`;
            } else {
              const roll = db.material_rolls.find((r) => r.id === Number(material_roll_id));
              if (!roll || roll.status !== "aktif") {
                res.status(422).json({ error: "Roll bahan aktif wajib dipilih." });
                return;
              }
              if (roll.lebar_m + 1e-3 < lebarPakai) {
                res.status(422).json({ error: `Lebar roll (${roll.lebar_m} m) kurang dari lebar kotor (${lebarPakai} m).` });
                return;
              }
              if (roll.panjang_sisa_m + 1e-3 < panjangPakai) {
                res.status(422).json({ error: `Sisa panjang roll (${roll.panjang_sisa_m} m) tidak mencukupi (${panjangPakai} m).` });
                return;
              }
              const sisaRoll = round22(roll.panjang_sisa_m - panjangPakai);
              roll.panjang_sisa_m = sisaRoll;
              roll.status = sisaRoll <= 0 ? "habis" : "aktif";
              rollId = roll.id;
              containerWidthM = roll.lebar_m;
              catatanBahan = `roll ${roll.kode_roll}`;
            }
            const offPanjang = offPanjangInput > 0 ? offPanjangInput : offLebar > 0 ? panjangPakai : 0;
            const hitungBahan = hitungPemakaianBahanPrn({
              panjangFileM: panjangPakai,
              lebarFileM: lebarPakai,
              containerWidthM,
              manualOffcutLebarM: offLebar,
              manualOffcutPanjangM: offPanjang
            });
            if (hitungBahan.createsManualOffcut) {
              const sourceRoll = rollId ? db.material_rolls.find((r) => r.id === rollId) : null;
              const sourceCattoff = cattoffId ? db.stok_cattoff.find((c) => c.id === cattoffId) : null;
              db.material_offcuts.push({
                id: store.nextId("material_offcuts"),
                material_roll_id: rollId,
                kode_roll: sourceRoll?.kode_roll ?? sourceCattoff?.kode ?? null,
                jenis_bahan: sourceRoll?.jenis_bahan ?? sourceCattoff?.jenis_bahan ?? product.nama_produk,
                lebar_m: offLebar,
                panjang_m: offPanjang,
                luas_m2: round22(offLebar * offPanjang),
                status: "tersedia",
                created_at: now
              });
              offcutId = db.material_offcuts[db.material_offcuts.length - 1].id;
            }
            db.material_logs.push({
              id: store.nextId("material_logs"),
              order_item_id: item.id,
              material_roll_id: rollId,
              material_offcut_id: offcutId,
              luas_netto_m2: luasNetto,
              wos_finishing_m2: wosFinishing,
              wos_potong_m2: hitungBahan.wosPotongM2,
              gagal_cetak_m2: 0,
              keterangan: `Selesai cetak | ${product.nama_produk} | ${panjangPakai} m | ${catatanBahan}`,
              created_at: now
            });
          } else {
            if (product.stok_pcs !== null) {
              if (product.stok_pcs < qtySisa) {
                res.status(422).json({ error: `Stok produk satuan ${product.nama_produk} tidak mencukupi.` });
                return;
              }
              product.stok_pcs -= qtySisa;
            }
            if ((product.satuan_hitung ?? "pcs") === "klik") {
              luasCetakM2 = round22(qtySisa * A3_PLUS_AREA_M2);
            }
          }
          const klikTotal = (product.satuan_hitung ?? "pcs") === "klik" ? qtySisa * (product.klik_per_lembar ?? 1) : null;
          const idsTinta = Array.isArray(warna_tinta_ids) ? warna_tinta_ids : [];
          const tintaPerWarna = catatTintaPerWarna(db, {
            warnaIds: idsTinta,
            luasCetakM2,
            orderItemId: item.id,
            grupId: null,
            now
          });
          let estimasiTinta = tintaPerWarna.totalMl;
          let peringatanStok = tintaPerWarna.peringatan;
          if (idsTinta.length === 0) {
            estimasiTinta = round22(luasCetakM2 * (machine.konsumsi_tinta_ml_per_m2 ?? 0));
            if (estimasiTinta > 0) {
              const ink = selectInkSupply(db, machine);
              if (!ink) {
                peringatanStok = "Stok tinta tidak tersedia; estimasi tetap dicatat.";
              } else {
                const pakai = round22(Math.min(ink.stok, estimasiTinta));
                ink.stok = round22(ink.stok - pakai);
                ink.updated_at = now;
                db.supply_usages.push({
                  id: store.nextId("supply_usages"),
                  supply_id: ink.id,
                  order_item_id: item.id,
                  jumlah: pakai,
                  satuan: ink.satuan,
                  keterangan: `Estimasi tinta cetak | ${product.nama_produk} | ${machine.nama_mesin}`,
                  user_id: getCurrentUser(req).id,
                  created_at: now
                });
                if (pakai + 1e-3 < estimasiTinta) {
                  peringatanStok = `Stok ${ink.nama} hanya ${ink.stok.toLocaleString("id-ID")} ${ink.satuan}; pemakaian dibatasi.`;
                }
              }
            }
          }
          item.machine_id = machine.id;
          item.operator_id = getCurrentUser(req).id;
          item.klik_total = klikTotal;
          item.estimasi_tinta_ml = estimasiTinta;
          item.qty_tercetak = item.qty;
          item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
          item.waktu_selesai_cetak = now;
          item.status_produksi = item.finishing_id ? "antrean_finishing" : "siap_diambil";
          item.updated_at = now;
          store.persist();
          broadcastEvent("production_updated", { orderId: item.order_id });
          enqueueSiapDiambil(item.order_id);
          res.json({
            item: store.hydrateItem(item),
            estimasi_tinta_ml: estimasiTinta,
            rincian_tinta: tintaPerWarna.rincian,
            klik_total: klikTotal,
            peringatan_stok: peringatanStok
          });
        }
      ),
      "Gagal menyelesaikan cetak secara transaksional."
    );
  });
  const hydrateGrupCetak = (db, grup) => ({
    ...grup,
    operator_name: db.users.find((u) => u.id === grup.operator_id)?.name ?? null,
    machine_name: db.machines.find((m) => m.id === grup.machine_id)?.nama_mesin ?? null,
    items: db.cetak_grup_item.filter((gi) => gi.grup_id === grup.id).map((gi) => {
      const orderItem = db.order_items.find((it) => it.id === gi.order_item_id);
      return {
        ...gi,
        no_nota: orderItem ? db.orders.find((o) => o.id === orderItem.order_id)?.no_nota ?? "-" : "-",
        nama_item: orderItem?.nama_item ?? null,
        qty_order: orderItem?.qty ?? 0
      };
    })
  });
  const prosesSelesaiGrupItem = (db, grup, gi, now, operatorId, warnaIds) => {
    const item = db.order_items.find((i) => i.id === gi.order_item_id);
    if (!item) return "Item pesanan tidak ditemukan.";
    const parentOrder = db.orders.find((o) => o.id === item.order_id);
    if (!parentOrder || !activeOrderRaw(parentOrder)) return "Nota sudah dibatalkan (void).";
    const product = db.products.find((p) => p.id === item.product_id);
    if (!product) return "Produk tidak ditemukan.";
    const qty = Math.max(1, Math.floor(Number(gi.qty_cetak ?? item.qty ?? 1)));
    const finishing = item.finishing_id ? db.finishings.find((f) => f.id === item.finishing_id) ?? null : null;
    const ukuranKotor = computeUkuranKotor(item.lebar_m ?? 0, item.tinggi_m ?? 0, qty, finishing);
    const panjangFile = Number(gi.panjang_file_m ?? 0) > 0 ? round22(Number(gi.panjang_file_m)) : round22(ukuranKotor.tinggi);
    const lebarFile = Number(gi.lebar_file_m ?? 0) > 0 ? round22(Number(gi.lebar_file_m)) : round22(ukuranKotor.lebar);
    const panjangPakai = round22(panjangFile * qty);
    const luasNetto = round22(panjangFile * lebarFile * qty);
    const wosFinishing = round22(Math.max(ukuranKotor.luas - luasNetto, 0));
    if (!(panjangPakai > 0) || !(lebarFile > 0)) return "Dimensi file .prn tidak valid.";
    const offLebar = Math.max(0, round22(Number(gi.offcut_lebar_m ?? 0)));
    const offPanjangInput = Math.max(0, round22(Number(gi.offcut_panjang_m ?? 0)));
    let containerWidthM = 0;
    let rollId = null;
    let offcutId = null;
    let cattoffId = null;
    if (gi.sumber_bahan === "offcut") {
      const offcut = gi.offcut_id ? db.material_offcuts.find((o) => o.id === gi.offcut_id) : db.material_offcuts.find((o) => o.status === "tersedia" && o.lebar_m + 1e-3 >= lebarFile && o.panjang_m + 1e-3 >= panjangPakai);
      if (!offcut || offcut.status !== "tersedia") return "Stok potongan (offcut) tidak tersedia.";
      if (offcut.lebar_m + 1e-3 < lebarFile) return `Lebar potongan (${offcut.lebar_m} m) kurang dari kebutuhan (${lebarFile} m).`;
      if (offcut.panjang_m + 1e-3 < panjangPakai) return `Panjang potongan (${offcut.panjang_m} m) kurang dari kebutuhan (${panjangPakai} m).`;
      offcut.status = "terpakai";
      offcutId = offcut.id;
      gi.offcut_id = offcut.id;
      containerWidthM = offcut.lebar_m;
    } else if (gi.sumber_bahan === "cattoff") {
      const cattoff = gi.cattoff_id ? db.stok_cattoff.find((c) => c.id === gi.cattoff_id) : db.stok_cattoff.find((c) => c.status === "aktif" && c.lebar_m + 1e-3 >= lebarFile && c.panjang_sisa_m + 1e-3 >= panjangPakai);
      if (!cattoff || cattoff.status !== "aktif") return "Stok cattoff aktif tidak tersedia.";
      if (cattoff.lebar_m + 1e-3 < lebarFile) return `Lebar cattoff (${cattoff.lebar_m} m) kurang dari kebutuhan (${lebarFile} m).`;
      if (cattoff.panjang_sisa_m + 1e-3 < panjangPakai) return `Sisa cattoff (${cattoff.panjang_sisa_m} m) tidak mencukupi (${panjangPakai} m).`;
      const sisa = round22(cattoff.panjang_sisa_m - panjangPakai);
      cattoff.panjang_sisa_m = sisa;
      cattoff.status = sisa <= 0 ? "habis" : "aktif";
      cattoff.updated_at = now;
      cattoffId = cattoff.id;
      gi.cattoff_id = cattoff.id;
      containerWidthM = cattoff.lebar_m;
    } else {
      const roll = gi.roll_id ? db.material_rolls.find((r) => r.id === gi.roll_id) : db.material_rolls.find((r) => r.status === "aktif" && r.lebar_m + 1e-3 >= lebarFile && r.panjang_sisa_m + 1e-3 >= panjangPakai);
      if (!roll || roll.status !== "aktif") return "Roll bahan aktif tidak tersedia.";
      if (roll.lebar_m + 1e-3 < lebarFile) return `Lebar roll (${roll.lebar_m} m) kurang dari kebutuhan (${lebarFile} m).`;
      if (roll.panjang_sisa_m + 1e-3 < panjangPakai) return `Sisa roll (${roll.panjang_sisa_m} m) tidak mencukupi (${panjangPakai} m).`;
      const sisa = round22(roll.panjang_sisa_m - panjangPakai);
      roll.panjang_sisa_m = sisa;
      roll.status = sisa <= 0 ? "habis" : "aktif";
      rollId = roll.id;
      gi.roll_id = roll.id;
      containerWidthM = roll.lebar_m;
    }
    const offPanjang = offPanjangInput > 0 ? offPanjangInput : offLebar > 0 ? panjangPakai : 0;
    const hitungBahan = hitungPemakaianBahanPrn({
      panjangFileM: panjangPakai,
      lebarFileM: lebarFile,
      containerWidthM,
      manualOffcutLebarM: offLebar,
      manualOffcutPanjangM: offPanjang
    });
    if (hitungBahan.createsManualOffcut) {
      const sourceRoll = rollId ? db.material_rolls.find((r) => r.id === rollId) : null;
      const sourceCattoff = cattoffId ? db.stok_cattoff.find((c) => c.id === cattoffId) : null;
      db.material_offcuts.push({
        id: store.nextId("material_offcuts"),
        material_roll_id: rollId,
        kode_roll: sourceRoll?.kode_roll ?? sourceCattoff?.kode ?? null,
        jenis_bahan: sourceRoll?.jenis_bahan ?? sourceCattoff?.jenis_bahan ?? product.nama_produk,
        lebar_m: offLebar,
        panjang_m: offPanjang,
        luas_m2: round22(offLebar * offPanjang),
        status: "tersedia",
        created_at: now
      });
      offcutId = db.material_offcuts[db.material_offcuts.length - 1].id;
      gi.offcut_id = offcutId;
    }
    db.material_logs.push({
      id: store.nextId("material_logs"),
      order_item_id: item.id,
      material_roll_id: rollId,
      material_offcut_id: offcutId,
      luas_netto_m2: luasNetto,
      wos_finishing_m2: wosFinishing,
      wos_potong_m2: hitungBahan.wosPotongM2,
      gagal_cetak_m2: 0,
      keterangan: `Selesai cetak grup ${grup.kode_grup} | ${product.nama_produk} | ${panjangPakai} m`,
      created_at: now
    });
    const tinta = catatTintaPerWarna(db, {
      warnaIds,
      luasCetakM2: luasNetto,
      orderItemId: item.id,
      grupId: grup.id,
      now
    });
    gi.masuk_wos_m2 = hitungBahan.wosPotongM2;
    gi.status = "selesai";
    gi.updated_at = now;
    item.qty_tercetak = round22((item.qty_tercetak ?? 0) + qty);
    item.machine_id = grup.machine_id;
    item.operator_id = operatorId;
    item.estimasi_tinta_ml = round22((item.estimasi_tinta_ml ?? 0) + tinta.totalMl);
    item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
    item.updated_at = now;
    const statusCetak = statusSetelahCetak(item.qty, item.qty_tercetak ?? 0);
    if (statusCetak === "selesai") {
      item.waktu_selesai_cetak = now;
      item.status_produksi = item.finishing_id ? "antrean_finishing" : "siap_diambil";
      enqueueSiapDiambil(item.order_id);
    } else {
      item.status_produksi = "antrean_cetak";
    }
    return null;
  };
  app.post("/api/operator/grup", requireAuth(["operator_cetak"]), async (req, res) => {
    const operator = getCurrentUser(req);
    const body = req.body;
    const itemIds = [...new Set((body.item_ids ?? []).map((id) => parsePositiveId(id)).filter((id) => id !== null))];
    if (itemIds.length === 0) {
      res.status(422).json({ error: "Pilih minimal satu item untuk grup cetak." });
      return;
    }
    let grupId = null;
    await store.critical(
      ["order_items", "cetak_grup", "cetak_grup_item", "audit_logs"],
      () => {
        const db2 = store.getState();
        const items = itemIds.map((id2) => db2.order_items.find((it) => it.id === id2)).filter((it) => Boolean(it));
        if (items.length === 0) {
          res.status(422).json({ error: "Item grup tidak ditemukan." });
          return;
        }
        const nonMeteran = items.find((it) => db2.products.find((p) => p.id === it.product_id)?.kategori_produk !== "meteran");
        if (nonMeteran) {
          res.status(422).json({ error: "Grup cetak hanya untuk produk meteran." });
          return;
        }
        const tidakSiap = items.find(
          (it) => !["antrean_cetak", "siap_tata", "proses_cetak", "cetak_ulang"].includes(it.status_produksi)
        );
        if (tidakSiap) {
          res.status(422).json({ error: `Item ${tidakSiap.nama_item ?? tidakSiap.id} tidak berada di antrean cetak.` });
          return;
        }
        const sudahDigrup = items.find(
          (it) => db2.cetak_grup_item.some((gi) => gi.order_item_id === it.id && gi.status !== "selesai")
        );
        if (sudahDigrup) {
          res.status(422).json({ error: `Item ${sudahDigrup.nama_item ?? sudahDigrup.id} masih ada di grup cetak yang belum selesai.` });
          return;
        }
        const notaBatal = items.find((it) => {
          const order = db2.orders.find((o) => o.id === it.order_id);
          return !order || !activeOrderRaw(order);
        });
        if (notaBatal) {
          res.status(422).json({ error: "Nota item sudah dibatalkan (void)." });
          return;
        }
        const product = db2.products.find((p) => p.id === items[0].product_id);
        const machine = mesinUtamaCetak(db2, product);
        if (!machine) {
          res.status(422).json({ error: "Mesin cetak aktif belum tersedia." });
          return;
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const id = store.nextId("cetak_grup");
        const grup2 = {
          id,
          kode_grup: `GRP-${now.slice(0, 10).replace(/-/g, "")}-${id}`,
          operator_id: operator.id,
          machine_id: machine.id,
          status: "menunggu",
          tanggal: now.slice(0, 10),
          catatan: body.catatan?.trim() || null,
          created_at: now,
          updated_at: now
        };
        db2.cetak_grup.push(grup2);
        for (const it of items) {
          db2.cetak_grup_item.push({
            id: store.nextId("cetak_grup_item"),
            grup_id: id,
            order_item_id: it.id,
            qty_cetak: Math.max(1, it.qty - (it.qty_tercetak ?? 0)),
            panjang_file_m: null,
            lebar_file_m: null,
            sumber_bahan: "roll",
            roll_id: null,
            cattoff_id: null,
            offcut_id: null,
            offcut_lebar_m: null,
            offcut_panjang_m: null,
            masuk_wos_m2: 0,
            status: "menunggu",
            catatan: null,
            updated_at: now
          });
          it.status_produksi = "siap_tata";
          it.ditata_at = now;
          it.machine_id = machine.id;
          it.operator_id = operator.id;
          it.updated_at = now;
        }
        grupId = id;
        store.persist();
        auditRequest(req, "operator_grup_dibuat", "cetak_grup", id, `${operator.name} membuat grup ${grup2.kode_grup} (${items.length} item).`);
        broadcastEvent("production_updated", { orderId: items[0].order_id });
      }
    );
    if (!grupId) return;
    const db = store.getState();
    const grup = db.cetak_grup.find((g) => g.id === grupId);
    if (!grup) {
      res.status(500).json({ error: "Grup cetak gagal dibuat." });
      return;
    }
    res.json({ grup: hydrateGrupCetak(db, grup) });
  });
  app.patch("/api/operator/grup/:id/item/:itemId", requireAuth(["operator_cetak"]), (req, res) => {
    const body = req.body;
    const db = store.getState();
    const grup = db.cetak_grup.find((g) => g.id === parsePositiveId(req.params.id));
    const gi = db.cetak_grup_item.find((row) => row.id === parsePositiveId(req.params.itemId));
    if (!grup || !gi || gi.grup_id !== grup.id) {
      res.status(404).json({ error: "Item grup tidak ditemukan." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (body.qty_cetak !== void 0) gi.qty_cetak = Math.max(1, Math.floor(Number(body.qty_cetak)));
    if (body.panjang_file_m !== void 0) gi.panjang_file_m = Number(body.panjang_file_m) > 0 ? round22(Number(body.panjang_file_m)) : null;
    if (body.lebar_file_m !== void 0) gi.lebar_file_m = Number(body.lebar_file_m) > 0 ? round22(Number(body.lebar_file_m)) : null;
    if (body.sumber_bahan !== void 0 && ["roll", "cattoff", "offcut"].includes(body.sumber_bahan)) {
      gi.sumber_bahan = body.sumber_bahan;
    }
    if (body.roll_id !== void 0) gi.roll_id = body.roll_id;
    if (body.cattoff_id !== void 0) gi.cattoff_id = body.cattoff_id;
    if (body.offcut_id !== void 0) gi.offcut_id = body.offcut_id;
    if (body.offcut_lebar_m !== void 0) gi.offcut_lebar_m = Number(body.offcut_lebar_m) > 0 ? round22(Number(body.offcut_lebar_m)) : null;
    if (body.offcut_panjang_m !== void 0) gi.offcut_panjang_m = Number(body.offcut_panjang_m) > 0 ? round22(Number(body.offcut_panjang_m)) : null;
    if (body.status !== void 0 && ["menunggu", "selesai", "kendala"].includes(body.status)) gi.status = body.status;
    if (body.catatan !== void 0) gi.catatan = body.catatan?.trim() || null;
    gi.updated_at = now;
    if (grup.status === "menunggu") grup.status = "dalam_proses";
    grup.updated_at = now;
    store.persist();
    res.json({ grup: hydrateGrupCetak(db, grup) });
  });
  app.post("/api/operator/grup/:id/selesai-item", requireAuth(["operator_cetak"]), async (req, res) => {
    const operator = getCurrentUser(req);
    const gid = parsePositiveId(req.params.id);
    const body = req.body;
    const giId = parsePositiveId(body.cetak_grup_item_id);
    if (!gid || !giId) {
      res.status(422).json({ error: "Item grup tidak valid." });
      return;
    }
    const warnaIds = Array.isArray(body.warna_tinta_ids) ? body.warna_tinta_ids : [];
    try {
      await store.critical(
        [
          "order_items",
          "material_rolls",
          "material_offcuts",
          "stok_cattoff",
          "tinta_warna",
          "pemakaian_tinta",
          "material_logs",
          "cetak_grup",
          "cetak_grup_item",
          "audit_logs"
        ],
        () => {
          const db2 = store.getState();
          const grup2 = db2.cetak_grup.find((g) => g.id === gid);
          const gi = db2.cetak_grup_item.find((row) => row.id === giId && row.grup_id === gid);
          if (!grup2 || !gi) throw new Error("HTTP422:Item grup tidak ditemukan.");
          if (gi.status === "selesai") throw new Error("HTTP422:Item grup sudah diselesaikan.");
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const error = prosesSelesaiGrupItem(db2, grup2, gi, now, operator.id, warnaIds);
          if (error) throw new Error(`HTTP422:${error}`);
          const tersisa = db2.cetak_grup_item.some((row) => row.grup_id === gid && row.status !== "selesai");
          grup2.status = tersisa ? "dalam_proses" : "selesai";
          grup2.updated_at = now;
          store.persist();
          auditRequest(req, "operator_grup_item_selesai", "cetak_grup", gid, `${operator.name} menyelesaikan ${gi.qty_cetak} cetakan item ${gi.order_item_id}.`);
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("HTTP422:")) {
        res.status(422).json({ error: message.slice("HTTP422:".length) });
        return;
      }
      res.status(500).json({ error: "Gagal menyelesaikan item grup secara transaksional." });
      return;
    }
    const db = store.getState();
    const grup = db.cetak_grup.find((g) => g.id === gid);
    res.json({ grup: grup ? hydrateGrupCetak(db, grup) : null });
  });
  app.post("/api/operator/grup/:id/selesai", requireAuth(["operator_cetak"]), async (req, res) => {
    const operator = getCurrentUser(req);
    const gid = parsePositiveId(req.params.id);
    if (!gid) {
      res.status(422).json({ error: "Grup tidak valid." });
      return;
    }
    const warnaIds = Array.isArray(req.body.warna_tinta_ids) ? req.body.warna_tinta_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
    try {
      await store.critical(
        [
          "order_items",
          "material_rolls",
          "material_offcuts",
          "stok_cattoff",
          "tinta_warna",
          "pemakaian_tinta",
          "material_logs",
          "cetak_grup",
          "cetak_grup_item",
          "audit_logs"
        ],
        () => {
          const db2 = store.getState();
          const grup2 = db2.cetak_grup.find((g) => g.id === gid);
          if (!grup2) throw new Error("HTTP422:Grup cetak tidak ditemukan.");
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const rows = db2.cetak_grup_item.filter((gi) => gi.grup_id === gid && gi.status !== "selesai");
          if (rows.length === 0) throw new Error("HTTP422:Tidak ada item grup yang perlu diselesaikan.");
          for (const gi of rows) {
            const error = prosesSelesaiGrupItem(db2, grup2, gi, now, operator.id, warnaIds);
            if (error) throw new Error(`HTTP422:${error}`);
          }
          grup2.status = "selesai";
          grup2.updated_at = now;
          store.persist();
          auditRequest(req, "operator_grup_selesai", "cetak_grup", gid, `${operator.name} menyelesaikan grup ${grup2.kode_grup} (${rows.length} item).`);
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("HTTP422:")) {
        res.status(422).json({ error: message.slice("HTTP422:".length) });
        return;
      }
      res.status(500).json({ error: "Gagal menyelesaikan grup secara transaksional." });
      return;
    }
    const db = store.getState();
    const grup = db.cetak_grup.find((g) => g.id === gid);
    res.json({ grup: grup ? hydrateGrupCetak(db, grup) : null });
  });
  app.post("/api/operator/items/:id/gagal-cetak", requireAuth(["operator_cetak"]), async (req, res) => {
    await runTransactional(
      res,
      () => store.critical(["order_items", "material_rolls"], () => {
        const db = store.getState();
        const item = db.order_items.find((i) => i.id === Number(req.params.id));
        if (!item) {
          res.status(404).json({ error: "Item tidak ditemukan." });
          return;
        }
        if (item.status_produksi === "gagal_cetak") {
          res.status(422).json({ error: "Item berstatus Gagal Cetak wajib dimulai cetak ulang sebelum diselesaikan." });
          return;
        }
        if (!["antrean_cetak", "siap_tata", "proses_cetak", "cetak_ulang"].includes(item.status_produksi)) {
          res.status(403).json({ error: "Item tidak berada di antrean cetak." });
          return;
        }
        const { material_roll_id, panjang_rusak_m, alasan } = req.body;
        const roll = db.material_rolls.find((r) => r.id === Number(material_roll_id));
        if (!roll || roll.status !== "aktif") {
          res.status(422).json({ error: "Pilih roll aktif yang mengalami gagal cetak." });
          return;
        }
        const panjangRusak = round22(Number(panjang_rusak_m ?? 0));
        if (!(panjangRusak > 0)) {
          res.status(422).json({ error: "Panjang bahan rusak wajib lebih dari 0 meter." });
          return;
        }
        if (roll.panjang_sisa_m + 1e-3 < panjangRusak) {
          res.status(422).json({ error: "Panjang rusak melebihi sisa roll aktif." });
          return;
        }
        const sisa = round22(roll.panjang_sisa_m - panjangRusak);
        roll.panjang_sisa_m = sisa;
        roll.status = sisa <= 0 ? "habis" : "aktif";
        const luasRusak = round22(roll.lebar_m * panjangRusak);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        db.material_logs.push({
          id: store.nextId("material_logs"),
          order_item_id: item.id,
          material_roll_id: roll.id,
          material_offcut_id: null,
          luas_netto_m2: 0,
          wos_finishing_m2: 0,
          wos_potong_m2: 0,
          gagal_cetak_m2: luasRusak,
          keterangan: `Gagal cetak | Roll ${roll.kode_roll} | ${panjangRusak} m${alasan ? ` (${alasan})` : ""}`,
          created_at: now
        });
        item.status_produksi = "gagal_cetak";
        item.waktu_mulai_cetak = null;
        item.waktu_selesai_cetak = null;
        item.updated_at = now;
        auditRequest(req, "print_failed", "order_item", item.id, `Gagal cetak: ${alasan || "tanpa alasan"}. Roll ${roll.kode_roll} -${panjangRusak}m.`);
        store.persist();
        broadcastEvent("stock_updated", { orderId: item.order_id });
        broadcastEvent("production_updated", { orderId: item.order_id });
        res.json({ message: "Gagal cetak dicatat. Item dikembalikan ke antrean cetak untuk reprint.", item: store.hydrateItem(item) });
      }),
      "Gagal mencatat gagal cetak secara transaksional."
    );
  });
  app.get("/api/operator/batches", requireAuth(["operator_cetak", "owner"]), (_req, res) => {
    const db = store.getState();
    const batches = [...db.print_batches].reverse().map((b) => ({
      ...b,
      machine_name: db.machines.find((m) => m.id === b.machine_id)?.nama_mesin ?? null,
      operator_name: db.users.find((u) => u.id === b.operator_id)?.name ?? null
    }));
    res.json({ batches });
  });
  app.post("/api/operator/batch-nesting", requireAuth(["operator_cetak"]), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const body = req.body;
    const ids = (body.item_ids ?? []).map(Number).filter((n) => Number.isFinite(n));
    if (ids.length < 2 || ids.length > 4) {
      res.status(422).json({ error: "Batch nesting memerlukan 2\u20134 item yang dicentang." });
      return;
    }
    const items = ids.map((id) => db.order_items.find((i) => i.id === id)).filter((i) => Boolean(i));
    if (items.length !== ids.length) {
      res.status(404).json({ error: "Sebagian item batch tidak ditemukan." });
      return;
    }
    const hydrated = items.map((i) => store.hydrateItem(i));
    if (items.some((i) => !["antrean_cetak", "proses_cetak"].includes(i.status_produksi)) || items.some((i) => {
      const order = db.orders.find((o) => o.id === i.order_id);
      return !order || !activeOrderRaw(order);
    }) || hydrated.some((i) => !i.ukuran_kotor || i.product_id !== items[0].product_id)) {
      res.status(422).json({
        error: "Semua item harus aktif, berstatus antrean/proses cetak, bertipe meteran, dan memakai bahan produk yang sama."
      });
      return;
    }
    const machine = db.machines.find(
      (m) => m.id === Number(body.machine_id ?? items[0].machine_id ?? 0) && m.aktif
    );
    if (!machine) {
      res.status(422).json({ error: "Mesin cetak aktif wajib dipilih untuk batch nesting." });
      return;
    }
    const roll = body.material_roll_id ? db.material_rolls.find((r) => r.id === Number(body.material_roll_id) && r.status === "aktif") ?? null : null;
    if (body.material_roll_id && !roll) {
      res.status(422).json({ error: "Roll bahan aktif tidak ditemukan." });
      return;
    }
    const stats = computeBatchNesting(hydrated, roll?.lebar_m ?? null);
    if (roll && stats.lebar_gabungan_m > roll.lebar_m + 1e-3) {
      res.status(422).json({
        error: `Lebar gabungan ${stats.lebar_gabungan_m} m melebihi lebar roll ${roll.lebar_m} m.`
      });
      return;
    }
    if (roll && stats.panjang_tarik_m > roll.panjang_sisa_m + 1e-3) {
      res.status(422).json({
        error: `Sisa roll ${roll.panjang_sisa_m} m tidak cukup untuk tarikan ${stats.panjang_tarik_m} m.`
      });
      return;
    }
    const batch = {
      id: store.nextId("print_batches"),
      kode_batch: `BN-${Date.now().toString(36).toUpperCase()}`,
      machine_id: machine.id,
      operator_id: operator.id,
      item_ids: ids,
      lebar_gabungan_m: stats.lebar_gabungan_m,
      panjang_tarik_m: stats.panjang_tarik_m,
      luas_terpakai_m2: stats.luas_terpakai_m2,
      luas_waste_m2: stats.luas_waste_m2,
      status: "dihitung",
      catatan: body.catatan?.trim() || null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.print_batches.push(batch);
    auditRequest(req, "batch_nesting_created", "batch", batch.id, `Batch ${batch.kode_batch}: ${ids.length} item, lebar ${stats.lebar_gabungan_m} m.`);
    store.persist();
    broadcastEvent("production_updated", { orderId: items[0].order_id });
    res.status(201).json({
      batch: { ...batch, machine_name: machine.nama_mesin, operator_name: operator.name },
      stats,
      items: items.map((i) => ({
        id: i.id,
        no_nota: db.orders.find((o) => o.id === i.order_id)?.no_nota ?? "-"
      }))
    });
  });
  app.post("/api/operator/batches/:id/proses", requireAuth(["operator_cetak"]), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const batch = db.print_batches.find((b) => b.id === Number(req.params.id));
    if (!batch) {
      res.status(404).json({ error: "Batch nesting tidak ditemukan." });
      return;
    }
    if (batch.status === "diproses") {
      res.status(422).json({ error: "Batch ini sudah diproses." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let touchedOrderId = 0;
    for (const itemId of batch.item_ids) {
      const item = db.order_items.find((i) => i.id === itemId);
      if (!item || !["antrean_cetak", "proses_cetak"].includes(item.status_produksi)) continue;
      item.status_produksi = "proses_cetak";
      item.machine_id = batch.machine_id;
      item.operator_id = operator.id;
      item.batch_id = batch.id;
      item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
      item.updated_at = now;
      touchedOrderId = item.order_id;
    }
    batch.status = "diproses";
    auditRequest(req, "batch_nesting_proses", "batch", batch.id, `Batch ${batch.kode_batch} mulai diproses di mesin #${batch.machine_id}.`);
    store.persist();
    broadcastEvent("production_updated", { orderId: touchedOrderId });
    res.json({ batch });
  });
  app.get("/api/finishing/queue", requireAuth(["finishing"]), (_req, res) => {
    const db = store.getState();
    const items = db.order_items.filter((i) => i.status_produksi === "antrean_finishing" || i.status_produksi === "proses_finishing").filter((i) => {
      const order = db.orders.find((o) => o.id === i.order_id);
      return order ? activeOrderRaw(order) : false;
    }).map((i) => {
      const order = db.orders.find((o) => o.id === i.order_id);
      const customer = order ? db.customers.find((c) => c.id === order.customer_id) : null;
      return {
        ...store.hydrateItem(i),
        no_nota: order?.no_nota ?? "-",
        instansi: customer?.instansi ?? "Perorangan",
        nama_pelanggan: customer?.nama_pelanggan ?? "-",
        deadline: order?.deadline ?? null
      };
    });
    res.json({ items });
  });
  app.post("/api/finishing/items/:id/qc", requireAuth(["finishing"]), uploadPhoto.single("foto"), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === parsePositiveId(req.params.id));
    if (!item) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(404).json({ error: "Item tidak ditemukan." });
      return;
    }
    if (!["antrean_finishing", "proses_finishing"].includes(item.status_produksi)) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(403).json({ error: "Item tidak berada di antrean QC finishing." });
      return;
    }
    const body = req.body ?? {};
    const hasil = String(body.hasil ?? "").trim();
    const catatan = String(body.catatan ?? "").trim();
    const statusQc = resolveQcStatus(hasil);
    if (!statusQc) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(422).json({ error: 'Hasil QC wajib "lolos" atau "cacat".' });
      return;
    }
    if (statusQc === "cetak_ulang" && !catatan) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(422).json({ error: "Catatan cacat wajib diisi untuk pengajuan cetak ulang." });
      return;
    }
    if (!req.file) {
      res.status(422).json({ error: "Foto bukti QC wajib diunggah." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    item.status_produksi = statusQc;
    if (statusQc === "cetak_ulang") {
      item.foto_cetak_ulang = `/uploads/${req.file.filename}`;
      item.waktu_mulai_cetak = null;
      item.waktu_selesai_cetak = null;
      item.machine_id = null;
      item.operator_id = null;
      item.qty_tercetak = 0;
    }
    item.updated_at = now;
    auditRequest(
      req,
      hasil === "cacat" ? "finishing_qc_cacat" : "finishing_qc_lolos",
      "order_item",
      item.id,
      `QC finishing oleh ${user.name}: ${hasil}${catatan ? ` | ${catatan}` : ""}${hasil === "cacat" ? " | Bukti cacat tersimpan" : ""}`
    );
    store.persist();
    broadcastEvent("production_updated", { orderId: item.order_id });
    res.json({ item: store.hydrateItem(item) });
  });
  app.post("/api/finishing/items/:id/konfirmasi", requireAuth(["finishing"]), uploadPhoto.single("foto"), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === parsePositiveId(req.params.id));
    if (!item || !["antrean_finishing", "proses_finishing"].includes(item.status_produksi)) {
      if (req.file) cleanupUploadedFiles([req.file]);
      res.status(403).json({ error: "Item tidak berada di antrean finishing." });
      return;
    }
    if (!req.file) {
      res.status(422).json({ error: "Foto bukti finishing wajib diunggah." });
      return;
    }
    const catatan = String(req.body.catatan ?? "").trim();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    item.foto_finishing = `/uploads/${req.file.filename}`;
    item.finishing_user_id = user.id;
    item.status_produksi = "siap_diambil";
    item.updated_at = now;
    auditRequest(
      req,
      "finishing_done",
      "order_item",
      item.id,
      `Finishing diselesaikan oleh ${user.name} dengan bukti foto${catatan ? ` | ${catatan}` : ""}.`
    );
    store.persist();
    broadcastEvent("production_updated", { orderId: item.order_id });
    enqueueSiapDiambil(item.order_id);
    res.json({ item: store.hydrateItem(item), foto_finishing: item.foto_finishing });
  });
  app.get("/api/advertising/spks", requireAuth(["advertising", "owner", "admin"]), (req, res) => {
    const db = store.getState();
    const statusFilter = String(req.query.status ?? "");
    let spks = db.advertising_spks.map((s) => {
      const order = db.orders.find((o) => o.id === s.order_id);
      const customer = order ? db.customers.find((c) => c.id === order.customer_id) : null;
      return {
        ...s,
        no_nota: order?.no_nota ?? "-",
        instansi: customer?.instansi ?? "Perorangan",
        nama_pelanggan: customer?.nama_pelanggan ?? "-",
        deadline: order?.deadline ?? null
      };
    });
    if (statusFilter) {
      spks = spks.filter((s) => s.status_lapangan === statusFilter);
    }
    spks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ spks });
  });
  app.post("/api/advertising/spks/:id/status", requireAuth(["advertising"]), (req, res) => {
    const db = store.getState();
    const spk = db.advertising_spks.find((s) => s.id === Number(req.params.id));
    if (!spk) {
      res.status(404).json({ error: "SPK tidak ditemukan." });
      return;
    }
    const status = req.body.status_lapangan;
    if (!status || !["antrean", "perakitan", "pemasangan", "selesai"].includes(status)) {
      res.status(422).json({ error: "Status lapangan SPK tidak valid." });
      return;
    }
    spk.status_lapangan = status;
    spk.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    store.persist();
    broadcastEvent("spk_updated", { orderId: spk.order_id });
    res.json({ spk });
  });
  app.get("/api/serah-terima", requireAuth(["admin", "desainer", "operator_cetak", "finishing", "advertising"]), (req, res) => {
    const user = getCurrentUser(req);
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const db = store.getState();
    let orders = db.orders.map((o) => store.hydrateOrder(o)).filter((o) => store.isOrderSiapDiambil(o));
    if (q) {
      orders = orders.filter(
        (o) => o.no_nota.toLowerCase().includes(q) || (o.customer?.instansi ?? "").toLowerCase().includes(q) || (o.customer?.nama_pelanggan ?? "").toLowerCase().includes(q)
      );
    }
    if (user.role === "advertising") {
      orders = orders.map((o) => ({
        ...o,
        total_tagihan: 0,
        jumlah_dp: 0,
        sisa_tagihan: 0,
        payments: [],
        items: o.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 }))
      }));
    }
    res.json({ orders });
  });
  app.post(
    "/api/orders/:id/serah-terima",
    requireAuth(["admin", "desainer", "operator_cetak", "finishing", "advertising"]),
    upload.single("foto_serah_terima"),
    (req, res) => {
      const db = store.getState();
      const order = db.orders.find((o) => o.id === Number(req.params.id));
      if (!order) {
        res.status(404).json({ error: "Nota tidak ditemukan." });
        return;
      }
      if (order.status_bayar !== "lunas") {
        res.status(403).json({ error: "Pelunasan wajib sebelum serah terima." });
        return;
      }
      const hydrated = store.hydrateOrder(order);
      if (!store.isOrderSiapDiambil(hydrated)) {
        res.status(403).json({ error: "Nota ini belum siap diambil atau sudah diserahkan." });
        return;
      }
      const { nama_pengambil, no_wa_pengambil, catatan_pengecualian, tanda_tangan_pengambil, kurir_nama, resi_pengiriman } = req.body;
      if (!nama_pengambil?.trim() || !no_wa_pengambil?.trim()) {
        res.status(422).json({ error: "Nama pengambil dan No. WhatsApp pengambil wajib diisi." });
        return;
      }
      let signature = null;
      if (typeof tanda_tangan_pengambil === "string" && tanda_tangan_pengambil.trim()) {
        const value = tanda_tangan_pengambil.trim();
        if (!/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=\s]+$/.test(value) || value.length > 3e6) {
          res.status(422).json({ error: "Tanda tangan pengambil harus berupa gambar PNG/JPG yang valid (maks. 2 MB)." });
          return;
        }
        signature = value;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      order.nama_pengambil = nama_pengambil.trim();
      order.no_wa_pengambil = no_wa_pengambil.trim();
      order.kurir_nama = kurir_nama?.trim() || null;
      order.resi_pengiriman = resi_pengiriman?.trim() || null;
      order.waktu_serah_terima = now;
      order.tanda_tangan_pengambil = signature;
      if (req.file) {
        order.foto_serah_terima = `/uploads/${req.file.filename}`;
      }
      if (catatan_pengecualian?.trim()) {
        order.catatan_pengecualian = catatan_pengecualian.trim();
      }
      order.updated_at = now;
      for (const item of db.order_items) {
        if (item.order_id === order.id && item.status_produksi === "siap_diambil") {
          item.status_produksi = "selesai";
          item.updated_at = now;
        }
      }
      auditRequest(req, "serah_terima", "order", order.id, `Serah terima kepada ${nama_pengambil.trim()}${signature ? " dengan tanda tangan digital" : ""}.`);
      store.persist();
      broadcastEvent("order_handed_over", { orderId: order.id });
      res.json({ order: store.hydrateOrder(order) });
    }
  );
  app.get("/api/riwayat/:divisi", requireAuth(), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const divisi = req.params.divisi;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    let orders = db.orders.map((o) => store.hydrateOrder(o));
    if (divisi === "desainer") {
      orders = orders.filter((o) => Boolean(o.file_master_arsip));
    } else if (divisi === "operator") {
      orders = orders.filter(
        (o) => o.items.some((i) => ["antrean_finishing", "proses_finishing", "siap_diambil", "selesai"].includes(i.status_produksi))
      );
    } else if (divisi === "finishing") {
      orders = orders.filter(
        (o) => o.items.some((i) => i.finishing_id !== null && ["siap_diambil", "selesai"].includes(i.status_produksi))
      );
    } else if (divisi === "advertising") {
      orders = orders.filter((o) => o.advertising_spks.some((s) => s.status_lapangan === "selesai"));
    }
    if (q) {
      orders = orders.filter(
        (o) => o.no_nota.toLowerCase().includes(q) || (o.customer?.instansi ?? "").toLowerCase().includes(q) || (o.customer?.nama_pelanggan ?? "").toLowerCase().includes(q)
      );
    }
    if (actor.role === "advertising") {
      orders = orders.map((o) => ({
        ...o,
        total_tagihan: 0,
        jumlah_dp: 0,
        sisa_tagihan: 0,
        payments: [],
        items: o.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 }))
      }));
    }
    res.json({ orders });
  });
  app.get("/api/owner/staff", requireAuth(["owner"]), (_req, res) => {
    res.json({ staff: store.getState().users.map(sanitizeUser) });
  });
  app.post("/api/owner/staff", requireAuth(["owner"]), (req, res) => {
    const actor = getCurrentUser(req);
    const body = req.body;
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const role = body.role;
    const validRoles = ["admin", "desainer", "operator_cetak", "finishing", "advertising", "owner"];
    if (!name || !email || !password || !role) {
      res.status(422).json({ error: "Nama, email, kata sandi, dan peran wajib diisi." });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(422).json({ error: "Format email tidak valid." });
      return;
    }
    if (password.length < 6) {
      res.status(422).json({ error: "Kata sandi minimal 6 karakter." });
      return;
    }
    if (!validRoles.includes(role)) {
      res.status(422).json({ error: "Peran staf tidak valid." });
      return;
    }
    const db = store.getState();
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      res.status(422).json({ error: `Email ${email} sudah terdaftar.` });
      return;
    }
    const user = {
      id: store.nextId("users"),
      name,
      email,
      role,
      password: hashPassword(password),
      active: body.active !== false
    };
    db.users.push(user);
    recordAudit(actor, "staff_create", "user", user.id, `Staf ${name} (${role}) ditambahkan`, clientIp(req));
    store.persist();
    res.status(201).json({ staff: sanitizeUser(user) });
  });
  app.put("/api/owner/staff/:id", requireAuth(["owner"]), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const target = db.users.find((u) => u.id === Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "Akun staf tidak ditemukan." });
      return;
    }
    const body = req.body;
    const validRoles = ["admin", "desainer", "operator_cetak", "finishing", "advertising", "owner"];
    if (body.email !== void 0) {
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(422).json({ error: "Format email tidak valid." });
        return;
      }
      if (db.users.some((u) => u.id !== target.id && u.email.toLowerCase() === email)) {
        res.status(422).json({ error: `Email ${email} sudah digunakan staf lain.` });
        return;
      }
      target.email = email;
    }
    if (body.name !== void 0) {
      const name = body.name.trim();
      if (!name) {
        res.status(422).json({ error: "Nama staf tidak boleh kosong." });
        return;
      }
      target.name = name;
    }
    if (body.role !== void 0) {
      if (!validRoles.includes(body.role)) {
        res.status(422).json({ error: "Peran staf tidak valid." });
        return;
      }
      target.role = body.role;
    }
    if (body.active !== void 0) {
      if (target.id === actor.id && body.active === false) {
        res.status(422).json({ error: "Anda tidak dapat menonaktifkan akun sendiri." });
        return;
      }
      if (target.role === "owner" && body.active === false) {
        const ownerAktif = db.users.filter((u) => u.role === "owner" && u.active !== false);
        if (ownerAktif.length <= 1) {
          res.status(422).json({ error: "Minimal harus ada satu akun Owner yang aktif." });
          return;
        }
      }
      target.active = Boolean(body.active);
    }
    if (body.password) {
      if (body.password.length < 6) {
        res.status(422).json({ error: "Kata sandi minimal 6 karakter." });
        return;
      }
      target.password = hashPassword(body.password);
    }
    recordAudit(actor, "staff_update", "user", target.id, `Akun ${target.name} diperbarui`, clientIp(req));
    store.persist();
    res.json({ staff: sanitizeUser(target) });
  });
  app.delete("/api/owner/staff/:id", requireAuth(["owner"]), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const target = db.users.find((u) => u.id === Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "Akun staf tidak ditemukan." });
      return;
    }
    if (target.id === actor.id) {
      res.status(422).json({ error: "Anda tidak dapat menghapus akun sendiri." });
      return;
    }
    if (target.role === "owner") {
      const ownerAktif = db.users.filter((u) => u.role === "owner" && u.active !== false);
      if (ownerAktif.length <= 1) {
        res.status(422).json({ error: "Minimal harus ada satu akun Owner yang aktif." });
        return;
      }
    }
    target.active = false;
    recordAudit(actor, "staff_deactivate", "user", target.id, `Akun ${target.name} dinonaktifkan`, clientIp(req));
    store.persist();
    res.json({ staff: sanitizeUser(target), deactivated: true });
  });
  app.get("/api/owner/audit-logs", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const action = String(req.query.action ?? "").trim();
    const entity = String(req.query.entity ?? "").trim();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 200), 1), 1e3);
    let logs = [...db.audit_logs];
    if (action) logs = logs.filter((l) => l.action === action);
    if (entity) logs = logs.filter((l) => l.entity === entity);
    if (dari) logs = logs.filter((l) => l.created_at.slice(0, 10) >= dari);
    if (sampai) logs = logs.filter((l) => l.created_at.slice(0, 10) <= sampai);
    logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ logs: logs.slice(0, limit), total: logs.length });
  });
  app.get("/api/owner/reports/finance", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    const inRange = (iso) => (!dari || iso.slice(0, 10) >= dari) && (!sampai || iso.slice(0, 10) <= sampai);
    const allOrders = db.orders.map((o) => store.hydrateOrder(o));
    const activeOrders = allOrders.filter((o) => activeOrderRaw(o));
    const rangeOrders = activeOrders.filter((o) => inRange(o.created_at));
    const activeOrderIds = new Set(activeOrders.map((o) => o.id));
    const rangeOrderIds = new Set(rangeOrders.map((o) => o.id));
    const payments = db.order_payments.filter(
      (p) => activeOrderIds.has(p.order_id) && inRange(p.created_at)
    );
    const sumBy = (metode) => round22(payments.filter((p) => p.metode === metode).reduce((s, p) => s + p.nominal, 0));
    const cashflow = {
      tunai: sumBy("Tunai"),
      transfer: sumBy("Transfer"),
      qris: sumBy("QRIS"),
      total: round22(payments.reduce((s, p) => s + p.nominal, 0)),
      jumlah_transaksi: payments.length
    };
    const dailyMap = /* @__PURE__ */ new Map();
    for (const p of payments) {
      const key = p.created_at.slice(0, 10);
      if (!dailyMap.has(key)) {
        dailyMap.set(key, { tanggal: key, tunai: 0, transfer: 0, qris: 0, total: 0 });
      }
      const row = dailyMap.get(key);
      if (p.metode === "Tunai") row.tunai = round22(row.tunai + p.nominal);
      if (p.metode === "Transfer") row.transfer = round22(row.transfer + p.nominal);
      if (p.metode === "QRIS") row.qris = round22(row.qris + p.nominal);
      row.total = round22(row.total + p.nominal);
    }
    const cashflowHarian = Array.from(dailyMap.values()).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    const today = /* @__PURE__ */ new Date();
    const piutang = activeOrders.filter((o) => o.sisa_tagihan > 0).map((o) => {
      const due = o.jatuh_tempo ? new Date(o.jatuh_tempo) : new Date(new Date(o.created_at).getTime() + 30 * 864e5);
      const umurHari = Math.floor((today.getTime() - due.getTime()) / 864e5);
      const bucket = umurHari <= 0 ? "lancar" : umurHari <= 30 ? "1-30" : umurHari <= 60 ? "31-60" : umurHari <= 90 ? "61-90" : ">90";
      return {
        order_id: o.id,
        no_nota: o.no_nota,
        instansi: o.customer?.instansi ?? "Perorangan",
        nama_pelanggan: o.customer?.nama_pelanggan ?? "-",
        total_tagihan: o.total_tagihan,
        dibayar: o.jumlah_dp,
        sisa_tagihan: o.sisa_tagihan,
        jatuh_tempo: o.jatuh_tempo,
        umur_hari: umurHari,
        bucket
      };
    }).sort((a, b) => b.umur_hari - a.umur_hari);
    const aging = {
      lancar: round22(piutang.filter((p) => p.bucket === "lancar").reduce((s, p) => s + p.sisa_tagihan, 0)),
      "1-30": round22(piutang.filter((p) => p.bucket === "1-30").reduce((s, p) => s + p.sisa_tagihan, 0)),
      "31-60": round22(piutang.filter((p) => p.bucket === "31-60").reduce((s, p) => s + p.sisa_tagihan, 0)),
      "61-90": round22(piutang.filter((p) => p.bucket === "61-90").reduce((s, p) => s + p.sisa_tagihan, 0)),
      ">90": round22(piutang.filter((p) => p.bucket === ">90").reduce((s, p) => s + p.sisa_tagihan, 0)),
      total: round22(piutang.reduce((s, p) => s + p.sisa_tagihan, 0))
    };
    const marginMap = /* @__PURE__ */ new Map();
    for (const item of db.order_items) {
      if (!rangeOrderIds.has(item.order_id)) continue;
      const product = db.products.find((p) => p.id === item.product_id);
      if (!product) continue;
      const key = String(product.id);
      if (!marginMap.has(key)) {
        marginMap.set(key, { product_id: product.id, product_name: product.nama_produk, qty: 0, omzet: 0, hpp: 0, margin: 0, margin_persen: 0 });
      }
      const row = marginMap.get(key);
      const qtyBasis = product.kategori_produk === "meteran" ? item.luas_tagihan_m2 ?? 0 : item.qty;
      row.qty = round22(row.qty + qtyBasis);
      row.omzet = round22(row.omzet + item.subtotal);
      row.hpp = round22(row.hpp + qtyBasis * product.harga_modal);
    }
    const margins = Array.from(marginMap.values()).map((row) => ({
      ...row,
      margin: round22(row.omzet - row.hpp),
      margin_persen: row.omzet > 0 ? round22((row.omzet - row.hpp) / row.omzet * 100) : 0
    })).sort((a, b) => b.margin - a.margin);
    const komisiPersen = Math.max(0, Number(process.env.KOMISI_PERSEN ?? 1));
    const commissionMap = /* @__PURE__ */ new Map();
    for (const o of rangeOrders) {
      const user = db.users.find((u) => u.id === o.user_id);
      if (!commissionMap.has(o.user_id)) {
        commissionMap.set(o.user_id, {
          user_id: o.user_id,
          user_name: user?.name ?? o.admin_name ?? "Admin",
          role: user?.role ?? "admin",
          jumlah_nota: 0,
          omzet: 0,
          komisi: 0
        });
      }
      const row = commissionMap.get(o.user_id);
      row.jumlah_nota += 1;
      row.omzet = round22(row.omzet + o.total_tagihan);
    }
    const komisi = Array.from(commissionMap.values()).map((row) => ({ ...row, komisi: round22(row.omzet * komisiPersen / 100) })).sort((a, b) => b.komisi - a.komisi);
    const expenses = db.operational_expenses.filter((e) => (!dari || e.tanggal >= dari) && (!sampai || e.tanggal <= sampai));
    const omzet = round22(rangeOrders.reduce((s, o) => s + o.total_tagihan, 0));
    const hpp = round22(margins.reduce((s, m) => s + m.hpp, 0));
    const totalOperasional = round22(expenses.reduce((s, e) => s + e.nominal, 0));
    res.json({
      dari,
      sampai,
      ringkasan: {
        omzet,
        jumlah_nota: rangeOrders.length,
        cash_masuk: cashflow.total,
        piutang: aging.total,
        hpp,
        laba_kotor: round22(omzet - hpp),
        total_operasional: totalOperasional,
        laba_bersih: round22(omzet - hpp - totalOperasional),
        komisi_persen: komisiPersen
      },
      cashflow,
      cashflow_harian: cashflowHarian,
      aging,
      piutang,
      hutang: {
        total: round22(
          db.purchase_orders.filter((po) => po.status === "diterima").reduce((s, po) => s + Math.max(0, round22(po.total - (po.sudah_dibayar ?? 0))), 0)
        ),
        items: db.purchase_orders.filter((po) => po.status === "diterima" && round22(po.total - (po.sudah_dibayar ?? 0)) > 0).map((po) => {
          const due = po.expected_at ? new Date(po.expected_at) : new Date(new Date(po.tanggal).getTime() + 30 * 864e5);
          const umurHari = Math.floor((today.getTime() - due.getTime()) / 864e5);
          return {
            purchase_order_id: po.id,
            no_po: po.no_po,
            supplier: db.suppliers.find((s) => s.id === po.supplier_id)?.nama_supplier ?? "-",
            total: po.total,
            dibayar: po.sudah_dibayar ?? 0,
            sisa: round22(po.total - (po.sudah_dibayar ?? 0)),
            jatuh_tempo: po.expected_at,
            umur_hari: umurHari
          };
        }).sort((a, b) => b.umur_hari - a.umur_hari),
        catatan: "Hutang dagang dari Purchase Order yang sudah diterima dan belum lunas."
      },
      margins,
      komisi
    });
  });
  app.get("/api/owner/reports/export", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const type = String(req.query.type ?? "orders");
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    const inRange = (iso) => (!dari || iso.slice(0, 10) >= dari) && (!sampai || iso.slice(0, 10) <= sampai);
    const orders = db.orders.map((o) => store.hydrateOrder(o)).filter((o) => activeOrderRaw(o) && inRange(o.created_at));
    let csv = "";
    let filename = "reffo-export.csv";
    if (type === "payments") {
      const ids = new Set(orders.map((o) => o.id));
      const payments = db.order_payments.filter((p) => ids.has(p.order_id) && inRange(p.created_at));
      csv = toCsv(
        ["Tanggal", "No Nota", "Metode", "Nominal", "Keterangan", "Admin", "Shift ID"],
        payments.map((p) => {
          const order = orders.find((o) => o.id === p.order_id);
          return [
            p.tanggal,
            order?.no_nota ?? "-",
            p.metode,
            p.nominal,
            p.keterangan ?? "",
            db.users.find((u) => u.id === p.admin_id)?.name ?? "Admin",
            p.shift_id ?? ""
          ];
        })
      );
      filename = `reffo-pembayaran-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "piutang") {
      csv = toCsv(
        ["No Nota", "Instansi", "Pelanggan", "Total", "Dibayar", "Sisa", "Jatuh Tempo", "Status"],
        orders.filter((o) => o.sisa_tagihan > 0).map((o) => [
          o.no_nota,
          o.customer?.instansi ?? "Perorangan",
          o.customer?.nama_pelanggan ?? "-",
          o.total_tagihan,
          o.jumlah_dp,
          o.sisa_tagihan,
          o.jatuh_tempo ?? "",
          o.status_bayar
        ])
      );
      filename = `reffo-piutang-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "supplier") {
      csv = toCsv(
        ["Kode", "Nama Supplier", "Kontak", "No WA", "Alamat", "NPWP", "Status", "Dibuat"],
        db.suppliers.map((s) => [
          s.kode_supplier,
          s.nama_supplier,
          s.kontak ?? "",
          s.no_wa ?? "",
          s.alamat ?? "",
          s.npwp ?? "",
          s.aktif ? "Aktif" : "Nonaktif",
          s.created_at.slice(0, 10)
        ])
      );
      filename = `reffo-supplier-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "po" || type === "hutang") {
      const rows = db.purchase_orders.filter((po) => inRange(po.tanggal)).filter((po) => type !== "hutang" || po.status === "diterima" && round22(po.total - (po.sudah_dibayar ?? 0)) > 0).map((po) => [
        po.no_po,
        po.tanggal.slice(0, 10),
        db.suppliers.find((s) => s.id === po.supplier_id)?.nama_supplier ?? "-",
        po.status,
        po.total,
        po.sudah_dibayar ?? 0,
        round22(po.total - (po.sudah_dibayar ?? 0)),
        po.expected_at ? po.expected_at.slice(0, 10) : "",
        po.diterima_at ? po.diterima_at.slice(0, 10) : "",
        po.catatan ?? ""
      ]);
      csv = toCsv(
        ["No PO", "Tanggal", "Supplier", "Status", "Total", "Dibayar", "Sisa Hutang", "Estimasi Terima", "Diterima", "Catatan"],
        rows
      );
      filename = `reffo-${type === "hutang" ? "hutang" : "purchase-order"}-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "audit") {
      csv = toCsv(
        ["Waktu", "User", "Role", "Aksi", "Entitas", "ID Entitas", "Detail", "IP"],
        db.audit_logs.filter((l) => inRange(l.created_at)).slice(0, 5e3).map((l) => [
          l.created_at,
          l.user_name,
          l.role,
          l.action,
          l.entity,
          l.entity_id ?? "",
          l.detail,
          l.ip ?? ""
        ])
      );
      filename = `reffo-audit-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "production") {
      csv = toCsv(
        ["No Nota", "Produk", "Status Produksi", "Qty", "Luas (m2)", "Klik", "Mesin", "Operator", "Finishing", "Deadline"],
        db.order_items.filter((i) => orders.some((o) => o.id === i.order_id)).map((i) => {
          const item = store.hydrateItem(i);
          const order = orders.find((o) => o.id === i.order_id);
          return [
            order?.no_nota ?? "-",
            item.product_name,
            item.status_produksi,
            item.qty,
            item.luas_tagihan_m2 ?? "",
            item.klik_total ?? "",
            item.machine_name ?? "",
            item.operator_name ?? "",
            item.finishing_user_name ?? "",
            order?.deadline ? order.deadline.slice(0, 10) : ""
          ];
        })
      );
      filename = `reffo-produksi-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "stock") {
      const rows = [];
      for (const p of db.products) {
        rows.push(["Produk", p.id, p.nama_produk, p.stok_pcs ?? 0, p.satuan_hitung ?? "pcs", p.harga_modal, p.harga_umum, p.kategori_produk]);
      }
      for (const s of db.supplies) {
        rows.push(["Bahan Pembantu", s.kode, s.nama, s.stok, s.satuan, s.harga_satuan, "", s.kategori]);
      }
      for (const r of db.material_rolls) {
        rows.push(["Roll", r.kode_roll, `${r.jenis_bahan} ${r.lebar_m}m`, r.panjang_sisa_m, "meter", "", "", r.status]);
      }
      csv = toCsv(["Jenis", "Kode", "Nama", "Stok", "Satuan", "HPP/Harga", "Harga Jual", "Keterangan"], rows);
      filename = `reffo-stok-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "insentif") {
      const laporan = hitungInsentif(db, tanggalQuery(dari), tanggalQuery(sampai));
      csv = toCsv(
        ["Staf", "Peran", "Total Item", "Item Selesai", "Job Selesai", "Tarif Item (Rp)", "Tarif Job (Rp)", "Insentif Item (Rp)", "Insentif Job (Rp)", "Total Insentif (Rp)"],
        laporan.staf.map((row) => [
          row.nama,
          row.role,
          row.total_item,
          row.item_selesai,
          row.job_selesai,
          row.tarif_item,
          row.tarif_job,
          row.insentif_item,
          row.insentif_job,
          row.total_insentif
        ])
      );
      filename = `reffo-insentif-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "reklame") {
      const hari = Math.min(365, Math.max(0, Number(req.query.hari ?? PAJAK_REKLAME_HARI)));
      const { items } = hitungPajakReklame(db, hari);
      csv = toCsv(
        ["Instansi", "Tanggal Berlaku Awal", "Jatuh Tempo Berikutnya", "Tahun", "Hari Tersisa", "No WA", "PIC"],
        items.map((row) => [
          row.nama_instansi,
          row.pajak_reklame_expired ?? "",
          row.jatuh_tempo_berikutnya,
          row.tahun,
          row.hari_tersisa,
          row.no_wa,
          row.nama_pelanggan ?? ""
        ])
      );
      filename = `reffo-pajak-reklame-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    } else if (type === "profit_produk" || type === "profit_pelanggan") {
      const laporan = hitungProfitabilitas(db, tanggalQuery(dari), tanggalQuery(sampai));
      if (type === "profit_produk") {
        csv = toCsv(
          ["Produk", "Kategori", "Jumlah Item", "Qty", "Omzet (Rp)", "HPP (Rp)", "Laba Kotor (Rp)", "Margin (%)"],
          laporan.per_produk.map((row) => [
            row.nama_produk,
            row.kategori_produk,
            row.jumlah_item,
            row.qty,
            row.omzet,
            row.hpp,
            row.laba_kotor,
            row.margin_persen
          ])
        );
        filename = `reffo-profit-produk-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
      } else {
        csv = toCsv(
          ["Instansi", "Jumlah Nota", "Jumlah Item", "Omzet Item (Rp)", "HPP (Rp)", "Laba Kotor (Rp)", "Margin (%)", "Total Tagihan (Rp)", "Piutang (Rp)"],
          laporan.per_klien.map((row) => [
            row.instansi,
            row.jumlah_nota,
            row.jumlah_item,
            row.omzet,
            row.hpp,
            row.laba_kotor,
            row.margin_persen,
            row.total_tagihan,
            row.piutang
          ])
        );
        filename = `reffo-profit-pelanggan-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
      }
    } else {
      csv = toCsv(
        ["No Nota", "Tanggal", "Instansi", "Pelanggan", "DPP", "Diskon", "PPN", "PPh23", "Total", "Dibayar", "Sisa", "Status Bayar", "Status Nota", "Jatuh Tempo"],
        orders.map((o) => [
          o.no_nota,
          o.created_at.slice(0, 10),
          o.customer?.instansi ?? "Perorangan",
          o.customer?.nama_pelanggan ?? "-",
          round22(o.total_tagihan - (o.ppn_nominal ?? 0) + (o.pph23_nominal ?? 0)),
          o.diskon_nominal ?? 0,
          o.ppn_nominal ?? 0,
          o.pph23_nominal ?? 0,
          o.total_tagihan,
          o.jumlah_dp,
          o.sisa_tagihan,
          o.status_bayar,
          o.status_nota ?? "aktif",
          o.jatuh_tempo ?? ""
        ])
      );
      filename = `reffo-nota-${dari ?? "awal"}-${sampai ?? "akhir"}.csv`;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
  });
  function rincianPoItem(input, poId) {
    const db = store.getState();
    const jenis = input.jenis;
    const referensiId = Number(input.referensi_id ?? 0);
    const qty = round22(Number(input.qty ?? 0));
    const hargaSatuan = round22(Number(input.harga_satuan ?? 0));
    if (!jenis || !["roll", "supply", "produk"].includes(jenis)) {
      return { error: "Jenis barang PO tidak valid." };
    }
    if (!(referensiId > 0) || !(qty > 0) || !(hargaSatuan >= 0)) {
      return { error: "Barang PO memerlukan referensi, qty lebih dari 0, dan harga satuan valid." };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const base = {
      id: 0,
      po_id: poId,
      jenis,
      referensi_id: referensiId,
      qty,
      harga_satuan: hargaSatuan,
      subtotal: round22(qty * hargaSatuan),
      created_at: now
    };
    if (jenis === "roll") {
      const roll = db.material_rolls.find((r) => r.id === referensiId);
      if (!roll) return { error: `Roll dengan ID ${referensiId} tidak ditemukan.` };
      return { item: { ...base, nama_barang: roll.jenis_bahan, kode_roll: roll.kode_roll, jenis_bahan: roll.jenis_bahan, lebar_m: roll.lebar_m, satuan: "meter" } };
    }
    if (jenis === "supply") {
      const supply = db.supplies.find((s) => s.id === referensiId);
      if (!supply) return { error: `Bahan pembantu dengan ID ${referensiId} tidak ditemukan.` };
      return { item: { ...base, nama_barang: supply.nama, kode_roll: null, jenis_bahan: null, lebar_m: null, satuan: supply.satuan } };
    }
    const product = db.products.find((p) => p.id === referensiId);
    if (!product) return { error: `Produk dengan ID ${referensiId} tidak ditemukan.` };
    return { item: { ...base, nama_barang: product.nama_produk, kode_roll: null, jenis_bahan: null, lebar_m: null, satuan: product.satuan_hitung ?? "pcs" } };
  }
  function poWithSupplier(po) {
    const db = store.getState();
    return {
      ...po,
      supplier_name: db.suppliers.find((s) => s.id === po.supplier_id)?.nama_supplier ?? "-",
      sisa_hutang: round22(po.total - (po.sudah_dibayar ?? 0))
    };
  }
  app.get("/api/owner/suppliers", requireAuth(["owner"]), (_req, res) => {
    const db = store.getState();
    const suppliers = db.suppliers.map((s) => ({
      ...s,
      jumlah_po: db.purchase_orders.filter((po) => po.supplier_id === s.id).length,
      total_hutang: round22(
        db.purchase_orders.filter((po) => po.supplier_id === s.id && po.status === "diterima").reduce((sum, po) => sum + Math.max(0, po.total - (po.sudah_dibayar ?? 0)), 0)
      )
    })).sort((a, b) => a.kode_supplier.localeCompare(b.kode_supplier));
    res.json({ suppliers });
  });
  app.post("/api/owner/suppliers", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const body = req.body;
    const nama = String(body.nama_supplier ?? "").trim();
    if (!nama) {
      res.status(422).json({ error: "Nama supplier wajib diisi." });
      return;
    }
    const id = store.nextId("suppliers");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const supplier = {
      id,
      kode_supplier: String(body.kode_supplier ?? "").trim() || `SUP-${String(id).padStart(2, "0")}`,
      nama_supplier: nama,
      kontak: body.kontak ? String(body.kontak).trim() : null,
      no_wa: body.no_wa ? String(body.no_wa).trim() : null,
      alamat: body.alamat ? String(body.alamat).trim() : null,
      npwp: body.npwp ? String(body.npwp).trim() : null,
      aktif: body.aktif !== false,
      created_at: now,
      updated_at: now
    };
    if (db.suppliers.some((s) => s.kode_supplier === supplier.kode_supplier)) {
      res.status(422).json({ error: "Kode supplier sudah digunakan." });
      return;
    }
    db.suppliers.push(supplier);
    auditRequest(req, "supplier_create", "supplier", supplier.id, `Supplier ${supplier.nama_supplier} ditambahkan.`);
    store.persist();
    res.status(201).json({ supplier });
  });
  app.put("/api/owner/suppliers/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const supplier = db.suppliers.find((s) => s.id === Number(req.params.id));
    if (!supplier) {
      res.status(404).json({ error: "Supplier tidak ditemukan." });
      return;
    }
    const body = req.body;
    const nama = String(body.nama_supplier ?? "").trim();
    if (!nama) {
      res.status(422).json({ error: "Nama supplier wajib diisi." });
      return;
    }
    const kode = String(body.kode_supplier ?? supplier.kode_supplier).trim();
    if (db.suppliers.some((s) => s.id !== supplier.id && s.kode_supplier === kode)) {
      res.status(422).json({ error: "Kode supplier sudah digunakan." });
      return;
    }
    supplier.kode_supplier = kode;
    supplier.nama_supplier = nama;
    supplier.kontak = body.kontak ? String(body.kontak).trim() : null;
    supplier.no_wa = body.no_wa ? String(body.no_wa).trim() : null;
    supplier.alamat = body.alamat ? String(body.alamat).trim() : null;
    supplier.npwp = body.npwp ? String(body.npwp).trim() : null;
    supplier.aktif = body.aktif !== false;
    supplier.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "supplier_update", "supplier", supplier.id, `Supplier ${supplier.nama_supplier} diperbarui.`);
    store.persist();
    res.json({ supplier });
  });
  app.post("/api/owner/suppliers/:id/nonaktif", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const supplier = db.suppliers.find((s) => s.id === Number(req.params.id));
    if (!supplier) {
      res.status(404).json({ error: "Supplier tidak ditemukan." });
      return;
    }
    supplier.aktif = false;
    supplier.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "supplier_nonaktif", "supplier", supplier.id, `Supplier ${supplier.nama_supplier} dinonaktifkan.`);
    store.persist();
    res.json({ supplier });
  });
  app.get("/api/owner/purchase-orders", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const status = String(req.query.status ?? "");
    let list = db.purchase_orders.map(poWithSupplier);
    if (status) list = list.filter((po) => po.status === status);
    list.sort((a, b) => new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime() || b.id - a.id);
    res.json({ purchase_orders: list });
  });
  app.get("/api/owner/purchase-orders/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: "Purchase order tidak ditemukan." });
      return;
    }
    res.json({
      purchase_order: poWithSupplier(po),
      goods_receipts: db.goods_receipts.filter((gr) => gr.po_id === po.id),
      payments: db.supplier_payments.filter((p) => p.purchase_order_id === po.id)
    });
  });
  app.post("/api/owner/purchase-orders", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const body = req.body;
    const supplierId = Number(body.supplier_id ?? 0);
    const supplier = db.suppliers.find((s) => s.id === supplierId);
    if (!supplier || !supplier.aktif) {
      res.status(422).json({ error: "Supplier aktif tidak ditemukan." });
      return;
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(422).json({ error: "Minimal satu barang harus ditambahkan ke PO." });
      return;
    }
    const poId = store.nextId("purchase_orders");
    const items = [];
    for (const raw of body.items) {
      const result = rincianPoItem(raw, poId);
      if (result.error || !result.item) {
        res.status(422).json({ error: result.error ?? "Barang PO tidak valid." });
        return;
      }
      result.item.id = store.nextId("purchase_order_items");
      items.push(result.item);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tanggal = String(body.tanggal ?? now.slice(0, 10));
    const po = {
      id: poId,
      no_po: `PO-${tanggal.slice(0, 10).replace(/-/g, "")}-${String(poId).padStart(3, "0")}`,
      supplier_id: supplierId,
      tanggal,
      expected_at: body.expected_at ? String(body.expected_at) : null,
      status: "draft",
      catatan: body.catatan ? String(body.catatan).trim() : null,
      total: round22(items.reduce((sum, item) => sum + item.subtotal, 0)),
      sudah_dibayar: 0,
      hutang: 0,
      diterima_at: null,
      created_at: now,
      updated_at: now,
      items
    };
    db.purchase_orders.push(po);
    auditRequest(req, "po_create", "purchase_order", po.id, `PO ${po.no_po} dibuat untuk ${supplier.nama_supplier}.`);
    store.persist();
    res.status(201).json({ purchase_order: poWithSupplier(po) });
  });
  app.put("/api/owner/purchase-orders/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: "Purchase order tidak ditemukan." });
      return;
    }
    if (po.status !== "draft") {
      res.status(422).json({ error: "PO hanya dapat diubah saat masih berstatus draft." });
      return;
    }
    const body = req.body;
    const supplierId = Number(body.supplier_id ?? po.supplier_id);
    if (!db.suppliers.some((s) => s.id === supplierId && s.aktif)) {
      res.status(422).json({ error: "Supplier aktif tidak ditemukan." });
      return;
    }
    let items = po.items;
    if (Array.isArray(body.items) && body.items.length > 0) {
      items = [];
      for (const raw of body.items) {
        const result = rincianPoItem(raw, po.id);
        if (result.error || !result.item) {
          res.status(422).json({ error: result.error ?? "Barang PO tidak valid." });
          return;
        }
        result.item.id = store.nextId("purchase_order_items");
        items.push(result.item);
      }
    }
    po.supplier_id = supplierId;
    po.tanggal = String(body.tanggal ?? po.tanggal);
    po.expected_at = body.expected_at ? String(body.expected_at) : null;
    po.catatan = body.catatan ? String(body.catatan).trim() : null;
    po.items = items;
    po.total = round22(items.reduce((sum, item) => sum + item.subtotal, 0));
    po.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "po_update", "purchase_order", po.id, `PO ${po.no_po} diperbarui.`);
    store.persist();
    res.json({ purchase_order: poWithSupplier(po) });
  });
  app.post("/api/owner/purchase-orders/:id/kirim", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: "Purchase order tidak ditemukan." });
      return;
    }
    if (po.status !== "draft") {
      res.status(422).json({ error: "Hanya PO draft yang dapat dikirim." });
      return;
    }
    po.status = "dikirim";
    po.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "po_send", "purchase_order", po.id, `PO ${po.no_po} dikirim ke supplier.`);
    store.persist();
    broadcastEvent("purchasing_updated", { purchaseOrderId: po.id });
    res.json({ purchase_order: poWithSupplier(po) });
  });
  app.post("/api/owner/purchase-orders/:id/terima", requireAuth(["owner"]), async (req, res) => {
    await runTransactional(
      res,
      () => store.critical(["purchase_orders", "material_rolls", "supplies", "products"], () => {
        const db = store.getState();
        const user = getCurrentUser(req);
        const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
        if (!po) {
          res.status(404).json({ error: "Purchase order tidak ditemukan." });
          return;
        }
        if (po.status !== "dikirim") {
          res.status(422).json({ error: "Hanya PO yang sudah dikirim yang dapat diterima." });
          return;
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        for (const item of po.items) {
          if (item.jenis === "roll") {
            const roll = db.material_rolls.find((r) => r.id === item.referensi_id);
            if (roll) {
              roll.panjang_sisa_m = round22(roll.panjang_sisa_m + item.qty);
              if (roll.status === "habis" && roll.panjang_sisa_m > 0) roll.status = "aktif";
            }
          } else if (item.jenis === "supply") {
            const supply = db.supplies.find((s) => s.id === item.referensi_id);
            if (supply) {
              supply.stok = round22(supply.stok + item.qty);
              supply.updated_at = now;
            }
          } else {
            const product = db.products.find((p) => p.id === item.referensi_id);
            if (product) product.stok_pcs = round22((product.stok_pcs ?? 0) + item.qty);
          }
        }
        const receipt = {
          id: store.nextId("goods_receipts"),
          po_id: po.id,
          no_po: po.no_po,
          tanggal: String(req.body.tanggal ?? now.slice(0, 10)),
          admin_id: user?.id ?? 0,
          admin_name: user?.name ?? null,
          catatan: req.body.catatan?.trim() || null,
          created_at: now
        };
        db.goods_receipts.push(receipt);
        po.status = "diterima";
        po.diterima_at = now;
        po.hutang = round22(po.total - (po.sudah_dibayar ?? 0));
        po.updated_at = now;
        auditRequest(req, "goods_receipt", "purchase_order", po.id, `PO ${po.no_po} diterima; stok bertambah dan hutang dicatat.`);
        store.persist();
        broadcastEvent("purchasing_updated", { purchaseOrderId: po.id });
        res.json({ purchase_order: poWithSupplier(po), goods_receipt: receipt });
      }),
      "Gagal menerima PO secara transaksional."
    );
  });
  app.post("/api/owner/purchase-orders/:id/bayar", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const user = getCurrentUser(req);
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: "Purchase order tidak ditemukan." });
      return;
    }
    if (po.status !== "diterima") {
      res.status(422).json({ error: "Pembayaran hanya untuk PO yang sudah diterima." });
      return;
    }
    const body = req.body;
    const nominal = round22(Number(body.nominal ?? 0));
    const sisa = round22(po.total - (po.sudah_dibayar ?? 0));
    if (!(nominal > 0) || nominal > sisa + 1e-3) {
      res.status(422).json({ error: `Nominal pembayaran harus antara Rp 1 dan sisa hutang Rp ${sisa.toLocaleString("id-ID")}.` });
      return;
    }
    const metode = ["Tunai", "Transfer", "QRIS"].includes(String(body.metode)) ? body.metode : "Transfer";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const payment = {
      id: store.nextId("supplier_payments"),
      supplier_id: po.supplier_id,
      purchase_order_id: po.id,
      no_po: po.no_po,
      tanggal: String(body.tanggal ?? now.slice(0, 10)),
      nominal,
      metode,
      keterangan: body.keterangan?.trim() || null,
      admin_id: user?.id ?? 0,
      admin_name: user?.name ?? null,
      created_at: now
    };
    db.supplier_payments.push(payment);
    po.sudah_dibayar = round22((po.sudah_dibayar ?? 0) + nominal);
    po.hutang = round22(Math.max(0, po.total - po.sudah_dibayar));
    po.updated_at = now;
    auditRequest(req, "supplier_payment", "purchase_order", po.id, `Pembayaran ${payment.metode} Rp ${nominal.toLocaleString("id-ID")} untuk ${po.no_po}.`);
    store.persist();
    broadcastEvent("purchasing_updated", { purchaseOrderId: po.id });
    res.json({ payment, purchase_order: poWithSupplier(po) });
  });
  app.get("/api/owner/goods-receipts", requireAuth(["owner"]), (_req, res) => {
    const db = store.getState();
    const receipts = db.goods_receipts.map((gr) => ({
      ...gr,
      supplier_name: db.suppliers.find((s) => s.id === db.purchase_orders.find((po) => po.id === gr.po_id)?.supplier_id)?.nama_supplier ?? "-"
    })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ goods_receipts: receipts });
  });
  app.get("/api/owner/supplier-payments", requireAuth(["owner"]), (_req, res) => {
    const db = store.getState();
    const payments = db.supplier_payments.map((p) => ({
      ...p,
      supplier_name: db.suppliers.find((s) => s.id === p.supplier_id)?.nama_supplier ?? "-"
    })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ payments });
  });
  app.get("/api/owner/whatsapp-outbox", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const status = String(req.query.status ?? "");
    let outbox = [...db.whatsapp_outbox];
    if (status) outbox = outbox.filter((w) => w.status === status);
    outbox.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const waConfig = getWaConfig();
    res.json({
      outbox: outbox.slice(0, 500),
      gateway_terkonfigurasi: waConfig.aktif && Boolean(waConfig.url),
      webhook_url: waConfig.url || null
    });
  });
  app.post("/api/owner/whatsapp-outbox/:id/retry", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const row = db.whatsapp_outbox.find((w) => w.id === Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: "Pesan outbox tidak ditemukan." });
      return;
    }
    row.status = "pending";
    row.attempts = 0;
    const waConfig = getWaConfig();
    row.last_error = waConfig.aktif && waConfig.url ? null : "Gateway WhatsApp belum dikonfigurasi atau dinonaktifkan.";
    row.next_attempt_at = null;
    row.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "whatsapp_retry", "whatsapp_outbox", row.id, `Pesan ${row.event} diantrekan ulang.`);
    store.persist();
    void deliverWaOutbox();
    res.json({ outbox: row });
  });
  app.post("/api/owner/whatsapp/reminder", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const hari = Math.min(30, Math.max(0, Number(req.body.hari ?? 7)));
    const batas = Date.now() + hari * 864e5;
    const hariIni = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    let dibuat = 0;
    for (const raw of db.orders.filter(activeOrderRaw)) {
      const order = store.hydrateOrder(raw);
      if (!(order.sisa_tagihan > 0)) continue;
      const due = order.jatuh_tempo ? new Date(order.jatuh_tempo).getTime() : new Date(new Date(order.created_at).getTime() + 30 * 864e5).getTime();
      if (due > batas) continue;
      if (enqueueWa(
        "piutang_jatuh_tempo",
        `piutang_jatuh_tempo:${order.id}:${hariIni}`,
        order.customer?.no_wa ?? "",
        `Pengingat: Nota ${order.no_nota} memiliki sisa tagihan Rp ${order.sisa_tagihan.toLocaleString("id-ID")} dengan jatuh tempo ${order.jatuh_tempo ? order.jatuh_tempo.slice(0, 10) : "-"}.`,
        order.id,
        `${appBaseUrl()}/?nota=${order.no_nota}`
      )) {
        dibuat += 1;
      }
    }
    auditRequest(req, "whatsapp_reminder", "whatsapp_outbox", 0, `Pengingat piutang dibuat: ${dibuat} pesan.`);
    store.persist();
    res.json({ dibuat, total_outbox: db.whatsapp_outbox.length });
  });
  app.get("/api/owner/pajak-reklame", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const hari = Math.min(365, Math.max(0, Number(req.query.hari ?? PAJAK_REKLAME_HARI)));
    const { semua, items } = hitungPajakReklame(db, hari);
    res.json({
      hari,
      items,
      instansis: semua,
      total_terdaftar: semua.length,
      gateway_terkonfigurasi: (() => {
        const waConfig = getWaConfig();
        return waConfig.aktif && Boolean(waConfig.url);
      })()
    });
  });
  app.put("/api/owner/pajak-reklame/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const inst = db.instansis.find((i) => i.id === Number(req.params.id));
    if (!inst) {
      res.status(404).json({ error: "Instansi tidak ditemukan." });
      return;
    }
    const body = req.body;
    const mentah = body.pajak_reklame_expired ?? body.tanggal ?? "";
    const tanggal = String(mentah ?? "").trim();
    if (tanggal && !parseTanggalIso(tanggal)) {
      res.status(400).json({ error: "Tanggal pajak reklame harus berformat YYYY-MM-DD." });
      return;
    }
    const sebelumnya = inst.pajak_reklame_expired ?? null;
    inst.pajak_reklame_expired = tanggal || null;
    auditRequest(
      req,
      "pajak_reklame_update",
      "instansi",
      inst.id,
      `Masa berlaku pajak reklame diubah dari ${sebelumnya ?? "-"} menjadi ${inst.pajak_reklame_expired ?? "-"}.`
    );
    store.persist();
    broadcastEvent("domain_update", { instansiId: inst.id });
    res.json({ instansi: inst });
  });
  app.post("/api/owner/whatsapp/reminder-reklame", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const hari = Math.min(365, Math.max(0, Number(req.body.hari ?? PAJAK_REKLAME_HARI)));
    const sekarang = /* @__PURE__ */ new Date();
    const { items } = hitungPajakReklame(db, hari, sekarang);
    let dibuat = 0;
    let dilewati = 0;
    for (const row of items) {
      if (!normalizeWaNumber(row.no_wa)) {
        dilewati += 1;
        continue;
      }
      if (enqueueWa(
        "pajak_reklame_jatuh_tempo",
        `pajak_reklame_jatuh_tempo:${row.instansi_id}:${row.tahun}`,
        row.no_wa,
        `Pengingat pajak reklame: ${row.nama_instansi} memiliki masa berlaku hingga ${row.jatuh_tempo_berikutnya} (${row.hari_tersisa} hari lagi). Mohon segera perpanjang dan unggah bukti pembayaran.`,
        null,
        null
      )) {
        dibuat += 1;
      }
    }
    auditRequest(
      req,
      "whatsapp_reminder_reklame",
      "whatsapp_outbox",
      0,
      `Pengingat pajak reklame dibuat: ${dibuat} pesan, ${dilewati} tanpa nomor WA.`
    );
    store.persist();
    res.json({ dibuat, dilewati, total_outbox: db.whatsapp_outbox.length });
  });
  app.get("/api/owner/maintenance/tiff-preview", requireAuth(["owner"]), (req, res) => {
    const hari = Number(req.query.hari ?? AUTO_CLEAN_TIFF_HARI);
    const hasil = hapusTiffLama(hari, null, true);
    res.json({ hari, kandidat: hasil, total: hasil.length });
  });
  app.post("/api/owner/maintenance/tiff-clean", requireAuth(["owner"]), (req, res) => {
    const user = getCurrentUser(req) ?? null;
    const hari = Number(req.body.hari ?? AUTO_CLEAN_TIFF_HARI);
    const hasil = hapusTiffLama(hari, user, false);
    auditRequest(req, "auto_clean_tiff_run", "maintenance", 0, `Auto-clean TIFF dijalankan (${hari} hari): ${hasil.filter((h) => h.dihapus).length} file dihapus.`);
    res.json({ hari, hasil, dihapus: hasil.filter((h) => h.dihapus).length });
  });
  app.get("/api/owner/dashboard", requireAuth(["owner"]), (_req, res) => {
    const db = store.getState();
    const orders = db.orders.map((o) => store.hydrateOrder(o)).filter((o) => activeOrderRaw(o));
    const statistik = {
      desain: db.order_items.filter((i) => ["menunggu_desain", "proses_desain", "menunggu_acc", "revisi"].includes(i.status_produksi)).length,
      cetak: db.order_items.filter((i) => ["antrean_cetak", "proses_cetak"].includes(i.status_produksi)).length,
      finishing: db.order_items.filter((i) => ["antrean_finishing", "proses_finishing"].includes(i.status_produksi)).length,
      advertising: db.advertising_spks.filter((s) => s.status_lapangan !== "selesai").length,
      siap_diambil: db.order_items.filter((i) => i.status_produksi === "siap_diambil").length
    };
    const threeDaysAhead = Date.now() + 3 * 864e5;
    const deadlines = orders.filter(
      (o) => o.deadline && new Date(o.deadline).getTime() <= threeDaysAhead && o.items.some((i) => i.status_produksi !== "selesai")
    ).sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()).slice(0, 10).map((o) => {
      const diffDays = Math.ceil((new Date(o.deadline).getTime() - Date.now()) / 864e5);
      return {
        id: o.id,
        no_nota: o.no_nota,
        instansi: o.customer?.instansi ?? "Perorangan",
        pic: o.customer?.nama_pelanggan ?? "-",
        deadline: o.deadline,
        terlambat: new Date(o.deadline).getTime() < Date.now(),
        sisa_hari: diffDays
      };
    });
    const rekapMap = /* @__PURE__ */ new Map();
    for (const o of orders) {
      const inst = o.customer?.instansi ?? "Perorangan";
      const pic = o.customer?.nama_pelanggan ?? "-";
      if (!rekapMap.has(inst)) {
        rekapMap.set(inst, { instansi: inst, total_nota: 0, omzet: 0, piutang: 0, pics: /* @__PURE__ */ new Map() });
      }
      const grp = rekapMap.get(inst);
      grp.total_nota += 1;
      grp.omzet = round22(grp.omzet + o.total_tagihan);
      grp.piutang = round22(grp.piutang + o.sisa_tagihan);
      if (!grp.pics.has(pic)) {
        grp.pics.set(pic, { nama: pic, total_nota: 0, omzet: 0, piutang: 0 });
      }
      const p = grp.pics.get(pic);
      p.total_nota += 1;
      p.omzet = round22(p.omzet + o.total_tagihan);
      p.piutang = round22(p.piutang + o.sisa_tagihan);
    }
    const rekap = Array.from(rekapMap.values()).map((g) => ({ ...g, pics: Array.from(g.pics.values()) })).sort((a, b) => b.omzet - a.omzet);
    const stok_kritis = {
      rolls: db.material_rolls.filter((r) => r.status === "aktif" && r.panjang_sisa_m <= 10).sort((a, b) => a.panjang_sisa_m - b.panjang_sisa_m),
      products: db.products.filter((p) => p.kategori_produk === "satuan" && p.stok_pcs !== null && p.stok_pcs <= 5).sort((a, b) => (a.stok_pcs ?? 0) - (b.stok_pcs ?? 0))
    };
    res.json({
      statistik,
      deadlines,
      stok_kritis,
      rekap,
      total_rekap: {
        nota: orders.length,
        omzet: round22(orders.reduce((s, o) => s + o.total_tagihan, 0)),
        piutang: round22(orders.reduce((s, o) => s + o.sisa_tagihan, 0))
      }
    });
  });
  app.get("/api/owner/reports/materials", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    let logs = db.material_logs.map((l) => {
      const item = db.order_items.find((i) => i.id === l.order_item_id);
      const order = item ? db.orders.find((o) => o.id === item.order_id) : null;
      const product = item ? db.products.find((p) => p.id === item.product_id) : null;
      const roll = l.material_roll_id ? db.material_rolls.find((r) => r.id === l.material_roll_id) : null;
      return {
        ...l,
        no_nota: order?.no_nota ?? "-",
        product_name: product?.nama_produk ?? "-",
        kode_roll: roll?.kode_roll ?? null
      };
    });
    if (dari) logs = logs.filter((l) => l.created_at.slice(0, 10) >= dari);
    if (sampai) logs = logs.filter((l) => l.created_at.slice(0, 10) <= sampai);
    logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const ringkasan = {
      jumlah_log: logs.length,
      netto: round22(logs.reduce((s, l) => s + l.luas_netto_m2, 0)),
      finishing: round22(logs.reduce((s, l) => s + l.wos_finishing_m2, 0)),
      potong: round22(logs.reduce((s, l) => s + l.wos_potong_m2, 0)),
      gagal: round22(logs.reduce((s, l) => s + l.gagal_cetak_m2, 0)),
      total: round22(
        logs.reduce(
          (s, l) => s + l.luas_netto_m2 + l.wos_finishing_m2 + l.wos_potong_m2 + l.gagal_cetak_m2,
          0
        )
      )
    };
    res.json({
      rolls: db.material_rolls.map((r) => ({
        ...r,
        luas_sisa_m2: round22(r.lebar_m * r.panjang_sisa_m),
        persen_sisa: r.panjang_awal_m > 0 ? round22(r.panjang_sisa_m / r.panjang_awal_m * 100) : 0
      })),
      offcuts: db.material_offcuts.filter((o) => o.status === "tersedia"),
      stok_pcs: db.products.filter((p) => p.kategori_produk === "satuan"),
      ringkasan,
      logs
    });
  });
  app.post("/api/owner/stock-opname", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const body = req.body ?? {};
    const tipe = String(body.tipe ?? "").trim();
    const id = parsePositiveId(body.id);
    const stokFisik = Number(body.stok_fisik);
    const catatan = String(body.catatan ?? "").trim();
    if (!id || !Number.isFinite(stokFisik) || stokFisik < 0) {
      res.status(422).json({ error: "Data stock opname tidak valid." });
      return;
    }
    if (!catatan) {
      res.status(422).json({ error: "Catatan stock opname wajib diisi." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let before = 0;
    let after = 0;
    let label = "";
    if (tipe === "supply") {
      const row = db.supplies.find((s) => s.id === id);
      if (!row) return void res.status(404).json({ error: "Bahan pembantu tidak ditemukan." });
      before = Number(row.stok ?? 0);
      after = round22(stokFisik);
      row.stok = after;
      row.updated_at = now;
      label = `supply:${row.nama}`;
    } else if (tipe === "roll") {
      const row = db.material_rolls.find((r) => r.id === id);
      if (!row) return void res.status(404).json({ error: "Roll tidak ditemukan." });
      before = Number(row.panjang_sisa_m ?? 0);
      after = round22(stokFisik);
      row.panjang_sisa_m = after;
      row.status = after <= 0 ? "habis" : "aktif";
      label = `roll:${row.kode_roll}`;
    } else if (tipe === "cattoff") {
      const row = db.stok_cattoff.find((c) => c.id === id);
      if (!row) return void res.status(404).json({ error: "Cattoff tidak ditemukan." });
      before = Number(row.panjang_sisa_m ?? 0);
      after = round22(stokFisik);
      row.panjang_sisa_m = after;
      row.status = after <= 0 ? "habis" : "aktif";
      row.updated_at = now;
      label = `cattoff:${row.kode}`;
    } else if (tipe === "product") {
      const row = db.products.find((p) => p.id === id);
      if (!row) return void res.status(404).json({ error: "Produk tidak ditemukan." });
      before = Number(row.stok_pcs ?? 0);
      after = Math.max(0, Math.floor(stokFisik));
      row.stok_pcs = after;
      label = `product:${row.nama_produk}`;
    } else {
      res.status(422).json({ error: "Tipe stock opname tidak didukung." });
      return;
    }
    auditRequest(req, "stock_opname", tipe, id, `Stock opname ${label}: ${before} -> ${after}. ${catatan}`);
    store.persist();
    broadcastEvent("domain_update", { tipe, id });
    res.json({ ok: true, tipe, id, sebelum: before, sesudah: after });
  });
  app.get("/api/owner/reports/profit-loss", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    let orders = db.orders.filter((o) => activeOrderRaw(o));
    let logs = db.material_logs;
    let expenses = db.operational_expenses;
    if (dari) {
      orders = orders.filter((o) => o.created_at.slice(0, 10) >= dari);
      logs = logs.filter((l) => l.created_at.slice(0, 10) >= dari);
      expenses = expenses.filter((e) => e.tanggal >= dari);
    }
    if (sampai) {
      orders = orders.filter((o) => o.created_at.slice(0, 10) <= sampai);
      logs = logs.filter((l) => l.created_at.slice(0, 10) <= sampai);
      expenses = expenses.filter((e) => e.tanggal <= sampai);
    }
    const omzetTagihan = round22(orders.reduce((s, o) => s + o.total_tagihan, 0));
    const cashMasuk = round22(orders.reduce((s, o) => s + o.jumlah_dp, 0));
    const calcKomp = (field) => {
      let luas = 0;
      let biaya = 0;
      for (const log of logs) {
        const item = db.order_items.find((i) => i.id === log.order_item_id);
        const prod = item ? db.products.find((p) => p.id === item.product_id) : null;
        const val = log[field];
        luas += val;
        biaya += val * (prod?.harga_modal ?? 0);
      }
      return { luas: round22(luas), biaya: round22(biaya) };
    };
    const komponen_hpp = {
      netto: calcKomp("luas_netto_m2"),
      finishing: calcKomp("wos_finishing_m2"),
      potong: calcKomp("wos_potong_m2"),
      gagal: calcKomp("gagal_cetak_m2")
    };
    const hppBahan = round22(
      komponen_hpp.netto.biaya + komponen_hpp.finishing.biaya + komponen_hpp.potong.biaya + komponen_hpp.gagal.biaya
    );
    const orderIds = new Set(orders.map((o) => o.id));
    const hppSatuan = round22(
      db.order_items.filter((i) => orderIds.has(i.order_id)).reduce((sum, i) => {
        const prod = db.products.find((p) => p.id === i.product_id);
        if (prod?.kategori_produk === "satuan") {
          return sum + i.qty * prod.harga_modal;
        }
        return sum;
      }, 0)
    );
    const hppProduksi = round22(hppBahan + hppSatuan);
    const totalOperasional = round22(expenses.reduce((s, e) => s + e.nominal, 0));
    const labaBersih = round22(omzetTagihan - hppProduksi - totalOperasional);
    res.json({
      omzet: { tagihan: omzetTagihan, cash_masuk: cashMasuk, jumlah_nota: orders.length },
      komponen_hpp,
      hpp_bahan: hppBahan,
      hpp_satuan: hppSatuan,
      hpp_produksi: hppProduksi,
      total_operasional: totalOperasional,
      laba_bersih: labaBersih,
      expenses: [...expenses].sort((a, b) => b.tanggal.localeCompare(a.tanggal))
    });
  });
  app.post("/api/owner/expenses", requireAuth(["owner"]), (req, res) => {
    const { tanggal, kategori_biaya, keterangan, nominal } = req.body;
    if (!tanggal || !kategori_biaya || !keterangan?.trim() || !(Number(nominal) > 0)) {
      res.status(422).json({ error: "Tanggal, kategori, keterangan, dan nominal (> 0) wajib diisi." });
      return;
    }
    const db = store.getState();
    const expense = {
      id: store.nextId("operational_expenses"),
      tanggal,
      kategori_biaya,
      keterangan: keterangan.trim(),
      nominal: round22(Number(nominal)),
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.operational_expenses.push(expense);
    store.persist();
    broadcastEvent("expense_updated");
    res.status(201).json({ expense });
  });
  app.delete("/api/owner/expenses/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const idx = db.operational_expenses.findIndex((e) => e.id === Number(req.params.id));
    if (idx === -1) {
      res.status(404).json({ error: "Data pengeluaran tidak ditemukan." });
      return;
    }
    db.operational_expenses.splice(idx, 1);
    store.persist();
    broadcastEvent("expense_updated");
    res.json({ deleted: true });
  });
  app.put("/api/owner/settings/products", requireAuth(["owner"]), (req, res) => {
    const { products } = req.body;
    const db = store.getState();
    for (const row of products ?? []) {
      const target = db.products.find((p) => p.id === Number(row.id));
      if (target) {
        target.harga_umum = round22(Number(row.harga_umum));
        target.harga_reseller = round22(Number(row.harga_reseller));
        target.harga_prioritas = round22(Number(row.harga_prioritas));
        target.harga_pegawai = round22(Number(row.harga_pegawai));
        target.harga_modal = round22(Number(row.harga_modal));
        target.mesin_default_id = row.mesin_default_id ? Number(row.mesin_default_id) : null;
        target.satuan_hitung = row.satuan_hitung === "klik" ? "klik" : "pcs";
        target.klik_per_lembar = Math.max(1, Math.floor(Number(row.klik_per_lembar ?? 1)) || 1);
        target.ukuran_lembar = row.ukuran_lembar?.trim() || null;
      }
    }
    store.persist();
    broadcastEvent("settings_updated");
    res.json({ products: db.products });
  });
  app.post("/api/owner/settings/rolls", requireAuth(["owner"]), (req, res) => {
    const { kode_roll, jenis_bahan } = req.body;
    const kode = (kode_roll ?? "").trim().toUpperCase();
    const spec = jenis_bahan ? STANDARD_ROLL_SPECS[jenis_bahan] : null;
    if (!kode || !jenis_bahan || !spec) {
      res.status(422).json({ error: "Kode roll dan jenis bahan standar wajib valid." });
      return;
    }
    const db = store.getState();
    if (db.material_rolls.some((r) => r.kode_roll === kode)) {
      res.status(422).json({ error: `Kode roll ${kode} sudah terdaftar.` });
      return;
    }
    const roll = {
      id: store.nextId("material_rolls"),
      kode_roll: kode,
      jenis_bahan,
      lebar_m: spec.lebar_m,
      panjang_awal_m: spec.panjang_m,
      panjang_sisa_m: spec.panjang_m,
      status: "aktif"
    };
    db.material_rolls.push(roll);
    store.persist();
    broadcastEvent("stock_updated");
    res.status(201).json({ roll });
  });
  app.post("/api/owner/settings/stok-pcs", requireAuth(["owner"]), (req, res) => {
    const { product_id, jumlah } = req.body;
    const db = store.getState();
    const product = db.products.find((p) => p.id === Number(product_id));
    if (!product || product.kategori_produk !== "satuan") {
      res.status(422).json({ error: "Produk satuan tidak ditemukan." });
      return;
    }
    const qty = Math.floor(Number(jumlah ?? 0));
    if (qty <= 0) {
      res.status(422).json({ error: "Jumlah penambahan stok minimal 1 pcs." });
      return;
    }
    product.stok_pcs = (product.stok_pcs ?? 0) + qty;
    store.persist();
    broadcastEvent("stock_updated");
    res.json({ product });
  });
  app.put("/api/owner/settings/finishings", requireAuth(["owner"]), (req, res) => {
    const { finishings } = req.body;
    const db = store.getState();
    for (const row of finishings ?? []) {
      const target = db.finishings.find((f) => f.id === Number(row.id));
      if (target) {
        target.ekstra_kiri_cm = round22(Number(row.ekstra_kiri_cm));
        target.ekstra_kanan_cm = round22(Number(row.ekstra_kanan_cm));
        target.ekstra_atas_cm = round22(Number(row.ekstra_atas_cm));
        target.ekstra_bawah_cm = round22(Number(row.ekstra_bawah_cm));
      }
    }
    store.persist();
    broadcastEvent("settings_updated");
    res.json({ finishings: db.finishings });
  });
  app.post("/api/owner/settings/machines", requireAuth(["owner"]), (req, res) => {
    const body = req.body;
    const kode = String(body.kode_mesin ?? "").trim().toUpperCase();
    const nama = String(body.nama_mesin ?? "").trim();
    const jenis = String(body.jenis ?? "");
    if (!kode || !nama || !["large_format", "uv", "digital_a3p", "cutting"].includes(jenis)) {
      res.status(422).json({ error: "Kode, nama, dan jenis mesin wajib valid." });
      return;
    }
    const db = store.getState();
    if (db.machines.some((m) => m.kode_mesin === kode || m.nama_mesin === nama)) {
      res.status(422).json({ error: "Kode atau nama mesin sudah terdaftar." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const machine = {
      id: store.nextId("machines"),
      kode_mesin: kode,
      nama_mesin: nama,
      jenis,
      lebar_max_m: Number(body.lebar_max_m) > 0 ? Number(body.lebar_max_m) : null,
      konsumsi_tinta_ml_per_m2: Math.max(0, Number(body.konsumsi_tinta_ml_per_m2 ?? 0)),
      aktif: body.aktif !== false,
      keterangan: String(body.keterangan ?? "").trim() || null,
      created_at: now,
      updated_at: now
    };
    db.machines.push(machine);
    auditRequest(req, "machine_created", "machine", machine.id, `Mesin ${nama} ditambahkan.`);
    store.persist();
    broadcastEvent("settings_updated");
    res.status(201).json({ machine });
  });
  app.put("/api/owner/settings/machines/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const machine = db.machines.find((m) => m.id === Number(req.params.id));
    if (!machine) {
      res.status(404).json({ error: "Mesin tidak ditemukan." });
      return;
    }
    const body = req.body;
    machine.nama_mesin = String(body.nama_mesin ?? machine.nama_mesin).trim() || machine.nama_mesin;
    machine.lebar_max_m = Number(body.lebar_max_m) > 0 ? Number(body.lebar_max_m) : null;
    machine.konsumsi_tinta_ml_per_m2 = Math.max(
      0,
      Number(body.konsumsi_tinta_ml_per_m2 ?? machine.konsumsi_tinta_ml_per_m2)
    );
    machine.aktif = body.aktif !== false;
    machine.keterangan = String(body.keterangan ?? "").trim() || null;
    machine.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "machine_updated", "machine", machine.id, `Mesin ${machine.nama_mesin} diperbarui.`);
    store.persist();
    broadcastEvent("settings_updated");
    res.json({ machine });
  });
  app.post("/api/owner/settings/supplies", requireAuth(["owner"]), (req, res) => {
    const body = req.body;
    const kode = String(body.kode ?? "").trim().toUpperCase();
    const nama = String(body.nama ?? "").trim();
    const kategori = String(body.kategori ?? "");
    if (!kode || !nama || !["tinta", "bahan_pembantu", "suku_cadang"].includes(kategori)) {
      res.status(422).json({ error: "Kode, nama, dan kategori barang wajib valid." });
      return;
    }
    const db = store.getState();
    if (db.supplies.some((s) => s.kode === kode)) {
      res.status(422).json({ error: `Kode ${kode} sudah terdaftar.` });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const supply = {
      id: store.nextId("supplies"),
      kode,
      nama,
      kategori,
      satuan: String(body.satuan ?? "pcs").trim() || "pcs",
      stok: Math.max(0, Number(body.stok ?? 0)),
      stok_minimum: Math.max(0, Number(body.stok_minimum ?? 0)),
      harga_satuan: Math.max(0, Number(body.harga_satuan ?? 0)),
      konsumsi_per_m2: Number(body.konsumsi_per_m2) > 0 ? Number(body.konsumsi_per_m2) : null,
      aktif: body.aktif !== false,
      created_at: now,
      updated_at: now
    };
    db.supplies.push(supply);
    auditRequest(req, "supply_created", "supply", supply.id, `Barang ${nama} ditambahkan.`);
    store.persist();
    broadcastEvent("stock_updated");
    res.status(201).json({ supply });
  });
  app.put("/api/owner/settings/supplies/:id", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const supply = db.supplies.find((s) => s.id === Number(req.params.id));
    if (!supply) {
      res.status(404).json({ error: "Barang tidak ditemukan." });
      return;
    }
    const body = req.body;
    supply.nama = String(body.nama ?? supply.nama).trim() || supply.nama;
    supply.satuan = String(body.satuan ?? supply.satuan).trim() || supply.satuan;
    supply.stok_minimum = Math.max(0, Number(body.stok_minimum ?? supply.stok_minimum));
    supply.harga_satuan = Math.max(0, Number(body.harga_satuan ?? supply.harga_satuan));
    supply.konsumsi_per_m2 = Number(body.konsumsi_per_m2) > 0 ? Number(body.konsumsi_per_m2) : null;
    supply.aktif = body.aktif !== false;
    supply.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "supply_updated", "supply", supply.id, `Barang ${supply.nama} diperbarui.`);
    store.persist();
    broadcastEvent("stock_updated");
    res.json({ supply });
  });
  app.post("/api/owner/settings/supplies/:id/restock", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const supply = db.supplies.find((s) => s.id === Number(req.params.id));
    if (!supply) {
      res.status(404).json({ error: "Barang tidak ditemukan." });
      return;
    }
    const jumlah = round22(Number(req.body.jumlah ?? 0));
    if (!(jumlah > 0)) {
      res.status(422).json({ error: "Jumlah restock wajib lebih dari 0." });
      return;
    }
    supply.stok = round22(supply.stok + jumlah);
    supply.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    auditRequest(req, "supply_restock", "supply", supply.id, `Restock ${supply.nama} sebanyak ${jumlah} ${supply.satuan}.`);
    store.persist();
    broadcastEvent("stock_updated");
    res.json({ supply });
  });
  app.get("/api/owner/reports/kpi", requireAuth(["owner"]), (_req, res) => {
    const db = store.getState();
    const activeOrders = new Set(db.orders.filter(activeOrderRaw).map((o) => o.id));
    const activeItems = db.order_items.filter((i) => activeOrders.has(i.order_id));
    const operatorStats = db.users.filter((u) => u.role === "operator_cetak" && u.active !== false).map((u) => {
      const items = activeItems.filter((i) => i.operator_id === u.id);
      const itemIds = new Set(items.map((i) => i.id));
      const logs = db.material_logs.filter((l) => itemIds.has(l.order_item_id));
      return {
        user_id: u.id,
        nama: u.name,
        total_job: items.length,
        sukses: items.filter((i) => ["antrean_finishing", "proses_finishing", "siap_diambil", "selesai"].includes(i.status_produksi)).length,
        luas_sukses_m2: round22(logs.reduce((a, l) => a + l.luas_netto_m2, 0)),
        luas_gagal_m2: round22(logs.reduce((a, l) => a + l.gagal_cetak_m2, 0)),
        total_klik: items.reduce((a, i) => a + (i.klik_total ?? 0), 0),
        estimasi_tinta_ml: round22(items.reduce((a, i) => a + (i.estimasi_tinta_ml ?? 0), 0))
      };
    });
    const machineStats = db.machines.map((m) => {
      const items = activeItems.filter((i) => i.machine_id === m.id);
      const itemIds = new Set(items.map((i) => i.id));
      const logs = db.material_logs.filter((l) => itemIds.has(l.order_item_id));
      return {
        machine_id: m.id,
        kode_mesin: m.kode_mesin,
        nama_mesin: m.nama_mesin,
        jenis: m.jenis,
        aktif: m.aktif,
        total_job: items.length,
        luas_cetak_m2: round22(logs.reduce((a, l) => a + l.luas_netto_m2, 0)),
        luas_gagal_m2: round22(logs.reduce((a, l) => a + l.gagal_cetak_m2, 0)),
        total_klik: items.reduce((a, i) => a + (i.klik_total ?? 0), 0),
        estimasi_tinta_ml: round22(items.reduce((a, i) => a + (i.estimasi_tinta_ml ?? 0), 0))
      };
    });
    const lowSupplies = db.supplies.filter((s) => s.aktif && s.stok <= s.stok_minimum).map((s) => ({ ...s, selisih: round22(s.stok - s.stok_minimum) }));
    const batches = [...db.print_batches].reverse().slice(0, 20).map((b) => ({
      ...b,
      machine_name: db.machines.find((m) => m.id === b.machine_id)?.nama_mesin ?? null,
      operator_name: db.users.find((u) => u.id === b.operator_id)?.name ?? null
    }));
    res.json({ operatorStats, machineStats, lowSupplies, batches });
  });
  const handleGetWhatsappSettings = (_req, res) => {
    const db = store.getState();
    if (!db.whatsapp_gateway_config) {
      db.whatsapp_gateway_config = buildDefaultWhatsappGatewayConfig();
      store.persist();
    }
    const runtime = getWaConfig();
    res.json({
      config: db.whatsapp_gateway_config,
      gateway_terkonfigurasi: runtime.aktif && Boolean(runtime.url),
      webhook_url: runtime.url || null,
      app_url: runtime.appUrl
    });
  };
  const handleUpdateWhatsappSettings = (req, res) => {
    const db = store.getState();
    const body = req.body ?? {};
    let webhookUrl;
    let appUrl;
    try {
      webhookUrl = normalizeGatewayUrl(body.webhook_url, "Webhook URL");
      appUrl = normalizeGatewayUrl(body.app_url, "APP URL");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "URL tidak valid." });
      return;
    }
    const user = getCurrentUser(req);
    const sekarang = (/* @__PURE__ */ new Date()).toISOString();
    const config = {
      id: 1,
      webhook_url: webhookUrl,
      webhook_token: String(body.webhook_token ?? "").trim(),
      app_url: appUrl || `http://localhost:${PORT}`,
      aktif: body.aktif !== false,
      updated_at: sekarang,
      updated_by: user?.id ?? null
    };
    db.whatsapp_gateway_config = config;
    auditRequest(
      req,
      "whatsapp_gateway_update",
      "settings",
      1,
      `Gateway WhatsApp diubah menjadi ${webhookUrl || "(kosong)"} (${config.aktif ? "aktif" : "nonaktif"}).`
    );
    store.persist();
    broadcastEvent("settings_updated");
    void deliverWaOutbox();
    res.json({
      config,
      gateway_terkonfigurasi: config.aktif && Boolean(config.webhook_url),
      webhook_url: config.webhook_url || null,
      app_url: config.app_url
    });
  };
  const handleTestWhatsappSettings = async (req, res) => {
    const body = req.body ?? {};
    const noWa = normalizeWaNumber(body.no_wa);
    if (!noWa) {
      res.status(400).json({ error: "Nomor WhatsApp tujuan wajib diisi." });
      return;
    }
    const waConfig = getWaConfig();
    if (!waConfig.aktif || !waConfig.url) {
      res.status(400).json({ error: "Gateway WhatsApp belum dikonfigurasi atau dinonaktifkan." });
      return;
    }
    try {
      const response = await fetch(waConfig.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...waConfig.token ? { Authorization: `Bearer ${waConfig.token}` } : {}
        },
        body: JSON.stringify({
          event: "whatsapp_gateway_test",
          to: noWa,
          message: "Uji koneksi WhatsApp Gateway Reffo PrintFlow. Pesan ini hanya untuk pengujian.",
          link: null,
          dedupe_key: `whatsapp_gateway_test:${noWa}:${Date.now()}`
        })
      });
      if (!response.ok) throw new Error(`Gateway menjawab HTTP ${response.status}`);
      auditRequest(req, "whatsapp_gateway_test", "settings", 1, `Uji gateway ke ${noWa} berhasil.`);
      res.json({ ok: true, to: noWa });
    } catch (err) {
      auditRequest(
        req,
        "whatsapp_gateway_test",
        "settings",
        1,
        `Uji gateway ke ${noWa} gagal: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(502).json({ error: err instanceof Error ? err.message : "Gagal menguji gateway." });
    }
  };
  app.get("/api/owner/settings/whatsapp", requireAuth(["owner"]), handleGetWhatsappSettings);
  app.put("/api/owner/settings/whatsapp", requireAuth(["owner"]), handleUpdateWhatsappSettings);
  app.post("/api/owner/settings/whatsapp/test", requireAuth(["owner"]), handleTestWhatsappSettings);
  app.get("/api/admin/settings/whatsapp", requireAuth(["admin", "owner"]), handleGetWhatsappSettings);
  app.put("/api/admin/settings/whatsapp", requireAuth(["admin", "owner"]), handleUpdateWhatsappSettings);
  app.post("/api/admin/settings/whatsapp/test", requireAuth(["admin", "owner"]), handleTestWhatsappSettings);
  app.get("/api/owner/kpi/insentif", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    res.json(
      hitungInsentif(db, tanggalQuery(req.query.dari), tanggalQuery(req.query.sampai))
    );
  });
  app.put("/api/owner/kpi/insentif/rates", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    const input = req.body.rates;
    if (!Array.isArray(input) || input.length === 0) {
      res.status(400).json({ error: "Daftar tarif insentif tidak boleh kosong." });
      return;
    }
    const user = getCurrentUser(req);
    const sekarang = (/* @__PURE__ */ new Date()).toISOString();
    const validated = [];
    const kunci = /* @__PURE__ */ new Set();
    for (const entry of input) {
      const role = String(entry?.role ?? "");
      const jenis = String(entry?.jenis ?? "");
      const nominal = Number(entry?.nominal);
      const key = `${role}:${jenis}`;
      if (!INSENTIF_ROLES.includes(role) || !INSENTIF_JENIS.includes(jenis)) {
        res.status(400).json({ error: "Peran atau jenis tarif insentif tidak dikenal." });
        return;
      }
      if (!Number.isFinite(nominal) || nominal < 0 || nominal > 1e9) {
        res.status(400).json({ error: `Nominal tarif ${role}/${jenis} tidak valid.` });
        return;
      }
      if (kunci.has(key)) {
        res.status(400).json({ error: `Tarif ${role}/${jenis} dikirim lebih dari sekali.` });
        return;
      }
      kunci.add(key);
      validated.push({ role, jenis, nominal: round22(nominal) });
    }
    if (!Array.isArray(db.insentif_rates)) db.insentif_rates = [];
    for (const entry of validated) {
      let rate = db.insentif_rates.find(
        (r) => r.role === entry.role && r.jenis === entry.jenis
      );
      if (!rate) {
        rate = {
          id: store.nextId("insentif_rates"),
          role: entry.role,
          jenis: entry.jenis,
          nominal: entry.nominal,
          updated_at: sekarang,
          updated_by: user.id
        };
        db.insentif_rates.push(rate);
        continue;
      }
      rate.nominal = entry.nominal;
      rate.updated_at = sekarang;
      rate.updated_by = user.id;
    }
    auditRequest(
      req,
      "insentif_rates_update",
      "insentif_rate",
      0,
      `Tarif insentif diperbarui: ${validated.map((r) => `${r.role}/${r.jenis}=${r.nominal}`).join(", ")}.`
    );
    store.persist();
    broadcastEvent("domain_update", { entity: "insentif_rates" });
    res.json({ rates: db.insentif_rates, updated: validated.length });
  });
  app.get("/api/owner/reports/profitabilitas", requireAuth(["owner"]), (req, res) => {
    const db = store.getState();
    res.json(
      hitungProfitabilitas(db, tanggalQuery(req.query.dari), tanggalQuery(req.query.sampai))
    );
  });
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof multer.MulterError) {
      const message2 = err.code === "LIMIT_FILE_SIZE" ? `Ukuran file melebihi batas ${MAX_UPLOAD_MB} MB.` : err.code === "LIMIT_UNEXPECTED_FILE" ? "Jenis file tidak diizinkan. Gunakan JPG/PNG/PDF/TIFF/AI/PSD/CDR/ZIP/RAR." : `Gagal mengunggah file: ${err.message}`;
      res.status(422).json({ error: message2 });
      return;
    }
    const message = err instanceof Error ? err.message : "Terjadi kesalahan pada server.";
    res.status(500).json({ error: message });
  });
  let lastScheduledMaintenanceDate = "";
  const runScheduledMaintenance = () => {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (lastScheduledMaintenanceDate === today) return;
    lastScheduledMaintenanceDate = today;
    try {
      const db = store.getState();
      const batas = Date.now() + 7 * 864e5;
      let dibuatPiutang = 0;
      for (const raw of db.orders.filter(activeOrderRaw)) {
        const order = store.hydrateOrder(raw);
        if (!(order.sisa_tagihan > 0)) continue;
        const due = order.jatuh_tempo ? new Date(order.jatuh_tempo).getTime() : new Date(new Date(order.created_at).getTime() + 30 * 864e5).getTime();
        if (due > batas) continue;
        if (enqueueWa(
          "piutang_jatuh_tempo",
          `piutang_jatuh_tempo:${order.id}:${today}`,
          order.customer?.no_wa ?? "",
          `Pengingat: Nota ${order.no_nota} memiliki sisa tagihan Rp ${order.sisa_tagihan.toLocaleString("id-ID")} dengan jatuh tempo ${order.jatuh_tempo ? order.jatuh_tempo.slice(0, 10) : "-"}.`,
          order.id,
          `${appBaseUrl()}/?nota=${order.no_nota}`
        )) {
          dibuatPiutang += 1;
        }
      }
      const { items } = hitungPajakReklame(db, PAJAK_REKLAME_HARI, /* @__PURE__ */ new Date());
      let dibuatReklame = 0;
      for (const row of items) {
        if (!normalizeWaNumber(row.no_wa)) continue;
        if (enqueueWa(
          "pajak_reklame_jatuh_tempo",
          `pajak_reklame_jatuh_tempo:${row.instansi_id}:${row.tahun}`,
          row.no_wa,
          `Pengingat pajak reklame: ${row.nama_instansi} memiliki masa berlaku hingga ${row.jatuh_tempo_berikutnya} (${row.hari_tersisa} hari lagi). Mohon segera perpanjang dan unggah bukti pembayaran.`,
          null,
          null
        )) {
          dibuatReklame += 1;
        }
      }
      const tiff = hapusTiffLama(AUTO_CLEAN_TIFF_HARI, null, false);
      const dihapus = tiff.filter((h) => h.dihapus).length;
      recordAudit(
        null,
        "scheduled_maintenance",
        "system",
        0,
        `Scheduler harian ${today}: pengingat piutang ${dibuatPiutang}, reklame ${dibuatReklame}, TIFF dihapus ${dihapus}.`
      );
      store.persist();
      console.log(
        `[scheduler] maintenance ${today}: piutang=${dibuatPiutang}, reklame=${dibuatReklame}, tiff=${dihapus}`
      );
    } catch (err) {
      console.error("[scheduler] maintenance gagal:", err instanceof Error ? err.message : err);
    }
  };
  if (process.env.NODE_ENV !== "test") {
    runScheduledMaintenance();
    const maintenanceTimer = setInterval(runScheduledMaintenance, 60 * 60 * 1e3);
    maintenanceTimer.unref();
  }
  return app;
}
async function start() {
  assertSecurityEnv();
  await store.init();
  const app = buildApp();
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path4.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path4.join(distDir, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Reffo PrintFlow server berjalan pada http://0.0.0.0:${PORT}`);
    void deliverWaOutbox();
    const worker = setInterval(() => void deliverWaOutbox(), 6e4);
    worker.unref();
  });
}
start().catch((err) => {
  console.error("[startup] Server gagal berjalan:", err instanceof Error ? err.message : err);
  process.exit(1);
});
