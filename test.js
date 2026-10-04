// 自动化测试：模拟两名玩家完成 大厅→邀请→接受→对战 流程
const { io } = require('socket.io-client');

const URL = 'http://127.0.0.1:3000';
const ocA = { name: '测试甲', desc: 't', str: 80, agi: 70, def: 60, int: 50, vit: 75, luk: 60, magic: 40, alchemy: 30, combat: 50, tactic: 45 };
const ocB = { name: '测试乙', desc: 't', str: 60, agi: 65, def: 80, int: 70, vit: 60, luk: 55, magic: 60, alchemy: 40, combat: 35, tactic: 50 };

function power(o) { return o.str * 2 + o.agi * 1.6 + o.def * 1.5 + o.int * 1.8 + o.vit * 2 + o.luk * 1.2 + (o.magic + o.alchemy + o.combat + o.tactic) * 1.5; }

const a = io(URL, { transports: ['websocket'] });
const b = io(URL, { transports: ['websocket'] });
let done = false;
const finish = (ok, msg) => {
  if (done) return; done = true;
  console.log((ok ? '✅' : '❌') + ' ' + msg);
  a.close(); b.close();
  process.exit(ok ? 0 : 1);
};

setTimeout(() => finish(false, '超时（流程未在 8 秒内完成）'), 8000);

a.on('connect', () => a.emit('join', { name: ocA.name, power: power(ocA), isOP: false, oc: ocA }));
b.on('connect', () => b.emit('join', { name: ocB.name, power: power(ocB), isOP: false, oc: ocB }));

a.on('lobby', (d) => {
  const others = Object.keys(d.players).filter(k => k !== a.id);
  if (others.length > 0 && !done) {
    console.log('大厅OK：看到', Object.keys(d.players).length, '名玩家');
    a.emit('invite', { toId: others[0] });
  }
});

b.on('invite', (m) => {
  console.log('邀请OK：来自', m.fromName, '战力', m.fromPower);
  b.emit('accept', { toId: m.fromId });
});

let aMatch = null, bMatch = null;
const checkStart = () => {
  if (aMatch && bMatch) {
    const seedOk = aMatch.seed === bMatch.seed;
    const turnOk = aMatch.myTurn !== bMatch.myTurn;
    const ocOk = aMatch.opponentOc.name === ocB.name && bMatch.opponentOc.name === ocA.name;
    console.log('matchStart：seed一致=', seedOk, '先手互补=', turnOk, '对手OC正确=', ocOk);
    if (!(seedOk && turnOk && ocOk)) return finish(false, 'matchStart 校验失败');
    a.emit('action', { toId: bMatch.opponentId, type: 'attack' });
  }
};
a.on('matchStart', (m) => { aMatch = m; checkStart(); });
b.on('matchStart', (m) => { bMatch = m; checkStart(); });

b.on('action', (m) => {
  console.log('动作转发OK：type =', m.type);
  b.emit('action', { toId: aMatch.opponentId, type: 'magic' });
});

a.on('action', (m) => {
  console.log('反向动作OK：type =', m.type);
  // 断开 B，测试幽灵 OC
  b.close();
  setTimeout(() => {
    const { io } = require('socket.io-client');
    const c = io(URL, { transports: ['websocket'] });
    c.on('connect', () => {
      c.emit('join', { name: '测试丙', power: 500, isOP: false, oc: { ...ocA, name: '测试丙' } });
    });
    c.on('lobby', (d) => {
      const ghosts = Object.values(d.ghosts || {});
      const hit = ghosts.find(g => g.name === '测试乙');
      if (hit) {
        console.log('幽灵OK：离线的 测试乙 已变成幽灵 OC');
        c.close();
        finish(true, '全部流程通过：大厅/邀请/接受/开局/动作转发/幽灵OC');
      } else if (done) {
        // noop
      }
    });
  }, 500);
});
