# Mini Battleship

## Tech stack
- Language/Monorepo: TypeScript end-to-end; npm or pnpm workspaces (Turborepo optional later)
- Backend (User, Room, Game Rules): Fastify (HTTP), zod (validation), uuid (IDs), undici/axios (HTTP client)
- WebSocket: ws (minimal) or Socket.IO (rooms/reconnect)
- Data store (Phase 2): in-memory Maps; (later) Redis if needed
- Testing: Vitest/Jest + supertest
- DX/Runtime: tsx or nodemon, ESLint + Prettier, dotenv
- Clients:
  - CLI: Node + yargs, chalk, ws/Socket.IO client
  - Web: React + Vite + TypeScript, Zustand (state), Tailwind or minimal CSS
- Infra/Docs: Docker Compose for services; Mermaid diagrams in README; optional fastify-swagger later

Service APIs
 User Service
- POST `/users`
  - Request: `{ "username": string }`
  - Response: `{ "id": string, "username": string }`
- GET `/users/{id}`
  - Response: `{ "id": string, "username": string } | 404`

 Room Service
- POST `/rooms`
  - Request: `{ "userId": string }`
  - Behavior: validates `userId` via User Service
  - Response: `{ "roomId": string, "players": [string], "turn": string }`
- POST `/rooms/{roomId}/join`
  - Request: `{ "userId": string }`
  - Behavior: validates `userId`; joins room if space/valid
  - Response: `{ "roomId": string, "players": [string], "turn": string } | 404 | 409`

 Game Rules Service
- POST `/game/{roomId}/place`
  - Request: `{ "playerId": string, "shipCoords": Array<[string, string]> }`
  - Response: `{ "ok": true } | { "error": string }`
- POST `/game/{roomId}/fire`
  - Request: `{ "playerId": string, "coord": string }`
  - Response: `{ "result": "hit" | "miss" | "sink", "gameOver": boolean, "nextTurn": string } | { "error": string }`

 WebSocket schema
Events are JSON messages with the shape `{ "type": string, "payload": object }`.

Client → Server
- `joinRoom`
  - Payload: `{ "roomId": string, "playerId": string }`
- `placeShip`
  - Payload: `{ "roomId": string, "playerId": string, "from": string, "to": string }`
- `placeShipsBatch` (optional convenience)
  - Payload: `{ "roomId": string, "playerId": string, "ships": Array<{ from: string, to: string }> }`
- `fire`
  - Payload: `{ "roomId": string, "playerId": string, "coord": string }`

 Server → Client
- `joinRoomAck`
  - Payload: `{ "roomId": string, "players": [string], "turn": string }`
- `placeShipAck`
  - Payload: `{ "roomId": string, "playerId": string, "ok": boolean, "error?": string }`
- `fireResult`
  - Payload: `{ "roomId": string, "shooterId": string, "coord": string, "result": "hit" | "miss" | "sink" }`
- `turnChange`
  - Payload: `{ "roomId": string, "playerId": string }`
- `gameOver`
  - Payload: `{ "roomId": string, "winnerId": string }`

## Architecture diagram
File: `docs/architecture/mini-battleship-architecture.drawio` (open in diagrams.net). Export PNG/SVG for slides.

