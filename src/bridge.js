'use strict';
/*
 * جسر متزامن إلى قاعدة بيانات PostgreSQL (Supabase) وخدمة التخزين.
 * كُتب الموقع على واجهة SQLite متزامنة؛ وللإبقاء على النماذج والمسارات كما هي تعمل الاستعلامات
 * داخل Worker مستقل (node-postgres) وينتظر الخيط الرئيسي النتيجة عبر Atomics.wait.
 *
 * كود الـ Worker هو الدالة runWorker نفسها تُمرَّر نصًا، فيجب ألا تعتمد على أي متغير خارجها.
 */
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');

const TIMEOUT_MS = 25000;

/* ---------------- داخل الـ Worker ---------------- */
// خانات الذاكرة المشتركة: 0 = وصل رد، 1 = بدأ العامل، 2 = نجح الاتصال بقاعدة البيانات مرة واحدة على الأقل
function runWorker() {
  const { port, signal, db } = workerData;
  const sig = new Int32Array(signal);
  Atomics.store(sig, 1, 1);
  const reply = (msg) => {
    port.postMessage(msg);
    Atomics.store(sig, 0, 1);
    Atomics.notify(sig, 0);
  };
  let pg;
  try { pg = require(workerData.pgPath || 'pg'); } catch (e) {
    // تعذر تحميل مكتبة pg: نرد على كل طلب بالسبب بدل ترك الخادم ينتظر
    port.on('message', () => reply({ ok: false, error: { message: `تعذر تحميل مكتبة pg: ${e.message}`, code: e.code } }));
    return;
  }
  // COUNT وSUM تعيد bigint/numeric؛ القيم هنا أصغر بكثير من حدود أرقام JavaScript
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

  let pool = null;
  let txClient = null;
  const getPool = () => {
    if (!pool) {
      pool = new pg.Pool({ ...db, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, query_timeout: 15000 });
      pool.on('connect', () => Atomics.store(sig, 2, 1));
      pool.on('error', () => { /* اتصال خامل انقطع: الاستعلام التالي يفتح اتصالًا جديدًا */ });
    }
    return pool;
  };
  // على Vercel قد تُجمَّد الدالة بين الطلبات فينقطع اتصال خامل: تُعاد القراءة أو بدء المعاملة مرة واحدة باتصال جديد
  const DROPPED = /Connection terminated|ECONNRESET|EPIPE|terminating connection|connection error|Client was closed|ETIMEDOUT/i;
  const retrying = async (fn) => {
    try { return await fn(); } catch (e) {
      if (!DROPPED.test(`${e.code || ''} ${e.message}`)) throw e;
      return fn();
    }
  };
  port.on('message', async (m) => {
    try {
      let result = null;
      if (m.op === 'query') {
        // إعادة المحاولة للقراءة فقط: الكتابة قد تكون نُفذت قبل انقطاع الاتصال
        const readOnly = /^\s*SELECT\b/i.test(m.sql);
        const r = txClient ? await txClient.query(m.sql, m.params)
          : readOnly ? await retrying(() => getPool().query(m.sql, m.params)) : await getPool().query(m.sql, m.params);
        result = { rows: r.rows, count: r.rowCount };
      } else if (m.op === 'begin') {
        txClient = await retrying(async () => {
          const c = await getPool().connect();
          try { await c.query('BEGIN'); return c; } catch (e) { c.release(true); throw e; }
        });
      } else if (m.op === 'commit' || m.op === 'rollback') {
        const c = txClient;
        txClient = null;
        if (c) {
          try { await c.query(m.op === 'commit' ? 'COMMIT' : 'ROLLBACK'); c.release(); } catch (e) { c.release(true); throw e; }
        }
      } else if (m.op === 'http') {
        const res = await fetch(m.url, { method: m.method, headers: m.headers, body: m.body, signal: AbortSignal.timeout(20000) });
        result = { status: res.status, text: await res.text() };
      } else if (m.op === 'close') {
        if (pool) await pool.end();
        pool = null;
      }
      reply({ ok: true, result });
    } catch (e) {
      reply({ ok: false, error: { message: e.message, code: e.code, detail: e.detail } });
    }
  });
}

