#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { request as undiciRequest } from 'undici';
import { io, Socket } from 'socket.io-client';
import * as readline from 'readline';

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

async function get(url: string) {
  const res = await undiciRequest(url, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${await res.body.text()}`);
  return res.body.json();
}

async function getJson(url: string): Promise<any> {
  const res = await undiciRequest(url, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  if (res.statusCode >= 400) return null;
  return res.body.json();
}

type GameState = {
  user: { id: string; username: string } | null;
  room: any | null;
  myShips: string[];
  enemyHits: string[];
  phase: 'login' | 'room' | 'placement' | 'battle' | 'gameover';
  turn: string | null;
  winner: string | null;
};

let socket: Socket | null = null;
let state: GameState = {
  user: null,
  room: null,
  myShips: [],
  enemyHits: [],
  phase: 'login',
  turn: null,
  winner: null,
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function printGrid(ships: string[] = [], hits: string[] = [], title: string, showShips = false) {
  console.log(chalk.bold(title));
  process.stdout.write('   ');
  for (let col = 1; col <= 3; col++) {
    process.stdout.write(chalk.bold(` ${col} `));
  }
  console.log();
  
  ['A', 'B', 'C'].forEach((row) => {
    process.stdout.write(chalk.bold(`${row} `));
    for (let col = 1; col <= 3; col++) {
      const coord = `${row}${col}`;
      if (showShips && ships.includes(coord)) {
        process.stdout.write(chalk.bgBlue(' 🚢 '));
      } else if (hits.includes(coord)) {
        process.stdout.write(chalk.bgRed(' 💥 '));
      } else {
        process.stdout.write(chalk.gray(' . '));
      }
    }
    console.log();
  });
  console.log();
}

async function play() {
  console.log(chalk.bold.cyan('\n🏴‍☠️  Battleship CLI Client 🏴‍☠️\n'));

  // Login
  const args = await yargs(hideBin(process.argv)).argv;
  const username = args.username as string || 'player' + Math.floor(Math.random() * 1000);
  
  console.log(chalk.yellow(`Logging in as: ${username}`));
  const user: any = await post(`${USER}/users`, { username });
  state.user = user as any;
  console.log(chalk.green(`✓ Logged in: ${user.username} (${user.id})\n`));

  // Connect to WebSocket
  socket = io(GAME, { transports: ['websocket'] });

  // Re-emit joinRoom on connect if we already have a room (handles reconnect/order issues)
  socket.on('connect', () => {
    console.log(chalk.green('✓ Connected to game server\n'));
    if (state.room?.roomId && state.user?.id) {
      socket?.emit('joinRoom', { roomId: state.room.roomId, playerId: state.user.id });
    }
  });

  // Reflect opponent joins
  socket.on('roomUpdate', (msg: any) => {
    state.room = msg;
    if (typeof msg.turn === 'string') state.turn = msg.turn;
    if (msg.players && msg.players.length >= 2) {
      console.log(chalk.cyan(`\n✓ Opponent joined!`));
      console.log(chalk.cyan(`Players in room:`));
      msg.players.forEach((p: any) => {
        const name = typeof p === 'string' ? p : p.username;
        const isYou = typeof p === 'string' ? p === state.user?.id : p.id === state.user?.id;
        console.log(isYou ? chalk.green(`  ✓ ${name} (you)`) : chalk.white(`  • ${name}`));
      });
      console.log();
    }
  });

  socket.on('joinRoomAck', (msg: any) => {
    state.room = msg;
    if (typeof msg.turn === 'string') state.turn = msg.turn;
    if (msg.players && msg.players.length >= 2) {
      console.log(chalk.cyan(`\n✓ Opponent joined!`));
      console.log(chalk.cyan(`Players in room:`));
      msg.players.forEach((p: any) => {
        const name = typeof p === 'string' ? p : p.username;
        const isYou = typeof p === 'string' ? p === state.user?.id : p.id === state.user?.id;
        console.log(isYou ? chalk.green(`  ✓ ${name} (you)`) : chalk.white(`  • ${name}`));
      });
      console.log();
    }
  });

  socket.on('fireResult', (msg: any) => {
    console.log(chalk.yellow(`\n⚡ Fire at ${msg.coord.toUpperCase()}: ${msg.result.toUpperCase()}`));
    if (msg.result === 'hit') {
      state.enemyHits.push(msg.coord);
    }
  });

  socket.on('turnChange', (msg: any) => {
    state.turn = msg.playerId;
    const isMyTurn = msg.playerId === state.user?.id;
    console.log(isMyTurn ? chalk.bold.green('\n>>> YOUR TURN <<<') : chalk.yellow('\n>>> Opponent\'s turn <<<'));
    state.phase = 'battle';
  });

  socket.on('gameOver', (msg: any) => {
    state.winner = msg.winnerId;
    const won = msg.winnerId === state.user?.id;
    state.phase = 'gameover';
    console.log(chalk.bold.magenta(won ? '\n🎉 YOU WON! 🎉' : '\n💀 YOU LOST! 💀'));
    socket?.close();
    rl.close();
    process.exit(0);
  });

  // Join or create room (retry join briefly to reduce split rooms)
  console.log(chalk.yellow('Fetching available rooms...'));
  let availableRooms: any = await get(`${ROOM}/rooms`);
  if (!availableRooms.rooms || availableRooms.rooms.length === 0) {
    // Briefly retry to catch just-created rooms by another client
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 300));
      availableRooms = await get(`${ROOM}/rooms`);
      if (availableRooms.rooms && availableRooms.rooms.length > 0) break;
    }
  }

  if (availableRooms.rooms && availableRooms.rooms.length > 0) {
    const room = availableRooms.rooms[0];
    console.log(chalk.cyan(`Joining existing room: ${room.roomId}\n`));
    const joinedRoom: any = await post(`${ROOM}/rooms/${room.roomId}/join`, { userId: state.user!.id });
    state.room = joinedRoom;
    socket.emit('joinRoom', { roomId: joinedRoom.roomId, playerId: state.user!.id });
  } else {
    console.log(chalk.cyan('No available rooms, creating new one...'));
    const room: any = await post(`${ROOM}/rooms`, { userId: state.user!.id, timeLimit: 3 });
    state.room = room;
    socket.emit('joinRoom', { roomId: room.roomId, playerId: state.user!.id });
    console.log(chalk.green(`✓ Room created: ${room.roomId}\n`));
    console.log(chalk.yellow('Waiting for another player...\n'));
  }

  // Proceed to placement immediately (opponent can join later)
  state.phase = 'placement';
  console.log(chalk.bold.cyan('\n⚓ PLACEMENT PHASE ⚓\n'));

  // Place ship
  printGrid([], [], 'Select a cell (A1-C3):', false);
  
  const shipPos = await question(chalk.yellow('Enter cell for your ship (e.g., A1): '));
  
  if (!['A1','A2','A3','B1','B2','B3','C1','C2','C3'].includes(shipPos.toUpperCase())) {
    console.log(chalk.red('Invalid cell! Using A1 as default.'));
    state.myShips.push('A1');
  } else {
    state.myShips.push(shipPos.toUpperCase());
  }
  
  console.log(chalk.yellow(`Placing ship at ${state.myShips[0]}...`));
  await post(`${GAME}/game/${state.room!.roomId}/place`, {
    playerId: state.user!.id,
    shipCoords: [{ from: state.myShips[0], to: state.myShips[0] }],
  });
  
  console.log(chalk.green(`✓ Ship placed\n`));
  printGrid(state.myShips, [], 'Your grid:', true);

  console.log(chalk.yellow('Waiting for opponent to place...\n'));

  // Wait until opponent has placed and initial turn is known
  const myId = state.user!.id;
  const roomId = state.room!.roomId;
  while (true) {
    // poll game debug for opponent readiness
    const dbg = await getJson(`${GAME}/debug/${roomId}`);
    if (dbg && dbg.players && dbg.playerState) {
      const oppId = dbg.players.find((p: string) => p !== myId);
      const oppPlaced = oppId ? dbg.playerState[oppId]?.shipsPlaced : false;
      if (oppPlaced && (state.turn || dbg.turn)) {
        state.turn = state.turn || dbg.turn;
        break;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }

  state.phase = 'battle';
  console.log(chalk.bold.cyan('\n⚔️  BATTLE PHASE ⚔️\n'));

  // Game loop
  let shots: string[] = [];
  while (state.phase === 'battle' && !state.winner) {
    if (state.turn === state.user?.id) {
      printGrid(shots, state.enemyHits, 'Enemy grid:', false);
      
      const shotPos = await question(chalk.green('Enter cell to fire at (e.g., B2): '));
      
      if (!['A1','A2','A3','B1','B2','B3','C1','C2','C3'].includes(shotPos.toUpperCase())) {
        console.log(chalk.red('Invalid cell!'));
        continue;
      }
      
      shots.push(shotPos.toUpperCase());
      
      console.log(chalk.yellow(`\nFiring at ${shotPos.toUpperCase()}...`));
      try {
        await post(`${GAME}/game/${state.room!.roomId}/fire`, {
          playerId: state.user!.id,
          coord: shotPos.toUpperCase(),
        });
      } catch (e: any) {
        const msg = String(e);
        if (msg.includes('Opponent not ready')) {
          console.log(chalk.yellow('Opponent not ready yet. Waiting...'));
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        throw e;
      }
      
      socket?.emit('fire', { roomId: state.room!.roomId, playerId: state.user!.id, coord: shotPos.toUpperCase() });
    } else {
      // Wait for opponent's turn
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

play().catch((err) => {
  console.error(chalk.red('Error:'), err);
  rl.close();
  process.exit(1);
});
