// 学院擂台赛 · 后端大厅版 服务器
// 协议与前端 index.html 对应：
//   客户端 emit: join {name,power,isOP,oc} / invite {toId} / accept {toId} / reject {toId} / action {toId,type}
//   服务端 emit: lobby {players,ghosts} / invite {fromId,fromName,fromPower,fromIsOP}
//                / inviteResult {accepted,reason} / matchStart {opponentOc,seed,myTurn,opponentId} / action {type}
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const GHOST_LIMIT = 30; // 最多保留 30 个离线幽灵 OC

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server);

const players = {}; // socketId -> {name,power,isOP,oc}
const ghosts = {};   // id -> {name,power,isOP,oc}
const pendingInvites = {}; // 被邀请方id -> 邀请方id

function safeOC(oc) {
  if (!oc || typeof oc !== 'object') return null;
  const num = (v, d) => { const n = Math.round(+v); return isFinite(n) ? n : d; };
  return {
    name: String(oc.name || '无名氏').slice(0, 12),
    desc: String(oc.desc || '').slice(0, 40),
    str: num(oc.str, 50), agi: num(oc.agi, 50), def: num(oc.def, 50),
    int: num(oc.int, 50), vit: num(oc.vit, 50), luk: num(oc.luk, 50),
    magic: num(oc.magic, 0), alchemy: num(oc.alchemy, 0),
    combat: num(oc.combat, 0), tactic: num(oc.tactic, 0),
  };
}

function broadcastLobby() {
  io.emit('lobby', { players, ghosts });
}

function addGhost(p) {
  if (!p || !p.oc) return;
  ghosts['ghost_' + Date.now() + '_' + Math.floor(Math.random() * 9999)] = p;
  const keys = Object.keys(ghosts);
  while (keys.length > GHOST_LIMIT) {
    const oldest = keys.shift();
    delete ghosts[oldest];
  }
}

io.on('connection', (socket) => {
  console.log(`[+] 连接: ${socket.id}`);

  socket.on('join', (data) => {
    const oc = safeOC(data && data.oc);
    if (!oc) return;
    players[socket.id] = {
      name: oc.name,
      power: Math.round(+data.power) || 0,
      isOP: !!data.isOP,
      oc,
    };
    broadcastLobby();
  });

  socket.on('invite', (m) => {
    const from = players[socket.id];
    const toId = m && m.toId;
    if (!from) { socket.emit('inviteResult', { accepted: false, reason: '请先创建角色' }); return; }
    if (toId === socket.id) return;
    if (from.isOP) { socket.emit('inviteResult', { accepted: false, reason: 'OP 角色无法主动邀请' }); return; }
    const target = players[toId];
    if (!target) { socket.emit('inviteResult', { accepted: false, reason: '对方已离线' }); return; }
    pendingInvites[toId] = socket.id;
    io.to(toId).emit('invite', {
      fromId: socket.id,
      fromName: from.name,
      fromPower: from.power,
      fromIsOP: from.isOP,
    });
  });

  socket.on('accept', (m) => {
    const toId = m && m.toId; // 原邀请方
    const fromId = pendingInvites[socket.id];
    if (!fromId || fromId !== toId) {
      socket.emit('inviteResult', { accepted: false, reason: '邀请已失效' });
      return;
    }
    delete pendingInvites[socket.id];
    const me = players[socket.id];
    const other = players[toId];
    if (!me || !other) { socket.emit('inviteResult', { accepted: false, reason: '对方已离线' }); return; }

    io.to(toId).emit('inviteResult', { accepted: true });
    const seed = Math.floor(Math.random() * 1000000000);
    const inviterFirst = Math.random() < 0.5; // 邀请方是否先手
    io.to(toId).emit('matchStart', { opponentOc: me.oc, seed, myTurn: inviterFirst, opponentId: socket.id });
    io.to(socket.id).emit('matchStart', { opponentOc: other.oc, seed, myTurn: !inviterFirst, opponentId: toId });
  });

  socket.on('reject', (m) => {
    const toId = m && m.toId;
    if (pendingInvites[socket.id] === toId) delete pendingInvites[socket.id];
    io.to(toId).emit('inviteResult', { accepted: false, reason: '对方拒绝了切磋' });
  });

  socket.on('action', (m) => {
    // 纯转发：双方用同一 seed 本地模拟，保持同步
    const toId = m && m.toId;
    if (!toId || !players[toId]) return;
    io.to(toId).emit('action', { type: m.type });
  });

  socket.on('disconnect', () => {
    console.log(`[-] 断开: ${socket.id}`);
    const p = players[socket.id];
    if (p) addGhost(p); // 离线后留下幽灵 OC
    delete players[socket.id];
    for (const k of Object.keys(pendingInvites)) {
      if (pendingInvites[k] === socket.id) delete pendingInvites[k];
    }
    broadcastLobby();
  });

  broadcastLobby();
});

server.listen(PORT, () => {
  console.log(`学院擂台赛服务器已启动: http://127.0.0.1:${PORT}`);
});
