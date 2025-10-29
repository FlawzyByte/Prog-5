# Mini Battleship — Ops/Docs (Day 7)

This document complements the main README with runbooks, ports, environment hints, and CI/testing conventions.

## Services and Ports

- User Service: http://127.0.0.1:3001
- Room Service: http://127.0.0.1:3002
- Game Rules Service (HTTP + Socket.IO): http://127.0.0.1:3003

Each service exposes `GET /health` returning `{ "status": "ok" }`.

## APIs (summary)

- User Service
  - POST `/users` → `{ id, username }`
  - GET `/users/:id` → `{ id, username } | 404`

- Room Service
  - POST `/rooms` `{ userId, timeLimit? }` → `{ roomId, players: [{id,username}], turn, timeLimit }`
  - POST `/rooms/:roomId/join` `{ userId }` → `{ roomId, players, turn, timeLimit } | 404 | 409`
  - GET `/rooms/:roomId` → `{ roomId, players, turn, timeLimit }`
  - GET `/rooms` → `{ rooms: Array<{ roomId, players, playerCount, hasSpace }> }`

- Game Rules Service
  - POST `/game/:roomId/place` `{ playerId, shipCoords: [{from,to}] }` → `{ ok: true } | 400 | 403 | 404 | 409`
  - POST `/game/:roomId/fire` `{ playerId, coord }` → `{ result, gameOver, nextTurn } | 400 | 403 | 404 | 409`
  - POST `/game/:roomId/surrender` `{ playerId }` → `{ ok: true, surrendered: true, opponentId } | errors`
  - GET `/debug/:roomId` (dev-only) → in-memory state snapshot

## WebSocket (Socket.IO) Events

- Client → Server
  - `joinRoom` `{ roomId, playerId }`
  - `fire` `{ roomId, playerId, coord }`
  - `surrender` `{ roomId, playerId }`

- Server → Client
  - `joinRoomAck` `{ roomId, players: Array<{id,username}> | string[], turn, timeLimit? }`
  - `roomUpdate` `{ roomId, players, turn, timeLimit? }`
  - `placeShipAck` `{ ok: boolean, error? }`
  - `fireResult` `{ roomId, shooterId, coord, result: 'hit' | 'miss' }`
  - `turnChange` `{ roomId, playerId }`
  - `gameOver` `{ roomId, winnerId }`

## Environment Variables (.env.example)

Create `.env` files per service if needed. Example values (defaults used if absent):

User Service
- `PORT=3001`

Room Service
- `PORT=3002`
- `USER_SERVICE_URL=http://127.0.0.1:3001`

Game Rules Service
- `PORT=3003`
- `ROOM_SERVICE_URL=http://127.0.0.1:3002`

## Scripts

Root scripts
- `npm run dev:user` — start user-service (tsx watch)
- `npm run dev:room` — start room-service
- `npm run dev:game` — start game-rules-service
- `npm run dev:web` — start web client
- `npm run ws:smoke` — WS e2e smoke test (two clients simulated)
- `npm run lint` — ESLint
- `npm run format` — Prettier

Per-service scripts (package.json)
- `dev` — `tsx watch src/index.ts`

Clients
- Web client (`clients/web`) — Vite + React + TS
- CLI client (`clients/cli`) — `npm run dev -- --username=name`

## Logging & Health

- Fastify logger enabled for all services; pino installed
- `GET /health` per service for probes

## State & Validation Standards

- State: in-memory Maps (week 1); can swap to Redis later
- Validation: zod schemas on all HTTP endpoints and WS payloads (where applicable)
- Consistent error shape: `{ error: string }` with appropriate HTTP status codes

## Docker Compose (overview)

Not included in repo yet. Recommended `docker-compose.yml` should:
- Build/run three services on fixed ports 3001/3002/3003
- Network them together; expose ports to host
- Optionally add web and CLI images for demo runs

## CI (lightweight plan)

GitHub Actions (suggested `ci.yml`):
- `npm ci`
- `npm run lint`
- (optional) run smoke tests against services started in background

## Architecture Diagram

Place exported diagram under `docs/architecture/` and reference it here once added.

## Demo Runbook

- Terminal A: `npm run dev:user`
- Terminal B: `npm run dev:room`
- Terminal C: `npm run dev:game`
- Terminal D: `npm run dev:web`
- Optional CLI: `cd clients/cli && npm run dev -- --username=alice`
- Open web at `http://localhost:5173` (or printed Vite port)

With both clients (web/CLI), create/join room, place 1 cell ship, then alternate firing. Game ends when a ship’s single cell is hit.