/* ---------------- في الخيط الرئيسي ---------------- */
let worker = null;
let port = null;
let sig = null;
let dbConfig = null;
let lastError = null;

function configure(config) { dbConfig = config; }

function ensureWorker() {
  if (worker) return;
  if (!dbConfig) throw new Error('لم يُضبط اتصال قاعدة البيانات (DATABASE_URL)');
  const { port1, port2 } = new MessageChannel();
  const signal = new SharedArrayBuffer(12);
  // الكود يُمرَّر نصًا (eval) بدل مسار هذا الملف: على Vercel تُحوَّل الملفات وقد لا يطابق __filename ملفًا موجودًا
  let pgPath = 'pg';
  try { pgPath = require.resolve('pg'); } catch { /* يُحمَّل بالاسم */ }
  const code = `const { workerData } = require('node:worker_threads');\n(${runWorker.toString()})();`;
  const w = new Worker(code, { eval: true, workerData: { pgPath, port: port2, signal, db: dbConfig }, transferList: [port2] });
  w.unref();
  w.on('error', (e) => { console.error('توقف عامل قاعدة البيانات:', e); lastError = e; if (worker === w) reset(); });
  w.on('exit', (code) => { if (worker === w) { lastError ||= new Error(`exit code ${code}`); reset(); } });
  worker = w;
  port1.unref();
  port = port1;
  sig = new Int32Array(signal);
}
function reset() {
  if (worker) worker.terminate().catch(() => { /* تجاهل */ });
  worker = null;
  port = null;
  sig = null;
}

/*
 * تشغيل العامل وانتظار بدئه دون حجز الخيط الرئيسي. على Vercel لا يبدأ العامل بينما الخيط الرئيسي
 * محجوز في Atomics.wait، لذا يجب استدعاء هذه الدالة (await) قبل أي استعلام في كل طلب.
 */
const START_TIMEOUT_MS = 20000;
let starting = null;
function start() {
  if (worker && Atomics.load(sig, 1)) return Promise.resolve();
  if (starting) return starting;
  ensureWorker();
  const w = worker;
  starting = new Promise((resolve, reject) => {
    const began = Date.now();
    const timer = setInterval(() => {
      if (worker !== w) { finish(); return reject(Object.assign(new Error(`تعذر تشغيل عامل قاعدة البيانات: ${lastError ? lastError.message : 'توقف قبل أن يبدأ'}`), { code: 'DB_WORKER' })); }
      if (Atomics.load(sig, 1)) { finish(); return resolve(); }
      if (Date.now() - began > START_TIMEOUT_MS) { finish(); reset(); reject(Object.assign(new Error('لم يبدأ عامل قاعدة البيانات خلال 20 ثانية'), { code: 'DB_WORKER' })); }
    }, 10);
    const finish = () => { clearInterval(timer); starting = null; };
  });
  return starting;
}

function call(op, payload = {}) {
  ensureWorker();
  Atomics.store(sig, 0, 0);
  port.postMessage({ op, ...payload });
  if (Atomics.wait(sig, 0, 0, TIMEOUT_MS) === 'timed-out') {
    const stage = !Atomics.load(sig, 1) ? 'worker did not start' : !Atomics.load(sig, 2) ? 'no connection to the database server' : `no reply to ${op}`;
    reset();
    throw Object.assign(new Error(`انتهت مهلة الاتصال بقاعدة البيانات (${stage})`), { code: 'DB_TIMEOUT' });
  }
  const received = receiveMessageOnPort(port);
  if (!received) { reset(); throw new Error('لم يصل رد من عامل قاعدة البيانات'); }
  const msg = received.message;
  if (!msg.ok) throw Object.assign(new Error(msg.error.message), { code: msg.error.code, detail: msg.error.detail });
  return msg.result;
}

function close() {
  if (!worker) return;
  try { call('close'); } finally { reset(); }
}

module.exports = { configure, start, call, close };
