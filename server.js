import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE-ME-IN-PRODUCTION';
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({limit:'100mb'}));
app.use(cookieParser());

app.get('/api/health', async (req,res)=>{
  try {
    await pool.query('SELECT 1');
    res.json({ok:true, database:true, service:'painel-convenios'});
  } catch (e) {
    console.error('Health check DB error:', e);
    res.status(503).json({ok:false, database:false, error:'Banco de dados indisponível.'});
  }
});

async function ensureSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('master','user')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_bases (
      key TEXT PRIMARY KEY,
      rows JSONB NOT NULL,
      file_name TEXT,
      source_sheet TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS app_bases_updated_at_idx ON app_bases(updated_at);
  `);
}

function hash(v){ return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function sign(user){ return jwt.sign({id:user.id,u:user.username,role:user.role,name:user.name}, JWT_SECRET, {expiresIn:'12h'}); }
function auth(req,res,next){
  try{ const token=req.cookies.sesa_session; if(!token) return res.status(401).json({error:'Não autenticado.'}); req.user=jwt.verify(token,JWT_SECRET); next(); }
  catch{ return res.status(401).json({error:'Sessão inválida ou expirada.'}); }
}
function master(req,res,next){ if(req.user?.role!=='master') return res.status(403).json({error:'Acesso restrito ao Master.'}); next(); }
async function countUsers(){ const r=await pool.query('SELECT COUNT(*)::int AS n FROM app_users'); return r.rows[0].n; }

app.post('/api/auth/login', async (req,res)=>{
  try{
    const username=String(req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    if(!username||password.length<4) return res.status(400).json({error:'Informe usuário e senha válidos.'});
    let r=await pool.query('SELECT id,username,name,password_hash,role FROM app_users WHERE username=$1',[username]);
    let bootstrap=false;
    if(!r.rows.length && (await countUsers())===0){
      const ins=await pool.query('INSERT INTO app_users(username,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,name,role',[username,username,hash(password),'master']);
      r={rows:ins.rows}; bootstrap=true;
    } else if(!r.rows.length) return res.status(401).json({error:'Usuário não encontrado.'});
    else if(r.rows[0].password_hash!==hash(password)) return res.status(401).json({error:'Senha incorreta.'});
    const u=r.rows[0];
    res.cookie('sesa_session',sign(u),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*60*60*1000});
    res.json({user:{u:u.username,name:u.name,role:u.role},bootstrap});
  }catch(e){console.error(e);res.status(500).json({error:'Falha ao entrar no sistema.'});}
});

app.post('/api/auth/recover', async (req,res)=>{
  try{
    const username=String(req.body?.username||'').trim().toLowerCase();
    const recovery=String(req.body?.recoveryCode||'').trim().toUpperCase();
    const newPassword=String(req.body?.newPassword||'');
    if(newPassword.length<4) return res.status(400).json({error:'A nova senha deve ter ao menos 4 caracteres.'});
    const r=await pool.query('SELECT id,recovery_hash FROM app_users WHERE username=$1',[username]);
    if(!r.rows.length || !r.rows[0].recovery_hash || r.rows[0].recovery_hash!==hash(recovery)) return res.status(400).json({error:'Não foi possível validar os dados informados.'});
    await pool.query('UPDATE app_users SET password_hash=$1 WHERE id=$2',[hash(newPassword),r.rows[0].id]);
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:'Falha ao alterar a senha.'});}
});

app.get('/api/session',auth,(req,res)=>res.json({session:{u:req.user.u,name:req.user.name,role:req.user.role}}));
app.post('/api/session',auth,(req,res)=>res.json({ok:true}));
app.post('/api/logout',(req,res)=>{res.clearCookie('sesa_session');res.json({ok:true});});

app.get('/api/users',auth,master,async (req,res)=>{
  const r=await pool.query('SELECT username AS u,name,role,created_at AS "createdAt" FROM app_users ORDER BY created_at');
  res.json({users:r.rows});
});
app.post('/api/users',auth,master,async (req,res)=>{
  try{
    const u=req.body||{};
    const username=String(u.username||'').trim().toLowerCase();
    const name=String(u.name||username).trim();
    const passwordHash=String(u.passwordHash||'');
    const recoveryHash=u.recoveryHash?String(u.recoveryHash):null;
    const role=u.role==='master'?'master':'user';
    if(!username||!name||!passwordHash) return res.status(400).json({error:'Dados do usuário incompletos.'});
    const r=await pool.query('INSERT INTO app_users(username,name,password_hash,recovery_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING username AS u,name,role,created_at AS "createdAt"',[username,name,passwordHash,recoveryHash,role]);
    res.status(201).json({user:r.rows[0]});
  }catch(e){
    if(e?.code==='23505') return res.status(409).json({error:'Esse usuário já existe.'});
    console.error(e);res.status(500).json({error:'Falha ao criar usuário.'});
  }
});

app.put('/api/users/sync',auth,master,async (req,res)=>{
  const users=Array.isArray(req.body?.users)?req.body.users:[];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const u of users){
      if(!u?.u) continue;
      await client.query(`INSERT INTO app_users(username,name,password_hash,recovery_hash,role,created_at) VALUES($1,$2,$3,$4,$5,COALESCE($6,NOW())) ON CONFLICT(username) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,recovery_hash=EXCLUDED.recovery_hash,role=EXCLUDED.role`,[String(u.u).toLowerCase(),u.name||u.u,u.pass||'',u.recoveryHash||null,u.role==='master'?'master':'user',u.createdAt||null]);
    }
    await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Falha ao salvar usuários.'});}finally{client.release();}
});

app.put('/api/bases/main/batch',auth,master,async(req,res)=>{
  const bases=Array.isArray(req.body?.bases)?req.body.bases:[];
  if(!bases.length) return res.status(400).json({error:'Nenhuma base enviada.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const p of bases){
      if(!p?.key || !Array.isArray(p.rows)) throw new Error('Base inválida: '+String(p?.key||''));
      await client.query(`INSERT INTO app_bases(key,rows,file_name,source_sheet,updated_at) VALUES($1,$2,$3,$4,COALESCE($5,NOW())) ON CONFLICT(key) DO UPDATE SET rows=EXCLUDED.rows,file_name=EXCLUDED.file_name,source_sheet=EXCLUDED.source_sheet,updated_at=EXCLUDED.updated_at`,[p.key,JSON.stringify(p.rows),p.file||null,p.sourceSheet||null,p.updatedAt||null]);
    }
    await client.query('COMMIT');
    res.json({ok:true,updatedAt:bases[0]?.updatedAt||new Date().toISOString(),count:bases.length});
  }catch(e){
    await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Falha ao salvar a importação completa. Nenhuma base foi parcialmente atualizada.'});
  }finally{client.release();}
});

app.get('/api/bases/main',auth,async(req,res)=>{const r=await pool.query('SELECT key,rows,file_name AS "file",source_sheet AS "sourceSheet",updated_at AS "updatedAt" FROM app_bases');res.json({bases:r.rows});});
app.put('/api/bases/main/:key',auth,master,async(req,res)=>{const key=req.params.key;const p=req.body||{};if(!Array.isArray(p.rows)) return res.status(400).json({error:'Dados da base inválidos.'});await pool.query(`INSERT INTO app_bases(key,rows,file_name,source_sheet,updated_at) VALUES($1,$2,$3,$4,COALESCE($5,NOW())) ON CONFLICT(key) DO UPDATE SET rows=EXCLUDED.rows,file_name=EXCLUDED.file_name,source_sheet=EXCLUDED.source_sheet,updated_at=EXCLUDED.updated_at`,[key,JSON.stringify(p.rows),p.file||null,p.sourceSheet||null,p.updatedAt||null]);res.json({ok:true});});
app.get('/api/bases/siafe',auth,async(req,res)=>{const r=await pool.query('SELECT rows,updated_at AS "updatedAt" FROM app_bases WHERE key=$1',['__SIAFE__']);res.json(r.rows[0]||{rows:[],updatedAt:null});});
app.put('/api/bases/siafe',auth,master,async(req,res)=>{const p=req.body||{};if(!Array.isArray(p.rows)) return res.status(400).json({error:'Dados SIAFE inválidos.'});await pool.query(`INSERT INTO app_bases(key,rows,updated_at) VALUES('__SIAFE__',$1,COALESCE($2,NOW())) ON CONFLICT(key) DO UPDATE SET rows=EXCLUDED.rows,updated_at=EXCLUDED.updated_at`,[JSON.stringify(p.rows),p.updatedAt||null]);res.json({ok:true});});

const publicDir=path.join(__dirname,'public');
app.use(express.static(publicDir));
app.get(/.*/,(req,res)=>res.sendFile(path.join(publicDir,'Painel_Convenios_Corporativo_V44_COMPARTILHADO.html')));

ensureSchema()
  .then(()=>{
    app.listen(PORT,()=>console.log(`Painel compartilhado em http://localhost:${PORT}`));
  })
  .catch((e)=>{
    console.error('Falha ao inicializar o banco de dados:', e);
    process.exit(1);
  });
