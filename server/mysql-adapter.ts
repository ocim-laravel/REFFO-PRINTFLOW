import fs from 'node:fs';
import path from 'node:path';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { InsentifRate } from '../src/types.ts';
import type { DatabaseState } from './store.ts';

export class MySqlAdapter {
  private pool: Pool | null = null;
  private syncQueue: Promise<void> = Promise.resolve();

  public isEnabled(): boolean {
    return (process.env.DB_DRIVER ?? 'json').toLowerCase() === 'mysql';
  }

  private getConfig() {
    return {
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE ?? 'reffo_printflow',
    };
  }

  public async initialize(seedState: DatabaseState): Promise<DatabaseState> {
    const cfg = this.getConfig();
    const bootstrapConn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      multipleStatements: true,
    });

    const schemaPath = path.resolve(process.cwd(), 'database', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await bootstrapConn.query(sql);
    } else {
      await bootstrapConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
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
      connectionLimit: 10,
    });

    await this.migrateSchema();

    const [userRows] = await this.pool.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM users');
    const count = Number(userRows[0]?.cnt ?? 0);
    if (count === 0) {
      await this.writeSnapshot(seedState);
      return seedState;
    }

    return await this.loadSnapshot();
  }

  public queuePersist(state: DatabaseState): void {
    if (!this.pool) return;
    const cloned: DatabaseState = JSON.parse(JSON.stringify(state));
    this.syncQueue = this.syncQueue
      .then(() => this.writeSnapshot(cloned))
      .catch((err) => {
        console.error('Gagal sinkronisasi ke MySQL:', err);
      });
  }

  private async migrateSchema(): Promise<void> {
    if (!this.pool) return;
    const columns: Array<{ table: string; column: string; ddl: string }> = [
      { table: 'users', column: 'active', ddl: 'TINYINT(1) NOT NULL DEFAULT 1' },
      { table: 'instansis', column: 'npwp', ddl: 'VARCHAR(40) NULL' },
      { table: 'instansis', column: 'is_pkp', ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
      { table: 'instansis', column: 'ppn_persen', ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0' },
      { table: 'instansis', column: 'pph23_persen', ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0' },
      { table: 'instansis', column: 'tempo_hari', ddl: 'INT NOT NULL DEFAULT 0' },
      { table: 'instansis', column: 'credit_limit', ddl: 'DECIMAL(14,2) NOT NULL DEFAULT 0' },
      { table: 'instansis', column: 'pajak_reklame_expired', ddl: 'VARCHAR(40) NULL' },
      { table: 'orders', column: 'status_nota', ddl: "ENUM('aktif','batal') NOT NULL DEFAULT 'aktif'" },
      { table: 'orders', column: 'alasan_batal', ddl: 'TEXT NULL' },
      { table: 'orders', column: 'diskon_persen', ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0' },
      { table: 'orders', column: 'diskon_nominal', ddl: 'DECIMAL(12,2) NOT NULL DEFAULT 0' },
      { table: 'orders', column: 'ppn_persen', ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0' },
      { table: 'orders', column: 'ppn_nominal', ddl: 'DECIMAL(12,2) NOT NULL DEFAULT 0' },
      { table: 'orders', column: 'pph23_persen', ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0' },
      { table: 'orders', column: 'pph23_nominal', ddl: 'DECIMAL(12,2) NOT NULL DEFAULT 0' },
      { table: 'orders', column: 'tanda_tangan_pengambil', ddl: 'LONGTEXT NULL' },
      { table: 'orders', column: 'jatuh_tempo', ddl: 'VARCHAR(40) NULL' },
      { table: 'orders', column: 'approval_token', ddl: 'VARCHAR(80) NULL' },
      {
        table: 'orders',
        column: 'approval_status',
        ddl: "ENUM('belum','menunggu','disetujui','revisi') NOT NULL DEFAULT 'belum'",
      },
      { table: 'orders', column: 'approval_note', ddl: 'TEXT NULL' },
      { table: 'products', column: 'mesin_default_id', ddl: 'INT NULL' },
      {
        table: 'products',
        column: 'satuan_hitung',
        ddl: "ENUM('pcs','klik') NOT NULL DEFAULT 'pcs'",
      },
      { table: 'products', column: 'klik_per_lembar', ddl: 'INT NOT NULL DEFAULT 1' },
      { table: 'products', column: 'ukuran_lembar', ddl: 'VARCHAR(80) NULL' },
      { table: 'order_items', column: 'harga_sebelum_diskon', ddl: 'DECIMAL(12,2) NOT NULL DEFAULT 0' },
      { table: 'order_items', column: 'diskon_persen', ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0' },
      { table: 'order_items', column: 'diskon_nominal', ddl: 'DECIMAL(12,2) NOT NULL DEFAULT 0' },
      { table: 'order_items', column: 'machine_id', ddl: 'INT NULL' },
      { table: 'order_items', column: 'operator_id', ddl: 'INT NULL' },
      { table: 'order_items', column: 'finishing_user_id', ddl: 'INT NULL' },
      { table: 'order_items', column: 'waktu_mulai_cetak', ddl: 'VARCHAR(40) NULL' },
      { table: 'order_items', column: 'waktu_selesai_cetak', ddl: 'VARCHAR(40) NULL' },
      { table: 'order_items', column: 'klik_total', ddl: 'INT NULL' },
      { table: 'order_items', column: 'estimasi_tinta_ml', ddl: 'DECIMAL(10,2) NULL' },
      { table: 'order_items', column: 'batch_id', ddl: 'INT NULL' },
      {
        table: 'order_items',
        column: 'satuan_hitung',
        ddl: "ENUM('pcs','klik') NOT NULL DEFAULT 'pcs'",
      },
      { table: 'order_items', column: 'klik_per_lembar', ddl: 'INT NOT NULL DEFAULT 1' },
      { table: 'order_items', column: 'ukuran_lembar', ddl: 'VARCHAR(80) NULL' },
      { table: 'order_payments', column: 'shift_id', ddl: 'INT NULL' },
    ];

    for (const item of columns) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [item.table, item.column],
      );
      if (Number(rows[0]?.cnt ?? 0) === 0) {
        await this.pool.query(`ALTER TABLE \`${item.table}\` ADD COLUMN \`${item.column}\` ${item.ddl}`);
      }
    }

    const tables: Array<{ name: string; ddl: string }> = [
      {
        name: 'print_machines',
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
        )`,
      },
      {
        name: 'supplies',
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
        )`,
      },
      {
        name: 'supply_usages',
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
        )`,
      },
      {
        name: 'print_batches',
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
        )`,
      },
      {
        name: 'insentif_rates',
        ddl: `CREATE TABLE IF NOT EXISTS \`insentif_rates\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          role VARCHAR(30) NOT NULL,
          jenis VARCHAR(20) NOT NULL,
          nominal DECIMAL(14,2) NOT NULL DEFAULT 0,
          updated_at VARCHAR(40) NULL,
          updated_by INT NULL,
          UNIQUE KEY uq_insentif_role_jenis (role, jenis)
        )`,
      },
    ];
    for (const table of tables) {
      await this.pool.query(table.ddl);
    }

    const indexes: Array<{ table: string; name: string; columns: string }> = [
      { table: 'orders', name: 'idx_orders_created_status', columns: 'created_at, status_bayar' },
      { table: 'orders', name: 'idx_orders_status_nota', columns: 'status_nota' },
      { table: 'order_items', name: 'idx_order_items_status_order', columns: 'status_produksi, order_id' },
      { table: 'order_payments', name: 'idx_order_payments_order_date', columns: 'order_id, tanggal' },
      { table: 'order_payments', name: 'idx_order_payments_shift', columns: 'shift_id' },
      { table: 'material_logs', name: 'idx_material_logs_created', columns: 'created_at' },
      { table: 'design_revisions', name: 'idx_design_revisions_order', columns: 'order_id' },
      { table: 'audit_logs', name: 'idx_audit_logs_created', columns: 'created_at' },
      { table: 'order_items', name: 'idx_order_items_machine', columns: 'machine_id, status_produksi' },
      { table: 'order_items', name: 'idx_order_items_operator', columns: 'operator_id' },
      { table: 'supply_usages', name: 'idx_supply_usages_created', columns: 'created_at' },
      { table: 'print_batches', name: 'idx_print_batches_created', columns: 'created_at' },
      { table: 'purchase_orders', name: 'idx_po_supplier_status', columns: 'supplier_id, status, tanggal' },
      { table: 'goods_receipts', name: 'idx_goods_receipts_po', columns: 'po_id, created_at' },
      { table: 'supplier_payments', name: 'idx_supplier_payments_po', columns: 'purchase_order_id, tanggal' },
      { table: 'whatsapp_outbox', name: 'idx_wa_outbox_status', columns: 'status, next_attempt_at' },
    ];
    for (const idx of indexes) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [idx.table, idx.name],
      );
      if (Number(rows[0]?.cnt ?? 0) === 0) {
        await this.pool.query(`CREATE INDEX \`${idx.name}\` ON \`${idx.table}\` (${idx.columns})`);
      }
    }
  }

  public async withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('MySQL pool belum terinisialisasi.');
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

  public async lockRow(
    conn: PoolConnection,
    table: 'material_rolls' | 'products' | 'orders' | 'supplies' | 'print_machines',
    id: number,
  ): Promise<RowDataPacket | null> {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM \`${table}\` WHERE id = ? FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async loadSnapshot(): Promise<DatabaseState> {
    if (!this.pool) throw new Error('MySQL pool belum terinisialisasi.');

    const [users] = await this.pool.query<RowDataPacket[]>('SELECT id, name, email, role, password, active FROM users ORDER BY id');
    const [instansis] = await this.pool.query<RowDataPacket[]>('SELECT * FROM instansis ORDER BY id');
    const [customers] = await this.pool.query<RowDataPacket[]>('SELECT * FROM customers ORDER BY id');
    const [products] = await this.pool.query<RowDataPacket[]>('SELECT * FROM products ORDER BY id');
    const [finishings] = await this.pool.query<RowDataPacket[]>('SELECT * FROM finishings ORDER BY id');
    const [material_rolls] = await this.pool.query<RowDataPacket[]>('SELECT * FROM material_rolls ORDER BY id');
    const [material_offcuts] = await this.pool.query<RowDataPacket[]>('SELECT * FROM material_offcuts ORDER BY id');
    const [machines] = await this.pool.query<RowDataPacket[]>('SELECT * FROM print_machines ORDER BY id');
    const [supplies] = await this.pool.query<RowDataPacket[]>('SELECT * FROM supplies ORDER BY id');
    const [supply_usages] = await this.pool.query<RowDataPacket[]>('SELECT * FROM supply_usages ORDER BY id');
    const [print_batches] = await this.pool.query<RowDataPacket[]>('SELECT * FROM print_batches ORDER BY id');
    const [orders] = await this.pool.query<RowDataPacket[]>('SELECT * FROM orders ORDER BY id');
    const [order_items] = await this.pool.query<RowDataPacket[]>('SELECT * FROM order_items ORDER BY id');
    const [order_payments] = await this.pool.query<RowDataPacket[]>('SELECT * FROM order_payments ORDER BY id');
    const [design_revisions] = await this.pool.query<RowDataPacket[]>('SELECT * FROM design_revisions ORDER BY id');
    const [advertising_spks] = await this.pool.query<RowDataPacket[]>('SELECT * FROM advertising_spks ORDER BY id');
    const [material_logs] = await this.pool.query<RowDataPacket[]>('SELECT * FROM material_logs ORDER BY id');
    const [operational_expenses] = await this.pool.query<RowDataPacket[]>('SELECT * FROM operational_expenses ORDER BY id');
    const [shifts] = await this.pool.query<RowDataPacket[]>('SELECT * FROM shifts ORDER BY id');
    const [audit_logs] = await this.pool.query<RowDataPacket[]>('SELECT * FROM audit_logs ORDER BY id');
    const [suppliers] = await this.pool.query<RowDataPacket[]>('SELECT * FROM suppliers ORDER BY id');
    const [purchase_orders] = await this.pool.query<RowDataPacket[]>('SELECT * FROM purchase_orders ORDER BY id');
    const [goods_receipts] = await this.pool.query<RowDataPacket[]>('SELECT * FROM goods_receipts ORDER BY id');
    const [supplier_payments] = await this.pool.query<RowDataPacket[]>('SELECT * FROM supplier_payments ORDER BY id');
    const [whatsapp_outbox] = await this.pool.query<RowDataPacket[]>('SELECT * FROM whatsapp_outbox ORDER BY id');
    const [insentif_rates] = await this.pool.query<RowDataPacket[]>('SELECT * FROM insentif_rates ORDER BY id');

    const maxId = (rows: RowDataPacket[]) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

    return {
      users: users.map((u) => ({ ...u, active: Number(u.active ?? 1) === 1 })) as DatabaseState['users'],
      instansis: instansis.map((i) => ({
        ...i,
        is_pkp: Number(i.is_pkp ?? 0) === 1,
        ppn_persen: Number(i.ppn_persen ?? 0),
        pph23_persen: Number(i.pph23_persen ?? 0),
        tempo_hari: Number(i.tempo_hari ?? 0),
        credit_limit: Number(i.credit_limit ?? 0),
      })) as DatabaseState['instansis'],
      customers: customers as DatabaseState['customers'],
      products: products.map((p) => ({
        ...p,
        harga_umum: Number(p.harga_umum),
        harga_reseller: Number(p.harga_reseller),
        harga_prioritas: Number(p.harga_prioritas),
        harga_pegawai: Number(p.harga_pegawai),
        harga_modal: Number(p.harga_modal),
        stok_pcs: num(p.stok_pcs),
        mesin_default_id: num(p.mesin_default_id),
        satuan_hitung: p.satuan_hitung ?? 'pcs',
        klik_per_lembar: Number(p.klik_per_lembar ?? 1),
        ukuran_lembar: p.ukuran_lembar ?? null,
      })) as DatabaseState['products'],
      finishings: finishings.map((f) => ({
        ...f,
        ekstra_kiri_cm: Number(f.ekstra_kiri_cm),
        ekstra_kanan_cm: Number(f.ekstra_kanan_cm),
        ekstra_atas_cm: Number(f.ekstra_atas_cm),
        ekstra_bawah_cm: Number(f.ekstra_bawah_cm),
      })) as DatabaseState['finishings'],
      material_rolls: material_rolls.map((r) => ({
        ...r,
        lebar_m: Number(r.lebar_m),
        panjang_awal_m: Number(r.panjang_awal_m),
        panjang_sisa_m: Number(r.panjang_sisa_m),
      })) as DatabaseState['material_rolls'],
      material_offcuts: material_offcuts.map((o) => ({
        ...o,
        lebar_m: Number(o.lebar_m),
        panjang_m: Number(o.panjang_m),
        luas_m2: Number(o.luas_m2),
      })) as DatabaseState['material_offcuts'],
      machines: machines.map((m) => ({
        ...m,
        lebar_max_m: num(m.lebar_max_m),
        konsumsi_tinta_ml_per_m2: Number(m.konsumsi_tinta_ml_per_m2 ?? 0),
        aktif: Number(m.aktif ?? 1) === 1,
      })) as DatabaseState['machines'],
      supplies: supplies.map((s) => ({
        ...s,
        stok: Number(s.stok ?? 0),
        stok_minimum: Number(s.stok_minimum ?? 0),
        harga_satuan: Number(s.harga_satuan ?? 0),
        konsumsi_per_m2: num(s.konsumsi_per_m2),
        aktif: Number(s.aktif ?? 1) === 1,
      })) as DatabaseState['supplies'],
      supply_usages: supply_usages.map((u) => ({
        ...u,
        jumlah: Number(u.jumlah ?? 0),
      })) as DatabaseState['supply_usages'],
      print_batches: print_batches.map((b) => ({
        ...b,
        item_ids: Array.isArray(b.item_ids)
          ? b.item_ids.map(Number)
          : (() => {
              try {
                return JSON.parse(String(b.item_ids ?? '[]')).map(Number);
              } catch {
                return [];
              }
            })(),
        lebar_gabungan_m: Number(b.lebar_gabungan_m ?? 0),
        panjang_tarik_m: Number(b.panjang_tarik_m ?? 0),
        luas_terpakai_m2: Number(b.luas_terpakai_m2 ?? 0),
        luas_waste_m2: Number(b.luas_waste_m2 ?? 0),
      })) as DatabaseState['print_batches'],
      orders: orders.map((o) => ({
        ...o,
        total_tagihan: Number(o.total_tagihan),
        jumlah_dp: Number(o.jumlah_dp),
        diskon_persen: Number(o.diskon_persen ?? 0),
        diskon_nominal: Number(o.diskon_nominal ?? 0),
        ppn_persen: Number(o.ppn_persen ?? 0),
        ppn_nominal: Number(o.ppn_nominal ?? 0),
        pph23_persen: Number(o.pph23_persen ?? 0),
        pph23_nominal: Number(o.pph23_nominal ?? 0),
      })) as DatabaseState['orders'],
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
        satuan_hitung: i.satuan_hitung ?? 'pcs',
        klik_per_lembar: Number(i.klik_per_lembar ?? 1),
        ukuran_lembar: i.ukuran_lembar ?? null,
      })) as DatabaseState['order_items'],
      order_payments: order_payments.map((p) => ({
        ...p,
        nominal: Number(p.nominal),
        shift_id: p.shift_id === null || p.shift_id === undefined ? null : Number(p.shift_id),
      })) as DatabaseState['order_payments'],
      design_revisions: design_revisions as DatabaseState['design_revisions'],
      advertising_spks: advertising_spks as DatabaseState['advertising_spks'],
      material_logs: material_logs.map((l) => ({
        ...l,
        luas_netto_m2: Number(l.luas_netto_m2),
        wos_finishing_m2: Number(l.wos_finishing_m2),
        wos_potong_m2: Number(l.wos_potong_m2),
        gagal_cetak_m2: Number(l.gagal_cetak_m2),
      })) as DatabaseState['material_logs'],
      operational_expenses: operational_expenses.map((e) => ({
        ...e,
        tanggal: e.tanggal instanceof Date ? e.tanggal.toISOString().slice(0, 10) : String(e.tanggal).slice(0, 10),
        nominal: Number(e.nominal),
      })) as DatabaseState['operational_expenses'],
      shifts: shifts.map((s) => ({
        ...s,
        opening_cash: Number(s.opening_cash),
        expected_tunai: Number(s.expected_tunai),
        expected_transfer: Number(s.expected_transfer),
        expected_qris: Number(s.expected_qris),
        actual_tunai: Number(s.actual_tunai),
        actual_transfer: Number(s.actual_transfer),
        actual_qris: Number(s.actual_qris),
        selisih: Number(s.selisih),
      })) as DatabaseState['shifts'],
      audit_logs: audit_logs as DatabaseState['audit_logs'],
      suppliers: suppliers.map((s) => ({
        ...s,
        aktif: Number(s.aktif ?? 1) === 1,
      })) as DatabaseState['suppliers'],
      purchase_orders: purchase_orders.map((p) => ({
        ...p,
        items: (() => {
          try {
            const parsed = JSON.parse(String(p.items_json ?? '[]'));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        total: Number(p.total ?? 0),
        sudah_dibayar: Number(p.sudah_dibayar ?? 0),
        hutang: Number(p.hutang ?? 0),
      })) as DatabaseState['purchase_orders'],
      goods_receipts: goods_receipts as DatabaseState['goods_receipts'],
      supplier_payments: supplier_payments.map((p) => ({
        ...p,
        nominal: Number(p.nominal ?? 0),
      })) as DatabaseState['supplier_payments'],
      whatsapp_outbox: whatsapp_outbox.map((w) => ({
        ...w,
        attempts: Number(w.attempts ?? 0),
      })) as DatabaseState['whatsapp_outbox'],
      insentif_rates: insentif_rates.map((r) => ({
        ...r,
        nominal: Number(r.nominal ?? 0),
        updated_at: r.updated_at ?? null,
        updated_by: num(r.updated_by),
      })) as InsentifRate[],
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
        insentif_rates: maxId(insentif_rates),
      },
    };
  }

  private async writeSnapshot(state: DatabaseState): Promise<void> {
    if (!this.pool) return;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      const tables = [
        'print_batches',
        'supply_usages',
        'whatsapp_outbox',
        'insentif_rates',
        'supplier_payments',
        'goods_receipts',
        'purchase_orders',
        'suppliers',
        'audit_logs',
        'shifts',
        'operational_expenses',
        'material_logs',
        'advertising_spks',
        'design_revisions',
        'order_payments',
        'order_items',
        'orders',
        'print_machines',
        'supplies',
        'material_offcuts',
        'material_rolls',
        'finishings',
        'products',
        'customers',
        'instansis',
        'users',
      ];
      for (const t of tables) {
        await conn.query(`DELETE FROM ${t}`);
      }

      for (const u of state.users) {
        await conn.query(
          'INSERT INTO users (id, name, email, role, password, active) VALUES (?, ?, ?, ?, ?, ?)',
          [u.id, u.name, u.email, u.role, u.password, u.active === false ? 0 : 1],
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
            i.pajak_reklame_expired ?? null,
          ],
        );
      }
      for (const c of state.customers) {
        await conn.query(
          'INSERT INTO customers (id, instansi_id, instansi, nama_pelanggan, no_wa, kategori, alamat) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [c.id, c.instansi_id, c.instansi, c.nama_pelanggan, c.no_wa, c.kategori, c.alamat],
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
            p.satuan_hitung ?? 'pcs',
            p.klik_per_lembar ?? 1,
            p.ukuran_lembar ?? null,
          ],
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
            m.updated_at,
          ],
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
            s.updated_at,
          ],
        );
      }
      for (const f of state.finishings) {
        await conn.query(
          'INSERT INTO finishings (id, nama_finishing, ekstra_kiri_cm, ekstra_kanan_cm, ekstra_atas_cm, ekstra_bawah_cm) VALUES (?, ?, ?, ?, ?, ?)',
          [f.id, f.nama_finishing, f.ekstra_kiri_cm, f.ekstra_kanan_cm, f.ekstra_atas_cm, f.ekstra_bawah_cm],
        );
      }
      for (const r of state.material_rolls) {
        await conn.query(
          'INSERT INTO material_rolls (id, kode_roll, jenis_bahan, lebar_m, panjang_awal_m, panjang_sisa_m, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.id, r.kode_roll, r.jenis_bahan, r.lebar_m, r.panjang_awal_m, r.panjang_sisa_m, r.status],
        );
      }
      for (const o of state.material_offcuts) {
        await conn.query(
          'INSERT INTO material_offcuts (id, material_roll_id, kode_roll, jenis_bahan, lebar_m, panjang_m, luas_m2, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [o.id, o.material_roll_id, o.kode_roll ?? null, o.jenis_bahan, o.lebar_m, o.panjang_m, o.luas_m2, o.status, o.created_at],
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            o.id, o.no_nota, o.customer_id, o.user_id, o.designer_id, o.total_tagihan, o.jumlah_dp,
            o.status_bayar, o.status_nota ?? 'aktif', o.alasan_batal ?? null, o.diskon_persen ?? 0,
            o.diskon_nominal ?? 0, o.ppn_persen ?? 0, o.ppn_nominal ?? 0, o.pph23_persen ?? 0,
            o.pph23_nominal ?? 0, o.jatuh_tempo ?? null, o.approval_token ?? null,
            o.approval_status ?? 'belum', o.approval_note ?? null,
            o.status_desain, o.catatan_desain, o.lampiran_briefing, o.file_master_arsip,
            o.waktu_terima_desain, o.waktu_selesai_desain, o.tanda_tangan_desainer, o.tanda_tangan_admin,
            o.bukti_pelunasan, o.foto_serah_terima, o.tanda_tangan_pengambil ?? null,
            o.nama_pengambil, o.no_wa_pengambil, o.waktu_serah_terima,
            o.catatan_pengecualian, o.deadline, o.created_at, o.updated_at,
          ],
        );
      }
      for (const it of state.order_items) {
        await conn.query(
          `INSERT INTO order_items (id, order_id, nama_item, product_id, finishing_id, lebar_m, tinggi_m, qty, luas_tagihan_m2,
             harga_satuan_dipakai, harga_sebelum_diskon, diskon_persen, diskon_nominal, subtotal, status_produksi,
             machine_id, operator_id, finishing_user_id, waktu_mulai_cetak, waktu_selesai_cetak, klik_total, estimasi_tinta_ml, batch_id,
             satuan_hitung, klik_per_lembar, ukuran_lembar,
             acc_admin_id, waktu_acc, file_preview_acc, file_cetak_tiff, file_master_arsip, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            it.id, it.order_id, it.nama_item, it.product_id, it.finishing_id, it.lebar_m, it.tinggi_m,
            it.qty, it.luas_tagihan_m2, it.harga_satuan_dipakai, it.harga_sebelum_diskon ?? it.subtotal,
            it.diskon_persen ?? 0, it.diskon_nominal ?? 0, it.subtotal, it.status_produksi,
            it.machine_id ?? null, it.operator_id ?? null, it.finishing_user_id ?? null,
            it.waktu_mulai_cetak ?? null, it.waktu_selesai_cetak ?? null,
            it.klik_total ?? null, it.estimasi_tinta_ml ?? null, it.batch_id ?? null,
            it.satuan_hitung ?? 'pcs', it.klik_per_lembar ?? 1, it.ukuran_lembar ?? null,
            it.acc_admin_id, it.waktu_acc, it.file_preview_acc, it.file_cetak_tiff, it.file_master_arsip,
            it.created_at, it.updated_at,
          ],
        );
      }
      for (const u of state.supply_usages) {
        await conn.query(
          `INSERT INTO supply_usages (id, supply_id, order_item_id, jumlah, satuan, keterangan, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.id, u.supply_id, u.order_item_id, u.jumlah, u.satuan, u.keterangan ?? null, u.user_id, u.created_at],
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
            b.created_at,
          ],
        );
      }
      for (const pay of state.order_payments) {
        await conn.query(
          'INSERT INTO order_payments (id, order_id, tanggal, nominal, metode, keterangan, bukti_bayar, admin_id, shift_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [pay.id, pay.order_id, pay.tanggal, pay.nominal, pay.metode, pay.keterangan, pay.bukti_bayar, pay.admin_id, pay.shift_id ?? null, pay.created_at],
        );
      }
      for (const rev of state.design_revisions) {
        await conn.query(
          'INSERT INTO design_revisions (id, order_id, order_item_id, revisi_ke, catatan_revisi, file_preview, admin_id, status_revisi, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [rev.id, rev.order_id, rev.order_item_id, rev.revisi_ke, rev.catatan_revisi, rev.file_preview, rev.admin_id, rev.status_revisi, rev.created_at],
        );
      }
      for (const spk of state.advertising_spks) {
        await conn.query(
          'INSERT INTO advertising_spks (id, order_id, jenis_pekerjaan, ukuran_konstruksi, lokasi_pasang, catatan_teknis, status_lapangan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [spk.id, spk.order_id, spk.jenis_pekerjaan, spk.ukuran_konstruksi, spk.lokasi_pasang, spk.catatan_teknis, spk.status_lapangan, spk.created_at, spk.updated_at],
        );
      }
      for (const log of state.material_logs) {
        await conn.query(
          'INSERT INTO material_logs (id, order_item_id, material_roll_id, material_offcut_id, luas_netto_m2, wos_finishing_m2, wos_potong_m2, gagal_cetak_m2, keterangan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [log.id, log.order_item_id, log.material_roll_id, log.material_offcut_id, log.luas_netto_m2, log.wos_finishing_m2, log.wos_potong_m2, log.gagal_cetak_m2, log.keterangan, log.created_at],
        );
      }
      for (const exp of state.operational_expenses) {
        await conn.query(
          'INSERT INTO operational_expenses (id, tanggal, kategori_biaya, keterangan, nominal, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [exp.id, exp.tanggal, exp.kategori_biaya, exp.keterangan, exp.nominal, exp.created_at],
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
            shift.status,
          ],
        );
      }
      for (const s of state.suppliers) {
        await conn.query(
          `INSERT INTO suppliers (id, kode_supplier, nama_supplier, kontak, no_wa, alamat, npwp, aktif, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id, s.kode_supplier, s.nama_supplier, s.kontak ?? null, s.no_wa ?? null,
            s.alamat ?? null, s.npwp ?? null, s.aktif ? 1 : 0, s.created_at, s.updated_at,
          ],
        );
      }
      for (const po of state.purchase_orders) {
        await conn.query(
          `INSERT INTO purchase_orders (id, no_po, supplier_id, tanggal, expected_at, status, catatan,
             items_json, total, sudah_dibayar, hutang, diterima_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            po.id, po.no_po, po.supplier_id, po.tanggal, po.expected_at ?? null, po.status,
            po.catatan ?? null, JSON.stringify(po.items ?? []), po.total ?? 0,
            po.sudah_dibayar ?? 0, po.hutang ?? 0, po.diterima_at ?? null,
            po.created_at, po.updated_at,
          ],
        );
      }
      for (const gr of state.goods_receipts) {
        await conn.query(
          `INSERT INTO goods_receipts (id, po_id, no_po, tanggal, admin_id, catatan, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [gr.id, gr.po_id, gr.no_po, gr.tanggal, gr.admin_id, gr.catatan ?? null, gr.created_at],
        );
      }
      for (const sp of state.supplier_payments) {
        await conn.query(
          `INSERT INTO supplier_payments (id, supplier_id, purchase_order_id, tanggal, nominal, metode, keterangan, admin_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sp.id, sp.supplier_id, sp.purchase_order_id, sp.tanggal, sp.nominal, sp.metode,
            sp.keterangan ?? null, sp.admin_id, sp.created_at,
          ],
        );
      }
      for (const w of state.whatsapp_outbox) {
        await conn.query(
          `INSERT INTO whatsapp_outbox (id, event, dedupe_key, order_id, no_wa, pesan, link, status,
             attempts, last_error, next_attempt_at, created_at, updated_at, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            w.id, w.event, w.dedupe_key, w.order_id ?? null, w.no_wa, w.pesan, w.link ?? null,
            w.status, w.attempts ?? 0, w.last_error ?? null, w.next_attempt_at ?? null,
            w.created_at, w.updated_at, w.sent_at ?? null,
          ],
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
            rate.updated_by ?? null,
          ],
        );
      }
      for (const log of state.audit_logs) {
        await conn.query(
          `INSERT INTO audit_logs (id, user_id, user_name, role, action, entity, entity_id, detail, ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [log.id, log.user_id, log.user_name, log.role, log.action, log.entity, log.entity_id, log.detail, log.ip, log.created_at],
        );
      }

      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

export const mysqlAdapter = new MySqlAdapter();
