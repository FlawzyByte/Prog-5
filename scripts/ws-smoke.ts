import { io } from 'socket.io-client';
import { request as undiciRequest } from 'undici';

const USER = 'http://127.0.0.1:3001';
const ROOM = 'http://127.0.0.1:3002';
const GAME = 'http://127.0.0.1:3003';

async function post(url: string, body: unknown) {
  const res = await undiciRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${await res.body.text()}`);
  return res.body.json();
}

async function main() {
  const alice = (await post(`${USER}/users`, { username: 'alice' })) as any;
  const bob = (await post(`${USER}/users`, { username: 'bob' })) as any;
  const room = (await post(`${ROOM}/rooms`, { userId: alice.id })) as any;
  await post(`${ROOM}/rooms/${room.roomId}/join`, { userId: bob.id });

  await post(`${GAME}/game/${room.roomId}/place`, {
    playerId: alice.id,
    shipCoords: [{ from: 'A1', to: 'A1' }], // Single cell ship
  });
  await post(`${GAME}/game/${room.roomId}/place`, {
    playerId: bob.id,
    shipCoords: [{ from: 'B2', to: 'B2' }], // Single cell ship
  });

  const cAlice = io(GAME, { transports: ['websocket'] });
  const cBob = io(GAME, { transports: ['websocket'] });

  cAlice.on('connect', () => console.log('Alice connected'));
  cBob.on('connect', () => console.log('Bob connected'));

  let done = false;

  function log(label: string, data: unknown) {
    console.log(label, JSON.stringify(data));
  }

  cAlice.on('joinRoomAck', (m: any) => log('Alice joinRoomAck', m));
  cBob.on('joinRoomAck', (m: any) => log('Bob joinRoomAck', m));
  cAlice.on('fireResult', (m: any) => log('Alice fireResult', m));
  cBob.on('fireResult', (m: any) => log('Bob fireResult', m));
  cAlice.on('turnChange', (m: any) => log('Alice turnChange', m));
  cBob.on('turnChange', (m: any) => log('Bob turnChange', m));
  cAlice.on('gameOver', (m: any) => { log('Alice gameOver', m); done = true; });
  cBob.on('gameOver', (m: any) => { log('Bob gameOver', m); done = true; });

  cAlice.emit('joinRoom', { roomId: room.roomId, playerId: alice.id });
  cBob.emit('joinRoom', { roomId: room.roomId, playerId: bob.id });

  // Fire from alice (aiming for bob's ship at B2)
  setTimeout(() => {
    cAlice.emit('fire', { roomId: room.roomId, playerId: alice.id, coord: 'B2' });
  }, 500);
  
  // Fire from bob (aiming for alice's ship at A1)
  setTimeout(() => {
    cBob.emit('fire', { roomId: room.roomId, playerId: bob.id, coord: 'A1' });
  }, 1000);

  setTimeout(() => {
    if (!done) {
      console.log('Smoke test finished (no game over).');
      cAlice.close();
      cBob.close();
    }
  }, 2000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
